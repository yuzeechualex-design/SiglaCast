import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** @typedef {{ spotifyTrackId?: string, title?: string, artist?: string, imageUrl?: string | null, externalUrl?: string | null, previewUrl?: string | null }} SpotifyLikeTrack */

const MusicPlayerContext = createContext(null);

export function MusicPlayerProvider({ children }) {
  /** @type {React.RefObject<HTMLAudioElement>} */
  const audioRef = useRef(null);
  /** @type {[SpotifyLikeTrack | null, import("react").Dispatch<React.SetStateAction<SpotifyLikeTrack | null>>]} */
  const [track, setTrack] = useState(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ current: 0, duration: 0 });

  const playPreview = useCallback((t) => {
    const next = {
      spotifyTrackId: t.spotifyTrackId,
      title: t.title,
      artist: t.artist,
      imageUrl: t.imageUrl ?? null,
      externalUrl: t.externalUrl ?? null,
      previewUrl: t.previewUrl ?? null
    };
    if (!next.previewUrl) {
      console.warn("[music] Track has no 30-second preview URL from Spotify.");
    }
    setTrack(next);
    setPaused(false);
  }, []);

  const stopPlayback = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch (_) {
        /* ignore */
      }
    }
    setTrack(null);
    setPaused(false);
    setProgress({ current: 0, duration: 0 });
  }, []);

  const togglePause = useCallback(() => {
    const a = audioRef.current;
    if (!a || !track?.previewUrl) return;
    if (paused) {
      a.play().catch(() => {});
      setPaused(false);
    } else {
      a.pause();
      setPaused(true);
    }
  }, [paused, track?.previewUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !track?.previewUrl) {
      setProgress({ current: 0, duration: 0 });
      return undefined;
    }
    function sync() {
      setProgress({
        current: Number.isFinite(a.currentTime) ? a.currentTime : 0,
        duration: Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0
      });
    }
    a.addEventListener("timeupdate", sync);
    a.addEventListener("loadedmetadata", sync);
    a.addEventListener("durationchange", sync);
    sync();
    return () => {
      a.removeEventListener("timeupdate", sync);
      a.removeEventListener("loadedmetadata", sync);
      a.removeEventListener("durationchange", sync);
    };
  }, [track?.previewUrl]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!track?.previewUrl) {
      document.body.classList.remove("music-mini-player-open");
      return undefined;
    }
    document.body.classList.add("music-mini-player-open");
    return () => document.body.classList.remove("music-mini-player-open");
  }, [track?.previewUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !track?.previewUrl) return undefined;

    try {
      a.src = track.previewUrl;
      a.volume = 0.92;
      a.play().catch(() => {
        setPaused(true);
      });
    } catch (_) {
      setPaused(true);
    }

    function onEnded() {
      setPaused(true);
    }
    function onPlay() {
      setPaused(false);
    }
    a.addEventListener("ended", onEnded);
    a.addEventListener("play", onPlay);
    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("play", onPlay);
    };
  }, [track?.previewUrl]);

  /** @type {import("react").ContextType<typeof MusicPlayerContext>} */
  const value = useMemo(
    () => ({
      track,
      paused,
      playPreview,
      stopPlayback,
      togglePause,
      miniPlayerDismiss: stopPlayback,
      hiddenAudioRef: audioRef,
      progress
    }),
    [track, paused, progress, playPreview, stopPlayback, togglePause]
  );

  return (
    <MusicPlayerContext.Provider value={value}>
      <audio ref={audioRef} className="sr-only music-global-audio" preload="none" aria-hidden />
      {children}
      {track?.previewUrl ? (
        <div className="music-mini-player-bar" aria-label="Mini music player">
          {track.imageUrl ? <img src={track.imageUrl} alt="" className="music-mini-art" decoding="async" /> : null}
          <div className="music-mini-meta">
            <strong className="music-mini-title">{track.title || "Track"}</strong>
            <span className="music-mini-artist muted">{track.artist}</span>
            <span className="muted small music-mini-note">30s Spotify preview • keep this tab audible</span>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={togglePause}>
            {paused ? "Play" : "Pause"}
          </button>
          {track.externalUrl ? (
            <a className="btn btn-ghost btn-sm" href={track.externalUrl} target="_blank" rel="noreferrer noopener">
              Spotify
            </a>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={stopPlayback}>
            ✕ Stop
          </button>
        </div>
      ) : null}
    </MusicPlayerContext.Provider>
  );
}

/** @returns {import("react").ContextType<typeof MusicPlayerContext>} */
export function useMusicPlayer() {
  const ctx = useContext(MusicPlayerContext);
  if (!ctx) throw new Error("useMusicPlayer must be used within MusicPlayerProvider");
  return ctx;
}
