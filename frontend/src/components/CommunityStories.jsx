import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl, request, requestForm } from "../services/api.js";
import ModalPortal from "./ModalPortal.jsx";

function truncateName(name, max = 10) {
  const s = String(name || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function StoryPresenceDot({ presence, isOnline }) {
  const cls =
    presence === "online"
      ? "story-presence-dot story-presence-dot--online"
      : presence === "idle"
        ? "story-presence-dot story-presence-dot--idle"
        : presence === "dnd"
          ? "story-presence-dot story-presence-dot--dnd"
          : isOnline
            ? "story-presence-dot story-presence-dot--online"
            : "story-presence-dot story-presence-dot--offline";
  return <span className={cls} title={presence || "offline"} aria-hidden />;
}

/**
 * Horizontal stories rail (+ add, friend rings with gradient / seen ring, scroll arrows).
 */
export default function CommunityStoriesRail({ token, currentUser }) {
  const [rings, setRings] = useState([]);
  const [loading, setLoading] = useState(false);
  const scrollerRef = useRef(null);

  const loadStories = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await request("/stories", { token });
      if (!data.error && Array.isArray(data.rings)) setRings(data.rings);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  const scrollStrip = useCallback((dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    const delta = dir * Math.min(320, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  const [createOpen, setCreateOpen] = useState(false);
  /** `{ ringIndex, storyIndex }` while viewing */
  const [viewer, setViewer] = useState(null);

  const openRing = useCallback((ringIndex, storyIndex = 0) => {
    const ring = rings[ringIndex];
    if (!ring?.stories?.length) return;
    const idx = Math.max(0, Math.min(storyIndex, ring.stories.length - 1));
    setViewer({ ringIndex, storyIndex: idx });
  }, [rings]);

  return (
    <div className="community-stories-rail">
      <div className="community-stories-head">
        <h3 className="community-stories-title">Stories</h3>
        {loading ? <span className="muted small stories-loading-label">Updating…</span> : null}
      </div>

      <div className="community-stories-scroll-wrap">
        <button
          type="button"
          className="community-stories-scroll-btn community-stories-scroll-btn--prev"
          aria-label="Scroll stories left"
          onClick={() => scrollStrip(-1)}
        >
          ‹
        </button>

        <div className="community-stories-strip" ref={scrollerRef}>
          <div className="story-ring-slot story-ring-slot--add">
            <button
              type="button"
              className="story-add-btn"
              title="New story"
              aria-label="Add story"
              onClick={() => setCreateOpen(true)}
            >
              <span className="story-add-plus">＋</span>
              <span className="story-add-label">New</span>
            </button>
          </div>

          {rings.map((ring, ri) => (
            <div key={ring.user.id} className="story-ring-slot">
              <button
                type="button"
                className={`story-ring-outer ${ring.hasUnviewed ? "story-ring-outer--fresh" : "story-ring-outer--seen"}`}
                onClick={() => openRing(ri, 0)}
                aria-label={`${ring.user.name}'s stories`}
              >
                <span className="story-ring-inner">
                  {ring.user.avatarUrl ? (
                    <img className="story-ring-avatar" src={mediaUrl(ring.user.avatarUrl)} alt="" decoding="async" />
                  ) : (
                    <span className="story-ring-placeholder">{ring.user.name?.charAt(0) || "?"}</span>
                  )}
                  <StoryPresenceDot presence={ring.user.presence} isOnline={ring.user.isOnline} />
                </span>
              </button>
              <span className="story-ring-caption" title={ring.user.name}>
                {ring.user.id === currentUser?.id ? "Your story" : truncateName(ring.user.name)}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="community-stories-scroll-btn community-stories-scroll-btn--next"
          aria-label="Scroll stories right"
          onClick={() => scrollStrip(1)}
        >
          ›
        </button>
      </div>

      {createOpen ? (
        <CreateStoryModal
          token={token}
          onClose={() => setCreateOpen(false)}
          onPosted={() => {
            setCreateOpen(false);
            loadStories();
          }}
        />
      ) : null}

      {viewer ? (
        <StoryViewerModal
          token={token}
          rings={rings}
          currentUser={currentUser}
          ringIndex={viewer.ringIndex}
          storyIndex={viewer.storyIndex}
          onClose={() => setViewer(null)}
          onFinished={() => {
            setViewer(null);
            loadStories();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateStoryModal({ token, onClose, onPosted }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const preview = file ? URL.createObjectURL(file) : null;
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t && !file) {
      setErr("Add text or a photo.");
      return;
    }
    setSending(true);
    setErr("");
    const fd = new FormData();
    fd.append("text", t);
    if (file) fd.append("image", file);
    const data = await requestForm("/stories", { token, method: "POST", formData: fd });
    setSending(false);
    if (data.error) {
      setErr(typeof data.error === "string" ? data.error : "Could not post story.");
      return;
    }
    onPosted?.();
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card stories-create-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>New story</h3>
            <button type="button" className="modal-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <form className="modal-body stories-create-form" onSubmit={submit}>
            <p className="muted small">Stories disappear after 24 hours. Friends can view them.</p>
            <textarea
              className="stories-create-textarea"
              rows={4}
              placeholder="Say something…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label className="btn btn-secondary btn-sm stories-photo-pick">
              📷 Add photo
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            {preview ? (
              <div className="stories-create-preview">
                <img src={preview} alt="" />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>
                  Remove photo
                </button>
              </div>
            ) : null}
            {err ? <p className="small stories-create-error">{err}</p> : null}
            <div className="stories-create-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={sending}>
                {sending ? "Posting…" : "Share story"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function StoryViewerModal({
  token,
  rings,
  currentUser,
  ringIndex: initialRi,
  storyIndex: initialSi,
  onClose,
  onFinished
}) {
  const [{ ri, si }, setPos] = useState({ ri: initialRi, si: initialSi });

  useEffect(() => {
    setPos({ ri: initialRi, si: initialSi });
  }, [initialRi, initialSi]);

  const ring = rings[ri];
  const story = ring?.stories?.[si];
  const authorId = ring?.user?.id;

  useEffect(() => {
    if (!story?.id || !authorId || authorId === currentUser?.id || !token) return undefined;
    let cancelled = false;
    (async () => {
      await request(`/stories/${encodeURIComponent(story.id)}/view`, { token, method: "POST", body: {} });
      if (!cancelled) {
        /* ignore errors — UX still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [story?.id, authorId, currentUser?.id, token]);

  const go = useCallback(
    (delta) => {
      setPos(({ ri: cri, si: csi }) => {
        const r = rings[cri];
        if (!r) {
          setTimeout(() => onClose?.(), 0);
          return { ri: cri, si: csi };
        }
        let nextSi = csi + delta;
        let nextRi = cri;

        if (delta > 0 && nextSi >= r.stories.length) {
          nextRi += 1;
          nextSi = 0;
          if (nextRi >= rings.length) {
            setTimeout(() => onFinished?.(), 0);
            return { ri: cri, si: csi };
          }
        } else if (delta < 0 && nextSi < 0) {
          nextRi -= 1;
          if (nextRi < 0) {
            setTimeout(() => onClose?.(), 0);
            return { ri: cri, si: csi };
          }
          nextSi = Math.max(0, (rings[nextRi]?.stories?.length || 1) - 1);
        }

        return { ri: nextRi, si: nextSi };
      });
    },
    [rings, onClose, onFinished]
  );

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  if (!ring || !story) return null;

  const imgSrc = story.imageUrl ? mediaUrl(story.imageUrl) : null;

  return (
    <ModalPortal>
      <div className="story-viewer-root" role="dialog" aria-modal="true" aria-label="Story viewer">
        <button type="button" className="story-viewer-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <header className="story-viewer-header">
          {ring.user.avatarUrl ? (
            <img className="story-viewer-avatar" src={mediaUrl(ring.user.avatarUrl)} alt="" />
          ) : (
            <span className="story-viewer-avatar-ph">{ring.user.name?.charAt(0)}</span>
          )}
          <div className="story-viewer-meta">
            <strong>{ring.user.name}</strong>
            <small>{story.createdAt ? new Date(story.createdAt).toLocaleString() : ""}</small>
          </div>
        </header>

        <div className="story-viewer-progress">
          {ring.stories.map((s, i) => (
            <span key={s.id} className={`story-viewer-progress-seg ${i === si ? "active" : ""}`} />
          ))}
        </div>

        <button
          type="button"
          className="story-viewer-nav-btn story-viewer-nav-btn--prev"
          aria-label="Previous story"
          onClick={() => go(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="story-viewer-nav-btn story-viewer-nav-btn--next"
          aria-label="Next story"
          onClick={() => go(1)}
        >
          ›
        </button>

        <div className="story-viewer-body">
          {imgSrc ? (
            <img className="story-viewer-media" src={imgSrc} alt="" decoding="async" />
          ) : (
            <div className="story-viewer-text-only">
              <p>{story.text || ""}</p>
            </div>
          )}
          {imgSrc && story.text ? (
            <div className="story-viewer-caption">
              <p>{story.text}</p>
            </div>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
