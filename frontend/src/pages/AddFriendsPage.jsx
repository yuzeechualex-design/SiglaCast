import { useState, useEffect, useCallback } from "react";
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

  // Filter lists
  const filterUsers = (list) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(
      (u) =>
        u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)
    );
  };

  const onlineFiltered = filterUsers(discoverData.online || []);
  const othersFiltered = filterUsers(discoverData.others || []);

  return (
    <div className="add-friends-container">
      {/* Search Header */}
      <div className="add-friends-header tile">
        <h2>Discover Friends</h2>
        <p className="muted small">Add friends to chat, start calls, or share media.</p>
        <div className="search-box-wrap">
          <input
            type="text"
            className="search-box-input"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery("")}>
              ✕
            </button>
          )}
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

      {/* Main grids */}
      {loading ? (
        <div className="friends-loading tile">
          <div className="spinner" />
          <p>Finding people nearby...</p>
        </div>
      ) : (
        <>
          {/* People Online */}
          <section className="friends-section online-section">
            <h3 className="section-title">Active Now ({onlineFiltered.length})</h3>
            {onlineFiltered.length > 0 ? (
              <div className="friends-grid">
                {onlineFiltered.map((u) => {
                  const avatarSrc = u.avatarUrl ? mediaUrl(u.avatarUrl) : null;
                  return (
                    <div key={u.id} className="friend-card tile">
                      <div className="friend-info" onClick={() => onOpenUserProfile?.(u.id)}>
                        <div className="avatar-container">
                          {avatarSrc ? (
                            <img className="friend-avatar" src={avatarSrc} alt={u.name} />
                          ) : (
                            <div className="friend-avatar-empty">{u.name?.charAt(0) || "?"}</div>
                          )}
                          <span className="online-badge-dot" />
                        </div>
                        <div className="friend-details">
                          <h4>{u.name}</h4>
                          <span className="presence-label">Online</span>
                        </div>
                      </div>
                      <div className="friend-actions">
                        {u.isFriend ? (
                          <button
                            className="btn btn-secondary btn-sm msg-btn"
                            onClick={() => onOpenDmWithUser?.(u.id)}
                          >
                            Chat
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
                            Add Friend
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-section tile">
                <p className="muted small">No active users found.</p>
              </div>
            )}
          </section>

          {/* Offline / Others */}
          <section className="friends-section offline-section">
            <h3 className="section-title">Others ({othersFiltered.length})</h3>
            {othersFiltered.length > 0 ? (
              <div className="friends-grid">
                {othersFiltered.map((u) => {
                  const avatarSrc = u.avatarUrl ? mediaUrl(u.avatarUrl) : null;
                  return (
                    <div key={u.id} className="friend-card tile">
                      <div className="friend-info" onClick={() => onOpenUserProfile?.(u.id)}>
                        <div className="avatar-container">
                          {avatarSrc ? (
                            <img className="friend-avatar" src={avatarSrc} alt={u.name} />
                          ) : (
                            <div className="friend-avatar-empty">{u.name?.charAt(0) || "?"}</div>
                          )}
                        </div>
                        <div className="friend-details">
                          <h4>{u.name}</h4>
                          <span className="presence-label offline">Offline</span>
                        </div>
                      </div>
                      <div className="friend-actions">
                        {u.isFriend ? (
                          <button
                            className="btn btn-secondary btn-sm msg-btn"
                            onClick={() => onOpenDmWithUser?.(u.id)}
                          >
                            Chat
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
                            Add Friend
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-section tile">
                <p className="muted small">No users found.</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
