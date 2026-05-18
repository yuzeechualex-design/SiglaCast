import { useEffect, useRef, useState } from "react";
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
  const [activeChat, setActiveChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
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
    for (const n of notifications) {
      if (seenNotificationIds.current.has(n.id)) continue;
      seenNotificationIds.current.add(n.id);
      try {
        const notif = new Notification("SiglaCast", { body: n.text || "You have a new notification", tag: n.id });
        notif.onclick = () => { window.focus(); };
      } catch (_) { /* some browsers block unless served from a SW */ }
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
    const list = await api("/messages/conversations");
    if (!list.error) setConversations(Array.isArray(list) ? list : []);
  }

  useEffect(() => {
    if (!token || location.pathname !== "/messages") return undefined;
    loadMessages();
    const interval = setInterval(loadMessages, 4000);
    return () => clearInterval(interval);
  }, [token, location.pathname]);

  // Poll the active thread (DM or group) every 3 seconds while the page is open.
  useEffect(() => {
    if (!token || !activeChat || location.pathname !== "/messages") return undefined;
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
      body: { email, password }
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

  async function register() {
    if (loadingAuth) return;
    setLoadingAuth(true);
    const res = await api("/auth/register", {
      method: "POST",
      body: { name, email, password, course }
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
  async function likeComment(comment) {
    if (!comment?.id) return;
    const res = await api(`/community/comments/${comment.id}/like`, { method: "POST" });
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
    if (!q) {
      setSearchResults([]);
      return;
    }
    const res = await api(`/users/search?q=${encodeURIComponent(q)}`);
    setSearchResults(res.error ? [] : res);
  }

  async function addFriend(friendId) {
    const res = await api(`/friends/${friendId}`, { method: "POST" });
    setNotice(res.error || "Friend added");
    if (!res.error) {
      await loadMessages();
      await searchUsers();
      if (activeChat?.kind !== "group" && activeChat?.user?.id === friendId) {
        const thread = await api(`/messages/with/${friendId}`);
        if (!thread.error) setActiveChat({ ...thread, kind: "dm" });
      }
    }
  }

  async function openChat(kind, id) {
    if (kind === "group") {
      const thread = await api(`/groups/${id}`);
      if (thread.error) return setNotice(thread.error);
      setActiveChat({ ...thread, kind: "group" });
    } else {
      const thread = await api(`/messages/with/${id}`);
      if (thread.error) return setNotice(thread.error);
      setActiveChat({ ...thread, kind: "dm" });
    }
    setSearchResults([]);
    await loadMessages();
  }

  // Unified send (DM or group). file is optional.
  // Send a chat message. Optionally attach a file and/or quote-reply another
  // message via replyToId.
  async function sendChatMessage(text, file, replyToId = null) {
    if (!activeChat) return;
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
    if (!message?.id) return;
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
              onLikeComment={likeComment}
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
            />
          }
        />
        <Route path="/notifications" element={<NotificationsPage notifications={notifications} />} />
        <Route
          path="/messages"
          element={
            <MessagesPage
              currentUser={user}
              conversations={conversations}
              activeChat={activeChat}
              searchResults={searchResults}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
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
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
