import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load dotenv from backend/.env
dotenv.config({ path: path.join(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing environment variables in backend/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function uploadFile(localPath, remotePath, mimeType) {
  console.log(`Reading ${localPath}...`);
  if (!fs.existsSync(localPath)) {
    console.error(`File does not exist: ${localPath}`);
    return;
  }
  const fileBuffer = fs.readFileSync(localPath);
  console.log(`Uploading ${localPath} to avatars/${remotePath} (${fileBuffer.length} bytes)...`);

  const { error } = await supabase.storage
    .from("avatars")
    .upload(remotePath, fileBuffer, {
      contentType: mimeType,
      upsert: true
    });

  if (error) {
    console.error(`Upload failed: ${error.message}`);
  } else {
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(remotePath);
    console.log(`Upload successful! Public URL: ${urlData.publicUrl}`);
  }
}

async function main() {
  const apkPath = path.join(__dirname, "../../frontend/public/downloads/siglacast.apk");
  const exePath = path.join(__dirname, "../../frontend/public/downloads/siglacast.exe");

  await uploadFile(apkPath, "downloads/siglacast.apk", "application/vnd.android.package-archive");
  await uploadFile(exePath, "downloads/siglacast.exe", "application/x-msdownload");
}

main().catch(console.error);
