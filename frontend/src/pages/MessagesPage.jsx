import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_ORIGIN, mediaUrl } from "../services/api.js";
import { SIGLACAST_AI_USER_ID } from "../constants/sentinelUsers.js";
import MentionInput from "../components/MentionInput.jsx";
import MentionText from "../components/MentionText.jsx";
import ReactionActorsModal from "../components/ReactionActorsModal.jsx";
import ModalPortal from "../components/ModalPortal.jsx";
import EmojiPickerButton from "../components/EmojiPickerButton.jsx";
import CommunityStoriesRail from "../components/CommunityStories.jsx";
import { useImageLightbox } from "../components/ImageLightboxContext.jsx";
import OverflowMarqueeText from "../components/OverflowMarqueeText.jsx";
import { listeningStatusLine } from "../utils/displayStatus.js";

const CHAT_REACTIONS = [
  { type: "like", emoji: "👍", label: "Like" },
  { type: "love", emoji: "❤️", label: "Love" },
  { type: "haha", emoji: "😂", label: "Haha" },
  { type: "wow",  emoji: "😮", label: "Wow"  },
  { type: "sad",  emoji: "😢", label: "Sad"  },
  { type: "cry", emoji: "😭", label: "Crying" },
  { type: "angry", emoji: "😡", label: "Angry" }
];
const CHAT_REACTION_MAP = CHAT_REACTIONS.reduce((acc, r) => {
  acc[r.type] = r;
  return acc;
}, {});

const DEFAULT_SERVER_ICON = "/assets/purxu-logo.png";
const DEFAULT_SERVERS = [];
const SERVER_INVITE_PARAM = "serverInvite";

function loadLocalServers() {
  if (typeof window === "undefined") return DEFAULT_SERVERS;
  try {
    const raw = localStorage.getItem("purxu_servers");
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed)
      ? parsed.filter((server) => server?.id !== "yuze-template")
      : DEFAULT_SERVERS;
  } catch (_) {
    return DEFAULT_SERVERS;
  }
}

function loadServerMessages() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem("purxu_server_messages") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveServerMessages(messages) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("purxu_server_messages", JSON.stringify(messages));
  } catch (_) {
    // Ignore storage quota/private mode errors.
  }
}

function saveLocalServers(servers) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("purxu_servers", JSON.stringify(servers));
  } catch (_) {
    // Ignore storage quota/private mode errors.
  }
}

function encodeServerInvite(server) {
  if (!server?.id || !server?.name) return "";
  const payload = {
    id: server.id,
    name: server.name,
    iconUrl: server.iconUrl || DEFAULT_SERVER_ICON,
    sections: server.sections || []
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch (_) {
    return "";
  }
}

function decodeServerInvite(raw) {
  if (!raw) return null;
  try {
    const normalized = String(raw).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(decodeURIComponent(escape(atob(padded))));
    if (!payload?.id || !payload?.name) return null;
    const sections = Array.isArray(payload.sections) && payload.sections.length
      ? payload.sections
      : [
          { id: "text", name: "Text Channels", channels: [{ id: `general-${payload.id}`, type: "text", name: "general" }] },
          { id: "voice", name: "Voice Channels", channels: [{ id: `lobby-${payload.id}`, type: "voice", name: "Lobby" }] }
        ];
    return {
      id: String(payload.id),
      name: String(payload.name).slice(0, 80),
      iconUrl: payload.iconUrl || DEFAULT_SERVER_ICON,
      sections
    };
  } catch (_) {
    return null;
  }
}

function serverInviteUrl(server) {
  const code = encodeServerInvite(server);
  if (!code || typeof window === "undefined") return "";
  return `${window.location.origin}/messages?${SERVER_INVITE_PARAM}=${encodeURIComponent(code)}`;
}

function findServerInvite(text) {
  const match = String(text || "").match(/[^\s]*(?:\?|&)serverInvite=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  return decodeServerInvite(match[1]);
}

function presenceDotAttrs(entity) {
  const rawPresence =
    entity && typeof entity.presence === "string" ? entity.presence.trim().toLowerCase() : null;
  const normalized =
    rawPresence === "idle" ||
    rawPresence === "dnd" ||
    rawPresence === "invisible" ||
    rawPresence === "online" ||
    rawPresence === "offline"
      ? rawPresence
      : entity?.isOnline === true
        ? "online"
        : "offline";
  /** @type {Record<string, string>} */
  const clsSuffix = {
    online: "presence-online",
    idle: "presence-idle",
    dnd: "presence-dnd",
    invisible: "presence-invisible",
    offline: "presence-offline"
  };
  /** @type {Record<string, string>} */
  const titles = {
    online: "Online",
    idle: "Idle",
    dnd: "Do not disturb",
    invisible: "Invisible — you appear offline to others",
    offline: "Offline"
  };
  const suf = clsSuffix[normalized] || clsSuffix.offline;
  return { className: `presence-dot ${suf}`, title: titles[normalized] || titles.offline };
}

function StatusEmojiChip({ emoji }) {
  if (!emoji) return null;
  return <span className="status-emoji-pill">{emoji}</span>;
}

export default function MessagesPage({
  token,
  currentUser,
  conversations,
  messagesArchivedView = false,
  onToggleMessagesArchived,
  onArchiveConversation,
  onUnarchiveConversation,
  activeChat,
  friendIncomingRequests = [],
  onAcceptFriendRequest,
  onRejectFriendRequest,
  searchResults,
  searchQuery,
  peopleSearchHint = "",
  setSearchQuery,
  onSearchQueryEdited,
  onSearch,
  onAddFriend,
  onOpenChat, // (kind, id)  kind: "dm" | "group" | "userphone"
  onSendMessage,         // (text, file) routed by App based on activeChat.kind
  onSendDirectMessage,   // (userId, text) sends a DM without switching threads
  onRefreshConversations,
  onCreateGroup,         // ({ name, memberIds, photoFile })
  onUpdateGroup,         // (groupId, { name, photoFile })
  onLeaveGroup,          // (groupId)
  onLoadAttachments,     // () => Promise<list>
  onAddMembers,          // (groupId, memberIds[])
  onRemoveMember,        // (groupId, userId)
  onChangeMemberRole,    // (groupId, userId, role)
  onDeleteGroup,         // (groupId)
  onReactToMessage,      // (messageId, reaction|null)
  onUnsendMessage,       // (message)
  onCloseMobileChat,      // () clears activeChat (mobile back out of thread)
  onUserphoneStart,
  onUserphoneEnd,
  onUserphoneSwitch,
  onUserphoneCancelWaiting,
  onStartGroupUserphoneBridge,
  onCancelGroupUserphoneWaiting,
  onEndGroupUserphoneBridge,
  userPhoneAutoReconnect,
  setUserPhoneAutoReconnect,
  onSendSiglaInActiveThread = async () => {},
  onOpenUserProfile,
  onUnauthorizedRetry,
  characters = [],
  liteMode = false
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusMenuPane, setPlusMenuPane] = useState("main");
  const [composePlusOpen, setComposePlusOpen] = useState(false);
  /** When enabled, Send asks purxu AI and posts assistant bubbles into this chat. */
  const [composeSiglaMode, setComposeSiglaMode] = useState(false);
  const [draftFile, setDraftFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [chatTab, setChatTab] = useState("users");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [servers, setServers] = useState(loadLocalServers);
  const [selectedServerId, setSelectedServerId] = useState(() => loadLocalServers()[0]?.id || "");
  const [selectedChannelId, setSelectedChannelId] = useState(() => loadLocalServers()[0]?.sections?.[0]?.channels?.[0]?.id || "");
  const [serverMessages, setServerMessages] = useState(loadServerMessages);
  const [serverDraft, setServerDraft] = useState("");
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [inviteServer, setInviteServer] = useState(null);
  const [pendingServerInvite, setPendingServerInvite] = useState(null);
  const [createChannelContext, setCreateChannelContext] = useState(null);
  const [channelMenu, setChannelMenu] = useState(null);
  const [channelSettings, setChannelSettings] = useState(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showAttachments, setShowAttachments] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bondHelpOpen, setBondHelpOpen] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const fileRef = useRef(null);
  const threadEndRef = useRef(null);
  const menuRef = useRef(null);
  const plusMenuRef = useRef(null);
  const composePlusRef = useRef(null);
  const [reactionModal, setReactionModal] = useState({ open: false, messageId: null });
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    typeof window !== "undefined" ? window.matchMedia("(max-width: 900px)").matches : false
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkDm = searchParams.get("dm");
  const deepLinkGroup = searchParams.get("group");
  const deepLinkServerInvite = searchParams.get(SERVER_INVITE_PARAM);
  const friendInviteTargets = useMemo(() => {
    const byId = new Map();
    (conversations || []).forEach((conversation) => {
      if (conversation?.kind !== "dm" || !conversation.user?.id) return;
      byId.set(conversation.user.id, conversation.user);
    });
    return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  }, [conversations]);
  const serverMembers = useMemo(() => {
    const me = currentUser
      ? [{ ...currentUser, id: currentUser.id || "me", name: currentUser.name || "You", presence: "online", isCurrentUser: true }]
      : [];
    return [...me, ...friendInviteTargets.map((friend) => ({ ...friend, presence: friend.presence || "online" }))];
  }, [currentUser, friendInviteTargets]);

  useEffect(() => {
    if (!deepLinkServerInvite) return undefined;
    const invite = decodeServerInvite(deepLinkServerInvite);
    if (invite) {
      setPendingServerInvite(invite);
      setChatTab("servers");
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(SERVER_INVITE_PARAM);
        return next;
      },
      { replace: true }
    );
    return undefined;
  }, [deepLinkServerInvite, setSearchParams]);

  useEffect(() => {
    if (!deepLinkDm && !deepLinkGroup) return undefined;
    let cancelled = false;
    (async () => {
      if (deepLinkDm) await onOpenChat?.("dm", deepLinkDm);
      else if (deepLinkGroup) await onOpenChat?.("group", deepLinkGroup);
      if (cancelled) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("dm");
          next.delete("group");
          return next;
        },
        { replace: true }
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [deepLinkDm, deepLinkGroup, navigate, onOpenChat, setSearchParams]);

  const isGroup = activeChat?.kind === "group";
  const isUserphone = activeChat?.kind === "userphone";
  const userphonePhase = isUserphone ? activeChat?.phase || "idle" : null;
  const gpu = isGroup ? activeChat?.groupUserphone : null;
  const groupUserphoneWaiting = gpu?.phase === "waiting";
  const groupUserphoneMatched = gpu?.phase === "matched";
  const mobileThreadFullscreen = isNarrowViewport && !!activeChat;
  /** DM/group always; solo Userphone only after a match so we can mirror anonymous + AI replies. */
  const showThreadComposer = !!activeChat && (!isUserphone || userphonePhase === "matched");
  const isSiglaDm = activeChat?.kind === "dm" && activeChat?.user?.id === SIGLACAST_AI_USER_ID;

  /** Must match backend USERPHONE_WAIT_MS / 1000 in server.js */
  const USERPHONE_QUEUE_SEC = 10;
  const [userphoneNow, setUserphoneNow] = useState(() => Date.now());
  useEffect(() => {
    const queueWaiting =
      (isUserphone && userphonePhase === "waiting") || (isGroup && groupUserphoneWaiting);
    if (!queueWaiting) return undefined;
    const t = setInterval(() => setUserphoneNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [isUserphone, userphonePhase, isGroup, groupUserphoneWaiting]);

  const soloWaitExpiry = activeChat?.waitExpiresAt;
  const groupWaitExpiry = gpu?.waitExpiresAt;
  const queueSecondsLeft =
    isUserphone && userphonePhase === "waiting" && soloWaitExpiry
      ? Math.max(0, Math.ceil((new Date(soloWaitExpiry).getTime() - userphoneNow) / 1000))
      : isGroup && groupUserphoneWaiting && groupWaitExpiry
        ? Math.max(0, Math.ceil((new Date(groupWaitExpiry).getTime() - userphoneNow) / 1000))
        : null;

  const queueCountdownPct =
    queueSecondsLeft != null ? Math.min(1, Math.max(0, queueSecondsLeft / USERPHONE_QUEUE_SEC)) : null;

  useEffect(() => {
    setDraft("");
    setDraftFile(null);
    setMenuOpen(false);
    setReplyTarget(null);
    setComposePlusOpen(false);
    setComposeSiglaMode(false);
  }, [
    activeChat?.kind,
    activeChat?.user?.id,
    activeChat?.group?.id,
    activeChat?.sessionId,
    activeChat?.phase,
    activeChat?.groupUserphone?.phase,
    activeChat?.id
  ]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsNarrowViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Jump to bottom when switching threads only (not on every poll / inbound message).
  useEffect(() => {
    if (!activeChat) return;
    const id = requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => cancelAnimationFrame(id);
  }, [
    activeChat?.kind,
    activeChat?.user?.id,
    activeChat?.group?.id,
    activeChat?.sessionId,
    activeChat?.phase,
    activeChat?.groupUserphone?.phase,
    activeChat?.id
  ]);

  // Click outside hamburger menu closes it
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const incomingFriendCount = Array.isArray(friendIncomingRequests) ? friendIncomingRequests.length : 0;
  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) || servers[0] || null,
    [servers, selectedServerId]
  );
  const selectedChannel = useMemo(() => {
    if (!selectedServer) return null;
    return selectedServer.sections
      .flatMap((section) => section.channels || [])
      .find((channel) => channel.id === selectedChannelId) || selectedServer.sections?.[0]?.channels?.[0] || null;
  }, [selectedChannelId, selectedServer]);

  useEffect(() => {
    saveLocalServers(servers);
  }, [servers]);

  useEffect(() => {
    saveServerMessages(serverMessages);
  }, [serverMessages]);

  useEffect(() => {
    if (!selectedServer && servers[0]) {
      setSelectedServerId(servers[0].id);
      setSelectedChannelId(servers[0].sections?.[0]?.channels?.[0]?.id || "");
      return;
    }
    if (selectedServer && !selectedChannel) {
      setSelectedChannelId(selectedServer.sections?.[0]?.channels?.[0]?.id || "");
    }
  }, [selectedChannel, selectedServer, servers]);

  function handleCreateServer({ name, iconUrl }) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const nextServer = {
      id: `server-${Date.now()}`,
      name: trimmed,
      iconUrl: iconUrl || DEFAULT_SERVER_ICON,
      sections: [
        {
          id: "text",
          name: "Text Channels",
          channels: [{ id: `general-${Date.now()}`, type: "text", name: "general" }]
        },
        {
          id: "voice",
          name: "Voice Channels",
          channels: [{ id: `lobby-${Date.now()}`, type: "voice", name: "Lobby" }]
        }
      ]
    };
    setServers((prev) => [nextServer, ...prev]);
    setSelectedServerId(nextServer.id);
    setSelectedChannelId(nextServer.sections[0].channels[0].id);
    setShowCreateServer(false);
    setChatTab("servers");
  }

  function handleUpdateServer({ name, iconUrl }) {
    if (!selectedServer) return;
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    setServers((prev) =>
      prev.map((server) =>
        server.id === selectedServer.id
          ? { ...server, name: trimmed, iconUrl: iconUrl || DEFAULT_SERVER_ICON }
          : server
      )
    );
    setServerSettingsOpen(false);
  }

  function joinInvitedServer(server) {
    if (!server?.id) return;
    setServers((prev) => {
      const existing = prev.find((row) => row.id === server.id);
      if (existing) return prev;
      return [server, ...prev];
    });
    setSelectedServerId(server.id);
    setSelectedChannelId(server.sections?.[0]?.channels?.[0]?.id || "");
    setChatTab("servers");
    setPendingServerInvite(null);
  }

  function updateChannel(channelId, updates) {
    setServers((prev) =>
      prev.map((server) => ({
        ...server,
        sections: (server.sections || []).map((section) => ({
          ...section,
          channels: (section.channels || []).map((channel) =>
            channel.id === channelId ? { ...channel, ...updates } : channel
          )
        }))
      }))
    );
  }

  function deleteChannel(channelId) {
    setServers((prev) =>
      prev.map((server) => ({
        ...server,
        sections: (server.sections || []).map((section) => ({
          ...section,
          channels: (section.channels || []).filter((channel) => channel.id !== channelId)
        }))
      }))
    );
    setServerMessages((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    if (selectedChannelId === channelId) {
      const fallback = selectedServer?.sections
        ?.flatMap((section) => section.channels || [])
        ?.find((channel) => channel.id !== channelId);
      setSelectedChannelId(fallback?.id || "");
    }
  }

  function sendServerMessage(e) {
    e.preventDefault();
    const text = serverDraft.trim();
    if (!text || !selectedChannel) return;
    const message = {
      id: `server-message-${Date.now()}`,
      text,
      author: currentUser?.name || "You",
      avatarUrl: currentUser?.avatarUrl || null,
      createdAt: new Date().toISOString()
    };
    setServerMessages((prev) => ({
      ...prev,
      [selectedChannel.id]: [...(prev[selectedChannel.id] || []), message]
    }));
    setServerDraft("");
  }

  function handleCreateServerChannel({ sectionId, channelType, name, isPrivate }) {
    if (!selectedServer || !sectionId || !name.trim()) return;
    const channel = {
      id: `channel-${Date.now()}`,
      type: channelType,
      name: name.trim().replace(/\s+/g, "-").toLowerCase(),
      private: Boolean(isPrivate)
    };
    setServers((prev) =>
      prev.map((server) => {
        if (server.id !== selectedServer.id) return server;
        return {
          ...server,
          sections: server.sections.map((section) =>
            section.id === sectionId
              ? { ...section, channels: [...section.channels, channel] }
              : section
          )
        };
      })
    );
    setSelectedChannelId(channel.id);
    setCreateChannelContext(null);
  }

  useEffect(() => {
    if (!plusMenuOpen) return undefined;
    function handleDoc(e) {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target)) {
        setPlusMenuOpen(false);
        setPlusMenuPane("main");
      }
    }
    document.addEventListener("mousedown", handleDoc);
    return () => document.removeEventListener("mousedown", handleDoc);
  }, [plusMenuOpen]);

  useEffect(() => {
    if (!composePlusOpen) return undefined;
    function handleDoc(e) {
      if (composePlusRef.current && !composePlusRef.current.contains(e.target)) {
        setComposePlusOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDoc);
    return () => document.removeEventListener("mousedown", handleDoc);
  }, [composePlusOpen]);

  useEffect(() => {
    if (!channelMenu) return undefined;
    const close = () => setChannelMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [channelMenu]);

  function renderAvatar(entity, size = "md", opts = {}) {
    const showPresence = !!(opts.showPresence && entity && !entity?.isGroup);
    const cls = size === "sm" ? "msg-avatar sm" : "msg-avatar";
    const isAi = entity?.id === SIGLACAST_AI_USER_ID;
    const url = entity?.avatarUrl || entity?.photoUrl;
    const inner = isAi ? (
      <div className={`${cls} placeholder chatbot-avatar`}>🤖</div>
    ) : url ? (
      <img className={cls} src={mediaUrl(url)} alt="" />
    ) : (
      <div className={`${cls} placeholder`}>{entity?.name?.charAt(0) || "?"}</div>
    );
    const pres = showPresence ? presenceDotAttrs(entity) : null;

    const profileClick =
      typeof opts.onProfileClick === "function" && entity?.id && entity.id !== SIGLACAST_AI_USER_ID
        ? opts.onProfileClick
        : null;

    const body = showPresence ? (
      <span className="avatar-with-presence">
        {inner}
        <span className={pres.className} title={pres.title} aria-hidden />
      </span>
    ) : inner;

    if (profileClick) {
      return (
        <button
          type="button"
          className="avatar-profile-hit"
          aria-label={`View ${entity?.name || "profile"}`}
          title="View profile"
          onClick={(e) => {
            e.stopPropagation();
            profileClick(entity.id, entity);
          }}
        >
          {body}
        </button>
      );
    }

    return body;
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if ((!text && !draftFile) || sending) return;

    if (composeSiglaMode) {
      if (!text) return;
      if (draftFile) {
        window.alert("Remove the attachment — Sigla replies are text-only in chat.");
        return;
      }
      setSending(true);
      try {
        await onSendSiglaInActiveThread?.(text, replyTarget?.id || null);
        requestAnimationFrame(() => {
          threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
        });
        setDraft("");
        setReplyTarget(null);
        if (fileRef.current) fileRef.current.value = "";
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    await onSendMessage(text, draftFile, replyTarget?.id || null);
    requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    setDraft("");
    setDraftFile(null);
    setReplyTarget(null);
    if (fileRef.current) fileRef.current.value = "";
    setSending(false);
  }

  // Reply / unsend on a single message bubble. `onUnsendMessage` handles confirm.
  function handleReply(message) {
    setReplyTarget({
      id: message.id,
      author: message.author || (message.fromMe ? currentUser?.name : (isGroup ? "member" : isUserphone ? "Anonymous" : activeChat?.user?.name)),
      text: message.text || (message.attachment?.isImage ? "📷 Photo" : message.attachment ? "📁 File" : "")
    });
  }
  async function handleUnsend(message) {
    if (!onUnsendMessage) return;
    if (window.confirm("Unsend this message? Others will see that it was unsent.")) {
      await onUnsendMessage(message);
    }
  }

  function pickAttachment(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraftFile(file);
  }

  return (
    <section
      className={`panel single messages-panel ${mobileThreadFullscreen ? "messages-mobile-fullscreen" : ""}`}
    >
      <div className="messages-layout">
        {chatTab === "users" && isNarrowViewport && token && !liteMode ? (
          <div
            className={`messages-mobile-stories${
              mobileThreadFullscreen ? " messages-mobile-stories--hidden-fullscreen" : ""
            }`}
          >
            <CommunityStoriesRail
              token={token}
              currentUser={currentUser}
              characters={characters}
              variant="horizontal"
              onOpenUserProfile={onOpenUserProfile}
            />
          </div>
        ) : null}
        <aside className="messages-sidebar">
          <div className="sidebar-top-row">
            <p className="sidebar-title">Chats</p>
            <div className="sidebar-plus-wrap" ref={plusMenuRef}>
              <button
                type="button"
                className="btn btn-primary btn-sm chat-plus-btn"
                onClick={() => {
                  setPlusMenuOpen((o) => !o);
                  setPlusMenuPane("main");
                }}
                aria-expanded={plusMenuOpen}
                aria-haspopup="menu"
                title="New chat menu"
              >
                ＋
                {incomingFriendCount > 0 ? (
                  <span className="nav-ping chat-plus-ping" aria-label={`${incomingFriendCount} friend requests`}>
                    {incomingFriendCount > 99 ? "99+" : incomingFriendCount}
                  </span>
                ) : null}
              </button>
              {plusMenuOpen ? (
                <div className="chat-plus-dropdown" role="menu">
                  {plusMenuPane === "main" ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-plus-item"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          setShowCreateGroup(true);
                        }}
                      >
                        Add a group chat
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-plus-item"
                        onClick={() => {
                          setPlusMenuOpen(false);
                          setShowCreateServer(true);
                          setChatTab("servers");
                        }}
                      >
                        Create a server
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-plus-item chat-plus-item-row"
                        onClick={() => setPlusMenuPane("apps")}
                      >
                        <span className="chat-plus-item-label">Add an app</span>
                        <span className="muted small" aria-hidden>
                          ›
                        </span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-plus-item chat-plus-item-row"
                        onClick={() => setPlusMenuPane("requests")}
                      >
                        <span className="chat-plus-item-label">Friend requests</span>
                        {incomingFriendCount > 0 ? (
                          <span className="nav-ping chat-dropdown-ping">{incomingFriendCount}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="chat-plus-item"
                        aria-pressed={messagesArchivedView}
                        onClick={() => {
                          setPlusMenuOpen(false);
                          onToggleMessagesArchived?.();
                        }}
                      >
                        {messagesArchivedView ? "✉️ Active chats" : "📦 Archived chats"}
                      </button>
                    </>
                  ) : plusMenuPane === "apps" ? (
                    <>
                      <button
                        type="button"
                        className="chat-plus-back"
                        onClick={() => setPlusMenuPane("main")}
                      >
                        ← Back
                      </button>
                      <p className="chat-apps-intro muted small">
                        <strong>Assistant</strong> opens its own page (not mixed into your Chats list). To drop Sigla{" "}
                        <strong>into an existing thread</strong> as a participant, open that chat → ＋ by the composer → ✨
                        Sigla replies here.
                      </p>
                      <ul className="chat-apps-menu">
                        <li className="chat-app-row">
                          <div className="chat-app-meta">
                            <strong>Userphone</strong>
                            <span className="muted small">Anonymous matching chat</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setPlusMenuOpen(false);
                              setPlusMenuPane("main");
                              onOpenChat?.("userphone", "userphone");
                            }}
                          >
                            Open
                          </button>
                        </li>
                        <li className="chat-app-row">
                          <div className="chat-app-meta">
                            <strong>Assistant</strong>
                            <span className="muted small">Ask our AI helpful questions</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => {
                              setPlusMenuOpen(false);
                              setPlusMenuPane("main");
                              onOpenChat?.("dm", SIGLACAST_AI_USER_ID);
                            }}
                          >
                            Open
                          </button>
                        </li>
                      </ul>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="chat-plus-back"
                        onClick={() => setPlusMenuPane("main")}
                      >
                        ← Back
                      </button>
                      {incomingFriendCount === 0 ? (
                        <p className="muted small chat-plus-empty">No pending requests.</p>
                      ) : (
                        <ul className="friend-requests-menu-list">
                          {friendIncomingRequests.map((r) => (
                            <li key={r.id} className="friend-requests-menu-row">
                              {renderAvatar(r.from, "sm", {
                                showPresence: true,
                                onProfileClick: onOpenUserProfile
                              })}
                              <div className="friend-requests-menu-meta">
                                <strong className="user-line-name">
                                  {r.from?.name} <StatusEmojiChip emoji={r.from?.statusEmoji} />
                                </strong>
                                {(() => {
                                  const line = listeningStatusLine(r.from);
                                  return line ? (
                                    <span className="friend-req-status-line" title={line}>
                                      <OverflowMarqueeText text={line} />
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                              <div className="friend-requests-menu-actions">
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => onAcceptFriendRequest?.(r.id)}
                                  title="Accept"
                                >
                                  ✓
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => onRejectFriendRequest?.(r.id)}
                                  title="Decline"
                                >
                                  ✕
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="story-identity-switch chat-list-switch" style={{ display: "flex", width: "100%", marginBottom: "10px", boxSizing: "border-box" }}>
            <button
              type="button"
              className={chatTab === "users" ? "active" : ""}
              onClick={() => setChatTab("users")}
              style={{ flex: 1 }}
            >
              Users
            </button>
            <button
              type="button"
              className={chatTab === "servers" ? "active" : ""}
              onClick={() => setChatTab("servers")}
              style={{ flex: 1 }}
            >
              Servers
            </button>
          </div>

          {chatTab === "users" ? (
            <>
              {messagesArchivedView ? (
                <div className="sidebar-archived-back-row">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm sidebar-archived-back-btn"
                    onClick={() => onToggleMessagesArchived?.()}
                  >
                    ← Active chats
                  </button>
                </div>
              ) : null}

              <form
                className="friend-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  onSearch?.();
                }}
              >
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    onSearchQueryEdited?.();
                    setSearchQuery(e.target.value);
                  }}
                  placeholder="Search people…"
                  aria-label="Search people by name or email"
                />
                <button type="submit" className="friend-search-btn" aria-label="Search">
                  🔍
                </button>
                {peopleSearchHint ? (
                  <p className="people-search-hint muted small">{peopleSearchHint}</p>
                ) : null}
              </form>

              {(searchResults || []).length > 0 ? (
                <div className="search-results">
                  <p className="search-results-title">Search results</p>
                  {searchResults.map((u) => (
                    <div key={u.id} className="search-result-row">
                      {renderAvatar(u, "sm", { showPresence: true, onProfileClick: onOpenUserProfile })}
                      <div className="search-result-info">
                        <strong className="user-line-name">
                          {u.name} <StatusEmojiChip emoji={u.statusEmoji} />
                        </strong>
                        {(() => {
                          const line = listeningStatusLine(u);
                          return line ? (
                            <span className="search-result-status" title={line}>
                              <OverflowMarqueeText text={line} />
                            </span>
                          ) : null;
                        })()}
                      </div>
                      <div className="search-result-actions">
                        {u.isFriend ? (
                          <span className="pill pill-you">Friends</span>
                        ) : u.incomingRequestId ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => onAcceptFriendRequest?.(u.incomingRequestId)}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => onRejectFriendRequest?.(u.incomingRequestId)}
                            >
                              Decline
                            </button>
                          </>
                        ) : u.outgoingRequestPending ? (
                          <span className="pill pill-muted small">Requested</span>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onAddFriend(u.id)}>
                            Request
                          </button>
                        )}
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenChat("dm", u.id)}>
                          💬
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="conv-list">
                {!(conversations || []).some((c) => c.kind === "dm" || c.kind === "group") && messagesArchivedView ? (
                  <p className="empty-hint muted small archive-empty-msg">No archived chats. Tap Active chats.</p>
                ) : !(conversations || []).some((c) => c.kind === "dm" || c.kind === "group") && !messagesArchivedView ? (
                  <p className="empty-hint">No conversations yet. Search someone or use the ＋ menu.</p>
                ) : null}
                {(conversations || []).map((c) => {
                    const isDmOrPhone = c.kind === "dm" || c.kind === "userphone";
                    const target = c.kind === "group" ? c.group : c.user;
                    const isActive =
                      (c.kind === "group" && activeChat?.kind === "group" && activeChat?.group?.id === c.group?.id) ||
                      (c.kind === "dm" && activeChat?.kind === "dm" && activeChat?.user?.id === c.user?.id) ||
                      (c.kind === "userphone" && activeChat?.kind === "userphone");

                    function openThisConversation() {
                      if (c.kind === "userphone") return onOpenChat?.("userphone", "userphone");
                      return onOpenChat?.(c.kind, isDmOrPhone && c.kind === "dm" ? c.user.id : c.group.id);
                    }

                    return (
                      <div
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        className={`conv-item ${c.kind === "userphone" ? "conv-userphone" : ""} ${isActive ? "active" : ""}`}
                        onClick={openThisConversation}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openThisConversation();
                          }
                        }}
                      >
                        {c.kind === "userphone" ? (
                          <div className="msg-avatar sm placeholder conv-userphone-avatar" aria-hidden>
                            📞
                          </div>
                        ) : c.kind === "dm" ? (
                          renderAvatar(target, "sm", { showPresence: true, onProfileClick: onOpenUserProfile })
                        ) : (
                          renderAvatar(target, "sm")
                        )}
                        <div className="conv-item-body">
                          <strong className={c.kind === "dm" ? "user-line-name" : undefined}>
                            {target?.name || "Unknown"}{" "}
                            {!isDmOrPhone ? <span className="pill pill-muted small">group</span> : null}
                            {c.kind === "userphone" ? (
                              <span className="pill pill-muted small">anonymous</span>
                            ) : null}
                            {c.kind === "dm" ? <StatusEmojiChip emoji={target?.statusEmoji} /> : null}
                          </strong>
                          {c.kind === "dm" ? (
                            (() => {
                              const line = listeningStatusLine(target);
                              return line ? (
                                <span className="conv-status-sub" title={line}>
                                  <OverflowMarqueeText text={line} />
                                </span>
                              ) : null;
                            })()
                          ) : null}
                          <span className="conv-preview">
                            {c.lastMessage
                              ? `${c.lastMessage.fromMe ? "You: " : ""}${findServerInvite(c.lastMessage.text) ? "Server invite" : c.lastMessage.text || ""}`
                              : "No messages yet"}
                          </span>
                        </div>
                        <div className="conv-item-tail">
                          {!messagesArchivedView && (c.kind === "dm" || c.kind === "group") ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm conv-row-archive-btn"
                              aria-label="Archive chat"
                              title="Archive"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void (c.kind === "group"
                                  ? onArchiveConversation?.({ conversationId: c.group.id })
                                  : onArchiveConversation?.({ dmPeerId: c.user.id }));
                              }}
                            >
                              <span className="ui-icon ui-icon-box" aria-hidden="true" />
                            </button>
                          ) : messagesArchivedView && (c.kind === "dm" || c.kind === "group") ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm conv-row-archive-btn"
                              aria-label="Restore chat"
                              title="Restore to active"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void (c.kind === "group"
                                  ? onUnarchiveConversation?.({ conversationId: c.group.id })
                                  : onUnarchiveConversation?.({ dmPeerId: c.user.id }));
                              }}
                            >
                              <span className="ui-icon ui-icon-box" aria-hidden="true" />
                            </button>
                          ) : null}
                          {c.unreadCount > 0 ? <span className="unread-dot">{c.unreadCount}</span> : null}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <ServerWorkspace
              servers={servers}
              selectedServer={selectedServer}
              selectedChannel={selectedChannel}
              onSelectServer={(server) => {
                setSelectedServerId(server.id);
                setSelectedChannelId(server.sections?.[0]?.channels?.[0]?.id || "");
              }}
              onSelectChannel={(channel) => setSelectedChannelId(channel.id)}
              onCreateServer={() => setShowCreateServer(true)}
              onCreateChannel={(section) =>
                setCreateChannelContext({
                  serverId: selectedServer?.id || "",
                  sectionId: section.id,
                  sectionName: section.name
                })
              }
              onInviteServer={(server) => setInviteServer(server)}
              onOpenServerSettings={() => setServerSettingsOpen(true)}
              onOpenChannelMenu={(channel, x, y) => setChannelMenu({ channel, x, y })}
            />
          )}
        </aside>

        <div className="messages-thread">
          {chatTab === "servers" ? (
            <ServerChannelPreview
              server={selectedServer}
              channel={selectedChannel}
              messages={selectedChannel ? serverMessages[selectedChannel.id] || [] : []}
              draft={serverDraft}
              onDraft={setServerDraft}
              onSend={sendServerMessage}
              currentUser={currentUser}
              members={serverMembers}
              onCreateServer={() => setShowCreateServer(true)}
              onJoinServerInvite={joinInvitedServer}
              onOpenUserProfile={onOpenUserProfile}
            />
          ) : !activeChat ? (
            <div className="thread-empty">
              <p>Select a chat from the left or use the ＋ menu to start a group or review friend requests.</p>
            </div>
          ) : (
            <>
              <div className="thread-header">
                {mobileThreadFullscreen && onCloseMobileChat ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm thread-back-btn"
                    onClick={() => onCloseMobileChat()}
                    aria-label="Back to chat list"
                  >
                    ← Back
                  </button>
                ) : null}
                {isUserphone ? (
                  <div className="msg-avatar placeholder thread-userphone-icon" aria-hidden>
                    📞
                  </div>
                ) : (
                  renderAvatar(isGroup ? activeChat.group : activeChat.user, "md", {
                    showPresence: !isGroup,
                    onProfileClick:
                      !isGroup && !isUserphone && activeChat.user?.id !== SIGLACAST_AI_USER_ID
                        ? onOpenUserProfile
                        : undefined
                  })
                )}
                <div className="thread-header-info">
                  <strong className={!isGroup && !isUserphone ? "user-line-name" : undefined}>
                    {isUserphone ? "Userphone" : isGroup ? activeChat.group?.name : activeChat.user?.name}
                    {!isGroup && !isUserphone ? (
                      <StatusEmojiChip emoji={activeChat.user?.statusEmoji} />
                    ) : null}
                  </strong>
                  {isUserphone ? (
                    <small>Random anonymous chats — identities stay hidden.</small>
                  ) : isGroup ? (
                    <small>{activeChat.group?.members?.length || 0} members</small>
                  ) : (
                    (() => {
                      const line = listeningStatusLine(activeChat.user);
                      return (
                        <>
                          {line ? (
                            <p className="thread-header-custom-note">
                              <OverflowMarqueeText text={line} />
                            </p>
                          ) : null}
                        </>
                      );
                    })()
                  )}
                  {!isGroup && !isUserphone && activeChat.bond ? (
                    <div className="bond-thread-meter">
                      <div className="bond-thread-meter-top">
                        <span>{activeChat.bond.levelLabel} Bond</span>
                        <strong>{activeChat.bond.exp} EXP</strong>
                        <button type="button" aria-label="Bond benefits" onClick={() => setBondHelpOpen((open) => !open)}>
                          ?
                        </button>
                      </div>
                      <div className="bond-thread-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(4, Math.min(100, activeChat.bond.progress || 0))}%` }} />
                      </div>
                      {bondHelpOpen ? (
                        <div className="bond-help-popover">
                          <strong>{activeChat.bond.levelLabel} Bond Benefits</strong>
                          <p>{activeChat.bond.benefit}</p>
                          {activeChat.bond.nextLevelExp ? (
                            <small>{Math.max(0, activeChat.bond.nextLevelExp - activeChat.bond.exp)} EXP until the next bond level.</small>
                          ) : (
                            <small>Max bond reached.</small>
                          )}
                          <ul>
                            <li>0-100: Stranger · +1% EXP gain</li>
                            <li>100-200: Acquaintance · +1 character slot</li>
                            <li>200-300: Friend · profile bond display</li>
                            <li>300-500: Partner · special frames and badges</li>
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {!isGroup && !isUserphone ? (
                    activeChat.incomingRequestId ? (
                      <span className="thread-header-inline-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onAcceptFriendRequest?.(activeChat.incomingRequestId)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onRejectFriendRequest?.(activeChat.incomingRequestId)}
                        >
                          Decline
                        </button>
                      </span>
                    ) : activeChat.outgoingRequestPending ? (
                      <span className="pill pill-muted small">Request sent</span>
                    ) : !activeChat.isFriend ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onAddFriend(activeChat.user.id)}
                      >
                        Request friend
                      </button>
                    ) : null
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={onRefreshConversations}
                  title="Refresh"
                >
                  ↻
                </button>
                {!isUserphone ? (
                  <div className="thread-menu-wrap" ref={menuRef}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm thread-menu-btn"
                      onClick={() => setMenuOpen((v) => !v)}
                      title="Chat settings"
                    >
                      ☰
                    </button>
                    {menuOpen ? (
                      <div className="thread-menu">
                        {isGroup ? (
                          <>
                            <button
                              type="button"
                              className="thread-menu-item"
                              onClick={() => {
                                setMenuOpen(false);
                                setShowGroupSettings(true);
                              }}
                            >
                              ⚙️ Settings
                            </button>
                            <button
                              type="button"
                              className="thread-menu-item"
                              onClick={() => {
                                setMenuOpen(false);
                                setShowAttachments(true);
                              }}
                            >
                              🖼️ Files & images
                            </button>
                            <button
                              type="button"
                              className="thread-menu-item"
                              onClick={async () => {
                                setMenuOpen(false);
                                if (
                                  window.confirm(
                                    "Archive this group? It hides from Active until you restore from Archived."
                                  )
                                ) {
                                  await onArchiveConversation?.({ conversationId: activeChat.group.id });
                                }
                              }}
                            >
                              📦 Archive group
                            </button>
                            <button
                              type="button"
                              className="thread-menu-item danger"
                              onClick={async () => {
                                setMenuOpen(false);
                                if (window.confirm("Leave this group chat?")) {
                                  await onLeaveGroup?.(activeChat.group.id);
                                }
                              }}
                            >
                              🚪 Leave group
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="thread-menu-item"
                              onClick={() => {
                                setMenuOpen(false);
                                setShowAttachments(true);
                              }}
                            >
                              🖼️ Files & images
                            </button>
                            <button
                              type="button"
                              className="thread-menu-item"
                              onClick={async () => {
                                setMenuOpen(false);
                                if (
                                  window.confirm(
                                    "Archive this chat? It hides from Active until you restore from Archived."
                                  )
                                ) {
                                  await onArchiveConversation?.({ dmPeerId: activeChat.user.id });
                                }
                              }}
                            >
                              📦 Archive chat
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {isGroup && groupUserphoneMatched ? (
                <div className="userphone-toolbar">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onEndGroupUserphoneBridge?.(activeChat.group.id)}
                  >
                    End Userphone
                  </button>
                </div>
              ) : null}

              {isUserphone && userphonePhase === "matched" ? (
                <div className="userphone-toolbar">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => onUserphoneEnd?.()}>
                    End call
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onUserphoneSwitch?.()}>
                    Switch call
                  </button>
                </div>
              ) : null}

              {isUserphone && userphonePhase !== "matched" ? (
                <div className="userphone-cta-wrap">
                  {userphonePhase === "idle" ? (
                    <>
                      <p className="userphone-intro">
                        Match with anyone else who opens Userphone. You will both appear as{" "}
                        <strong>Anonymous</strong>.
                      </p>
                      <label className="userphone-auto-row">
                        <input
                          type="checkbox"
                          checked={!!userPhoneAutoReconnect}
                          onChange={(e) => setUserPhoneAutoReconnect(e.target.checked)}
                        />
                        <span>Keep joining the queue automatically until someone matches</span>
                      </label>
                      <button type="button" className="btn btn-primary userphone-big-btn" onClick={() => onUserphoneStart?.()}>
                        Call anonymous
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="userphone-intro userphone-countdown-line">
                        {queueSecondsLeft != null ? (
                          <>
                            Matching…{" "}
                            <span className="userphone-countdown-digits">{queueSecondsLeft}</span>s left before you
                            leave the queue.
                          </>
                        ) : (
                          <>Searching for someone else on Userphone…</>
                        )}
                      </p>
                      <p className="userphone-timeout-hint muted small">
                        {userPhoneAutoReconnect
                          ? "Each round lasts 10s; you’ll stay in queue automatically until you match or tap Cancel."
                          : "If no one joins in time, tap Call anonymous again when someone might be online."}
                      </p>
                      {queueCountdownPct != null ? (
                        <div className="userphone-queue-meter" aria-label="Time left in queue">
                          <div
                            className="userphone-queue-meter-fill"
                            style={{
                              width: `${Math.round(Math.min(100, Math.max(0, queueCountdownPct * 100)))}%`
                            }}
                          />
                        </div>
                      ) : (
                        <div className="userphone-spinner" aria-busy />
                      )}
                      <label className="userphone-auto-row userphone-auto-row-inline">
                        <input
                          type="checkbox"
                          checked={!!userPhoneAutoReconnect}
                          onChange={(e) => setUserPhoneAutoReconnect(e.target.checked)}
                        />
                        <span>Keep auto-rejoining after each round</span>
                      </label>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUserphoneCancelWaiting?.()}>
                        Cancel search
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="thread-messages">
                    {(activeChat.messages || []).map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      showAuthor={isGroup && !m.fromMe}
                      minimal={isUserphone && m.author !== "purxu AI"}
                      swipeReplyEnabled={isNarrowViewport && !isUserphone}
                      activeChat={activeChat}
                      isUserphone={isUserphone}
                      onReact={onReactToMessage}
                      onReply={handleReply}
                      onUnsend={handleUnsend}
                      onOpenReactors={(id) => setReactionModal({ open: true, messageId: id })}
                      onOpenUserProfile={onOpenUserProfile}
                      onJoinServerInvite={joinInvitedServer}
                      liteMode={liteMode}
                    />
                    ))}
                    {activeChat.typingActors && activeChat.typingActors.map((actor) => (
                      <div className="bubble-row row-them" key={actor.id} style={{ marginBottom: "8px" }}>
                        {actor.avatarUrl ? (
                          <img className="msg-avatar sm" src={mediaUrl(actor.avatarUrl)} alt="" />
                        ) : (
                          <div className="msg-avatar sm placeholder">{actor.name?.charAt(0) || "?"}</div>
                        )}
                        <div className="bubble-stack">
                          <div className="bubble bubble-them">
                            {isGroup ? <p className="bubble-author">{actor.name}</p> : null}
                            <span className="typing-dots" aria-label={`${actor.name} is typing`}>
                              <span />
                              <span />
                              <span />
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isGroup && groupUserphoneWaiting ? (
                      <GroupUserphoneQueueBubbleRow
                        displayName={currentUser?.name || "You"}
                        secondsLeft={queueSecondsLeft}
                        pct={queueCountdownPct}
                        onCancel={() => onCancelGroupUserphoneWaiting?.(activeChat.group.id)}
                      />
                    ) : null}
                    <div ref={threadEndRef} />
                  </div>
                </>
              )}

              {replyTarget && !isUserphone ? (
                <div className="reply-banner">
                  <div className="reply-banner-info">
                    <span className="reply-banner-label">Replying to {replyTarget.author}</span>
                    <span className="reply-banner-text">{replyTarget.text || "(message)"}</span>
                  </div>
                  <button
                    type="button"
                    className="reply-banner-close"
                    onClick={() => setReplyTarget(null)}
                    title="Cancel reply"
                  >
                    ✕
                  </button>
                </div>
              ) : null}

              {composeSiglaMode && showThreadComposer ? (
                <div className="sigla-compose-hint muted small">
                  ✨ purxu AI replies <strong>in this chat thread</strong> as a participant (everyone sees the same
                  bubble). Attachments are ignored while this is on — toggle off via ＋.
                </div>
              ) : null}

              {showThreadComposer ? (
              <form className="thread-compose" onSubmit={handleSend}>
                {showThreadComposer && !composeSiglaMode && !isUserphone && !isSiglaDm ? (
                <input
                  ref={fileRef}
                  type="file"
                  className="sr-only"
                  onChange={pickAttachment}
                />
                ) : null}
                {showThreadComposer ? (
                <div className="compose-plus-wrap" ref={composePlusRef}>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-expanded={composePlusOpen}
                    aria-haspopup="menu"
                    title={composeSiglaMode ? "Menu (Sigla mode is on)" : "Apps & quick actions"}
                    onClick={() => setComposePlusOpen((o) => !o)}
                  >
                    ＋
                  </button>
                  {composePlusOpen ? (
                    <div className="compose-plus-dropdown" role="menu">
                      {isGroup ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="compose-plus-item"
                          onClick={async () => {
                            setComposePlusOpen(false);
                            await onStartGroupUserphoneBridge?.(activeChat.group.id);
                          }}
                        >
                          <span className="compose-plus-item-title">📞 Userphone (this group)</span>
                          <span className="compose-plus-item-desc">
                            Queues this group anonymously with another group. Stay in this chat — mirrored messages appear
                            as Anonymous.
                          </span>
                        </button>
                      ) : !isUserphone ? (
                        <button
                          type="button"
                          role="menuitem"
                          className="compose-plus-item"
                          onClick={async () => {
                            setComposePlusOpen(false);
                            await onOpenChat?.("userphone", "userphone");
                            await onUserphoneStart?.();
                          }}
                        >
                          <span className="compose-plus-item-title">📞 Userphone</span>
                          <span className="compose-plus-item-desc">
                            Anonymous 1-on-1 queue when someone else is on Userphone too. Opens the Userphone tab.
                          </span>
                        </button>
                      ) : (
                        <p className="muted small compose-plus-item" style={{ margin: "4px 0 10px", paddingRight: "8px" }}>
                          Anonymous Userphone pairing is active in this chat — use 📞 toolbar for bridge actions.
                        </p>
                      )}
                      {!isSiglaDm ? (
                        <button
                          type="button"
                          role="menuitem"
                          className={`compose-plus-item ${composeSiglaMode ? "compose-plus-item-active" : ""}`}
                          onClick={() => {
                            setComposePlusOpen(false);
                            setComposeSiglaMode((v) => !v);
                            setDraftFile(null);
                            if (fileRef.current) fileRef.current.value = "";
                          }}
                        >
                          <span className="compose-plus-item-title">
                            ✨ Sigla replies here {composeSiglaMode ? "(on)" : "(off)"}
                          </span>
                          <span className="compose-plus-item-desc">
                            Your sends go to purxu AI until you turn this off — answers appear like normal messages from ✨
                            purxu AI.
                          </span>
                        </button>
                      ) : (
                        <p className="muted small compose-plus-item" style={{ margin: "4px 0 10px", paddingRight: "8px" }}>
                          You&apos;re chatting with purxu AI — send messages normally for AI replies.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
                ) : null}
                {showThreadComposer && !composeSiglaMode && !isUserphone && !isSiglaDm ? (
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Attach file"
                  onClick={() => fileRef.current?.click()}
                >
                  📎
                </button>
                ) : null}
                {!isUserphone && !isSiglaDm && draftFile ? (
                <div className="draft-file-chip">
                  <span>📁 {draftFile.name}</span>
                  <button
                    type="button"
                    className="draft-file-clear"
                    onClick={() => {
                      setDraftFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
                ) : null}
                <EmojiPickerButton onPick={(emoji) => setDraft((d) => d + emoji)} />
                <MentionInput
                  value={draft}
                  onChange={setDraft}
                  placeholder={
                    composeSiglaMode
                      ? `Ask purxu AI (${isUserphone ? "this anonymous chat" : isGroup ? activeChat.group?.name || "group" : activeChat.user?.name || "DM"})…`
                      : isSiglaDm
                        ? "Ask purxu AI anything…"
                        : isUserphone
                          ? "Message anonymously…"
                          : isGroup
                            ? `Message ${activeChat.group?.name}… use @ to mention`
                            : `Message ${activeChat.user?.name}… use @ to mention`
                  }
                />
                <button
                  type="submit"
                  className="btn btn-primary btn-send-msg"
                  disabled={sending}
                  aria-label="Send message"
                >
                  {sending ? "…" : composeSiglaMode ? "✨" : "➤"}
                </button>
              </form>
              ) : null}
            </>
          )}
        </div>

        {chatTab === "users" && !isNarrowViewport && token && !liteMode ? (
          <aside className="messages-stories-sidebar" aria-label="Stories">
            <CommunityStoriesRail
              token={token}
              currentUser={currentUser}
              characters={characters}
              variant="vertical"
              onOpenUserProfile={onOpenUserProfile}
              onUnauthorizedRetry={onUnauthorizedRetry}
            />
          </aside>
        ) : null}
      </div>

      {showCreateGroup ? (
        <CreateGroupModal
          currentUser={currentUser}
          onClose={() => setShowCreateGroup(false)}
          onCreate={async (payload) => {
            await onCreateGroup(payload);
            setShowCreateGroup(false);
          }}
        />
      ) : null}

      {showCreateServer ? (
        <CreateServerModal
          onClose={() => setShowCreateServer(false)}
          onCreate={handleCreateServer}
        />
      ) : null}

      {serverSettingsOpen && selectedServer ? (
        <ServerSettingsModal
          server={selectedServer}
          onClose={() => setServerSettingsOpen(false)}
          onSave={handleUpdateServer}
        />
      ) : null}

      {createChannelContext ? (
        <CreateServerChannelModal
          sectionName={createChannelContext.sectionName}
          onClose={() => setCreateChannelContext(null)}
          onCreate={(payload) =>
            handleCreateServerChannel({
              ...payload,
              sectionId: createChannelContext.sectionId
            })
          }
        />
      ) : null}

      {channelMenu ? (
        <div
          className="server-channel-context-menu"
          style={{ left: channelMenu.x, top: channelMenu.y }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => {
              setChannelSettings(channelMenu.channel);
              setChannelMenu(null);
            }}
          >
            Settings
          </button>
        </div>
      ) : null}

      {channelSettings ? (
        <ServerChannelSettingsModal
          channel={channelSettings}
          onClose={() => setChannelSettings(null)}
          onSave={(updates) => {
            updateChannel(channelSettings.id, updates);
            setChannelSettings(null);
          }}
          onDelete={() => {
            deleteChannel(channelSettings.id);
            setChannelSettings(null);
          }}
        />
      ) : null}

      {showGroupSettings && isGroup ? (
        <GroupSettingsModal
          currentUser={currentUser}
          group={activeChat.group}
          onClose={() => setShowGroupSettings(false)}
          onOpenUserProfile={onOpenUserProfile}
          onSave={async (payload) => {
            await onUpdateGroup(activeChat.group.id, payload);
          }}
          onAddMembers={async (memberIds) => {
            await onAddMembers?.(activeChat.group.id, memberIds);
          }}
          onRemoveMember={async (userId) => {
            await onRemoveMember?.(activeChat.group.id, userId);
          }}
          onChangeRole={async (userId, role) => {
            await onChangeMemberRole?.(activeChat.group.id, userId, role);
          }}
          onLeaveGroup={async () => {
            setShowGroupSettings(false);
            await onLeaveGroup?.(activeChat.group.id);
          }}
          onDeleteGroup={async () => {
            setShowGroupSettings(false);
            await onDeleteGroup?.(activeChat.group.id);
          }}
        />
      ) : null}

      {showAttachments ? (
        <AttachmentsModal
          loader={onLoadAttachments}
          onClose={() => setShowAttachments(false)}
          liteMode={liteMode}
        />
      ) : null}

      {inviteServer ? (
        <ServerInviteModal
          server={inviteServer}
          friends={friendInviteTargets}
          onSendInvite={onSendDirectMessage}
          onClose={() => setInviteServer(null)}
        />
      ) : null}

      {pendingServerInvite ? (
        <ServerJoinModal
          server={pendingServerInvite}
          onClose={() => setPendingServerInvite(null)}
          onJoin={() => joinInvitedServer(pendingServerInvite)}
        />
      ) : null}

      {reactionModal.open && reactionModal.messageId ? (
        <ReactionActorsModal
          title="Reactions"
          path={`/messages/${reactionModal.messageId}/reactors`}
          reactionTypes={CHAT_REACTIONS}
          onClose={() => setReactionModal({ open: false, messageId: null })}
        />
      ) : null}
    </section>
  );
}

function MessageAttachment({ att, liteMode = false }) {
  const { openLightbox } = useImageLightbox();
  if (att.isImage) {
    if (liteMode) {
      return (
        <div className="bubble-file bubble-file-lite">
          Image hidden in Lite mode
          {att.size ? <small>{formatBytes(att.size)}</small> : null}
        </div>
      );
    }
    const src = mediaUrl(att.url);
    return (
      <button
        type="button"
        className="bubble-image-lightbox-trigger"
        onClick={() => openLightbox(src)}
        aria-label={att.name ? `View image: ${att.name}` : "View full image"}
      >
        <img className="bubble-image" src={src} alt={att.name || "image"} />
      </button>
    );
  }
  return (
    <a className="bubble-file" href={att.url} target="_blank" rel="noreferrer" download>
      📁 <span className="bubble-file-name">{att.name || "Download file"}</span>
      {att.size ? <small>{formatBytes(att.size)}</small> : null}
    </a>
  );
}

function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Inline “queued for 10s” status for group Userphone — visually matches outbound chat bubbles. */
function GroupUserphoneQueueBubbleRow({ displayName, secondsLeft, pct, onCancel }) {
  const lineMain =
    secondsLeft != null
      ? `Connecting anonymous Userphone… ${secondsLeft}s left in this search round.`
      : "Connecting anonymous Userphone — searching for another group chat…";
  const meterPct = pct != null ? `${Math.round(Math.min(100, Math.max(0, pct * 100)))}%` : null;
  return (
    <div className="bubble-row row-me gc-userphone-queue-msg" role="status" aria-live="polite">
      <div className="bubble-stack">
        <div className="bubble-with-actions">
          <div className="bubble bubble-me gc-userphone-queue-bubble-inner">
            <p className="bubble-author">{displayName}</p>
            <p className="gc-userphone-queue-text">{lineMain}</p>
            <p className="gc-userphone-queue-sub muted small">
              When matched, messages from people in the other group appear here as Anonymous.
            </p>
            {meterPct != null ? (
              <div className="userphone-queue-meter gc-userphone-queue-meter" aria-label="Time left in queue">
                <div className="userphone-queue-meter-fill" style={{ width: meterPct }} />
              </div>
            ) : (
              <div className="userphone-spinner gc-userphone-queue-spinner" aria-busy />
            )}
            <div className="bubble-meta-row gc-userphone-queue-meta">
              <small className="bubble-time">{new Date().toLocaleString()}</small>
            </div>
            <button type="button" className="btn btn-ghost btn-sm gc-userphone-queue-cancel-btn" onClick={onCancel}>
              Cancel search
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// One chat bubble row: avatar (for incoming group messages), the bubble itself,
// a hover reaction picker, quoted-reply preview, and inline Reply/Unsend
// actions. On touch devices a long-press opens the picker and we cancel the
// default text-selection menu so it doesn't conflict with reacting.
function MessageBubble({
  message: m,
  showAuthor,
  minimal = false,
  swipeReplyEnabled = false,
  activeChat,
  isUserphone = false,
  onReact,
  onReply,
  onUnsend,
  onOpenReactors,
  onOpenUserProfile,
  onJoinServerInvite,
  liteMode = false
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closeTimer = useRef(null);
  const longPressTimer = useRef(null);
  const bubbleWrapRef = useRef(null);
  const bubbleTouchRef = useRef(null);
  const pickerOpenRef = useRef(false);
  const onReplyRef = useRef(onReply);
  const swipeStartXR = useRef(0);
  const swipeStartYR = useRef(0);
  const swipeTrackingRef = useRef(false);
  const swipeArmedRef = useRef(false);
  const swipeDxRef = useRef(0);
  const [swipeDx, setSwipeDx] = useState(0);
  const [swipeHintOpacity, setSwipeHintOpacity] = useState(0);
  const [swipeDragging, setSwipeDragging] = useState(false);
  const unsent = !!m.isUnsent;

  pickerOpenRef.current = pickerOpen;
  onReplyRef.current = onReply;

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  // Touch: tapping outside closes the reaction + action strip (still long-press to open).
  useEffect(() => {
    if (!pickerOpen || unsent || minimal) return;
    const mq = window.matchMedia("(hover: none)");
    if (!mq.matches) return;
    function tapOut(e) {
      if (!bubbleWrapRef.current?.contains(e.target)) setPickerOpen(false);
    }
    document.addEventListener("touchstart", tapOut, true);
    document.addEventListener("mousedown", tapOut, true);
    return () => {
      document.removeEventListener("touchstart", tapOut, true);
      document.removeEventListener("mousedown", tapOut, true);
    };
  }, [pickerOpen, unsent, minimal]);

  useEffect(() => {
    const el = bubbleTouchRef.current;
    if (!el || !swipeReplyEnabled || minimal || unsent) return;

    const TH = 56;
    const MAX = 76;

    function clampDx(rawDx) {
      if (m.fromMe) {
        if (rawDx >= 0) return 0;
        return Math.max(rawDx, -MAX);
      }
      if (rawDx <= 0) return 0;
      return Math.min(rawDx, MAX);
    }

    function apply(rawDx) {
      const c = clampDx(rawDx);
      swipeDxRef.current = c;
      setSwipeDx(c);
      setSwipeHintOpacity(c === 0 ? 0 : Math.min(0.92, Math.abs(c) / TH));
    }

    function move(ev) {
      if (!swipeTrackingRef.current || pickerOpenRef.current) return;
      if (ev.touches.length !== 1) return;
      const dx = ev.touches[0].clientX - swipeStartXR.current;
      const dy = ev.touches[0].clientY - swipeStartYR.current;

      if (!swipeArmedRef.current) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          swipeTrackingRef.current = false;
          apply(0);
          setSwipeHintOpacity(0);
          return;
        }
        swipeArmedRef.current = true;
        setSwipeDragging(true);
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current);
          longPressTimer.current = null;
        }
      }

      apply(dx);
      if (swipeArmedRef.current && Math.abs(dx) > 14) {
        ev.preventDefault();
      }
    }

    function endSwipeGesture() {
      if (!swipeTrackingRef.current) return;
      const dx = swipeDxRef.current;
      swipeTrackingRef.current = false;
      swipeArmedRef.current = false;
      setSwipeDragging(false);

      const fire = (m.fromMe && dx <= -TH) || (!m.fromMe && dx >= TH);

      swipeDxRef.current = 0;
      apply(0);

      if (fire) {
        setPickerOpen(false);
        onReplyRef.current?.(m);
      }
    }

    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", endSwipeGesture);
    el.addEventListener("touchcancel", endSwipeGesture);
    return () => {
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", endSwipeGesture);
      el.removeEventListener("touchcancel", endSwipeGesture);
    };
  }, [swipeReplyEnabled, minimal, unsent, m.fromMe, m.id]);

  const breakdown = m.reactionBreakdown || {};
  const topReactions = CHAT_REACTIONS
    .filter((r) => breakdown[r.type])
    .sort((a, b) => (breakdown[b.type] || 0) - (breakdown[a.type] || 0));
  const totalCount = Object.values(breakdown).reduce((a, b) => a + b, 0);

  function openPicker() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPickerOpen(true);
  }
  function deferClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPickerOpen(false), 240);
  }

  async function pick(type) {
    setPickerOpen(false);
    await onReact?.(m.id, type);
  }

  // Touch: long-press to open the reaction picker. preventDefault on the
  // native contextmenu so "Copy / Select" doesn't appear underneath.
  function handleTouchStart(e) {
    if (!unsent && !minimal && swipeReplyEnabled && !pickerOpen && e.touches?.length === 1) {
      swipeTrackingRef.current = true;
      swipeArmedRef.current = false;
      swipeStartXR.current = e.touches[0].clientX;
      swipeStartYR.current = e.touches[0].clientY;
      swipeDxRef.current = 0;
      setSwipeDx(0);
      setSwipeHintOpacity(0);
      setSwipeDragging(false);
    }
    if (unsent || minimal) return;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => setPickerOpen(true), 400);
  }
  function handleTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }
  function suppressContext(e) {
    if (!unsent && !minimal) e.preventDefault();
  }

  function senderProfilePeek() {
    if (m.fromMe || !onOpenUserProfile || !m.fromUserId || m.fromUserId === SIGLACAST_AI_USER_ID) return null;
    if (isUserphone) return null;

    let prefetch = { name: m.author, avatarUrl: m.authorAvatar, authorAvatar: m.authorAvatar };
    if (activeChat?.kind === "dm" && activeChat.user?.id === m.fromUserId) {
      prefetch = activeChat.user;
    } else if (activeChat?.kind === "group") {
      const mem = activeChat.group?.members?.find((x) => x.id === m.fromUserId);
      if (mem) prefetch = mem;
    }

    return { userId: m.fromUserId, prefetch };
  }

  const profilePeek = senderProfilePeek();
  const serverInvite = !unsent ? findServerInvite(m.text) : null;

  function renderIncomingAvatar() {
    const avatarInner = m.authorAvatar ? (
      <img className="msg-avatar sm" src={mediaUrl(m.authorAvatar)} alt="" />
    ) : (
      <div className="msg-avatar sm placeholder">{m.author?.charAt(0) || "?"}</div>
    );

    if (profilePeek) {
      return (
        <button
          type="button"
          className="avatar-profile-hit"
          title="View profile"
          aria-label={`View ${m.author || "profile"}`}
          onClick={(e) => {
            e.stopPropagation();
            onOpenUserProfile(profilePeek.userId, profilePeek.prefetch);
          }}
        >
          {avatarInner}
        </button>
      );
    }

    return avatarInner;
  }

  return (
    <div className={`bubble-row ${m.fromMe ? "row-me" : "row-them"} ${unsent ? "is-unsent" : ""}`}>
      {!m.fromMe ? renderIncomingAvatar() : null}

      <div
        className="bubble-stack"
        onMouseEnter={!unsent && !minimal ? openPicker : undefined}
        onMouseLeave={!unsent && !minimal ? deferClose : undefined}
      >
        {swipeReplyEnabled && !minimal && !unsent ? (
          <div
            className={`bubble-swipe-hint bubble-swipe-hint--${m.fromMe ? "me" : "them"}`}
            style={{ opacity: swipeHintOpacity }}
            aria-hidden
          >
            <span className="bubble-swipe-hint-icon">↩</span>
          </div>
        ) : null}
        <div
          className={`bubble-with-actions ${swipeDragging ? "is-swipe-dragging" : ""}`}
          ref={bubbleWrapRef}
          style={{ transform: `translateX(${swipeDx}px)` }}
        >
          <div
            ref={bubbleTouchRef}
            className={`bubble ${m.fromMe ? "bubble-me" : "bubble-them"} ${unsent ? "bubble-unsent" : ""}`}
            onContextMenu={suppressContext}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {showAuthor ? <p className="bubble-author">{m.author}</p> : null}

            {m.replyTo ? (
              <div className="bubble-reply-quote">
                <span className="bubble-reply-quote-author">{m.replyTo.author}</span>
                <span className="bubble-reply-quote-text">
                  {m.replyTo.isUnsent ? "(message unsent)" : (m.replyTo.text || "(message)")}
                </span>
              </div>
            ) : null}

            {unsent ? (
              <p className="bubble-unsent-text">🚫 This message was unsent</p>
            ) : (
              <>
                {m.attachment ? <MessageAttachment att={m.attachment} liteMode={liteMode} /> : null}
                {serverInvite ? (
                  <ServerInviteCard server={serverInvite} onJoin={() => onJoinServerInvite?.(serverInvite)} />
                ) : m.text ? (
                  <p><MentionText text={m.text} /></p>
                ) : null}
              </>
            )}
            <div className="bubble-meta-row">
              <small className="bubble-time">{new Date(m.createdAt).toLocaleString()}</small>
              {!minimal && !unsent && totalCount > 0 ? (
                <button
                  type="button"
                  className="bubble-reaction-chip bubble-reaction-chip-btn"
                  title={`See who reacted · ${totalCount}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenReactors?.(m.id);
                  }}
                >
                  {topReactions.slice(0, 3).map((r) => (
                    <span key={r.type}>{r.emoji}</span>
                  ))}
                  {totalCount > 1 ? <small>{totalCount}</small> : null}
                </button>
              ) : null}
            </div>
          </div>

          {!unsent && !minimal ? (
            <div className={`bubble-quick-actions ${m.fromMe ? "side-left" : "side-right"}`}>
              <button
                type="button"
                className="bubble-quick-btn"
                title="Reply"
                onClick={() => {
                  setPickerOpen(false);
                  onReply?.(m);
                }}
              >
                ↩
              </button>
              {m.fromMe ? (
                <button
                  type="button"
                  className="bubble-quick-btn"
                  title="Unsend"
                  onClick={() => {
                    setPickerOpen(false);
                    onUnsend?.(m);
                  }}
                >
                  <span className="ui-icon ui-icon-trash" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}

          {pickerOpen && !unsent && !minimal ? (
            <div
              className={`bubble-react-picker ${m.fromMe ? "side-left" : "side-right"}`}
              onMouseEnter={openPicker}
              onMouseLeave={deferClose}
            >
              {CHAT_REACTIONS.map((r, idx) => (
                <button
                  key={r.type}
                  type="button"
                  className={`reaction-emoji-btn ${m.myReaction === r.type ? "is-active" : ""}`}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  title={r.label}
                  onClick={() => pick(r.type)}
                >
                  <span className="reaction-emoji">{r.emoji}</span>
                  <span className="reaction-tooltip">{r.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- Server Workspace ----------------

function channelIcon(type) {
  return type === "voice" ? "◉" : "#";
}

function ServerInviteCard({ server, onJoin }) {
  if (!server) return null;
  const memberText = "Local server invite";
  return (
    <div className="server-invite-card">
      <div className="server-invite-card-banner" aria-hidden />
      <div className="server-invite-card-body">
        <span className="server-invite-card-icon">
          {server.iconUrl ? <img src={server.iconUrl} alt="" /> : <span>{server.name?.charAt(0) || "S"}</span>}
        </span>
        <div className="server-invite-card-copy">
          <strong>{server.name}</strong>
          <small>{memberText}</small>
        </div>
        {onJoin ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={onJoin}>
            Join Server
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ServerInviteModal({ server, friends = [], onSendInvite, onClose }) {
  const [copied, setCopied] = useState(false);
  const [sentIds, setSentIds] = useState(() => new Set());
  const [sendingId, setSendingId] = useState("");
  const link = serverInviteUrl(server);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch (_) {
      setCopied(false);
    }
  }

  async function sendToFriend(friend) {
    if (!friend?.id || !onSendInvite || sendingId) return;
    setSendingId(friend.id);
    const res = await onSendInvite(friend.id, link);
    setSendingId("");
    if (!res?.error) {
      setSentIds((prev) => new Set([...prev, friend.id]));
    }
  }

  if (!server) return null;
  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-invite-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3>Invite to {server.name}</h3>
              <p className="muted small">Paste this link in any chat and it will show a Join Server card.</p>
            </div>
            <button type="button" className="modal-close" onClick={onClose} title="Close">x</button>
          </div>
          <div className="modal-body">
            <ServerInviteCard server={server} />
            <div className="server-invite-copy-row">
              <input value={link} readOnly />
              <button type="button" className="btn btn-primary" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="server-invite-friend-list">
              <div className="server-invite-friend-head">
                <strong>Invite friends</strong>
                <small>{friends.length ? "Send this invite directly to their messages." : "Start a DM with friends first to invite them here."}</small>
              </div>
              {friends.map((friend) => {
                const sent = sentIds.has(friend.id);
                return (
                  <div key={friend.id} className="server-invite-friend-row">
                    {friend.avatarUrl ? (
                      <img src={mediaUrl(friend.avatarUrl)} alt="" />
                    ) : (
                      <span>{friend.name?.charAt(0) || "?"}</span>
                    )}
                    <strong>{friend.name || "Friend"}</strong>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={sent || sendingId === friend.id || !onSendInvite}
                      onClick={() => sendToFriend(friend)}
                    >
                      {sendingId === friend.id ? "Sending..." : sent ? "Sent" : "Invite"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function ServerJoinModal({ server, onClose, onJoin }) {
  if (!server) return null;
  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-invite-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3>Join server</h3>
              <p className="muted small">This invite will add the server to your Servers tab.</p>
            </div>
            <button type="button" className="modal-close" onClick={onClose} title="Close">x</button>
          </div>
          <div className="modal-body">
            <ServerInviteCard server={server} />
            <div className="server-invite-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={onJoin}>Join Server</button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function ServerWorkspace({
  servers,
  selectedServer,
  selectedChannel,
  onSelectServer,
  onSelectChannel,
  onCreateServer,
  onCreateChannel,
  onInviteServer,
  onOpenServerSettings,
  onOpenChannelMenu
}) {
  return (
    <div className="servers-workspace">
      <div className="server-rail" aria-label="Servers">
        {(servers || []).map((server) => (
          <button
            key={server.id}
            type="button"
            className={`server-rail-icon${selectedServer?.id === server.id ? " active" : ""}`}
            onClick={() => onSelectServer(server)}
            title={server.name}
          >
            {server.iconUrl ? <img src={server.iconUrl} alt="" /> : <span>{server.name.charAt(0)}</span>}
          </button>
        ))}
        <button type="button" className="server-rail-icon server-rail-add" onClick={onCreateServer} title="Create server">
          +
        </button>
      </div>

      <div className="server-channel-panel">
        {selectedServer ? (
          <>
            <div className="server-header">
              <strong>{selectedServer.name}</strong>
              <div className="server-header-actions">
                <button
                  type="button"
                  className="server-icon-action"
                  onClick={() => onInviteServer?.(selectedServer)}
                  title="Invite to server"
                  aria-label="Invite to server"
                >
                  <span className="ui-icon ui-icon-user-plus" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="server-icon-action"
                  onClick={() => onOpenServerSettings?.(selectedServer)}
                  title="Server settings"
                  aria-label="Server settings"
                >
                  <span className="ui-icon ui-icon-settings" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="server-section-list">
              {(selectedServer.sections || []).map((section) => (
            <div key={section.id} className="server-section">
              <div className="server-section-title">
                <span>{section.name}</span>
                <button
                  type="button"
                  className="server-channel-add"
                  onClick={() => onCreateChannel(section)}
                  title="Create channel"
                >
                  +
                </button>
              </div>
              {(section.channels || []).map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`server-channel-row${selectedChannel?.id === channel.id ? " active" : ""}`}
                  onClick={() => onSelectChannel(channel)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onOpenChannelMenu?.(channel, e.clientX, e.clientY);
                  }}
                >
                  <span className="server-channel-icon">{channelIcon(channel.type)}</span>
                  <span className="server-channel-name">{channel.name}</span>
                  <span className="server-channel-actions">•••</span>
                </button>
              ))}
            </div>
              ))}
            </div>
          </>
        ) : (
          <div className="server-empty-sidebar">
            <strong>No servers yet</strong>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCreateServer}>
              Create server
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServerMemberPanel({ members = [], onOpenUserProfile }) {
  const [selectedMember, setSelectedMember] = useState(null);
  const onlineCount = members.length;

  return (
    <aside className="server-member-panel">
      <div className="server-member-count">Online — {onlineCount}</div>
      <div className="server-member-list">
        {members.map((member) => {
          const presence = presenceDotAttrs(member);
          return (
            <button
              key={member.id}
              type="button"
              className={`server-member-row${selectedMember?.id === member.id ? " active" : ""}`}
              onClick={() => setSelectedMember(member)}
            >
              <span className="server-member-avatar">
                {member.avatarUrl ? <img src={mediaUrl(member.avatarUrl)} alt="" /> : <span>{member.name?.charAt(0) || "?"}</span>}
                <i className={presence.className} title={presence.title} />
              </span>
              <span className="server-member-copy">
                <strong>{member.name || "Member"}{member.isCurrentUser ? " •" : ""}</strong>
                <small>{member.statusNote || member.course || (member.isCurrentUser ? "You" : "purxu member")}</small>
              </span>
            </button>
          );
        })}
      </div>
      {selectedMember ? (
        <div className="server-member-card">
          <div className="server-member-card-cover" />
          <button
            type="button"
            className="server-member-card-avatar"
            onClick={() => selectedMember.id && !selectedMember.isCurrentUser && onOpenUserProfile?.(selectedMember.id, selectedMember)}
            title="View profile"
          >
            {selectedMember.avatarUrl ? <img src={mediaUrl(selectedMember.avatarUrl)} alt="" /> : <span>{selectedMember.name?.charAt(0) || "?"}</span>}
          </button>
          <div className="server-member-card-body">
            <strong>{selectedMember.name || "Member"}</strong>
            <small>{selectedMember.isCurrentUser ? "You" : "purxu profile"}</small>
            <p>{selectedMember.statusNote || selectedMember.bio || "No status yet."}</p>
            <div className="server-member-card-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => selectedMember.id && !selectedMember.isCurrentUser && onOpenUserProfile?.(selectedMember.id, selectedMember)}>
                View profile
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedMember(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ServerChannelPreview({ server, channel, messages = [], draft = "", onDraft, onSend, onCreateServer, onJoinServerInvite, members = [], onOpenUserProfile }) {
  if (!server) {
    return (
      <div className="server-thread-preview server-thread-preview-empty">
        <div className="server-thread-empty">
          <h3>Create your first server</h3>
          <p className="muted small">Tap the plus button to make a server with text and voice channels.</p>
          <button type="button" className="btn btn-primary" onClick={onCreateServer}>
            Create server
          </button>
        </div>
      </div>
    );
  }

  if (messages.length) {
    return (
      <div className="server-thread-layout">
      <div className="server-thread-preview">
        <div className="server-thread-head">
          <span className="server-thread-channel-icon">{channelIcon(channel?.type)}</span>
          <div>
            <strong>{channel?.name || "general"}</strong>
            <small>{server.name}</small>
          </div>
        </div>
        <div className="server-thread-messages">
          {messages.map((message) => {
            const invite = findServerInvite(message.text);
            return (
              <div key={message.id} className="server-message-row">
                {message.avatarUrl ? <img src={mediaUrl(message.avatarUrl)} alt="" /> : <span>{message.author?.charAt(0) || "?"}</span>}
                <div>
                  <div className="server-message-meta">
                    <strong>{message.author}</strong>
                    <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
                  </div>
                  {invite ? (
                    <ServerInviteCard server={invite} onJoin={() => onJoinServerInvite?.(invite)} />
                  ) : (
                    <p>{message.text}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {channel?.type === "text" ? (
          <form className="server-thread-compose" onSubmit={onSend}>
            <input value={draft} onChange={(e) => onDraft?.(e.target.value)} placeholder={`Message #${channel?.name || "general"}`} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        ) : (
          <div className="server-voice-placeholder">Voice channel layout is ready. Voice calling can be connected later.</div>
        )}
      </div>
      <ServerMemberPanel members={members} onOpenUserProfile={onOpenUserProfile} />
      </div>
    );
  }

  return (
    <div className="server-thread-layout">
    <div className="server-thread-preview">
      <div className="server-thread-head">
        <span className="server-thread-channel-icon">{channelIcon(channel?.type)}</span>
        <div>
          <strong>{channel?.name || "general"}</strong>
          <small>{server?.name || "Server"}</small>
        </div>
      </div>
      <div className="server-thread-empty">
        <div className="server-thread-orb">
          {server?.iconUrl ? <img src={server.iconUrl} alt="" /> : <span>{server?.name?.charAt(0) || "S"}</span>}
        </div>
        <h3>Welcome to #{channel?.name || "general"}</h3>
        <p className="muted small">
          Send the first message in this channel.
        </p>
        <button type="button" className="server-thread-first-message">
          Send your first message
          <span>›</span>
        </button>
      </div>
      {channel?.type === "text" ? (
        <form className="server-thread-compose" onSubmit={onSend}>
          <input value={draft} onChange={(e) => onDraft?.(e.target.value)} placeholder={`Message #${channel?.name || "general"}`} />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
            Send
          </button>
        </form>
      ) : (
        <div className="server-voice-placeholder">Voice channel layout is ready. Voice calling can be connected later.</div>
      )}
    </div>
    <ServerMemberPanel members={members} onOpenUserProfile={onOpenUserProfile} />
    </div>
  );
}

function CreateServerModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState(DEFAULT_SERVER_ICON);
  const [err, setErr] = useState("");

  function handleIconPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Choose an image for the server icon.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIconUrl(typeof reader.result === "string" ? reader.result : DEFAULT_SERVER_ICON);
    reader.readAsDataURL(file);
  }

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Server name is required.");
      return;
    }
    onCreate({ name, iconUrl });
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-create-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>Customize Your Server</h3>
            <button type="button" className="modal-close" onClick={onClose} title="Close">x</button>
          </div>
          <form className="modal-body" onSubmit={submit}>
            <p className="server-create-copy">
              Give your new server a personality with a name and an icon. You can always change it later.
            </p>
            <label className="server-icon-upload">
              <img src={iconUrl} alt="" />
              <span>Upload</span>
              <input type="file" accept="image/*" className="sr-only" onChange={handleIconPick} />
            </label>

            <label className="field-label">Server Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="yuze" autoFocus />
            <p className="muted small">By creating a server, you agree to purxu community guidelines.</p>
            {err ? <p className="form-error">{err}</p> : null}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Back</button>
              <button type="submit" className="btn btn-primary">Create</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function ServerSettingsModal({ server, onClose, onSave }) {
  const [name, setName] = useState(server?.name || "");
  const [iconUrl, setIconUrl] = useState(server?.iconUrl || DEFAULT_SERVER_ICON);
  const [err, setErr] = useState("");

  function handleIconPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("Choose an image for the server icon.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIconUrl(typeof reader.result === "string" ? reader.result : DEFAULT_SERVER_ICON);
    reader.readAsDataURL(file);
  }

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Server name is required.");
      return;
    }
    onSave({ name, iconUrl });
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-create-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>Server Settings</h3>
            <button type="button" className="modal-close" onClick={onClose} title="Close">x</button>
          </div>
          <form className="modal-body" onSubmit={submit}>
            <p className="server-create-copy">Edit this server profile and name.</p>
            <label className="server-icon-upload">
              <img src={iconUrl} alt="" />
              <span>Change</span>
              <input type="file" accept="image/*" className="sr-only" onChange={handleIconPick} />
            </label>
            <label className="field-label">Server Name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            {err ? <p className="form-error">{err}</p> : null}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function CreateServerChannelModal({ sectionName, onClose, onCreate }) {
  const [channelType, setChannelType] = useState("text");
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [err, setErr] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Channel name is required.");
      return;
    }
    onCreate({ channelType, name, isPrivate });
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-channel-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <h3>Create Channel</h3>
              <p className="muted small">in {sectionName}</p>
            </div>
            <button type="button" className="modal-close" onClick={onClose}>x</button>
          </div>
          <form className="modal-body" onSubmit={submit}>
            <label className="field-label">Channel Type</label>
            <div className="server-channel-type-list">
              {[
                ["text", "# Text", "Send messages, images, GIFs, emoji, opinions, and puns"],
                ["voice", "◉ Voice", "Create a voice channel for future calls"]
              ].map(([id, title, copy]) => (
                <label key={id} className="server-channel-type-row">
                  <input
                    type="radio"
                    name="channel-type"
                    checked={channelType === id}
                    onChange={() => setChannelType(id)}
                  />
                  <span>
                    <strong>{title}</strong>
                    <small>{copy}</small>
                  </span>
                </label>
              ))}
            </div>

            <label className="field-label">Channel Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new-channel" />

            <label className="server-private-row">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              <span>
                <strong>Private Channel</strong>
                <small>Only selected members and roles will be able to view this channel.</small>
              </span>
            </label>
            {err ? <p className="form-error">{err}</p> : null}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Create Channel</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

function ServerChannelSettingsModal({ channel, onClose, onSave, onDelete }) {
  const [name, setName] = useState(channel?.name || "");

  function submit(e) {
    e.preventDefault();
    const clean = name.trim().replace(/\s+/g, "-").toLowerCase();
    if (!clean) return;
    onSave({ name: clean });
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card server-channel-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>Channel settings</h3>
            <button type="button" className="modal-close" onClick={onClose}>x</button>
          </div>
          <form className="modal-body" onSubmit={submit}>
            <label className="field-label">Channel name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="modal-footer">
              <button type="button" className="btn btn-danger" onClick={onDelete}>Delete</button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}

// ---------------- Create Group Modal ----------------

function CreateGroupModal({ currentUser, onClose, onCreate }) {
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const photoRef = useRef(null);

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${API_ORIGIN}/api/users/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("siglacast_token") || ""}` } }
      );
      const list = await res.json();
      setResults(Array.isArray(list) ? list : []);
    } finally {
      setSearching(false);
    }
  }

  function togglePick(u) {
    setPicked((prev) =>
      prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]
    );
  }

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!name.trim()) return setErr("Group name is required");
    if (picked.length < 1) return setErr("Add at least one member");
    setCreating(true);
    try {
      await onCreate({
        name: name.trim(),
        memberIds: picked.map((p) => p.id),
        photoFile: photo
      });
    } catch (e) {
      setErr(e?.message || "Could not create group");
    } finally {
      setCreating(false);
    }
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>👥 Create a groupchat</h3>
          <button type="button" className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <label className="field-label">Group name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Best group ever" autoFocus />

          <label className="field-label">Photo (optional)</label>
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          />
          {photo ? <small className="file-picked">Selected: {photo.name}</small> : null}

          <label className="field-label">Add members</label>
          <div className="modal-search-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
              placeholder="Search by name or email…"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={runSearch} disabled={searching}>
              {searching ? "…" : "🔍"}
            </button>
          </div>

          {picked.length > 0 ? (
            <div className="picked-chips">
              {picked.map((u) => (
                <span key={u.id} className="chip">
                  {u.name}
                  <button type="button" onClick={() => togglePick(u)}>✕</button>
                </span>
              ))}
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="search-results small">
              {results
                .filter((r) => r.id !== currentUser?.id)
                .map((u) => {
                  const isPicked = picked.some((p) => p.id === u.id);
                  return (
                    <div key={u.id} className="search-result-row">
                      <div className="search-result-info">
                        <strong>{u.name}</strong>
                      </div>
                      <button
                        type="button"
                        className={`btn btn-sm ${isPicked ? "btn-secondary" : "btn-primary"}`}
                        onClick={() => togglePick(u)}
                      >
                        {isPicked ? "Remove" : "Add"}
                      </button>
                    </div>
                  );
                })}
            </div>
          ) : null}

          {err ? <p className="form-error">{err}</p> : null}

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? "Creating…" : "Create group"}
            </button>
          </div>
        </form>
      </div>
      </div>
    </ModalPortal>
  );
}

// ---------------- Group Settings Modal ----------------

function GroupSettingsModal({
  currentUser,
  group,
  onClose,
  onSave,
  onAddMembers,
  onRemoveMember,
  onChangeRole,
  onLeaveGroup,
  onDeleteGroup,
  onOpenUserProfile
}) {
  const [name, setName] = useState(group?.name || "");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // Add members section
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const iAmAdmin = useMemo(
    () => Boolean(group?.members?.find((m) => m.id === currentUser?.id && m.role === "admin")),
    [group, currentUser]
  );

  useEffect(() => {
    setName(group?.name || "");
  }, [group?.id, group?.name]);

  async function submitSave(e) {
    e.preventDefault();
    setErr("");
    const renamed = name.trim() && name.trim() !== group.name ? name.trim() : undefined;
    if (!renamed && !photo) return setErr("Change the name or pick a new photo");
    setSaving(true);
    try {
      await onSave({ name: renamed, photoFile: photo });
      setPhoto(null);
    } catch (e) {
      setErr(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `${API_ORIGIN}/api/users/search?q=${encodeURIComponent(q)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem("siglacast_token") || ""}` } }
      );
      const list = await res.json();
      const existingIds = new Set((group?.members || []).map((m) => m.id));
      setResults((Array.isArray(list) ? list : []).filter((u) => !existingIds.has(u.id)));
    } finally {
      setSearching(false);
    }
  }

  function togglePick(u) {
    setPicked((prev) =>
      prev.some((p) => p.id === u.id) ? prev.filter((p) => p.id !== u.id) : [...prev, u]
    );
  }

  async function submitAdd() {
    if (!picked.length) return;
    setAdding(true);
    try {
      await onAddMembers(picked.map((p) => p.id));
      setPicked([]);
      setQuery("");
      setResults([]);
      setShowAdd(false);
    } finally {
      setAdding(false);
    }
  }

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙️ Group settings</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <form onSubmit={submitSave} className="group-settings-form">
            <div className="group-photo-preview">
              {group?.photoUrl ? (
                <img src={mediaUrl(group.photoUrl)} alt="" />
              ) : (
                <div className="group-photo-placeholder">{group?.name?.charAt(0) || "?"}</div>
              )}
            </div>

            <label className="field-label">Group name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              disabled={!iAmAdmin}
            />

            {iAmAdmin ? (
              <>
                <label className="field-label">Change group photo</label>
                <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
                {photo ? <small className="file-picked">Selected: {photo.name}</small> : null}
                {err ? <p className="form-error">{err}</p> : null}
                <div className="form-inline-actions">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted small">Only group admins can rename or change the photo.</p>
            )}
          </form>

          <hr className="modal-sep" />

          <div className="settings-section-head">
            <h4>👥 Members ({group?.members?.length || 0})</h4>
            {iAmAdmin ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAdd((v) => !v)}
              >
                {showAdd ? "Close" : "➕ Add another person"}
              </button>
            ) : null}
          </div>

          {showAdd ? (
            <div className="add-members-panel">
              <div className="modal-search-row">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())}
                  placeholder="Search by name or email…"
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={runSearch} disabled={searching}>
                  {searching ? "…" : "🔍"}
                </button>
              </div>

              {picked.length > 0 ? (
                <div className="picked-chips">
                  {picked.map((u) => (
                    <span key={u.id} className="chip">
                      {u.name}
                      <button type="button" onClick={() => togglePick(u)}>✕</button>
                    </span>
                  ))}
                </div>
              ) : null}

              {results.length > 0 ? (
                <div className="search-results small">
                  {results.map((u) => {
                    const isPicked = picked.some((p) => p.id === u.id);
                    return (
                      <div key={u.id} className="search-result-row">
                        <div className="search-result-info">
                          <strong>{u.name}</strong>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${isPicked ? "btn-secondary" : "btn-primary"}`}
                          onClick={() => togglePick(u)}
                        >
                          {isPicked ? "Remove" : "Add"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="form-inline-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!picked.length || adding}
                  onClick={submitAdd}
                >
                  {adding ? "Adding…" : `Add ${picked.length || ""} to group`}
                </button>
              </div>
            </div>
          ) : null}

          <ul className="member-list">
            {(group?.members || []).map((m) => {
              const isMe = m.id === currentUser?.id;
              const isMemberAdmin = m.role === "admin";
              const memPres = presenceDotAttrs(m);
              return (
                <li key={m.id} className="member-row">
                  {onOpenUserProfile && m.id !== SIGLACAST_AI_USER_ID ? (
                    <button
                      type="button"
                      className="avatar-profile-hit"
                      aria-label={`View ${m.name} profile`}
                      title="View profile"
                      onClick={() => onOpenUserProfile(m.id, m)}
                    >
                      <span className="avatar-with-presence">
                        {m.avatarUrl ? (
                          <img className="msg-avatar sm" src={mediaUrl(m.avatarUrl)} alt="" />
                        ) : (
                          <div className="msg-avatar sm placeholder">{m.name?.charAt(0) || "?"}</div>
                        )}
                        <span className={memPres.className} title={memPres.title} aria-hidden />
                      </span>
                    </button>
                  ) : (
                    <span className="avatar-with-presence">
                      {m.avatarUrl ? (
                        <img className="msg-avatar sm" src={mediaUrl(m.avatarUrl)} alt="" />
                      ) : (
                        <div className="msg-avatar sm placeholder">{m.name?.charAt(0) || "?"}</div>
                      )}
                      <span className={memPres.className} title={memPres.title} aria-hidden />
                    </span>
                  )}
                  <div className="member-info">
                    <strong>
                      {m.name} {isMe ? <span className="muted small">(you)</span> : null}
                    </strong>
                    <small>
                      <span className={`pill ${isMemberAdmin ? "pill-admin" : "pill-muted"} small`}>
                        {m.role}
                      </span>
                    </small>
                  </div>

                  {iAmAdmin && !isMe ? (
                    <div className="member-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onChangeRole(m.id, isMemberAdmin ? "member" : "admin")}
                        title={isMemberAdmin ? "Remove admin role" : "Promote to admin"}
                      >
                        {isMemberAdmin ? "⬇️ Demote" : "⬆️ Make admin"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={async () => {
                          if (window.confirm(`Remove ${m.name} from the group?`)) {
                            await onRemoveMember(m.id);
                          }
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <hr className="modal-sep" />

          <div className="settings-danger-zone">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                if (window.confirm("Leave this group chat?")) {
                  await onLeaveGroup();
                }
              }}
            >
              🚪 Leave the conversation
            </button>
            {iAmAdmin ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  if (window.confirm("Delete this group chat for everyone? This cannot be undone.")) {
                    await onDeleteGroup();
                  }
                }}
              >
                🗑️ Delete group chat
              </button>
            ) : null}
          </div>
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ---------------- Attachments Modal ----------------

function AttachmentsModal({ loader, onClose, liteMode = false }) {
  const { openLightbox } = useImageLightbox();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("images");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await loader?.();
        if (!cancelled) setList(Array.isArray(data) ? data : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loader]);

  const images = useMemo(
    () => list.filter((m) => m.attachment?.isImage),
    [list]
  );
  const files = useMemo(
    () => list.filter((m) => m.attachment && !m.attachment.isImage),
    [list]
  );

  return (
    <ModalPortal>
      <div className="modal-backdrop modal-backdrop--portal" role="presentation" onClick={onClose}>
        <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🖼️ Files & Images</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button
            type="button"
            className={`tab ${tab === "images" ? "active" : ""}`}
            onClick={() => setTab("images")}
          >
            Images ({images.length})
          </button>
          <button
            type="button"
            className={`tab ${tab === "files" ? "active" : ""}`}
            onClick={() => setTab("files")}
          >
            Files ({files.length})
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p>Loading…</p>
          ) : tab === "images" && liteMode ? (
            <p className="muted">Images are hidden in Lite mode.</p>
          ) : tab === "images" ? (
            images.length === 0 ? (
              <p className="muted">No images shared yet.</p>
            ) : (
              <div className="image-gallery">
                {images.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="image-gallery-thumb"
                    title={`${m.author || ""} · ${new Date(m.createdAt).toLocaleString()}`}
                    onClick={() => openLightbox(mediaUrl(m.attachment.url))}
                  >
                    <img src={mediaUrl(m.attachment.url)} alt={m.attachment.name || ""} />
                  </button>
                ))}
              </div>
            )
          ) : files.length === 0 ? (
            <p className="muted">No files shared yet.</p>
          ) : (
            <ul className="file-list">
              {files.map((m) => (
                <li key={m.id} className="file-row">
                  <a href={m.attachment.url} target="_blank" rel="noreferrer" download>
                    📁 {m.attachment.name || "file"}
                  </a>
                  <small>
                    {m.author || ""} · {formatBytes(m.attachment.size)} · {new Date(m.createdAt).toLocaleString()}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      </div>
    </ModalPortal>
  );
}
