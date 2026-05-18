import { useEffect, useRef, useState } from "react";
import { API_ORIGIN } from "../services/api.js";

export default function MessagesPage({
  conversations,
  activeChat,
  searchResults,
  searchQuery,
  setSearchQuery,
  onSearch,
  onAddFriend,
  onOpenChat,
  onSendMessage,
  onRefreshConversations
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef(null);

  useEffect(() => {
    setDraft("");
  }, [activeChat?.user?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

  function renderAvatar(user, size = "md") {
    const cls = size === "sm" ? "msg-avatar sm" : "msg-avatar";
    if (user?.avatarUrl) {
      return <img className={cls} src={`${API_ORIGIN}${user.avatarUrl}`} alt="" />;
    }
    return <div className={`${cls} placeholder`}>{user?.name?.charAt(0) || "?"}</div>;
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !activeChat?.user || sending) return;
    setSending(true);
    await onSendMessage(activeChat.user.id, text);
    setDraft("");
    setSending(false);
  }

  return (
    <section className="panel single messages-panel">
      <div className="panel-head">
        <h2>✉️ Messages</h2>
        <p>Search students, add friends, and chat privately.</p>
      </div>

      <div className="messages-layout">
        <aside className="messages-sidebar">
          <div className="friend-search">
            <label className="field-label">Find people</label>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder="Search by name or email…"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={onSearch}>
              🔍 Search
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
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenChat(u.id)}>
                      💬
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="conv-list-title">Chats</p>
          <div className="conv-list">
            {conversations.length === 0 ? (
              <p className="empty-hint">No conversations yet. Search for someone to message.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.user.id}
                  type="button"
                  className={`conv-item ${activeChat?.user?.id === c.user.id ? "active" : ""}`}
                  onClick={() => onOpenChat(c.user.id)}
                >
                  {renderAvatar(c.user, "sm")}
                  <div className="conv-item-body">
                    <strong>{c.user.name}</strong>
                    <span className="conv-preview">
                      {c.lastMessage
                        ? `${c.lastMessage.fromMe ? "You: " : ""}${c.lastMessage.text}`
                        : "No messages yet"}
                    </span>
                  </div>
                  {c.unreadCount > 0 ? <span className="unread-dot">{c.unreadCount}</span> : null}
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="messages-thread">
          {!activeChat?.user ? (
            <div className="thread-empty">
              <p>Select a chat or search for a user to start messaging.</p>
            </div>
          ) : (
            <>
              <div className="thread-header">
                {renderAvatar(activeChat.user)}
                <div className="thread-header-info">
                  <strong>{activeChat.user.name}</strong>
                  <small>{activeChat.user.email}</small>
                  {activeChat.isFriend ? (
                    <span className="pill pill-you">Friends</span>
                  ) : (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddFriend(activeChat.user.id)}>
                      ➕ Add friend
                    </button>
                  )}
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onRefreshConversations} title="Refresh">
                  ↻
                </button>
              </div>

              <div className="thread-messages">
                {(activeChat.messages || []).map((m) => (
                  <div key={m.id} className={`bubble ${m.fromMe ? "bubble-me" : "bubble-them"}`}>
                    <p>{m.text}</p>
                    <small>{new Date(m.createdAt).toLocaleString()}</small>
                  </div>
                ))}
                <div ref={threadEndRef} />
              </div>

              <form className="thread-compose" onSubmit={handleSend}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${activeChat.user.name}…`}
                />
                <button type="submit" className="btn btn-primary" disabled={sending}>
                  {sending ? "…" : "📤 Send"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
