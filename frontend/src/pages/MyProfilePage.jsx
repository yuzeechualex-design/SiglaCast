import { useState } from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import EmojiPickerButton from "../components/EmojiPickerButton.jsx";
import MentionInput from "../components/MentionInput.jsx";
import ReactionActorsModal from "../components/ReactionActorsModal.jsx";
import { PostCardBody, REACTIONS } from "./CommunityPage.jsx";
import { publicUrlLooksLikeGif } from "../utils/imageUrlKind.js";
import { listeningStatusLine } from "../utils/displayStatus.js";

function formatCount(n, singular, plural = `${singular}s`) {
  const value = Number(n) || 0;
  return `${value} ${value === 1 ? singular : plural}`;
}

function availabilityLabel(raw) {
  const v = String(raw || "online").toLowerCase();
  if (v === "dnd") return "Do Not Disturb";
  if (v === "idle") return "Idle";
  if (v === "invisible") return "Invisible";
  return "Online";
}

function dateLabel(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function ProfileComposer({ user, avatarSrc, onPost, onGeneratePost }) {
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
  }

  async function submit(e) {
    e.preventDefault();
    if (!content.trim() && !imageFile) return;
    await onPost?.({ content, imageFile });
    setContent("");
    clearImage();
  }

  return (
    <form className="my-profile-composer-card profile-inline-composer" onSubmit={submit}>
      <div className="my-profile-composer-line">
        {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{user.name?.charAt(0) || "?"}</span>}
        <MentionInput
          as="textarea"
          rows={2}
          value={content}
          onChange={setContent}
          placeholder="What's on your mind?"
        />
      </div>
      {previewUrl ? (
        <div className="image-preview-wrap">
          <img className="image-preview" src={previewUrl} alt="Preview" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearImage}>Remove image</button>
        </div>
      ) : null}
      <div className="composer-toolbar profile-composer-toolbar">
        <label className="btn btn-icon" title="Add image">
          <span className="ui-icon ui-icon-image" aria-hidden="true" />
          <input type="file" accept="image/*" hidden onChange={onFileChange} />
        </label>
        <EmojiPickerButton onPick={(emoji) => setContent((text) => text + emoji)} />
        {onGeneratePost ? (
          <button type="button" className="btn btn-secondary" onClick={() => onGeneratePost?.()}>
            Generate a post
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!content.trim() && !imageFile}>
          <span className="ui-icon ui-icon-send" aria-hidden="true" />
          <span>Publish</span>
        </button>
      </div>
    </form>
  );
}

export default function MyProfilePage({
  user,
  posts = [],
  characters = [],
  currentUser = user,
  liteMode = false,
  isOwnProfile = true,
  backHref = "",
  onPost,
  onGenerateCharacterPost,
  onToggleCharacter,
  onReact,
  onComment,
  onReactComment,
  onDeleteComment,
  onDeletePost,
  onShare,
  onOpenUserProfile
}) {
  const [profileMode, setProfileMode] = useState("profile");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const selectedCharacter =
    isOwnProfile && profileMode === "characters"
      ? characters.find((c) => c.id === selectedCharacterId) || characters[0] || null
      : null;
  const displayUser = selectedCharacter || user;
  const avatarSrc = displayUser.avatarUrl ? mediaUrl(displayUser.avatarUrl) : null;
  const coverSrc = displayUser.coverUrl ? mediaUrl(displayUser.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);
  const myPosts = posts.filter((post) => post.authorId === displayUser.id);
  const statusLine = [displayUser.statusEmoji, displayUser.statusNote].filter(Boolean).join(" ");
  const musicLine = displayUser.isAiCharacter ? "" : listeningStatusLine(displayUser);
  const [rxModal, setRxModal] = useState({ open: false, path: "", title: "" });
  const isCharacterProfile = Boolean(displayUser.isAiCharacter);
  const characterRoles = displayUser.roles || displayUser.aiRoles || "";
  const characterBackground = displayUser.background || displayUser.aiBackground || "";
  const canCompose = isOwnProfile;

  return (
    <section className="my-profile-page">
      {isOwnProfile ? (
        <div className="my-profile-owner-switch" role="tablist" aria-label="Profile view">
          <button
            type="button"
            className={profileMode === "profile" ? "active" : ""}
            onClick={() => setProfileMode("profile")}
          >
            Your profile
          </button>
          <button
            type="button"
            className={profileMode === "characters" ? "active" : ""}
            onClick={() => {
              setProfileMode("characters");
              if (!selectedCharacterId && characters[0]?.id) setSelectedCharacterId(characters[0].id);
            }}
          >
            Your characters
          </button>
        </div>
      ) : null}

      {isOwnProfile && profileMode === "characters" ? (
        <div className="my-profile-character-strip">
          {characters.length ? characters.map((character) => (
            <button
              type="button"
              key={character.id}
              className={(selectedCharacter?.id || characters[0]?.id) === character.id ? "active" : ""}
              onClick={() => setSelectedCharacterId(character.id)}
            >
              {character.avatarUrl ? <img src={mediaUrl(character.avatarUrl)} alt="" /> : <span>{character.name?.charAt(0) || "AI"}</span>}
              <strong>{character.name}</strong>
            </button>
          )) : (
            <Link to="/characters" className="my-profile-character-create">Create your first AI character</Link>
          )}
        </div>
      ) : null}

      <div className="my-profile-hero-card">
        <div className="my-profile-cover">
          {coverSrc && !liteMode ? (
            coverIsGif ? (
              <img src={coverSrc} alt="" className="my-profile-cover-gif" />
            ) : (
              <div className="my-profile-cover-img" style={{ backgroundImage: `url(${coverSrc})` }} />
            )
          ) : (
            <div className="my-profile-cover-fallback" />
          )}
          {isOwnProfile ? (
            <Link
              to={isCharacterProfile ? `/characters/${encodeURIComponent(displayUser.id)}/edit` : "/settings"}
              className="my-profile-cover-edit"
            >
              {isCharacterProfile ? "Manage character" : "Edit profile"}
            </Link>
          ) : null}
        </div>

        <div className="my-profile-identity">
          <div className="my-profile-avatar-wrap">
            {avatarSrc ? (
              <img className="my-profile-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className="my-profile-avatar my-profile-avatar--empty">{displayUser.name?.charAt(0) || "?"}</span>
            )}
          </div>
          <div className="my-profile-name-block">
            <h2>{displayUser.name}</h2>
            <p>{isCharacterProfile ? "AI Character" : displayUser.email}</p>
            <div className="my-profile-pills">
              <span className={`my-profile-presence my-profile-presence--${displayUser.availability || "online"}`}>
                {isCharacterProfile ? "AI Character" : availabilityLabel(displayUser.availability)}
              </span>
              {statusLine ? <span>{statusLine}</span> : null}
              {isCharacterProfile && characterRoles ? <span>{characterRoles}</span> : null}
              {musicLine ? <span>{musicLine}</span> : null}
            </div>
          </div>
        </div>

        <nav className="my-profile-tabs" aria-label="Profile sections">
          <a href="#profile-posts" className="active">Posts</a>
          <a href="#profile-about">About</a>
          <a href="#profile-status">Status</a>
        </nav>
      </div>

      <div className="my-profile-grid">
        <aside className="my-profile-about-card" id="profile-about">
          <h3>Intro</h3>
          {displayUser.bio ? <p className="my-profile-bio">{displayUser.bio}</p> : <p className="muted small">No bio yet.</p>}
          <div className="my-profile-info-list">
            <span>{isCharacterProfile ? "AI Character" : displayUser.role === "admin" ? "Administrator" : "Student"}</span>
            <span>{isCharacterProfile ? "Generated identity" : availabilityLabel(displayUser.availability)}</span>
            {statusLine ? <span id="profile-status">{statusLine}</span> : null}
            {musicLine ? <span>{musicLine}</span> : null}
          </div>
          {isCharacterProfile && characterBackground ? (
            <p className="my-profile-bio my-profile-character-lore">{characterBackground}</p>
          ) : null}
          {isCharacterProfile ? (
            <div className="my-profile-character-controls">
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(displayUser.autoPost)}
                  onChange={(e) => onToggleCharacter?.(displayUser.id, { autoPost: e.target.checked })}
                />
                <span>Generate posts</span>
              </label>
              <label className="ai-character-mini-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(displayUser.autoReply)}
                  onChange={(e) => onToggleCharacter?.(displayUser.id, { autoReply: e.target.checked })}
                />
                <span>Auto replies</span>
              </label>
              <button
                type="button"
                className="my-profile-edit-wide"
                onClick={() => onGenerateCharacterPost?.(displayUser)}
              >
                Generate a post
              </button>
            </div>
          ) : isOwnProfile ? <Link to="/settings" className="my-profile-edit-wide">Edit details</Link> : null}
        </aside>

        <main className="my-profile-posts" id="profile-posts">
          {backHref ? (
            <Link to={backHref} className="my-profile-back-link">
              ← Back to Community
            </Link>
          ) : null}
          {canCompose ? (
            <ProfileComposer
              user={displayUser}
              avatarSrc={avatarSrc}
              onPost={(payload) =>
                onPost?.({
                  ...payload,
                  characterId: isCharacterProfile ? displayUser.id : undefined
                })
              }
              onGeneratePost={isCharacterProfile ? () => onGenerateCharacterPost?.(displayUser) : null}
            />
          ) : null}

          <div className="my-profile-section-head">
            <h3>Posts</h3>
            <span>{formatCount(myPosts.length, "post")}</span>
          </div>

          {myPosts.length ? (
            myPosts.map((post) => (
              <article key={post.id} id={`post-${post.id}`} className="tile post-card my-profile-post-card">
                <PostCardBody
                  post={post}
                  canModerateDelete={
                    (currentUser?.role === "admin" || post.authorId === currentUser?.id || (isCharacterProfile && isOwnProfile)) &&
                    !!onDeletePost
                  }
                  forceExpandedBody={false}
                  currentUser={currentUser}
                  onDeletePost={() => onDeletePost?.(post)}
                  onReact={onReact}
                  onComment={onComment}
                  onReactComment={onReactComment}
                  onDeleteComment={onDeleteComment}
                  onShare={onShare}
                  onOpenUserProfile={onOpenUserProfile}
                  characters={characters}
                  openPostReactors={() =>
                    setRxModal({
                      open: true,
                      title: "Post reactions",
                      path: `/community/posts/${post.id}/reactors`
                    })}
                  openCommentReactors={(commentId) =>
                    setRxModal({
                      open: true,
                      title: "Comment reactions",
                      path: `/community/comments/${commentId}/reactors`
                    })}
                  liteMode={liteMode}
                />
              </article>
            ))
          ) : (
            <div className="my-profile-empty-posts">
              <strong>No posts yet</strong>
              <p className="muted small">
                {isOwnProfile
                  ? isCharacterProfile
                    ? "Write a post above or generate one with AI."
                    : "Share something in Community and it will show up here."
                  : "This user has not posted yet."}
              </p>
              {canCompose && !isCharacterProfile ? (
                <Link to="/community" className="btn btn-secondary btn-sm my-profile-create-post-btn">
                  Create post
                </Link>
              ) : null}
            </div>
          )}
        </main>
      </div>
      {rxModal.open ? (
        <ReactionActorsModal
          title={rxModal.title}
          path={rxModal.path}
          reactionTypes={REACTIONS}
          onClose={() => setRxModal({ open: false, path: "", title: "" })}
        />
      ) : null}
    </section>
  );
}
