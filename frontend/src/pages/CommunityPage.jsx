import { useRef, useState } from "react";
import { mediaUrl } from "../services/api.js";

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

      {posts.map((post) => (
        <article key={post.id} className="tile post-card">
          <div className="post-header">
            {post.authorAvatar ? (
              <img className="post-avatar" src={mediaUrl(post.authorAvatar)} alt="" />
            ) : (
              <div className="post-avatar placeholder">{post.author?.charAt(0) || "?"}</div>
            )}
            <div>
              <strong className="author">{post.author}</strong>
              <div className="post-meta">Campus post</div>
            </div>
          </div>
          {post.content ? <p className="post-body">{post.content}</p> : null}
          {post.imageUrl ? (
            <img className="post-image" src={mediaUrl(post.imageUrl)} alt="" />
          ) : null}
          <div className="post-actions">
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${post.reactedByMe ? "reacted" : ""}`}
              onClick={() => onReact(post.id)}
            >
              {post.reactedByMe ? "❤️" : "🤍"} {post.reactionCount || 0}
            </button>
            {(isAdmin || post.authorId === currentUser?.id) && onDeletePost ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onDeletePost(post)}
              >
                🗑️ Delete
              </button>
            ) : null}
          </div>
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
      ))}
    </section>
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
