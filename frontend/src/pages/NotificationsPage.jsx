export default function NotificationsPage({ notifications }) {
  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>🔔 Notifications</h2>
        <p>Mentions, replies, reactions, messages, announcements, and events.</p>
      </div>
      {notifications.length === 0 ? <p className="muted">No notifications yet.</p> : null}
      {notifications.map((n) => (
        <article key={n.id} className="tile notification-tile">
          <div className="notification-tile-top">
            <p className="notification-text">{n.text}</p>
            {typeof n.badgeCount === "number" && n.badgeCount > 1 ? (
              <span className="notification-badge" title={`${n.badgeCount} grouped`}>
                {n.badgeCount}
              </span>
            ) : null}
          </div>
          <small className="notification-meta">
            {new Date(n.createdAt).toLocaleString()}
            {n.kind && n.kind !== "general" ? ` · ${n.kind.replace(/_/g, " ")}` : ""}
          </small>
        </article>
      ))}
    </section>
  );
}
