import { useState, useEffect, useCallback, useMemo } from "react";
import { mediaUrl } from "../services/api.js";

export default function AddFriendsPage({
  api,
  currentUser,
  friendIncomingRequests = [],
  onAcceptFriendRequest,
  onRejectFriendRequest,
  onAddFriend,
  onOpenUserProfile,
  onOpenDmWithUser,
  liteMode = false
}) {
  const [discoverData, setDiscoverData] = useState({ online: [], others: [] });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyActive, setShowOnlyActive] = useState(false);
  const [visibleCount, setVisibleCount] = useState(4);
  const [submittingAction, setSubmittingAction] = useState(null); // track user id undergoing action

  const fetchDiscover = useCallback(async () => {
    try {
      const res = await api("/users/discover");
      if (res && !res.error) {
        setDiscoverData(res);
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

  // Handle action wrapping
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

  const handleAccept = async (requestId, friendId) => {
    if (submittingAction) return;
    setSubmittingAction(friendId);
    try {
      await onAcceptFriendRequest(requestId);
      await fetchDiscover();
    } finally {
      setSubmittingAction(null);
    }
  };

  const handleReject = async (requestId, friendId) => {
    if (submittingAction) return;
    setSubmittingAction(friendId);
    try {
      await onRejectFriendRequest(requestId);
      await fetchDiscover();
    } finally {
      setSubmittingAction(null);
    }
  };

  // Combine online and other users for unified display
  const allUsers = useMemo(() => {
    return [...(discoverData.online || []), ...(discoverData.others || [])];
  }, [discoverData]);

  // Filter users based on query and active filter status
  const filteredUsers = useMemo(() => {
    let list = allUsers;

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (u) =>
          u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
      );
    }

    // Filter by Active Now status (availability is online, idle, or dnd)
    if (showOnlyActive) {
      list = list.filter((u) => {
        const presence = u.presence?.presence || (u.presence?.online ? "online" : "offline");
        return presence === "online" || presence === "idle" || presence === "dnd";
      });
    }

    return list;
  }, [allUsers, searchQuery, showOnlyActive]);

  return (
    <section className="panel single add-friends-container">
      {/* Search Header */}
      <div className="add-friends-header tile">
        <h2>Discover Friends</h2>
        <p className="muted small">Add friends to chat, start calls, or share media.</p>
        <div className="search-box-row">
          <div className="search-box-wrap">
            <input
              type="text"
              className="search-box-input"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setVisibleCount(4);
              }}
            />
            {searchQuery && (
              <button
                className="search-clear-btn"
                onClick={() => {
                  setSearchQuery("");
                  setVisibleCount(4);
                }}
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            className={`filter-active-btn ${showOnlyActive ? "active" : ""}`}
            onClick={() => {
              setShowOnlyActive(!showOnlyActive);
              setVisibleCount(4);
            }}
          >
            🟢 Active Now
          </button>
        </div>
      </div>

      {/* Pending Requests Section */}
      {friendIncomingRequests.length > 0 && (
        <section className="friends-section pending-requests-section">
          <h3 className="section-title">Pending Requests ({friendIncomingRequests.length})</h3>
          <div className="friends-grid">
            {friendIncomingRequests.map((req) => {
              const u = req.from;
              if (!u) return null;
              const avatarSrc = u.avatarUrl ? mediaUrl(u.avatarUrl) : null;
              return (
                <div key={req.id} className="friend-card pending-card tile">
                  <div className="friend-info" onClick={() => onOpenUserProfile?.(u.id)}>
                    <div className="avatar-container">
                      {avatarSrc ? (
                        <img className="friend-avatar" src={avatarSrc} alt={u.name} />
                      ) : (
                        <div className="friend-avatar-empty">{u.name?.charAt(0) || "?"}</div>
                      )}
                      {u.presence?.online && <span className="online-badge-dot" />}
                    </div>
                    <div className="friend-details">
                      <h4>{u.name}</h4>
                      <p className="muted xsmall">Sent you a request</p>
                    </div>
                  </div>
                  <div className="friend-actions">
                    <button
                      className="btn btn-primary btn-sm accept-btn"
                      onClick={() => handleAccept(req.id, u.id)}
                      disabled={submittingAction === u.id}
                    >
                      Confirm
                    </button>
                    <button
                      className="btn btn-secondary btn-sm decline-btn"
                      onClick={() => handleReject(req.id, u.id)}
                      disabled={submittingAction === u.id}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Discover Section */}
      <section className="friends-section discover-section">
        <h3 className="section-title">People to Discover ({filteredUsers.length})</h3>
        {loading ? (
          <div className="friends-loading tile">
            <div className="spinner" />
            <p>Finding people nearby...</p>
          </div>
        ) : filteredUsers.length > 0 ? (
          <>
            <div className="discover-list">
              {filteredUsers.slice(0, visibleCount).map((u) => {
                const avatarSrc = u.avatarUrl ? mediaUrl(u.avatarUrl) : null;
                const userPresence = u.presence?.presence || (u.presence?.online ? "online" : "offline");
                return (
                  <div key={u.id} className="friend-card discover-list-card tile">
                    <div className="friend-info" onClick={() => onOpenUserProfile?.(u.id)}>
                      <div className="avatar-container">
                        {avatarSrc ? (
                          <img className="friend-avatar" src={avatarSrc} alt={u.name} />
                        ) : (
                          <div className="friend-avatar-empty">{u.name?.charAt(0) || "?"}</div>
                        )}
                        <span className={`presence-dot-indicator presence-${userPresence}`} />
                      </div>

                      <div className="friend-card-main-content">
                        <div className="friend-card-top-row">
                          <h4 className="friend-card-name">{u.name}</h4>
                          <span className="friend-card-email muted">{u.email}</span>

                          {/* Availability Badge */}
                          <span className={`availability-badge availability-${userPresence}`}>
                            {userPresence.toUpperCase()}
                          </span>
                        </div>

                        {/* Status Note */}
                        {(u.statusEmoji || u.statusNote) && (
                          <div className="friend-card-status-note">
                            <span className="status-emoji">{u.statusEmoji || "💬"}</span>
                            <span className="status-text">{u.statusNote || "No status message"}</span>
                          </div>
                        )}

                        {/* Bio */}
                        {u.bio && <p className="friend-card-bio">{u.bio}</p>}
                      </div>
                    </div>

                    <div className="friend-card-actions-wrapper">
                      {u.isFriend ? (
                        <button className="btn btn-secondary btn-sm friend-status-btn" disabled>
                          ✓ Friends
                        </button>
                      ) : u.incomingRequestId ? (
                        <button
                          className="btn btn-primary btn-sm accept-btn"
                          onClick={() => handleAccept(u.incomingRequestId, u.id)}
                          disabled={submittingAction === u.id}
                        >
                          Confirm
                        </button>
                      ) : u.outgoingRequestPending ? (
                        <button className="btn btn-secondary btn-sm requested-btn" disabled>
                          Requested
                        </button>
                      ) : (
                        <button
                          className="btn btn-primary btn-sm add-btn"
                          onClick={() => handleAddFriend(u.id)}
                          disabled={submittingAction === u.id}
                        >
                          Add as Friend
                        </button>
                      )}

                      {/* Chat Emoji Button next to it */}
                      <button
                        type="button"
                        className="chat-emoji-btn"
                        onClick={() => onOpenDmWithUser?.(u.id)}
                        title={`Chat with ${u.name}`}
                        aria-label={`Chat with ${u.name}`}
                      >
                        💬
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* See More Button */}
            {filteredUsers.length > visibleCount && (
              <div className="see-more-wrapper">
                <button
                  type="button"
                  className="btn btn-secondary see-more-btn"
                  onClick={() => setVisibleCount((prev) => prev + 4)}
                >
                  See More
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="empty-section tile">
            <p className="muted small">No users found.</p>
          </div>
        )}
      </section>
    </section>
  );
}
