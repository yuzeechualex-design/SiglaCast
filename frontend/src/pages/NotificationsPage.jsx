export default function NotificationsPage({ notifications }) {
  return (
    <section className="panel single">
      <div className="panel-head"><h2>🔔 Notifications</h2><p>Personal activity and system updates.</p></div>
      {notifications.map((n) => (
        <article key={n.id} className="tile">
          <p>{n.text}</p>
          <small>{new Date(n.createdAt).toLocaleString()}</small>
        </article>
      ))}
    </section>
  );
}
