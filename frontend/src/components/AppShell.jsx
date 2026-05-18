import { NavLink } from "react-router-dom";
import ThemeToggle from "./ThemeToggle.jsx";

function formatNavPing(n) {
  if (typeof n !== "number" || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

export default function AppShell({
  user,
  notice,
  stats,
  onLogout,
  theme,
  onToggleTheme,
  children,
  navBadges = { events: 0, messages: 0, announcements: 0, notifications: 0 }
}) {
  const ev = formatNavPing(navBadges.events);
  const msg = formatNavPing(navBadges.messages);
  const ann = formatNavPing(navBadges.announcements);
  const bell = formatNavPing(navBadges.notifications);

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-main">
          <p className="eyebrow">Davao Oriental State University</p>
          <h1>SiglaCast</h1>
          <p className="hero-subtitle">
            {user.role === "admin" ? "Admin Operations Dashboard" : "Student Dashboard"} — {user.name}
          </p>
          <div className="hero-theme-row">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="hero-stats">
          <article className="stat"><span>Open Events</span><strong>{stats.openEvents}</strong></article>
          <article className="stat"><span>Posts</span><strong>{stats.posts}</strong></article>
          <article className="stat"><span>Notifications</span><strong>{stats.notifications}</strong></article>
        </div>
        <div className="nav-row">
          <NavLink to="/" className="nav-btn" end>📊 Dashboard</NavLink>
          <NavLink to="/events" className="nav-btn">
            📅 Events
            {ev ? (
              <span className="nav-ping" aria-label={`${navBadges.events} open events`}>
                {ev}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/community" className="nav-btn">💬 Community</NavLink>
          <NavLink to="/messages" className="nav-btn">
            ✉️ Messages
            {msg ? (
              <span className="nav-ping" aria-label={`${navBadges.messages} unread messages`}>
                {msg}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/announcements" className="nav-btn">
            📣 Announcements
            {ann ? (
              <span className="nav-ping" aria-label={`${navBadges.announcements} new announcements`}>
                {ann}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/notifications" className="nav-btn">
            🔔 Notifications
            {bell ? (
              <span className="nav-ping" aria-label={`${navBadges.notifications} unread notifications`}>
                {bell}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/profile" className="nav-btn">👤 Profile</NavLink>
          <button type="button" className="nav-logout" onClick={onLogout}>🚪 Logout</button>
        </div>
        {notice ? <span className="badge hero-badge">{notice}</span> : null}
      </header>
      <main className="grid">{children}</main>
    </div>
  );
}
