import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in backend/.env");
  throw new Error("Supabase environment variables are required");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    course: row.course || null,
    avatarUrl: row.avatar_url || null
  };
}

export function toCandidate(row) {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url || null
  };
}

export function toEvent(row, candidates = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    rules: row.rules || "",
    status: row.status,
    strategy: row.strategy,
    maxVotesPerUser: typeof row.max_votes_per_user === "number" ? row.max_votes_per_user : 1,
    coverImageUrl: row.cover_image_url || null,
    candidates: candidates.map(toCandidate)
  };
}

export async function uploadToBucket(bucket, file) {
  const ext = (file.originalname || "bin").split(".").pop().toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

// Same as uploadToBucket but returns a richer object including the safe
// display name so chat attachments can show their original filename.
export async function uploadAttachment(bucket, file) {
  const safeName = (file.originalname || "file")
    .replace(/[/\\]/g, "_")
    .slice(0, 120);
  const ext = safeName.split(".").pop().toLowerCase();
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return {
    url: data.publicUrl,
    name: safeName,
    size: file.size,
    mime: file.mimetype,
    isImage: /^image\//i.test(file.mimetype || "")
  };
}
