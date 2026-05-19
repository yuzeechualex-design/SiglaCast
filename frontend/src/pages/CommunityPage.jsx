import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import MentionInput from "../components/MentionInput.jsx";
import MentionText from "../components/MentionText.jsx";
import ReactionActorsModal from "../components/ReactionActorsModal.jsx";

/** Narrow layout: fullscreen post threads + tap targets (keep in sync with CSS). */
const COMMUNITY_MOBILE_MAX_PX = 720;

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

export default function CommunityPage({
  posts,
  currentUser,
  onPost,
  onReact,
  onReactComment,
  onComment,
  onDeletePost,
  onDeleteComment
}) {
  const isAdmin = currentUser?.role === "admin";
  const [params, setSearchParams] = useSearchParams();
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);
  const [rxModal, setRxModal] = useState({ open: false, path: "", title: "" });
  const [isCommunityNarrow, setIsCommunityNarrow] = useState(
    typeof window !== "undefined" ? window.matchMedia(`(max-width:${COMMUNITY_MOBILE_MAX_PX}px)`).matches : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(`(max-width: ${COMMUNITY_MOBILE_MAX_PX}px)`);
    const sync = () => setIsCommunityNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const mobileThreadParam = params.get("thread");

  /** Click/tap ignores interactive controls inside the feed card when opening fullscreen thread on mobile. */
  const tapIgnoresInteractive = useCallback((el) => {
    return Boolean(
      el.closest?.(
        "button, a, input, textarea, select, label, .mention-input-wrap, [contenteditable=\"true\"], .modal-backdrop"
      )
    );
  }, []);

  const openMobileThread = useCallback(
    (postId) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set("thread", postId);
          return n;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const closeMobileThread = useCallback(() => {
    setSearchParams(
      (prev) => {
        const pid = prev.get("thread");
        const next = new URLSearchParams(prev);
        next.delete("thread");
        requestAnimationFrame(() => {
          if (pid && document.getElementById(`post-${pid}`)) {
            document.getElementById(`post-${pid}`)?.scrollIntoView({ block: "start", behavior: "auto" });
          }
        });
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  useEffect(() => {
    const open = !!(isCommunityNarrow && mobileThreadParam);
    const root = typeof document !== "undefined" ? document.documentElement : null;
    const cls = "community-thread-overlay-open";
    if (!open) {
      document.body.classList.remove(cls);
      root?.classList.remove(cls);
      return undefined;
    }
    document.body.classList.add(cls);
    root?.classList.add(cls);
    return () => {
      document.body.classList.remove(cls);
      root?.classList.remove(cls);
    };
  }, [isCommunityNarrow, mobileThreadParam]);

  useEffect(() => {
    if (!isCommunityNarrow || !mobileThreadParam) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") closeMobileThread();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCommunityNarrow, mobileThreadParam, closeMobileThread]);

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

  const deeplinkQs = params.toString();
  useEffect(() => {
    if (!deeplinkQs) return undefined;
    const sp = new URLSearchParams(deeplinkQs);
    /** Fullscreen mobile thread replaces feed focus — skip conflicting scroll snaps. */
    if (sp.get("thread") && isCommunityNarrow) return undefined;
    const postId = sp.get("post");
    if (!postId) return undefined;

    let cancelled = false;
    const cid = sp.get("comment");
    const anchorId = cid ? `comment-${cid}` : `post-${postId}`;

    const t = window.setTimeout(() => {
      if (cancelled) return;
      const el = document.getElementById(anchorId);
      if (!el && anchorId.startsWith("comment-")) {
        document.getElementById(`post-${postId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("community-deep-link-highlight");
      window.setTimeout(() => el?.classList?.remove("community-deep-link-highlight"), 1500);
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [deeplinkQs, posts, isCommunityNarrow]);

  const overlayPost = mobileThreadParam ? posts.find((p) => p.id === mobileThreadParam) : null;

  function handleFeedPostTap(e, postId) {
    if (!isCommunityNarrow) return;
    if (tapIgnoresInteractive(e.target)) return;
    openMobileThread(postId);
  }

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>💬 Community Feed</h2>
        <p>Share updates, photos, and reactions with campus users.</p>
      </div>
      <div
        className={`composer community-composer${
          isCommunityNarrow && mobileThreadParam ? " community-composer--hidden-feed" : ""
        }`}
      >
        <MentionInput
          as="textarea"
          rows={3}
          value={content}
          onChange={setContent}
          placeholder="What is on your mind? Use @ to mention someone…"
        />
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
        /** Thread is duplicated in fullscreen overlay — keep one source of UI in the viewport. */
        if (isCommunityNarrow && mobileThreadParam && post.id === mobileThreadParam) return null;

        const canModerateDelete = isAdmin || post.authorId === currentUser?.id;
        return (
          <article
            key={post.id}
            id={`post-${post.id}`}
            className={`tile post-card${isCommunityNarrow ? " post-card-tappable" : ""}`}
            onClick={(e) => handleFeedPostTap(e, post.id)}
          >
            <PostCardBody
              post={post}
              canModerateDelete={canModerateDelete && !!onDeletePost}
              forceExpandedBody={false}
              currentUser={currentUser}
              onDeletePost={() => onDeletePost?.(post)}
              onReact={onReact}
              onComment={onComment}
              onReactComment={onReactComment}
              onDeleteComment={onDeleteComment}
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
            />
          </article>
        );
      })}
      {isCommunityNarrow && mobileThreadParam && typeof document !== "undefined"
        ? createPortal(
            <div
              className="community-thread-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="community-thread-heading"
            >
              <header className="community-thread-toolbar">
                <button type="button" className="btn btn-ghost btn-sm community-thread-back" onClick={closeMobileThread}>
                  ← Back
                </button>
                <h2 id="community-thread-heading" className="community-thread-title">
                  {overlayPost?.author ? `Post · ${overlayPost.author}` : "Post"}
                </h2>
              </header>
              <div className="community-thread-scroll">
                {overlayPost ? (
                  <article className="tile post-card community-thread-article" id={`thread-post-${overlayPost.id}`}>
                    <PostCardBody
                      post={overlayPost}
                      canModerateDelete={(isAdmin || overlayPost.authorId === currentUser?.id) && !!onDeletePost}
                      forceExpandedBody
                      currentUser={currentUser}
                      onDeletePost={() => onDeletePost?.(overlayPost)}
                      onReact={onReact}
                      onComment={onComment}
                      onReactComment={onReactComment}
                      onDeleteComment={onDeleteComment}
                      openPostReactors={() =>
                        setRxModal({
                          open: true,
                          title: "Post reactions",
                          path: `/community/posts/${overlayPost.id}/reactors`
                        })}
                      openCommentReactors={(commentId) =>
                        setRxModal({
                          open: true,
                          title: "Comment reactions",
                          path: `/community/comments/${commentId}/reactors`
                        })}
                    />
                  </article>
                ) : (
                  <p className="muted community-thread-missing">
                    Could not load this post. Tap <strong>← Back</strong> and pull to refresh the feed if it was removed.
                  </p>
                )}
              </div>
            </div>,
            document.body
          )
        : null}
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

/** Shared markup for feed cards and fullscreen mobile thread overlay (see `thread` URL param). */
function PostCardBody({
  post,
  canModerateDelete,
  forceExpandedBody,
  currentUser,
  onDeletePost,
  onReact,
  onComment,
  onReactComment,
  onDeleteComment,
  openPostReactors,
  openCommentReactors
}) {
  return (
    <>
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
        {canModerateDelete ? (
          <button
            type="button"
            className="btn btn-danger btn-sm post-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDeletePost?.();
            }}
            title="Delete post"
          >
            🗑️
          </button>
        ) : null}
      </div>

      {post.content ? <PostText text={post.content} forceExpanded={forceExpandedBody} /> : null}
      {post.imageUrl ? (
        <img className="post-image" src={mediaUrl(post.imageUrl)} alt="" decoding="async" loading="lazy" />
      ) : null}

      <ReactionsRow post={post} onReact={onReact} onShowReactors={openPostReactors} />

      <CommentsBlock
        post={post}
        currentUser={currentUser}
        onComment={onComment}
        onReactComment={onReactComment}
        onDeleteComment={onDeleteComment}
        onShowCommentReactors={openCommentReactors}
      />
    </>
  );
}

function CommentsBlock({ post, currentUser, onComment, onReactComment, onDeleteComment, onShowCommentReactors }) {
  const [replyingTo, setReplyingTo] = useState(null);
  const comments = post.comments || [];

  async function submitReply(parentId, payload) {
    await onComment(post.id, payload, parentId);
    setReplyingTo(null);
  }

  return (
    <div className="comments-block">
      {post.commentCount > 0 ? (
        <div className="comment-count-row">
          {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
        </div>
      ) : null}

      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment-thread">
            <CommentRow
              comment={c}
              isReply={false}
              onReplyClick={() => setReplyingTo(c.id === replyingTo ? null : c.id)}
              replying={replyingTo === c.id}
              currentUser={currentUser}
              onSubmitReply={(payload) => submitReply(c.id, payload)}
              onCancelReply={() => setReplyingTo(null)}
              onReactComment={onReactComment}
              onDeleteComment={onDeleteComment}
              onShowCommentReactors={onShowCommentReactors}
            />
            {c.replies?.length ? (
              <ul className="reply-list">
                {c.replies.map((r) => (
                  <li key={r.id} className="comment-reply">
                    <CommentRow
                      comment={r}
                      isReply
                      onReplyClick={() => setReplyingTo(r.id === replyingTo ? null : r.id)}
                      replying={replyingTo === r.id}
                      currentUser={currentUser}
                      onSubmitReply={(payload) => submitReply(r.id, payload)}
                      onCancelReply={() => setReplyingTo(null)}
                      onReactComment={onReactComment}
                      onDeleteComment={onDeleteComment}
                      onShowCommentReactors={onShowCommentReactors}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <CommentBox
        postId={post.id}
        onComment={(postId, payload) => onComment(postId, payload, null)}
        currentUser={currentUser}
      />
    </div>
  );
}

function CommentReactionsRow({ comment, onReact, onShowReactors }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closeTimer = useRef(null);
  useEffect(() => () => closeTimer.current && clearTimeout(closeTimer.current), []);

  const myReaction = comment.myReaction ? REACTION_MAP[comment.myReaction] : null;
  const breakdown = comment.reactionBreakdown || {};
  const topReactions = REACTIONS.filter((r) => breakdown[r.type])
    .sort((a, b) => (breakdown[b.type] || 0) - (breakdown[a.type] || 0))
    .slice(0, 3);
  const totalCount = comment.reactionCount || 0;

  function openPicker() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPickerOpen(true);
  }
  function deferClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPickerOpen(false), 200);
  }

  return (
    <div className="comment-reaction-row">
      <div className="comment-reaction-host" onMouseEnter={openPicker} onMouseLeave={deferClose}>
        <button
          type="button"
          className={`comment-reaction-trigger ${myReaction ? "reacted" : ""}`}
          onClick={() => onReact(comment.id, comment.myReaction ? null : "like")}
          style={myReaction ? { color: myReaction.color } : undefined}
          title="React"
        >
          <span>{myReaction ? myReaction.emoji : "👍"}</span>
          <span className="sr-only">React</span>
        </button>
        {pickerOpen ? (
          <div className="comment-reaction-picker" onMouseEnter={openPicker} onMouseLeave={deferClose}>
            {REACTIONS.map((r, idx) => (
              <button
                key={r.type}
                type="button"
                className={`reaction-emoji-btn sm ${comment.myReaction === r.type ? "is-active" : ""}`}
                style={{ animationDelay: `${idx * 30}ms` }}
                title={r.label}
                onClick={() => {
                  setPickerOpen(false);
                  onReact(comment.id, comment.myReaction === r.type ? null : r.type);
                }}
              >
                <span className="reaction-emoji">{r.emoji}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {totalCount > 0 ? (
        <div className="comment-reaction-summary">
          {topReactions.map((r) => (
            <span key={r.type}>{r.emoji}</span>
          ))}
          <span className="comment-reaction-count">{totalCount}</span>
        </div>
      ) : null}
      {totalCount > 0 ? (
        <button type="button" className="see-reactors-btn" onClick={() => onShowReactors(comment.id)}>
          See reactions
        </button>
      ) : null}
    </div>
  );
}

function CommentRow({
  comment,
  isReply,
  onReplyClick,
  replying,
  currentUser,
  onSubmitReply,
  onCancelReply,
  onReactComment,
  onDeleteComment,
  onShowCommentReactors
}) {
  const canDelete = currentUser?.role === "admin" || comment.userId === currentUser?.id;
  function handleDelete() {
    if (!onDeleteComment) return;
    if (window.confirm("Delete this comment? Any replies will also be removed.")) {
      onDeleteComment(comment);
    }
  }
  return (
    <div className={`comment-row ${isReply ? "is-reply" : ""}`} id={`comment-${comment.id}`}>
      {comment.authorAvatar ? (
        <img className="comment-avatar" src={mediaUrl(comment.authorAvatar)} alt="" />
      ) : (
        <div className="comment-avatar placeholder">{comment.author?.charAt(0) || "?"}</div>
      )}
      <div className="comment-body">
        <div className="comment-bubble">
          <strong>{comment.author}</strong>{" "}
          {comment.replyToAuthor ? (
            <span className="reply-mention">@{comment.replyToAuthor}</span>
          ) : null}{" "}
          {comment.text ? <MentionText text={comment.text} /> : null}
          {comment.imageUrl ? (
            <a
              href={mediaUrl(comment.imageUrl)}
              target="_blank"
              rel="noreferrer"
              className="comment-image-link"
            >
              <img className="comment-image" src={mediaUrl(comment.imageUrl)} alt="" />
            </a>
          ) : null}
        </div>
        <div className="comment-meta">
          <CommentReactionsRow
            comment={comment}
            onReact={(cid, reaction) => onReactComment?.(cid, reaction)}
            onShowReactors={onShowCommentReactors}
          />
          <button type="button" className="reply-link" onClick={onReplyClick}>
            {replying ? "Cancel" : "Reply"}
          </button>
          {canDelete ? (
            <button type="button" className="reply-link comment-delete-link" onClick={handleDelete} title="Delete">
              Delete
            </button>
          ) : null}
        </div>
        {replying ? (
          <ReplyForm
            currentUser={currentUser}
            placeholder={`Reply to ${comment.author}… use @ to mention`}
            onSubmit={onSubmitReply}
            onCancel={onCancelReply}
          />
        ) : null}
      </div>
    </div>
  );
}

function ReplyForm({ currentUser, placeholder, onSubmit, onCancel }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const photoUrl = photo ? URL.createObjectURL(photo) : null;
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t && !photo) return;
    await onSubmit({ text: t, photo });
    setText("");
    setPhoto(null);
  }
  return (
    <form className="comment-form reply-form" onSubmit={submit}>
      <MentionInput
        value={text}
        onChange={setText}
        placeholder={placeholder || `Reply as ${currentUser.name}…`}
        autoFocus
      />
      <label className="btn btn-ghost btn-sm photo-pick-btn" title="Attach a photo">
        📷
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
        />
      </label>
      {photoUrl ? (
        <div className="comment-photo-preview">
          <img src={photoUrl} alt="preview" />
          <button type="button" className="comment-photo-clear" onClick={() => setPhoto(null)}>✕</button>
        </div>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary btn-send-msg"
        aria-label="Send reply"
        title="Send reply"
      >
        ➤
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// Expandable post body — clamp wraps text only so "See more…" stays visible (-webkit-line-clamp was hiding it).
function PostText({ text, forceExpanded }) {
  const [expanded, setExpanded] = useState(!!forceExpanded);
  useEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const tooLong = text.length > TRUNCATE_LIMIT;
  const showFull = expanded || forceExpanded || !tooLong;
  const truncated = showFull ? text : text.slice(0, TRUNCATE_LIMIT).trimEnd() + "…";
  const clamped = !showFull && tooLong;

  return (
    <div className="post-body-wrap">
      <div className={`post-body ${clamped ? "post-body-clamped" : ""}`}>
        <MentionText text={truncated} />
      </div>
      {tooLong && !forceExpanded ? (
        <button
          type="button"
          className="see-more-btn"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded ? "See less" : "See more…"}
        </button>
      ) : null}
    </div>
  );
}

// Facebook-style reactions bar. Hovering the trigger reveals a floating picker
// with six animated emoji buttons. Click picks; clicking the active emoji
// removes it; clicking a different emoji switches the reaction.
function ReactionsRow({ post, onReact, onShowReactors }) {
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

      <div className="reaction-summary-wrap">
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
        {post.reactionCount > 0 ? (
          <button type="button" className="see-reactors-btn" onClick={onShowReactors}>
            See reactions
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentBox({ postId, onComment, currentUser }) {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState(null);
  const photoUrl = photo ? URL.createObjectURL(photo) : null;
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t && !photo) return;
    await onComment(postId, { text: t, photo });
    setText("");
    setPhoto(null);
  }
  return (
    <form className="comment-form" onSubmit={submit}>
      <MentionInput
        value={text}
        onChange={setText}
        placeholder={`Comment as ${currentUser.name}… use @ to mention`}
      />
      <label className="btn btn-ghost btn-sm photo-pick-btn" title="Attach a photo">
        📷
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => setPhoto(e.target.files?.[0] || null)}
        />
      </label>
      {photoUrl ? (
        <div className="comment-photo-preview">
          <img src={photoUrl} alt="preview" />
          <button type="button" className="comment-photo-clear" onClick={() => setPhoto(null)}>✕</button>
        </div>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary btn-send-msg"
        aria-label="Post comment"
        title="Post comment"
      >
        ➤
      </button>
    </form>
  );
}
