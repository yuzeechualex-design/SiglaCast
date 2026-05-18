/** Where to send the user when they tap a notification — uses API fields plus fallbacks for older rows. */
export function notificationTargetPath(n) {
  if (!n) return null;
  if (n.linkPath) return n.linkPath;
  const sk = n.sourceKey || "";
  if (sk.startsWith("dm:")) {
    const from = sk.slice(3).trim();
    if (from) return `/messages?dm=${encodeURIComponent(from)}`;
  }
  if (sk.startsWith("announcements:inbox")) return "/announcements";
  if (sk.startsWith("events:inbox")) return "/events";
  if (n.kind === "mention") return "/community";
  return null;
}
