import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { mediaUrl } from "../services/api.js";
import FloatingQuickNav from "./FloatingQuickNav.jsx";
import NavIcon from "./NavIcon.jsx";

function formatNavPing(n) {
  if (typeof n !== "number" || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

export default function AppShell({
  user,
  notice,
  liteMode = false,
  onToggleLiteMode,
  onRefresh,
  refreshBusy = false,
  children,
  navBadges = { events: 0, messages: 0, announcements: 0, notifications: 0, addFriends: 0 }
}) {
  const msg = formatNavPing(navBadges.messages);
  const bell = formatNavPing(navBadges.notifications);
  const addFriends = formatNavPing(navBadges.addFriends);
  const avatarSrc = user?.avatarUrl ? mediaUrl(user.avatarUrl) : "";
  const userInitial = user?.name?.trim()?.charAt(0) || user?.email?.trim()?.charAt(0) || "?";
  const navItems = [
    { to: "/community", icon: "home", label: "Home" },
    { to: "/messages", icon: "messages", label: "Messages", badge: msg, badgeLabel: `${navBadges.messages} unread messages` },
    { to: "/add-friends", icon: "search", label: "Search", badge: addFriends, badgeLabel: `${navBadges.addFriends} pending requests` },
    { to: "/shop", icon: "shop", label: "Shop" },
    { to: "/notifications", icon: "notifications", label: "Notifications", badge: bell, badgeLabel: `${navBadges.notifications} unread notifications` },
    { to: "/characters", icon: "plus", label: "Create" },
    { to: "/profile", icon: "profile", label: "Our profile", profile: true },
    { to: "/settings", icon: "menu", label: "More", bottom: true }
  ];

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    if (notice) {
      setToastMsg(notice);
      setToastVisible(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToastVisible(false);
      }, 4000);
    }
  }, [notice]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleCloseToast = () => {
    setToastVisible(false);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };

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
      <header ref={dashboardHeaderRef} className="hero app-sidebar">
        <div className="nav-row">
          <div className="nav-brand" aria-hidden="true">
            <img src="/assets/siglacast-icon.png" alt="" />
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-btn${item.bottom ? " nav-btn-bottom" : ""}${isActive ? " active" : ""}`}
              title={item.label}
            >
              {item.profile ? (
                <span className="nav-profile-avatar" aria-hidden="true">
                  {avatarSrc ? <img src={avatarSrc} alt="" /> : <span>{userInitial}</span>}
                </span>
              ) : (
                <NavIcon name={item.icon} />
              )}
              <span className="nav-label">{item.label}</span>
              {item.badge ? (
                <span className="nav-ping" aria-label={item.badgeLabel}>
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          ))}
        </div>
      </header>
      <main className="grid">{children}</main>
      <FloatingQuickNav headerRef={dashboardHeaderRef} navBadges={navBadges} />

      {toastVisible && toastMsg && (
        <div className="toast-notification">
          <span className="toast-text">{toastMsg}</span>
          <button className="toast-close-btn" onClick={handleCloseToast} aria-label="Close notification">
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
