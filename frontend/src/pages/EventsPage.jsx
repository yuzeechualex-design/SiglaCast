import { mediaUrl } from "../services/api.js";

export default function EventsPage({
  events,
  onOpenEvent,
  currentUser,
  onDeleteEvent,
  /* Admin-only (optional) — event composer + user list */
  newEventTitle,
  setNewEventTitle,
  newEventDesc,
  setNewEventDesc,
  newEventRules,
  setNewEventRules,
  newEventMaxVotes,
  setNewEventMaxVotes,
  newEventStrategy,
  setNewEventStrategy,
  newEventCandidates,
  setNewEventCandidates,
  newCandidateImageUrls,
  setNewCandidateImageUrls,
  newEventCoverFile,
  setNewEventCoverFile,
  onCreateEvent,
  adminUsers = [],
  onDeleteUser,
  liteMode = false
}) {
  const isAdmin = currentUser?.role === "admin";
  const showAdminTools =
    isAdmin &&
    typeof onCreateEvent === "function" &&
    setNewEventTitle &&
    setNewEventDesc &&
    setNewEventRules &&
    setNewEventMaxVotes &&
    setNewEventStrategy &&
    setNewEventCandidates &&
    setNewCandidateImageUrls &&
    setNewEventCoverFile;

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>📅 Events</h2>
        <p>Open an event for full details, images, live tally bars, and voting.</p>
      </div>

      {showAdminTools ? (
        <div className="composer admin-event-form">
          <h3>➕ Create detailed event</h3>
          <p className="form-hint">
            Set how many times each user may vote, add a cover image, and optional candidate photos (URLs, same order as names).
          </p>

          <label className="field-label">Title</label>
          <input value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Event title" />

          <label className="field-label">Description</label>
          <textarea value={newEventDesc} onChange={(e) => setNewEventDesc(e.target.value)} rows={3} placeholder="What is this event about?" />

          <label className="field-label">Rules & instructions</label>
          <textarea value={newEventRules} onChange={(e) => setNewEventRules(e.target.value)} rows={3} placeholder="Voting rules, eligibility, deadlines…" />

          <div className="form-row">
            <div className="form-col">
              <label className="field-label">Votes per user</label>
              <select value={newEventMaxVotes} onChange={(e) => setNewEventMaxVotes(e.target.value)}>
                <option value="1">1 — one vote only</option>
                <option value="2">2 votes per person</option>
                <option value="3">3 votes per person</option>
                <option value="5">5 votes per person</option>
                <option value="0">Unlimited</option>
              </select>
            </div>
            <div className="form-col">
              <label className="field-label">Tally mode</label>
              <select value={newEventStrategy} onChange={(e) => setNewEventStrategy(e.target.value)}>
                <option value="single">Standard count</option>
                <option value="weighted">Weighted points</option>
              </select>
            </div>
          </div>

          <label className="field-label">Candidates (comma-separated)</label>
          <input value={newEventCandidates} onChange={(e) => setNewEventCandidates(e.target.value)} placeholder="Team A, Team B, Team C" />

          <label className="field-label">Candidate image URLs (optional, comma-aligned)</label>
          <input
            value={newCandidateImageUrls}
            onChange={(e) => setNewCandidateImageUrls(e.target.value)}
            placeholder="/uploads/photo1.jpg, , /uploads/photo3.png"
          />

          <label className="field-label">Cover image (optional)</label>
          <input type="file" accept="image/*" onChange={(e) => setNewEventCoverFile(e.target.files?.[0] || null)} />
          {newEventCoverFile ? <small className="file-picked">Selected: {newEventCoverFile.name}</small> : null}

          <button type="button" className="btn btn-primary" onClick={onCreateEvent}>
            ➕ Publish event
          </button>
        </div>
      ) : null}

      {isAdmin && typeof onDeleteUser === "function" ? (
        <div className="admin-panel">
          <h3>👥 Registered users ({adminUsers.length})</h3>
          <p className="form-hint">Deleting a user removes their posts, comments, votes, messages, and friendships.</p>
          {adminUsers.length === 0 ? (
            <p className="empty-row">No users found.</p>
          ) : (
            <ul className="admin-list">
              {adminUsers.map((u) => (
                <li key={u.id} className="admin-row">
                  <div className="admin-row-main">
                    {u.avatarUrl ? (
                      <img className="admin-thumb" src={mediaUrl(u.avatarUrl)} alt="" />
                    ) : (
                      <div className="admin-thumb placeholder">{u.name?.charAt(0) || "?"}</div>
                    )}
                    <div>
                      <strong>{u.name}</strong>
                      <span className={`pill ${u.role === "admin" ? "pill-admin" : "pill-muted"}`}>{u.role}</span>
                      <div className="muted small">
                        {u.email}
                        {u.course ? ` · ${u.course}` : ""}
                      </div>
                    </div>
                  </div>
                  {u.id !== currentUser?.id ? (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => onDeleteUser?.(u)}>
                      🗑️ Delete
                    </button>
                  ) : (
                    <span className="muted small">— you —</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {events.map((event) => {
        const limit = typeof event.maxVotesPerUser === "number" ? event.maxVotesPerUser : 1;
        const limitLabel = limit === 0 ? "Unlimited votes / person" : `${limit} vote${limit === 1 ? "" : "s"} / person`;
        return (
          <article key={event.id} className="tile event-list-card">
            <div className="event-list-grid">
              {event.coverImageUrl && !liteMode ? (
                <img className="event-list-thumb" src={mediaUrl(event.coverImageUrl)} alt="" />
              ) : (
                <div className="event-list-thumb placeholder">📅</div>
              )}
              <div>
                <div className="tile-head">
                  <h3>{event.title}</h3>
                  <span className={`status ${event.status === "open" ? "status-open" : "status-closed"}`}>{event.status}</span>
                </div>
                <p className="event-list-desc">{event.description}</p>
                <div className="event-list-tags">
                  <span className="pill pill-muted">{limitLabel}</span>
                  <span className="pill pill-muted">{event.strategy === "weighted" ? "Weighted tally" : "Single choice"}</span>
                </div>
                <div className="actions">
                  <button type="button" onClick={() => onOpenEvent(event.id)}>
                    📋 Open detail & vote
                  </button>
                  {isAdmin ? (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => onDeleteEvent?.(event)}>
                      🗑️ Delete event
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
