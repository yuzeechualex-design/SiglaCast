import "dotenv/config";

import express from "express";
import cors from "cors";
import amqp from "amqplib";
import { Kafka } from "kafkajs";
import { create } from "xmlbuilder2";
import { XMLParser } from "fast-xml-parser";
import xsltProcessor from "xslt-processor";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";

import { supabase, toPublicUser, toEvent, toCandidate, uploadToBucket, uploadAttachment } from "./supabase.js";
import { validateRegisterForm } from "./registerValidation.js";
import {
  mintSpotifyOAuthState,
  consumeSpotifyOAuthState,
  buildSpotifyAuthorizeUrl,
  exchangeSpotifyCode,
  refreshSpotifyAccessToken,
  fetchCurrentlyPlaying,
  searchSpotifyTracks,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_FRONTEND_AFTER_LINK
} from "./spotifyMusic.js";

const { xsltProcess, xmlParse } = xsltProcessor;

const JWT_SECRET = process.env.JWT_SECRET || "siglacast-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "24h";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "siglacast-dev-refresh-secret";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "365d";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
const MOBILE_APP_ORIGINS = ["capacitor://localhost", "http://localhost", "https://localhost"];

/** Sigla Assistant (Groq) — key must be supplied via environment only, never committed. */
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Sentinel user id for mirrored anonymous lines in group Userphone bridges (migration 0008). */
const USERPHONE_GUEST_ID = "_userphone_guest";
/** Bot user row for SiglaCast AI replies in group/DM threads (migration 0009). */
const SIGLACAST_AI_USER_ID = "_siglacast_ai";

const imageMime = /^image\/(jpeg|png|gif|webp)$/i;
// 25 MB cap — large enough for original-resolution camera shots without re-compression.
// Files are stored as-is on Supabase Storage (uploadToBucket passes the raw buffer).
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (imageMime.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed"));
  }
});

// Generic chat attachment uploader — accepts any file type up to 25 MB so users
// can share PDFs, docs, audio, etc. in addition to images.
const uploadAnyFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

// OOP: Encapsulation + Inheritance
class User {
  #id;
  #name;
  #email;
  constructor(id, name, email) {
    this.#id = id;
    this.#name = name;
    this.#email = email;
  }
  get id() { return this.#id; }
  get name() { return this.#name; }
  get email() { return this.#email; }
}
class Student extends User {
  #course;
  constructor(id, name, email, course) {
    super(id, name, email);
    this.#course = course;
  }
  get course() { return this.#course; }
  canVote(event) { return event.status === "open"; }
}
class Admin extends User {
  #permissions;
  constructor(id, name, email, permissions = []) {
    super(id, name, email);
    this.#permissions = permissions;
  }
  canManage(feature) {
    return this.#permissions.includes("all") || this.#permissions.includes(feature);
  }
}

// OOP: Polymorphism
class VoteStrategy { tally() { throw new Error("Implement tally()"); } }
class SingleVoteStrategy extends VoteStrategy {
  tally(votes) {
    return votes.reduce((acc, v) => {
      acc[v.candidate_id] = (acc[v.candidate_id] || 0) + 1;
      return acc;
    }, {});
  }
}
class WeightedVoteStrategy extends VoteStrategy {
  tally(votes) {
    return votes.reduce((acc, v) => {
      acc[v.candidate_id] = (acc[v.candidate_id] || 0) + Number(v.weight || 1);
      return acc;
    }, {});
  }
}

// Messaging broker
class MessageBroker {
  async connect() {}
  async publish() {}
  async consume() {}
}
class RabbitBroker extends MessageBroker {
  constructor(url) { super(); this.url = url; }
  async connect() {
    this.conn = await amqp.connect(this.url);
    this.channel = await this.conn.createChannel();
  }
  async publish(topic, payload) {
    await this.channel.assertQueue(topic, { durable: true });
    this.channel.sendToQueue(topic, Buffer.from(JSON.stringify(payload)));
  }
  async consume(topic, handler) {
    await this.channel.assertQueue(topic, { durable: true });
    this.channel.consume(topic, (msg) => {
      if (!msg) return;
      handler(JSON.parse(msg.content.toString()));
      this.channel.ack(msg);
    });
  }
}
class KafkaBroker extends MessageBroker {
  constructor(brokers) {
    super();
    this.kafka = new Kafka({ clientId: "siglacast", brokers });
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ groupId: "siglacast-group" });
  }
  async connect() { await this.producer.connect(); await this.consumer.connect(); }
  async publish(topic, payload) {
    await this.producer.send({ topic, messages: [{ value: JSON.stringify(payload) }] });
  }
  async consume(topic, handler) {
    await this.consumer.subscribe({ topic, fromBeginning: true });
    await this.consumer.run({
      eachMessage: async ({ message }) => handler(JSON.parse(message.value.toString()))
    });
  }
}
class InMemoryBroker extends MessageBroker {
  constructor() { super(); this.handlers = new Map(); }
  async connect() {}
  async publish(topic, payload) { (this.handlers.get(topic) || []).forEach((h) => h(payload)); }
  async consume(topic, handler) {
    const list = this.handlers.get(topic) || [];
    list.push(handler);
    this.handlers.set(topic, list);
  }
}

async function makeBroker() {
  try {
    if ((process.env.BROKER || "").toLowerCase() === "rabbitmq") {
      const b = new RabbitBroker(process.env.RABBITMQ_URL);
      await b.connect();
      return b;
    }
    if ((process.env.BROKER || "").toLowerCase() === "kafka") {
      const b = new KafkaBroker((process.env.KAFKA_BROKERS || "localhost:9092").split(","));
      await b.connect();
      return b;
    }
  } catch (e) {
    console.warn("Broker init failed, fallback to memory:", e.message);
  }
  const memory = new InMemoryBroker();
  await memory.connect();
  return memory;
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, type: "access" }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: "refresh" }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

// Data helpers
async function fetchUserById(id) {
  const { data } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
  return data;
}
async function fetchUserByEmail(email) {
  const { data } = await supabase.from("users").select("*").ilike("email", email).maybeSingle();
  return data;
}

/** Explicit `users` projections for routes that cannot use select("*") (secrets). Omit columns at runtime when DB migrations lag. */
const USER_SEARCH_SELECT_DEFAULT =
  "id, name, email, role, course, avatar_url, cover_url, bio, availability, status_emoji, status_note, music_share_now_playing, music_now_playing";

const USER_ADMIN_LIST_SELECT_DEFAULT =
  "id, role, name, email, course, avatar_url, cover_url, bio, availability, created_at";

function parseMissingUsersColumn(errorMessage = "") {
  const msg = String(errorMessage);
  let m = msg.match(/column (?:users\.)"?(\w+)"? does not exist/i);
  if (m) return m[1];
  m = msg.match(/Could not find the '([^']+)' column of 'users'/i);
  return m?.[1] || null;
}

function omitUsersSelectColumn(csv, rawName) {
  if (!rawName) return csv;
  const needle = rawName.toLowerCase();
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((col) => {
      const bare = col.split(".").pop().toLowerCase();
      return bare !== needle;
    })
    .join(", ");
}

/**
 * Re-run `users` selects when Postgres/Supabase rejects unknown columns (migrations not applied on host DB).
 */
async function usersSelectOmitMissingColumns(run, initialCols, maxPasses = 12) {
  let cols = initialCols;
  for (let i = 0; i < maxPasses; i++) {
    const out = await run(cols);
    const errMsg = Array.isArray(out)
      ? out.map((row) => row?.error?.message).find(Boolean)
      : out?.error?.message;
    if (!errMsg) return out;
    const missing = parseMissingUsersColumn(errMsg);
    const nextCols = omitUsersSelectColumn(cols, missing);
    if (!missing || nextCols === cols || !nextCols) return out;
    cols = nextCols;
  }
  return run(cols);
}

async function fetchEventWithCandidates(eventId) {
  const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
  if (!event) return null;
  const { data: candidates } = await supabase
    .from("candidates")
    .select("*")
    .eq("event_id", eventId)
    .order("position", { ascending: true });
  return toEvent(event, candidates || []);
}
async function fetchAllEvents() {
  const { data: events } = await supabase.from("events").select("*").order("created_at", { ascending: false });
  if (!events?.length) return [];
  const ids = events.map((e) => e.id);
  const { data: candidates } = await supabase
    .from("candidates")
    .select("*")
    .in("event_id", ids)
    .order("position", { ascending: true });
  const byEvent = new Map();
  for (const c of candidates || []) {
    if (!byEvent.has(c.event_id)) byEvent.set(c.event_id, []);
    byEvent.get(c.event_id).push(c);
  }
  return events.map((e) => toEvent(e, byEvent.get(e.id) || []));
}
async function tallyEvent(event) {
  const { data: votes } = await supabase.from("votes").select("candidate_id, weight").eq("event_id", event.id);
  const strategy = event.strategy === "weighted" ? new WeightedVoteStrategy() : new SingleVoteStrategy();
  return strategy.tally(votes || []);
}
async function serializeEventDetail(event, viewerId) {
  const tally = await tallyEvent(event);
  const candidates = event.candidates.map((c) => ({ ...c, votes: Number(tally[c.id] || 0) }));
  const { data: myVoteRows } = await supabase
    .from("votes")
    .select("candidate_id")
    .eq("event_id", event.id)
    .eq("user_id", viewerId);
  const myVotes = (myVoteRows || []).map((v) => v.candidate_id);
  const totalVotes = candidates.reduce((s, c) => s + c.votes, 0);
  return {
    ...event,
    candidates,
    myVotes,
    myVoteCount: myVotes.length,
    totalVotes,
    voteLimitLabel:
      event.maxVotesPerUser === 0
        ? "Unlimited votes per person"
        : `${event.maxVotesPerUser} vote${event.maxVotesPerUser === 1 ? "" : "s"} per person`
  };
}
const ALLOWED_REACTIONS = ["like", "love", "haha", "wow", "sad", "cry", "angry"];

async function serializeSharedPost(post) {
  if (!post) return null;
  const { data: author } = await supabase
    .from("users")
    .select("id, name, avatar_url")
    .eq("id", post.author_id)
    .maybeSingle();
  return {
    id: post.id,
    authorId: post.author_id,
    author: author?.name || "Unknown",
    authorAvatar: author?.avatar_url || null,
    content: post.content || "",
    imageUrl: post.image_url || null,
    createdAt: post.created_at
  };
}

async function serializePost(post, viewerId) {
  const [{ data: reactions }, { data: comments }, { data: author }, { data: sharedPost }] = await Promise.all([
    supabase.from("post_reactions").select("user_id, reaction").eq("post_id", post.id),
    supabase.from("post_comments").select("*").eq("post_id", post.id).order("created_at", { ascending: true }),
    supabase.from("users").select("id, name, avatar_url").eq("id", post.author_id).maybeSingle(),
    post.shared_post_id
      ? supabase.from("posts").select("*").eq("id", post.shared_post_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const reactionBreakdown = {};
  for (const r of reactions || []) {
    const type = ALLOWED_REACTIONS.includes(r.reaction) ? r.reaction : "like";
    reactionBreakdown[type] = (reactionBreakdown[type] || 0) + 1;
  }
  const myReactionRow = (reactions || []).find((r) => viewerId && r.user_id === viewerId);
  const myReaction =
    myReactionRow && ALLOWED_REACTIONS.includes(myReactionRow.reaction)
      ? myReactionRow.reaction
      : myReactionRow
      ? "like"
      : null;

  let commentAuthors = new Map();
  let reactionsByCommentId = new Map();
  if (comments?.length) {
    const commentIds = comments.map((c) => c.id);
    const authorIds = [...new Set(comments.map((c) => c.author_id))];
    const [{ data: users }, { data: cra }] = await Promise.all([
      supabase.from("users").select("id, name, avatar_url").in("id", authorIds),
      supabase.from("comment_reactions").select("comment_id, user_id, reaction").in("comment_id", commentIds)
    ]);
    commentAuthors = new Map((users || []).map((u) => [u.id, u]));
    for (const r of cra || []) {
      if (!reactionsByCommentId.has(r.comment_id)) {
        reactionsByCommentId.set(r.comment_id, {
          breakdown: {},
          mine: null,
          count: 0
        });
      }
      const entry = reactionsByCommentId.get(r.comment_id);
      const type = ALLOWED_REACTIONS.includes(r.reaction) ? r.reaction : "like";
      entry.breakdown[type] = (entry.breakdown[type] || 0) + 1;
      entry.count += 1;
      if (viewerId && r.user_id === viewerId) entry.mine = type;
    }
  }

  // Build a 2-level comment tree: top-level comments each get a `replies` array.
  // Replies of replies are flattened under their nearest top-level parent so the
  // UI stays readable (Facebook style).
  const flat = (comments || []).map((c) => {
    const a = commentAuthors.get(c.author_id);
    const rxInfo = reactionsByCommentId.get(c.id) || { breakdown: {}, mine: null, count: 0 };
    return {
      id: c.id,
      parentId: c.parent_id || null,
      userId: c.author_id,
      author: a?.name || "Unknown",
      authorAvatar: a?.avatar_url || null,
      text: c.content,
      imageUrl: c.image_url || null,
      createdAt: c.created_at,
      reactionCount: rxInfo.count,
      myReaction: rxInfo.mine,
      reactionBreakdown: rxInfo.breakdown,
      reactedByMe: Boolean(rxInfo.mine)
    };
  });
  const byId = new Map(flat.map((c) => [c.id, c]));
  // Resolve each comment's top-level ancestor id (for flattening deep nesting)
  function topLevelId(c) {
    let cur = c;
    while (cur.parentId && byId.has(cur.parentId)) cur = byId.get(cur.parentId);
    return cur.id;
  }
  const tree = [];
  const rootById = new Map();
  for (const c of flat) {
    if (!c.parentId) {
      const node = { ...c, replies: [] };
      tree.push(node);
      rootById.set(c.id, node);
    }
  }
  for (const c of flat) {
    if (!c.parentId) continue;
    const rootId = topLevelId(c);
    const root = rootById.get(rootId);
    if (!root) continue;
    const replyTo = byId.get(c.parentId);
    root.replies.push({
      ...c,
      // Preserve who this reply is addressed to, so UI can show "@Name" prefix.
      replyToAuthor: replyTo?.author || null,
      replyToId: c.parentId
    });
  }

  return {
    id: post.id,
    authorId: post.author_id,
    author: author?.name || "Unknown",
    authorAvatar: author?.avatar_url || null,
    content: post.content || "",
    imageUrl: post.image_url || null,
    sharedPostId: post.shared_post_id || null,
    sharedPost: await serializeSharedPost(sharedPost),
    reactionCount: (reactions || []).length,
    reactedByMe: Boolean(myReaction),
    myReaction,
    reactionBreakdown,
    comments: tree,
    commentCount: flat.length
  };
}
// ---------- Mentions ----------
// Mentions use the canonical bracket form `@[Full Name]` (inserted by the
// frontend autocomplete). On submit we extract every match, look up users by
// exact (case-insensitive) name, drop the author, and return user ids.
async function extractMentionIds(text, excludeUserId = null) {
  if (!text || typeof text !== "string") return [];
  const names = new Set();
  const re = /@\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name) names.add(name.toLowerCase());
  }
  if (!names.size) return [];
  const { data } = await supabase.from("users").select("id, name");
  const matched = (data || []).filter((u) => names.has((u.name || "").toLowerCase()));
  return [...new Set(matched.map((u) => u.id).filter((id) => id !== excludeUserId))];
}

async function notifyMentions(text, label, excludeUserId, linkPath = null) {
  const ids = await extractMentionIds(text, excludeUserId);
  if (!ids.length) return;
  const notes = ids.map((uid) => ({
    id: `n${Date.now()}-${uid}-${Math.random().toString(36).slice(2, 6)}`,
    user_id: uid,
    text: `You were mentioned in ${label}`,
    kind: "mention",
    badge_count: 1,
    source_key: null,
    link_path: linkPath,
    read: false
  }));
  await supabase.from("notifications").insert(notes);
}

// Bump a single unread aggregated row keyed by source_key (same sender etc.)
async function bumpAggregatedNotification({ userId, sourceKey, kind, textForCount, linkPath = null }) {
  const sk = sourceKey.slice(0, 500);
  const { data: row } = await supabase
    .from("notifications")
    .select("id, badge_count")
    .eq("user_id", userId)
    .eq("source_key", sk)
    .eq("read", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const next = (row?.badge_count ?? 0) + 1;
  const text = typeof textForCount === "function" ? textForCount(next) : `${textForCount}`;
  if (row) {
    const patch = { badge_count: next, text };
    if (linkPath) patch.link_path = linkPath;
    await supabase.from("notifications").update(patch).eq("id", row.id);
  } else {
    await supabase.from("notifications").insert({
      id: `n${Date.now()}-${userId}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: userId,
      text,
      read: false,
      kind,
      badge_count: 1,
      source_key: sk,
      link_path: linkPath
    });
  }
}

async function insertNotification({ userId, text, kind = "general", badgeCount = 1, linkPath = null }) {
  await supabase.from("notifications").insert({
    id: `n${Date.now()}-${userId}-${Math.random().toString(36).slice(2, 6)}`,
    user_id: userId,
    text,
    read: false,
    kind,
    badge_count: badgeCount,
    source_key: null,
    link_path: linkPath
  });
}

async function reactorsBreakdownFromRows(rows) {
  const userIds = [...new Set((rows || []).map((r) => r.user_id))];
  if (!userIds.length) return {};
  const { data: users } = await supabase.from("users").select("id, name, avatar_url").in("id", userIds);
  const um = new Map((users || []).map((u) => [u.id, { id: u.id, name: u.name, avatarUrl: u.avatar_url }]));
  const breakdown = {};
  for (const r of rows || []) {
    const t = ALLOWED_REACTIONS.includes(r.reaction) ? r.reaction : "like";
    const u = um.get(r.user_id);
    if (!u) continue;
    if (!breakdown[t]) breakdown[t] = [];
    breakdown[t].push(u);
  }
  return breakdown;
}

async function areFriends(a, b) {
  const { data } = await supabase
    .from("friends")
    .select("id")
    .or(`and(user_id.eq.${a},friend_id.eq.${b}),and(user_id.eq.${b},friend_id.eq.${a})`)
    .limit(1);
  return Boolean(data?.length);
}

const PRESENCE_ONLINE_SEC = 120;

const AVAILABILITY_VALUES = ["online", "idle", "dnd", "invisible"];

/** Normalize client/DB availability string. */
function sanitizeAvailability(raw) {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "online";
  return AVAILABILITY_VALUES.includes(v) ? v : "online";
}

/** Sanitize stored Spotify “now playing” JSON for API responses — never exposes refresh tokens. */
function sanitizeMusicSnippet(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  return {
    title: o.title ?? null,
    artist: o.artist ?? null,
    imageUrl: o.imageUrl ?? null,
    externalUrl: o.externalUrl ?? null,
    previewUrl: o.previewUrl ?? null,
    spotifyTrackId: o.spotifyTrackId ?? null,
    isPlaying: Boolean(o.isPlaying),
    source: typeof o.source === "string" ? o.source : "spotify",
    updatedAt: o.updatedAt ?? null,
    progressMs: typeof o.progressMs === "number" ? o.progressMs : null,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : null
  };
}

/** What other users see on your profile card when “share Now Playing” is on. */
function peerMusicNowPlaying(dbRow) {
  if (!dbRow?.music_share_now_playing) return null;
  const s = sanitizeMusicSnippet(dbRow.music_now_playing);
  if (!s?.isPlaying || !(s.title || s.spotifyTrackId)) return null;
  return s;
}

function storedNowPlayingFromSpotify(playState) {
  const t = playState.track;
  const base = {
    source: "spotify",
    updatedAt: new Date().toISOString(),
    progressMs: playState.rawProgress ?? null,
    durationMs: playState.rawDuration ?? null
  };
  if (!t) return { ...base, isPlaying: false, title: null, artist: null, imageUrl: null, externalUrl: null, previewUrl: null, spotifyTrackId: null };
  return {
    ...base,
    isPlaying: Boolean(playState.isPlaying),
    title: t.title,
    artist: t.artist,
    imageUrl: t.imageUrl,
    externalUrl: t.externalUrl,
    previewUrl: t.previewUrl,
    spotifyTrackId: t.spotifyTrackId
  };
}

/** Session / profile responses — includes your own preference (not leaked to others via toPublicUser). */
function authUserPayload(row) {
  if (!row) return null;
  return {
    ...toPublicUser(row),
    availability: sanitizeAvailability(row.availability),
    spotifyLinked: Boolean(row.spotify_refresh_token),
    musicShareNowPlaying: Boolean(row.music_share_now_playing),
    musicNowPlaying: sanitizeMusicSnippet(row.music_now_playing)
  };
}

/**
 * Peer-facing presence for Messages (respects invisible for non-self viewers).
 */
function publicProfileWithPresence(dbRow, viewerId, onlineSet) {
  if (!dbRow) return null;
  const pub = toPublicUser(dbRow);
  const mode = sanitizeAvailability(dbRow.availability);
  const connected = onlineSet.has(pub.id);
  const self = viewerId === pub.id;
  /** @type {boolean} */
  let isOnline = false;
  /** @type {string} */
  let presence = "offline";

  if (!connected) {
    isOnline = false;
    presence = "offline";
  } else if (!self && mode === "invisible") {
    isOnline = false;
    presence = "offline";
  } else if (self && mode === "invisible") {
    isOnline = true;
    presence = "invisible";
  } else if (mode === "dnd") {
    isOnline = true;
    presence = "dnd";
  } else if (mode === "idle") {
    isOnline = true;
    presence = "idle";
  } else {
    isOnline = true;
    presence = "online";
  }

  const musicNowPlaying = peerMusicNowPlaying(dbRow);
  return { ...pub, isOnline, presence, musicNowPlaying };
}

async function upsertUserPresence(userId) {
  await supabase.from("user_presence").upsert(
    { user_id: userId, last_seen_at: new Date().toISOString() },
    { onConflict: "user_id" }
  );
}

async function presenceOnlineSetForUserIds(userIds) {
  const uniq = [...new Set(userIds)].filter(Boolean);
  if (!uniq.length) return new Set();
  const cutoff = new Date(Date.now() - PRESENCE_ONLINE_SEC * 1000).toISOString();
  const { data } = await supabase
    .from("user_presence")
    .select("user_id")
    .in("user_id", uniq)
    .gte("last_seen_at", cutoff);
  return new Set((data || []).map((r) => r.user_id));
}

/** Friend user IDs for accepted friendships (bidirectional rows). */
async function friendIdsForUser(meId) {
  const { data } = await supabase
    .from("friends")
    .select("user_id, friend_id")
    .or(`user_id.eq.${meId},friend_id.eq.${meId}`);
  const ids = [];
  for (const f of data || []) {
    ids.push(f.user_id === meId ? f.friend_id : f.user_id);
  }
  return ids;
}

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Friend or owner can access non-expired story (for reactions / reactor list). */
async function storyFriendAccess(storyId, viewerId) {
  const { data: story } = await supabase.from("user_stories").select("*").eq("id", storyId).maybeSingle();
  if (!story) return { ok: false, status: 404, msg: "Story not found" };
  const cutoff = new Date(Date.now() - STORY_TTL_MS).toISOString();
  if (story.created_at < cutoff) return { ok: false, status: 410, msg: "Story expired" };
  if (story.user_id === viewerId) return { ok: true, story };
  if (story.visibility === "only me") return { ok: false, status: 403, msg: "Not allowed" };
  if (story.visibility === "public") return { ok: true, story };
  const okFriend = await areFriends(viewerId, story.user_id);
  if (!okFriend) return { ok: false, status: 403, msg: "Not allowed" };
  return { ok: true, story };
}

/** Stories from the last 24h for me + friends, grouped by author with view state. */
async function buildStoryRings(viewerId) {
  const cutoff = new Date(Date.now() - STORY_TTL_MS).toISOString();
  const friendIds = await friendIdsForUser(viewerId);
  const { data: allRows } = await supabase
    .from("user_stories")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true });

  const rows = (allRows || []).filter((r) => {
    if (r.user_id === viewerId) return true;
    if (r.visibility === "only me") return false;
    if (r.visibility === "public") return true;
    // Default or "friends" visibility
    return friendIds.includes(r.user_id);
  });

  if (!rows?.length) return { rings: [] };

  const storyIds = rows.map((r) => r.id);
  const { data: views } = await supabase
    .from("story_views")
    .select("story_id")
    .eq("viewer_id", viewerId)
    .in("story_id", storyIds);
  const viewedSet = new Set((views || []).map((v) => v.story_id));

  const { data: rxRows } =
    storyIds.length > 0
      ? await supabase.from("story_reactions").select("story_id, user_id, reaction").in("story_id", storyIds)
      : { data: [] };

  /** @type {Map<string, { breakdown: Record<string, number>, myReaction: string | null }>} */
  const rxMap = new Map();
  for (const sid of storyIds) {
    rxMap.set(sid, { breakdown: {}, myReaction: null });
  }
  for (const row of rxRows || []) {
    const bag = rxMap.get(row.story_id);
    if (!bag) continue;
    const type = ALLOWED_REACTIONS.includes(row.reaction) ? row.reaction : "like";
    bag.breakdown[type] = (bag.breakdown[type] || 0) + 1;
    if (row.user_id === viewerId) bag.myReaction = type;
  }

  const ownStoryIds = rows.filter((row) => row.user_id === viewerId).map((row) => row.id);
  /** @type {Map<string, number>} */
  const viewCountMap = new Map();
  if (ownStoryIds.length) {
    const { data: vcRows } = await supabase.from("story_views").select("story_id").in("story_id", ownStoryIds);
    for (const row of vcRows || []) {
      viewCountMap.set(row.story_id, (viewCountMap.get(row.story_id) || 0) + 1);
    }
  }

  /** @type {Map<string, number>} */
  const commentCountMap = new Map();
  if (storyIds.length) {
    const { data: scRows } = await supabase.from("story_comments").select("story_id").in("story_id", storyIds);
    for (const row of scRows || []) {
      commentCountMap.set(row.story_id, (commentCountMap.get(row.story_id) || 0) + 1);
    }
  }

  const byUser = new Map();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    const bag = rxMap.get(r.id) || { breakdown: {}, myReaction: null };
    const reactionCount = Object.values(bag.breakdown).reduce((a, b) => a + b, 0);
    byUser.get(r.user_id).push({
      id: r.id,
      text: r.body_text || "",
      imageUrl: r.media_url || null,
      visibility: r.visibility || "friends",
      spotifyTrackId: r.spotify_track_id || null,
      musicTitle: r.music_title || null,
      musicArtist: r.music_artist || null,
      musicImageUrl: r.music_image_url || null,
      musicPreviewUrl: r.music_preview_url || null,
      musicExternalUrl: r.music_external_url || null,
      createdAt: r.created_at,
      viewed: viewedSet.has(r.id),
      reactionBreakdown: bag.breakdown,
      myReaction: bag.myReaction,
      reactionCount,
      commentCount: commentCountMap.get(r.id) || 0,
      ...(r.user_id === viewerId ? { viewerCount: viewCountMap.get(r.id) || 0 } : {})
    });
  }

  const authorIds = [...byUser.keys()];
  const { data: users } = await supabase.from("users").select("*").in("id", authorIds);
  const um = new Map((users || []).map((u) => [u.id, u]));
  const onlineSet = await presenceOnlineSetForUserIds(authorIds);

  function ringFor(uid) {
    const u = um.get(uid);
    if (!u) return null;
    const stories = byUser.get(uid) || [];
    const pub = publicProfileWithPresence(u, viewerId, onlineSet);
    const isSelf = uid === viewerId;
    const hasUnviewed = isSelf ? stories.length > 0 : stories.some((s) => !s.viewed);
    return { user: pub, stories, hasUnviewed };
  }

  const rings = [];
  if (byUser.has(viewerId)) {
    const mine = ringFor(viewerId);
    if (mine) rings.push(mine);
  }
  const others = authorIds
    .filter((id) => id !== viewerId)
    .sort((a, b) => String(um.get(a)?.name || "").localeCompare(String(um.get(b)?.name || "")));
  for (const uid of others) {
    const ring = ringFor(uid);
    if (ring) rings.push(ring);
  }

  return { rings };
}

// ---------- Group chat helpers ----------

async function ensureGroupMember(conversationId, userId) {
  const { data } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

async function fetchGroupSummary(conversationId, viewerId) {
  const { data: conv } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;
  const { data: memberRows } = await supabase
    .from("conversation_members")
    .select("user_id, role")
    .eq("conversation_id", conversationId);
  const memberIds = (memberRows || []).map((m) => m.user_id);
  const { data: users } = memberIds.length
    ? await supabase.from("users").select("*").in("id", memberIds)
    : { data: [] };
  const userMap = new Map((users || []).map((u) => [u.id, u]));
  const onlineSet = await presenceOnlineSetForUserIds(memberIds);
  const members = (memberRows || []).map((m) => ({
    ...publicProfileWithPresence(userMap.get(m.user_id), viewerId, onlineSet),
    role: m.role
  }));
  return {
    id: conv.id,
    name: conv.name,
    photoUrl: conv.photo_url,
    isGroup: conv.is_group,
    createdAt: conv.created_at,
    createdBy: conv.created_by,
    members,
    isMember: members.some((m) => m.id === viewerId),
    isAdmin: members.some((m) => m.id === viewerId && m.role === "admin")
  };
}

function serializeChatMessage(row, viewerId) {
  const unsent = !!row.is_unsent;
  return {
    id: row.id,
    text: unsent ? "" : (row.text || ""),
    fromUserId: row.from_user_id,
    fromMe: row.from_user_id === viewerId,
    createdAt: row.created_at,
    isUnsent: unsent,
    replyToId: row.reply_to_id || null,
    attachment: unsent || !row.attachment_url
      ? null
      : {
          url: row.attachment_url,
          type: row.attachment_type,
          name: row.attachment_name,
          size: row.attachment_size,
          isImage: row.attachment_type === "image"
        }
  };
}

async function decorateChatMessages(rows, viewerId) {
  if (!rows?.length) return [];
  const senderIds = [...new Set(rows.map((m) => m.from_user_id))];
  const messageIds = rows.map((m) => m.id);
  const replyTargetIds = [...new Set(rows.map((m) => m.reply_to_id).filter(Boolean))];

  const [{ data: users }, { data: reactionRows }, replyTargetsRes] = await Promise.all([
    supabase.from("users").select("id, name, avatar_url").in("id", senderIds),
    supabase.from("message_reactions").select("*").in("message_id", messageIds),
    replyTargetIds.length
      ? supabase.from("messages").select("id, from_user_id, text, attachment_type, is_unsent").in("id", replyTargetIds)
      : Promise.resolve({ data: [] })
  ]);

  const senderMap = new Map((users || []).map((u) => [u.id, u]));

  // For reply quotes we also need the original sender names — fetch any IDs we
  // haven't already collected from the main message list.
  const replyTargets = replyTargetsRes.data || [];
  const missingSenderIds = replyTargets
    .map((r) => r.from_user_id)
    .filter((id) => id && !senderMap.has(id));
  if (missingSenderIds.length) {
    const { data: extraUsers } = await supabase
      .from("users")
      .select("id, name, avatar_url")
      .in("id", [...new Set(missingSenderIds)]);
    for (const u of extraUsers || []) senderMap.set(u.id, u);
  }
  const replyMap = new Map(
    replyTargets.map((r) => {
      const sender = senderMap.get(r.from_user_id);
      let snippet = r.is_unsent ? "(message unsent)" : (r.text || "").slice(0, 120);
      if (!snippet) {
        if (r.attachment_type === "image") snippet = "📷 Photo";
        else if (r.attachment_type === "file") snippet = "📁 File";
      }
      return [r.id, {
        id: r.id,
        author: sender?.name || "Unknown",
        text: snippet,
        isUnsent: !!r.is_unsent
      }];
    })
  );

  const reactionsByMessage = new Map();
  for (const r of reactionRows || []) {
    const type = ALLOWED_REACTIONS.includes(r.reaction) ? r.reaction : "like";
    if (!reactionsByMessage.has(r.message_id)) reactionsByMessage.set(r.message_id, { breakdown: {}, mine: null });
    const entry = reactionsByMessage.get(r.message_id);
    entry.breakdown[type] = (entry.breakdown[type] || 0) + 1;
    if (r.user_id === viewerId) entry.mine = type;
  }

  return rows.map((row) => {
    const sender =
      row.from_user_id === USERPHONE_GUEST_ID ? null : senderMap.get(row.from_user_id);
    const rx = reactionsByMessage.get(row.id) || { breakdown: {}, mine: null };
    const isGuestBridge = row.from_user_id === USERPHONE_GUEST_ID;
    const isSiglaAi = row.from_user_id === SIGLACAST_AI_USER_ID;
    return {
      ...serializeChatMessage(row, viewerId),
      author: isGuestBridge ? "Anonymous" : isSiglaAi ? "SiglaCast AI" : (sender?.name || "Unknown"),
      authorAvatar: isGuestBridge || isSiglaAi ? null : (sender?.avatar_url || null),
      reactionBreakdown: row.is_unsent ? {} : rx.breakdown,
      myReaction: row.is_unsent ? null : rx.mine,
      replyTo: row.reply_to_id ? (replyMap.get(row.reply_to_id) || null) : null
    };
  });
}

/** DM thread rows: pairwise human messages plus SiglaCast AI replies bound to either participant (`to_user_id`). */
async function fetchDmMessagesRaw(me, otherId) {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .is("conversation_id", null)
    .or(
      `and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me}),and(from_user_id.eq.${SIGLACAST_AI_USER_ID},to_user_id.eq.${me}),and(from_user_id.eq.${SIGLACAST_AI_USER_ID},to_user_id.eq.${otherId})`
    )
    .order("created_at", { ascending: true });
  return data || [];
}

/** Max time to stay in the Userphone match queue before auto-dropping to idle (ms). */
const USERPHONE_WAIT_MS = 10_000;

/** In-process queue when Postgres table `anon_userphone_conv_waiting` is missing (migrate 0008 for production). */
const convWaitingMemory = new Map();
/** @type {"db"|"memory"|undefined} */
let convWaitingResolvedMode;

function convWaitingLooksLikeMissingTable(err) {
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("anon_userphone_conv_waiting") ||
    msg.includes("conv_waiting") ||
    (msg.includes("could not find the table") && msg.includes("userphone"))
  );
}

async function resolveConvWaitingMode() {
  if (convWaitingResolvedMode) return convWaitingResolvedMode;
  const { error } = await supabase.from("anon_userphone_conv_waiting").select("conversation_id").limit(1);
  if (error && convWaitingLooksLikeMissingTable(error)) {
    convWaitingResolvedMode = "memory";
    console.warn(
      "[userphone] anon_userphone_conv_waiting is unavailable — using in-memory bridge queue.",
      "Apply supabase/migrations/0008_userphone_group_bridge.sql for a persistent queue."
    );
  } else {
    convWaitingResolvedMode = "db";
    if (error) console.warn("[userphone] conv_waiting probe:", error.message);
  }
  return convWaitingResolvedMode;
}

function convWaitingMemoryPruneStale() {
  const cutoffMs = Date.now() - USERPHONE_WAIT_MS;
  for (const [cid, row] of convWaitingMemory.entries()) {
    if (new Date(row.joined_at).getTime() < cutoffMs) convWaitingMemory.delete(cid);
  }
}

async function convWaitingFetchAllSorted() {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemoryPruneStale();
    return [...convWaitingMemory.entries()]
      .map(([conversation_id, v]) => ({
        conversation_id,
        queued_by_user_id: v.queued_by_user_id,
        joined_at: v.joined_at
      }))
      .sort((a, b) => new Date(a.joined_at) - new Date(b.joined_at));
  }
  const { data } = await supabase
    .from("anon_userphone_conv_waiting")
    .select("*")
    .order("joined_at", { ascending: true });
  return data || [];
}

async function convWaitingFindByConversationId(gid) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemoryPruneStale();
    const row = convWaitingMemory.get(gid);
    return row ? { conversation_id: gid, queued_by_user_id: row.queued_by_user_id, joined_at: row.joined_at } : null;
  }
  const { data } = await supabase.from("anon_userphone_conv_waiting").select("*").eq("conversation_id", gid).maybeSingle();
  return data || null;
}

async function convWaitingUpsertEnqueue(row) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemoryPruneStale();
    convWaitingMemory.set(row.conversation_id, {
      queued_by_user_id: row.queued_by_user_id,
      joined_at: row.joined_at
    });
    return null;
  }
  const { error } = await supabase.from("anon_userphone_conv_waiting").upsert(
    {
      conversation_id: row.conversation_id,
      queued_by_user_id: row.queued_by_user_id,
      joined_at: row.joined_at
    },
    { onConflict: "conversation_id" }
  );
  if (error && convWaitingLooksLikeMissingTable(error)) {
    convWaitingResolvedMode = "memory";
    convWaitingMemoryPruneStale();
    convWaitingMemory.set(row.conversation_id, {
      queued_by_user_id: row.queued_by_user_id,
      joined_at: row.joined_at
    });
    console.warn("[userphone] conv_waiting unavailable on upsert — using in-memory:", error.message);
    return null;
  }
  return error;
}

async function convWaitingDeleteByConversationId(gid) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemory.delete(gid);
    return;
  }
  await supabase.from("anon_userphone_conv_waiting").delete().eq("conversation_id", gid);
}

async function convWaitingDeleteByQueuedUserId(uid) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    for (const [k, v] of [...convWaitingMemory.entries()]) {
      if (v.queued_by_user_id === uid) convWaitingMemory.delete(k);
    }
    return;
  }
  await supabase.from("anon_userphone_conv_waiting").delete().eq("queued_by_user_id", uid);
}

async function convWaitingDeleteConversationReturning(cid) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    if (!convWaitingMemory.has(cid)) return [];
    convWaitingMemory.delete(cid);
    return [{ conversation_id: cid }];
  }
  const { data } = await supabase
    .from("anon_userphone_conv_waiting")
    .delete()
    .eq("conversation_id", cid)
    .select("conversation_id");
  return data || [];
}

async function convWaitingReinsertPair(firstRow, secondRow) {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemory.set(firstRow.conversation_id, {
      queued_by_user_id: firstRow.queued_by_user_id,
      joined_at: firstRow.joined_at
    });
    convWaitingMemory.set(secondRow.conversation_id, {
      queued_by_user_id: secondRow.queued_by_user_id,
      joined_at: secondRow.joined_at
    });
    return;
  }
  await supabase.from("anon_userphone_conv_waiting").insert([
    {
      conversation_id: firstRow.conversation_id,
      queued_by_user_id: firstRow.queued_by_user_id,
      joined_at: firstRow.joined_at
    },
    {
      conversation_id: secondRow.conversation_id,
      queued_by_user_id: secondRow.queued_by_user_id,
      joined_at: secondRow.joined_at
    }
  ]);
}

/** Random anonymous pairing chat — identities never leak in API payloads. */
function serializeUserphoneMessages(rows, viewerId) {
  return (rows || []).map((row) => ({
    id: row.id,
    text: row.text || "",
    fromMe: row.from_user_id === viewerId,
    createdAt: row.created_at,
    author:
      row.from_user_id === SIGLACAST_AI_USER_ID
        ? "SiglaCast AI"
        : row.from_user_id === viewerId
          ? "You"
          : "Anonymous",
    anonymous:
      row.from_user_id !== viewerId && row.from_user_id !== SIGLACAST_AI_USER_ID ? true : false
  }));
}

async function fetchActiveUserphoneSession(userId) {
  const { data } = await supabase
    .from("anon_userphone_sessions")
    .select("*")
    .is("ended_at", null)
    .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
    .maybeSingle();
  return data || null;
}

/** Active 1-on-1 Userphone (not a group-chat bridge session). */
async function fetchActiveSoloUserphoneSession(userId) {
  const s = await fetchActiveUserphoneSession(userId);
  if (!s) return null;
  if (s.bridge_conversation_a || s.bridge_conversation_b) return null;
  return s;
}

async function tryPairUserphoneUsers(me) {
  if (await fetchActiveUserphoneSession(me)) return;
  const cutoff = new Date(Date.now() - USERPHONE_WAIT_MS).toISOString();
  const { data: peerRow } = await supabase
    .from("anon_userphone_waiting")
    .select("user_id")
    .neq("user_id", me)
    .gte("joined_at", cutoff)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const peerId = peerRow?.user_id;
  if (!peerId || peerId === me) return;
  if (await fetchActiveUserphoneSession(peerId)) return;
  const { data: grabbed } = await supabase.from("anon_userphone_waiting").delete().eq("user_id", peerId).select("user_id");
  if (!grabbed?.length) return;
  const { data: selfRemoved } = await supabase.from("anon_userphone_waiting").delete().eq("user_id", me).select("user_id");
  if (!selfRemoved?.length) {
    await supabase.from("anon_userphone_waiting").insert({ user_id: peerId });
    return;
  }
  const id = `up${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const participantA = peerId < me ? peerId : me;
  const participantB = peerId < me ? me : peerId;
  const { error } = await supabase.from("anon_userphone_sessions").insert({
    id,
    participant_a: participantA,
    participant_b: participantB
  });
  if (error) {
    await supabase.from("anon_userphone_waiting").insert([{ user_id: me }, { user_id: peerId }]);
    return;
  }
}

async function buildUserphoneState(me) {
  const session = await fetchActiveSoloUserphoneSession(me);
  if (session) {
    const { data: rows } = await supabase
      .from("anon_userphone_messages")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });
    return {
      phase: "matched",
      sessionId: session.id,
      messages: serializeUserphoneMessages(rows, me)
    };
  }
  const { data: waitRow } = await supabase
    .from("anon_userphone_waiting")
    .select("user_id, joined_at")
    .eq("user_id", me)
    .maybeSingle();
  if (waitRow) {
    const joinedMs = new Date(waitRow.joined_at).getTime();
    const elapsed = Date.now() - joinedMs;
    if (elapsed >= USERPHONE_WAIT_MS) {
      await supabase.from("anon_userphone_waiting").delete().eq("user_id", me);
      return { phase: "idle", sessionId: null, messages: [], waitTimedOut: true };
    }
    const waitExpiresAt = new Date(joinedMs + USERPHONE_WAIT_MS).toISOString();
    return {
      phase: "waiting",
      sessionId: null,
      messages: [],
      waitExpiresAt,
      waitStartedAt: waitRow.joined_at
    };
  }
  return { phase: "idle", sessionId: null, messages: [] };
}

async function cleanupStaleConvWaiting() {
  const mode = await resolveConvWaitingMode();
  if (mode === "memory") {
    convWaitingMemoryPruneStale();
    return;
  }
  const cutoff = new Date(Date.now() - USERPHONE_WAIT_MS).toISOString();
  await supabase.from("anon_userphone_conv_waiting").delete().lt("joined_at", cutoff);
}

/** Pair two different group threads that are queued for anonymous bridge. */
async function tryPairConversationBridges() {
  await cleanupStaleConvWaiting();
  const rows = await convWaitingFetchAllSorted();
  if (!rows?.length) return;
  const first = rows[0];
  const second = rows.find((r) => r.conversation_id !== first.conversation_id);
  if (!second) return;
  const hostA = first.queued_by_user_id;
  const hostB = second.queued_by_user_id;
  if (await fetchActiveUserphoneSession(hostA)) return;
  if (await fetchActiveUserphoneSession(hostB)) return;
  const gotA = await convWaitingDeleteConversationReturning(first.conversation_id);
  const gotB = await convWaitingDeleteConversationReturning(second.conversation_id);
  if (!gotA?.length || !gotB?.length) return;
  const ca = first.conversation_id;
  const cb = second.conversation_id;
  const participantA = hostA < hostB ? hostA : hostB;
  const participantB = hostA < hostB ? hostB : hostA;
  const bridgeA = hostA < hostB ? ca : cb;
  const bridgeB = hostA < hostB ? cb : ca;
  const id = `up${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.from("anon_userphone_sessions").insert({
    id,
    participant_a: participantA,
    participant_b: participantB,
    bridge_conversation_a: bridgeA,
    bridge_conversation_b: bridgeB
  });
  if (error) {
    console.error("[tryPairConversationBridges]", error.message);
    await convWaitingReinsertPair(first, second);
  }
}

async function fetchActiveBridgeSessionForConversation(conversationId) {
  const { data } = await supabase
    .from("anon_userphone_sessions")
    .select("*")
    .is("ended_at", null)
    .or(`bridge_conversation_a.eq.${conversationId},bridge_conversation_b.eq.${conversationId}`)
    .maybeSingle();
  return data || null;
}

async function buildGroupUserphoneBridge(gid /* , me retained for future ACL */) {
  await cleanupStaleConvWaiting();
  const session = await fetchActiveBridgeSessionForConversation(gid);
  if (session) {
    return { phase: "matched", sessionId: session.id };
  }
  const w = await convWaitingFindByConversationId(gid);
  if (w) {
    const joinedMs = new Date(w.joined_at).getTime();
    if (Date.now() - joinedMs >= USERPHONE_WAIT_MS) {
      await convWaitingDeleteByConversationId(gid);
      return { phase: "idle", waitTimedOut: true };
    }
    return {
      phase: "waiting",
      waitExpiresAt: new Date(joinedMs + USERPHONE_WAIT_MS).toISOString(),
      waitStartedAt: w.joined_at
    };
  }
  return { phase: "idle" };
}

async function getGroupThreadPayload(gid, me) {
  if (!(await ensureGroupMember(gid, me))) return { errorStatus: 403, errorMessage: "You are not a member of this group" };
  const summary = await fetchGroupSummary(gid, me);
  if (!summary) return { errorStatus: 404, errorMessage: "Group not found" };
  const { data: msgs } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", gid)
    .order("created_at", { ascending: true });
  const groupUserphone = await buildGroupUserphoneBridge(gid, me);
  return { group: summary, messages: await decorateChatMessages(msgs || [], me), groupUserphone };
}

async function relayGroupBridgeMessage(insertedRow) {
  if (!insertedRow?.conversation_id || insertedRow.bridge_mirror) return;
  if (insertedRow.from_user_id === USERPHONE_GUEST_ID) return;
  if (insertedRow.from_user_id === SIGLACAST_AI_USER_ID) return;
  const gid = insertedRow.conversation_id;
  const session = await fetchActiveBridgeSessionForConversation(gid);
  if (!session?.id || session.ended_at) return;
  const other =
    session.bridge_conversation_a === gid ? session.bridge_conversation_b : session.bridge_conversation_a;
  if (!other) return;
  const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { error } = await supabase.from("messages").insert({
    id,
    conversation_id: other,
    from_user_id: USERPHONE_GUEST_ID,
    to_user_id: null,
    text: insertedRow.text,
    read: false,
    reply_to_id: null,
    attachment_url: insertedRow.attachment_url,
    attachment_type: insertedRow.attachment_type,
    attachment_name: insertedRow.attachment_name,
    attachment_size: insertedRow.attachment_size,
    bridge_mirror: true,
    is_unsent: false
  });
  if (error) console.error("[relayGroupBridgeMessage]", error.message);
}

// Seed an admin account + demo event if users table is empty.
// Demo student accounts are no longer auto-created.
async function seedIfEmpty() {
  const { count } = await supabase.from("users").select("*", { count: "exact", head: true });
  if (count && count > 0) return;
  const adminHash = await bcrypt.hash("admin123", 10);
  await supabase.from("users").insert([
    { id: "a1", role: "admin", name: "System Admin", email: "admin@gmail.com", password_hash: adminHash, permissions: ["all"] }
  ]);
  await supabase.from("events").insert([
    { id: "e1", title: "Community Election 2026", description: "Community-wide election for group officers.", status: "open", strategy: "single", max_votes_per_user: 1 }
  ]);
  await supabase.from("candidates").insert([
    { id: "c1", event_id: "e1", name: "Team Sigla", position: 0 },
    { id: "c2", event_id: "e1", name: "Team Bagani", position: 1 }
  ]);
  await supabase.from("announcements").insert([
    { id: "an1", title: "Welcome to SiglaCast", message: "Voting is now open for Student Election 2026." }
  ]);
  console.log("[seed] default admin + demo event created");
}

const app = express();
app.use(cors({
  origin(origin, cb) {
    if (!origin || FRONTEND_ORIGIN === "*") return cb(null, true);
    if (MOBILE_APP_ORIGINS.includes(origin)) return cb(null, true);
    try {
      const url = new URL(origin);
      if (
        (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
        ["http:", "https:", "capacitor:"].includes(url.protocol)
      ) {
        return cb(null, true);
      }
    } catch {
      // Fall through to the explicit allow-list below.
    }
    const allowed = new Set([
      ...FRONTEND_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
      ...MOBILE_APP_ORIGINS
    ]);
    return cb(null, allowed.has(origin));
  },
  credentials: false
}));
app.use(express.json({ limit: "30mb" }));

await seedIfEmpty();

const broker = await makeBroker();
await broker.consume("vote.cast", (m) => console.log("[vote.cast]", m));
await broker.consume("post.created", (m) => console.log("[post.created]", m.id));
await broker.consume("message.sent", (m) => console.log("[message.sent]", m.fromUserId, "->", m.toUserId));

app.get("/api/health", (_, res) => res.json({ ok: true }));

function sanitizeGroqAssistantMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-48)) {
    const role =
      m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    if (!role) continue;
    let content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    if (content.length > 12000) content = content.slice(0, 12000);
    out.push({ role, content });
  }
  return out;
}

const SIGLA_ASSISTANT_SYSTEM_PROMPT = `You are Sigla Assistant—SiglaCast’s Groq-backed AI companion. SiglaCast is the DosU community app (events/voting, announcements, community posts, messaging). Outside the app you act as a general-purpose assistant chatbot students can use freely.

Scope (wide):
- Answer normal questions users would ask ChatGPT/Gemini: homework help with explanations (not cheating on closed exams!), studying, summaries, drafts, Filipino or English conversation, trivia, beginner coding/setup tips, brainstorming, etc.
- When they ask SiglaCast questions, explain navigating features from a general product perspective—you have NO live DB or private data.

Style:
- Be clear, respectful, concise when possible; use headings or bullets for long answers unless they want prose.
- For homework: give clear explanations and step-by-step worked examples whenever that helps—they’re chatting you as a study tutor. Only push back plainly if someone explicitly asks how to cheat on a live graded/closed-book exam rather than practice or understanding.
- If asked about ballots/voting fairness: one-vote fairness, admins configure events, you cannot see tally results.
- You are not DosU officially, legal counsel, a doctor, or an emergency helpline—for legal/medical crises point to appropriate professionals/emergency lines.
- If uncertain, say so. No inventing institutional deadlines/contact info for DosU—in-app/official notices win when details matter.

Prefer matching the user’s language (English, Filipino/Bisaya, Taglish okay). Tone: approachable and helpful without being cheesy.

Personalization appended below is ONLY for rapport (name + role)—not access to grades or accounts.`;

const SIGLA_THREAD_TRANSCRIPT_NOTE = `\nTranscript convention: Participants appear as prefixed lines (“You:”, member names, “Anonymous” from Userphone or bridge, or Sigla Assistant’s earlier replies marked assistant role). Speak as Sigla Assistant; answer the MOST RECENT user message(s) naturally.`;

function compactGroqUserAssistantRuns(msgs) {
  const out = [];
  for (const m of msgs || []) {
    const role = m.role;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === "user" && role === "user") prev.content += "\n\n" + content;
    else out.push({ role, content });
  }
  return out;
}

function transcriptTurnsFromDecorated(decorated) {
  /** @type {{role:string,content:string}[]} */
  const turns = [];
  for (const m of decorated || []) {
    if (m.isUnsent) continue;
    let text = typeof m.text === "string" ? m.text.trim() : "";
    if (!text && m.attachment) text = m.attachment.isImage ? "📷 [image]" : "📁 [file]";
    if (!text) continue;
    if (m.fromUserId === SIGLACAST_AI_USER_ID) turns.push({ role: "assistant", content: text });
    else if (m.fromUserId === USERPHONE_GUEST_ID || m.author === "Anonymous") {
      turns.push({ role: "user", content: `Anonymous: ${text}` });
    } else if (m.fromMe === true || m.author === "You") turns.push({ role: "user", content: `You: ${text}` });
    else {
      const nm = typeof m.author === "string" && m.author.trim() ? m.author : "Member";
      turns.push({ role: "user", content: `${nm}: ${text}` });
    }
  }
  return compactGroqUserAssistantRuns(turns);
}

function anonUserphoneRowsToGroqTurns(rows, viewerId) {
  /** @type {{role:string,content:string}[]} */
  const turns = [];
  for (const row of rows || []) {
    const text = String(row.text || "").trim();
    if (!text) continue;
    if (row.from_user_id === SIGLACAST_AI_USER_ID) turns.push({ role: "assistant", content: text });
    else if (row.from_user_id === viewerId) turns.push({ role: "user", content: `You: ${text}` });
    else turns.push({ role: "user", content: `Anonymous: ${text}` });
  }
  return compactGroqUserAssistantRuns(turns);
}

/** Base prompt + threaded-chat instructions + personalization (Groq system message). */
function buildSiglaContextualPrompt(reqUser) {
  const safeName = String(reqUser?.name || "Student")
    .slice(0, 80)
    .replace(/\\/g, " ")
    .replace(/"/g, "'");
  return `${SIGLA_ASSISTANT_SYSTEM_PROMPT}${SIGLA_THREAD_TRANSCRIPT_NOTE}\nSigned-in user role (for rapport): ${reqUser?.role}. Preferred name/reference: "${safeName}".`;
}

async function groqCompletion(systemContent, openAiStyleMessages) {
  if (!GROQ_API_KEY || !String(GROQ_API_KEY).trim()) {
    return {
      error: "Sigla Assistant is unavailable: set GROQ_API_KEY on the server (backend .env)."
    };
  }
  const groqPayload = {
    model: GROQ_MODEL,
    messages: [{ role: "system", content: systemContent }, ...openAiStyleMessages],
    max_tokens: 2048,
    temperature: 0.75
  };
  const groqRes = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(groqPayload)
  });
  const data = await groqRes.json().catch(() => ({}));
  if (!groqRes.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      `Groq request failed (${groqRes.status})`;
    console.warn("[assistant/groq]", groqRes.status, msg);
    return { error: msg };
  }
  const reply =
    data?.choices?.[0]?.message?.content?.trim?.() ||
    (typeof data?.choices?.[0]?.text === "string" ? data.choices[0].text.trim() : "");
  if (!reply) return { error: "Empty response from Sigla Assistant." };
  return {
    reply,
    model: typeof data?.model === "string" ? data.model : GROQ_MODEL
  };
}

app.post("/api/assistant/chat", authenticate, async (req, res) => {
  try {
    const userTurns = sanitizeGroqAssistantMessages(req.body?.messages);
    const lastUser = [...userTurns].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return res.status(400).json({ error: "Send at least one user message." });
    }

    const contextualSystem = buildSiglaContextualPrompt(req.user);

    const result = await groqCompletion(contextualSystem, userTurns);
    if (result?.error) {
      const code = String(result.error).includes("unavailable") ? 503 : 502;
      return res.status(code).json({ error: result.error });
    }
    res.json({ reply: result.reply, model: result.model });
  } catch (e) {
    console.error("[assistant]", e.message);
    res.status(500).json({ error: e.message || "Assistant failed" });
  }
});

app.post("/api/presence/heartbeat", authenticate, async (req, res) => {
  try {
    await upsertUserPresence(req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function authenticate(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { return res.status(401).json({ error: "Invalid or expired token" }); }
  if (payload.type !== "access") return res.status(401).json({ error: "Invalid token type" });
  fetchUserById(payload.sub).then((user) => {
    if (!user) return res.status(401).json({ error: "Invalid session" });
    req.user = user;
    next();
  }).catch((e) => res.status(500).json({ error: e.message }));
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  next();
}

// Auth
app.post("/api/auth/register", async (req, res) => {
  try {
    const body = req.body || {};
    const v = validateRegisterForm({
      name: body.name,
      email: body.email,
      password: body.password,
      course: body.course ?? ""
    });
    if (!v.ok) {
      const messages = [...new Set(Object.values(v.fieldErrors))];
      return res.status(400).json({ error: messages.join(" ") });
    }
    const { name, email, password, course } = v.normalized;
    const existing = await fetchUserByEmail(email);
    if (existing) return res.status(400).json({ error: "Email already registered" });
    const { count } = await supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "student");
    const id = `s${(count || 0) + 1}-${Date.now().toString(36)}`;
    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from("users").insert({
      id, role: "student", name, email, password_hash, course, permissions: []
    });
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: "Registered successfully" });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await fetchUserByEmail(String(email || ""));
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password || "", user.password_hash || "");
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);
    const refresh_token_hash = await bcrypt.hash(refreshToken, 10);
    await supabase.from("users").update({ refresh_token_hash }).eq("id", user.id);
    res.json({ token: accessToken, accessToken, refreshToken, user: authUserPayload(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(401).json({ error: "Refresh token required" });
    let payload;
    try { payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET); }
    catch { return res.status(401).json({ error: "Invalid or expired refresh token" }); }
    if (payload.type !== "refresh") return res.status(401).json({ error: "Invalid token type" });
    const user = await fetchUserById(payload.sub);
    if (!user || !user.refresh_token_hash) return res.status(401).json({ error: "Refresh token not recognized" });
    const valid = await bcrypt.compare(refreshToken, user.refresh_token_hash);
    if (!valid) return res.status(401).json({ error: "Refresh token revoked" });
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);
    const refresh_token_hash = await bcrypt.hash(newRefreshToken, 10);
    await supabase.from("users").update({ refresh_token_hash }).eq("id", user.id);
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken, user: authUserPayload(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/logout", authenticate, async (req, res) => {
  await supabase.from("users").update({ refresh_token_hash: null }).eq("id", req.user.id);
  res.json({ success: true });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: authUserPayload(req.user) });
});

app.patch("/api/profile", authenticate, async (req, res) => {
  try {
    const { name, currentPassword, newPassword, statusEmoji, statusNote, availability, bio, removeCover, musicShareNowPlaying } =
      req.body || {};
    const updates = {};
    const trimmedName = name !== undefined ? String(name).trim() : "";
    if (trimmedName) updates.name = trimmedName;
    if (availability !== undefined) {
      updates.availability = sanitizeAvailability(availability);
    }
    if (statusEmoji !== undefined) {
      const em = String(statusEmoji).trim();
      updates.status_emoji = em ? em.slice(0, 48) : null;
    }
    if (statusNote !== undefined) {
      const nt = String(statusNote).trim();
      updates.status_note = nt ? nt.slice(0, 128) : null;
    }
    if (bio !== undefined) {
      const b = String(bio).trim();
      updates.bio = b ? b.slice(0, 500) : null;
    }
    if (removeCover === true) {
      updates.cover_url = null;
    }
    if (musicShareNowPlaying !== undefined && musicShareNowPlaying !== null) {
      updates.music_share_now_playing = Boolean(musicShareNowPlaying);
    }
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: "Current password is required to set a new password" });
      const ok = await bcrypt.compare(String(currentPassword), req.user.password_hash || "");
      if (!ok) return res.status(400).json({ error: "Current password is incorrect" });
      if (String(newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
      updates.password_hash = await bcrypt.hash(String(newPassword), 10);
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });
    const { data, error } = await supabase.from("users").update(updates).eq("id", req.user.id).select().maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: authUserPayload(data) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/profile/avatar", authenticate, (req, res, next) => {
  uploadImage.single("avatar")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image file provided" });
    const publicUrl = await uploadToBucket("avatars", req.file);
    const { data, error } = await supabase.from("users").update({ avatar_url: publicUrl }).eq("id", req.user.id).select().maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: authUserPayload(data) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/profile/cover", authenticate, (req, res, next) => {
  uploadImage.single("cover")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image file provided" });
    const publicUrl = await uploadToBucket("avatars", req.file);
    const { data, error } = await supabase.from("users").update({ cover_url: publicUrl }).eq("id", req.user.id).select().maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: authUserPayload(data) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function spotifyFrontendRedirect(extraQueryPairs) {
  const base = (SPOTIFY_FRONTEND_AFTER_LINK || "http://localhost:5173/music").trim();
  const hasQ = base.includes("?");
  const qs = Object.entries(extraQueryPairs)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
    .join("&");
  return `${base}${hasQ ? "&" : "?"}${qs}`;
}

// Spotify: search uses client-credentials; OAuth link + polling updates “Now Playing”.
app.get("/api/music/search", authenticate, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) return res.status(400).json({ error: "Enter at least 2 characters to search." });
  if (!SPOTIFY_CLIENT_ID) {
    return res.status(503).json({ error: "Spotify is not configured on the server." });
  }
  try {
    const tracks = await searchSpotifyTracks(q, 24);
    res.json({ tracks });
  } catch (e) {
    console.error("[music/search]", e);
    res.status(400).json({ error: e.message || "Could not search Spotify" });
  }
});

/** Friends-only “now broadcasting” summaries for Music hub (respects Spotify share gates). */
app.get("/api/music/friends-listening", authenticate, async (req, res) => {
  try {
    const meId = req.user.id;
    const friendIds = await friendIdsForUser(meId);
    if (!friendIds.length) return res.json({ friends: [] });

    const { data: rows, error } = await supabase.from("users").select("*").in("id", friendIds);
    if (error) return res.status(400).json({ error: error.message });

    const onlineSet = await presenceOnlineSetForUserIds(friendIds);
    const enriched = (rows || [])
      .map((row) => publicProfileWithPresence(row, meId, onlineSet))
      .filter(Boolean);

    enriched.sort((a, b) => {
      const aListen = Boolean(a.musicNowPlaying);
      const bListen = Boolean(b.musicNowPlaying);
      if (aListen !== bListen) return aListen ? -1 : 1;
      const aOn = Boolean(a.isOnline);
      const bOn = Boolean(b.isOnline);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    res.json({ friends: enriched });
  } catch (e) {
    console.error("[music/friends-listening]", e);
    res.status(400).json({ error: e.message || "Could not load friends" });
  }
});

app.post("/api/music/spotify/connect", authenticate, (req, res) => {
  try {
    if (!SPOTIFY_CLIENT_ID) return res.status(503).json({ error: "Spotify is not configured on the server." });
    const state = mintSpotifyOAuthState(req.user.id);
    res.json({ authorizeUrl: buildSpotifyAuthorizeUrl(state) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/music/spotify/callback", async (req, res) => {
  const fail = req.query.error;
  const code = req.query.code;
  const state = req.query.state;
  const failRedirect = spotifyFrontendRedirect({ spotify: "error", reason: typeof fail === "string" ? fail : "oauth" });

  if (fail || !code || !state) return res.redirect(302, failRedirect);

  const userId = consumeSpotifyOAuthState(String(state));
  if (!userId) return res.redirect(302, failRedirect);

  try {
    const tokens = await exchangeSpotifyCode(String(code));
    const { error } = await supabase
      .from("users")
      .update({
        spotify_refresh_token: tokens.refresh_token,
        spotify_linked_at: new Date().toISOString()
      })
      .eq("id", userId);
    if (error) throw new Error(error.message);

    const okRedirect = spotifyFrontendRedirect({ spotify: "connected" });
    return res.redirect(302, okRedirect);
  } catch (e) {
    console.error("[music/spotify/callback]", e);
    return res.redirect(302, failRedirect);
  }
});

app.post("/api/music/spotify/sync-now-playing", authenticate, async (req, res) => {
  try {
    const row = req.user;
    const refreshTok = row.spotify_refresh_token;
    if (!refreshTok) return res.status(400).json({ error: "Connect Spotify first from the Music page." });

    const { access_token } = await refreshSpotifyAccessToken(refreshTok);
    const cp = await fetchCurrentlyPlaying(access_token);
    const stored = storedNowPlayingFromSpotify(cp);

    await supabase.from("users").update({ music_now_playing: stored }).eq("id", row.id);

    const fresh = await fetchUserById(row.id);
    res.json({
      ok: true,
      musicNowPlaying: sanitizeMusicSnippet(fresh.music_now_playing),
      peerPreview: peerMusicNowPlaying(fresh)
    });
  } catch (e) {
    console.error("[music/sync]", e);
    if (String(e.message) === "SpotifyUnauthorized") {
      return res.status(401).json({ error: "Spotify login expired — reconnect Spotify in Music settings." });
    }
    res.status(400).json({ error: e.message || "Could not refresh Now Playing." });
  }
});

app.delete("/api/music/spotify", authenticate, async (req, res) => {
  const { error } = await supabase
    .from("users")
    .update({
      spotify_refresh_token: null,
      spotify_linked_at: null,
      music_now_playing: null
    })
    .eq("id", req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  const fresh = await fetchUserById(req.user.id);
  res.json({ user: authUserPayload(fresh) });
});

// Events
app.get("/api/events", authenticate, async (_, res) => {
  res.json(await fetchAllEvents());
});

app.get("/api/events/:id", authenticate, async (req, res) => {
  const event = await fetchEventWithCandidates(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(await serializeEventDetail(event, req.user.id));
});

app.post("/api/events", authenticate, requireAdmin, (req, res, next) => {
  uploadImage.single("cover")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const rules = String(req.body.rules || "").trim();
    const strategy = req.body.strategy === "weighted" ? "weighted" : "single";
    let maxVotesPerUser = Number.parseInt(String(req.body.maxVotesPerUser ?? "1"), 10);
    if (!Number.isFinite(maxVotesPerUser) || maxVotesPerUser < 0) maxVotesPerUser = 1;
    const names = String(req.body.candidatesNames || "").split(",").map((s) => s.trim()).filter(Boolean);
    const urls = String(req.body.candidateImageUrls || "").split(",").map((s) => s.trim());
    if (names.length < 2) return res.status(400).json({ error: "At least two candidate names are required." });

    let cover_image_url = null;
    if (req.file) cover_image_url = await uploadToBucket("events", req.file);

    const id = `e${Date.now().toString(36)}`;
    const { error: eventErr } = await supabase.from("events").insert({
      id, title, description, rules, status: "open", strategy,
      max_votes_per_user: maxVotesPerUser, cover_image_url
    });
    if (eventErr) return res.status(400).json({ error: eventErr.message });

    const candidates = names.map((name, index) => ({
      id: `c${Date.now().toString(36)}-${index}`,
      event_id: id,
      name,
      image_url: urls[index] || null,
      position: index
    }));
    const { error: candErr } = await supabase.from("candidates").insert(candidates);
    if (candErr) return res.status(400).json({ error: candErr.message });

    const { data: subscriberUsers } = await supabase.from("users").select("id");
    for (const u of subscriberUsers || []) {
      await bumpAggregatedNotification({
        userId: u.id,
        sourceKey: `events:inbox:${u.id}`,
        kind: "event",
        textForCount: (n) => `🗓️ (${n}) new event${n === 1 ? "" : "s"} · open Events`,
        linkPath: "/events"
      });
    }

    res.status(201).json(await fetchEventWithCandidates(id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/events/vote", authenticate, async (req, res) => {
  try {
    const { eventId, candidateId, weight = 1 } = req.body || {};
    const userId = req.user.id;
    const { data: event } = await supabase.from("events").select("*").eq("id", eventId).maybeSingle();
    if (!event || event.status !== "open") return res.status(400).json({ error: "Event closed" });
    const maxVotes = typeof event.max_votes_per_user === "number" ? event.max_votes_per_user : 1;
    const { count } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_id", eventId);
    if (maxVotes > 0 && (count || 0) >= maxVotes) return res.status(400).json({ error: "You have reached the vote limit for this event" });
    const id = `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const { error } = await supabase.from("votes").insert({ id, user_id: userId, event_id: eventId, candidate_id: candidateId, weight });
    if (error) return res.status(400).json({ error: error.message });
    await broker.publish("vote.cast", { userId, eventId, candidateId });
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/events/:id/tally", authenticate, async (req, res) => {
  const event = await fetchEventWithCandidates(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(await tallyEvent(event));
});

// Community
app.get("/api/community/posts", authenticate, async (req, res) => {
  const { data: posts } = await supabase.from("posts").select("*").order("created_at", { ascending: false });
  const out = [];
  for (const p of posts || []) out.push(await serializePost(p, req.user.id));
  res.json(out);
});

app.post("/api/community/posts", authenticate, (req, res, next) => {
  uploadImage.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (!content && !req.file) return res.status(400).json({ error: "Add text or an image to your post" });
    let image_url = null;
    if (req.file) image_url = await uploadToBucket("posts", req.file);
    const id = `p${Date.now().toString(36)}`;
    const { data: post, error } = await supabase.from("posts").insert({
      id, author_id: req.user.id, content, image_url
    }).select().maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    await broker.publish("post.created", { id: post.id });
    await notifyMentions(content, `a community post by ${req.user.name}`, req.user.id, `/community?post=${encodeURIComponent(id)}`);
    res.status(201).json(await serializePost(post, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/community/posts/:id/share", authenticate, async (req, res) => {
  try {
    const sourceId = String(req.params.id || "");
    const content = String(req.body?.content || "").trim().slice(0, 2000);
    const { data: source } = await supabase.from("posts").select("*").eq("id", sourceId).maybeSingle();
    if (!source) return res.status(404).json({ error: "Post not found" });

    const shared_post_id = source.shared_post_id || source.id;
    const id = `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: post, error } = await supabase
      .from("posts")
      .insert({
        id,
        author_id: req.user.id,
        content,
        image_url: null,
        shared_post_id
      })
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });

    await broker.publish("post.created", { id: post.id, sharedPostId: shared_post_id });
    await notifyMentions(content, `a shared post by ${req.user.name}`, req.user.id, `/community?post=${encodeURIComponent(id)}`);
    if (source.author_id && source.author_id !== req.user.id) {
      await insertNotification({
        userId: source.author_id,
        text: `${req.user.name} shared your post`,
        kind: "share_post",
        linkPath: `/community?post=${encodeURIComponent(id)}`
      });
    }

    res.status(201).json(await serializePost(post, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Stories (24h; visible to friends + author)
app.get("/api/stories", authenticate, async (req, res) => {
  try {
    const out = await buildStoryRings(req.user.id);
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stories", authenticate, (req, res, next) => {
  uploadImage.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const rawVisibility = String(req.body?.visibility || "friends").trim();
    const visibility = ["public", "friends", "only me"].includes(rawVisibility) ? rawVisibility : "friends";

    if (!text && !req.file) {
      return res.status(400).json({ error: "Add text or a photo to your story" });
    }
    let media_url = null;
    if (req.file) media_url = await uploadToBucket("posts", req.file);
    const id = `st${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    /** @type {Record<string, unknown>} */
    const insertRow = {
      id,
      user_id: req.user.id,
      body_text: text || "",
      media_url,
      visibility
    };

    let row = null;
    let error = null;

    const firstTry = await supabase.from("user_stories").insert(insertRow).select().maybeSingle();
    if (firstTry.error && (firstTry.error.message.includes("visibility") || firstTry.error.code === "P0002" || String(firstTry.error.message).includes("does not exist"))) {
      // Fallback for database migration lag
      const { visibility: _, ...fallbackRow } = insertRow;
      const fallbackResult = await supabase.from("user_stories").insert(fallbackRow).select().maybeSingle();
      row = fallbackResult.data;
      error = fallbackResult.error;
    } else {
      row = firstTry.data;
      error = firstTry.error;
    }

    if (error) return res.status(400).json({ error: error.message });

    /** @type {Record<string, unknown>} */
    const storyOut = {
      id: row.id,
      text: row.body_text || "",
      imageUrl: row.media_url || null,
      visibility: row.visibility || "friends",
      spotifyTrackId: null,
      musicTitle: null,
      musicArtist: null,
      musicImageUrl: null,
      musicPreviewUrl: null,
      musicExternalUrl: null,
      createdAt: row.created_at,
      viewed: true,
      reactionBreakdown: {},
      myReaction: null,
      reactionCount: 0,
      commentCount: 0,
      viewerCount: 0
    };
    res.status(201).json({ story: storyOut });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stories/:storyId/view", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const { data: story } = await supabase.from("user_stories").select("*").eq("id", storyId).maybeSingle();
    if (!story) return res.status(404).json({ error: "Story not found" });
    const cutoff = new Date(Date.now() - STORY_TTL_MS).toISOString();
    if (story.created_at < cutoff) return res.status(410).json({ error: "Story expired" });
    const owner = story.user_id;
    if (owner === me) return res.json({ ok: true });
    const okFriend = await areFriends(me, owner);
    if (!okFriend) return res.status(403).json({ error: "Not allowed" });
    const { error } = await supabase.from("story_views").upsert(
      { story_id: storyId, viewer_id: me },
      { onConflict: "story_id,viewer_id" }
    );
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stories/:storyId/react", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const requested = String(req.body?.reaction || "like").toLowerCase();
    const wantClear = req.body?.reaction === null || req.body?.reaction === "";
    const reaction = ALLOWED_REACTIONS.includes(requested) ? requested : "like";

    const acc = await storyFriendAccess(storyId, me);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.msg });
    if (acc.story.user_id === me) return res.status(403).json({ error: "You can't react to your own story" });

    const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", cry: "😭", angry: "😡" };

    if (wantClear) {
      await supabase.from("story_reactions").delete().eq("story_id", storyId).eq("user_id", me);
    } else {
      const { data: existingRow } = await supabase
        .from("story_reactions")
        .select("story_id")
        .eq("story_id", storyId)
        .eq("user_id", me)
        .maybeSingle();
      const wasNew = !existingRow;
      if (existingRow) {
        await supabase.from("story_reactions").update({ reaction }).eq("story_id", storyId).eq("user_id", me);
      } else {
        await supabase.from("story_reactions").insert({ story_id: storyId, user_id: me, reaction });
      }
      if (wasNew) {
        await insertNotification({
          userId: acc.story.user_id,
          text: `${req.user.name} reacted ${labelEmoji[reaction] || "👍"} to your story`,
          kind: "story_reaction",
          badgeCount: 1,
          linkPath: "/messages"
        });
      }
    }

    const { data: rxRows } = await supabase.from("story_reactions").select("story_id, user_id, reaction").eq("story_id", storyId);
    const bag = { breakdown: {}, myReaction: null };
    for (const row of rxRows || []) {
      const type = ALLOWED_REACTIONS.includes(row.reaction) ? row.reaction : "like";
      bag.breakdown[type] = (bag.breakdown[type] || 0) + 1;
      if (row.user_id === me) bag.myReaction = type;
    }
    const reactionCount = Object.values(bag.breakdown).reduce((a, b) => a + b, 0);

    res.json({
      reactionBreakdown: bag.breakdown,
      myReaction: bag.myReaction,
      reactionCount
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/stories/:storyId/reactors", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const acc = await storyFriendAccess(storyId, me);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.msg });
    const { data: rows } = await supabase.from("story_reactions").select("user_id, reaction").eq("story_id", storyId);
    const breakdown = await reactorsBreakdownFromRows(rows || []);
    res.json({ breakdown });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/stories/:storyId/viewers", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const acc = await storyFriendAccess(storyId, me);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.msg });
    if (acc.story.user_id !== me) return res.status(403).json({ error: "Only the story owner can see who viewed" });

    const { data: viewRows } = await supabase
      .from("story_views")
      .select("viewer_id, viewed_at")
      .eq("story_id", storyId)
      .order("viewed_at", { ascending: false });

    const viewerIds = [...new Set((viewRows || []).map((v) => v.viewer_id))];
    const { data: users } = viewerIds.length
      ? await supabase.from("users").select("id, name, avatar_url").in("id", viewerIds)
      : { data: [] };
    const um = new Map((users || []).map((u) => [u.id, u]));

    const viewers = (viewRows || []).map((row) => {
      const u = um.get(row.viewer_id);
      return {
        userId: row.viewer_id,
        name: u?.name || "Unknown",
        avatarUrl: u?.avatar_url || null,
        viewedAt: row.viewed_at
      };
    });

    res.json({ viewers });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/stories/:storyId/comments", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const acc = await storyFriendAccess(storyId, me);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.msg });

    const { data: rows } = await supabase
      .from("story_comments")
      .select("*")
      .eq("story_id", storyId)
      .order("created_at", { ascending: true });

    const authorIds = [...new Set((rows || []).map((r) => r.author_id))];
    const { data: users } = authorIds.length
      ? await supabase.from("users").select("id, name, avatar_url").in("id", authorIds)
      : { data: [] };
    const um = new Map((users || []).map((u) => [u.id, u]));

    const comments = (rows || []).map((row) => {
      const u = um.get(row.author_id);
      return {
        id: row.id,
        text: row.content || "",
        authorId: row.author_id,
        authorName: u?.name || "Unknown",
        authorAvatar: u?.avatar_url || null,
        createdAt: row.created_at
      };
    });

    res.json({ comments });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/stories/:storyId/comments", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const raw = String(req.body?.text ?? "").trim();
    if (!raw) return res.status(400).json({ error: "Comment cannot be empty" });
    if (raw.length > 2000) return res.status(400).json({ error: "Comment is too long (max 2000 characters)" });

    const acc = await storyFriendAccess(storyId, me);
    if (!acc.ok) return res.status(acc.status).json({ error: acc.msg });

    const id = `sc${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const { error } = await supabase.from("story_comments").insert({
      id,
      story_id: storyId,
      author_id: me,
      content: raw
    });
    if (error) return res.status(400).json({ error: error.message });

    if (acc.story.user_id && acc.story.user_id !== me) {
      await insertNotification({
        userId: acc.story.user_id,
        text: `${req.user.name} commented on your story`,
        kind: "story_comment",
        badgeCount: 1,
        linkPath: "/messages"
      });
    }

    const comment = {
      id,
      text: raw,
      authorId: me,
      authorName: req.user.name,
      authorAvatar: req.user.avatar_url || null,
      createdAt: new Date().toISOString()
    };
    res.status(201).json({ comment });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/stories/:storyId", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const storyId = req.params.storyId;
    const { data: story } = await supabase.from("user_stories").select("id, user_id").eq("id", storyId).maybeSingle();
    if (!story) return res.status(404).json({ error: "Story not found" });
    if (story.user_id !== me) return res.status(403).json({ error: "Not allowed" });
    const { error } = await supabase.from("user_stories").delete().eq("id", storyId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/community/posts/:id/react", authenticate, async (req, res) => {
  const post_id = req.params.id;
  const requested = String(req.body?.reaction || "like").toLowerCase();
  // If the client sends an empty string we treat it as "remove my reaction".
  const wantClear = req.body?.reaction === null || req.body?.reaction === "";
  const reaction = ALLOWED_REACTIONS.includes(requested) ? requested : "like";

  const { data: existing } = await supabase
    .from("post_reactions")
    .select("*")
    .eq("post_id", post_id)
    .eq("user_id", req.user.id)
    .maybeSingle();

  let action = "none";
  if (existing) {
    if (wantClear || existing.reaction === reaction) {
      await supabase.from("post_reactions").delete().eq("post_id", post_id).eq("user_id", req.user.id);
      action = "removed";
    } else {
      await supabase
        .from("post_reactions")
        .update({ reaction })
        .eq("post_id", post_id)
        .eq("user_id", req.user.id);
      action = "changed";
    }
  } else if (!wantClear) {
    await supabase.from("post_reactions").insert({ post_id, user_id: req.user.id, reaction });
    action = "added";
  }

  const { data: post } = await supabase.from("posts").select("*").eq("id", post_id).maybeSingle();
  if (!post) return res.status(404).json({ error: "Post not found" });

  // Notify the post author when someone newly reacts (not themselves, not toggle-off, not change)
  if (action === "added" && post.author_id && post.author_id !== req.user.id) {
    const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", cry: "😭", angry: "😡" };
    await supabase.from("notifications").insert({
      id: `n${Date.now()}-${post.author_id}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: post.author_id,
      text: `${req.user.name} reacted ${labelEmoji[reaction] || "👍"} to your post`,
      kind: "reaction_post",
      badge_count: 1,
      source_key: null,
      link_path: `/community?post=${encodeURIComponent(post_id)}`,
      read: false
    });
  }

  res.json(await serializePost(post, req.user.id));
});

// Create a comment (or reply). Accepts multipart form data so users can attach
// a photo alongside text. Either text or an image is required.
app.post(
  "/api/community/posts/:id/comments",
  authenticate,
  (req, res, next) => {
    uploadImage.single("image")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || "Upload failed" });
      next();
    });
  },
  async (req, res) => {
  try {
    const post_id = req.params.id;
    const text = String(req.body?.text || "").trim();
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;

    let image_url = null;
    if (req.file) image_url = await uploadToBucket("posts", req.file);

    if (!text && !image_url) return res.status(400).json({ error: "Comment text or photo is required" });

    // Validate parent belongs to the same post (prevents replies attaching to other posts)
    if (parentId) {
      const { data: parent } = await supabase
        .from("post_comments")
        .select("id, post_id")
        .eq("id", parentId)
        .maybeSingle();
      if (!parent || parent.post_id !== post_id) {
        return res.status(400).json({ error: "Parent comment not found on this post" });
      }
    }

    const id = `cm${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const { error } = await supabase
      .from("post_comments")
      .insert({ id, post_id, author_id: req.user.id, content: text || "", parent_id: parentId, image_url });
    if (error) return res.status(400).json({ error: error.message });
    const { data: post } = await supabase.from("posts").select("*").eq("id", post_id).maybeSingle();

    // Notifications: replies only notify the replied-to comment author —
    // not every top-level comment on someone else's post.
    const notes = [];
    if (parentId) {
      const { data: parent } = await supabase
        .from("post_comments")
        .select("author_id")
        .eq("id", parentId)
        .maybeSingle();
      if (parent?.author_id && parent.author_id !== req.user.id) {
        notes.push({
          id: `n${Date.now()}-${parent.author_id}-${Math.random().toString(36).slice(2, 6)}`,
          user_id: parent.author_id,
          text: `${req.user.name} replied to your comment`,
          kind: "reply_comment",
          badge_count: 1,
          source_key: null,
          link_path: `/community?post=${encodeURIComponent(post_id)}&comment=${encodeURIComponent(parentId)}`,
          read: false
        });
      }
    }
    if (notes.length) await supabase.from("notifications").insert(notes);
    const mentionLink =
      `/community?post=${encodeURIComponent(post_id)}${parentId ? `&comment=${encodeURIComponent(parentId)}` : ""}`;
    await notifyMentions(text, parentId ? `a reply by ${req.user.name}` : `a comment by ${req.user.name}`, req.user.id, mentionLink);

    res.status(201).json({ comment: { id, text, author: req.user.name, parentId }, post: await serializePost(post, req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// React to a comment / reply (Facebook-style multi-emoji). Mirrors post reactions.
app.post("/api/community/comments/:id/react", authenticate, async (req, res) => {
  const commentId = req.params.id;
  const me = req.user.id;
  const wantClear = req.body?.reaction === null || req.body?.reaction === "";
  const requested = String(req.body?.reaction || "like").toLowerCase();
  const reaction = ALLOWED_REACTIONS.includes(requested) ? requested : "like";

  const { data: comment } = await supabase.from("post_comments").select("*").eq("id", commentId).maybeSingle();
  if (!comment) return res.status(404).json({ error: "Comment not found" });

  const { data: existing } = await supabase
    .from("comment_reactions")
    .select("*")
    .eq("comment_id", commentId)
    .eq("user_id", me)
    .maybeSingle();

  let action = "none";
  if (existing) {
    if (wantClear || existing.reaction === reaction) {
      await supabase.from("comment_reactions").delete().eq("comment_id", commentId).eq("user_id", me);
      action = "removed";
    } else {
      await supabase.from("comment_reactions").update({ reaction }).eq("comment_id", commentId).eq("user_id", me);
      action = "changed";
    }
  } else if (!wantClear) {
    await supabase.from("comment_reactions").insert({ comment_id: commentId, user_id: me, reaction });
    action = "added";
  }

  const { data: post } = await supabase.from("posts").select("*").eq("id", comment.post_id).maybeSingle();
  const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", cry: "😭", angry: "😡" };

  if (action === "added" && comment.author_id && comment.author_id !== me) {
    await supabase.from("notifications").insert({
      id: `n${Date.now()}-${comment.author_id}-${Math.random().toString(36).slice(2, 6)}`,
      user_id: comment.author_id,
      text: `${req.user.name} reacted ${labelEmoji[reaction] || "👍"} to your comment`,
      kind: "reaction_comment",
      badge_count: 1,
      source_key: null,
      link_path: `/community?post=${encodeURIComponent(comment.post_id)}&comment=${encodeURIComponent(commentId)}`,
      read: false
    });
  }

  res.json(await serializePost(post, me));
});

// Delete a comment. The original author can always delete; admins can delete
// any comment. Replies cascade via FK ON DELETE CASCADE. Returns the updated post.
app.delete("/api/community/comments/:id", authenticate, async (req, res) => {
  const commentId = req.params.id;
  const me = req.user.id;
  const isAdmin = req.user.role === "admin";
  const { data: comment } = await supabase
    .from("post_comments")
    .select("id, post_id, author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  if (!isAdmin && comment.author_id !== me) {
    return res.status(403).json({ error: "Only the author can delete this comment" });
  }
  await supabase.from("comment_reactions").delete().eq("comment_id", commentId);
  await supabase.from("post_comments").delete().eq("id", commentId);
  const { data: post } = await supabase.from("posts").select("*").eq("id", comment.post_id).maybeSingle();
  res.json(await serializePost(post, me));
});

// Dashboards
app.get("/api/dashboard/student", authenticate, async (req, res) => {
  const [{ count: openEvents }, { count: voteCount }, { count: postCount }, { data: upcoming }] = await Promise.all([
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("votes").select("id", { count: "exact", head: true }).eq("user_id", req.user.id),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_id", req.user.id),
    supabase.from("events").select("*").eq("status", "open").limit(5)
  ]);
  res.json({
    profile: authUserPayload(req.user),
    metrics: {
      openEvents: openEvents || 0,
      participatedEvents: voteCount || 0,
      totalPosts: postCount || 0
    },
    upcomingEvents: (upcoming || []).map((e) => toEvent(e, []))
  });
});

app.get("/api/dashboard/admin", authenticate, requireAdmin, async (req, res) => {
  const [{ count: students }, { count: events }, { count: votes }, { count: announcements }, { data: recentVotes }] = await Promise.all([
    supabase.from("users").select("id", { count: "exact", head: true }).eq("role", "student"),
    supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("votes").select("id", { count: "exact", head: true }),
    supabase.from("announcements").select("id", { count: "exact", head: true }),
    supabase.from("votes").select("*").order("created_at", { ascending: false }).limit(10)
  ]);
  res.json({
    profile: authUserPayload(req.user),
    metrics: {
      registeredStudents: students || 0,
      activeEvents: events || 0,
      totalVotes: votes || 0,
      announcements: announcements || 0
    },
    recentVotes: recentVotes || []
  });
});

// Announcements + notifications
app.get("/api/announcements", authenticate, async (_, res) => {
  const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
  res.json((data || []).map((a) => ({ id: a.id, title: a.title, message: a.message, createdAt: a.created_at })));
});

app.post("/api/announcements", authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, message } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: "title and message are required" });
    const id = `an${Date.now().toString(36)}`;
    const { error } = await supabase.from("announcements").insert({ id, title, message });
    if (error) return res.status(400).json({ error: error.message });
    const { data: users } = await supabase.from("users").select("id");
    for (const u of users || []) {
      await bumpAggregatedNotification({
        userId: u.id,
        sourceKey: `announcements:inbox:${u.id}`,
        kind: "announcement",
        textForCount: (n) => `📢 (${n}) new announcement${n === 1 ? "" : "s"} · open Notifications`,
        linkPath: "/announcements"
      });
    }
    await broker.publish("announcement.created", { id, title });
    res.status(201).json({ id, title, message, createdAt: new Date().toISOString() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/announcements/:id", authenticate, requireAdmin, async (req, res) => {
  const { error } = await supabase.from("announcements").delete().eq("id", req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// ==========================================================================
// Admin moderation endpoints
// ==========================================================================

// List every user (admins only)
app.get("/api/admin/users", authenticate, requireAdmin, async (_, res) => {
  const result = await usersSelectOmitMissingColumns(
    async (cols) =>
      await supabase.from("users").select(cols).order("created_at", { ascending: false }),
    USER_ADMIN_LIST_SELECT_DEFAULT
  );
  const { data, error } = result;
  if (error) return res.status(400).json({ error: error.message });
  res.json(
    (data || []).map((u) => ({
      ...toPublicUser(u),
      availability: sanitizeAvailability(u.availability),
      createdAt: u.created_at
    }))
  );
});

// Delete a user and all of their data (admins only)
app.delete("/api/admin/users/:id", authenticate, requireAdmin, async (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: "You cannot delete your own admin account" });
  const target = await fetchUserById(id);
  if (!target) return res.status(404).json({ error: "User not found" });

  // Wipe everything authored by / about this user. Order matters because of FKs.
  const { data: userPosts } = await supabase.from("posts").select("id").eq("author_id", id);
  const postIds = (userPosts || []).map((p) => p.id);
  if (postIds.length) {
    await supabase.from("post_reactions").delete().in("post_id", postIds);
    await supabase.from("post_comments").delete().in("post_id", postIds);
  }
  await supabase.from("posts").delete().eq("author_id", id);
  await supabase.from("post_reactions").delete().eq("user_id", id);
  await supabase.from("comment_reactions").delete().eq("user_id", id);
  await supabase.from("post_comments").delete().eq("author_id", id);
  await supabase.from("messages").delete().or(`from_user_id.eq.${id},to_user_id.eq.${id}`);
  await supabase.from("friends").delete().or(`user_id.eq.${id},friend_id.eq.${id}`);
  await supabase.from("notifications").delete().eq("user_id", id);
  await supabase.from("votes").delete().eq("user_id", id);
  await supabase.from("conversation_members").delete().eq("user_id", id);

  const { error } = await supabase.from("users").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// Delete an event and all dependent rows (admins only)
app.delete("/api/events/:id", authenticate, requireAdmin, async (req, res) => {
  const id = req.params.id;
  await supabase.from("votes").delete().eq("event_id", id);
  await supabase.from("candidates").delete().eq("event_id", id);
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// Delete a community post. Admins can delete any post; regular users can only delete their own.
app.delete("/api/community/posts/:id", authenticate, async (req, res) => {
  const id = req.params.id;
  const { data: post } = await supabase.from("posts").select("*").eq("id", id).maybeSingle();
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (req.user.role !== "admin" && post.author_id !== req.user.id) {
    return res.status(403).json({ error: "You can only delete your own posts" });
  }
  await supabase.from("post_reactions").delete().eq("post_id", id);
  await supabase.from("post_comments").delete().eq("post_id", id);
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.get("/api/notifications", authenticate, async (req, res) => {
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  res.json(
    (data || []).map((n) => ({
      id: n.id,
      text: n.text,
      read: n.read,
      badgeCount: typeof n.badge_count === "number" ? n.badge_count : 1,
      kind: n.kind || "general",
      createdAt: n.created_at,
      linkPath: n.link_path || null,
      sourceKey: n.source_key || null
    }))
  );
});

app.post("/api/notifications/read-all", authenticate, async (req, res) => {
  const { error } = await supabase
    .from("notifications")
    .update({ read: true })
    .eq("user_id", req.user.id)
    .eq("read", false);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/** Delete every notification for the current user (bell list clear). */
app.delete("/api/notifications", authenticate, async (req, res) => {
  const { error } = await supabase.from("notifications").delete().eq("user_id", req.user.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/notifications/:notificationId", authenticate, async (req, res) => {
  const notificationId = req.params.notificationId;
  const { data: row } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("user_id", req.user.id)
    .maybeSingle();
  if (!row) return res.status(404).json({ error: "Notification not found" });
  const { error } = await supabase.from("notifications").delete().eq("id", notificationId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// Random anonymous "Userphone" chat (same app users, masked as Anonymous)
app.get("/api/userphone/state", authenticate, async (req, res) => {
  res.json(await buildUserphoneState(req.user.id));
});

app.post("/api/userphone/start", authenticate, async (req, res) => {
  const me = req.user.id;
  const existing = await fetchActiveUserphoneSession(me);
  if (existing) {
    if (existing.bridge_conversation_a || existing.bridge_conversation_b) {
      return res.status(400).json({
        error: "You’re connected via group Userphone. End it in that group first.",
        code: "USERPHONE_BRIDGE_ACTIVE"
      });
    }
    return res.json(await buildUserphoneState(me));
  }
  await convWaitingDeleteByQueuedUserId(me);
  const { data: waitRow } = await supabase.from("anon_userphone_waiting").select("user_id").eq("user_id", me).maybeSingle();
  if (!waitRow) {
    const { error } = await supabase.from("anon_userphone_waiting").insert({ user_id: me });
    if (error) return res.status(400).json({ error: error.message });
  }
  await tryPairUserphoneUsers(me);
  res.json(await buildUserphoneState(me));
});

app.delete("/api/userphone/waiting", authenticate, async (req, res) => {
  await supabase.from("anon_userphone_waiting").delete().eq("user_id", req.user.id);
  res.json({ success: true });
});

app.post("/api/userphone/end", authenticate, async (req, res) => {
  const me = req.user.id;
  const session = await fetchActiveUserphoneSession(me);
  if (!session) return res.json({ success: true });
  await supabase.from("anon_userphone_sessions").update({ ended_at: new Date().toISOString() }).eq("id", session.id);
  res.json({ success: true });
});

app.post("/api/userphone/switch", authenticate, async (req, res) => {
  const me = req.user.id;
  const session = await fetchActiveUserphoneSession(me);
  if (session) {
    if (session.bridge_conversation_a || session.bridge_conversation_b) {
      return res.status(400).json({
        error: "Switch isn’t available during group Userphone. End the bridge in the group first.",
        code: "USERPHONE_BRIDGE_ACTIVE"
      });
    }
    await supabase.from("anon_userphone_sessions").update({ ended_at: new Date().toISOString() }).eq("id", session.id);
  }
  await supabase.from("anon_userphone_waiting").delete().eq("user_id", me);
  const { error } = await supabase.from("anon_userphone_waiting").insert({ user_id: me });
  if (error) return res.status(400).json({ error: error.message });
  await tryPairUserphoneUsers(me);
  res.json(await buildUserphoneState(me));
});

app.post("/api/userphone/:sessionId/messages", authenticate, async (req, res) => {
  const me = req.user.id;
  const sessionId = req.params.sessionId;
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message text is required" });
  const session = await fetchActiveSoloUserphoneSession(me);
  if (!session || session.id !== sessionId) {
    return res.status(400).json({ error: "No active anonymous call" });
  }
  if (session.participant_a !== me && session.participant_b !== me) {
    return res.status(403).json({ error: "Not in this session" });
  }
  const id = `upm${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: row, error } = await supabase
    .from("anon_userphone_messages")
    .insert({ id, session_id: sessionId, from_user_id: me, text })
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  const [msg] = serializeUserphoneMessages([row], me);
  res.status(201).json({ message: msg });
});

/** Ask SiglaCast AI inside a matched 1-on-1 Userphone — shows as “SiglaCast AI” bubbles for both users. */
app.post("/api/userphone/:sessionId/messages/sigla-ai", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const sessionId = req.params.sessionId;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Message text is required" });
    const session = await fetchActiveSoloUserphoneSession(me);
    if (!session || session.id !== sessionId) {
      return res.status(400).json({ error: "No active anonymous call" });
    }
    if (session.participant_a !== me && session.participant_b !== me) {
      return res.status(403).json({ error: "Not in this session" });
    }

    const upId = `upm${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { error: upErr } = await supabase
      .from("anon_userphone_messages")
      .insert({ id: upId, session_id: sessionId, from_user_id: me, text });
    if (upErr) return res.status(400).json({ error: upErr.message });

    const { data: anonRows } = await supabase
      .from("anon_userphone_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    const transcript = anonUserphoneRowsToGroqTurns(anonRows || [], me);

    const g = await groqCompletion(buildSiglaContextualPrompt(req.user), transcript);
    if (g.error) return res.status(502).json({ error: g.error });

    const aiId = `upm${Date.now()}-sigla-${Math.random().toString(36).slice(2, 8)}`;
    const { error: aiErr } = await supabase.from("anon_userphone_messages").insert({
      id: aiId,
      session_id: sessionId,
      from_user_id: SIGLACAST_AI_USER_ID,
      text: g.reply
    });
    if (aiErr) return res.status(400).json({ error: aiErr.message });

    res.json(await buildUserphoneState(me));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Messaging + friends
app.get("/api/users/search", authenticate, async (req, res) => {
  const me = req.user.id;
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  /** Strip LIKE wildcards from `q` so we match a literal substring. */
  const cleaned = q.replace(/[%_\\]/g, "").trim();
  if (!cleaned) return res.json([]);
  const pattern = `%${cleaned}%`;
  const [byName, byEmail, byCourse] = await usersSelectOmitMissingColumns(async (cols) => {
    return Promise.all([
      supabase.from("users").select(cols).neq("id", me).neq("id", SIGLACAST_AI_USER_ID).ilike("name", pattern).limit(12),
      supabase.from("users").select(cols).neq("id", me).neq("id", SIGLACAST_AI_USER_ID).ilike("email", pattern).limit(12),
      supabase.from("users").select(cols).neq("id", me).neq("id", SIGLACAST_AI_USER_ID).ilike("course", pattern).limit(12)
    ]);
  }, USER_SEARCH_SELECT_DEFAULT);
  const firstErr = [byName, byEmail, byCourse].find((r) => r.error)?.error;
  if (firstErr) return res.status(400).json({ error: firstErr.message });

  const byId = new Map();
  for (const row of [...(byName.data || []), ...(byEmail.data || []), ...(byCourse.data || [])]) {
    byId.set(row.id, row);
  }
  const rows = [...byId.values()].slice(0, 12);
  if (!rows.length) return res.json([]);

  const ids = rows.map((u) => u.id);
  const [{ data: friendsRows }, { data: toMeReqs }, { data: fromMeReqs }] = await Promise.all([
    supabase.from("friends").select("user_id, friend_id").or(`user_id.eq.${me},friend_id.eq.${me}`),
    supabase.from("friend_requests").select("id, from_user_id").eq("to_user_id", me).in("from_user_id", ids),
    supabase.from("friend_requests").select("id, to_user_id").eq("from_user_id", me).in("to_user_id", ids)
  ]);

  const friendIdSet = new Set();
  for (const f of friendsRows || []) {
    friendIdSet.add(f.user_id === me ? f.friend_id : f.user_id);
  }
  const incomingByFrom = new Map((toMeReqs || []).map((r) => [r.from_user_id, r.id]));
  const outgoingToSet = new Set((fromMeReqs || []).map((r) => r.to_user_id));
  const onlineSet = await presenceOnlineSetForUserIds(ids);

  const out = [];
  for (const u of rows) {
    out.push({
      ...publicProfileWithPresence(u, me, onlineSet),
      isFriend: friendIdSet.has(u.id),
      incomingRequestId: incomingByFrom.get(u.id) || null,
      outgoingRequestPending: outgoingToSet.has(u.id)
    });
  }
  res.json(out);
});

app.get("/api/users/discover", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const result = await usersSelectOmitMissingColumns(async (cols) => {
      return supabase.from("users").select(cols).neq("id", me).neq("id", SIGLACAST_AI_USER_ID);
    }, USER_SEARCH_SELECT_DEFAULT);

    if (result.error) return res.status(400).json({ error: result.error.message });
    const users = result.data || [];
    if (!users.length) return res.json({ online: [], others: [] });

    const ids = users.map((u) => u.id);
    const [{ data: friendsRows }, { data: toMeReqs }, { data: fromMeReqs }] = await Promise.all([
      supabase.from("friends").select("user_id, friend_id").or(`user_id.eq.${me},friend_id.eq.${me}`),
      supabase.from("friend_requests").select("id, from_user_id").eq("to_user_id", me).in("from_user_id", ids),
      supabase.from("friend_requests").select("id, to_user_id").eq("from_user_id", me).in("to_user_id", ids)
    ]);

    const friendIdSet = new Set();
    for (const f of friendsRows || []) {
      friendIdSet.add(f.user_id === me ? f.friend_id : f.user_id);
    }
    const incomingByFrom = new Map((toMeReqs || []).map((r) => [r.from_user_id, r.id]));
    const outgoingToSet = new Set((fromMeReqs || []).map((r) => r.to_user_id));
    const onlineSet = await presenceOnlineSetForUserIds(ids);

    const decorated = users.map((u) => ({
      ...publicProfileWithPresence(u, me, onlineSet),
      isFriend: friendIdSet.has(u.id),
      incomingRequestId: incomingByFrom.get(u.id) || null,
      outgoingRequestPending: outgoingToSet.has(u.id)
    }));

    const online = decorated.filter((u) => u.presence?.online);
    const others = decorated.filter((u) => !u.presence?.online);

    const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

    res.json({
      online: shuffle(online),
      others: shuffle(others)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Public-ish profile card for avatar popovers (Community, message bubbles). Mirror search-row friend flags. */
app.get("/api/users/:userId", authenticate, async (req, res) => {
  const me = req.user.id;
  const targetId = req.params.userId;
  if (!targetId) return res.status(400).json({ error: "Missing user id" });
  if (targetId === SIGLACAST_AI_USER_ID || targetId === USERPHONE_GUEST_ID) {
    return res.status(404).json({ error: "User not found" });
  }
  const row = await fetchUserById(targetId);
  if (!row) return res.status(404).json({ error: "User not found" });

  const onlineSet = await presenceOnlineSetForUserIds([targetId]);

  let isFriend = false;
  let incomingRequestId = null;
  let outgoingRequestPending = false;

  if (me !== targetId) {
    isFriend = await areFriends(me, targetId);
    const [{ data: toMeReq }, { data: fromMeReq }] = await Promise.all([
      supabase.from("friend_requests").select("id").eq("to_user_id", me).eq("from_user_id", targetId).maybeSingle(),
      supabase.from("friend_requests").select("id").eq("from_user_id", me).eq("to_user_id", targetId).maybeSingle()
    ]);
    incomingRequestId = toMeReq?.id || null;
    outgoingRequestPending = Boolean(fromMeReq?.id);
  }

  const profile = {
    ...publicProfileWithPresence(row, me, onlineSet),
    isFriend,
    incomingRequestId,
    outgoingRequestPending
  };
  res.json(profile);
});

app.get("/api/friend-requests", authenticate, async (req, res) => {
  const me = req.user.id;
  const { data: rows } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("to_user_id", me)
    .order("created_at", { ascending: false });
  const fromIds = [...new Set((rows || []).map((r) => r.from_user_id))];
  if (!fromIds.length) return res.json([]);
  const { data: users } = await supabase.from("users").select("*").in("id", fromIds);
  const userMap = new Map((users || []).map((u) => [u.id, u]));
  const onlineSet = await presenceOnlineSetForUserIds(fromIds);
  res.json(
    (rows || []).map((r) => ({
      id: r.id,
      from: publicProfileWithPresence(userMap.get(r.from_user_id), me, onlineSet),
      createdAt: r.created_at
    }))
  );
});

app.post("/api/friend-requests/:requestId/accept", authenticate, async (req, res) => {
  const me = req.user.id;
  const { data: row } = await supabase.from("friend_requests").select("*").eq("id", req.params.requestId).maybeSingle();
  if (!row || row.to_user_id !== me) return res.status(404).json({ error: "Request not found" });
  if (await areFriends(me, row.from_user_id)) {
    await supabase.from("friend_requests").delete().eq("id", row.id);
    const buddy = await fetchUserById(row.from_user_id);
    return res.json({ friend: toPublicUser(buddy) });
  }
  const fid = `fr${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const { error } = await supabase.from("friends").insert({
    id: fid,
    user_id: row.from_user_id,
    friend_id: row.to_user_id
  });
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from("friend_requests").delete().eq("id", row.id);
  const buddy = await fetchUserById(row.from_user_id);
  res.json({ friend: toPublicUser(buddy) });
});

app.delete("/api/friend-requests/:requestId", authenticate, async (req, res) => {
  const me = req.user.id;
  const { data: row } = await supabase.from("friend_requests").select("*").eq("id", req.params.requestId).maybeSingle();
  if (!row) return res.status(404).json({ error: "Request not found" });
  if (row.to_user_id !== me && row.from_user_id !== me) {
    return res.status(403).json({ error: "Not allowed" });
  }
  const { error } = await supabase.from("friend_requests").delete().eq("id", row.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

app.get("/api/friends", authenticate, async (req, res) => {
  const { data } = await supabase
    .from("friends")
    .select("user_id, friend_id")
    .or(`user_id.eq.${req.user.id},friend_id.eq.${req.user.id}`);
  const ids = new Set();
  for (const f of data || []) {
    ids.add(f.user_id === req.user.id ? f.friend_id : f.user_id);
  }
  if (!ids.size) return res.json([]);
  const { data: users } = await supabase.from("users").select("*").in("id", [...ids]);
  const onlineSet = await presenceOnlineSetForUserIds([...ids]);
  res.json((users || []).map((u) => publicProfileWithPresence(u, req.user.id, onlineSet)));
});

app.post("/api/friends/:friendId", authenticate, async (req, res) => {
  const me = req.user.id;
  const friendId = req.params.friendId;
  if (friendId === me) return res.status(400).json({ error: "You cannot add yourself" });
  const friend = await fetchUserById(friendId);
  if (!friend) return res.status(404).json({ error: "User not found" });
  if (await areFriends(me, friendId)) return res.status(400).json({ error: "Already friends" });

  const { data: theyRequested } = await supabase
    .from("friend_requests")
    .select("id")
    .eq("from_user_id", friendId)
    .eq("to_user_id", me)
    .maybeSingle();
  if (theyRequested) {
    const fid = `fr${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { error } = await supabase.from("friends").insert({
      id: fid,
      user_id: friendId,
      friend_id: me
    });
    if (error) return res.status(400).json({ error: error.message });
    await supabase.from("friend_requests").delete().eq("id", theyRequested.id);
    return res.status(201).json({ friend: toPublicUser(friend), matched: true });
  }

  const { data: iRequested } = await supabase
    .from("friend_requests")
    .select("id")
    .eq("from_user_id", me)
    .eq("to_user_id", friendId)
    .maybeSingle();
  if (iRequested) return res.status(400).json({ error: "Friend request already sent" });

  const rid = `freq${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: insErr } = await supabase.from("friend_requests").insert({
    id: rid,
    from_user_id: me,
    to_user_id: friendId
  });
  if (insErr) return res.status(400).json({ error: insErr.message });
  await insertNotification({
    userId: friendId,
    text: `👋 ${req.user.name} sent you a friend request`,
    kind: "friend_request",
    badgeCount: 1,
    linkPath: "/messages"
  });
  res.status(201).json({ pending: true, message: "Friend request sent" });
});

app.delete("/api/friends/:friendId", authenticate, async (req, res) => {
  const friendId = req.params.friendId;
  const { data, error } = await supabase
    .from("friends")
    .delete()
    .or(`and(user_id.eq.${req.user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${req.user.id})`)
    .select();
  if (error) return res.status(400).json({ error: error.message });
  if (!data?.length) return res.status(404).json({ error: "Friend not found" });
  res.json({ success: true });
});

async function fetchArchivedChatTargets(me) {
  const { data } = await supabase.from("user_chat_archive").select("dm_peer_id, conversation_id").eq("user_id", me);
  const dms = new Set();
  const groups = new Set();
  for (const r of data || []) {
    if (r.dm_peer_id) dms.add(r.dm_peer_id);
    if (r.conversation_id) groups.add(r.conversation_id);
  }
  return { dms, groups };
}

app.post("/api/messages/conversations/archive", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const dmPeerId = req.body?.dmPeerId != null ? String(req.body.dmPeerId).trim() : "";
    const conversationId = req.body?.conversationId != null ? String(req.body.conversationId).trim() : "";
    const hasDm = Boolean(dmPeerId);
    const hasGroup = Boolean(conversationId);
    if (hasDm === hasGroup) {
      return res.status(400).json({ error: "Send exactly one of dmPeerId or conversationId." });
    }
    if (hasDm) {
      if (dmPeerId === me) return res.status(400).json({ error: "Cannot archive chat with yourself." });
      const other = await fetchUserById(dmPeerId);
      if (!other) return res.status(404).json({ error: "User not found." });
      const row = { user_id: me, dm_peer_id: dmPeerId, conversation_id: null };
      const { error } = await supabase.from("user_chat_archive").insert(row);
      const ignoreDup =
        error &&
        (error.code === "23505" ||
          String(error.message || "").toLowerCase().includes("duplicate") ||
          String(error.details || "").toLowerCase().includes("unique"));
      if (error && !ignoreDup) return res.status(400).json({ error: error.message });
      return res.json({ success: true });
    }

    const isMember = await ensureGroupMember(conversationId, me);
    if (!isMember) return res.status(403).json({ error: "You are not a member of this group chat." });
    const row = { user_id: me, dm_peer_id: null, conversation_id: conversationId };
    const { error } = await supabase.from("user_chat_archive").insert(row);
    const ignoreDup =
      error &&
      (error.code === "23505" ||
        String(error.message || "").toLowerCase().includes("duplicate") ||
        String(error.details || "").toLowerCase().includes("unique"));
    if (error && !ignoreDup) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/messages/conversations/unarchive", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const dmPeerId = req.body?.dmPeerId != null ? String(req.body.dmPeerId).trim() : "";
    const conversationId = req.body?.conversationId != null ? String(req.body.conversationId).trim() : "";
    const hasDm = Boolean(dmPeerId);
    const hasGroup = Boolean(conversationId);
    if (hasDm === hasGroup) {
      return res.status(400).json({ error: "Send exactly one of dmPeerId or conversationId." });
    }
    if (hasDm) {
      const { error } = await supabase
        .from("user_chat_archive")
        .delete()
        .eq("user_id", me)
        .eq("dm_peer_id", dmPeerId)
        .is("conversation_id", null);
      if (error) return res.status(400).json({ error: error.message });
    } else {
      const { error } = await supabase.from("user_chat_archive").delete().eq("user_id", me).eq("conversation_id", conversationId);
      if (error) return res.status(400).json({ error: error.message });
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/messages/conversations", authenticate, async (req, res) => {
  const me = req.user.id;
  const viewArchived = String(req.query.view || "").trim().toLowerCase() === "archived";
  const archivedSets = await fetchArchivedChatTargets(me);
  const [{ data: friendsRows }, { data: dmMsgs }, { data: groupMemberRows }] = await Promise.all([
    supabase.from("friends").select("user_id, friend_id").or(`user_id.eq.${me},friend_id.eq.${me}`),
    supabase
      .from("messages")
      .select("*")
      .is("conversation_id", null)
      .or(`from_user_id.eq.${me},to_user_id.eq.${me}`)
      .order("created_at", { ascending: true }),
    supabase.from("conversation_members").select("conversation_id, role").eq("user_id", me)
  ]);

  const list = [];

  // ---- DM conversations ----
  const partners = new Set();
  for (const f of friendsRows || []) partners.add(f.user_id === me ? f.friend_id : f.user_id);
  for (const m of dmMsgs || []) partners.add(m.from_user_id === me ? m.to_user_id : m.from_user_id);
  if (partners.size) {
    const { data: users } = await supabase.from("users").select("*").in("id", [...partners]);
    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const onlineSet = await presenceOnlineSetForUserIds([...partners]);
    for (const pid of partners) {
      const archivedDm = archivedSets.dms.has(pid);
      if (viewArchived !== archivedDm) continue;
      const partner = userMap.get(pid);
      if (!partner) continue;
      const thread = (dmMsgs || []).filter(
        (m) => (m.from_user_id === me && m.to_user_id === pid) || (m.from_user_id === pid && m.to_user_id === me)
      );
      const last = thread[thread.length - 1] || null;
      const unread = thread.filter((m) => m.to_user_id === me && !m.read).length;
      list.push({
        kind: "dm",
        id: `dm:${pid}`,
        user: publicProfileWithPresence(partner, me, onlineSet),
        isFriend: (friendsRows || []).some(
          (f) => (f.user_id === me && f.friend_id === pid) || (f.user_id === pid && f.friend_id === me)
        ),
        lastMessage: last
          ? {
              text: last.text || (last.attachment_url ? `📎 ${last.attachment_name || "attachment"}` : ""),
              createdAt: last.created_at,
              fromMe: last.from_user_id === me
            }
          : null,
        unreadCount: unread
      });
    }
  }

  // ---- Group conversations ----
  const groupIds = (groupMemberRows || []).map((g) => g.conversation_id);
  if (groupIds.length) {
    const [{ data: convs }, { data: groupMsgs }] = await Promise.all([
      supabase.from("conversations").select("*").in("id", groupIds),
      supabase
        .from("messages")
        .select("*")
        .in("conversation_id", groupIds)
        .order("created_at", { ascending: true })
    ]);
    const convById = new Map((convs || []).map((c) => [c.id, c]));
    for (const gid of groupIds) {
      const archivedGroup = archivedSets.groups.has(gid);
      if (viewArchived !== archivedGroup) continue;
      const conv = convById.get(gid);
      if (!conv) continue;
      const thread = (groupMsgs || []).filter((m) => m.conversation_id === gid);
      const last = thread[thread.length - 1] || null;
      list.push({
        kind: "group",
        id: `group:${gid}`,
        group: {
          id: conv.id,
          name: conv.name,
          photoUrl: conv.photo_url,
          isGroup: true
        },
        lastMessage: last
          ? {
              text: last.text || (last.attachment_url ? `📎 ${last.attachment_name || "attachment"}` : ""),
              createdAt: last.created_at,
              fromMe: last.from_user_id === me
            }
          : null,
        unreadCount: 0
      });
    }
  }

  list.sort((a, b) => {
    const ta = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
    const tb = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
    return tb - ta;
  });
  res.json(list);
});

app.get("/api/messages/with/:userId", authenticate, async (req, res) => {
  const me = req.user.id;
  const otherId = req.params.userId;
  const other = await fetchUserById(otherId);
  if (!other) return res.status(404).json({ error: "User not found" });
  const msgs = await fetchDmMessagesRaw(me, otherId);
  const unreadIds = msgs.filter((m) => m.to_user_id === me && !m.read).map((m) => m.id);
  if (unreadIds.length) await supabase.from("messages").update({ read: true }).in("id", unreadIds);
  const onlineSet = await presenceOnlineSetForUserIds([otherId]);
  const [{ data: incomingReq }, { data: outgoingReq }] = await Promise.all([
    supabase
      .from("friend_requests")
      .select("id")
      .eq("to_user_id", me)
      .eq("from_user_id", otherId)
      .maybeSingle(),
    supabase
      .from("friend_requests")
      .select("id")
      .eq("from_user_id", me)
      .eq("to_user_id", otherId)
      .maybeSingle()
  ]);
  const isFriend = otherId === SIGLACAST_AI_USER_ID ? true : await areFriends(me, otherId);
  res.json({
    user: publicProfileWithPresence(other, me, onlineSet),
    isFriend,
    incomingRequestId: incomingReq?.id || null,
    outgoingRequestPending: !!(outgoingReq && !isFriend),
    messages: await decorateChatMessages(msgs, me)
  });
});

// Send DM with optional attachment
app.post("/api/messages/with/:userId", authenticate, (req, res, next) => {
  uploadAnyFile.single("attachment")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = req.params.userId;
    const text = String(req.body?.text || "").trim();
    if (otherId === me) return res.status(400).json({ error: "Cannot message yourself" });
    if (!text && !req.file) return res.status(400).json({ error: "Message text or attachment is required" });
    const other = await fetchUserById(otherId);
    if (!other) return res.status(404).json({ error: "User not found" });
    if (otherId === SIGLACAST_AI_USER_ID && req.file) {
      return res.status(400).json({ error: "SiglaCast AI chat is text-only (no attachments)." });
    }

    let attachment = null;
    if (req.file) attachment = await uploadAttachment("chat-attachments", req.file);

    // Optional reply-to: must reference a message in this same DM thread.
    let replyToId = null;
    const rawReplyTo = req.body?.replyToId ? String(req.body.replyToId) : "";
    if (rawReplyTo) {
      const { data: target } = await supabase
        .from("messages")
        .select("id, from_user_id, to_user_id, conversation_id")
        .eq("id", rawReplyTo)
        .maybeSingle();
      const sameThread = target
        && !target.conversation_id
        && ((target.from_user_id === me && target.to_user_id === otherId) ||
            (target.from_user_id === otherId && target.to_user_id === me) ||
            (target.from_user_id === SIGLACAST_AI_USER_ID &&
              (target.to_user_id === me || target.to_user_id === otherId)));
      if (sameThread) replyToId = target.id;
    }

    const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        id,
        from_user_id: me,
        to_user_id: otherId,
        text: text || null,
        read: false,
        reply_to_id: replyToId,
        attachment_url: attachment?.url || null,
        attachment_type: attachment ? (attachment.isImage ? "image" : "file") : null,
        attachment_name: attachment?.name || null,
        attachment_size: attachment?.size || null
      })
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    await broker.publish("message.sent", { id, fromUserId: me, toUserId: otherId });
    if (otherId !== SIGLACAST_AI_USER_ID) {
      await bumpAggregatedNotification({
        userId: otherId,
        sourceKey: `dm:${me}`,
        kind: "dm",
        textForCount: (n) => `💬 (${n}) new message${n === 1 ? "" : "s"} · open Messages`,
        linkPath: `/messages?dm=${encodeURIComponent(me)}`
      });
      if (text) await notifyMentions(text, `a chat from ${req.user.name}`, me, `/messages?dm=${encodeURIComponent(me)}`);
    }

    if (otherId === SIGLACAST_AI_USER_ID && text) {
      const rawThread = await fetchDmMessagesRaw(me, SIGLACAST_AI_USER_ID);
      const decThread = await decorateChatMessages(rawThread, me);
      const transcript = transcriptTurnsFromDecorated(decThread);
      const g = await groqCompletion(buildSiglaContextualPrompt(req.user), transcript);
      if (g.error) return res.status(502).json({ error: g.error });

      const aiMsgId = `msg${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const { error: aiErr } = await supabase.from("messages").insert({
        id: aiMsgId,
        from_user_id: SIGLACAST_AI_USER_ID,
        to_user_id: me,
        text: g.reply,
        read: false,
        reply_to_id: null,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null,
        bridge_mirror: false
      });
      if (aiErr) return res.status(400).json({ error: aiErr.message });
    }

    const [decorated] = await decorateChatMessages([message], me);
    res.status(201).json({ message: decorated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Ask SiglaCast AI inside a 1-on-1 DM thread — persists your message + Sigla replies for both participants (two mirrored rows per answer). */
app.post("/api/messages/with/:userId/sigla-ai", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = req.params.userId;
    if (otherId === me) return res.status(400).json({ error: "Cannot message yourself" });
    if (otherId === SIGLACAST_AI_USER_ID) return res.status(400).json({ error: "Invalid recipient" });

    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Ask Sigla AI with a short text prompt." });

    const other = await fetchUserById(otherId);
    if (!other) return res.status(404).json({ error: "User not found" });

    let replyToId = null;
    const rawReplyTo = req.body?.replyToId ? String(req.body.replyToId) : "";
    if (rawReplyTo) {
      const { data: target } = await supabase
        .from("messages")
        .select("id, from_user_id, to_user_id, conversation_id")
        .eq("id", rawReplyTo)
        .maybeSingle();
      const sameThread = target
        && !target.conversation_id
        && ((target.from_user_id === me && target.to_user_id === otherId) ||
          (target.from_user_id === otherId && target.to_user_id === me) ||
          (target.from_user_id === SIGLACAST_AI_USER_ID &&
            (target.to_user_id === me || target.to_user_id === otherId)));
      if (sameThread) replyToId = target.id;
    }

    const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        id,
        from_user_id: me,
        to_user_id: otherId,
        text,
        read: false,
        reply_to_id: replyToId,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null
      })
      .select()
      .maybeSingle();
    if (error || !message) return res.status(400).json({ error: error?.message || "Could not insert message." });
    await broker.publish("message.sent", { id, fromUserId: me, toUserId: otherId });
    await bumpAggregatedNotification({
      userId: otherId,
      sourceKey: `dm:${me}`,
      kind: "dm",
      textForCount: (n) => `💬 (${n}) new message${n === 1 ? "" : "s"} · open Messages`,
      linkPath: `/messages?dm=${encodeURIComponent(me)}`
    });
    if (text) await notifyMentions(text, `a chat from ${req.user.name}`, me, `/messages?dm=${encodeURIComponent(me)}`);

    let rawThread = await fetchDmMessagesRaw(me, otherId);
    let decorated = await decorateChatMessages(rawThread, me);
    let transcript = transcriptTurnsFromDecorated(decorated);

    const g = await groqCompletion(buildSiglaContextualPrompt(req.user), transcript);
    if (g.error) return res.status(502).json({ error: g.error });

    const aiA = `msg${Date.now()}-a-${Math.random().toString(36).slice(2, 9)}`;
    const aiB = `msg${Date.now()}-b-${Math.random().toString(36).slice(2, 9)}`;
    const { error: aiErr } = await supabase.from("messages").insert([
      {
        id: aiA,
        from_user_id: SIGLACAST_AI_USER_ID,
        to_user_id: me,
        text: g.reply,
        read: false,
        reply_to_id: null,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null,
        bridge_mirror: false
      },
      {
        id: aiB,
        from_user_id: SIGLACAST_AI_USER_ID,
        to_user_id: otherId,
        text: g.reply,
        read: false,
        reply_to_id: null,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null,
        bridge_mirror: false
      }
    ]);
    if (aiErr) return res.status(400).json({ error: aiErr.message });

    rawThread = await fetchDmMessagesRaw(me, otherId);
    decorated = await decorateChatMessages(rawThread, me);

    /** Drop duplicate mirrored Sigla replies (same text, same assistant, within ~4s). */
    const folded = [];
    for (let i = 0; i < decorated.length; i++) {
      const cur = decorated[i];
      folded.push(cur);
      const nx = decorated[i + 1];
      if (
        nx &&
        cur.fromUserId === SIGLACAST_AI_USER_ID &&
        nx.fromUserId === SIGLACAST_AI_USER_ID &&
        cur.text === nx.text &&
        new Date(nx.createdAt).getTime() - new Date(cur.createdAt).getTime() < 5000
      ) {
        i += 1;
      }
    }

    res.json({ messages: folded });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Attachments list for a DM (images + files popup)
app.get("/api/messages/with/:userId/attachments", authenticate, async (req, res) => {
  const me = req.user.id;
  const otherId = req.params.userId;
  const { data: msgs } = await supabase
    .from("messages")
    .select("*")
    .is("conversation_id", null)
    .not("attachment_url", "is", null)
    .or(`and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me})`)
    .order("created_at", { ascending: false });
  res.json((msgs || []).map((m) => serializeChatMessage(m, me)));
});

// ==========================================================================
// Group chat endpoints
// ==========================================================================

// Create a new group chat. memberIds is an array; the creator is added as admin.
app.post("/api/groups", authenticate, (req, res, next) => {
  uploadImage.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const me = req.user.id;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Group name is required" });
    let memberIds = [];
    try {
      const raw = req.body?.memberIds || "[]";
      memberIds = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return res.status(400).json({ error: "memberIds must be a JSON array" });
    }
    if (!Array.isArray(memberIds)) memberIds = [];
    memberIds = [...new Set(memberIds.filter((id) => id && id !== me))];
    if (memberIds.length < 1) return res.status(400).json({ error: "Add at least one other member" });

    // Verify all member ids exist
    const { data: users } = await supabase.from("users").select("id").in("id", memberIds);
    const validIds = new Set((users || []).map((u) => u.id));
    const filtered = memberIds.filter((id) => validIds.has(id));
    if (!filtered.length) return res.status(400).json({ error: "No valid members found" });

    let photo_url = null;
    if (req.file) photo_url = await uploadToBucket("group-photos", req.file);

    const id = `gc${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const { error: convErr } = await supabase.from("conversations").insert({
      id, name, photo_url, is_group: true, created_by: me
    });
    if (convErr) return res.status(400).json({ error: convErr.message });

    const memberRows = [
      { conversation_id: id, user_id: me, role: "admin" },
      ...filtered.map((uid) => ({ conversation_id: id, user_id: uid, role: "member" }))
    ];
    const { error: memErr } = await supabase.from("conversation_members").insert(memberRows);
    if (memErr) return res.status(400).json({ error: memErr.message });

    res.status(201).json(await fetchGroupSummary(id, me));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get group details + thread
app.get("/api/groups/:id", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const payload = await getGroupThreadPayload(gid, me);
  if (payload.errorStatus === 403) return res.status(403).json({ error: payload.errorMessage });
  if (payload.errorStatus === 404) return res.status(404).json({ error: payload.errorMessage });
  res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
});

app.post("/api/groups/:id/userphone/start", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const gid = req.params.id;
    const existingSession = await fetchActiveUserphoneSession(me);
    if (existingSession) {
      const isBridge = !!(existingSession.bridge_conversation_a || existingSession.bridge_conversation_b);
      if (!isBridge) {
        return res.status(400).json({ error: "You’re already in Userphone.", code: "USERPHONE_SOLO_ACTIVE" });
      }
      const inSame =
        existingSession.bridge_conversation_a === gid || existingSession.bridge_conversation_b === gid;
      if (!inSame) {
        return res.status(400).json({
          error: "You’re bridged via Userphone in another group. End it there first.",
          code: "USERPHONE_BRIDGE_ACTIVE"
        });
      }
      const payload = await getGroupThreadPayload(gid, me);
      return res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
    }
    await supabase.from("anon_userphone_waiting").delete().eq("user_id", me);
    const bridgeNow = await buildGroupUserphoneBridge(gid, me);
    if (bridgeNow.phase === "matched") {
      const payload = await getGroupThreadPayload(gid, me);
      return res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
    }
    const ts = new Date().toISOString();
    const upErr = await convWaitingUpsertEnqueue({ conversation_id: gid, queued_by_user_id: me, joined_at: ts });
    if (upErr) return res.status(400).json({ error: upErr.message });
    await tryPairConversationBridges();
    const payload = await getGroupThreadPayload(gid, me);
    res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/groups/:id/userphone/waiting", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const payloadAwait = await getGroupThreadPayload(gid, me);
  if (payloadAwait.errorStatus === 403) return res.status(403).json({ error: payloadAwait.errorMessage });
  if (payloadAwait.errorStatus === 404) return res.status(404).json({ error: payloadAwait.errorMessage });
  await convWaitingDeleteByConversationId(gid);
  const payload = await getGroupThreadPayload(gid, me);
  res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
});

app.post("/api/groups/:id/userphone/end", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const payloadAwait = await getGroupThreadPayload(gid, me);
  if (payloadAwait.errorStatus === 403) return res.status(403).json({ error: payloadAwait.errorMessage });
  if (payloadAwait.errorStatus === 404) return res.status(404).json({ error: payloadAwait.errorMessage });
  const bridge = await fetchActiveBridgeSessionForConversation(gid);
  if (!bridge?.id) {
    const payload = payloadAwait;
    return res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
  }
  await supabase.from("anon_userphone_sessions").update({ ended_at: new Date().toISOString() }).eq("id", bridge.id);
  const payload = await getGroupThreadPayload(gid, me);
  res.json({ group: payload.group, messages: payload.messages, groupUserphone: payload.groupUserphone });
});

// Update group name / photo (admins only)
app.patch("/api/groups/:id", authenticate, (req, res, next) => {
  uploadImage.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const me = req.user.id;
    const gid = req.params.id;
    const summary = await fetchGroupSummary(gid, me);
    if (!summary) return res.status(404).json({ error: "Group not found" });
    if (!summary.isMember) return res.status(403).json({ error: "Not a member" });
    if (!summary.isAdmin && req.user.role !== "admin") {
      return res.status(403).json({ error: "Only group admins can edit this chat" });
    }
    const updates = {};
    const newName = req.body?.name ? String(req.body.name).trim() : "";
    if (newName) updates.name = newName;
    if (req.file) updates.photo_url = await uploadToBucket("group-photos", req.file);
    if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });
    const { error } = await supabase.from("conversations").update(updates).eq("id", gid);
    if (error) return res.status(400).json({ error: error.message });
    res.json(await fetchGroupSummary(gid, me));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Send message to a group (text and/or attachment)
app.post("/api/groups/:id/messages", authenticate, (req, res, next) => {
  uploadAnyFile.single("attachment")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  try {
    const me = req.user.id;
    const gid = req.params.id;
    if (!(await ensureGroupMember(gid, me))) return res.status(403).json({ error: "You are not a member of this group" });
    const text = String(req.body?.text || "").trim();
    if (!text && !req.file) return res.status(400).json({ error: "Message text or attachment is required" });

    let attachment = null;
    if (req.file) attachment = await uploadAttachment("chat-attachments", req.file);

    // Optional reply-to: must reference a message in this same group.
    let replyToId = null;
    const rawReplyTo = req.body?.replyToId ? String(req.body.replyToId) : "";
    if (rawReplyTo) {
      const { data: target } = await supabase
        .from("messages")
        .select("id, conversation_id")
        .eq("id", rawReplyTo)
        .maybeSingle();
      if (target && target.conversation_id === gid) replyToId = target.id;
    }

    const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        id,
        conversation_id: gid,
        from_user_id: me,
        to_user_id: null,
        text: text || null,
        read: false,
        reply_to_id: replyToId,
        attachment_url: attachment?.url || null,
        attachment_type: attachment ? (attachment.isImage ? "image" : "file") : null,
        attachment_name: attachment?.name || null,
        attachment_size: attachment?.size || null,
        bridge_mirror: false
      })
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    await relayGroupBridgeMessage(message);
    await broker.publish("message.sent", { id, fromUserId: me, conversationId: gid });

    // No broadcast push for every group message — only @mentions (below) and
    // explicit reply-to notifications (the quoted message author).
    if (replyToId) {
      const { data: quoted } = await supabase
        .from("messages")
        .select("from_user_id")
        .eq("id", replyToId)
        .maybeSingle();
      const quotedAuthor = quoted?.from_user_id;
      if (quotedAuthor && quotedAuthor !== me) {
        const { data: conv } = await supabase.from("conversations").select("name").eq("id", gid).maybeSingle();
        await insertNotification({
          userId: quotedAuthor,
          kind: "reply_message",
          text: `↩️ ${req.user.name} replied to you in "${conv?.name || "group"}"`,
          badgeCount: 1,
          linkPath: `/messages?group=${encodeURIComponent(gid)}`
        });
      }
    }

    if (text) await notifyMentions(text, `a group chat from ${req.user.name}`, me, `/messages?group=${encodeURIComponent(gid)}`);

    const [decorated] = await decorateChatMessages([message], me);
    res.status(201).json({ message: decorated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Ask SiglaCast AI inside a group — persists your bubble + assistant reply into this thread for everyone (not mirrored across Userphone bridge). */
app.post("/api/groups/:id/messages/sigla-ai", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const gid = req.params.id;
    if (!(await ensureGroupMember(gid, me))) return res.status(403).json({ error: "You are not a member of this group" });
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Ask Sigla AI with a short text prompt." });

    let replyToId = null;
    const rawReplyTo = req.body?.replyToId ? String(req.body.replyToId) : "";
    if (rawReplyTo) {
      const { data: target } = await supabase
        .from("messages")
        .select("id, conversation_id")
        .eq("id", rawReplyTo)
        .maybeSingle();
      if (target && target.conversation_id === gid) replyToId = target.id;
    }

    const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({
        id,
        conversation_id: gid,
        from_user_id: me,
        to_user_id: null,
        text,
        read: false,
        reply_to_id: replyToId,
        attachment_url: null,
        attachment_type: null,
        attachment_name: null,
        attachment_size: null,
        bridge_mirror: false
      })
      .select()
      .maybeSingle();
    if (error || !message) return res.status(400).json({ error: error?.message || "Could not insert message." });
    await relayGroupBridgeMessage(message);
    await broker.publish("message.sent", { id, fromUserId: me, conversationId: gid });
    if (text) await notifyMentions(text, `a group chat from ${req.user.name}`, me, `/messages?group=${encodeURIComponent(gid)}`);

    const { data: allRows } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", gid)
      .order("created_at", { ascending: true });
    const decorated = await decorateChatMessages(allRows || [], me);
    const transcript = transcriptTurnsFromDecorated(decorated);

    const g = await groqCompletion(buildSiglaContextualPrompt(req.user), transcript);
    if (g.error) return res.status(502).json({ error: g.error });

    const aiMsgId = `msg${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const { error: aiErr } = await supabase.from("messages").insert({
      id: aiMsgId,
      conversation_id: gid,
      from_user_id: SIGLACAST_AI_USER_ID,
      to_user_id: null,
      text: g.reply,
      read: false,
      reply_to_id: null,
      bridge_mirror: false,
      attachment_url: null,
      attachment_type: null,
      attachment_name: null,
      attachment_size: null
    });
    if (aiErr) return res.status(400).json({ error: aiErr.message });

    const payload = await getGroupThreadPayload(gid, me);
    if (payload.errorStatus === 403) return res.status(403).json({ error: payload.errorMessage });
    if (payload.errorStatus === 404) return res.status(404).json({ error: payload.errorMessage });
    res.json({
      group: payload.group,
      messages: payload.messages,
      groupUserphone: payload.groupUserphone
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Group attachments list
app.get("/api/groups/:id/attachments", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  if (!(await ensureGroupMember(gid, me))) return res.status(403).json({ error: "You are not a member of this group" });
  const { data: msgs } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", gid)
    .not("attachment_url", "is", null)
    .order("created_at", { ascending: false });
  res.json(await decorateChatMessages(msgs, me));
});

// Leave a group. If the leaver was the only admin, promote the longest-joined
// remaining member so the group can keep being managed.
app.delete("/api/groups/:id/members/me", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;

  const { data: myRow } = await supabase
    .from("conversation_members")
    .select("role")
    .eq("conversation_id", gid)
    .eq("user_id", me)
    .maybeSingle();

  await supabase.from("conversation_members").delete().eq("conversation_id", gid).eq("user_id", me);

  const { data: remaining } = await supabase
    .from("conversation_members")
    .select("user_id, role, joined_at")
    .eq("conversation_id", gid)
    .order("joined_at", { ascending: true });

  if (!remaining || !remaining.length) {
    await supabase.from("conversations").delete().eq("id", gid);
  } else if (myRow?.role === "admin" && !remaining.some((m) => m.role === "admin")) {
    await supabase
      .from("conversation_members")
      .update({ role: "admin" })
      .eq("conversation_id", gid)
      .eq("user_id", remaining[0].user_id);
  }
  res.json({ success: true });
});

// Add members to an existing group (group admin only)
app.post("/api/groups/:id/members", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const summary = await fetchGroupSummary(gid, me);
  if (!summary) return res.status(404).json({ error: "Group not found" });
  if (!summary.isAdmin && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only group admins can add members" });
  }
  let memberIds = req.body?.memberIds;
  if (typeof memberIds === "string") {
    try { memberIds = JSON.parse(memberIds); } catch { memberIds = []; }
  }
  if (!Array.isArray(memberIds)) memberIds = [];
  // Filter out existing members and validate
  const existing = new Set(summary.members.map((m) => m.id));
  const wanted = [...new Set(memberIds.filter((id) => id && id !== me && !existing.has(id)))];
  if (!wanted.length) return res.status(400).json({ error: "No new members to add" });
  const { data: users } = await supabase.from("users").select("id").in("id", wanted);
  const validIds = (users || []).map((u) => u.id);
  if (!validIds.length) return res.status(400).json({ error: "No valid members found" });

  await supabase.from("conversation_members").insert(
    validIds.map((uid) => ({ conversation_id: gid, user_id: uid, role: "member" }))
  );

  // Notify the newcomers
  const notes = validIds.map((uid) => ({
    id: `n${Date.now()}-${uid}-${Math.random().toString(36).slice(2, 5)}`,
    user_id: uid,
    text: `${req.user.name} added you to "${summary.name}"`,
    kind: "group_added",
    badge_count: 1,
    read: false,
    link_path: `/messages?group=${encodeURIComponent(gid)}`
  }));
  if (notes.length) await supabase.from("notifications").insert(notes);

  res.status(201).json(await fetchGroupSummary(gid, me));
});

// Remove a specific member from the group (group admin only)
app.delete("/api/groups/:id/members/:userId", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const targetId = req.params.userId;
  if (targetId === me) return res.status(400).json({ error: "Use leave group to remove yourself" });
  const summary = await fetchGroupSummary(gid, me);
  if (!summary) return res.status(404).json({ error: "Group not found" });
  if (!summary.isAdmin && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only group admins can remove members" });
  }
  await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", gid)
    .eq("user_id", targetId);

  await supabase.from("notifications").insert({
    id: `n${Date.now()}-${targetId}-${Math.random().toString(36).slice(2, 5)}`,
    user_id: targetId,
    kind: "group_removed",
    text: `You were removed from "${summary.name}"`,
    badge_count: 1,
    read: false,
    link_path: "/messages"
  });

  res.json(await fetchGroupSummary(gid, me));
});

// Promote / demote a member (group admin only). Body: { role: "admin" | "member" }
app.patch("/api/groups/:id/members/:userId", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const targetId = req.params.userId;
  const role = req.body?.role === "admin" ? "admin" : "member";
  const summary = await fetchGroupSummary(gid, me);
  if (!summary) return res.status(404).json({ error: "Group not found" });
  if (!summary.isAdmin && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only group admins can change roles" });
  }
  if (!summary.members.some((m) => m.id === targetId)) {
    return res.status(404).json({ error: "Member not found in this group" });
  }
  // Don't allow demoting yourself if you're the only admin
  if (targetId === me && role === "member") {
    const otherAdmins = summary.members.filter((m) => m.id !== me && m.role === "admin");
    if (!otherAdmins.length) {
      return res.status(400).json({ error: "Promote someone else to admin before stepping down" });
    }
  }
  await supabase
    .from("conversation_members")
    .update({ role })
    .eq("conversation_id", gid)
    .eq("user_id", targetId);
  res.json(await fetchGroupSummary(gid, me));
});

// Delete a whole group chat (group admin OR app admin)
app.delete("/api/groups/:id", authenticate, async (req, res) => {
  const me = req.user.id;
  const gid = req.params.id;
  const summary = await fetchGroupSummary(gid, me);
  if (!summary) return res.status(404).json({ error: "Group not found" });
  if (!summary.isAdmin && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only group admins can delete this chat" });
  }
  // Cascade: messages, members, reactions, conversation row
  const { data: msgs } = await supabase.from("messages").select("id").eq("conversation_id", gid);
  const msgIds = (msgs || []).map((m) => m.id);
  if (msgIds.length) await supabase.from("message_reactions").delete().in("message_id", msgIds);
  await supabase.from("messages").delete().eq("conversation_id", gid);
  await supabase.from("conversation_members").delete().eq("conversation_id", gid);
  const { error } = await supabase.from("conversations").delete().eq("id", gid);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// Toggle a reaction on any message (DM or group). The viewer must be allowed to
// see the message — i.e. they're either the sender/recipient (DM) or a member
// (group).
// Unsend a chat message (DM or group). Soft-deletes by setting is_unsent=true
// and clearing text/attachment metadata so the row stays as a tombstone
// (renders "This message was unsent" in the UI). Only the message author can
// unsend their own message. Also drops any reactions on it.
app.delete("/api/messages/:id", authenticate, async (req, res) => {
  const me = req.user.id;
  const mid = req.params.id;
  const { data: message } = await supabase
    .from("messages")
    .select("*")
    .eq("id", mid)
    .maybeSingle();
  if (!message) return res.status(404).json({ error: "Message not found" });
  if (message.from_user_id !== me) {
    return res.status(403).json({ error: "You can only unsend your own messages" });
  }
  await supabase.from("message_reactions").delete().eq("message_id", mid);
  const { error } = await supabase
    .from("messages")
    .update({
      is_unsent: true,
      text: null,
      attachment_url: null,
      attachment_type: null,
      attachment_name: null,
      attachment_size: null
    })
    .eq("id", mid);
  if (error) return res.status(400).json({ error: error.message });

  const { data: refreshed } = await supabase.from("messages").select("*").eq("id", mid).maybeSingle();
  const [decorated] = await decorateChatMessages([refreshed], me);
  res.json({ message: decorated });
});

app.post("/api/messages/:id/react", authenticate, async (req, res) => {
  const me = req.user.id;
  const mid = req.params.id;
  const wantClear = req.body?.reaction === null || req.body?.reaction === "";
  const requested = String(req.body?.reaction || "like").toLowerCase();
  const reaction = ALLOWED_REACTIONS.includes(requested) ? requested : "like";

  const { data: message } = await supabase.from("messages").select("*").eq("id", mid).maybeSingle();
  if (!message) return res.status(404).json({ error: "Message not found" });
  if (message.is_unsent) return res.status(400).json({ error: "Cannot react to an unsent message" });

  // Authorize
  let allowed = false;
  if (message.conversation_id) {
    allowed = await ensureGroupMember(message.conversation_id, me);
  } else {
    allowed = message.from_user_id === me || message.to_user_id === me;
  }
  if (!allowed) return res.status(403).json({ error: "Not allowed" });

  const { data: existing } = await supabase
    .from("message_reactions")
    .select("*")
    .eq("message_id", mid)
    .eq("user_id", me)
    .maybeSingle();

  let action = "none";
  if (existing) {
    if (wantClear || existing.reaction === reaction) {
      await supabase.from("message_reactions").delete().eq("message_id", mid).eq("user_id", me);
      action = "removed";
    } else {
      await supabase.from("message_reactions").update({ reaction }).eq("message_id", mid).eq("user_id", me);
      action = "changed";
    }
  } else if (!wantClear) {
    await supabase.from("message_reactions").insert({ message_id: mid, user_id: me, reaction });
    action = "added";
  }

  const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", cry: "😭", angry: "😡" };
  if (action === "added" && message.from_user_id && message.from_user_id !== me) {
    await insertNotification({
      userId: message.from_user_id,
      kind: "reaction_message",
      text: `${req.user.name} reacted ${labelEmoji[reaction] || "👍"} to your message`,
      badgeCount: 1,
      linkPath:
        message.conversation_id != null
          ? `/messages?group=${encodeURIComponent(message.conversation_id)}`
          : `/messages?dm=${encodeURIComponent(me)}`
    });
  }

  const { data: fresh } = await supabase.from("messages").select("*").eq("id", mid).maybeSingle();
  const [decorated] = await decorateChatMessages([fresh], me);
  res.json({ message: decorated });
});

app.get("/api/community/posts/:postId/reactors", authenticate, async (req, res) => {
  const postId = req.params.postId;
  const { data: rows } = await supabase.from("post_reactions").select("user_id, reaction").eq("post_id", postId);
  const breakdown = await reactorsBreakdownFromRows(rows || []);
  res.json({ breakdown });
});

app.get("/api/community/comments/:commentId/reactors", authenticate, async (req, res) => {
  const cid = req.params.commentId;
  const { data: rows } = await supabase.from("comment_reactions").select("user_id, reaction").eq("comment_id", cid);
  const breakdown = await reactorsBreakdownFromRows(rows || []);
  res.json({ breakdown });
});

app.get("/api/messages/:id/reactors", authenticate, async (req, res) => {
  const mid = req.params.id;
  const me = req.user.id;
  const { data: message } = await supabase.from("messages").select("*").eq("id", mid).maybeSingle();
  if (!message) return res.status(404).json({ error: "Not found" });
  let allowed = false;
  if (message.conversation_id) allowed = await ensureGroupMember(message.conversation_id, me);
  else allowed = message.from_user_id === me || message.to_user_id === me;
  if (!allowed) return res.status(403).json({ error: "Not allowed" });
  const { data: rows } = await supabase.from("message_reactions").select("user_id, reaction").eq("message_id", mid);
  const breakdown = await reactorsBreakdownFromRows(rows || []);
  res.json({ breakdown });
});

// XML and XSLT
function toXml(events) {
  return create({ version: "1.0" }).ele("events").ele(
    events.map((e) => ({ event: { "@id": e.id, title: e.title, status: e.status, strategy: e.strategy } }))
  ).end({ prettyPrint: true });
}
app.get("/api/xml/events.xml", authenticate, async (_, res) => {
  const events = await fetchAllEvents();
  res.type("application/xml").send(toXml(events));
});
app.post("/api/xml/parse", authenticate, express.text({ type: ["application/xml", "text/xml"] }), (req, res) => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  try { res.json(parser.parse(req.body || "")); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get("/api/xml/events.html", authenticate, async (_, res) => {
  const events = await fetchAllEvents();
  const xml = toXml(events);
  const xslPath = path.resolve("src/xslt/events.xsl");
  const xsl = await fs.readFile(xslPath, "utf8");
  const html = xsltProcess(xmlParse(xml), xmlParse(xsl));
  res.type("text/html").send(html);
});

app.listen(Number(process.env.PORT || 4000), () => {
  console.log(`SiglaCast backend on http://localhost:${process.env.PORT || 4000}`);
});
