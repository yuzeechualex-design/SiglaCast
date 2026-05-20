/** Normalize to an in-app path (reject external URLs). */
function normalizeInternalPath(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return null;
  return s.startsWith("/") ? s : `/${s}`;
}

/**
 * Where to send the user when they open a notification — uses API fields plus fallbacks for older rows.
 * Accepts camelCase or snake_case keys from the API / broker payloads.
 */
export function notificationTargetPath(n) {
  if (!n) return null;

  const direct = normalizeInternalPath(n.linkPath ?? n.link_path);
  if (direct) return direct;

  const sk = String(n.sourceKey ?? n.source_key ?? "").trim();

  if (sk.startsWith("dm:")) {
    const from = sk.slice(3).trim();
    if (from) return `/messages?dm=${encodeURIComponent(from)}`;
  }
  if (sk.startsWith("group:")) {
    const gid = sk.slice(6).trim();
    if (gid) return `/messages?group=${encodeURIComponent(gid)}`;
  }
  if (sk.startsWith("announcements:inbox")) return "/announcements";
  if (sk.startsWith("events:inbox")) return "/events";

  const kind = String(n.kind || "").toLowerCase().replace(/\s+/g, "_");
  switch (kind) {
    case "mention":
    case "reaction_post":
    case "reaction_comment":
    case "reply_comment":
      return "/community";
    case "dm":
    case "reaction_message":
    case "reply_message":
    case "friend_request":
    case "group_added":
    case "group_removed":
      return "/messages";
    case "announcement":
      return "/announcements";
    case "event":
      return "/events";
    default:
      return null;
  }
}
