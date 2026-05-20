import crypto from "crypto";

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
/** Must match a redirect URI in the Spotify app settings (API callback). */
export const SPOTIFY_REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || "http://localhost:4000/api/music/spotify/callback";
/** Where users return in the browser after linking (no wildcards). Prefer SPOTIFY_FRONTEND_AFTER_LINK; legacy keys still work. */
export const SPOTIFY_FRONTEND_AFTER_LINK =
  process.env.SPOTIFY_FRONTEND_AFTER_LINK?.trim() ||
  process.env.SPOTIFY_FRONTEND_REDIRECT?.trim() ||
  process.env.SPOTIFY_FRONTEND_RETURN?.trim() ||
  "http://localhost:5173/music";

const SCOPES = ["user-read-currently-playing", "user-read-playback-state"].join(" ");

const oauthStates = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) {
    if (v.exp < now) oauthStates.delete(k);
  }
}, 60_000);

export function mintSpotifyOAuthState(userId) {
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, { userId, exp: Date.now() + 12 * 60_000 });
  return state;
}

export function consumeSpotifyOAuthState(state) {
  const rec = oauthStates.get(state);
  if (!rec) return null;
  oauthStates.delete(state);
  if (rec.exp < Date.now()) return null;
  return rec.userId;
}

let clientCredCache = { token: null, exp: 0 };

export async function spotifyClientAccessToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify app credentials missing (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)");
  }
  if (clientCredCache.token && Date.now() < clientCredCache.exp - 8000) return clientCredCache.token;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "Spotify client token failed");
  }
  clientCredCache = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in || 3600) * 1000
  };
  return data.access_token;
}

export function buildSpotifyAuthorizeUrl(state) {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    state,
    show_dialog: "true"
  });
  return `https://accounts.spotify.com/authorize?${q}`;
}

export async function exchangeSpotifyCode(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!data.refresh_token || !data.access_token) {
    throw new Error(data.error_description || data.error || "Spotify token exchange failed");
  }
  return data;
}

export async function refreshSpotifyAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString("base64")}`
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || "Spotify refresh failed");
  }
  return data;
}

export function normalizeSpotifyTrack(item) {
  if (!item?.id) return null;
  const artists = (item.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const imgs = item.album?.images || [];
  const imageUrl = imgs.find((x) => x.height && x.height >= 200)?.url || imgs[0]?.url || null;
  return {
    spotifyTrackId: item.id,
    title: item.name || "Unknown track",
    artist: artists || "Unknown artist",
    imageUrl,
    previewUrl: item.preview_url || null,
    externalUrl: item.external_urls?.spotify || null
  };
}

export async function searchSpotifyTracks(q, limit = 24) {
  const token = await spotifyClientAccessToken();
  const params = new URLSearchParams({
    q: String(q || "").slice(0, 200),
    type: "track",
    limit: String(Math.min(Math.max(Number(limit) || 24, 1), 50))
  });
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.error || "Spotify search failed");
  }
  const data = await res.json().catch(() => ({}));
  const items = data?.tracks?.items || [];
  return items.map((item) => normalizeSpotifyTrack(item)).filter(Boolean);
}

export async function fetchCurrentlyPlaying(accessToken) {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.status === 401) throw new Error("SpotifyUnauthorized");
  if (res.status === 204) return { isPlaying: false, track: null };
  if (res.status !== 200) return { isPlaying: false, track: null };
  const data = await res.json().catch(() => ({}));
  const item = data.item;
  if (!item || item.type !== "track") {
    return { isPlaying: false, track: null };
  }
  const nt = normalizeSpotifyTrack(item);
  return {
    isPlaying: Boolean(data.is_playing && nt),
    track: nt,
    rawProgress: typeof data.progress_ms === "number" ? data.progress_ms : null,
    rawDuration: typeof item.duration_ms === "number" ? item.duration_ms : null
  };
}
