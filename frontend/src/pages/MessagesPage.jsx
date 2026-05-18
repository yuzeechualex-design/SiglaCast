import { useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../services/api.js";
import MentionInput from "../components/MentionInput.jsx";
import MentionText from "../components/MentionText.jsx";
import ReactionActorsModal from "../components/ReactionActorsModal.jsx";
import ModalPortal from "../components/ModalPortal.jsx";

const CHAT_REACTIONS = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "haha", emoji: "😂", label: "Haha" },
  { type: "wow",  emoji: "😮", label: "Wow"  },
  { type: "sad",  emoji: "😢", label: "Sad"  },
  { type: "angry", emoji: "😡", label: "Angry" }
];
const CHAT_REACTION_MAP = CHAT_REACTIONS.reduce((acc, r) => {
  acc[r.type] = r;
  return acc;
}, {});

export default function MessagesPage({
  currentUser,
  conversations,
  activeChat,
  searchResults,
  searchQuery,
  setSearchQuery,
  onSearch,
  onAddFriend,
  onOpenChat,            // (kind, id)  kind: "dm" | "group" | "userphone"
  onSendMessage,         // (text, file) routed by App based on activeChat.kind
  onRefreshConversations,
  onCreateGroup,         // ({ name, memberIds, photoFile })
  onUpdateGroup,         // (groupId, { name, photoFile })
  onLeaveGroup,          // (groupId)
  onLoadAttachments,     // () => Promise<list>
  onAddMembers,          // (groupId, memberIds[])
  onRemoveMember,        // (groupId, userId)
  onChangeMemberRole,    // (groupId, userId, role)
  onDeleteGroup,         // (groupId)
  onReactToMessage,      // (messageId, reaction|null)
  onUnsendMessage,       // (message)
  onCloseMobileChat,      // () clears activeChat (mobile back out of thread)
  onUserphoneStart,
  onUserphoneEnd,
  onUserphoneSwitch,
  onUserphoneCancelWaiting,
  userPhoneAutoReconnect,
  setUserPhoneAutoReconnect
}) {
  const [draft, setDraft] = useState("");
  const [draftFile, setDraftFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const fileRef = useRef(null);
  const threadEndRef = useRef(null);
  const menuRef = useRef(null);
  const [reactionModal, setReactionModal] = useState({ open: false, messageId: null });
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false
  );

  const isGroup = activeChat?.kind === "group";
  const isUserphone = activeChat?.kind === "userphone";
  const userphonePhase = isUserphone ? activeChat?.phase || "idle" : null;
  const mobileThreadFullscreen = isNarrowViewport && !!activeChat;

  /** Must match backend USERPHONE_WAIT_MS / 1000 in server.js */
  const USERPHONE_QUEUE_SEC = 10;
  const [userphoneNow, setUserphoneNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isUserphone || userphonePhase !== "waiting") return undefined;
    const t = setInterval(() => setUserphoneNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [isUserphone, userphonePhase]);

  const userphoneSecondsLeft =
    isUserphone && userphonePhase === "waiting" && activeChat?.waitExpiresAt
      ? Math.max(0, Math.ceil((new Date(activeChat.waitExpiresAt).getTime() - userphoneNow) / 1000))
      : null;

  const userphoneCountdownPct =
    userphoneSecondsLeft != null ? Math.min(1, Math.max(0, userphoneSecondsLeft / USERPHONE_QUEUE_SEC)) : null;

  useEffect(() => {
    setDraft("");
    setDraftFile(null);
    setMenuOpen(false);
    setReplyTarget(null);
  }, [activeChat?.kind, activeChat?.user?.id, activeChat?.group?.id, activeChat?.sessionId, activeChat?.phase]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrowViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Jump to bottom when switching threads only (not on every poll / inbound message).
  useEffect(() => {
    if (!activeChat) return;
    const id = requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [activeChat?.kind, activeChat?.user?.id, activeChat?.group?.id, activeChat?.sessionId, activeChat?.phase]);

  // Click outside hamburger menu closes it
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  function renderAvatar(entity, size = "md") {
    const cls = size === "sm" ? "msg-avatar sm" : "msg-avatar";
    const url = entity?.avatarUrl || entity?.photoUrl;
    if (url) return <img className={cls} src={mediaUrl(url)} alt="" />;
    const ch = entity?.name?.charAt(0) || "?";
    return <div className={`${cls} placeholder`}>{ch}</div>;
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && !draftFile) || sending) return;
    setSending(true);
    await onSendMessage(text, draftFile, replyTarget?.id || null);
    requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    setDraft("");
    setDraftFile(null);
    setReplyTarget(null);
    if (fileRef.current) fileRef.current.value = "";
    setSending(false);
  }

  // Reply / unsend on a single message bubble. `onUnsendMessage` handles confirm.
  function handleReply(message) {
    setReplyTarget({
      id: message.id,
      author: message.author || (message.fromMe ? currentUser?.name : (isGroup ? "member" : isUserphone ? "Anonymous" : activeChat?.user?.name)),
      text: message.text || (message.attachment?.isImage ? "📷 Photo" : message.attachment ? "📁 File" : "")
    });
  }
  async function handleUnsend(message) {
    if (!onUnsendMessage) return;
    if (window.confirm("Unsend this message? Others will see that it was unsent.")) {
      await onUnsendMessage(message);
    }
  }

  function pickAttachment(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraftFile(file);
  }

  return (
    <section
      className={`panel single messages-panel ${mobileThreadFullscreen ? "messages-mobile-fullscreen" : ""}`}
    >
      <div className="panel-head">
        <h2>✉️ Messages</h2>
        <p>Direct messages, group chats, and shared files.</p>
      </div>

      <div className="messages-layout">
        <aside className="messages-sidebar">
          <div className="sidebar-top-row">
            <p className="sidebar-title">Chats</p>
            <button
              type="button"
              className="btn btn-primary btn-sm chat-plus-btn"
              onClick={() => setShowCreateGroup(true)}
              title="Create a groupchat"
            >
              ＋
            </button>
          </div>

          <div className="friend-search">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="Search people…"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={onSearch}>
              🔍
            </button>
          </div>

          {searchResults.length > 0 && (
            <div className="search-results">
              <p className="search-results-title">Search results</p>
              {searchResults.map((u) => (
                <div key={u.id} className="search-result-row">
                  {renderAvatar(u, "sm")}
                  <div className="search-result-info">
                    <strong>{u.name}</strong>
                    <small>{u.email}</small>
                  </div>
                  <div className="search-result-actions">
                    {!u.isFriend ? (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddFriend(u.id)}>
                        ➕ Add
                      </button>
                    ) : (
                      <span className="pill pill-you">Friends</span>
                    )}
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenChat("dm", u.id)}>
                      💬
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="conv-list">
            {(conversations || []).length === 0 ? (
              <p className="empty-hint">No conversations yet. Search someone or try Userphone.</p>
            ) : (
              conversations.map((c) => {
                const isDmOrPhone = c.kind === "dm" || c.kind === "userphone";
                const target = c.kind === "group" ? c.group : c.user;
                const isActive =
                  (isGroup && activeChat?.kind === "group" && activeChat?.group?.id === c.group?.id) ||
                  (c.kind === "dm" && activeChat?.kind === "dm" && activeChat?.user?.id === c.user?.id) ||
                  (c.kind === "userphone" && activeChat?.kind === "userphone");
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`conv-item ${c.kind === "userphone" ? "conv-userphone" : ""} ${isActive ? "active" : ""}`}
                    onClick={() =>
                      c.kind === "userphone"
                        ? onOpenChat("userphone", "userphone")
                        : onOpenChat(c.kind, isDmOrPhone && c.kind === "dm" ? c.user.id : c.group.id)
                    }
                  >
                    {c.kind === "userphone" ? (
                      <div className="msg-avatar sm placeholder conv-userphone-avatar" aria-hidden>
                        📞
                      </div>
                    ) : (
                      renderAvatar(target, "sm")
                    )}
                    <div className="conv-item-body">
                      <strong>
                        {target?.name || "Unknown"}{" "}
                        {!isDmOrPhone ? <span className="pill pill-muted small">group</span> : null}
                        {c.kind === "userphone" ? (
                          <span className="pill pill-muted small">anonymous</span>
                        ) : null}
                      </strong>
                      <span className="conv-preview">
                        {c.lastMessage
                          ? `${c.lastMessage.fromMe ? "You: " : ""}${c.lastMessage.text || ""}`
                          : "No messages yet"}
                      </span>
                    </div>
                    {c.unreadCount > 0 ? <span className="unread-dot">{c.unreadCount}</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="messages-thread">
          {!activeChat ? (
            <div className="thread-empty">
              <p>Select a chat from the left or tap ＋ to start a group chat.</p>
            </div>
          ) : (
            <>
              <div className="thread-header">
                {mobileThreadFullscreen && onCloseMobileChat ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm thread-back-btn"
                    onClick={() => onCloseMobileChat()}
                    aria-label="Back to chat list"
                  >
                    ← Back
                  </button>
                ) : null}
                {isUserphone ? (
                  <div className="msg-avatar placeholder thread-userphone-icon" aria-hidden>
                    📞
                  </div>
                ) : (
                  renderAvatar(isGroup ? activeChat.group : activeChat.user)
                )}
                <div className="thread-header-info">
                  <strong>{isUserphone ? "Userphone" : isGroup ? activeChat.group?.name : activeChat.user?.name}</strong>
                  {isUserphone ? (
                    <small>Random anonymous chats — identities stay hidden.</small>
                  ) : isGroup ? (
                    <small>
                      {activeChat.group?.members?.length || 0} members
                    </small>
                  ) : (
                    <small>{activeChat.user?.email}</small>
                  )}
                  {!isGroup && !isUserphone && activeChat.isFriend ? (
                    <span className="pill pill-you">Friends</span>
                  ) : null}
                  {!isGroup && !isUserphone ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onAddFriend(activeChat.user.id)}
                    >
                      ➕ Add friend
                    </button>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onRefreshConversations}
                  title="Refresh"
                >
                  ↻
                </button>
                {!isUserphone ? (
                <div className="thread-menu-wrap" ref={menuRef}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm thread-menu-btn"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Chat settings"
                  >
                    ☰
                  </button>
                  {menuOpen ? (
                    <div className="thread-menu">
                      {isGroup ? (
                        <>
                          <button
                            type="button"
                            className="thread-menu-item"
                            onClick={() => {
                              setMenuOpen(false);
                              setShowGroupSettings(true);
                            }}
                          >
                            ⚙️ Settings
                          </button>
                          <button
                            type="button"
                            className="thread-menu-item"
                            onClick={() => {
                              setMenuOpen(false);
                              setShowAttachments(true);
                            }}
                          >
                            🖼️ Files & images
                          </button>
                          <button
                            type="button"
                            className="thread-menu-item danger"
                            onClick={async () => {
                              setMenuOpen(false);
                              if (window.confirm("Leave this group chat?")) {
                                await onLeaveGroup?.(activeChat.group.id);
                              }
                            }}
                          >
                            🚪 Leave group
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="thread-menu-item"
                          onClick={() => {
                            setMenuOpen(false);
                            setShowAttachments(true);
                          }}
                        >
                          🖼️ Files & images
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
                ) : null}
              </div>

              {isUserphone && userphonePhase === "matched" ? (
                <div className="userphone-toolbar">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUserphoneEnd?.()}>
                    End call
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onUserphoneSwitch?.()}>
                    Switch call
                  </button>
                </div>
              ) : null}

              {isUserphone && userphonePhase !== "matched" ? (
                <div className="userphone-cta-wrap">
                  {userphonePhase === "idle" ? (
                    <>
                      <p className="userphone-intro">
                        Match with anyone else who opens Userphone. You will both appear as{" "}
                        <strong>Anonymous</strong>.
                      </p>
                      <label className="userphone-auto-row">
                        <input
                          type="checkbox"
                          checked={!!userPhoneAutoReconnect}
                          onChange={(e) => setUserPhoneAutoReconnect(e.target.checked)}
                        />
                        <span>Keep joining the queue automatically until someone matches</span>
                      </label>
                      <button type="button" className="btn btn-primary userphone-big-btn" onClick={() => onUserphoneStart?.()}>
                        Call anonymous
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="userphone-intro userphone-countdown-line">
                        {userphoneSecondsLeft != null ? (
                          <>
                            Matching…{" "}
                            <span className="userphone-countdown-digits">{userphoneSecondsLeft}</span>s left before you
                            leave the queue.
                          </>
                        ) : (
                          <>Searching for someone else on Userphone…</>
                        )}
                      </p>
                      <p className="userphone-timeout-hint muted small">
                        {userPhoneAutoReconnect
                          ? "Each round lasts 10s; you’ll stay in queue automatically until you match or tap Cancel."
                          : "If no one joins in time, tap Call anonymous again when someone might be online."}
                      </p>
                      {userphoneCountdownPct != null ? (
                        <div className="userphone-queue-meter" aria-label="Time left in queue">
                          <div
                            className="userphone-queue-meter-fill"
                            style={{
                              width: `${Math.round(Math.min(100, Math.max(0, userphoneCountdownPct * 100)))}%`
                            }}
                          />
                        </div>
                      ) : (
                        <div className="userphone-spinner" aria-busy />
                      )}
                      <label className="userphone-auto-row userphone-auto-row-inline">
                        <input
                          type="checkbox"
                          checked={!!userPhoneAutoReconnect}
                          onChange={(e) => setUserPhoneAutoReconnect(e.target.checked)}
                        />
                        <span>Keep auto-rejoining after each round</span>
                      </label>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUserphoneCancelWaiting?.()}>
                        Cancel search
                      </button>
                    </>
                  )}
                </div>
              ) : (
              <div className="thread-messages">
                {(activeChat.messages || []).map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    showAuthor={isGroup && !m.fromMe}
                    minimal={isUserphone}
                    onReact={onReactToMessage}
                    onReply={handleReply}
                    onUnsend={handleUnsend}
                    onOpenReactors={(id) => setReactionModal({ open: true, messageId: id })}
                  />
                ))}
                <div ref={threadEndRef} />
              </div>
              )}

              {replyTarget && !isUserphone ? (
                <div className="reply-banner">
                  <div className="reply-banner-info">
                    <span className="reply-banner-label">Replying to {replyTarget.author}</span>
                    <span className="reply-banner-text">{replyTarget.text || "(message)"}</span>
                  </div>
                  <button
                    type="button"
                    className="reply-banner-close"
                    onClick={() => setReplyTarget(null)}
                    title="Cancel reply"
                  >
                    ✕
                  </button>
                </div>
              ) : null}

              {(!isUserphone || userphonePhase === "matched") ? (
              <form className="thread-compose" onSubmit={handleSend}>
                {!isUserphone ? (
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={pickAttachment}
                />
                ) : null}
                {!isUserphone ? (
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Attach file"
                  onClick={() => fileRef.current?.click()}
                >
                  📎
                </button>
                ) : null}
                {!isUserphone && draftFile ? (
                  <div className="draft-file-chip">
                    <span>📁 {draftFile.name}</span>
                    <button
                      type="button"
                      className="draft-file-clear"
                      onClick={() => {
                        setDraftFile(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ) : null}
                <MentionInput
                  value={draft}
                  onChange={setDraft}
                  placeholder={
                    isUserphone
                      ? "Message anonymously…"
                      : isGroup
                        ? `Message ${activeChat.group?.name}… use @ to mention`
                        : `Message ${activeChat.user?.name}… use @ to mention`
                  }
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-send-msg"
                  disabled={sending}
                  aria-label="Send message"
                >
                  {sending ? "…" : "➤"}
                </button>
              </form>
              ) : null}
            </>
          )}
        </div>
      </div>

      {showCreateGroup ? (
        <CreateGroupModal
          currentUser={currentUser}
          onClose={() => setShowCreateGroup(false)}
          onCreate={async (payload) => {
            await onCreateGroup(payload);
            setShowCreateGroup(false);
          }}
        />
      ) : null}

      {showGroupSettings && isGroup ? (
        <GroupSettingsModal
          currentUser={currentUser}
          group={activeChat.group}
          onClose={() => setShowGroupSettings(false)}
          onSave={async (payload) => {
            await onUpdateGroup(activeChat.group.id, payload);
          }}
          onAddMembers={async (memberIds) => {
            await onAddMembers?.(activeChat.group.id, memberIds);
          }}
          onRemoveMember={async (userId) => {
            await onRemoveMember?.(activeChat.group.id, userId);
          }}
          onChangeRole={async (userId, role) => {
            await onChangeMemberRole?.(activeChat.group.id, userId, role);
          }}
          onLeaveGroup={async () => {
            setShowGroupSettings(false);
            await onLeaveGroup?.(activeChat.group.id);
          }}
          onDeleteGroup={async () => {
            setShowGroupSettings(false);
            await onDeleteGroup?.(activeChat.group.id);
          }}
        />
      ) : null}

      {showAttachments ? (
        <AttachmentsModal
          loader={onLoadAttachments}
          onClose={() => setShowAttachments(false)}
        />
      ) : null}

      {reactionModal.open && reactionModal.messageId ? (
        <ReactionActorsModal
          title="Reactions"
          path={`/messages/${reactionModal.messageId}/reactors`}
          reactionTypes={CHAT_REACTIONS}
          onClose={() => setReactionModal({ open: false, messageId: null })}
        />
      ) : null}
    </section>
  );
}

function MessageAttachment({ att }) {
  if (att.isImage) {
    return (
      <a href={att.url} target="_blank" rel="noreferrer" className="bubble-image-link">
        <img className="bubble-image" src={mediaUrl(att.url)} alt={att.name || "image"} />
      </a>
    );
  }
  return (
    <a className="bubble-file" href={att.url} target="_blank" rel="noreferrer" download>
      📁 <span className="bubble-file-name">{att.name || "Download file"}</span>
      {att.size ? <small>{formatBytes(att.size)}</small> : null}
    </a>
  );
}

function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// One chat bubble row: avatar (for incoming group messages), the bubble itself,
// a hover reaction picker, quoted-reply preview, and inline Reply/Unsend
// actions. On touch devices a long-press opens the picker and we cancel the
// default text-selection menu so it doesn't conflict with reacting.
function MessageBubble({ message: m, showAuthor, minimal = false, onReact, onReply, onUnsend, onOpenReactors }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closeTimer = useRef(null);
  const longPressTimer = useRef(null);
  const bubbleWrapRef = useRef(null);
  const unsent = !!m.isUnsent;

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // Touch: tapping outside closes the reaction + action strip (still long-press to open).
  useEffect(() => {
    if (!pickerOpen || unsent || minimal) return;
    const mq = window.matchMedia("(hover: none)");
    if (!mq.matches) return;
    function tapOut(e) {
      if (!bubbleWrapRef.current?.contains(e.target)) setPickerOpen(false);
    }
    document.addEventListener("touchstart", tapOut, true);
    document.addEventListener("mousedown", tapOut, true);
    return () => {
      document.removeEventListener("touchstart", tapOut, true);
      document.removeEventListener("mousedown", tapOut, true);
    };
  }, [pickerOpen, unsent, minimal]);

  const breakdown = m.reactionBreakdown || {};
  const topReactions = CHAT_REACTIONS
    .filter((r) => breakdown[r.type])
    .sort((a, b) => (breakdown[b.type] || 0) - (breakdown[a.type] || 0));
  const totalCount = Object.values(breakdown).reduce((a, b) => a + b, 0);

  function openPicker() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPickerOpen(true);
  }
  function deferClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPickerOpen(false), 240);
  }

  async function pick(type) {
    setPickerOpen(false);
    await onReact?.(m.id, type);
  }

  // Touch: long-press to open the reaction picker. preventDefault on the
  // native contextmenu so "Copy / Select" doesn't appear underneath.
  function handleTouchStart() {
    if (unsent || minimal) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => setPickerOpen(true), 400);
  }
  function handleTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }
  function suppressContext(e) {
    if (!unsent && !minimal) e.preventDefault();
  }

  return (
    <div className={`bubble-row ${m.fromMe ? "row-me" : "row-them"} ${unsent ? "is-unsent" : ""}`}>
      {!m.fromMe ? (
        m.authorAvatar ? (
          <img className="msg-avatar sm" src={mediaUrl(m.authorAvatar)} alt="" />
        ) : (
          <div className="msg-avatar sm placeholder">{m.author?.charAt(0) || "?"}</div>
        )
      ) : null}

      <div
        className="bubble-stack"
        onMouseEnter={!unsent && !minimal ? openPicker : undefined}
        onMouseLeave={!unsent && !minimal ? deferClose : undefined}
      >
        <div className="bubble-with-actions" ref={bubbleWrapRef}>
          <div
            className={`bubble ${m.fromMe ? "bubble-me" : "bubble-them"} ${unsent ? "bubble-unsent" : ""}`}
            onContextMenu={suppressContext}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {showAuthor ? <p className="bubble-author">{m.author}</p> : null}

            {m.replyTo ? (
              <div className="bubble-reply-quote">
                <span className="bubble-reply-quote-author">{m.replyTo.author}</span>
                <span className="bubble-reply-quote-text">
                  {m.replyTo.isUnsent ? "(message unsent)" : (m.replyTo.text || "(message)")}
                </span>
              </div>
            ) : null}

            {unsent ? (
              <p className="bubble-unsent-text">🚫 This message was unsent</p>
            ) : (
              <>
                {m.attachment ? <MessageAttachment att={m.attachment} /> : null}
                {m.text ? <p><MentionText text={m.text} /></p> : null}
              </>
            )}
            <div className="bubble-meta-row">
              <small className="bubble-time">{new Date(m.createdAt).toLocaleString()}</small>
              {!minimal && !unsent && totalCount > 0 ? (
                <button
                  type="button"
                  className="bubble-reaction-chip bubble-reaction-chip-btn"
                  title={`See who reacted · ${totalCount}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenReactors?.(m.id);
                  }}
                >
                  {topReactions.slice(0, 3).map((r) => (
                    <span key={r.type}>{r.emoji}</span>
                  ))}
                  {totalCount > 1 ? <small>{totalCount}</small> : null}
                </button>
              ) : null}
            </div>
          </div>

          {!unsent && !minimal ? (
            <div className={`bubble-quick-actions ${m.fromMe ? "side-left" : "side-right"}`}>
              <button
                type="button"
                className="bubble-quick-btn"
                title="Reply"
                onClick={() => {
                  setPickerOpen(false);
                  onReply?.(m);
                }}
              >
                ↩
              </button>
              {m.fromMe ? (
                <button
                  type="button"
                  className="bubble-quick-btn"
                  title="Unsend"
                  onClick={() => {
                    setPickerOpen(false);
                    onUnsend?.(m);
                  }}
                >
                  🗑
                </button>
              ) : null}
            </div>
          ) : null}

          {pickerOpen && !unsent && !minimal ? (
            <div
              className={`bubble-react-picker ${m.fromMe ? "side-left" : "side-right"}`}
              onMouseEnter={openPicker}
              onMouseLeave={deferClose}
            >
              {CHAT_REACTIONS.map((r, idx) => (
                <button
                  key={r.type}
                  type="button"
                  className={`reaction-emoji-btn ${m.myReaction === r.type ? "is-active" : ""}`}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  title={r.label}
                  onClick={() => pick(r.type)}
                >
                  <span className="reaction-emoji">{r.emoji}</span>
                  <span className="reaction-tooltip">{r.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- Create Group Modal ----------------

function CreateGroupModal({ currentUser, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const photoRef = useRef(null);

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"}/api/users/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("siglacast_token") || ""}` } }
      );
      const list = await res.json();
      setResults(Array.isArray(list) ? list : []);
    } finally {
      setSearching(false);
    }
  }

  function togglePick(u) {
    setPicked((prev) =>
      prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]
    );
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return setErr("Group name is required");
    if (picked.length < 1) return setErr("Add at least one member");
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        memberIds: picked.map((p) => p.id),
        photoFile: photo
      });
    } catch (e) {
      setErr(e?.message || "Could not create group");
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>👥 Create a groupchat</h3>
          <button type="button" className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <label className="field-label">Group name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Best group ever" autoFocus />

          <label className="field-label">Photo (optional)</label>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          />
          {photo ? <small className="file-picked">Selected: {photo.name}</small> : null}

          <label className="field-label">Add members</label>
          <div className="modal-search-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
              placeholder="Search by name, email, course…"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={runSearch} disabled={searching}>
              {searching ? "…" : "🔍"}
            </button>
          </div>

          {picked.length > 0 ? (
            <div className="picked-chips">
              {picked.map((u) => (
                <span key={u.id} className="chip">
                  {u.name}
                  <button type="button" onClick={() => togglePick(u)}>✕</button>
                </span>
              ))}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="search-results small">
              {results
                .filter((r) => r.id !== currentUser?.id)
                .map((u) => {
                  const isPicked = picked.some((p) => p.id === u.id);
                  return (
                    <div key={u.id} className="search-result-row">
                      <div className="search-result-info">
                        <strong>{u.name}</strong>
                        <small>{u.email}</small>
                      </div>
                      <button
                        type="button"
                        className={`btn btn-sm ${isPicked ? "btn-secondary" : "btn-primary"}`}
                        onClick={() => togglePick(u)}
                      >
                        {isPicked ? "Remove" : "Add"}
                      </button>
                    </div>
                  );
                })}
            </div>
          ) : null}

          {err ? <p className="form-error">{err}</p> : null}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create group"}
            </button>
          </div>
        </form>
      </div>
      </div>
    </ModalPortal>
  );
}

// ---------------- Group Settings Modal ----------------

function GroupSettingsModal({
  currentUser,
  group,
  onClose,
  onSave,
  onAddMembers,
  onRemoveMember,
  onChangeRole,
  onLeaveGroup,
  onDeleteGroup
}) {
  const [name, setName] = useState(group?.name || "");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Add members section
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const iAmAdmin = useMemo(
    () => Boolean(group?.members?.find((m) => m.id === currentUser?.id && m.role === "admin")),
    [group, currentUser]
  );

  useEffect(() => {
    setName(group?.name || "");
  }, [group?.id, group?.name]);

  async function submitSave(e) {
    e.preventDefault();
    setErr("");
    const renamed = name.trim() && name.trim() !== group.name ? name.trim() : undefined;
    if (!renamed && !photo) return setErr("Change the name or pick a new photo");
    setSaving(true);
    try {
      await onSave({ name: renamed, photoFile: photo });
      setPhoto(null);
    } catch (e) {
      setErr(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "http://localhost:4000"}/api/users/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("siglacast_token") || ""}` } }
      );
      const list = await res.json();
      const existingIds = new Set((group?.members || []).map((m) => m.id));
      setResults((Array.isArray(list) ? list : []).filter((u) => !existingIds.has(u.id)));
    } finally {
      setSearching(false);
    }
  }

  function togglePick(u) {
    setPicked((prev) =>
      prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]
    );
  }

  async function submitAdd() {
    if (!picked.length) return;
    setAdding(true);
    try {
      await onAddMembers(picked.map((p) => p.id));
      setPicked([]);
      setQuery("");
      setResults([]);
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙️ Group settings</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={submitSave} className="group-settings-form">
            <div className="group-photo-preview">
              {group?.photoUrl ? (
                <img src={mediaUrl(group.photoUrl)} alt="" />
              ) : (
                <div className="group-photo-placeholder">{group?.name?.charAt(0) || "?"}</div>
              )}
            </div>

            <label className="field-label">Group name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              disabled={!iAmAdmin}
            />

            {iAmAdmin ? (
              <>
                <label className="field-label">Change group photo</label>
                <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                {photo ? <small className="file-picked">Selected: {photo.name}</small> : null}
                {err ? <p className="form-error">{err}</p> : null}
                <div className="form-inline-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted small">Only group admins can rename or change the photo.</p>
            )}
          </form>

          <hr className="modal-sep" />

          <div className="settings-section-head">
            <h4>👥 Members ({group?.members?.length || 0})</h4>
            {iAmAdmin ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdd((v) => !v)}
              >
                {showAdd ? "Close" : "➕ Add another person"}
              </button>
            ) : null}
          </div>

          {showAdd ? (
            <div className="add-members-panel">
              <div className="modal-search-row">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
                  placeholder="Search by name, email, course…"
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={runSearch} disabled={searching}>
                  {searching ? "…" : "🔍"}
                </button>
              </div>

              {picked.length > 0 ? (
                <div className="picked-chips">
                  {picked.map((u) => (
                    <span key={u.id} className="chip">
                      {u.name}
                      <button type="button" onClick={() => togglePick(u)}>✕</button>
                    </span>
                  ))}
                </div>
              ) : null}

              {results.length > 0 ? (
                <div className="search-results small">
                  {results.map((u) => {
                    const isPicked = picked.some((p) => p.id === u.id);
                    return (
                      <div key={u.id} className="search-result-row">
                        <div className="search-result-info">
                          <strong>{u.name}</strong>
                          <small>{u.email}</small>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${isPicked ? "btn-secondary" : "btn-primary"}`}
                          onClick={() => togglePick(u)}
                        >
                          {isPicked ? "Remove" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="form-inline-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!picked.length || adding}
                  onClick={submitAdd}
                >
                  {adding ? "Adding…" : `Add ${picked.length || ""} to group`}
                </button>
              </div>
            </div>
          ) : null}

          <ul className="member-list">
            {(group?.members || []).map((m) => {
              const isMe = m.id === currentUser?.id;
              const isMemberAdmin = m.role === "admin";
              return (
                <li key={m.id} className="member-row">
                  {m.avatarUrl ? (
                    <img className="msg-avatar sm" src={mediaUrl(m.avatarUrl)} alt="" />
                  ) : (
                    <div className="msg-avatar sm placeholder">{m.name?.charAt(0) || "?"}</div>
                  )}
                  <div className="member-info">
                    <strong>
                      {m.name} {isMe ? <span className="muted small">(you)</span> : null}
                    </strong>
                    <small>
                      {m.email} ·{" "}
                      <span className={`pill ${isMemberAdmin ? "pill-admin" : "pill-muted"} small`}>
                        {m.role}
                      </span>
                    </small>
                  </div>

                  {iAmAdmin && !isMe ? (
                    <div className="member-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onChangeRole(m.id, isMemberAdmin ? "member" : "admin")}
                        title={isMemberAdmin ? "Remove admin role" : "Promote to admin"}
                      >
                        {isMemberAdmin ? "⬇️ Demote" : "⬆️ Make admin"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          if (window.confirm(`Remove ${m.name} from the group?`)) {
                            await onRemoveMember(m.id);
                          }
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <hr className="modal-sep" />

          <div className="settings-danger-zone">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (window.confirm("Leave this group chat?")) {
                  await onLeaveGroup();
                }
              }}
            >
              🚪 Leave the conversation
            </button>
            {iAmAdmin ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  if (window.confirm("Delete this group chat for everyone? This cannot be undone.")) {
                    await onDeleteGroup();
                  }
                }}
              >
                🗑️ Delete group chat
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ---------------- Attachments Modal ----------------

function AttachmentsModal({ loader, onClose }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("images");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await loader?.();
        if (!cancelled) setList(Array.isArray(data) ? data : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loader]);

  const images = useMemo(
    () => list.filter((m) => m.attachment?.isImage),
    [list]
  );
  const files = useMemo(
    () => list.filter((m) => m.attachment && !m.attachment.isImage),
    [list]
  );

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🖼️ Files & Images</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button
            type="button"
            className={`tab ${tab === "images" ? "active" : ""}`}
            onClick={() => setTab("images")}
          >
            Images ({images.length})
          </button>
          <button
            type="button"
            className={`tab ${tab === "files" ? "active" : ""}`}
            onClick={() => setTab("files")}
          >
            Files ({files.length})
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p>Loading…</p>
          ) : tab === "images" ? (
            images.length === 0 ? (
              <p className="muted">No images shared yet.</p>
            ) : (
              <div className="image-gallery">
                {images.map((m) => (
                  <a
                    key={m.id}
                    href={m.attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`${m.author || ""} · ${new Date(m.createdAt).toLocaleString()}`}
                  >
                    <img src={mediaUrl(m.attachment.url)} alt={m.attachment.name || ""} />
                  </a>
                ))}
              </div>
            )
          ) : files.length === 0 ? (
            <p className="muted">No files shared yet.</p>
          ) : (
            <ul className="file-list">
              {files.map((m) => (
                <li key={m.id} className="file-row">
                  <a href={m.attachment.url} target="_blank" rel="noreferrer" download>
                    📁 {m.attachment.name || "file"}
                  </a>
                  <small>
                    {m.author || ""} · {formatBytes(m.attachment.size)} · {new Date(m.createdAt).toLocaleString()}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
