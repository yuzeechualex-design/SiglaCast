import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { request, requestForm } from "./services/api.js";
import AppShell from "./components/AppShell.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import EventDetailPage from "./pages/EventDetailPage.jsx";
import CommunityPage from "./pages/CommunityPage.jsx";
import AnnouncementsPage from "./pages/AnnouncementsPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import { normalizeRegistrationEmail, validateRegisterForm } from "./utils/registerValidation.js";

const STORAGE_SEEN_ANNOUNCEMENT_IDS = "siglacast_seen_announcement_ids";

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [course, setCourse] = useState("BSIT");
  const [token, setToken] = useState(() => localStorage.getItem("siglacast_token") || "");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("siglacast_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [events, setEvents] = useState([]);
  const [posts, setPosts] = useState([]);
  const [notice, setNotice] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState("");
  const [newAnnouncementMessage, setNewAnnouncementMessage] = useState("");
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDesc, setNewEventDesc] = useState("");
  const [newEventRules, setNewEventRules] = useState("");
  const [newEventMaxVotes, setNewEventMaxVotes] = useState("1");
  const [newEventStrategy, setNewEventStrategy] = useState("single");
  const [newEventCandidates, setNewEventCandidates] = useState("Team Blue, Team Gold");
  const [newCandidateImageUrls, setNewCandidateImageUrls] = useState("");
  const [newEventCoverFile, setNewEventCoverFile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [friendIncomingRequests, setFriendIncomingRequests] = useState([]);
  /** Idle / waiting / matched state for sidebar + anonymous thread (polled on /messages). */
  const [userPhoneState, setUserPhoneState] = useState({
    phase: "idle",
    sessionId: null,
    messages: [],
    waitExpiresAt: null,
    waitStartedAt: null
  });
  const [activeChat, setActiveChat] = useState(null);
  const STORAGE_USERPHONE_AUTO_QUEUE = "siglacast_userphone_auto_queue";
  const [userPhoneAutoReconnect, setUserPhoneAutoReconnect] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_USERPHONE_AUTO_QUEUE) === "1";
    } catch (_) {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_USERPHONE_AUTO_QUEUE, userPhoneAutoReconnect ? "1" : "0");
    } catch (_) { /* ignore */ }
  }, [userPhoneAutoReconnect]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [peopleSearchHint, setPeopleSearchHint] = useState("");
  const [adminUsers, setAdminUsers] = useState([]);
  /** Bumps nav badge calculations after localStorage changes (announcements seen). */
  const [navBadgeTick, setNavBadgeTick] = useState(0);

  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("siglacast_theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch (_) { /* ignore */ }
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  });

  // Reflect theme on <html> so every page (including auth) picks it up.
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    try { localStorage.setItem("siglacast_theme", theme); } catch (_) { /* ignore */ }
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  async function refreshSession() {
    if (isRefreshing) return null;
    const refreshToken = localStorage.getItem("siglacast_refresh_token");
    if (!refreshToken) return null;

    setIsRefreshing(true);
    const refreshed = await request("/auth/refresh", {
      method: "POST",
      body: { refreshToken }
    });
    setIsRefreshing(false);

    if (refreshed.error || !refreshed.accessToken) return null;
    setToken(refreshed.accessToken);
    if (refreshed.user) setUser(refreshed.user);
    localStorage.setItem("siglacast_token", refreshed.accessToken);
    localStorage.setItem("siglacast_refresh_token", refreshed.refreshToken);
    if (refreshed.user) localStorage.setItem("siglacast_user", JSON.stringify(refreshed.user));
    return refreshed.accessToken;
  }

  const onUnauthorizedRetry = async () => {
    const newToken = await refreshSession();
    if (!newToken) return null;
    return { retryWithToken: newToken };
  };

  const api = (path, options) =>
    request(path, {
      token,
      ...(options || {}),
      onUnauthorizedRetry
    });

  const apiForm = (path, formData, method = "POST") =>
    requestForm(path, {
      token,
      formData,
      method,
      onUnauthorizedRetry
    });

  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;
  const userPhoneAutoReconnectRef = useRef(userPhoneAutoReconnect);
  userPhoneAutoReconnectRef.current = userPhoneAutoReconnect;
  const userphoneReconnectBusyRef = useRef(false);

  function snapshotUserPhoneState(st) {
    return {
      phase: st.phase,
      sessionId: st.sessionId || null,
      messages: Array.isArray(st.messages) ? st.messages : [],
      waitExpiresAt: st.waitExpiresAt ?? null,
      waitStartedAt: st.waitStartedAt ?? null
    };
  }

  /** Apply `/userphone/state` or `/userphone/start` payload; optionally chain retries when auto-queue is on. */
  function applyUserPhoneServerPayload(st) {
    if (st.error || !st.phase) {
      if (st.error) setNotice(st.error);
      return null;
    }
    const next = snapshotUserPhoneState(st);
    setUserPhoneState(next);
    if (!st.waitTimedOut) return next;

    const allowAutoChain =
      userPhoneAutoReconnectRef.current &&
      pathnameRef.current === "/messages" &&
      activeChatRef.current?.kind === "userphone";

    if (allowAutoChain) {
      setNotice("No match yet — staying in queue…");
      if (!userphoneReconnectBusyRef.current) void runUserPhoneAutoReconnectLoop();
    } else {
      setNotice("No one joined in 10 seconds. Tap Call anonymous to try again.");
    }
    return next;
  }

  async function runUserPhoneAutoReconnectLoop() {
    if (userphoneReconnectBusyRef.current) return;
    if (
      !userPhoneAutoReconnectRef.current ||
      pathnameRef.current !== "/messages" ||
      activeChatRef.current?.kind !== "userphone"
    ) {
      return;
    }
    userphoneReconnectBusyRef.current = true;
    try {
      await new Promise((r) => setTimeout(r, 500));
      while (
        userPhoneAutoReconnectRef.current &&
        pathnameRef.current === "/messages" &&
        activeChatRef.current?.kind === "userphone"
      ) {
        const res = await api("/userphone/start", { method: "POST", body: {} });
        if (res.error || !res.phase) {
          if (res.error) setNotice(res.error);
          break;
        }
        setUserPhoneState(snapshotUserPhoneState(res));
        if (!res.waitTimedOut) break;
        if (!userPhoneAutoReconnectRef.current) break;
        setNotice("No match yet — staying in queue…");
        await new Promise((r) => setTimeout(r, 450));
      }
    } finally {
      userphoneReconnectBusyRef.current = false;
    }
  }

  async function refreshUserPhoneFromServer() {
    const st = await api("/userphone/state");
    return applyUserPhoneServerPayload(st);
  }

  /** Re-render sidebar countdown while queued (server poll ~1.1s; this ticks every 250ms for smooth list text). */
  const [userphoneTick, setUserphoneTick] = useState(0);
  useEffect(() => {
    if (userPhoneState.phase !== "waiting") return undefined;
    const id = setInterval(() => setUserphoneTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [userPhoneState.phase]);

  const conversationsWithUserphone = useMemo(() => {
    const lp =
      userPhoneState.phase === "matched" &&
      Array.isArray(userPhoneState.messages) &&
      userPhoneState.messages.length > 0
        ? userPhoneState.messages[userPhoneState.messages.length - 1]
        : null;
    let lastMessage;
    if (lp) {
      lastMessage = {
        text: lp.fromMe ? `You: ${lp.text}` : lp.text || "",
        createdAt: lp.createdAt,
        fromMe: !!lp.fromMe
      };
    } else if (userPhoneState.phase === "waiting") {
      let sub = "Searching…";
      if (userPhoneState.waitExpiresAt) {
        const left = Math.max(
          0,
          Math.ceil((new Date(userPhoneState.waitExpiresAt).getTime() - Date.now()) / 1000)
        );
        sub = `Searching… ${left}s until queue resets`;
      }
      lastMessage = {
        text: sub,
        createdAt: new Date().toISOString(),
        fromMe: false
      };
    } else {
      lastMessage = {
        text: userPhoneAutoReconnect ? "Auto-queue on — tap Call anonymous" : "Tap Call anonymous",
        createdAt: new Date(0).toISOString(),
        fromMe: false
      };
    }
    return [
      {
        kind: "userphone",
        id: "userphone",
        user: { id: "userphone", name: "Userphone", email: "", course: "", avatarUrl: null },
        isFriend: false,
        lastMessage,
        unreadCount: 0
      },
      ...(conversations || [])
    ];
  }, [conversations, userPhoneState.phase, userPhoneState.messages, userPhoneState.waitExpiresAt, userphoneTick, userPhoneAutoReconnect]);

  async function loadCore() {
    if (!token) return;
    const [ev, po] = await Promise.all([
      api("/events"),
      api("/community/posts")
    ]);
    setEvents(Array.isArray(ev) ? ev : []);
    setPosts(Array.isArray(po) ? po : []);
  }

  async function loadRoleDashboard() {
    if (!token || !user) return;
    const endpoint = user.role === "admin" ? "/dashboard/admin" : "/dashboard/student";
    const data = await api(endpoint);
    setDashboard(data?.metrics ? data : null);
  }

  async function loadAdminUsers() {
    if (!token || !user || user.role !== "admin") {
      setAdminUsers([]);
      return;
    }
    const list = await api("/admin/users");
    if (!list.error && Array.isArray(list)) setAdminUsers(list);
  }

  async function loadComms() {
    if (!token) return;
    const [an, no] = await Promise.all([api("/announcements"), api("/notifications")]);
    setAnnouncements(Array.isArray(an) ? an : []);
    setNotifications(Array.isArray(no) ? no : []);
  }

  async function loadAll() {
    await Promise.all([loadCore(), loadComms(), loadRoleDashboard(), loadAdminUsers()]);
  }

  useEffect(() => {
    loadAll();
  }, [token, user?.role]);

  // First load: baseline current announcements as "already seen" so only new rows ping the nav.
  useEffect(() => {
    if (!announcements.length) return;
    try {
      if (!localStorage.getItem(STORAGE_SEEN_ANNOUNCEMENT_IDS)) {
        localStorage.setItem(STORAGE_SEEN_ANNOUNCEMENT_IDS, JSON.stringify(announcements.map((a) => a.id)));
        setNavBadgeTick((t) => t + 1);
      }
    } catch (_) { /* ignore */ }
  }, [announcements]);

  const markAnnouncementsSeen = useCallback((list) => {
    if (!Array.isArray(list) || !list.length) return;
    try {
      const raw = localStorage.getItem(STORAGE_SEEN_ANNOUNCEMENT_IDS);
      let prev = [];
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        prev = Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        prev = [];
      }
      const merged = [...new Set([...prev, ...list.map((a) => a.id)])];
      localStorage.setItem(STORAGE_SEEN_ANNOUNCEMENT_IDS, JSON.stringify(merged));
      setNavBadgeTick((t) => t + 1);
    } catch (_) { /* ignore */ }
  }, []);

  const navBadges = useMemo(() => {
    let announcementUnseen = 0;
    try {
      const raw = localStorage.getItem(STORAGE_SEEN_ANNOUNCEMENT_IDS);
      if (!raw) announcementUnseen = 0;
      else {
        const seen = new Set(JSON.parse(raw));
        announcementUnseen = announcements.filter((a) => a.id && !seen.has(a.id)).length;
      }
    } catch {
      announcementUnseen = announcements.length;
    }

    const notificationUnread = notifications.filter((n) => n.read !== true).length;
    const messagesUnread = conversations.reduce((acc, c) => acc + (Number(c.unreadCount) || 0), 0);
    const openEvents = events.filter((e) => e.status === "open").length;

    return {
      announcements: announcementUnseen,
      notifications: notificationUnread,
      messages: messagesUnread,
      events: openEvents
    };
  }, [announcements, notifications, conversations, events, navBadgeTick]);

  // ---------- Desktop / mobile push notifications ----------
  // We use the browser Notifications API. On first sign-in we politely request
  // permission; afterwards, every time the polled notifications list grows we
  // surface a system notification for each newly-seen item.
  const seenNotificationIds = useRef(new Set());
  const askedNotificationPermission = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (askedNotificationPermission.current) return;
    askedNotificationPermission.current = true;
    if (Notification.permission === "default") {
      // Defer to avoid the prompt blocking initial render.
      setTimeout(() => {
        Notification.requestPermission().catch(() => {});
      }, 1500);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      // Still track ids so a later permission grant doesn't flood old items.
      for (const n of notifications) seenNotificationIds.current.add(n.id);
      return;
    }
    // First time we see notifications after login: seed the seen-set silently
    // so we don't spam the desktop with backlogged items.
    if (seenNotificationIds.current.size === 0) {
      for (const n of notifications) seenNotificationIds.current.add(n.id);
      return;
    }
    const PUSH_KINDS = new Set([
      "mention",
      "reaction_post",
      "reaction_comment",
      "reaction_message",
      "reply_comment",
      "reply_message",
      "dm",
      "announcement",
      "event",
      "friend_request"
    ]);
    for (const n of notifications) {
      if (seenNotificationIds.current.has(n.id)) continue;
      seenNotificationIds.current.add(n.id);
      const kind = n.kind || "general";
      if (!PUSH_KINDS.has(kind)) continue;
      try {
        const body =
          typeof n.badgeCount === "number" && n.badgeCount > 1
            ? `${n.text} (${n.badgeCount})`
            : n.text || "Activity";
        const notif = new Notification("SiglaCast", { body, tag: n.id });
        notif.onclick = () => {
          window.focus();
        };
      } catch (_) {
        /* some browsers block unless served from a SW */
      }
    }
  }, [notifications, user]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      const res = await api("/auth/me");
      if (res.error) {
        localStorage.removeItem("siglacast_token");
        localStorage.removeItem("siglacast_refresh_token");
        localStorage.removeItem("siglacast_user");
        setToken("");
        setUser(null);
        setNotice("Session expired. Please login again.");
      }
    })();
  }, [token]);

  async function loadMessages() {
    if (!token) return;
    const [list, reqs] = await Promise.all([api("/messages/conversations"), api("/friend-requests")]);
    if (!list.error) setConversations(Array.isArray(list) ? list : []);
    if (!reqs.error && Array.isArray(reqs)) setFriendIncomingRequests(reqs);
    else setFriendIncomingRequests([]);
  }

  useEffect(() => {
    if (!token) return undefined;
    async function beat() {
      await api("/presence/heartbeat", { method: "POST", body: {} });
    }
    beat();
    const iv = setInterval(beat, 25000);
    return () => clearInterval(iv);
  }, [token]);

  // Poll DM unread counts for nav badge even when Messages tab is inactive.
  useEffect(() => {
    if (!token) return undefined;
    loadMessages();
    const interval = setInterval(loadMessages, 6000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(loadComms, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Clearing the bell badge: visiting Notifications marks all current rows read; new inserts stay unread.
  useEffect(() => {
    if (!token || location.pathname !== "/notifications") return undefined;
    let cancelled = false;
    (async () => {
      const res = await request("/notifications/read-all", {
        method: "POST",
        body: {},
        token,
        onUnauthorizedRetry
      });
      if (cancelled || res.error) return;
      const no = await request("/notifications", { token, onUnauthorizedRetry });
      if (cancelled || no.error || !Array.isArray(no)) return;
      setNotifications(no);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, location.pathname]);

  // Userphone pairing + messages poll while Messages screen is open
  useEffect(() => {
    if (!token || location.pathname !== "/messages") return undefined;
    let cancelled = false;
    async function poll() {
      const st = await api("/userphone/state");
      if (cancelled || st.error || !st.phase) return;
      applyUserPhoneServerPayload(st);
    }
    poll();
    const iv = setInterval(poll, 1100);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [token, location.pathname]);

  useEffect(() => {
    setActiveChat((prev) => {
      if (!prev || prev.kind !== "userphone") return prev;
      return {
        ...prev,
        phase: userPhoneState.phase,
        sessionId: userPhoneState.sessionId,
        messages: userPhoneState.messages,
        waitExpiresAt: userPhoneState.waitExpiresAt,
        waitStartedAt: userPhoneState.waitStartedAt
      };
    });
  }, [userPhoneState]);

  // Poll the active thread every 3 seconds while the page is open (not Userphone / AI).
  useEffect(() => {
    if (!token || !activeChat || location.pathname !== "/messages") return undefined;
    if (activeChat.kind === "userphone") return undefined;
    const interval = setInterval(async () => {
      const refreshed =
        activeChat.kind === "group"
          ? await api(`/groups/${activeChat.group.id}`)
          : await api(`/messages/with/${activeChat.user.id}`);
      if (refreshed.error) return;
      setActiveChat({ ...refreshed, kind: activeChat.kind });
    }, 3000);
    return () => clearInterval(interval);
  }, [token, activeChat?.kind, activeChat?.user?.id, activeChat?.group?.id, location.pathname]);

  useEffect(() => {
    if (!token || !selectedEventId || location.pathname !== "/events/detail") return undefined;
    const interval = setInterval(async () => {
      const ev = await api(`/events/${selectedEventId}`);
      if (!ev.error) setSelectedEvent(ev);
    }, 2000);
    return () => clearInterval(interval);
  }, [token, selectedEventId, location.pathname]);

  async function login() {
    if (loadingAuth) return;
    setLoadingAuth(true);
    const res = await api("/auth/login", {
      method: "POST",
      body: { email: normalizeRegistrationEmail(email), password }
    });
    if (res.error) {
      setNotice(res.error);
    } else {
      setToken(res.token);
      setUser(res.user);
      localStorage.setItem("siglacast_token", res.token);
      localStorage.setItem("siglacast_refresh_token", res.refreshToken);
      localStorage.setItem("siglacast_user", JSON.stringify(res.user));
      setNotice(`Logged in as ${res.user.role}`);
      navigate("/");
    }
    setLoadingAuth(false);
  }

  async function register(registrationPayload) {
    if (loadingAuth) return;
    const source = registrationPayload ?? { name, email, password, course };
    const v = validateRegisterForm(source);
    if (!v.ok) {
      setNotice([...new Set(Object.values(v.fieldErrors))].join(" "));
      return;
    }
    setLoadingAuth(true);
    const { name: regName, email: regEmail, password: regPassword, course: regCourse } = v.normalized;
    const res = await api("/auth/register", {
      method: "POST",
      body: { name: regName, email: regEmail, password: regPassword, course: regCourse }
    });
    setNotice(res.error || "Registration successful. Please login.");
    if (!res.error) setMode("login");
    setLoadingAuth(false);
  }

  async function vote(eventId, candidateId) {
    const res = await api("/events/vote", {
      method: "POST",
      body: { eventId, candidateId, weight: 1 }
    });
    setNotice(res.error || "Vote submitted");
    if (!res.error) {
      await loadAll();
      if (selectedEventId === eventId) {
        const ev = await api(`/events/${eventId}`);
        if (!ev.error) setSelectedEvent(ev);
      }
    }
  }

  async function openEvent(eventId) {
    const event = await api(`/events/${eventId}`);
    if (event.error) return setNotice(event.error);
    setSelectedEvent(event);
    setSelectedEventId(eventId);
    navigate("/events/detail");
  }

  async function postCommunityPost({ content, imageFile }) {
    const formData = new FormData();
    formData.append("content", content || "");
    if (imageFile) formData.append("image", imageFile);
    const res = await apiForm("/community/posts", formData);
    setNotice(res.error || "Post published");
    if (!res.error) await loadCore();
  }

  async function reactToPost(postId, reaction) {
    // reaction can be one of: "like", "love", "haha", "wow", "sad", "angry", null (clear)
    const res = await api(`/community/posts/${postId}/react`, {
      method: "POST",
      body: { reaction: reaction === undefined ? "like" : reaction }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    // Backend returns the updated post — patch it into local state without a full reload.
    setPosts((prev) => prev.map((p) => (p.id === res.id ? res : p)));
  }

  // Post a comment (or reply). `payload` is either a plain string (legacy) or
  // an object { text, photo } so callers can attach a single image.
  async function commentOnPost(postId, payload, parentId = null) {
    const isObj = payload && typeof payload === "object" && !Array.isArray(payload);
    const text = isObj ? (payload.text || "") : String(payload || "");
    const photo = isObj ? payload.photo : null;

    let res;
    if (photo) {
      const formData = new FormData();
      formData.append("text", text);
      if (parentId) formData.append("parentId", parentId);
      formData.append("image", photo);
      res = await apiForm(`/community/posts/${postId}/comments`, formData);
    } else {
      res = await api(`/community/posts/${postId}/comments`, {
        method: "POST",
        body: { text, parentId }
      });
    }
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice(parentId ? "Reply posted" : "Comment added");
    if (res.post) {
      setPosts((prev) => prev.map((p) => (p.id === res.post.id ? res.post : p)));
    } else {
      await loadCore();
    }
  }

  // Delete a comment (author + admin). Returns the updated post.
  async function deleteComment(comment) {
    if (!comment?.id) return;
    const res = await api(`/community/comments/${comment.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Comment deleted");
    setPosts((prev) => prev.map((p) => (p.id === res.id ? res : p)));
  }

  // Toggle a heart-like on a single comment. Backend returns the patched post.
  async function reactToComment(commentId, reaction) {
    const res = await api(`/community/comments/${commentId}/react`, {
      method: "POST",
      body: { reaction }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setPosts((prev) => prev.map((p) => (p.id === res.id ? res : p)));
  }

  async function saveProfile(payload) {
    const res = await api("/profile", { method: "PATCH", body: payload });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.user) {
      setUser(res.user);
      localStorage.setItem("siglacast_user", JSON.stringify(res.user));
    }
    setNotice("Profile updated");
  }

  async function searchUsers() {
    const q = searchQuery.trim();
    setPeopleSearchHint("");
    if (!q) {
      setSearchResults([]);
      return;
    }
    const res = await api(`/users/search?q=${encodeURIComponent(q)}`);
    if (res.error) {
      setSearchResults([]);
      setNotice(res.error);
      return;
    }
    if (!Array.isArray(res)) {
      setSearchResults([]);
      setNotice("Could not load search results.");
      return;
    }
    setSearchResults(res);
    if (!res.length) {
      setPeopleSearchHint(`No users matched "${q}". Try another name or email.`);
    }
  }

  async function addFriend(friendId) {
    const res = await api(`/friends/${friendId}`, { method: "POST" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.pending) {
      setNotice(res.message || "Friend request sent");
    } else {
      setNotice(res.matched ? "You’re now friends" : "Friend added");
    }
    await loadMessages();
    await searchUsers();
    if (
      activeChat?.kind !== "group" &&
      activeChat?.kind !== "userphone" &&
      activeChat?.user?.id === friendId
    ) {
      const thread = await api(`/messages/with/${friendId}`);
      if (!thread.error) setActiveChat({ ...thread, kind: "dm" });
    }
  }

  async function acceptFriendRequest(requestId) {
    const res = await api(`/friend-requests/${requestId}/accept`, {
      method: "POST",
      body: {}
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Friend added");
    await loadMessages();
    await searchUsers();
    const fid = res.friend?.id;
    if (fid && activeChat?.kind === "dm" && activeChat?.user?.id === fid) {
      const thread = await api(`/messages/with/${fid}`);
      if (!thread.error) setActiveChat({ ...thread, kind: "dm" });
    }
  }

  async function rejectFriendRequest(requestId) {
    const res = await api(`/friend-requests/${requestId}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Request declined");
    await loadMessages();
    await searchUsers();
    if (activeChat?.kind === "dm" && activeChat?.incomingRequestId === requestId) {
      const thread = await api(`/messages/with/${activeChat.user.id}`);
      if (!thread.error) setActiveChat({ ...thread, kind: "dm" });
    }
  }

  async function openChat(kind, id) {
    setPeopleSearchHint("");
    if (kind === "group") {
      const thread = await api(`/groups/${id}`);
      if (thread.error) return setNotice(thread.error);
      setActiveChat({ ...thread, kind: "group" });
    } else if (kind === "userphone") {
      const next = await refreshUserPhoneFromServer();
      if (!next) return setNotice("Could not load Userphone");
      setActiveChat({
        kind: "userphone",
        phase: next.phase,
        sessionId: next.sessionId,
        messages: next.messages || [],
        waitExpiresAt: next.waitExpiresAt ?? null,
        waitStartedAt: next.waitStartedAt ?? null
      });
      setSearchResults([]);
      await loadMessages();
      return;
    } else {
      const thread = await api(`/messages/with/${id}`);
      if (thread.error) return setNotice(thread.error);
      setActiveChat({ ...thread, kind: "dm" });
    }
    setSearchResults([]);
    await loadMessages();
  }

  async function startUserphoneCall() {
    const st = await api("/userphone/start", { method: "POST", body: {} });
    if (st.error) {
      setNotice(st.error);
      return;
    }
    applyUserPhoneServerPayload(st);
  }

  async function endUserphoneCallAction() {
    await api("/userphone/end", { method: "POST", body: {} });
    await refreshUserPhoneFromServer();
    setNotice("Call ended");
  }

  async function switchUserphoneCallAction() {
    const res = await api("/userphone/switch", { method: "POST", body: {} });
    if (res.error) setNotice(res.error);
    else setNotice("Looking for someone new…");
    await refreshUserPhoneFromServer();
  }

  async function cancelUserphoneWaitingAction() {
    setUserPhoneAutoReconnect(false);
    await api("/userphone/waiting", { method: "DELETE" });
    await refreshUserPhoneFromServer();
    setNotice("Stopped searching");
  }

  async function startGroupUserphoneBridge(groupId) {
    const res = await api(`/groups/${groupId}/userphone/start`, { method: "POST", body: {} });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setActiveChat((prev) =>
      prev?.kind === "group" && prev.group?.id === groupId ? { ...res, kind: "group" } : prev
    );
    await loadMessages();
  }

  async function cancelGroupUserphoneWaiting(groupId) {
    const res = await api(`/groups/${groupId}/userphone/waiting`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setActiveChat((prev) =>
      prev?.kind === "group" && prev.group?.id === groupId ? { ...res, kind: "group" } : prev
    );
    await loadMessages();
    setNotice("Stopped searching");
  }

  async function endGroupUserphoneBridge(groupId) {
    const res = await api(`/groups/${groupId}/userphone/end`, { method: "POST", body: {} });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setActiveChat((prev) =>
      prev?.kind === "group" && prev.group?.id === groupId ? { ...res, kind: "group" } : prev
    );
    await loadMessages();
    setNotice("Userphone disconnected");
  }
  // Send a chat message. Optionally attach a file and/or quote-reply another
  // message via replyToId.
  async function sendChatMessage(text, file, replyToId = null) {
    if (!activeChat) return;
    if (activeChat.kind === "userphone") {
      if (!activeChat.sessionId) {
        setNotice("Wait until you’re matched with someone.");
        return;
      }
      if (file || replyToId) {
        setNotice("Files and replies aren’t supported in Userphone.");
        return;
      }
      const res = await api(`/userphone/${activeChat.sessionId}/messages`, {
        method: "POST",
        body: { text: text.trim() }
      });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      await refreshUserPhoneFromServer();
      await loadMessages();
      return;
    }
    const formData = new FormData();
    if (text) formData.append("text", text);
    if (file) formData.append("attachment", file);
    if (replyToId) formData.append("replyToId", replyToId);
    const url =
      activeChat.kind === "group"
        ? `/groups/${activeChat.group.id}/messages`
        : `/messages/with/${activeChat.user.id}`;
    const res = await apiForm(url, formData);
    if (res.error) {
      setNotice(res.error);
      return;
    }
    const refreshed =
      activeChat.kind === "group"
        ? await api(`/groups/${activeChat.group.id}`)
        : await api(`/messages/with/${activeChat.user.id}`);
    if (!refreshed.error) setActiveChat({ ...refreshed, kind: activeChat.kind });
    await loadMessages();
  }

  // Soft-unsend one of my own messages. The thread is refreshed so the
  // tombstone ("This message was unsent") appears in place of the original.
  async function unsendMessage(message) {
    if (!message?.id || activeChat?.kind === "userphone") return;
    const res = await api(`/messages/${message.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Message unsent");
    const refreshed =
      activeChat?.kind === "group"
        ? await api(`/groups/${activeChat.group.id}`)
        : activeChat?.user
          ? await api(`/messages/with/${activeChat.user.id}`)
          : null;
    if (refreshed && !refreshed.error) setActiveChat({ ...refreshed, kind: activeChat.kind });
    await loadMessages();
  }

  async function createGroupChat({ name, memberIds, photoFile }) {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("memberIds", JSON.stringify(memberIds));
    if (photoFile) formData.append("photo", photoFile);
    const res = await apiForm("/groups", formData);
    if (res.error) {
      setNotice(res.error);
      throw new Error(res.error);
    }
    setNotice(`Group "${name}" created`);
    await loadMessages();
    await openChat("group", res.id);
  }

  async function updateGroupChat(groupId, { name, photoFile }) {
    const formData = new FormData();
    if (name) formData.append("name", name);
    if (photoFile) formData.append("photo", photoFile);
    const res = await apiForm(`/groups/${groupId}`, formData, "PATCH");
    if (res.error) {
      setNotice(res.error);
      throw new Error(res.error);
    }
    setNotice("Group updated");
    const refreshed = await api(`/groups/${groupId}`);
    if (!refreshed.error) setActiveChat({ ...refreshed, kind: "group" });
    await loadMessages();
  }

  async function leaveGroupChat(groupId) {
    const res = await api(`/groups/${groupId}/members/me`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Left group");
    setActiveChat(null);
    await loadMessages();
  }

  async function addMembersToGroup(groupId, memberIds) {
    const res = await api(`/groups/${groupId}/members`, {
      method: "POST",
      body: { memberIds }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Member(s) added");
    setActiveChat((prev) =>
      prev?.group?.id === groupId ? { ...prev, group: res } : prev
    );
    await loadMessages();
  }

  async function removeMemberFromGroup(groupId, userId) {
    const res = await api(`/groups/${groupId}/members/${userId}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Member removed");
    setActiveChat((prev) =>
      prev?.group?.id === groupId ? { ...prev, group: res } : prev
    );
    await loadMessages();
  }

  async function changeMemberRole(groupId, userId, role) {
    const res = await api(`/groups/${groupId}/members/${userId}`, {
      method: "PATCH",
      body: { role }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice(`Role updated to ${role}`);
    setActiveChat((prev) =>
      prev?.group?.id === groupId ? { ...prev, group: res } : prev
    );
  }

  async function deleteGroupChat(groupId) {
    const res = await api(`/groups/${groupId}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Group chat deleted");
    setActiveChat(null);
    await loadMessages();
  }

  async function reactToMessage(messageId, reaction) {
    if (activeChat?.kind === "userphone") return;
    const res = await api(`/messages/${messageId}/react`, {
      method: "POST",
      body: { reaction: reaction === undefined ? "like" : reaction }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.message) {
      setActiveChat((prev) => {
        if (!prev) return prev;
        const messages = (prev.messages || []).map((m) =>
          m.id === res.message.id ? { ...m, ...res.message } : m
        );
        return { ...prev, messages };
      });
    }
  }

  async function loadActiveAttachments() {
    if (!activeChat) return [];
    if (activeChat.kind === "userphone") return [];
    const url =
      activeChat.kind === "group"
        ? `/groups/${activeChat.group.id}/attachments`
        : `/messages/with/${activeChat.user.id}/attachments`;
    const res = await api(url);
    if (res.error || !Array.isArray(res)) return [];
    return res;
  }

  async function uploadAvatar(file) {
    const formData = new FormData();
    formData.append("avatar", file);
    const res = await apiForm("/profile/avatar", formData);
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.user) {
      setUser(res.user);
      localStorage.setItem("siglacast_user", JSON.stringify(res.user));
    }
    setNotice("Profile photo updated");
  }

  async function createAnnouncement() {
    const res = await api("/announcements", {
      method: "POST",
      body: { title: newAnnouncementTitle, message: newAnnouncementMessage }
    });
    setNotice(res.error || "Announcement published");
    if (!res.error) {
      setNewAnnouncementTitle("");
      setNewAnnouncementMessage("");
      await loadComms();
    }
  }

  async function createEvent() {
    const formData = new FormData();
    formData.append("title", newEventTitle.trim());
    formData.append("description", newEventDesc.trim());
    formData.append("rules", newEventRules.trim());
    formData.append("strategy", newEventStrategy);
    formData.append("maxVotesPerUser", newEventMaxVotes);
    formData.append("candidatesNames", newEventCandidates);
    formData.append("candidateImageUrls", newCandidateImageUrls);
    if (newEventCoverFile) formData.append("cover", newEventCoverFile);
    const res = await apiForm("/events", formData);
    setNotice(res.error || "Event created");
    if (!res.error) {
      setNewEventTitle("");
      setNewEventDesc("");
      setNewEventRules("");
      setNewEventMaxVotes("1");
      setNewEventStrategy("single");
      setNewEventCandidates("");
      setNewCandidateImageUrls("");
      setNewEventCoverFile(null);
      await loadAll();
    }
  }

  async function deleteUser(target) {
    if (!target?.id) return;
    if (!window.confirm(`Permanently delete ${target.name || "this user"} and all of their data?`)) return;
    const res = await api(`/admin/users/${target.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice(`Deleted user ${target.name || target.id}`);
    await Promise.all([loadAdminUsers(), loadCore(), loadRoleDashboard()]);
  }

  async function deleteEvent(target) {
    if (!target?.id) return;
    if (!window.confirm(`Delete event "${target.title}" and all of its votes?`)) return;
    const res = await api(`/events/${target.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice(`Deleted event ${target.title}`);
    if (selectedEventId === target.id) {
      setSelectedEvent(null);
      setSelectedEventId("");
    }
    await loadAll();
  }

  async function deletePost(post) {
    if (!post?.id) return;
    if (!window.confirm("Delete this post?")) return;
    const res = await api(`/community/posts/${post.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Post deleted");
    await loadCore();
  }

  async function deleteAnnouncement(ann) {
    if (!ann?.id) return;
    if (!window.confirm(`Delete announcement "${ann.title}"?`)) return;
    const res = await api(`/announcements/${ann.id}`, { method: "DELETE" });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setNotice("Announcement deleted");
    await loadComms();
  }

  function logout() {
    const refreshToken = localStorage.getItem("siglacast_refresh_token");
    if (token && refreshToken) {
      request("/auth/logout", { token, method: "POST" });
    }
    localStorage.removeItem("siglacast_token");
    localStorage.removeItem("siglacast_refresh_token");
    localStorage.removeItem("siglacast_user");
    setToken("");
    setUser(null);
    setSelectedEvent(null);
    setNotice("");
    navigate("/login");
  }

  if (!token || !user) {
    return (
      <AuthPage
        mode={mode}
        setMode={setMode}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        name={name}
        setName={setName}
        course={course}
        setCourse={setCourse}
        notice={notice}
        clearNotice={() => setNotice("")}
        loading={loadingAuth}
        onLogin={login}
        onRegister={register}
      />
    );
  }

  return (
    <AppShell
      user={user}
      notice={notice || ""}
      onLogout={logout}
      theme={theme}
      onToggleTheme={toggleTheme}
      stats={{
        openEvents: events.filter((e) => e.status === "open").length,
        posts: posts.length,
        notifications: notifications.length
      }}
      navBadges={{
        events: navBadges.events,
        messages: navBadges.messages,
        announcements: navBadges.announcements,
        notifications: navBadges.notifications
      }}
    >
      <Routes>
        <Route
          path="/"
          element={
            <DashboardPage
              user={user}
              dashboard={dashboard}
              newEventTitle={newEventTitle}
              setNewEventTitle={setNewEventTitle}
              newEventDesc={newEventDesc}
              setNewEventDesc={setNewEventDesc}
              newEventRules={newEventRules}
              setNewEventRules={setNewEventRules}
              newEventMaxVotes={newEventMaxVotes}
              setNewEventMaxVotes={setNewEventMaxVotes}
              newEventStrategy={newEventStrategy}
              setNewEventStrategy={setNewEventStrategy}
              newEventCandidates={newEventCandidates}
              setNewEventCandidates={setNewEventCandidates}
              newCandidateImageUrls={newCandidateImageUrls}
              setNewCandidateImageUrls={setNewCandidateImageUrls}
              newEventCoverFile={newEventCoverFile}
              setNewEventCoverFile={setNewEventCoverFile}
              onCreateEvent={createEvent}
              adminUsers={adminUsers}
              onDeleteUser={deleteUser}
              events={events}
              onDeleteEvent={deleteEvent}
            />
          }
        />
        <Route
          path="/events"
          element={
            <EventsPage
              events={events}
              onOpenEvent={openEvent}
              currentUser={user}
              onDeleteEvent={deleteEvent}
            />
          }
        />
        <Route path="/events/detail" element={<EventDetailPage selectedEvent={selectedEvent} onVote={vote} />} />
        <Route
          path="/community"
          element={
            <CommunityPage
              posts={posts}
              currentUser={user}
              onPost={postCommunityPost}
              onReact={reactToPost}
              onComment={commentOnPost}
              onDeletePost={deletePost}
              onReactComment={reactToComment}
              onDeleteComment={deleteComment}
            />
          }
        />
        <Route
          path="/profile"
          element={
            <ProfilePage
              user={user}
              onProfileSave={saveProfile}
              onAvatarUpload={uploadAvatar}
              setNotice={setNotice}
            />
          }
        />
        <Route
          path="/announcements"
          element={
            <AnnouncementsPage
              user={user}
              announcements={announcements}
              newAnnouncementTitle={newAnnouncementTitle}
              setNewAnnouncementTitle={setNewAnnouncementTitle}
              newAnnouncementMessage={newAnnouncementMessage}
              setNewAnnouncementMessage={setNewAnnouncementMessage}
              onCreateAnnouncement={createAnnouncement}
              onDeleteAnnouncement={deleteAnnouncement}
              onVisited={markAnnouncementsSeen}
            />
          }
        />
        <Route path="/notifications" element={<NotificationsPage notifications={notifications} />} />
        <Route
          path="/messages"
          element={
            <MessagesPage
              currentUser={user}
              conversations={conversationsWithUserphone}
              activeChat={activeChat}
              friendIncomingRequests={friendIncomingRequests}
              onAcceptFriendRequest={acceptFriendRequest}
              onRejectFriendRequest={rejectFriendRequest}
              searchResults={searchResults}
              searchQuery={searchQuery}
              peopleSearchHint={peopleSearchHint}
              setSearchQuery={setSearchQuery}
              onSearchQueryEdited={() => setPeopleSearchHint("")}
              onSearch={searchUsers}
              onAddFriend={addFriend}
              onOpenChat={openChat}
              onSendMessage={sendChatMessage}
              onRefreshConversations={loadMessages}
              onCreateGroup={createGroupChat}
              onUpdateGroup={updateGroupChat}
              onLeaveGroup={leaveGroupChat}
              onLoadAttachments={loadActiveAttachments}
              onAddMembers={addMembersToGroup}
              onRemoveMember={removeMemberFromGroup}
              onChangeMemberRole={changeMemberRole}
              onDeleteGroup={deleteGroupChat}
              onReactToMessage={reactToMessage}
              onUnsendMessage={unsendMessage}
              onCloseMobileChat={() => setActiveChat(null)}
              onUserphoneStart={startUserphoneCall}
              onUserphoneEnd={endUserphoneCallAction}
              onUserphoneSwitch={switchUserphoneCallAction}
              onUserphoneCancelWaiting={cancelUserphoneWaitingAction}
              onStartGroupUserphoneBridge={startGroupUserphoneBridge}
              onCancelGroupUserphoneWaiting={cancelGroupUserphoneWaiting}
              onEndGroupUserphoneBridge={endGroupUserphoneBridge}
              userPhoneAutoReconnect={userPhoneAutoReconnect}
              setUserPhoneAutoReconnect={setUserPhoneAutoReconnect}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
