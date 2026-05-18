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

const { xsltProcess, xmlParse } = xsltProcessor;

const JWT_SECRET = process.env.JWT_SECRET || "siglacast-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "siglacast-dev-refresh-secret";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

/** Sentinel user id for mirrored anonymous lines in group Userphone bridges (migration 0008). */
const USERPHONE_GUEST_ID = "_userphone_guest";

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
const ALLOWED_REACTIONS = ["like", "love", "haha", "wow", "sad", "angry"];

async function serializePost(post, viewerId) {
  const [{ data: reactions }, { data: comments }, { data: author }] = await Promise.all([
    supabase.from("post_reactions").select("user_id, reaction").eq("post_id", post.id),
    supabase.from("post_comments").select("*").eq("post_id", post.id).order("created_at", { ascending: true }),
    supabase.from("users").select("id, name, avatar_url").eq("id", post.author_id).maybeSingle()
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
    await supabase.from("notifications").update({ badge_count: next, text }).eq("id", row.id);
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

function withOnline(user, onlineSet) {
  if (!user) return user;
  return { ...user, isOnline: onlineSet.has(user.id) };
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
    ...withOnline(toPublicUser(userMap.get(m.user_id)), onlineSet),
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
    return {
      ...serializeChatMessage(row, viewerId),
      author: row.from_user_id === USERPHONE_GUEST_ID ? "Anonymous" : (sender?.name || "Unknown"),
      authorAvatar: row.from_user_id === USERPHONE_GUEST_ID ? null : (sender?.avatar_url || null),
      reactionBreakdown: row.is_unsent ? {} : rx.breakdown,
      myReaction: row.is_unsent ? null : rx.mine,
      replyTo: row.reply_to_id ? (replyMap.get(row.reply_to_id) || null) : null
    };
  });
}

/** Max time to stay in the Userphone match queue before auto-dropping to idle (ms). */
const USERPHONE_WAIT_MS = 10_000;

/** Random anonymous pairing chat — identities never leak in API payloads. */
function serializeUserphoneMessages(rows, viewerId) {
  return (rows || []).map((row) => ({
    id: row.id,
    text: row.text || "",
    fromMe: row.from_user_id === viewerId,
    createdAt: row.created_at,
    author: row.from_user_id === viewerId ? "You" : "Anonymous",
    anonymous: true
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
  const cutoff = new Date(Date.now() - USERPHONE_WAIT_MS).toISOString();
  await supabase.from("anon_userphone_conv_waiting").delete().lt("joined_at", cutoff);
}

/** Pair two different group threads that are queued for anonymous bridge. */
async function tryPairConversationBridges() {
  await cleanupStaleConvWaiting();
  const { data: rows } = await supabase.from("anon_userphone_conv_waiting").select("*").order("joined_at", { ascending: true });
  if (!rows?.length) return;
  const first = rows[0];
  const second = rows.find((r) => r.conversation_id !== first.conversation_id);
  if (!second) return;
  const hostA = first.queued_by_user_id;
  const hostB = second.queued_by_user_id;
  if (await fetchActiveUserphoneSession(hostA)) return;
  if (await fetchActiveUserphoneSession(hostB)) return;
  const { data: gotA } = await supabase.from("anon_userphone_conv_waiting").delete().eq("conversation_id", first.conversation_id).select("conversation_id");
  const { data: gotB } = await supabase.from("anon_userphone_conv_waiting").delete().eq("conversation_id", second.conversation_id).select("conversation_id");
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
    await supabase.from("anon_userphone_conv_waiting").insert([
      { conversation_id: first.conversation_id, queued_by_user_id: first.queued_by_user_id },
      { conversation_id: second.conversation_id, queued_by_user_id: second.queued_by_user_id }
    ]);
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
  const { data: w } = await supabase.from("anon_userphone_conv_waiting").select("*").eq("conversation_id", gid).maybeSingle();
  if (w) {
    const joinedMs = new Date(w.joined_at).getTime();
    if (Date.now() - joinedMs >= USERPHONE_WAIT_MS) {
      await supabase.from("anon_userphone_conv_waiting").delete().eq("conversation_id", gid);
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
    { id: "a1", role: "admin", name: "System Admin", email: "admin@dorsu.edu.ph", password_hash: adminHash, permissions: ["all"] }
  ]);
  await supabase.from("events").insert([
    { id: "e1", title: "Student Election 2026", description: "Campus-wide election for student council officers.", status: "open", strategy: "single", max_votes_per_user: 1 }
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
app.use(cors({ origin: FRONTEND_ORIGIN === "*" ? true : FRONTEND_ORIGIN.split(","), credentials: false }));
app.use(express.json({ limit: "30mb" }));

await seedIfEmpty();

const broker = await makeBroker();
await broker.consume("vote.cast", (m) => console.log("[vote.cast]", m));
await broker.consume("post.created", (m) => console.log("[post.created]", m.id));
await broker.consume("message.sent", (m) => console.log("[message.sent]", m.fromUserId, "->", m.toUserId));

app.get("/api/health", (_, res) => res.json({ ok: true }));

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
    res.json({ token: accessToken, accessToken, refreshToken, user: toPublicUser(user) });
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
    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken, user: toPublicUser(user) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/auth/logout", authenticate, async (req, res) => {
  await supabase.from("users").update({ refresh_token_hash: null }).eq("id", req.user.id);
  res.json({ success: true });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.patch("/api/profile", authenticate, async (req, res) => {
  try {
    const { name, currentPassword, newPassword, statusEmoji, statusNote } = req.body || {};
    const updates = {};
    const trimmedName = name !== undefined ? String(name).trim() : "";
    if (trimmedName) updates.name = trimmedName;
    if (statusEmoji !== undefined) {
      const em = String(statusEmoji).trim();
      updates.status_emoji = em ? em.slice(0, 48) : null;
    }
    if (statusNote !== undefined) {
      const nt = String(statusNote).trim();
      updates.status_note = nt ? nt.slice(0, 128) : null;
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
    res.json({ user: toPublicUser(data) });
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
    res.json({ user: toPublicUser(data) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
    const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😡" };
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
  const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😡" };

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
    profile: toPublicUser(req.user),
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
    profile: toPublicUser(req.user),
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
  const { data, error } = await supabase
    .from("users")
    .select("id, role, name, email, course, avatar_url, created_at")
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(
    (data || []).map((u) => ({
      ...toPublicUser(u),
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
  await supabase.from("anon_userphone_conv_waiting").delete().eq("queued_by_user_id", me);
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

// Messaging + friends
app.get("/api/users/search", authenticate, async (req, res) => {
  const me = req.user.id;
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  /** Strip LIKE wildcards from `q` so we match a literal substring. */
  const cleaned = q.replace(/[%_\\]/g, "").trim();
  if (!cleaned) return res.json([]);
  const pattern = `%${cleaned}%`;
  const selectCols = "id, name, email, role, course, avatar_url";
  const [byName, byEmail, byCourse] = await Promise.all([
    supabase.from("users").select(selectCols).neq("id", me).ilike("name", pattern).limit(12),
    supabase.from("users").select(selectCols).neq("id", me).ilike("email", pattern).limit(12),
    supabase.from("users").select(selectCols).neq("id", me).ilike("course", pattern).limit(12)
  ]);
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
      ...withOnline(toPublicUser(u), onlineSet),
      isFriend: friendIdSet.has(u.id),
      incomingRequestId: incomingByFrom.get(u.id) || null,
      outgoingRequestPending: outgoingToSet.has(u.id)
    });
  }
  res.json(out);
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
      from: withOnline(toPublicUser(userMap.get(r.from_user_id)), onlineSet),
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
  res.json((users || []).map((u) => withOnline(toPublicUser(u), onlineSet)));
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

app.get("/api/messages/conversations", authenticate, async (req, res) => {
  const me = req.user.id;
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
        user: withOnline(toPublicUser(partner), onlineSet),
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
  const { data: msgs } = await supabase
    .from("messages")
    .select("*")
    .is("conversation_id", null)
    .or(`and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me})`)
    .order("created_at", { ascending: true });
  const unreadIds = (msgs || []).filter((m) => m.to_user_id === me && !m.read).map((m) => m.id);
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
  const isFriend = await areFriends(me, otherId);
  res.json({
    user: withOnline(toPublicUser(other), onlineSet),
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
            (target.from_user_id === otherId && target.to_user_id === me));
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
    await bumpAggregatedNotification({
      userId: otherId,
      sourceKey: `dm:${me}`,
      kind: "dm",
      textForCount: (n) => `💬 (${n}) new message${n === 1 ? "" : "s"} · open Messages`,
      linkPath: `/messages?dm=${encodeURIComponent(me)}`
    });
    if (text) await notifyMentions(text, `a chat from ${req.user.name}`, me, `/messages?dm=${encodeURIComponent(me)}`);

    const [decorated] = await decorateChatMessages([message], me);
    res.status(201).json({ message: decorated });
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
    const { error: upErr } = await supabase.from("anon_userphone_conv_waiting").upsert(
      { conversation_id: gid, queued_by_user_id: me, joined_at: ts },
      { onConflict: "conversation_id" }
    );
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
  await supabase.from("anon_userphone_conv_waiting").delete().eq("conversation_id", gid);
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

  const labelEmoji = { like: "👍", love: "❤️", haha: "😂", wow: "😮", sad: "😢", angry: "😡" };
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
