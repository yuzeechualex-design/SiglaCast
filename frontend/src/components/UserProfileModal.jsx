import { useEffect, useState } from "react";
import ModalPortal from "./ModalPortal.jsx";
import { mediaUrl } from "../services/api.js";
import { publicUrlLooksLikeGif } from "../utils/imageUrlKind.js";
import { SIGLACAST_AI_USER_ID } from "../constants/sentinelUsers.js";

function presenceLabel(entity) {
  const raw =
    entity && typeof entity.presence === "string" ? entity.presence.trim().toLowerCase() : null;
  const normalized =
    raw === "idle" || raw === "dnd" || raw === "invisible" || raw === "online" || raw === "offline"
      ? raw
      : entity?.isOnline === true
        ? "online"
        : "offline";
  const titles = {
    online: "Online",
    idle: "Idle",
    dnd: "Do not disturb",
    invisible: "Invisible",
    offline: "Offline"
  };
  return titles[normalized] || titles.offline;
}

function presenceDotClass(entity) {
  const raw =
    entity && typeof entity.presence === "string" ? entity.presence.trim().toLowerCase() : null;
  const normalized =
    raw === "idle" || raw === "dnd" || raw === "invisible" || raw === "online" || raw === "offline"
      ? raw
      : entity?.isOnline === true
        ? "online"
        : "offline";
  const map = {
    online: "presence-online",
    idle: "presence-idle",
    dnd: "presence-dnd",
    invisible: "presence-invisible",
    offline: "presence-offline"
  };
  return `presence-dot ${map[normalized] || map.offline}`;
}

function StatusEmojiChip({ emoji }) {
  if (!emoji) return null;
  return <span className="status-emoji-pill">{emoji}</span>;
}

/**
 * Discord-style user card — opened from avatars in Community or Messages.
 * Loads `GET /api/users/:id` for presence, status, and friend flags.
 */
export default function UserProfileModal({
  peek,
  onClose,
  currentUser,
  api,
  navigate,
  onOpenDm,
  onAddFriend,
  onAcceptFriendRequest,
  onRejectFriendRequest
}) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [profilePosts, setProfilePosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const userId = peek?.userId;
  const prefetch = peek?.prefetch;

  useEffect(() => {
    if (!userId) return undefined;
    setDetailOpen(false);
    setProfilePosts([]);
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      const data = await api(`/users/${userId}`);
      if (cancelled) return;
      setLoading(false);
      if (data.error) {
        setError(data.error);
        setProfile(null);
      } else {
        setProfile(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, api]);

  async function refetchProfile() {
    if (!userId) return;
    const data = await api(`/users/${userId}`);
    if (!data.error) setProfile(data);
  }

  async function loadProfilePosts() {
    if (!userId) return;
    setDetailOpen(true);
    if (profilePosts.length || postsLoading) return;
    setPostsLoading(true);
    const rows = await api("/community/posts");
    setPostsLoading(false);
    if (Array.isArray(rows)) {
      setProfilePosts(rows.filter((post) => post.authorId === userId));
    }
  }

  useEffect(() => {
    if (!peek) return undefined;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek, onClose]);

  if (!peek || !userId || userId === SIGLACAST_AI_USER_ID) return null;

  const merged = profile
    ? profile
    : {
        id: userId,
        name: prefetch?.name,
        email: prefetch?.email,
        course: prefetch?.course,
        avatarUrl: prefetch?.avatarUrl ?? prefetch?.authorAvatar,
        coverUrl: prefetch?.coverUrl,
        statusEmoji: prefetch?.statusEmoji,
        statusNote: prefetch?.statusNote,
        bio: prefetch?.bio,
        presence: prefetch?.presence,
        isOnline: prefetch?.isOnline,
        isFriend: prefetch?.isFriend,
        incomingRequestId: prefetch?.incomingRequestId,
        outgoingRequestPending: prefetch?.outgoingRequestPending,
        musicNowPlaying: prefetch?.musicNowPlaying
      };

  const isSelf = currentUser?.id === userId;
  const avatarSrc = mediaUrl(merged.avatarUrl);
  const showPlaceholder = !merged.avatarUrl;
  const coverHref = merged.coverUrl ? mediaUrl(merged.coverUrl) : null;
  const coverIsGif = coverHref && publicUrlLooksLikeGif(coverHref);

  async function handleAddFriend() {
    if (!onAddFriend) return;
    setBusy(true);
    try {
      await onAddFriend(userId);
      await refetchProfile();
    } finally {
      setBusy(false);
    }
  }

  async function handleAccept() {
    const rid = merged.incomingRequestId;
    if (!rid || !onAcceptFriendRequest) return;
    setBusy(true);
    try {
      await onAcceptFriendRequest(rid);
      await refetchProfile();
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    const rid = merged.incomingRequestId;
    if (!rid || !onRejectFriendRequest) return;
    setBusy(true);
    try {
      await onRejectFriendRequest(rid);
      await refetchProfile();
    } finally {
      setBusy(false);
    }
  }

  async function handleMessage() {
    if (!onOpenDm) return;
    setBusy(true);
    try {
      await onOpenDm(userId);
    } finally {
      setBusy(false);
    }
  }

  function goEditProfile() {
    onClose?.();
    navigate?.("/settings");
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card user-profile-modal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close profile">
            ✕
          </button>

          <div className="user-profile-modal-layout">
            <div className="user-profile-modal-main">
              <div
                className={`user-profile-banner${merged.coverUrl ? " user-profile-banner-has-cover" : ""}${coverHref && coverIsGif ? " user-profile-banner--gif" : ""}`}
                {...(coverHref && !coverIsGif
                  ? {
                      style: {
                        backgroundImage: `url(${coverHref})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center center",
                        backgroundRepeat: "no-repeat"
                      }
                    }
                  : {})}
                aria-hidden
              >
                {coverHref && coverIsGif ? <img src={coverHref} alt="" className="user-profile-banner-gif" /> : null}
              </div>

              <div className="user-profile-avatar-block">
                <div className="user-profile-avatar-wrap">
                  <div className="user-profile-avatar-frame">
                    {showPlaceholder ? (
                      <div className="user-profile-avatar placeholder">{merged.name?.charAt(0) || "?"}</div>
                    ) : (
                      <img className="user-profile-avatar" src={avatarSrc} alt="" decoding="async" />
                    )}
                  </div>
                  <span
                    className={presenceDotClass(merged)}
                    title={presenceLabel(merged)}
                    aria-label={presenceLabel(merged)}
                  />
                </div>

                <div className="user-profile-name-block">
                  <h3 className="user-profile-display-name">
                    {loading && !merged.name ? "…" : merged.name || "User"}{" "}
                    <StatusEmojiChip emoji={merged.statusEmoji} />
                  </h3>
                  <p className="user-profile-presence-line muted">
                    <span>{presenceLabel(merged)}</span>
                    {merged.course ? (
                      <>
                        {" · "}
                        <span>{merged.course}</span>
                      </>
                    ) : null}
                  </p>
                  {merged.statusNote ? <p className="user-profile-custom-status">{merged.statusNote}</p> : null}
                  {merged.musicNowPlaying?.title ? (
                    <div className="profile-music-playing-card">
                      <div className="profile-music-playing-head muted small">
                        🎵 Now playing<span className="profile-music-spotify-pill">Spotify</span>
                      </div>
                      <div className="profile-music-playing-body">
                        {merged.musicNowPlaying.imageUrl ? (
                          <img
                            className="profile-music-playing-art"
                            src={merged.musicNowPlaying.imageUrl}
                            alt=""
                            decoding="async"
                          />
                        ) : (
                          <div className="profile-music-playing-art-ph" aria-hidden />
                        )}
                        <div className="profile-music-playing-column">
                          <div className="profile-music-playing-text">
                            <strong>{merged.musicNowPlaying.title}</strong>
                            {merged.musicNowPlaying.artist ? (
                              <span className="muted small">{merged.musicNowPlaying.artist}</span>
                            ) : null}
                          </div>
                          {merged.musicNowPlaying.externalUrl ? (
                            <a
                              className="profile-music-open-btn"
                              href={merged.musicNowPlaying.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Open in Spotify ↗
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {(merged.bio || "").trim() ? (
                    <div className="user-profile-bio-block">
                      <p className="user-profile-bio-heading muted small">About me</p>
                      <p className="user-profile-bio-text">{merged.bio.trim()}</p>
                    </div>
                  ) : null}
                  {!isSelf && merged.email ? (
                    <p className="user-profile-email muted small">{merged.email}</p>
                  ) : null}

                  {error ? <p className="form-error user-profile-fetch-err">{error}</p> : null}
                  {loading ? <p className="muted small user-profile-loading">Loading profile…</p> : null}
                </div>
              </div>
            </div>

            <aside className="user-profile-modal-aside">
              <p className="user-profile-aside-title">Quick actions</p>

              {isSelf ? (
                <button type="button" className="btn btn-primary btn-sm wide" onClick={goEditProfile}>
                  ⚙️ Edit profile
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm wide"
                    onClick={() => void loadProfilePosts()}
                    disabled={postsLoading}
                  >
                    View profile
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm wide"
                    onClick={() => void handleMessage()}
                    disabled={busy}
                  >
                    💬 Message
                  </button>

                  {merged.isFriend ? (
                    <span className="pill pill-you wide-pill">Friends</span>
                  ) : merged.incomingRequestId ? (
                    <div className="user-profile-friend-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void handleAccept()}
                      >
                        Accept request
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void handleDecline()}
                      >
                        Decline
                      </button>
                    </div>
                  ) : merged.outgoingRequestPending ? (
                    <span className="pill pill-muted small">Request sent</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm wide"
                      disabled={busy}
                      onClick={() => void handleAddFriend()}
                    >
                      👋 Request friend
                    </button>
                  )}
                </>
              )}
            </aside>
          </div>
          {detailOpen ? (
            <div className="user-profile-detail-panel">
              <div className="user-profile-detail-head">
                <h4>{isSelf ? "Your posts" : `${merged.name || "User"}'s posts`}</h4>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDetailOpen(false)}>
                  Hide
                </button>
              </div>
              {postsLoading ? (
                <p className="muted small">Loading posts...</p>
              ) : profilePosts.length ? (
                <div className="user-profile-post-list">
                  {profilePosts.map((post) => (
                    <article key={post.id} className="user-profile-post-preview">
                      <div className="user-profile-post-preview-head">
                        {post.authorAvatar ? (
                          <img src={mediaUrl(post.authorAvatar)} alt="" />
                        ) : (
                          <span>{post.author?.charAt(0) || "?"}</span>
                        )}
                        <div>
                          <strong>{post.author || merged.name || "User"}</strong>
                          <small className="muted">
                            {post.createdAt ? new Date(post.createdAt).toLocaleString() : "Campus post"}
                          </small>
                        </div>
                      </div>
                      {post.content ? <p className="user-profile-post-preview-text">{post.content}</p> : null}
                      {post.imageUrl ? (
                        <img className="user-profile-post-preview-img" src={mediaUrl(post.imageUrl)} alt="" loading="lazy" />
                      ) : null}
                      <div className="user-profile-post-preview-stats muted small">
                        <span>{post.reactionCount || 0} reactions</span>
                        <span>{post.commentCount || 0} comments</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted small">No posts yet.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </ModalPortal>
  );
}
