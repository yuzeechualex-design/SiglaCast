import { mediaUrl } from "../services/api.js";

export default function EventsPage({ events, onOpenEvent, currentUser, onDeleteEvent }) {
  const isAdmin = currentUser?.role === "admin";
  return (
    <section className="panel single">
      <div className="panel-head"><h2>📅 Events</h2><p>Open an event for full details, images, live tally bars, and voting.</p></div>
      {events.map((event) => {
        const limit = typeof event.maxVotesPerUser === "number" ? event.maxVotesPerUser : 1;
        const limitLabel = limit === 0 ? "Unlimited votes / person" : `${limit} vote${limit === 1 ? "" : "s"} / person`;
        return (
          <article key={event.id} className="tile event-list-card">
            <div className="event-list-grid">
              {event.coverImageUrl ? (
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
                  <button type="button" onClick={() => onOpenEvent(event.id)}>📋 Open detail & vote</button>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onDeleteEvent?.(event)}
                    >
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
