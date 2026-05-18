import { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../services/api.js";

const REACTIONS = [
  { type: "like", emoji: "👍", label: "Like", color: "#2563eb" },
  { type: "love", emoji: "❤️", label: "Love", color: "#e11d48" },
  { type: "haha", emoji: "😂", label: "Haha", color: "#f59e0b" },
  { type: "wow",  emoji: "😮", label: "Wow",  color: "#f59e0b" },
  { type: "sad",  emoji: "😢", label: "Sad",  color: "#0ea5e9" },
  { type: "angry", emoji: "😡", label: "Angry", color: "#dc2626" }
];

const REACTION_MAP = REACTIONS.reduce((acc, r) => {
  acc[r.type] = r;
  return acc;
}, {});

const TRUNCATE_LIMIT = 280;

export default function CommunityPage({ posts, currentUser, onPost, onReact, onComment, onDeletePost }) {
  const isAdmin = currentUser?.role === "admin";
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  function pickImage() {
    fileInputRef.current?.click();
  }

  function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setImageFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  async function handlePublish() {
    await onPost({ content, imageFile });
    setContent("");
    clearImage();
  }

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>💬 Community Feed</h2>
        <p>Share updates, photos, and reactions with campus users.</p>
      </div>
      <div className="composer community-composer">
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What is on your mind?" />
        {previewUrl ? (
          <div className="image-preview-wrap">
            <img className="image-preview" src={previewUrl} alt="Preview" />
            <button type="button" className="btn btn-ghost btn-sm" onClick={clearImage}>Remove image</button>
          </div>
        ) : null}
        <div className="composer-toolbar">
          <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={onFileChange} />
          <button type="button" className="btn btn-icon" title="Add image" onClick={pickImage}>＋</button>
          <button type="button" className="btn btn-primary" onClick={handlePublish}>📤 Publish</button>
        </div>
      </div>

      {posts.map((post) => {
        const canDelete = isAdmin || post.authorId === currentUser?.id;
        return (
          <article key={post.id} className="tile post-card">
            <div className="post-header">
              {post.authorAvatar ? (
                <img className="post-avatar" src={mediaUrl(post.authorAvatar)} alt="" />
              ) : (
                <div className="post-avatar placeholder">{post.author?.charAt(0) || "?"}</div>
              )}
              <div className="post-header-meta">
                <strong className="author">{post.author}</strong>
                <div className="post-meta">Campus post</div>
              </div>
              {canDelete && onDeletePost ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm post-delete-btn"
                  onClick={() => onDeletePost(post)}
                  title="Delete post"
                >
                  🗑️
                </button>
              ) : null}
            </div>

            {post.content ? <PostText text={post.content} /> : null}
            {post.imageUrl ? (
              <img className="post-image" src={mediaUrl(post.imageUrl)} alt="" />
            ) : null}

            <ReactionsRow post={post} onReact={onReact} />

            <div className="comments-block">
              <ul className="comment-list">
                {(post.comments || []).map((c) => (
                  <li key={c.id} className="comment-item">
                    <strong>{c.author}</strong> {c.text}
                  </li>
                ))}
              </ul>
              <CommentBox postId={post.id} onComment={onComment} currentUser={currentUser} />
            </div>
          </article>
        );
      })}
    </section>
  );
}

// Expandable post body. Posts longer than TRUNCATE_LIMIT chars are clamped
// with a "See more…" toggle. Toggling re-expands without re-fetching.
function PostText({ text }) {
  const [expanded, setExpanded] = useState(false);
  const tooLong = text.length > TRUNCATE_LIMIT;
  const displayed = expanded || !tooLong ? text : text.slice(0, TRUNCATE_LIMIT).trimEnd() + "…";
  return (
    <p className={`post-body ${expanded || !tooLong ? "" : "post-body-clamped"}`}>
      {displayed}
      {tooLong ? (
        <>
          {" "}
          <button
            type="button"
            className="see-more-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "See less" : "See more…"}
          </button>
        </>
      ) : null}
    </p>
  );
}

// Facebook-style reactions bar. Hovering the trigger reveals a floating picker
// with six animated emoji buttons. Click picks; clicking the active emoji
// removes it; clicking a different emoji switches the reaction.
function ReactionsRow({ post, onReact }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closeTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function openPicker() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPickerOpen(true);
  }
  function deferClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPickerOpen(false), 220);
  }

  const myReaction = post.myReaction ? REACTION_MAP[post.myReaction] : null;
  const triggerEmoji = myReaction ? myReaction.emoji : "👍";
  const triggerLabel = myReaction ? myReaction.label : "Like";
  const triggerColor = myReaction ? myReaction.color : undefined;

  const breakdown = post.reactionBreakdown || {};
  const topReactions = REACTIONS
    .filter((r) => breakdown[r.type])
    .sort((a, b) => (breakdown[b.type] || 0) - (breakdown[a.type] || 0))
    .slice(0, 3);

  async function handlePick(type) {
    setPickerOpen(false);
    await onReact(post.id, type);
  }

  async function handleTriggerClick() {
    setPickerOpen(false);
    // Click on trigger: if no reaction yet, set "like"; otherwise remove current
    await onReact(post.id, post.myReaction ? null : "like");
  }

  return (
    <div className="post-actions">
      <div
        className="reaction-host"
        onMouseEnter={openPicker}
        onMouseLeave={deferClose}
      >
        <button
          type="button"
          className={`btn btn-ghost btn-sm reaction-trigger ${myReaction ? "reacted" : ""}`}
          onClick={handleTriggerClick}
          style={myReaction ? { color: triggerColor } : undefined}
        >
          <span className="reaction-trigger-emoji">{triggerEmoji}</span>
          <span className="reaction-trigger-label">{triggerLabel}</span>
        </button>

        {pickerOpen ? (
          <div
            className="reaction-picker"
            onMouseEnter={openPicker}
            onMouseLeave={deferClose}
          >
            {REACTIONS.map((r, idx) => (
              <button
                key={r.type}
                type="button"
                className={`reaction-emoji-btn ${post.myReaction === r.type ? "is-active" : ""}`}
                style={{ animationDelay: `${idx * 40}ms` }}
                title={r.label}
                onClick={() => handlePick(r.type)}
              >
                <span className="reaction-emoji">{r.emoji}</span>
                <span className="reaction-tooltip">{r.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="reaction-summary">
        {topReactions.map((r) => (
          <span key={r.type} className="reaction-summary-emoji" title={`${breakdown[r.type]} ${r.label}`}>
            {r.emoji}
          </span>
        ))}
        {post.reactionCount > 0 ? (
          <span className="reaction-count">{post.reactionCount}</span>
        ) : null}
      </div>
    </div>
  );
}

function CommentBox({ postId, onComment, currentUser }) {
  const [text, setText] = useState("");
  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    await onComment(postId, t);
    setText("");
  }
  return (
    <form className="comment-form" onSubmit={submit}>
      <input value={text} placeholder={`Comment as ${currentUser.name}…`} onChange={(e) => setText(e.target.value)} />
      <button type="submit" className="btn btn-secondary btn-sm">💬 Comment</button>
    </form>
  );
}
