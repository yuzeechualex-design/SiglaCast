import { NavLink } from "react-router-dom";
import ThemeToggle from "./ThemeToggle.jsx";
import { SIGLACAST_AI_USER_ID } from "../constants/sentinelUsers.js";

function formatNavPing(n) {
  if (typeof n !== "number" || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

export default function AppShell({
  user,
  notice,
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
          <div className="hero-title-row">
            <h1>SiglaCast</h1>
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          </div>
          <p className="hero-subtitle">
            {user.role === "admin" ? "Admin Operations Dashboard" : "Student Dashboard"} — {user.name}
          </p>
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
          <NavLink to={{ pathname: "/messages", search: `?dm=${SIGLACAST_AI_USER_ID}` }} className="nav-btn">
            ✨ SiglaCast AI
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
