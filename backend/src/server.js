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

import { supabase, toPublicUser, toEvent, toCandidate, uploadToBucket } from "./supabase.js";

const { xsltProcess, xmlParse } = xsltProcessor;

const JWT_SECRET = process.env.JWT_SECRET || "siglacast-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "siglacast-dev-refresh-secret";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

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
  if (comments?.length) {
    const authorIds = [...new Set(comments.map((c) => c.author_id))];
    const { data: users } = await supabase.from("users").select("id, name, avatar_url").in("id", authorIds);
    commentAuthors = new Map((users || []).map((u) => [u.id, u]));
  }

  // Build a 2-level comment tree: top-level comments each get a `replies` array.
  // Replies of replies are flattened under their nearest top-level parent so the
  // UI stays readable (Facebook style).
  const flat = (comments || []).map((c) => {
    const a = commentAuthors.get(c.author_id);
    return {
      id: c.id,
      parentId: c.parent_id || null,
      userId: c.author_id,
      author: a?.name || "Unknown",
      authorAvatar: a?.avatar_url || null,
      text: c.content,
      createdAt: c.created_at
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
async function areFriends(a, b) {
  const { data } = await supabase
    .from("friends")
    .select("id")
    .or(`and(user_id.eq.${a},friend_id.eq.${b}),and(user_id.eq.${b},friend_id.eq.${a})`)
    .limit(1);
  return Boolean(data?.length);
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
    const { name, email, password, course = "General" } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: "name, email, and password are required" });
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
    const { name, currentPassword, newPassword } = req.body || {};
    const updates = {};
    const trimmedName = name !== undefined ? String(name).trim() : "";
    if (trimmedName) updates.name = trimmedName;
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
    await supabase.from("notifications").insert({
      id: `n${Date.now()}-${userId}`,
      user_id: userId,
      text: `Your vote was recorded for ${event.title}.`,
      read: false
    });
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

  if (existing) {
    if (wantClear || existing.reaction === reaction) {
      // Toggle off if same reaction or explicit clear
      await supabase.from("post_reactions").delete().eq("post_id", post_id).eq("user_id", req.user.id);
    } else {
      await supabase
        .from("post_reactions")
        .update({ reaction })
        .eq("post_id", post_id)
        .eq("user_id", req.user.id);
    }
  } else if (!wantClear) {
    await supabase.from("post_reactions").insert({ post_id, user_id: req.user.id, reaction });
  }

  const { data: post } = await supabase.from("posts").select("*").eq("id", post_id).maybeSingle();
  if (!post) return res.status(404).json({ error: "Post not found" });
  res.json(await serializePost(post, req.user.id));
});

app.post("/api/community/posts/:id/comments", authenticate, async (req, res) => {
  try {
    const post_id = req.params.id;
    const text = String(req.body?.text || "").trim();
    const parentId = req.body?.parentId ? String(req.body.parentId) : null;
    if (!text) return res.status(400).json({ error: "Comment text is required" });

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
      .insert({ id, post_id, author_id: req.user.id, content: text, parent_id: parentId });
    if (error) return res.status(400).json({ error: error.message });
    const { data: post } = await supabase.from("posts").select("*").eq("id", post_id).maybeSingle();
    res.status(201).json({ comment: { id, text, author: req.user.name, parentId }, post: await serializePost(post, req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
    const notes = (users || []).map((u) => ({
      id: `n${Date.now()}-${u.id}-${Math.random().toString(36).slice(2, 5)}`,
      user_id: u.id,
      text: `New announcement: ${title}`,
      read: false
    }));
    if (notes.length) await supabase.from("notifications").insert(notes);
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
  await supabase.from("post_comments").delete().eq("author_id", id);
  await supabase.from("messages").delete().or(`from_user_id.eq.${id},to_user_id.eq.${id}`);
  await supabase.from("friends").delete().or(`user_id.eq.${id},friend_id.eq.${id}`);
  await supabase.from("notifications").delete().eq("user_id", id);
  await supabase.from("votes").delete().eq("user_id", id);

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
  res.json((data || []).map((n) => ({ id: n.id, text: n.text, read: n.read, createdAt: n.created_at })));
});

// Messaging + friends
app.get("/api/users/search", authenticate, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const { data } = await supabase
    .from("users")
    .select("id, name, email, role, course, avatar_url")
    .neq("id", req.user.id)
    .or(`name.ilike.%${q}%,email.ilike.%${q}%,course.ilike.%${q}%`)
    .limit(12);
  const out = [];
  for (const u of data || []) {
    out.push({ ...toPublicUser(u), isFriend: await areFriends(req.user.id, u.id) });
  }
  res.json(out);
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
  res.json((users || []).map(toPublicUser));
});

app.post("/api/friends/:friendId", authenticate, async (req, res) => {
  const friendId = req.params.friendId;
  if (friendId === req.user.id) return res.status(400).json({ error: "You cannot add yourself" });
  const friend = await fetchUserById(friendId);
  if (!friend) return res.status(404).json({ error: "User not found" });
  if (await areFriends(req.user.id, friendId)) return res.status(400).json({ error: "Already friends" });
  const id = `fr${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const { error } = await supabase.from("friends").insert({ id, user_id: req.user.id, friend_id: friendId });
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ friend: toPublicUser(friend) });
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
  const [{ data: friendsRows }, { data: msgs }] = await Promise.all([
    supabase.from("friends").select("user_id, friend_id").or(`user_id.eq.${me},friend_id.eq.${me}`),
    supabase
      .from("messages")
      .select("*")
      .or(`from_user_id.eq.${me},to_user_id.eq.${me}`)
      .order("created_at", { ascending: true })
  ]);

  const partners = new Set();
  for (const f of friendsRows || []) partners.add(f.user_id === me ? f.friend_id : f.user_id);
  for (const m of msgs || []) partners.add(m.from_user_id === me ? m.to_user_id : m.from_user_id);
  if (!partners.size) return res.json([]);

  const { data: users } = await supabase.from("users").select("*").in("id", [...partners]);
  const userMap = new Map((users || []).map((u) => [u.id, u]));
  const list = [];
  for (const pid of partners) {
    const partner = userMap.get(pid);
    if (!partner) continue;
    const thread = (msgs || []).filter(
      (m) => (m.from_user_id === me && m.to_user_id === pid) || (m.from_user_id === pid && m.to_user_id === me)
    );
    const last = thread[thread.length - 1] || null;
    const unread = thread.filter((m) => m.to_user_id === me && !m.read).length;
    list.push({
      user: toPublicUser(partner),
      isFriend: (friendsRows || []).some(
        (f) => (f.user_id === me && f.friend_id === pid) || (f.user_id === pid && f.friend_id === me)
      ),
      lastMessage: last
        ? { text: last.text, createdAt: last.created_at, fromMe: last.from_user_id === me }
        : null,
      unreadCount: unread
    });
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
    .or(`and(from_user_id.eq.${me},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${me})`)
    .order("created_at", { ascending: true });
  const unreadIds = (msgs || []).filter((m) => m.to_user_id === me && !m.read).map((m) => m.id);
  if (unreadIds.length) await supabase.from("messages").update({ read: true }).in("id", unreadIds);
  res.json({
    user: toPublicUser(other),
    isFriend: await areFriends(me, otherId),
    messages: (msgs || []).map((m) => ({
      id: m.id,
      text: m.text,
      createdAt: m.created_at,
      fromMe: m.from_user_id === me,
      fromUserId: m.from_user_id
    }))
  });
});

app.post("/api/messages/with/:userId", authenticate, async (req, res) => {
  try {
    const me = req.user.id;
    const otherId = req.params.userId;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Message text is required" });
    if (otherId === me) return res.status(400).json({ error: "Cannot message yourself" });
    const other = await fetchUserById(otherId);
    if (!other) return res.status(404).json({ error: "User not found" });
    const id = `msg${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const { data: message, error } = await supabase
      .from("messages")
      .insert({ id, from_user_id: me, to_user_id: otherId, text, read: false })
      .select()
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    await broker.publish("message.sent", { id, fromUserId: me, toUserId: otherId });
    await supabase.from("notifications").insert({
      id: `n${Date.now()}-${otherId}-${Math.random().toString(36).slice(2, 5)}`,
      user_id: otherId,
      text: `New message from ${req.user.name}`,
      read: false
    });
    res.status(201).json({
      message: {
        id: message.id,
        text: message.text,
        createdAt: message.created_at,
        fromMe: true,
        fromUserId: me
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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
