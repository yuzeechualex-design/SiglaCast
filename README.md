# SiglaCast

Voting and community application for Davao Oriental State University events. Built for the **ITP 121  Integrative Programming and Technologies 1** course.

## Stack

- **Frontend:** React + Vite + React Router (deployed on Vercel)
- **Backend:** Node.js + Express REST API (deployed on Render)
- **Database:** Supabase Postgres
- **File storage:** Supabase Storage (avatars, post images, event covers)
- **Auth:** JWT access + refresh tokens with bcrypt password hashing
- **Optional broker:** RabbitMQ or Kafka (auto-falls back to in-memory)
- **Optional Sigla Assistant:** Groq chat API behind `POST /api/assistant/chat` (set `GROQ_API_KEY` on the backend)

## Integrative programming topics covered

1. **OOP**  `User`, `Student`, `Admin` (inheritance + private fields = encapsulation); `VoteStrategy`, `SingleVoteStrategy`, `WeightedVoteStrategy` (polymorphism)
2. **Messaging broker**  `RabbitBroker`, `KafkaBroker`, `InMemoryBroker` for `vote.cast`, `post.created`, `announcement.created`, `message.sent` events
3. **XML / XML parsing**  `GET /api/xml/events.xml`, `POST /api/xml/parse`
4. **XSL / XSLT**  `GET /api/xml/events.html`
5. **Scripting languages**  JavaScript backend, frontend, and admin scripts
6. **Scripting for system administration**  `backend/scripts/admin/setup-env.ps1` and `setup-env.sh`
7. **Advanced scripting techniques**  `monitor-queue.js` with CLI arguments + live terminal refresh

## Quick start (local)

```bash
# 1. Backend
cd backend
cp .env.example .env
# Edit .env: paste SUPABASE_SERVICE_ROLE_KEY from your Supabase dashboard
npm install
npm run dev

# 2. Frontend
cd ../frontend
cp .env.example .env       # default points at http://localhost:4000
npm install
npm run dev
# Open http://localhost:5173
```

## Demo accounts

| Email | Password | Role |
|-------|----------|------|
| `ana@dorsu.edu.ph` | `student123` | student |
| `admin@dorsu.edu.ph` | `admin123` | admin |

## Hosted deployment

See [`DEPLOY.md`](./DEPLOY.md) for the full Supabase + Render + Vercel guide.

## Database schema

See [`supabase/migrations/0001_initial_schema.sql`](./supabase/migrations/0001_initial_schema.sql).

## Theme

Blue, yellow, and white DORSU-inspired UI with Inter font and emoji-tagged navigation.
