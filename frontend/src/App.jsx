import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useLocation } from "react-router-dom";
import { request, requestForm } from "./services/api.js";
import AppShell from "./components/AppShell.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import EventsPage from "./pages/EventsPage.jsx";
import EventDetailPage from "./pages/EventDetailPage.jsx";
import CommunityPage from "./pages/CommunityPage.jsx";
import AnnouncementsPage from "./pages/AnnouncementsPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import ProfilePage from "./pages/ProfilePage.jsx";
import MyProfilePage from "./pages/MyProfilePage.jsx";
import PublicProfilePage from "./pages/PublicProfilePage.jsx";
import MusicPage from "./pages/MusicPage.jsx";
import MessagesPage from "./pages/MessagesPage.jsx";
import AssistantPage from "./pages/AssistantPage.jsx";
import DownloadPage from "./pages/DownloadPage.jsx";
import AddFriendsPage from "./pages/AddFriendsPage.jsx";
import UserProfileModal from "./components/UserProfileModal.jsx";
import SharePostModal from "./components/SharePostModal.jsx";
import { SIGLACAST_AI_USER_ID } from "./constants/sentinelUsers.js";
import { normalizeRegistrationEmail, validateRegisterForm } from "./utils/registerValidation.js";
import { ImageLightboxProvider } from "./components/ImageLightboxContext.jsx";
import { MusicPlayerProvider } from "./components/MusicPlayerContext.jsx";
import { notificationTargetPath } from "./utils/notificationTargetPath.js";
import { readLiteModePreference, writeLiteModePreference } from "./utils/networkLite.js";

const STORAGE_SEEN_ANNOUNCEMENT_IDS = "siglacast_seen_announcement_ids";
const STORAGE_CACHED_POSTS = "siglacast_cached_text_posts";
const STORAGE_ANDROID_OVERLAY_ASKED = "siglacast_android_overlay_permission_asked";

/** Offline / overloaded server — do not wipe login; user stays signed in until explicit logout or real auth failure. */
function isTransientSessionCheckFailure(result) {
  const msg = typeof result?.error === "string" ? result.error : "";
  if (!msg) return false;
  if (msg.includes("Cannot connect")) return true;
  if (/Request failed \(5\d\d\)/.test(msg)) return true;
  if (/Request failed \(408\)/.test(msg)) return true;
  if (/Request failed \(429\)/.test(msg)) return true;
  return false;
}

function cacheablePost(post) {
  return {
    ...post,
    imageUrl: null,
    sharedPost: post.sharedPost ? { ...post.sharedPost, imageUrl: null } : null,
    comments: (post.comments || []).map((comment) => ({
      ...comment,
      imageUrl: null,
      replies: (comment.replies || []).map((reply) => ({ ...reply, imageUrl: null }))
    }))
  };
}

function readCachedPosts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_CACHED_POSTS) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeCachedPosts(rows) {
  try {
    localStorage.setItem(STORAGE_CACHED_POSTS, JSON.stringify(rows.map(cacheablePost).slice(0, 80)));
  } catch (_) {
    // Ignore storage quota or private-mode failures.
  }
}

function isAndroidNativeApp() {
  if (typeof window === "undefined") return false;
  const nativeProtocol = ["capacitor:", "ionic:"].includes(window.location.protocol);
  return nativeProtocol && /Android/i.test(navigator.userAgent || "");
}

function callAndroidOverlay(method, ...args) {
  try {
    const bridge = typeof window !== "undefined" ? window.AndroidSiglaOverlay : null;
    if (!bridge || typeof bridge[method] !== "function") return null;
    return bridge[method](...args);
  } catch (_) {
    return null;
  }
}

export default function App() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState(() => localStorage.getItem("siglacast_token") || "");
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("siglacast_user");
    return raw ? JSON.parse(raw) : null;
  });
  const [events, setEvents] = useState([]);
  const [posts, setPosts] = useState([]);
  const [notice, setNotice] = useState("");
  const [liteMode, setLiteMode] = useState(readLiteModePreference);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [shareTargetPost, setShareTargetPost] = useState(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);
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
  const [appRefreshBusy, setAppRefreshBusy] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [messagesArchivedView, setMessagesArchivedView] = useState(false);
  const [archivedConversationsSidebar, setArchivedConversationsSidebar] = useState([]);
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
  /** `{ userId, prefetch? }` — public profile popover from avatars in Community / Messages. */
  const [userProfilePeek, setUserProfilePeek] = useState(null);

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

  function toggleLiteMode() {
    setLiteMode((current) => {
      const next = !current;
      writeLiteModePreference(next);
      setNotice(next ? "Lite mode on: heavy images are hidden." : "Lite mode off.");
      return next;
    });
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

  const conversationsForSidebar = useMemo(() => {
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
    const userphoneRow = {
      kind: "userphone",
      id: "userphone",
      user: { id: "userphone", name: "Userphone", email: "", course: "", avatarUrl: null },
      isFriend: false,
      lastMessage,
      unreadCount: 0
    };
    const withoutAiDm = (messagesArchivedView ? archivedConversationsSidebar : conversations || []).filter(
      (c) => !(c.kind === "dm" && c.user?.id === SIGLACAST_AI_USER_ID)
    );
    const existingAiDm = (messagesArchivedView ? archivedConversationsSidebar : conversations || []).find(
      (c) => c.kind === "dm" && c.user?.id === SIGLACAST_AI_USER_ID
    );
    const aiLastMessage = existingAiDm?.lastMessage || {
      text: "Ask me anything! Tap to start chatting",
      createdAt: new Date(0).toISOString(),
      fromMe: false
    };
    const aiRow = {
      kind: "dm",
      id: `dm:${SIGLACAST_AI_USER_ID}`,
      user: {
        id: SIGLACAST_AI_USER_ID,
        name: "SiglaCast AI Assistant",
        email: "assistant@siglacast.com",
        course: "AI Helper",
        avatarUrl: null,
        statusEmoji: "✨",
        presence: "online"
      },
      isFriend: true,
      lastMessage: aiLastMessage,
      unreadCount: existingAiDm?.unreadCount || 0
    };
    return [userphoneRow, aiRow, ...withoutAiDm];
  }, [
    conversations,
    archivedConversationsSidebar,
    messagesArchivedView,
    userPhoneState.phase,
    userPhoneState.messages,
    userPhoneState.waitExpiresAt,
    userphoneTick,
    userPhoneAutoReconnect
  ]);

  async function loadCore() {
    if (!token) return;
    const [ev, po] = await Promise.all([
      api("/events"),
      api("/community/posts")
    ]);
    setEvents(Array.isArray(ev) ? ev : []);
    if (Array.isArray(po)) {
      setPosts(po);
      writeCachedPosts(po);
    } else {
      const cached = readCachedPosts();
      if (cached.length) setPosts(cached);
    }
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
    await Promise.all([loadCore(), loadComms(), loadAdminUsers()]);
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

  useEffect(() => {
    function onNativeNavigate(event) {
      const path = event?.detail?.path;
      if (typeof path === "string" && path.startsWith("/")) navigate(path);
    }
    window.addEventListener("siglacast:native-navigate", onNativeNavigate);
    const pendingPath = window.__siglacastPendingNativeRoute;
    if (typeof pendingPath === "string" && pendingPath.startsWith("/")) {
      window.__siglacastPendingNativeRoute = "";
      navigate(pendingPath);
    }
    return () => window.removeEventListener("siglacast:native-navigate", onNativeNavigate);
  }, [navigate]);

  useEffect(() => {
    if (!token || !user || !isAndroidNativeApp()) return undefined;
    const bridge = typeof window !== "undefined" ? window.AndroidSiglaOverlay : null;
    if (!bridge) return undefined;

    const timer = setTimeout(() => {
      const canOverlay = callAndroidOverlay("canDrawOverlays");
      if (canOverlay === true) return;
      try {
        if (localStorage.getItem(STORAGE_ANDROID_OVERLAY_ASKED)) return;
        localStorage.setItem(STORAGE_ANDROID_OVERLAY_ASKED, "1");
      } catch (_) {
        // If storage fails, still ask once for this session.
      }
      callAndroidOverlay("requestPermission");
    }, 1800);

    return () => clearTimeout(timer);
  }, [token, user?.id]);

  useEffect(() => {
    if (!isAndroidNativeApp()) return;
    if (!token || !user) {
      callAndroidOverlay("stop");
      return;
    }

    const seenAnnouncements = (() => {
      try {
        return new Set(JSON.parse(localStorage.getItem(STORAGE_SEEN_ANNOUNCEMENT_IDS) || "[]"));
      } catch (_) {
        return new Set();
      }
    })();
    const latestMessages = (conversations || [])
      .filter((c) => Number(c.unreadCount) > 0)
      .slice(0, 3)
      .map((c) => ({
        title: c.kind === "group" ? c.group?.name || "Group chat" : c.user?.name || "Message",
        subtitle: c.lastMessage?.text || `${c.unreadCount} unread`
      }));
    const latestAnnouncements = (announcements || [])
      .filter((a) => a.id && !seenAnnouncements.has(a.id))
      .slice(0, 3)
      .map((a) => ({
        title: a.title || "Announcement",
        subtitle: a.message || ""
      }));
    const payload = {
      messages: navBadges.messages,
      announcements: navBadges.announcements,
      latestMessages,
      latestAnnouncements
    };
    if (payload.messages + payload.announcements > 0) {
      callAndroidOverlay("update", JSON.stringify(payload));
    } else {
      callAndroidOverlay("stop");
    }
  }, [token, user, navBadges.messages, navBadges.announcements, conversations, announcements, navBadgeTick]);

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
      "friend_request",
      "story_comment",
      "story_reaction"
    ]);
    for (const n of notifications) {
      if (seenNotificationIds.current.has(n.id)) continue;
      seenNotificationIds.current.add(n.id);
      const kind = n.kind || "general";
      if (!PUSH_KINDS.has(kind)) continue;
      if (user?.availability === "dnd") continue;
      try {
        const body =
          typeof n.badgeCount === "number" && n.badgeCount > 1
            ? `${n.text} (${n.badgeCount})`
            : n.text || "Activity";
        const notif = new Notification("SiglaCast", { body, tag: n.id });
        notif.onclick = () => {
          window.focus();
          const path = notificationTargetPath(n);
          if (path) navigateRef.current(path);
        };
      } catch (_) {
        /* some browsers block unless served from a SW */
      }
    }
  }, [notifications, user]);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    (async () => {
      const res = await api("/auth/me");
      if (cancelled) return;
      if (res?.user) {
        setUser(res.user);
        try {
          localStorage.setItem("siglacast_user", JSON.stringify(res.user));
        } catch (_) {
          /* ignore */
        }
        return;
      }
      if (isTransientSessionCheckFailure(res)) return;

      localStorage.removeItem("siglacast_token");
      localStorage.removeItem("siglacast_refresh_token");
      localStorage.removeItem("siglacast_user");
      setToken("");
      setUser(null);
      setNotice("Session expired. Please login again.");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function loadMessages() {
    if (!token) return;
    const [list, reqs] = await Promise.all([api("/messages/conversations"), api("/friend-requests")]);
    if (!list.error) setConversations(Array.isArray(list) ? list : []);
    if (!reqs.error && Array.isArray(reqs)) setFriendIncomingRequests(reqs);
    else setFriendIncomingRequests([]);
  }

  async function loadArchivedConversationsList() {
    if (!token || pathnameRef.current !== "/messages") return;
    const list = await api("/messages/conversations?view=archived");
    if (!list.error) setArchivedConversationsSidebar(Array.isArray(list) ? list : []);
  }

  async function archiveConversation(payload) {
    const res = await api("/messages/conversations/archive", { method: "POST", body: payload });
    if (res?.error) {
      setNotice(res.error);
      return;
    }
    setNotice("");
    setActiveChat((prev) => {
      if (!prev || !payload) return prev;
      if (payload.dmPeerId && prev.kind === "dm" && prev.user?.id === payload.dmPeerId) return null;
      if (payload.conversationId && prev.kind === "group" && prev.group?.id === payload.conversationId) return null;
      return prev;
    });
    await Promise.all([loadMessages(), loadArchivedConversationsList()]);
  }

  async function unarchiveConversation(payload) {
    const res = await api("/messages/conversations/unarchive", { method: "POST", body: payload });
    if (res?.error) setNotice(res.error);
    else {
      setNotice("");
      await loadArchivedConversationsList();
      await loadMessages();
    }
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
    if (!token || location.pathname !== "/messages") return undefined;
    if (!messagesArchivedView) {
      setArchivedConversationsSidebar([]);
      return undefined;
    }
    let cancelled = false;
    async function pullArchived() {
      const list = await api("/messages/conversations?view=archived");
      if (cancelled || list?.error || !Array.isArray(list)) return;
      setArchivedConversationsSidebar(list);
    }
    pullArchived();
    const interval = setInterval(pullArchived, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, location.pathname, messagesArchivedView]);

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

  // Poll the active thread every 3 seconds while the page is open (not solo Userphone).
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
      navigate("/community");
    }
    setLoadingAuth(false);
  }

  async function register(registrationPayload) {
    if (loadingAuth) return;
    const source = registrationPayload ?? { name, email, password };
    const v = validateRegisterForm(source);
    if (!v.ok) {
      setNotice([...new Set(Object.values(v.fieldErrors))].join(" "));
      return;
    }
    setLoadingAuth(true);
    const { name: regName, email: regEmail, password: regPassword, course: regCourse } = v.normalized;
    const res = await api("/auth/register", {
      method: "POST",
      body: { name: regName, email: regEmail, password: regPassword, course: regCourse || "" }
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

  async function refreshVisibleContent() {
    if (appRefreshBusy) return;
    setAppRefreshBusy(true);
    try {
      await Promise.all([loadAll(), loadMessages(), loadArchivedConversationsList()]);
      if (pathnameRef.current === "/messages" && activeChatRef.current?.kind === "userphone") {
        await refreshUserPhoneFromServer();
      }
    } finally {
      setAppRefreshBusy(false);
    }
  }

  function sharePost(post) {
    if (!post?.id) return;
    setShareTargetPost(post);
  }

  async function submitSharePost(content) {
    if (!shareTargetPost?.id || shareSubmitting) return;
    setShareSubmitting(true);
    const res = await api(`/community/posts/${shareTargetPost.id}/share`, {
      method: "POST",
      body: { content }
    });
    setShareSubmitting(false);
    if (res.error) {
      setNotice(res.error);
      return;
    }
    setShareTargetPost(null);
    setNotice("Post shared");
    setPosts((prev) => [res, ...prev.filter((p) => p.id !== res.id)]);
  }

  async function reactToPost(postId, reaction) {
    // reaction can be one of: "like", "love", "haha", "wow", "sad", "cry", "angry", null (clear)
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

  /** Refresh JWT session user (Spotify reconnect, prefs toggles, polls). */
  async function refreshUserFromAuthMe() {
    const res = await api("/auth/me");
    if (res?.error) return;
    if (res?.user) {
      setUser(res.user);
      try {
        localStorage.setItem("siglacast_user", JSON.stringify(res.user));
      } catch (_) {
        /* ignore */
      }
    }
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

  async function openDmAndFocusUser(userId) {
    setUserProfilePeek(null);
    navigate("/messages");
    await openChat("dm", userId);
  }

  function openUserProfileModal(userId, prefetch) {
    if (!userId || userId === SIGLACAST_AI_USER_ID) return;
    if (userId === user?.id) {
      navigate("/profile");
      return;
    }
    setUserProfilePeek({ userId, prefetch: prefetch || null });
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

  /** SiglaCast AI replies inside this thread — everyone in the chat sees assistant bubbles like a participant. */
  async function sendSiglaInActiveThread(text, replyToId = null) {
    if (!activeChat) return;
    const body = {
      text: String(text || "").trim(),
      replyToId: replyToId || undefined
    };
    if (!body.text) return;
    if (activeChat.kind === "group") {
      const gid = activeChat.group?.id;
      if (!gid) return;
      const res = await api(`/groups/${gid}/messages/sigla-ai`, { method: "POST", body });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      setActiveChat((prev) => ({
        ...prev,
        kind: "group",
        group: res.group ?? prev.group,
        messages: Array.isArray(res.messages) ? res.messages : [],
        groupUserphone: res.groupUserphone ?? prev.groupUserphone
      }));
      await loadMessages();
      return;
    }
    if (activeChat.kind === "dm") {
      const peerId = activeChat.user?.id;
      if (!peerId) return;
      const res = await api(`/messages/with/${peerId}/sigla-ai`, { method: "POST", body });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      setActiveChat((prev) => ({
        ...prev,
        kind: "dm",
        messages: Array.isArray(res.messages) ? res.messages : [],
        user: prev.user,
        isFriend: prev.isFriend,
        incomingRequestId: prev.incomingRequestId,
        outgoingRequestPending: prev.outgoingRequestPending
      }));
      await loadMessages();
      return;
    }
    if (activeChat.kind === "userphone") {
      const sid = activeChat.sessionId;
      const phase = activeChat.phase || "idle";
      if (!sid || phase !== "matched") {
        setNotice("Match with someone on Userphone first—or use Sigla AI in a group/DM.");
        return;
      }
      const res = await api(`/userphone/${sid}/messages/sigla-ai`, { method: "POST", body });
      if (res.error) {
        setNotice(res.error);
        return;
      }
      applyUserPhoneServerPayload(res);
      await loadMessages();
    }
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

  async function uploadCover(file) {
    const formData = new FormData();
    formData.append("cover", file);
    const res = await apiForm("/profile/cover", formData);
    if (res.error) {
      setNotice(res.error);
      return;
    }
    if (res.user) {
      setUser(res.user);
      localStorage.setItem("siglacast_user", JSON.stringify(res.user));
    }
    setNotice("Cover updated");
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
    await Promise.all([loadAdminUsers(), loadCore()]);
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

  if (location.pathname === "/download" || location.pathname === "/download/") {
    return <DownloadPage />;
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
      theme={theme}
      onToggleTheme={toggleTheme}
      liteMode={liteMode}
      onToggleLiteMode={toggleLiteMode}
      onRefresh={refreshVisibleContent}
      refreshBusy={appRefreshBusy}
      navBadges={{
        events: navBadges.events,
        messages: navBadges.messages,
        announcements: navBadges.announcements,
        notifications: navBadges.notifications,
        addFriends: friendIncomingRequests.length
      }}
    >
      <ImageLightboxProvider>
      <MusicPlayerProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/community" replace />} />
        <Route
          path="/events"
          element={
            <EventsPage
              events={events}
              onOpenEvent={openEvent}
              currentUser={user}
              onDeleteEvent={deleteEvent}
              {...(user.role === "admin"
                ? {
                    newEventTitle,
                    setNewEventTitle,
                    newEventDesc,
                    setNewEventDesc,
                    newEventRules,
                    setNewEventRules,
                    newEventMaxVotes,
                    setNewEventMaxVotes,
                    newEventStrategy,
                    setNewEventStrategy,
                    newEventCandidates,
                    setNewEventCandidates,
                    newCandidateImageUrls,
                    setNewCandidateImageUrls,
                    newEventCoverFile,
                    setNewEventCoverFile,
                    onCreateEvent: createEvent,
                    adminUsers,
                    onDeleteUser: deleteUser
                  }
                : {})}
              liteMode={liteMode}
            />
          }
        />
        <Route path="/events/detail" element={<EventDetailPage selectedEvent={selectedEvent} onVote={vote} liteMode={liteMode} />} />
        <Route path="/assistant" element={<Navigate to="/messages" replace />} />
        <Route
          path="/community"
          element={
            <CommunityPage
              token={token}
              posts={posts}
              currentUser={user}
              onPost={postCommunityPost}
              onReact={reactToPost}
              onComment={commentOnPost}
              onDeletePost={deletePost}
              onReactComment={reactToComment}
              onDeleteComment={deleteComment}
              onShare={sharePost}
              onOpenUserProfile={openUserProfileModal}
              onUnauthorizedRetry={onUnauthorizedRetry}
              liteMode={liteMode}
            />
          }
        />
        <Route
          path="/profile"
          element={
            <MyProfilePage
              user={user}
              posts={posts}
              currentUser={user}
              liteMode={liteMode}
              onPost={postCommunityPost}
              onReact={reactToPost}
              onComment={commentOnPost}
              onReactComment={reactToComment}
              onDeleteComment={deleteComment}
              onDeletePost={deletePost}
              onShare={sharePost}
              onOpenUserProfile={openUserProfileModal}
            />
          }
        />
        <Route
          path="/users/:userId"
          element={
            <PublicProfilePage
              api={api}
              posts={posts}
              currentUser={user}
              liteMode={liteMode}
              onReact={reactToPost}
              onComment={commentOnPost}
              onReactComment={reactToComment}
              onDeleteComment={deleteComment}
              onDeletePost={deletePost}
              onShare={sharePost}
              onOpenUserProfile={openUserProfileModal}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <ProfilePage
              user={user}
              onProfileSave={saveProfile}
              onAvatarUpload={uploadAvatar}
              onCoverUpload={uploadCover}
              setNotice={setNotice}
              onLogout={logout}
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
        <Route
          path="/notifications"
          element={
            <NotificationsPage
              notifications={notifications}
              token={token}
              onUnauthorizedRetry={onUnauthorizedRetry}
              onNotificationsUpdated={(list) => setNotifications(list)}
            />
          }
        />
        <Route
          path="/music"
          element={
            <MusicPage
              api={api}
              apiForm={apiForm}
              token={token}
              user={user}
              setNotice={setNotice}
              refreshUser={refreshUserFromAuthMe}
              onOpenDmWithUser={(friendId) => void openDmAndFocusUser(friendId)}
              liteMode={liteMode}
            />
          }
        />
        <Route
          path="/messages"
          element={
            <MessagesPage
              currentUser={user}
              conversations={conversationsForSidebar}
              messagesArchivedView={messagesArchivedView}
              onToggleMessagesArchived={() => setMessagesArchivedView((v) => !v)}
              onArchiveConversation={archiveConversation}
              onUnarchiveConversation={unarchiveConversation}
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
              onSendSiglaInActiveThread={sendSiglaInActiveThread}
              onOpenUserProfile={openUserProfileModal}
              onUnauthorizedRetry={onUnauthorizedRetry}
              token={token}
              liteMode={liteMode}
            />
          }
        />
        <Route
          path="/add-friends"
          element={
            <AddFriendsPage
              api={api}
              currentUser={user}
              friendIncomingRequests={friendIncomingRequests}
              onAcceptFriendRequest={acceptFriendRequest}
              onRejectFriendRequest={rejectFriendRequest}
              onAddFriend={addFriend}
              onOpenUserProfile={openUserProfileModal}
              onOpenDmWithUser={(friendId) => void openDmAndFocusUser(friendId)}
              liteMode={liteMode}
            />
          }
        />
        <Route path="*" element={<Navigate to="/community" replace />} />
      </Routes>
      <UserProfileModal
        peek={userProfilePeek}
        onClose={() => setUserProfilePeek(null)}
        currentUser={user}
        api={api}
        navigate={navigate}
        onOpenDm={openDmAndFocusUser}
        onAddFriend={addFriend}
        onAcceptFriendRequest={acceptFriendRequest}
        onRejectFriendRequest={rejectFriendRequest}
      />
      <SharePostModal
        post={shareTargetPost}
        currentUser={user}
        liteMode={liteMode}
        submitting={shareSubmitting}
        onClose={() => (shareSubmitting ? null : setShareTargetPost(null))}
        onSubmit={submitSharePost}
      />
      </MusicPlayerProvider>
      </ImageLightboxProvider>
    </AppShell>
  );
}
