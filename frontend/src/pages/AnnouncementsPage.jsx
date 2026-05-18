import { useEffect } from "react";

export default function AnnouncementsPage({
  user,
  announcements,
  newAnnouncementTitle,
  setNewAnnouncementTitle,
  newAnnouncementMessage,
  setNewAnnouncementMessage,
  onCreateAnnouncement,
  onDeleteAnnouncement,
  onVisited
}) {
  const isAdmin = user.role === "admin";

  useEffect(() => {
    if (!announcements.length) return;
    onVisited?.(announcements);
  }, [announcements, onVisited]);
  return (
    <section className="panel single">
        <div className="panel-head"><h2>📣 Announcements</h2><p>Official event broadcasts and updates.</p></div>
      {isAdmin && (
        <div className="composer">
          <input value={newAnnouncementTitle} onChange={(e) => setNewAnnouncementTitle(e.target.value)} placeholder="Announcement title" />
          <textarea value={newAnnouncementMessage} onChange={(e) => setNewAnnouncementMessage(e.target.value)} placeholder="Announcement message" />
          <button onClick={onCreateAnnouncement}>📤 Publish Announcement</button>
        </div>
      )}
      {announcements.map((a) => (
        <article key={a.id} className="tile">
          <h3>{a.title}</h3>
          <p>{a.message}</p>
          <small>{new Date(a.createdAt).toLocaleString()}</small>
          {isAdmin && onDeleteAnnouncement ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onDeleteAnnouncement(a)}
              >
                🗑️ Delete
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
