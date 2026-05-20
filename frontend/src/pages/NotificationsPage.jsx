import { useNavigate } from "react-router-dom";
import { notificationTargetPath } from "../utils/notificationTargetPath.js";

export default function NotificationsPage({ notifications }) {
  const navigate = useNavigate();

  function go(notification) {
    const path = notificationTargetPath(notification);
    if (!path) return;
    navigate(path, { replace: false });
  }

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>🔔 Notifications</h2>
        <p>Mentions, replies, reactions, messages, announcements, and events. Tap a notification to jump to where it happened.</p>
      </div>
      {notifications.length === 0 ? <p className="muted">No notifications yet.</p> : null}
      <ul className="notification-list">
        {notifications.map((n) => {
          const path = notificationTargetPath(n);
          const clickable = Boolean(path);
          return (
            <li key={n.id}>
              <button
                type="button"
                className={`notification-tile ${clickable ? "notification-tile--clickable" : ""}`}
                disabled={!clickable}
                onClick={() => go(n)}
                title={clickable ? `Open · ${path}` : undefined}
              >
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
                  {n.kind && n.kind !== "general" ? ` · ${String(n.kind).replace(/_/g, " ")}` : ""}
                  {clickable ? " · Tap to view" : ""}
                </small>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
