import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!token || !activeChat?.user?.id || location.pathname !== "/messages") return undefined;
    const interval = setInterval(async () => {
      const thread = await api(`/messages/with/${activeChat.user.id}`);
      if (!thread.error) setActiveChat(thread);
    }, 3000);
    return () => clearInterval(interval);
  }, [token, activeChat?.user?.id, location.pathname]);

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

  async function commentOnPost(postId, text) {
    const res = await api(`/community/posts/${postId}/comments`, {
      method: "POST",
      body: { text }
    });
    setNotice(res.error || "Comment added");
    if (!res.error) await loadCore();
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
      if (activeChat?.user?.id === friendId) {
        const thread = await api(`/messages/with/${friendId}`);
        if (!thread.error) setActiveChat(thread);
      }
    }
  }

  async function openChat(userId) {
    const thread = await api(`/messages/with/${userId}`);
    if (thread.error) return setNotice(thread.error);
    setActiveChat(thread);
    setSearchResults([]);
    await loadMessages();
  }

  async function sendDirectMessage(userId, text) {
    const res = await api(`/messages/with/${userId}`, {
      method: "POST",
      body: { text }
    });
    if (res.error) {
      setNotice(res.error);
      return;
    }
    const thread = await api(`/messages/with/${userId}`);
    if (!thread.error) setActiveChat(thread);
    await loadMessages();
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
              conversations={conversations}
              activeChat={activeChat}
              searchResults={searchResults}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onSearch={searchUsers}
              onAddFriend={addFriend}
              onOpenChat={openChat}
              onSendMessage={sendDirectMessage}
              onRefreshConversations={loadMessages}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
