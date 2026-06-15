import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;
const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || "purxu";
const CLOUDINARY_MAX_UPLOAD_BYTES = Number(process.env.CLOUDINARY_MAX_UPLOAD_BYTES || 10 * 1024 * 1024);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in backend/.env");
  throw new Error("Supabase environment variables are required");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

export function cloudinaryEnabled() {
  return Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
}

export function isCloudinaryMedia(file) {
  return /^image\//i.test(file?.mimetype || "") || /^video\//i.test(file?.mimetype || "");
}

function cloudinarySignature(params) {
  const base = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return crypto.createHash("sha1").update(`${base}${CLOUDINARY_API_SECRET}`).digest("hex");
}

export async function uploadToCloudinary(file, options = {}) {
  if (!cloudinaryEnabled()) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.");
  }
  if (CLOUDINARY_MAX_UPLOAD_BYTES > 0 && file.size > CLOUDINARY_MAX_UPLOAD_BYTES) {
    throw new Error(`Cloudinary upload skipped: file is ${file.size} bytes, limit is ${CLOUDINARY_MAX_UPLOAD_BYTES} bytes.`);
  }
  const ext = (file.originalname || "media").split(".").pop().toLowerCase();
  const publicId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const folder = [CLOUDINARY_FOLDER, options.bucket].filter(Boolean).join("/");
  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = { folder, public_id: publicId, timestamp };
  const signature = cloudinarySignature(signedParams);
  const form = new FormData();
  form.append("file", new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname || publicId);
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("signature", signature);

  const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
  const response = await fetch(uploadUrl, { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Cloudinary upload failed (${response.status})`;
    throw new Error(message);
  }
  return data.secure_url || data.url;
}

export function toPublicUser(row) {
  if (!row) return null;
  const badgeIds = Array.isArray(row.profile_badge_item_ids)
    ? row.profile_badge_item_ids
    : [];
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    course: row.course || null,
    avatarUrl: row.avatar_url || null,
    coverUrl: row.cover_url || null,
    profileFrameItemId: row.profile_frame_item_id || null,
    profileFrameUrl:
      row.profile_frame_item_id === "pink-heart-bond-frame"
        ? "/assets/bond-frame-pink.png"
        : row.profile_frame_item_id === "alien-stage-ivan-frame"
          ? "/assets/alien-stage-ivan-frame.png"
        : row.profile_frame_item_id === "alien-stage-till-frame"
          ? "/assets/alien-stage-till-frame.png"
        : row.profile_frame_item_id === "alien-stage-mizi-frame"
          ? "/assets/alien-stage-mizi-frame.png"
        : row.profile_frame_item_id === "alien-stage-sua-frame"
          ? "/assets/alien-stage-sua-frame.png"
        : row.profile_frame_item_id === "chiikawa-hachiware-frame"
          ? "/assets/chiikawa-hachiware-frame.png"
        : row.profile_frame_item_id === "chiikawa-usagi-frame"
          ? "/assets/chiikawa-usagi-frame.png"
        : row.profile_frame_item_id === "chiikawa-momonga-frame"
          ? "/assets/chiikawa-momonga-frame.png"
        : row.profile_frame_item_id === "chiikawa-chiikawa-frame"
          ? "/assets/chiikawa-chiikawa-frame.png"
        : row.profile_frame_item_id === "exe-frame"
          ? "/assets/exe-frame.png"
        : null,
    profileCardBackgroundItemId: row.profile_card_background_item_id || null,
    profileCardBackgroundUrl:
      row.profile_card_background_item_id === "exe-profile-background"
        ? "/assets/exe-profile-background.mp4"
        : null,
    profileBadgeItemIds: badgeIds,
    profileBadges: badgeIds
      .map((id) => {
        const map = {
          "alien-stage-mizisua-star": { id, name: "Mizisua Star Badge", imageUrl: "/assets/alien-stage-mizisua-star.png" },
          "alien-stage-hyuluka-star": { id, name: "Hyuluka Star Badge", imageUrl: "/assets/alien-stage-hyuluka-star.png" },
          "alien-stage-ivan-star": { id, name: "Ivan Star Badge", imageUrl: "/assets/alien-stage-ivan-star.png" },
          "alien-stage-till-star": { id, name: "Till Star Badge", imageUrl: "/assets/alien-stage-till-star.png" }
        };
        return map[id] || null;
      })
      .filter(Boolean),
    statusEmoji: row.status_emoji || null,
    statusNote: row.status_note || null,
    bio: row.bio || null,
    ownerUserId: row.owner_user_id || null,
    isAiCharacter: Boolean(row.is_ai_character),
    aiRoles: row.ai_roles || null,
    aiPersonality: row.ai_personality || null,
    aiBackground: row.ai_background || null,
    aiAutoPost: Boolean(row.ai_auto_post),
    aiAutoReply: Boolean(row.ai_auto_reply)
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
  if (cloudinaryEnabled() && isCloudinaryMedia(file)) {
    return uploadToCloudinary(file, { bucket });
  }
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
  if (cloudinaryEnabled() && isCloudinaryMedia(file)) {
    const url = await uploadToCloudinary({ ...file, originalname: safeName }, { bucket });
    return {
      url,
      name: safeName,
      size: file.size,
      mime: file.mimetype,
      isImage: /^image\//i.test(file.mimetype || "")
    };
  }
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
