import { useEffect, useMemo, useRef, useState } from "react";
import { mediaUrl } from "../services/api.js";

export default function MessagesPage({
  currentUser,
  conversations,
  activeChat,
  searchResults,
  searchQuery,
  setSearchQuery,
  onSearch,
  onAddFriend,
  onOpenChat,           // (kind, id)  kind: "dm" | "group"
  onSendMessage,        // (text, file) routed by App based on activeChat.kind
  onRefreshConversations,
  onCreateGroup,        // ({ name, memberIds, photoFile })
  onUpdateGroup,        // (groupId, { name, photoFile })
  onLeaveGroup,         // (groupId)
  onLoadAttachments,    // () => Promise<list>
  onAddMember,          // (groupId, memberIds[])
  onRemoveMember        // (groupId, userId)
}) {
  const [draft, setDraft] = useState("");
  const [draftFile, setDraftFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileRef = useRef(null);
  const threadEndRef = useRef(null);
  const menuRef = useRef(null);

  const isGroup = activeChat?.kind === "group";

  useEffect(() => {
    setDraft("");
    setDraftFile(null);
    setMenuOpen(false);
  }, [activeChat?.kind, activeChat?.user?.id, activeChat?.group?.id]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeChat?.messages]);

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
    await onSendMessage(text, draftFile);
    setDraft("");
    setDraftFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setSending(false);
  }

  function pickAttachment(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraftFile(file);
  }

  return (
    <section className="panel single messages-panel">
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
            {conversations.length === 0 ? (
              <p className="empty-hint">No conversations yet. Search someone or start a group chat.</p>
            ) : (
              conversations.map((c) => {
                const isDM = c.kind === "dm";
                const target = isDM ? c.user : c.group;
                const isActive =
                  (isGroup && activeChat?.group?.id === c.group?.id) ||
                  (!isGroup && activeChat?.user?.id === c.user?.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`conv-item ${isActive ? "active" : ""}`}
                    onClick={() => onOpenChat(c.kind, isDM ? c.user.id : c.group.id)}
                  >
                    {renderAvatar(target, "sm")}
                    <div className="conv-item-body">
                      <strong>
                        {target?.name || "Unknown"}{" "}
                        {!isDM ? <span className="pill pill-muted small">group</span> : null}
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
                {renderAvatar(isGroup ? activeChat.group : activeChat.user)}
                <div className="thread-header-info">
                  <strong>{isGroup ? activeChat.group?.name : activeChat.user?.name}</strong>
                  {isGroup ? (
                    <small>
                      {activeChat.group?.members?.length || 0} members
                    </small>
                  ) : (
                    <small>{activeChat.user?.email}</small>
                  )}
                  {!isGroup && activeChat.isFriend ? (
                    <span className="pill pill-you">Friends</span>
                  ) : !isGroup ? (
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
              </div>

              <div className="thread-messages">
                {(activeChat.messages || []).map((m) => {
                  const showAuthorTag = isGroup && !m.fromMe;
                  return (
                    <div
                      key={m.id}
                      className={`bubble-row ${m.fromMe ? "row-me" : "row-them"}`}
                    >
                      {!m.fromMe ? (
                        <>
                          {m.authorAvatar ? (
                            <img className="msg-avatar sm" src={mediaUrl(m.authorAvatar)} alt="" />
                          ) : (
                            <div className="msg-avatar sm placeholder">{m.author?.charAt(0) || "?"}</div>
                          )}
                        </>
                      ) : null}
                      <div className={`bubble ${m.fromMe ? "bubble-me" : "bubble-them"}`}>
                        {showAuthorTag ? <p className="bubble-author">{m.author}</p> : null}
                        {m.attachment ? <MessageAttachment att={m.attachment} /> : null}
                        {m.text ? <p>{m.text}</p> : null}
                        <small>{new Date(m.createdAt).toLocaleString()}</small>
                      </div>
                    </div>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <form className="thread-compose" onSubmit={handleSend}>
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={pickAttachment}
                />
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Attach file"
                  onClick={() => fileRef.current?.click()}
                >
                  📎
                </button>
                {draftFile ? (
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
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={isGroup ? `Message ${activeChat.group?.name}…` : `Message ${activeChat.user?.name}…`}
                />
                <button type="submit" className="btn btn-primary" disabled={sending}>
                  {sending ? "…" : "📤"}
                </button>
              </form>
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
          group={activeChat.group}
          onClose={() => setShowGroupSettings(false)}
          onSave={async (payload) => {
            await onUpdateGroup(activeChat.group.id, payload);
            setShowGroupSettings(false);
          }}
          onAddMembers={onAddMember}
          onRemoveMember={onRemoveMember}
        />
      ) : null}

      {showAttachments ? (
        <AttachmentsModal
          loader={onLoadAttachments}
          onClose={() => setShowAttachments(false)}
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
    <div className="modal-backdrop" onClick={onClose}>
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
  );
}

// ---------------- Group Settings Modal ----------------

function GroupSettingsModal({ group, onClose, onSave }) {
  const [name, setName] = useState(group?.name || "");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!name.trim() && !photo) return setErr("Change the name or pick a new photo");
    setSaving(true);
    try {
      await onSave({ name: name.trim() !== group.name ? name.trim() : undefined, photoFile: photo });
    } catch (e) {
      setErr(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙️ Group settings</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="group-photo-preview">
            {group?.photoUrl ? (
              <img src={mediaUrl(group.photoUrl)} alt="" />
            ) : (
              <div className="group-photo-placeholder">{group?.name?.charAt(0) || "?"}</div>
            )}
          </div>

          <label className="field-label">Group name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" />

          <label className="field-label">Change group photo</label>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
          {photo ? <small className="file-picked">Selected: {photo.name}</small> : null}

          <label className="field-label">Members ({group?.members?.length || 0})</label>
          <ul className="member-list">
            {(group?.members || []).map((m) => (
              <li key={m.id} className="member-row">
                {m.avatarUrl ? (
                  <img className="msg-avatar sm" src={mediaUrl(m.avatarUrl)} alt="" />
                ) : (
                  <div className="msg-avatar sm placeholder">{m.name?.charAt(0) || "?"}</div>
                )}
                <div className="member-info">
                  <strong>{m.name}</strong>
                  <small>{m.email} · {m.role}</small>
                </div>
              </li>
            ))}
          </ul>

          {err ? <p className="form-error">{err}</p> : null}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="modal-backdrop" onClick={onClose}>
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
  );
}
