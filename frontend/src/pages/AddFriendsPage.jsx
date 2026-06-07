import { useState, useEffect, useCallback, useMemo } from "react";
import { mediaUrl } from "../services/api.js";

export default function AddFriendsPage({
  api,
  onAddFriend,
  onOpenUserProfile,
  liteMode = false
}) {
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittingAction, setSubmittingAction] = useState(null);

  const fetchDiscover = useCallback(async () => {
    try {
      const res = await api("/users/discover");
      if (res && !res.error) {
        // Since we modified backend /users/discover to return AI characters in "online"
        setCharacters(Array.isArray(res.online) ? res.online : []);
      }
    } catch (_) {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchDiscover();
  }, [fetchDiscover]);

  const handleAddFriend = async (friendId) => {
    if (submittingAction) return;
    setSubmittingAction(friendId);
    try {
      await onAddFriend(friendId);
      await fetchDiscover();
    } finally {
      setSubmittingAction(null);
    }
  };

  // Filter characters based on search query
  const filteredCharacters = useMemo(() => {
    if (!searchQuery.trim()) return characters;
    const q = searchQuery.toLowerCase();
    return characters.filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.bio?.toLowerCase().includes(q) ||
        c.creatorName?.toLowerCase().includes(q)
    );
  }, [characters, searchQuery]);

  return (
    <section className="panel single add-friends-container">
      {/* Premium Header */}
      <div className="add-friends-header tile" style={{ marginBottom: "24px" }}>
        <h2>Discover AI Characters</h2>
        <p className="muted small">Explore AI characters, add them as friends to chat, view posts, and interact.</p>
        <div className="search-box-row" style={{ marginTop: "16px" }}>
          <div className="search-box-wrap" style={{ flex: 1 }}>
            <input
              type="text"
              className="search-box-input"
              placeholder="Search by character name or bio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="search-clear-btn"
                onClick={() => setSearchQuery("")}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Grid List */}
      <section className="friends-section discover-section">
        {loading ? (
          <div className="friends-loading tile">
            <div className="spinner" />
            <p>Loading AI Characters...</p>
          </div>
        ) : filteredCharacters.length > 0 ? (
          <div className="ai-discover-grid">
            {filteredCharacters.map((c) => {
              const avatarSrc = c.avatarUrl ? mediaUrl(c.avatarUrl) : null;
              return (
                <div
                  key={c.id}
                  className="ai-discover-card"
                  style={{
                    backgroundImage: avatarSrc && !liteMode ? `url(${avatarSrc})` : "none"
                  }}
                >
                  <div className="ai-discover-card-overlay" />
                  
                  {/* Top Badges */}
                  <div className="ai-discover-card-top">
                    <span className="ai-discover-card-badge">AI</span>
                  </div>

                  {/* Card Content Overlay */}
                  <div className="ai-discover-card-content">
                    <h3 className="ai-discover-card-name">{c.name}</h3>
                    <p className="ai-discover-card-creator">@{c.creatorName || "System"}</p>
                    
                    {c.bio && <p className="ai-discover-card-bio" title={c.bio}>{c.bio}</p>}

                    {c.isFriend ? (
                      <button
                        type="button"
                        className="ai-discover-card-btn ai-discover-card-btn-added"
                        disabled
                      >
                        ✓ Added
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ai-discover-card-btn ai-discover-card-btn-add"
                        onClick={() => void handleAddFriend(c.id)}
                        disabled={submittingAction === c.id}
                      >
                        {submittingAction === c.id ? "Adding..." : "Add as Friend"}
                      </button>
                    )}
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
