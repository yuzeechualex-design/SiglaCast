import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const { supabase, uploadToCloudinary, cloudinaryEnabled } = await import("../src/supabase.js");

const args = new Set(process.argv.slice(2));
const COMMIT = args.has("--commit");
const DELETE_SOURCE = args.has("--delete-source");
const LIMIT_ARG = process.argv.find((arg) => arg.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=")[1]) : 0;

const MEDIA_COLUMNS = [
  { table: "users", pk: "id", columns: ["avatar_url", "cover_url"] },
  { table: "posts", pk: "id", columns: ["image_url"] },
  { table: "post_comments", pk: "id", columns: ["image_url"] },
  { table: "user_stories", pk: "id", columns: ["media_url"] },
  { table: "events", pk: "id", columns: ["cover_image_url"] },
  { table: "candidates", pk: "id", columns: ["image_url"] },
  { table: "messages", pk: "id", columns: ["attachment_url"] },
  { table: "conversations", pk: "id", columns: ["photo_url"] },
  { table: "servers", pk: "id", columns: ["icon_url"] }
];

const MEDIA_EXT = /\.(avif|gif|heic|heif|jpe?g|m4v|mov|mp4|mpeg|png|webm|webp)$/i;

function supabasePublicObject(url) {
  if (!url || typeof url !== "string") return null;
  if (!url.includes("/storage/v1/object/public/")) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const marker = "/storage/v1/object/public/";
  const index = parsed.pathname.indexOf(marker);
  if (index === -1) return null;
  const rest = decodeURIComponent(parsed.pathname.slice(index + marker.length));
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return {
    bucket: rest.slice(0, slash),
    path: rest.slice(slash + 1)
  };
}

function extensionFromUrl(url) {
  try {
    return path.extname(new URL(url).pathname).replace(".", "").toLowerCase() || "bin";
  } catch {
    return "bin";
  }
}

function mimeFromUrl(url, response) {
  const header = response.headers.get("content-type") || "";
  if (/^(image|video)\//i.test(header)) return header.split(";")[0];
  const ext = extensionFromUrl(url);
  const map = {
    avif: "image/avif",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    m4v: "video/mp4",
    mov: "video/quicktime",
    mp4: "video/mp4",
    mpeg: "video/mpeg",
    png: "image/png",
    webm: "video/webm",
    webp: "image/webp"
  };
  return map[ext] || "application/octet-stream";
}

async function loadRows(table, pk, columns) {
  const select = [pk, ...columns].join(", ");
  const { data, error } = await supabase.from(table).select(select);
  if (error) {
    console.warn(`[skip] ${table}: ${error.message}`);
    return [];
  }
  return data || [];
}

async function uploadUrlToCloudinary(oldUrl, bucket) {
  const response = await fetch(oldUrl);
  if (!response.ok) {
    throw new Error(`download failed ${response.status}`);
  }
  const contentType = mimeFromUrl(oldUrl, response);
  if (!/^(image|video)\//i.test(contentType) && !MEDIA_EXT.test(oldUrl)) {
    return null;
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const originalname = `migrated-${Date.now()}.${extensionFromUrl(oldUrl)}`;
  return uploadToCloudinary({
    buffer,
    originalname,
    mimetype: contentType,
    size: buffer.length
  }, { bucket });
}

async function main() {
  if (!cloudinaryEnabled()) {
    throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET before migrating.");
  }

  console.log(COMMIT ? "[commit] database updates enabled" : "[dry-run] no database changes will be written");
  console.log(DELETE_SOURCE ? "[delete-source] Supabase Storage objects will be removed after successful updates" : "[keep-source] Supabase Storage objects will be kept");

  const updates = [];
  for (const config of MEDIA_COLUMNS) {
    const rows = await loadRows(config.table, config.pk, config.columns);
    for (const row of rows) {
      for (const column of config.columns) {
        const oldUrl = row[column];
        const source = supabasePublicObject(oldUrl);
        if (!source) continue;
        updates.push({
          table: config.table,
          pk: config.pk,
          id: row[config.pk],
          column,
          oldUrl,
          source
        });
        if (LIMIT && updates.length >= LIMIT) break;
      }
      if (LIMIT && updates.length >= LIMIT) break;
    }
    if (LIMIT && updates.length >= LIMIT) break;
  }

  console.log(`Found ${updates.length} Supabase media URL(s) to migrate.`);
  const migratedByUrl = new Map();
  const deleteObjects = new Map();
  const failures = [];

  for (const item of updates) {
    if (!COMMIT) {
      console.log(`  would migrate ${item.table}.${item.column} ${item.id}: ${item.oldUrl}`);
      continue;
    }

    let newUrl = migratedByUrl.get(item.oldUrl);
    if (!newUrl) {
      console.log(`Uploading ${item.oldUrl}`);
      try {
        newUrl = await uploadUrlToCloudinary(item.oldUrl, item.source.bucket);
      } catch (err) {
        const message = err?.message || String(err);
        failures.push({ ...item, error: message });
        console.warn(`  failed: ${message}`);
        continue;
      }
      if (!newUrl) {
        console.log(`  skipped non-media: ${item.oldUrl}`);
        continue;
      }
      migratedByUrl.set(item.oldUrl, newUrl);
    }

    console.log(`  ${item.table}.${item.column} ${item.id}: ${newUrl}`);
    const { error } = await supabase
      .from(item.table)
      .update({ [item.column]: newUrl })
      .eq(item.pk, item.id);
    if (error) throw new Error(`update failed ${item.table}.${item.column} ${item.id}: ${error.message}`);
    const key = `${item.source.bucket}\n${item.source.path}`;
    deleteObjects.set(key, item.source);
  }

  if (COMMIT && DELETE_SOURCE) {
    const byBucket = new Map();
    for (const source of deleteObjects.values()) {
      if (!byBucket.has(source.bucket)) byBucket.set(source.bucket, []);
      byBucket.get(source.bucket).push(source.path);
    }
    for (const [bucket, paths] of byBucket) {
      console.log(`Deleting ${paths.length} object(s) from Supabase bucket ${bucket}`);
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) throw new Error(`delete failed for bucket ${bucket}: ${error.message}`);
    }
  }

  if (failures.length) {
    console.log(`Skipped ${failures.length} file(s):`);
    for (const failure of failures) {
      console.log(`  ${failure.table}.${failure.column} ${failure.id}: ${failure.error}`);
      console.log(`    ${failure.oldUrl}`);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
