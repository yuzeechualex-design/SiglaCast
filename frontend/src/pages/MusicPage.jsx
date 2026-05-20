import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import { useMusicPlayer } from "../components/MusicPlayerContext.jsx";

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

function friendPresenceDotClass(presence) {
  const p = presence || "offline";
  const map = {
    online: "presence-dot presence-online",
    idle: "presence-dot presence-idle",
    dnd: "presence-dot presence-dnd",
    invisible: "presence-dot presence-invisible",
    offline: "presence-dot presence-offline"
  };
  return map[p] || map.offline;
}

function peerSnippetAsTrack(snippet) {
  if (!snippet?.title && !snippet?.spotifyTrackId) return null;
  return {
    spotifyTrackId: snippet.spotifyTrackId,
    title: snippet.title,
    artist: snippet.artist,
    imageUrl: snippet.imageUrl,
    externalUrl: snippet.externalUrl,
    previewUrl: snippet.previewUrl
  };
}

function buildListenTogetherDm(headline, myLine, peerLine) {
  const parts = [headline, "", myLine];
  if (peerLine) parts.push("", peerLine);
  parts.push(
    "",
    "Tip — Spotify Premium: Playing bar ⋮ → “Start a Jam” syncs playback in real time.",
    "",
    "— SiglaCast Music"
  );
  return parts.join("\n");
}

/**
 * Friends listening hub + Spotify OAuth / sync (no Spotify Web catalogue search UI).
 */
export default function MusicPage({ api, apiForm, token, user, setNotice, refreshUser, onOpenDmWithUser }) {
  const navigate = useNavigate();
  const location = useLocation();

  const { track: playingTrack, paused, playPreview, stopPlayback, togglePause, progress } = useMusicPlayer();

  const [filterTab, setFilterTab] = useState("all");
  const [friends, setFriends] = useState([]);
  const [friendsBusy, setFriendsBusy] = useState(false);
  const [friendsErr, setFriendsErr] = useState("");

  const [connectBusy, setConnectBusy] = useState(false);
  const [detailTrack, setDetailTrack] = useState(null);
  const [inviteTargetId, setInviteTargetId] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add("music-spotify-hub-open");
    return () => document.body.classList.remove("music-spotify-hub-open");
  }, []);

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

  const loadFriendsListening = useCallback(async () => {
    if (!token) return;
    setFriendsBusy(true);
    try {
      const data = await api("/music/friends-listening");
      if (data?.error) {
        setFriendsErr(typeof data.error === "string" ? data.error : "Could not load friends.");
        setFriends([]);
        return;
      }
      setFriendsErr("");
      const list = Array.isArray(data?.friends) ? data.friends : [];
      setFriends(list);
      setInviteTargetId((prev) => {
        if (prev && list.some((f) => f.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    } finally {
      setFriendsBusy(false);
    }
  }, [token, api]);

  useEffect(() => {
    void loadFriendsListening();
  }, [loadFriendsListening]);

  useEffect(() => {
    if (!token) return undefined;
    const iv = window.setInterval(() => void loadFriendsListening(), 25_000);
    return () => window.clearInterval(iv);
  }, [token, loadFriendsListening]);

  useEffect(() => {
    if (!playingTrack?.spotifyTrackId) return;
    setDetailTrack((prev) => {
      if (prev?.spotifyTrackId === playingTrack.spotifyTrackId) return prev;
      return playingTrack;
    });
  }, [playingTrack?.spotifyTrackId, playingTrack]);

  const syncNow = useCallback(async () => {
    if (!token) return;
    const res = await api("/music/spotify/sync-now-playing", { method: "POST", body: {} });
    if (res?.error) {
      setNotice?.(typeof res.error === "string" ? res.error : "Could not sync Spotify");
      return;
    }
    await refreshUser?.();
    void loadFriendsListening();
    setNotice?.("Synced from Spotify.");
  }, [api, token, setNotice, refreshUser, loadFriendsListening]);

  useEffect(() => {
    if (!token || !user?.spotifyLinked || !user?.musicShareNowPlaying) return undefined;

    async function ping() {
      await api("/music/spotify/sync-now-playing", { method: "POST", body: {} });
      await refreshUser?.();
      void loadFriendsListening();
    }

    void ping();
    const iv = window.setInterval(() => void ping(), 22_000);
    return () => window.clearInterval(iv);
  }, [token, user?.spotifyLinked, user?.musicShareNowPlaying, api, refreshUser, loadFriendsListening]);

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
  const myPlaybackUrl = detailTrack?.externalUrl || playingTrack?.externalUrl || np?.externalUrl || null;
  const myPlaybackTitle = detailTrack?.title || playingTrack?.title || np?.title || "";

  async function sendDm(peerId, text) {
    if (!peerId || !apiForm) {
      setNotice?.("Messaging is unavailable right now.");
      return;
    }
    const fd = new FormData();
    fd.append("text", text.trim());
    const res = await apiForm(`/messages/with/${peerId}`, fd);
    if (res?.error) {
      setNotice?.(typeof res.error === "string" ? res.error : "Could not send message.");
      return;
    }
    setNotice?.("Message sent.");
    if (typeof onOpenDmWithUser === "function") await onOpenDmWithUser(peerId);
    else navigate("/messages");
  }

  async function handleRequestTogether(friend) {
    const name = String(friend?.name || "there").trim() || "there";
    const peer = friend.musicNowPlaying;
    const peerUrl = peer?.externalUrl || null;
    const peerTitle = peer ? `${peer.title}${peer.artist ? ` · ${peer.artist}` : ""}` : null;

    const myLine =
      myPlaybackUrl ?
        `I’m listening to «${myPlaybackTitle || "a track"}» — ${myPlaybackUrl}`
      : "Sync “Now Playing” in SiglaCast after you start something on Spotify — I couldn’t attach my Open link yet.";

    let peerLine = "";
    if (peerUrl) peerLine = `You’re broadcasting «${peerTitle}» — ${peerUrl}`;
    else if (peerTitle)
      peerLine = `Caught you sharing «${peerTitle}», but Spotify didn’t return an Open URL for it yet.`;

    const text = buildListenTogetherDm(`🎧 ${name}, want to listen together?`, myLine, peerLine || undefined);
    await sendDm(friend.id, text);
  }

  async function handleInviteFromPanel() {
    if (!inviteTargetId) {
      setNotice?.("Pick a friend to invite.");
      return;
    }
    const buddy = friends.find((f) => f.id === inviteTargetId);
    const namePart = String(buddy?.name || "").trim();
    const label = namePart ? `${namePart}!` : "";
    const myLine =
      myPlaybackUrl ?
        `Listen with me — here’s what I’m on: ${myPlaybackUrl}`
      : "(No Spotify deep link synced yet — start playback on Spotify then tap Sync Now Playing, then resend.)";

    setInviteBusy(true);
    try {
      const greeting = label ? `🎧 Hey ${label} Listen together when you’re free.` : `🎧 Want to listen together?`;
      const text = buildListenTogetherDm(greeting, myLine, undefined);
      await sendDm(inviteTargetId, text);
    } finally {
      setInviteBusy(false);
    }
  }

  const filteredFriends = useMemo(() => {
    if (filterTab === "live") return friends.filter((f) => Boolean(f.musicNowPlaying));
    return friends;
  }, [friends, filterTab]);

  const syncedAsTrack = useMemo(() => peerSnippetAsTrack(np), [np]);

  /** Prefer a picked row; fall back to your synced session; lastly any preview-track from the footer */
  const focusTrack = detailTrack || syncedAsTrack || playingTrack || null;

  const eyebrow =
    detailTrack?.spotifyTrackId && syncedAsTrack?.spotifyTrackId && detailTrack.spotifyTrackId === syncedAsTrack.spotifyTrackId ?
      "Synced from Spotify app"
    : detailTrack ?
      "From a friend broadcast"
    : syncedAsTrack ?
      "Synced from Spotify app"
    : playingTrack ?
      "Preview focus"
    : "";

  function onFriendRowActivate(friend) {
    const t = peerSnippetAsTrack(friend.musicNowPlaying);
    if (t) setDetailTrack(t);
    else setDetailTrack(null);
    setInviteTargetId(friend.id);
  }

  const pct = progressPct(progress?.current ?? 0, progress?.duration ?? 0);

  const inviteControls =
    friends.length > 0 ? (
      <>
        <label className="music-hub-invite-select-label" htmlFor="music-invite-friend-select">
          Friend to DM
        </label>
        <select
          id="music-invite-friend-select"
          className="music-hub-invite-select"
          value={inviteTargetId}
          onChange={(e) => setInviteTargetId(e.target.value)}
        >
          <option value="">Choose…</option>
          {friends.map((fr) => (
            <option key={fr.id} value={fr.id}>
              {fr.name || fr.id.slice(0, 8)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="music-hub-invite-send"
          disabled={inviteBusy || !inviteTargetId}
          onClick={() => void handleInviteFromPanel()}
        >
          {inviteBusy ? "Sending…" : "Invite to listen"}
        </button>
      </>
    ) : (
      <p className="music-hub-muted small">Add friends in Messages — then you can send listen invites.</p>
    );

  return (
    <section className="music-spotify-shell single" aria-label="Music">
      <div className="music-hub-layout">
        <aside className="music-hub-sidebar">
          <div className="music-hub-brand">
            <span className="music-hub-logo-dot" aria-hidden />
            <div>
              <strong>Sigla Music</strong>
              <span className="music-hub-brand-sub">Friends &amp; Spotify status</span>
            </div>
          </div>

          <nav className="music-hub-nav-main">
            <button type="button" className="music-hub-nav-btn active">
              <span className="music-hub-nav-ico">⌂</span> Friends
            </button>
            <button type="button" className="music-hub-nav-btn" disabled title="Coming later">
              <span className="music-hub-nav-ico">♪</span> Discover
              <span className="music-hub-nav-soon-hint">soon</span>
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

        <div className="music-hub-main">
          <header className="music-hub-toolbar">
            <div className="music-hub-toolbar-nav">
              <button type="button" className="music-hub-circle-btn" title="Refresh" aria-label="Refresh friends" onClick={() => void loadFriendsListening()}>
                ⟳
              </button>
              <button type="button" className="music-hub-circle-btn muted" aria-label="No forward history" disabled>
                ›
              </button>
            </div>

            <div className="music-hub-toolbar-headline">
              <span className="music-hub-toolbar-eyebrow">Friends</span>
              <strong className="music-hub-toolbar-title">{friendsBusy ? "Updating…" : "Who’s listening"}</strong>
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

          <div className="music-hub-scroll">
            <div className="music-hub-filters">
              <button
                type="button"
                className={`music-hub-chip-filter${filterTab === "all" ? " active" : ""}`}
                onClick={() => setFilterTab("all")}
              >
                All friends
              </button>
              <button
                type="button"
                className={`music-hub-chip-filter${filterTab === "live" ? " active" : ""}`}
                onClick={() => setFilterTab("live")}
              >
                Listening now
              </button>
              <button type="button" className="music-hub-chip-filter disabled" disabled title="Coming later">
                Podcasts
              </button>
            </div>

            <div className="music-hub-home-hero">
              <h2 className="music-hub-section-title">Hang out around music</h2>
              <p className="music-hub-muted music-hub-intro-copy">
                Broadcasts appear when friends turn on Spotify sharing in Profile — then you can ping them here or DM a listen-together invite with links.
              </p>
            </div>

            {np?.title ? (
              <section className="music-hub-banner">
                <div className="music-hub-banner-visual">{np.imageUrl ? <img src={np.imageUrl} alt="" decoding="async" /> : null}</div>
                <div className="music-hub-banner-text">
                  <span className="music-hub-banner-eyebrow">Your Spotify session</span>
                  <strong className="music-hub-banner-title">{np.title}</strong>
                  <p className="music-hub-muted">{np.artist}</p>
                  {np.externalUrl ? (
                    <a className="music-hub-banner-open-btn" href={np.externalUrl} target="_blank" rel="noopener noreferrer">
                      Open in Spotify ↗
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            {friendsErr ? <p className="music-hub-muted music-hub-friends-err">{friendsErr}</p> : null}

            {!friends.length && !friendsBusy && !friendsErr ? (
              <p className="music-hub-muted music-hub-empty">
                No friends yet. Add people under <Link to="/messages">Messages</Link> — broadcasts show once they enable sharing.
              </p>
            ) : null}

            {filteredFriends.length ? (
              <section className="music-hub-friends-shelf">
                <h3 className="music-hub-shelf-title">Friends</h3>
                <ul className="music-hub-friends-list">
                  {filteredFriends.map((f) => {
                    const m = f.musicNowPlaying;
                    const canListen = Boolean(m?.externalUrl);
                    return (
                      <li key={f.id} className="music-hub-friend-row">
                        <button type="button" className="music-hub-friend-main" onClick={() => onFriendRowActivate(f)}>
                          <div className="music-hub-friend-avatar-wrap">
                            {f.avatarUrl ? (
                              <img className="music-hub-friend-avatar" src={mediaUrl(f.avatarUrl)} alt="" decoding="async" />
                            ) : (
                              <span className="music-hub-friend-avatar-ph" aria-hidden>
                                {(f.name || "?").charAt(0)}
                              </span>
                            )}
                            <span className={friendPresenceDotClass(f.presence)} title={f.presence} aria-hidden />
                          </div>
                          <div className="music-hub-friend-meta">
                            <strong className="music-hub-friend-name">{f.name || "Friend"}</strong>
                            <span className="music-hub-friend-artist">
                              {m?.title ? `${m.title}${m.artist ? ` · ${m.artist}` : ""}` : "Not broadcasting"}
                            </span>
                          </div>
                        </button>
                        <div className="music-hub-friend-actions">
                          <button
                            type="button"
                            className="music-hub-friend-act music-hub-friend-act--outline"
                            disabled={!canListen}
                            onClick={() =>
                              canListen ? window.open(m.externalUrl, "_blank", "noopener,noreferrer") : undefined}
                          >
                            Listen
                          </button>
                          <button type="button" className="music-hub-friend-act music-hub-friend-act--solid" onClick={() => void handleRequestTogether(f)}>
                            Request listen together
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : (
              friends.length > 0 && (
                <p className="music-hub-muted music-hub-empty">Nobody is broadcasting Spotify right now. Try switching to All friends.</p>
              )
            )}
          </div>
        </div>

        <aside className="music-hub-now-playing">
          <p className="music-hub-np-heading">Song details</p>
          {focusTrack?.title ? (
            <>
              <div className="music-hub-np-art">
                {focusTrack.imageUrl ? <img src={focusTrack.imageUrl} alt="" decoding="async" /> : <div className="music-hub-np-art-ph" />}
              </div>
              {eyebrow ? <span className="music-hub-banner-eyebrow">{eyebrow}</span> : null}
              <h3 className="music-hub-np-title">{focusTrack.title}</h3>
              <p className="music-hub-np-artist">{focusTrack.artist}</p>

              {syncedAsTrack?.spotifyTrackId &&
              focusTrack?.spotifyTrackId &&
              syncedAsTrack.spotifyTrackId === focusTrack.spotifyTrackId &&
              np?.isPlaying === false ? (
                <p className="music-hub-muted fine-print">Idle / paused inside Spotify.</p>
              ) : null}

              {focusTrack.externalUrl ? (
                <a
                  className="music-hub-banner-open-btn music-hub-banner-open-btn--compact"
                  href={focusTrack.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open track in Spotify ↗
                </a>
              ) : (
                <p className="music-hub-muted fine-print">No Open link surfaced for this item.</p>
              )}

              {focusTrack.previewUrl ? (
                <button type="button" className="music-hub-np-bigplay" onClick={() => playPreview(focusTrack)}>
                  ▶ Play preview
                </button>
              ) : (
                <p className="music-hub-muted small">No 30‑second catalogue preview.</p>
              )}

              <div className="music-hub-np-about">
                <strong className="music-hub-about-title">Preview note</strong>
                <span className="music-hub-muted small music-hub-about-body">
                  SiglaCast can play short excerpts when Spotify exposes them — full uninterrupted playback stays in Spotify.
                </span>
              </div>
            </>
          ) : (
            <p className="music-hub-muted small music-hub-placeholder-line">Tap a broadcasting friend or sync Spotify so this panel fills in.</p>
          )}

          <div className="music-hub-invite-block">
            <p className="music-hub-invite-heading">Invite to listen</p>
            <p className="music-hub-muted fine-print music-hub-invite-help">
              Opens or focuses your DM thread with Spotify links plus a Spotify Jam reminder for Premium.
            </p>
            {inviteControls}
          </div>
        </aside>
      </div>

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
              <button type="button" className="music-hub-ft-play-pause" aria-label={paused ? "Play" : "Pause"} onClick={togglePause}>
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
