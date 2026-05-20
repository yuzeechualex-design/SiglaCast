import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../services/api.js";
import { notificationTargetPath } from "../utils/notificationTargetPath.js";

export default function NotificationsPage({
  notifications,
  token,
  onUnauthorizedRetry,
  onNotificationsUpdated
}) {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState(null);
  const [clearBusy, setClearBusy] = useState(false);

  async function reload() {
    const no = await request("/notifications", { token, onUnauthorizedRetry });
    if (!no.error && Array.isArray(no)) onNotificationsUpdated?.(no);
  }

  function go(notification) {
    const path = notificationTargetPath(notification);
    if (!path) return;
    navigate(path, { replace: false });
  }

  async function deleteOne(id) {
    if (!token || busyId) return;
    setBusyId(id);
    try {
      const res = await request(`/notifications/${encodeURIComponent(id)}`, {
        method: "DELETE",
        token,
        onUnauthorizedRetry
      });
      if (res.error) {
        window.alert(typeof res.error === "string" ? res.error : "Could not delete notification.");
        return;
      }
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function clearAll() {
    if (!token || clearBusy || notifications.length === 0) return;
    if (
      !window.confirm(
        "Clear every notification from your list? This cannot be undone."
      )
    ) {
      return;
    }
    setClearBusy(true);
    try {
      const res = await request("/notifications", {
        method: "DELETE",
        token,
        onUnauthorizedRetry
      });
      if (res.error) {
        window.alert(typeof res.error === "string" ? res.error : "Could not clear notifications.");
        return;
      }
      await reload();
    } finally {
      setClearBusy(false);
    }
  }

  return (
    <section className="panel single">
      <div className="panel-head notifications-panel-head">
        <div className="notifications-head-copy">
          <h2>🔔 Notifications</h2>
          <p>
            Mentions, replies, reactions, messages, announcements, and events. Tap a row to open it — or delete
            individually.
          </p>
        </div>
        {notifications.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost notifications-clear-all-btn"
            disabled={clearBusy}
            onClick={clearAll}
          >
            {clearBusy ? "Clearing…" : "Clear all"}
          </button>
        ) : null}
      </div>
      {notifications.length === 0 ? <p className="muted">No notifications yet.</p> : null}
      <ul className="notification-list">
        {notifications.map((n) => {
          const path = notificationTargetPath(n);
          const clickable = Boolean(path);
          const deleting = busyId === n.id;
          return (
            <li key={n.id} className="notification-list-item">
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
              <button
                type="button"
                className="notification-delete-btn"
                aria-label="Delete notification"
                title="Delete"
                disabled={deleting}
                onClick={() => deleteOne(n.id)}
              >
                {deleting ? "…" : "🗑"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
