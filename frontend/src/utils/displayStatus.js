/**
 * One line for inbox / rails: Spotify (“now playing”) overrides custom profile status.
 * @param {object | null | undefined} user — publicProfileWithPresence / search row shape
 */
export function listeningStatusLine(user) {
  if (!user) return "";
  const m = user.musicNowPlaying;
  if (m && (m.title || m.spotifyTrackId)) {
    const title = String(m.title || "Unknown track").trim().replace(/"/g, "”");
    return `♪ listening to "${title}"`;
  }
  const raw = typeof user.statusNote === "string" ? user.statusNote.trim() : "";
  return raw;
}
