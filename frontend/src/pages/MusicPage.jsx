import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { request } from "../services/api.js";
import { useMusicPlayer } from "../components/MusicPlayerContext.jsx";

/**
 * Spotify discovery + previews (full Web Playback SDK is a Premium follow‑up later).
 */
export default function MusicPage({ api, token, user, setNotice, refreshUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { playPreview, stopPlayback } = useMusicPlayer();

  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);

  /** Clear OAuth hints from URL after Spotify redirect back to the SPA. */
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const s = p.get("spotify");
    if (!s) return undefined;
    if (s === "connected") setNotice?.("Spotify linked. Enable sharing under Profile → Spotify activity.");
    else if (s === "error") setNotice?.("Spotify link didn’t finish. Try connecting again.");

    navigate("/music", { replace: true });
    refreshUser?.();
    return undefined;
  }, [location.search, navigate, refreshUser, setNotice]);

  /** Debounced search */
  useEffect(() => {
    const k = q.trim();
    if (k.length < 2 || !token) {
      setHits([]);
      return undefined;
    }
    let cancelled = false;
    const tid = window.setTimeout(async () => {
      setSearchBusy(true);
      try {
        const data = await request(`/music/search?q=${encodeURIComponent(k)}`, { token });
        if (cancelled) return;
        if (data?.error || !Array.isArray(data?.tracks)) {
          setHits([]);
          return;
        }
        setHits(data.tracks);
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [q, token]);

  const syncNow = useCallback(async () => {
    if (!token) return;
    const res = await api("/music/spotify/sync-now-playing", { method: "POST", body: {} });
    if (res?.error) {
      setNotice?.(typeof res.error === "string" ? res.error : "Could not sync Spotify");
      return;
    }
    await refreshUser?.();
    setNotice?.("Synced what you’re listening to from Spotify.");
  }, [api, token, setNotice, refreshUser]);

  /** Poll Spotify “currently playing” when linked + opted in — keeps bios fresh for friends. */
  useEffect(() => {
    if (!token || !user?.spotifyLinked || !user?.musicShareNowPlaying) return undefined;

    async function ping() {
      await api("/music/spotify/sync-now-playing", { method: "POST", body: {} });
      await refreshUser?.();
    }

    ping();
    const iv = window.setInterval(ping, 22_000);
    return () => window.clearInterval(iv);
  }, [token, user?.spotifyLinked, user?.musicShareNowPlaying, api, refreshUser]);

  async function handleConnectSpotify() {
    if (!token) return;
    setConnectBusy(true);
    try {
      const data = await api("/music/spotify/connect", { method: "POST", body: {} });
      if (data?.authorizeUrl && typeof window !== "undefined") {
        window.location.href = data.authorizeUrl;
        return;
      }
      setNotice?.(typeof data?.error === "string" ? data.error : "Could not start Spotify link");
    } finally {
      setConnectBusy(false);
    }
  }

  async function disconnect() {
    if (!token || !window.confirm("Disconnect Spotify from SiglaCast? Friends will no longer see your Now Playing badge."))
      return;
    stopPlayback();
    const data = await api("/music/spotify", { method: "DELETE" });
    if (data?.error) {
      setNotice?.(typeof data.error === "string" ? data.error : "Could not disconnect Spotify.");
      return;
    }
    await refreshUser?.();
    setNotice?.("Spotify disconnected");
  }

  const np = user?.musicNowPlaying;

  return (
    <section className="panel single music-page">
      <header className="panel-head music-page-head">
        <h2>🎵 Music</h2>
        <p>
          Search Spotify and play{" "}
          <strong>30-second previews</strong> in the mini player while browsing SiglaCast. Spotify full playback usually
          needs Premium + Spotify&apos;s Web Playback SDK — previews work for catalogue tracks that expose a snippet.
        </p>
      </header>

      <div className="music-connection-card panel panel-nested">
        <h3>Spotify link &amp; bio status</h3>
        <p className="muted small">
          Link your Spotify, then toggle <strong>Show what I&apos;m listening to</strong> in Profile → Spotify activity.
          Friends then see whatever Spotify reports as “currently playing” while you browse — refreshed every ~22s here and
          on friends&apos; refreshes after your profile loads.
        </p>
        {user?.spotifyLinked ? (
          <div className="music-spotify-actions">
            <span className="pill pill-you">Spotify linked</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={connectBusy} onClick={() => void syncNow()}>
              Refresh Now Playing now
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void disconnect()}>
              Disconnect Spotify
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" disabled={connectBusy} onClick={() => void handleConnectSpotify()}>
            {connectBusy ? "Redirecting…" : "🔗 Connect Spotify account"}
          </button>
        )}

        {np?.title ? (
          <div className="music-now-playing-card">
            <p className="muted small">Latest sync recorded for your account (shows on friends&apos; bios only while playing).</p>
            <div className="music-np-inner">
              {np.imageUrl ? <img src={np.imageUrl} alt="" className="music-np-cover" decoding="async" /> : null}
              <div>
                <strong>{np.title}</strong>
                <div className="muted small">{np.artist}</div>
                {np.previewUrl ? (
                  <span className="muted small music-np-snippet-note">Snippet exists — tap “Play preview” below.</span>
                ) : null}
              </div>
              {np.externalUrl ? (
                <a className="btn btn-secondary btn-sm" href={np.externalUrl} target="_blank" rel="noopener noreferrer">
                  Open in Spotify
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <label className="field-label music-search-label">Find a track</label>
      <input
        className="music-search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Artist or song title…"
        aria-label="Search Spotify"
      />

      <p className="muted small">
        {searchBusy ? "Searching…" : q.trim().length < 2 ? "Keep typing…" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
      </p>

      <ul className="music-search-results">
        {hits.map((t) => (
          <li key={t.spotifyTrackId} className="music-hit-row">
            {t.imageUrl ? (
              <img className="music-hit-cover" src={t.imageUrl} alt="" decoding="async" />
            ) : (
              <div className="music-hit-cover-ph" aria-hidden />
            )}
            <div className="music-hit-main">
              <strong>{t.title}</strong>
              <span className="muted small">{t.artist}</span>
              {!t.previewUrl ? (
                <span className="music-hit-no-snippet muted small">No preview snippet in Spotify catalogue</span>
              ) : null}
            </div>
            <button type="button" className="btn btn-primary btn-sm" disabled={!t.previewUrl} onClick={() => playPreview(t)}>
              Play preview
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
