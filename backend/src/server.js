import dotenv from "dotenv";
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

const { xsltProcess, xmlParse } = xsltProcessor;

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || "siglacast-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "siglacast-dev-refresh-secret";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const DB_PATH = path.resolve("src/data/db.json");
const UPLOAD_ROOT = path.resolve("uploads");

const uploadStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_ROOT),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || "") || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const imageMime = /^image\/(jpeg|png|gif|webp)$/i;
const uploadImage = multer({
  storage: uploadStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (imageMime.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, GIF, or WebP images are allowed"));
  }
});

// OOP + Encapsulation + Inheritance
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

// OOP + Polymorphism
class VoteStrategy {
  tally() { throw new Error("Implement tally()"); }
}
class SingleVoteStrategy extends VoteStrategy {
  tally(votes) {
    return votes.reduce((acc, v) => {
      acc[v.candidateId] = (acc[v.candidateId] || 0) + 1;
      return acc;
    }, {});
  }
}
class WeightedVoteStrategy extends VoteStrategy {
  tally(votes) {
    return votes.reduce((acc, v) => {
      acc[v.candidateId] = (acc[v.candidateId] || 0) + Number(v.weight || 1);
      return acc;
    }, {});
  }
}

// Messaging broker abstraction
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
  async connect() {
    await this.producer.connect();
    await this.consumer.connect();
  }
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

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    course: user.course || null,
    avatarUrl: user.avatarUrl || null
  };
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, type: "access" }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: "refresh" }, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
}

function mapCandidateCounts(event, tally) {
  return event.candidates.map((candidate) => ({
    ...candidate,
    votes: Number(tally[candidate.id] || 0)
  }));
}

const db = { users: [], events: [], votes: [], posts: [], announcements: [], notifications: {} };
let saveQueue = Promise.resolve();

async function saveDb() {
  const snapshot = JSON.stringify(db, null, 2);
  saveQueue = saveQueue.then(() => fs.writeFile(DB_PATH, snapshot, "utf8"));
  await saveQueue;
}

async function seedDbIfEmpty() {
  if (db.users.length > 0) return;

  const studentPasswordHash = await bcrypt.hash("student123", 10);
  const adminPasswordHash = await bcrypt.hash("admin123", 10);
  const now = new Date().toISOString();

  db.users = [
    { id: "s1", role: "student", name: "Ana Cruz", email: "ana@dorsu.edu.ph", passwordHash: studentPasswordHash, refreshTokenHash: null, avatarUrl: null, course: "BSIT" },
    { id: "a1", role: "admin", name: "System Admin", email: "admin@dorsu.edu.ph", passwordHash: adminPasswordHash, refreshTokenHash: null, avatarUrl: null, permissions: ["all"] }
  ];
  db.events = [
    {
      id: "e1",
      title: "Student Election 2026",
      description: "Campus-wide election for student council officers.",
      rules: "Each student may cast one vote. Choose the team you believe will best represent the student body.",
      status: "open",
      strategy: "single",
      maxVotesPerUser: 1,
      coverImageUrl: null,
      candidates: [
        { id: "c1", name: "Team Sigla", imageUrl: null },
        { id: "c2", name: "Team Bagani", imageUrl: null }
      ]
    }
  ];
  db.votes = [];
  db.posts = [{
    id: "p1",
    authorId: "s1",
    author: "Ana Cruz",
    authorAvatar: null,
    content: "Ready to vote!",
    imageUrl: null,
    reactionUserIds: [],
    comments: []
  }];
  db.announcements = [{ id: "an1", title: "Welcome to SiglaCast", message: "Voting is now open for Student Election 2026.", createdAt: now }];
  db.notifications = {
    s1: [{ id: "n1", text: "You are eligible to vote in Student Election 2026.", createdAt: now, read: false }],
    a1: []
  };
  await saveDb();
}

async function loadDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    db.users = Array.isArray(parsed.users) ? parsed.users : [];
    db.events = Array.isArray(parsed.events) ? parsed.events : [];
    db.votes = Array.isArray(parsed.votes) ? parsed.votes : [];
    db.posts = Array.isArray(parsed.posts) ? parsed.posts : [];
    db.announcements = Array.isArray(parsed.announcements) ? parsed.announcements : [];
    db.notifications = parsed.notifications && typeof parsed.notifications === "object" ? parsed.notifications : {};
  } catch {
    await saveDb();
  }

  // One-time migration from plaintext password -> passwordHash.
  let migrated = false;
  for (const user of db.users) {
    if (!user.passwordHash && user.password) {
      user.passwordHash = await bcrypt.hash(user.password, 10);
      delete user.password;
      migrated = true;
    }
  }
  for (const user of db.users) {
    if (typeof user.refreshTokenHash === "undefined") {
      user.refreshTokenHash = null;
      migrated = true;
    }
    if (typeof user.avatarUrl === "undefined") {
      user.avatarUrl = null;
      migrated = true;
    }
  }

  for (const post of db.posts) {
    if (!post.authorId) {
      const match = db.users.find((u) => u.name === post.author);
      post.authorId = match?.id || "unknown";
      migrated = true;
    }
    if (typeof post.imageUrl === "undefined") {
      post.imageUrl = null;
      migrated = true;
    }
    if (!Array.isArray(post.reactionUserIds)) {
      post.reactionUserIds = [];
      migrated = true;
    }
    if (!Array.isArray(post.comments)) {
      post.comments = [];
      migrated = true;
    }
    if (typeof post.authorAvatar === "undefined") {
      const author = db.users.find((u) => u.id === post.authorId);
      post.authorAvatar = author?.avatarUrl || null;
      migrated = true;
    }
  }

  for (const ev of db.events) {
    if (!ev.strategy) {
      ev.strategy = "single";
      migrated = true;
    }
    if (typeof ev.maxVotesPerUser === "undefined") {
      ev.maxVotesPerUser = 1;
      migrated = true;
    }
    if (typeof ev.rules === "undefined") {
      ev.rules = "";
      migrated = true;
    }
    if (typeof ev.coverImageUrl === "undefined") {
      ev.coverImageUrl = null;
      migrated = true;
    }
    for (const c of ev.candidates || []) {
      if (typeof c.imageUrl === "undefined") {
        c.imageUrl = null;
        migrated = true;
      }
    }
  }

  if (migrated) await saveDb();
  await seedDbIfEmpty();
}

const app = express();
app.use(cors());
app.use(express.json());

await loadDb();
await fs.mkdir(UPLOAD_ROOT, { recursive: true });
app.use("/uploads", express.static(UPLOAD_ROOT));

const broker = await makeBroker();
await broker.consume("vote.cast", (m) => console.log("[vote.cast]", m));
await broker.consume("post.created", (m) => console.log("[post.created]", m.id));

app.get("/api/health", (_, res) => res.json({ ok: true }));

function authenticate(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (payload.type !== "access") return res.status(401).json({ error: "Invalid token type" });

  const user = db.users.find((u) => u.id === payload.sub);
  if (!user) return res.status(401).json({ error: "Invalid session" });

  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  return next();
}

function getEventTally(eventId) {
  const event = db.events.find((e) => e.id === eventId);
  if (!event) return null;
  const votes = db.votes.filter((v) => v.eventId === event.id);
  const strategy = event.strategy === "weighted" ? new WeightedVoteStrategy() : new SingleVoteStrategy();
  return strategy.tally(votes);
}

function serializeEventDetail(event, viewerId) {
  const tally = getEventTally(event.id);
  const candidates = mapCandidateCounts(event, tally);
  const myVotes = db.votes
    .filter((v) => v.userId === viewerId && v.eventId === event.id)
    .map((v) => v.candidateId);
  const maxVotesPerUser = typeof event.maxVotesPerUser === "number" ? event.maxVotesPerUser : 1;
  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0);
  return {
    ...event,
    rules: event.rules || "",
    maxVotesPerUser,
    coverImageUrl: event.coverImageUrl || null,
    candidates,
    myVotes,
    myVoteCount: myVotes.length,
    totalVotes,
    voteLimitLabel: maxVotesPerUser === 0 ? "Unlimited votes per person" : `${maxVotesPerUser} vote${maxVotesPerUser === 1 ? "" : "s"} per person`
  };
}

// Auth
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, course = "General" } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "name, email, and password are required" });

  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: `s${db.users.filter((u) => u.role === "student").length + 1}`,
    role: "student",
    name,
    email,
    passwordHash,
    refreshTokenHash: null,
    avatarUrl: null,
    course
  };
  db.users.push(user);
  db.notifications[user.id] = [];
  await saveDb();
  return res.status(201).json({ message: "Registered successfully" });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const valid = await bcrypt.compare(password || "", user.passwordHash || "");
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await saveDb();
  return res.json({ token: accessToken, accessToken, refreshToken, user: toPublicUser(user) });
});

app.post("/api/auth/refresh", async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(401).json({ error: "Refresh token required" });

  let payload;
  try {
    payload = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
  if (payload.type !== "refresh") return res.status(401).json({ error: "Invalid token type" });

  const user = db.users.find((u) => u.id === payload.sub);
  if (!user || !user.refreshTokenHash) return res.status(401).json({ error: "Refresh token not recognized" });

  const valid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!valid) return res.status(401).json({ error: "Refresh token revoked" });

  // Rotate refresh token each time.
  const newAccessToken = signAccessToken(user);
  const newRefreshToken = signRefreshToken(user);
  user.refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
  await saveDb();
  return res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken, user: toPublicUser(user) });
});

app.post("/api/auth/logout", authenticate, async (req, res) => {
  req.user.refreshTokenHash = null;
  await saveDb();
  res.json({ success: true });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

app.patch("/api/profile", authenticate, async (req, res) => {
  try {
    const { name, currentPassword, newPassword } = req.body || {};
    const user = req.user;

    const trimmedName = name !== undefined ? String(name).trim() : "";
    const hasNameUpdate = name !== undefined && trimmedName.length > 0;
    const hasPwdUpdate = Boolean(newPassword);

    if (!hasNameUpdate && !hasPwdUpdate) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    if (hasPwdUpdate) {
      if (!currentPassword) return res.status(400).json({ error: "Current password is required to set a new password" });
      const ok = await bcrypt.compare(String(currentPassword), user.passwordHash || "");
      if (!ok) return res.status(400).json({ error: "Current password is incorrect" });
      if (String(newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
      user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    }

    if (hasNameUpdate) {
      user.name = trimmedName;
      for (const post of db.posts) {
        if (post.authorId === user.id) {
          post.author = trimmedName;
          post.authorAvatar = user.avatarUrl || null;
        }
      }
    }

    await saveDb();
    return res.json({ user: toPublicUser(user) });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
});

app.post("/api/profile/avatar", authenticate, (req, res, next) => {
  uploadImage.single("avatar")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image file provided" });
  const user = req.user;
  user.avatarUrl = `/uploads/${req.file.filename}`;
  for (const post of db.posts) {
    if (post.authorId === user.id) post.authorAvatar = user.avatarUrl;
  }
  await saveDb();
  return res.json({ user: toPublicUser(user) });
});

app.get("/api/events", authenticate, (_, res) => res.json(db.events));
app.get("/api/events/:id", authenticate, (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  return res.json(serializeEventDetail(event, req.user.id));
});

app.post("/api/events", authenticate, requireAdmin, (req, res, next) => {
  uploadImage.single("cover")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const rules = String(req.body.rules || "").trim();
  const strategy = req.body.strategy === "weighted" ? "weighted" : "single";
  let maxVotesPerUser = Number.parseInt(String(req.body.maxVotesPerUser ?? "1"), 10);
  if (!Number.isFinite(maxVotesPerUser) || maxVotesPerUser < 0) maxVotesPerUser = 1;

  const names = String(req.body.candidatesNames || "").split(",").map((s) => s.trim()).filter(Boolean);
  const urls = String(req.body.candidateImageUrls || "").split(",").map((s) => s.trim());
  if (names.length < 2) {
    return res.status(400).json({ error: "At least two candidate names are required (comma-separated)." });
  }

  const coverImageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const baseId = Date.now();
  const candidates = names.map((name, index) => ({
    id: `c${baseId}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    imageUrl: urls[index] || null
  }));

  const event = {
    id: `e${db.events.length + 1}`,
    title,
    description,
    rules,
    status: "open",
    strategy,
    maxVotesPerUser,
    coverImageUrl,
    candidates
  };
  db.events.push(event);
  await saveDb();
  return res.status(201).json(event);
});

app.post("/api/events/vote", authenticate, async (req, res) => {
  try {
    const { eventId, candidateId, weight = 1 } = req.body;
    const userId = req.user.id;
    const event = db.events.find((e) => e.id === eventId);
    if (!event || event.status !== "open") throw new Error("Event closed");
    const maxVotes = typeof event.maxVotesPerUser === "number" ? event.maxVotesPerUser : 1;
    const userVoteCount = db.votes.filter((v) => v.userId === userId && v.eventId === eventId).length;
    if (maxVotes > 0 && userVoteCount >= maxVotes) throw new Error("You have reached the vote limit for this event");
    db.votes.push({ id: `v${db.votes.length + 1}`, userId, eventId, candidateId, weight });
    await broker.publish("vote.cast", { userId, eventId, candidateId });

    if (!db.notifications[userId]) db.notifications[userId] = [];
    db.notifications[userId].unshift({
      id: `n${Date.now()}`,
      text: `Your vote was recorded for ${event.title}.`,
      createdAt: new Date().toISOString(),
      read: false
    });
    await saveDb();
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.get("/api/events/:id/tally", authenticate, (req, res) => {
  const event = db.events.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(getEventTally(event.id));
});
function serializePost(post, viewerId) {
  const reactionUserIds = Array.isArray(post.reactionUserIds) ? post.reactionUserIds : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  return {
    id: post.id,
    authorId: post.authorId,
    author: post.author,
    authorAvatar: post.authorAvatar || null,
    content: post.content,
    imageUrl: post.imageUrl || null,
    reactionCount: reactionUserIds.length,
    reactedByMe: Boolean(viewerId && reactionUserIds.includes(viewerId)),
    comments
  };
}

app.get("/api/community/posts", authenticate, (req, res) => {
  const viewerId = req.user.id;
  res.json(db.posts.map((p) => serializePost(p, viewerId)));
});

app.post("/api/community/posts", authenticate, (req, res, next) => {
  uploadImage.single("image")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    next();
  });
}, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content && !req.file) return res.status(400).json({ error: "Add text or an image to your post" });

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const post = {
    id: `p${db.posts.length + 1}`,
    authorId: req.user.id,
    author: req.user.name,
    authorAvatar: req.user.avatarUrl || null,
    content: content || "",
    imageUrl,
    reactionUserIds: [],
    comments: []
  };
  db.posts.unshift(post);
  await broker.publish("post.created", post);
  await saveDb();
  res.status(201).json(serializePost(post, req.user.id));
});

app.post("/api/community/posts/:id/react", authenticate, async (req, res) => {
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found" });
  if (!Array.isArray(post.reactionUserIds)) post.reactionUserIds = [];
  const uid = req.user.id;
  const idx = post.reactionUserIds.indexOf(uid);
  if (idx === -1) post.reactionUserIds.push(uid);
  else post.reactionUserIds.splice(idx, 1);
  await saveDb();
  return res.json({
    reactionCount: post.reactionUserIds.length,
    reactedByMe: post.reactionUserIds.includes(uid)
  });
});

app.post("/api/community/posts/:id/comments", authenticate, async (req, res) => {
  const post = db.posts.find((p) => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found" });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Comment text is required" });
  if (!Array.isArray(post.comments)) post.comments = [];
  const comment = {
    id: `c${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: req.user.id,
    author: req.user.name,
    text,
    createdAt: new Date().toISOString()
  };
  post.comments.push(comment);
  await saveDb();
  return res.status(201).json({ comment, post: serializePost(post, req.user.id) });
});

// Dashboards
app.get("/api/dashboard/student", authenticate, (req, res) => {
  const votedEventIds = db.votes.filter((v) => v.userId === req.user.id).map((v) => v.eventId);
  res.json({
    profile: toPublicUser(req.user),
    metrics: {
      openEvents: db.events.filter((e) => e.status === "open").length,
      participatedEvents: votedEventIds.length,
      totalPosts: db.posts.filter((p) => p.authorId === req.user.id).length
    },
    upcomingEvents: db.events.filter((e) => e.status === "open").slice(0, 5)
  });
});

app.get("/api/dashboard/admin", authenticate, requireAdmin, (req, res) => {
  res.json({
    profile: toPublicUser(req.user),
    metrics: {
      registeredStudents: db.users.filter((u) => u.role === "student").length,
      activeEvents: db.events.filter((e) => e.status === "open").length,
      totalVotes: db.votes.length,
      announcements: db.announcements.length
    },
    recentVotes: db.votes.slice(-10).reverse()
  });
});

// Announcements + notifications
app.get("/api/announcements", authenticate, (_, res) => {
  res.json(db.announcements);
});

app.post("/api/announcements", authenticate, requireAdmin, async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) return res.status(400).json({ error: "title and message are required" });

  const announcement = {
    id: `an${db.announcements.length + 1}`,
    title,
    message,
    createdAt: new Date().toISOString()
  };
  db.announcements.unshift(announcement);

  for (const user of db.users) {
    if (!db.notifications[user.id]) db.notifications[user.id] = [];
    db.notifications[user.id].unshift({
      id: `n${Date.now()}-${user.id}`,
      text: `New announcement: ${title}`,
      createdAt: new Date().toISOString(),
      read: false
    });
  }
  await broker.publish("announcement.created", announcement);
  await saveDb();
  return res.status(201).json(announcement);
});

app.get("/api/notifications", authenticate, (req, res) => {
  res.json(db.notifications[req.user.id] || []);
});

// XML and XML parsing
function toXml(events) {
  return create({ version: "1.0" }).ele("events").ele(
    events.map((e) => ({ event: { "@id": e.id, title: e.title, status: e.status, strategy: e.strategy } }))
  ).end({ prettyPrint: true });
}
app.get("/api/xml/events.xml", authenticate, (_, res) => {
  res.type("application/xml").send(toXml(db.events));
});
app.post("/api/xml/parse", authenticate, express.text({ type: ["application/xml", "text/xml"] }), (req, res) => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  try {
    res.json(parser.parse(req.body || ""));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// XSL / XSLT
app.get("/api/xml/events.html", authenticate, async (_, res) => {
  const xml = toXml(db.events);
  const xslPath = path.resolve("src/xslt/events.xsl");
  const xsl = await fs.readFile(xslPath, "utf8");
  const html = xsltProcess(xmlParse(xml), xmlParse(xsl));
  res.type("text/html").send(html);
});

app.listen(Number(process.env.PORT || 4000), () => {
  console.log("SiglaCast backend on http://localhost:4000");
});
