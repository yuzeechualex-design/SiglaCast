import { useState, useEffect, useCallback, useMemo } from "react";
import AvatarWithFrame from "../components/AvatarWithFrame.jsx";
import { mediaUrl } from "../services/api.js";

function uniqueById(items) {
  const byId = new Map();
  for (const item of items || []) {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function isAiProfile(profile) {
  return Boolean(profile?.isAiCharacter || profile?.is_ai_character || profile?.ownerUserId || profile?.owner_user_id);
}

function searchableText(profile) {
  return [
    profile?.name,
    profile?.bio,
    profile?.email,
    profile?.course,
    profile?.creatorName,
    profile?.statusText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function AddFriendsPage({
  api,
  currentUser,
  characters: knownCharacters = [],
  onAddFriend,
  onOpenUserProfile,
  onOpenDmWithUser,
  liteMode = false
}) {
  const [mode, setMode] = useState("users");
  const [characters, setCharacters] = useState([]);
  const [users, setUsers] = useState([]);
  const [submittedUserQuery, setSubmittedUserQuery] = useState("");
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittingAction, setSubmittingAction] = useState(null);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await api("/users/discover");
      if (res && !res.error) {
        const merged = uniqueById([
          ...(Array.isArray(knownCharacters) ? knownCharacters : []),
          ...(Array.isArray(res.online) ? res.online : []),
          ...(Array.isArray(res.others) ? res.others : []),
          ...(Array.isArray(res.characters) ? res.characters : []),
          ...(Array.isArray(res.aiCharacters) ? res.aiCharacters : [])
        ]);
        setCharacters(merged.filter(isAiProfile));
      }
    } catch (_) {
      // ignore discover failures; the empty state below handles it.
    } finally {
      setLoadingCharacters(false);
    }
  }, [api, knownCharacters]);

  const fetchUsers = useCallback(async (query) => {
    const q = query.trim();
    if (!q) {
      setUsers([]);
      return;
    }
    setLoadingUsers(true);
    try {
      const res = await api(`/users/search?q=${encodeURIComponent(q)}`);
      if (Array.isArray(res)) {
        setUsers(res.filter((u) => u.id !== currentUser?.id && !isAiProfile(u)));
      } else {
        setUsers([]);
      }
    } catch (_) {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, [api, currentUser?.id]);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const handleAddFriend = async (friendId) => {
    if (submittingAction) return;
    setSubmittingAction(friendId);
    try {
      await onAddFriend(friendId);
      const markAdded = (item) => (item.id === friendId ? { ...item, isFriend: true, outgoingRequestPending: true } : item);
      setCharacters((prev) => prev.map(markAdded));
      setUsers((prev) => prev.map(markAdded));
    } finally {
      setSubmittingAction(null);
    }
  };

  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const q = searchQuery.toLowerCase();
    return characters.filter((c) => searchableText(c).includes(q));
  }, [characters, searchQuery]);

  const activeList = mode === "users" ? users : filteredCharacters;
  const loading = mode === "users" ? loadingUsers : loadingCharacters;
  const placeholder = mode === "users"
    ? "Search users by name, email, or course..."
    : "Search AI characters by name or bio...";

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (mode !== "users") return;
    const q = searchQuery.trim();
    setSubmittedUserQuery(q);
    void fetchUsers(q);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    if (mode === "users") {
      setSubmittedUserQuery("");
      setUsers([]);
    }
  };

  return (
    <section className="panel single add-friends-container">
      <div className="add-friends-header tile">
        <div className="discover-header-copy">
          <h2>Search</h2>
          <p className="muted small">Find real profiles or AI characters to chat with.</p>
        </div>
        <div className="search-mode-toggle" role="tablist" aria-label="Search type">
          <button
            type="button"
            className={mode === "users" ? "active" : ""}
            onClick={() => setMode("users")}
          >
            Users
          </button>
          <button
            type="button"
            className={mode === "ai" ? "active" : ""}
            onClick={() => setMode("ai")}
          >
            AI Characters
          </button>
        </div>
        <form className="search-box-row" onSubmit={handleSearchSubmit}>
          <div className="search-box-wrap">
            <input
              type="text"
              className="search-box-input"
              placeholder={placeholder}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (mode === "users" && !e.target.value.trim()) {
                  setSubmittedUserQuery("");
                  setUsers([]);
                }
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                className="search-clear-btn"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                x
              </button>
            ) : null}
          </div>
          {mode === "users" ? (
            <button type="submit" className="search-submit-btn" disabled={!searchQuery.trim() || loadingUsers}>
              Search
            </button>
          ) : null}
        </form>
      </div>

      <section className="friends-section discover-section">
        <div className="search-section-label">
          <strong>{mode === "users" ? "Users" : "AI Characters"}</strong>
          <span>{mode === "users" ? "Profiles from SiglacasT" : "Characters you can add and message"}</span>
        </div>
        {loading ? (
          <div className="friends-loading tile">
            <div className="spinner" />
            <p>Loading {mode === "users" ? "users" : "AI characters"}...</p>
          </div>
        ) : mode === "users" ? (
          users.length > 0 ? (
            <div className="user-discover-list">
              {users.map((u) => {
                const disabled = u.isFriend || u.outgoingRequestPending || submittingAction === u.id;
                return (
                  <article key={u.id} className="user-discover-card">
                    <button
                      type="button"
                      className="user-discover-main"
                      onClick={() => onOpenUserProfile?.(u.id, u)}
                    >
                      <AvatarWithFrame
                        user={u}
                        src={u.avatarUrl}
                        name={u.name}
                        className="user-discover-avatar-frame"
                        avatarClassName="user-discover-avatar"
                        placeholderClassName="user-discover-avatar placeholder"
                        size="md"
                      />
                      <span className="user-discover-copy">
                        <strong>{u.name || "User"}</strong>
                        <small>{u.statusText || u.course || u.email || "SiglacasT profile"}</small>
                      </span>
                    </button>
                    <div className="user-discover-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onOpenUserProfile?.(u.id, u)}
                      >
                        View
                      </button>
                      {u.isFriend ? (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenDmWithUser?.(u.id)}>
                          Message
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => void handleAddFriend(u.id)}
                          disabled={disabled}
                        >
                          {u.outgoingRequestPending ? "Requested" : submittingAction === u.id ? "Adding..." : "Add"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-section tile">
              <p className="muted small">
                {submittedUserQuery ? "No users found matching your search." : "Type a name, email, or course, then press Search."}
              </p>
            </div>
          )
        ) : activeList.length > 0 ? (
          <div className="ai-discover-grid">
            {filteredCharacters.map((c) => {
              const avatarSrc = c.avatarUrl ? mediaUrl(c.avatarUrl) : null;
              const disabled = c.isFriend || c.outgoingRequestPending || submittingAction === c.id;
              return (
                <div
                  key={c.id}
                  className="ai-discover-card"
                  style={{
                    backgroundImage: avatarSrc && !liteMode ? `url(${avatarSrc})` : "none"
                  }}
                >
                  <div className="ai-discover-card-overlay" />
                  <div className="ai-discover-card-top">
                    <span className="ai-discover-card-badge">AI</span>
                  </div>
                  <div className="ai-discover-card-content">
                    <h3 className="ai-discover-card-name">{c.name}</h3>
                    <p className="ai-discover-card-creator">@{c.creatorName || "System"}</p>
                    {c.bio ? <p className="ai-discover-card-bio" title={c.bio}>{c.bio}</p> : null}
                    <button
                      type="button"
                      className={`ai-discover-card-btn ${disabled ? "ai-discover-card-btn-added" : "ai-discover-card-btn-add"}`}
                      onClick={() => disabled ? onOpenUserProfile?.(c.id, c) : void handleAddFriend(c.id)}
                      disabled={submittingAction === c.id}
                    >
                      {c.isFriend ? "Added" : c.outgoingRequestPending ? "Requested" : submittingAction === c.id ? "Adding..." : "Add as Friend"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-section tile">
            <p className="muted small">No AI characters found matching your search.</p>
          </div>
        )}
      </section>
    </section>
  );
}
