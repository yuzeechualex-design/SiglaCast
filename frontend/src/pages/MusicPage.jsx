import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { request } from "../services/api.js";
import { useMusicPlayer } from "../components/MusicPlayerContext.jsx";

const LAST_HITS_KEY = "siglacast_music_last_hits";

/** @returns {number} clamped pct 0–100 */
function progressPct(current, duration) {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (current / duration) * 100));
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Spotify-inspired Music hub — search + preview playback (Premium Web Playback SDK optional later).
 */
export default function MusicPage({ api, token, user, setNotice, refreshUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const searchInputRef = useRef(null);

  const { track: playingTrack, paused, playPreview, stopPlayback, togglePause, progress } = useMusicPlayer();

  const [navTab, setNavTab] = useState("home");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [detailTrack, setDetailTrack] = useState(null);
  const [lastShelf, setLastShelf] = useState(() => {
    try {
      const raw = sessionStorage.getItem(LAST_HITS_KEY);
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 24) : [];
    } catch {
      return [];
    }
  });

  /** Full-player layout: hide global mini bar while on this hub. */
  useEffect(() => {
    document.body.classList.add("music-spotify-hub-open");
    return () => document.body.classList.remove("music-spotify-hub-open");
  }, []);

  /** OAuth landing cleanup */
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const s = p.get("spotify");
    if (!s) return undefined;
    if (s === "connected") setNotice?.("Spotify linked. Enable sharing under Profile → Spotify.");
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
        try {
          sessionStorage.setItem(LAST_HITS_KEY, JSON.stringify(data.tracks.slice(0, 24)));
          setLastShelf(data.tracks.slice(0, 12));
        } catch {
          /* ignore */
        }
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [q, token]);

  /** Keep detail panel loosely in sync when playing starts */
  useEffect(() => {
    if (!playingTrack?.spotifyTrackId) return;
    setDetailTrack((prev) => {
      if (prev?.spotifyTrackId === playingTrack.spotifyTrackId) return prev;
      return playingTrack;
    });
  }, [playingTrack?.spotifyTrackId, playingTrack]);

  useEffect(() => {
    if (navTab === "search") searchInputRef.current?.focus();
  }, [navTab]);

  const syncNow = useCallback(async () => {
    if (!token) return;
    const res = await api("/music/spotify/sync-now-playing", { method: "POST", body: {} });
    if (res?.error) {
      setNotice?.(typeof res.error === "string" ? res.error : "Could not sync Spotify");
      return;
    }
    await refreshUser?.();
    setNotice?.("Synced from Spotify.");
  }, [api, token, setNotice, refreshUser]);

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
    if (!token || !window.confirm("Disconnect Spotify from SiglaCast?")) return;
    stopPlayback();
    const data = await api("/music/spotify", { method: "DELETE" });
    if (data?.error) {
      setNotice?.(typeof data.error === "string" ? data.error : "Could not disconnect.");
      return;
    }
    await refreshUser?.();
    setNotice?.("Spotify disconnected");
  }

  const np = user?.musicNowPlaying;

  const showGrid =
    hits.length > 0 && q.trim().length >= 2
      ? hits
      : navTab === "home" && lastShelf.length && q.trim().length < 2
        ? lastShelf
        : [];

  const subtitle = useMemo(() => {
    if (searchBusy && q.trim().length >= 2) return "Searching Spotify…";
    if (hits.length && q.trim().length >= 2) return `${hits.length} tracks`;
    if (showGrid.length && navTab === "home") return "Recently discovered";
    return "Start searching for songs & artists";
  }, [searchBusy, q, hits.length, showGrid.length, navTab]);

  const pct = progressPct(progress?.current ?? 0, progress?.duration ?? 0);

  /** Current track displayed in sidebar / detail */
  const focusTrack = detailTrack || playingTrack;

  function onPickTrack(t, play = false) {
    setDetailTrack(t);
    if (play && t.previewUrl) playPreview(t);
  }

  return (
    <section className="music-spotify-shell single" aria-label="Music">
      <div className="music-hub-layout">
        {/* ---- Left sidebar (Spotify-like) ---- */}
        <aside className="music-hub-sidebar">
          <div className="music-hub-brand">
            <span className="music-hub-logo-dot" aria-hidden />
            <div>
              <strong>Sigla Music</strong>
              <span className="music-hub-brand-sub">Spotify previews in SiglaCast</span>
            </div>
          </div>

          <nav className="music-hub-nav-main">
            <button
              type="button"
              className={`music-hub-nav-btn${navTab === "home" ? " active" : ""}`}
              onClick={() => setNavTab("home")}
            >
              <span className="music-hub-nav-ico">⌂</span> Home
            </button>
            <button
              type="button"
              className={`music-hub-nav-btn${navTab === "search" ? " active" : ""}`}
              onClick={() => setNavTab("search")}
            >
              <span className="music-hub-nav-ico">⌕</span> Search
            </button>
          </nav>

          <div className="music-hub-divider" />

          <div className="music-hub-library-h">
            <span className="music-hub-library-title">Your library</span>
            <button type="button" className="music-hub-library-add" title="Coming soon" disabled>
              +
            </button>
          </div>
          <div className="music-hub-library-body">
            {user?.spotifyLinked ? (
              <div className="music-hub-chip connected">
                <span className="music-hub-chip-dot">●</span> Spotify linked
              </div>
            ) : (
              <button
                type="button"
                className="music-hub-link-mini"
                disabled={connectBusy}
                onClick={() => void handleConnectSpotify()}
              >
                Link Spotify account →
              </button>
            )}
            {user?.spotifyLinked ? (
              <>
                <button type="button" className="music-hub-mini-action" disabled={connectBusy} onClick={() => void syncNow()}>
                  Sync Now Playing
                </button>
                <button type="button" className="music-hub-mini-action ghost" onClick={() => void disconnect()}>
                  Disconnect
                </button>
              </>
            ) : null}
          </div>

          <Link to="/profile" className="music-hub-foot-link">
            Profile &amp; bio status →
          </Link>
        </aside>

        {/* ---- Main column ---- */}
        <div className="music-hub-main">
          {/* Top toolbar */}
          <header className="music-hub-toolbar">
            <div className="music-hub-toolbar-nav">
              <button type="button" className="music-hub-circle-btn" title="Home" aria-label="Home" disabled>
                ‹
              </button>
              <button type="button" className="music-hub-circle-btn" title="Forward" aria-label="Forward" disabled>
                ›
              </button>
            </div>

            <div className="music-hub-search-wrap">
              <label className="music-hub-search-label" htmlFor="music-hub-search-q">
                <span className="music-hub-search-ico">⌕</span>
              </label>
              <input
                id="music-hub-search-q"
                ref={searchInputRef}
                type="search"
                className="music-hub-search"
                placeholder="What do you want to play?"
                value={q}
                onFocus={() => setNavTab("search")}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="music-hub-toolbar-right">
              {user?.spotifyLinked ? (
                <span className="music-hub-pill-premium">Synced</span>
              ) : (
                <button
                  type="button"
                  className="music-hub-pill-connect"
                  disabled={connectBusy}
                  onClick={() => void handleConnectSpotify()}
                >
                  Link Spotify
                </button>
              )}
            </div>
          </header>

          {/* Content */}
          <div className="music-hub-scroll">
            <div className="music-hub-filters">
              <button
                type="button"
                className={`music-hub-chip-filter${navTab === "home" ? " active" : ""}`}
                onClick={() => setNavTab("home")}
              >
                All
              </button>
              <button
                type="button"
                className={`music-hub-chip-filter${navTab === "search" ? " active" : ""}`}
                onClick={() => setNavTab("search")}
              >
                Music
              </button>
              <button type="button" className="music-hub-chip-filter disabled" disabled title="Coming soon">
                Podcasts
              </button>
            </div>

            {navTab === "home" ? (
              <div className="music-hub-home-hero">
                <h2 className="music-hub-section-title">{subtitle}</h2>
                <p className="music-hub-muted">
                  Play catalogue <strong>30-second previews</strong> here — full uninterrupted playback needs Spotify Premium +
                  Web Playback SDK (optional upgrade later).
                </p>
              </div>
            ) : (
              <div className="music-hub-home-hero">
                <h2 className="music-hub-section-title">Search Spotify</h2>
                <p className="music-hub-muted">{subtitle}</p>
              </div>
            )}

            {np?.title && navTab === "home" ? (
              <section className="music-hub-banner">
                <div className="music-hub-banner-visual">
                  {np.imageUrl ? <img src={np.imageUrl} alt="" decoding="async" /> : null}
                </div>
                <div className="music-hub-banner-text">
                  <span className="music-hub-banner-eyebrow">From your Spotify • profile sharing</span>
                  <strong className="music-hub-banner-title">{np.title}</strong>
                  <p className="music-hub-muted">{np.artist}</p>
                  {np.externalUrl ? (
                    <a className="music-hub-banner-btn" href={np.externalUrl} target="_blank" rel="noopener noreferrer">
                      Open in Spotify ↗
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            {showGrid.length ? (
              <section className="music-hub-shelf">
                <h3 className="music-hub-shelf-title">
                  {q.trim().length >= 2 ? "Tracks" : "Jump back in"}
                </h3>
                <div className="music-hub-card-grid">
                  {showGrid.map((t) => (
                    <article key={t.spotifyTrackId} className="music-hub-card-wrap">
                      <div
                        className={`music-hub-card ${detailTrack?.spotifyTrackId === t.spotifyTrackId ? "picked" : ""}`}
                        onClick={() => onPickTrack(t, false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onPickTrack(t, false);
                          }
                        }}
                        tabIndex={0}
                        aria-label={`${t.title} by ${t.artist}`}
                      >
                        <div className="music-hub-card-cover-slot">
                          {t.imageUrl ? (
                            <img src={t.imageUrl} alt="" className="music-hub-card-cover" decoding="async" loading="lazy" />
                          ) : (
                            <span className="music-hub-card-ph" aria-hidden />
                          )}
                          {t.previewUrl ? (
                            <button
                              type="button"
                              className="music-hub-card-play-spotify"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPickTrack(t, true);
                              }}
                              aria-label={`Play preview: ${t.title}`}
                            >
                              ▶
                            </button>
                          ) : (
                            <span className="music-hub-card-lock" title="No preview on Spotify">
                              —
                            </span>
                          )}
                        </div>
                        <strong className="music-hub-card-title">{t.title}</strong>
                        <span className="music-hub-card-artist">{t.artist}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : navTab === "search" && q.trim().length >= 2 && !searchBusy ? (
              <p className="music-hub-muted music-hub-empty">No tracks matched. Try another search.</p>
            ) : null}
          </div>
        </div>

        {/* ---- Right panel: now picking / synced ---- */}
        <aside className="music-hub-now-playing">
          <p className="music-hub-np-heading">Song details</p>
          {focusTrack ? (
            <>
              <div className="music-hub-np-art">
                {focusTrack.imageUrl ? (
                  <img src={focusTrack.imageUrl} alt="" decoding="async" />
                ) : (
                  <div className="music-hub-np-art-ph" />
                )}
              </div>
              <h3 className="music-hub-np-title">{focusTrack.title}</h3>
              <p className="music-hub-np-artist">{focusTrack.artist}</p>
              {focusTrack.externalUrl ? (
                <a className="music-hub-banner-btn slim" href={focusTrack.externalUrl} target="_blank" rel="noopener noreferrer">
                  Open track in Spotify ↗
                </a>
              ) : null}
              {focusTrack.previewUrl ? (
                <button type="button" className="music-hub-np-bigplay" onClick={() => playPreview(focusTrack)}>
                  ▶ Play preview
                </button>
              ) : (
                <p className="music-hub-muted small">No snippet for this catalogue entry.</p>
              )}
              <div className="music-hub-np-about">
                <strong>Sigla preview</strong>
                <span className="music-hub-muted small">
                  Streams a short excerpt from Spotify for listening while browsing — not full-length playback unless we add Premium Web Playback SDK.
                </span>
              </div>
            </>
          ) : np?.title ? (
            <>
              <div className="music-hub-np-art">
                {np.imageUrl ? <img src={np.imageUrl} alt="" decoding="async" /> : <div className="music-hub-np-art-ph" />}
              </div>
              <span className="music-hub-banner-eyebrow">Synced from Spotify app</span>
              <h3 className="music-hub-np-title">{np.title}</h3>
              <p className="music-hub-np-artist">{np.artist}</p>
              {np.isPlaying === false ? <p className="music-hub-muted small">Idle / paused in Spotify.</p> : null}
            </>
          ) : (
            <p className="music-hub-muted small">Pick a track from the grid or link Spotify to sync your session.</p>
          )}
        </aside>
      </div>

      {/* Bottom player — Spotify-like (previews only) */}
      <footer className={`music-hub-footer${playingTrack?.previewUrl ? " visible" : ""}`}>
        <div className="music-hub-footer-inner">
          <div className="music-hub-ft-left">
            {playingTrack?.imageUrl ? (
              <img className="music-hub-ft-thumb" src={playingTrack.imageUrl} alt="" decoding="async" />
            ) : (
              <div className="music-hub-ft-thumb-ph" />
            )}
            <div className="music-hub-ft-meta">
              <strong>{playingTrack?.title}</strong>
              <span>{playingTrack?.artist}</span>
              {playingTrack?.externalUrl ? (
                <a href={playingTrack.externalUrl} target="_blank" rel="noopener noreferrer" className="music-hub-ft-out">
                  ↗ Spotify
                </a>
              ) : null}
            </div>
          </div>

          <div className="music-hub-ft-center">
            <div className="music-hub-ft-buttons">
              <button type="button" className="music-hub-ft-ico muted" aria-label="Shuffle" disabled>
                ⇄
              </button>
              <button type="button" className="music-hub-ft-ico muted" aria-label="Previous" disabled>
                ⏮
              </button>
              <button
                type="button"
                className="music-hub-ft-play-pause"
                aria-label={paused ? "Play" : "Pause"}
                onClick={togglePause}
              >
                {paused ? "▶" : "⏸"}
              </button>
              <button type="button" className="music-hub-ft-ico muted" aria-label="Next" disabled>
                ⏭
              </button>
              <button type="button" className="music-hub-ft-ico muted" aria-label="Repeat" disabled>
                🔁
              </button>
            </div>
            <div className="music-hub-ft-progress-row">
              <span className="music-hub-ft-time">{formatTime(progress?.current ?? 0)}</span>
              <div className="music-hub-ft-bar" aria-hidden>
                <span className="music-hub-ft-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="music-hub-ft-time">{formatTime(progress?.duration ?? 0)}</span>
            </div>
          </div>

          <div className="music-hub-ft-right">
            <button type="button" className="music-hub-ft-stop" aria-label="Stop playback" onClick={() => stopPlayback()}>
              Stop
            </button>
          </div>
        </div>
      </footer>
    </section>
  );
}
