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

function ProfileComposer({ user, avatarSrc, onPost }) {
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
  currentUser = user,
  liteMode = false,
  isOwnProfile = true,
  backHref = "",
  onPost,
  onReact,
  onComment,
  onReactComment,
  onDeleteComment,
  onDeletePost,
  onShare,
  onOpenUserProfile
}) {
  const avatarSrc = user.avatarUrl ? mediaUrl(user.avatarUrl) : null;
  const coverSrc = user.coverUrl ? mediaUrl(user.coverUrl) : null;
  const coverIsGif = coverSrc && publicUrlLooksLikeGif(coverSrc);
  const myPosts = posts.filter((post) => post.authorId === user.id);
  const statusLine = [user.statusEmoji, user.statusNote].filter(Boolean).join(" ");
  const musicLine = listeningStatusLine(user);
  const [rxModal, setRxModal] = useState({ open: false, path: "", title: "" });

  return (
    <section className="my-profile-page">
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
            <Link to="/settings" className="my-profile-cover-edit">
              Edit profile
            </Link>
          ) : null}
        </div>

        <div className="my-profile-identity">
          <div className="my-profile-avatar-wrap">
            {avatarSrc ? (
              <img className="my-profile-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className="my-profile-avatar my-profile-avatar--empty">{user.name?.charAt(0) || "?"}</span>
            )}
          </div>
          <div className="my-profile-name-block">
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <div className="my-profile-pills">
              <span className={`my-profile-presence my-profile-presence--${user.availability || "online"}`}>
                {availabilityLabel(user.availability)}
              </span>
              {statusLine ? <span>{statusLine}</span> : null}
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
          {user.bio ? <p className="my-profile-bio">{user.bio}</p> : <p className="muted small">No bio yet.</p>}
          <div className="my-profile-info-list">
            <span>{user.role === "admin" ? "Administrator" : "Student"}</span>
            <span>{availabilityLabel(user.availability)}</span>
            {statusLine ? <span id="profile-status">{statusLine}</span> : null}
            {musicLine ? <span>{musicLine}</span> : null}
          </div>
          {isOwnProfile ? <Link to="/settings" className="my-profile-edit-wide">Edit details</Link> : null}
        </aside>

        <main className="my-profile-posts" id="profile-posts">
          {backHref ? (
            <Link to={backHref} className="my-profile-back-link">
              ← Back to Community
            </Link>
          ) : null}
          {isOwnProfile ? (
            <ProfileComposer user={user} avatarSrc={avatarSrc} onPost={onPost} />
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
                  canModerateDelete={(currentUser?.role === "admin" || post.authorId === currentUser?.id) && !!onDeletePost}
                  forceExpandedBody={false}
                  currentUser={currentUser}
                  onDeletePost={() => onDeletePost?.(post)}
                  onReact={onReact}
                  onComment={onComment}
                  onReactComment={onReactComment}
                  onDeleteComment={onDeleteComment}
                  onShare={onShare}
                  onOpenUserProfile={onOpenUserProfile}
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
                {isOwnProfile ? "Share something in Community and it will show up here." : "This user has not posted yet."}
              </p>
              {isOwnProfile ? (
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
