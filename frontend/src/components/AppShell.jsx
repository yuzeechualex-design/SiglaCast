import { NavLink } from "react-router-dom";

export default function AppShell({ user, notice, stats, onLogout, children }) {
  return (
    <div className="app">
      <header className="hero">
        <div className="hero-main">
          <p className="eyebrow">Davao Oriental State University</p>
          <h1>SiglaCast</h1>
          <p className="hero-subtitle">
            {user.role === "admin" ? "Admin Operations Dashboard" : "Student Dashboard"} — {user.name}
          </p>
        </div>
        <div className="hero-stats">
          <article className="stat"><span>Open Events</span><strong>{stats.openEvents}</strong></article>
          <article className="stat"><span>Posts</span><strong>{stats.posts}</strong></article>
          <article className="stat"><span>Notifications</span><strong>{stats.notifications}</strong></article>
        </div>
        <div className="nav-row">
          <NavLink to="/" className="nav-btn" end>📊 Dashboard</NavLink>
          <NavLink to="/events" className="nav-btn">📅 Events</NavLink>
          <NavLink to="/community" className="nav-btn">💬 Community</NavLink>
          <NavLink to="/messages" className="nav-btn">✉️ Messages</NavLink>
          <NavLink to="/announcements" className="nav-btn">📣 Announcements</NavLink>
          <NavLink to="/notifications" className="nav-btn">🔔 Notifications</NavLink>
          <NavLink to="/profile" className="nav-btn">👤 Profile</NavLink>
          <button type="button" className="nav-logout" onClick={onLogout}>🚪 Logout</button>
        </div>
        {notice ? <span className="badge hero-badge">{notice}</span> : null}
      </header>
      <main className="grid">{children}</main>
    </div>
  );
}
