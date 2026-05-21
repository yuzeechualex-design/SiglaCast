import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import NavIcon from "./NavIcon.jsx";

function formatNavPing(n) {
  if (typeof n !== "number" || n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

/** Fixed dock that mirrors primary nav once the dashboard header scrolls off-screen - no replacement of the hero nav. */
export default function FloatingQuickNav({
  headerRef,
  navBadges = { events: 0, messages: 0, announcements: 0, notifications: 0 }
}) {
  const [show, setShow] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const location = useLocation();

  /** Re-evaluate when route changes - header intersection may stay stale otherwise. */
  useEffect(() => {
    const hdr = headerRef?.current;
    if (!hdr || typeof window === "undefined") return undefined;
    // Next frame - layout after route transition may shift scroll.
    const id = window.requestAnimationFrame(() => {
      try {
        const rect = hdr.getBoundingClientRect();
        const intersects = rect.bottom > 12 && rect.top < window.innerHeight - 24;
        setShow(!intersects);
      } catch (_) {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [headerRef, location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = headerRef?.current;
    if (!el) return undefined;
    const obs = new IntersectionObserver(
      ([e]) => {
        setShow(!e.isIntersecting);
      },
      { root: null, rootMargin: "-12px 0px 0px 0px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [headerRef]);

  /** Keep last thread from covering inputs when the dock is visible. */
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (!show) {
      document.body.classList.remove("floating-quick-nav-open");
      return undefined;
    }
    document.body.classList.add("floating-quick-nav-open");
    return () => document.body.classList.remove("floating-quick-nav-open");
  }, [show]);

  const ev = formatNavPing(navBadges.events);
  const msg = formatNavPing(navBadges.messages);
  const ann = formatNavPing(navBadges.announcements);
  const bell = formatNavPing(navBadges.notifications);
  const addFriends = formatNavPing(navBadges.addFriends);

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    headerRef?.current?.scrollIntoView?.({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }

  if (!show) return null;

  return (
    <div className="floating-quick-nav-shell" aria-label="Quick navigation (appears while scrolled)">
      <nav className="floating-quick-nav" role="navigation">
        <div className="floating-quick-nav-inner">
          <button type="button" className="floating-quick-top" onClick={scrollToTop} title="Scroll to top">
            {"\u2191"} Top
          </button>
          <div className="floating-quick-links">
            <NavLink to="/community" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="community" />
              <span className="fq-label">Community</span>
            </NavLink>
            <NavLink to="/messages" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="messages" />
              {msg ? <span className="fq-ping">{msg}</span> : null}
              <span className="fq-label">Messages</span>
            </NavLink>
            <NavLink to="/add-friends" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="friends" />
              {addFriends ? <span className="fq-ping">{addFriends}</span> : null}
              <span className="fq-label">Add Friends</span>
            </NavLink>
            <NavLink to="/music" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="music" />
              <span className="fq-label">Music</span>
            </NavLink>
            <NavLink to="/notifications" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="notifications" />
              {bell ? <span className="fq-ping">{bell}</span> : null}
              <span className="fq-label">Alerts</span>
            </NavLink>
            <NavLink to="/announcements" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="announcements" />
              {ann ? <span className="fq-ping">{ann}</span> : null}
              <span className="fq-label">News</span>
            </NavLink>
            <NavLink to="/events" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="events" />
              {ev ? <span className="fq-ping">{ev}</span> : null}
              <span className="fq-label">Events</span>
            </NavLink>
            <NavLink to="/assistant" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="assistant" />
              <span className="fq-label">Assistant</span>
            </NavLink>
            <NavLink to="/profile" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="profile" />
              <span className="fq-label">Profile</span>
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `fq-link${isActive ? " fq-active" : ""}`}>
              <NavIcon name="settings" />
              <span className="fq-label">Settings</span>
            </NavLink>
          </div>
        </div>
      </nav>
    </div>
  );
}
