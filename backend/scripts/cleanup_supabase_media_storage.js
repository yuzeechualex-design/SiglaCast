import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });

const { supabase } = await import("../src/supabase.js");

const args = new Set(process.argv.slice(2));
const COMMIT = args.has("--commit");
const MEDIA_EXT = /\.(avif|gif|heic|heif|jpe?g|m4v|mov|mp4|mpeg|png|webm|webp)$/i;
const BUCKETS = ["avatars", "posts", "chat-attachments", "group-photos", "events"];
const MEDIA_COLUMNS = [
  { table: "users", columns: ["avatar_url", "cover_url"] },
  { table: "posts", columns: ["image_url"] },
  { table: "post_comments", columns: ["image_url"] },
  { table: "user_stories", columns: ["media_url"] },
  { table: "events", columns: ["cover_image_url"] },
  { table: "candidates", columns: ["image_url"] },
  { table: "messages", columns: ["attachment_url"] },
  { table: "conversations", columns: ["photo_url"] },
  { table: "servers", columns: ["icon_url"] }
];

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

async function currentSupabaseMediaReferences() {
  const refs = new Map();
  for (const config of MEDIA_COLUMNS) {
    const { data, error } = await supabase.from(config.table).select(config.columns.join(", "));
    if (error) {
      console.warn(`[skip] ${config.table}: ${error.message}`);
      continue;
    }
    for (const row of data || []) {
      for (const column of config.columns) {
        const source = supabasePublicObject(row[column]);
        if (!source) continue;
        refs.set(`${source.bucket}\n${source.path}`, source);
      }
    }
  }
  return refs;
}

async function listBucketMedia(bucket, prefix = "") {
  const found = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) {
      console.warn(`[skip] ${bucket}/${prefix}: ${error.message}`);
      return found;
    }
    if (!data?.length) break;
    for (const item of data) {
      const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
      const isFolder = item.id == null && item.metadata == null;
      if (isFolder) {
        found.push(...await listBucketMedia(bucket, itemPath));
      } else if (MEDIA_EXT.test(item.name)) {
        found.push(itemPath);
      }
    }
    offset += data.length;
  }
  return found;
}

async function main() {
  console.log(COMMIT ? "[commit] deleting unreferenced Supabase media" : "[dry-run] no Supabase files will be deleted");
  const refs = await currentSupabaseMediaReferences();
  console.log(`Keeping ${refs.size} currently referenced Supabase media object(s).`);

  for (const bucket of BUCKETS) {
    const paths = await listBucketMedia(bucket);
    const deletePaths = paths.filter((objectPath) => !refs.has(`${bucket}\n${objectPath}`));
    console.log(`${bucket}: ${deletePaths.length} unreferenced media object(s)`);
    for (const objectPath of deletePaths) {
      console.log(`  ${COMMIT ? "delete" : "would delete"} ${bucket}/${objectPath}`);
    }
    if (COMMIT && deletePaths.length) {
      const { error } = await supabase.storage.from(bucket).remove(deletePaths);
      if (error) throw new Error(`delete failed for ${bucket}: ${error.message}`);
    }
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
