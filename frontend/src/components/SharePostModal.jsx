import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { mediaUrl } from "../services/api.js";
import EmojiPickerButton from "./EmojiPickerButton.jsx";
import MentionInput from "./MentionInput.jsx";

export default function SharePostModal({ post, currentUser, liteMode = false, submitting = false, onClose, onSubmit }) {
  const [caption, setCaption] = useState("");

  useEffect(() => {
    setCaption("");
  }, [post?.id]);

  if (!post || typeof document === "undefined") return null;

  const source = post.sharedPost || post;

  async function submit(e) {
    e.preventDefault();
    await onSubmit?.(caption);
  }

  const content = (
    <div className="modal-backdrop modal-backdrop--portal share-modal-backdrop" onClick={onClose} role="presentation">
      <form className="modal-card share-modal-card" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head share-modal-head">
          <div>
            <h3>Share Post</h3>
            <p>Post this to Community with your caption.</p>
          </div>
          <button type="button" className="modal-close share-modal-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </div>

        <div className="share-modal-body">
          <div className="share-modal-author">
            {currentUser?.avatarUrl ? (
              <img src={mediaUrl(currentUser.avatarUrl)} alt="" />
            ) : (
              <span>{currentUser?.name?.charAt(0) || "?"}</span>
            )}
            <div>
              <strong>{currentUser?.name || "You"}</strong>
              <small>Sharing to Community</small>
            </div>
          </div>

          <MentionInput
            as="textarea"
            rows={4}
            value={caption}
            onChange={setCaption}
            placeholder="Say something about this post..."
            autoFocus
          />

          <div className="share-modal-toolbar">
            <EmojiPickerButton onPick={(emoji) => setCaption((text) => text + emoji)} />
          </div>

          <article className="share-preview-card">
            <div className="share-preview-author">
              {source.authorAvatar ? (
                <img src={mediaUrl(source.authorAvatar)} alt="" />
              ) : (
                <span>{source.author?.charAt(0) || "?"}</span>
              )}
              <div>
                <strong>{source.author || "Unknown"}</strong>
                <small>Original post</small>
              </div>
            </div>
            {source.content ? <p>{source.content}</p> : null}
            {source.imageUrl && !liteMode ? (
              <img className="share-preview-image" src={mediaUrl(source.imageUrl)} alt="" loading="lazy" />
            ) : null}
          </article>
        </div>

        <div className="share-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            <span className="share-glyph" aria-hidden="true">➦</span>
            <span>{submitting ? "Sharing..." : "Share"}</span>
          </button>
        </div>
      </form>
    </div>
  );

  return createPortal(content, document.body);
}
