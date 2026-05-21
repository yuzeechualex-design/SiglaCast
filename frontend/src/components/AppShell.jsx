import { useCallback, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import ThemeToggle from "./ThemeToggle.jsx";
import FloatingQuickNav from "./FloatingQuickNav.jsx";
import NavIcon from "./NavIcon.jsx";

function formatNavPing(n) {
  if (typeof n !== "number" || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

export default function AppShell({
  user,
  notice,
  theme,
  onToggleTheme,
  liteMode = false,
  onToggleLiteMode,
  onRefresh,
  refreshBusy = false,
  children,
  navBadges = { events: 0, messages: 0, announcements: 0, notifications: 0, addFriends: 0 }
}) {
  const ev = formatNavPing(navBadges.events);
  const msg = formatNavPing(navBadges.messages);
  const ann = formatNavPing(navBadges.announcements);
  const bell = formatNavPing(navBadges.notifications);
  const addFriends = formatNavPing(navBadges.addFriends);

  /** Observed so the floating quick-nav dock appears after this block scrolls out of view (long feeds / threads). */
  const dashboardHeaderRef = useRef(null);
  const touchStartY = useRef(null);
  const pullTriggered = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const isPulling = pullDistance > 0 || pullRefreshing || refreshBusy;
  const indicatorOffset = pullRefreshing || refreshBusy ? 42 : Math.min(72, Math.max(0, pullDistance - 8));

  const runPullRefresh = useCallback(async () => {
    if (pullRefreshing || refreshBusy || typeof onRefresh !== "function") return;
    setPullRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setPullRefreshing(false);
      setPullDistance(0);
      pullTriggered.current = false;
    }
  }, [onRefresh, pullRefreshing, refreshBusy]);

  function handleTouchStart(e) {
    if (window.scrollY > 2 || pullRefreshing || refreshBusy) {
      touchStartY.current = null;
      return;
    }
    touchStartY.current = e.touches?.[0]?.clientY ?? null;
    pullTriggered.current = false;
  }

  function handleTouchMove(e) {
    if (touchStartY.current == null || window.scrollY > 2) return;
    const y = e.touches?.[0]?.clientY ?? touchStartY.current;
    const delta = y - touchStartY.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    if (delta > 12) e.preventDefault();
    const next = Math.min(86, delta * 0.55);
    setPullDistance(next);
    pullTriggered.current = next >= 64;
  }

  function handleTouchEnd() {
    if (pullTriggered.current) {
      void runPullRefresh();
      return;
    }
    touchStartY.current = null;
    pullTriggered.current = false;
    setPullDistance(0);
  }

  return (
    <div
      className="app pull-refresh-host"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <div
        className={`pull-refresh-indicator ${isPulling ? "visible" : ""} ${
          pullTriggered.current || pullRefreshing || refreshBusy ? "ready" : ""
        }`}
        style={{ transform: `translate(-50%, ${indicatorOffset}px)` }}
        aria-live="polite"
        aria-label={pullRefreshing || refreshBusy ? "Refreshing" : "Pull to refresh"}
      >
        <span />
      </div>
      <header ref={dashboardHeaderRef} className="hero">
        <div className="hero-main">
          <p className="eyebrow">Community Platform</p>
          <div className="hero-title-row">
            <h1>SiglaCast</h1>
            <div className="hero-mode-actions">
              <button
                type="button"
                className={`lite-toggle ${liteMode ? "active" : ""}`}
                onClick={onToggleLiteMode}
                title={liteMode ? "Lite mode is on" : "Turn on Lite mode"}
              >
                Lite
              </button>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
          </div>
          <p className="hero-subtitle">
            {user.role === "admin" ? "Administrator" : "Student"}{" \u2014 "}{user.name}
          </p>
        </div>
        <div className="nav-row">
          <NavLink to="/community" className="nav-btn">
            <NavIcon name="community" /> Community
          </NavLink>
          <NavLink to="/messages" className="nav-btn">
            <NavIcon name="messages" /> Messages
            {msg ? (
              <span className="nav-ping" aria-label={`${navBadges.messages} unread messages`}>
                {msg}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/add-friends" className="nav-btn">
            <NavIcon name="friends" /> Add Friends
            {addFriends ? (
              <span className="nav-ping" aria-label={`${navBadges.addFriends} pending requests`}>
                {addFriends}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/music" className="nav-btn">
            <NavIcon name="music" /> Music
          </NavLink>
          <NavLink to="/notifications" className="nav-btn">
            <NavIcon name="notifications" /> Notifications
            {bell ? (
              <span className="nav-ping" aria-label={`${navBadges.notifications} unread notifications`}>
                {bell}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/announcements" className="nav-btn">
            <NavIcon name="announcements" /> Announcements
            {ann ? (
              <span className="nav-ping" aria-label={`${navBadges.announcements} new announcements`}>
                {ann}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/events" className="nav-btn">
            <NavIcon name="events" /> Events
            {ev ? (
              <span className="nav-ping" aria-label={`${navBadges.events} open events`}>
                {ev}
              </span>
            ) : null}
          </NavLink>
          <NavLink to="/assistant" className="nav-btn">
            <NavIcon name="assistant" /> Assistant
          </NavLink>
          <NavLink to="/profile" className="nav-btn">
            <NavIcon name="profile" /> Profile
          </NavLink>
          <NavLink to="/settings" className="nav-btn">
            <NavIcon name="settings" /> Settings
          </NavLink>
        </div>
        {notice ? <span className="badge hero-badge">{notice}</span> : null}
      </header>
      <main className="grid">{children}</main>
      <FloatingQuickNav headerRef={dashboardHeaderRef} navBadges={navBadges} />
    </div>
  );
}
