# SiglaCast — Deploy to Supabase + Render + Vercel

SiglaCast has been migrated from `db.json` to **Supabase Postgres** and **Supabase Storage**. The backend is deployed to **Render** (free) and the frontend to **Vercel** (free).

---

## 1. Supabase (already provisioned)

- **Project:** `siglacast`
- **URL:** `https://jhwqsnfbblhgaxvewrrd.supabase.co`
- **Region:** Southeast Asia (Singapore)
- **Tables:** `users`, `events`, `candidates`, `votes`, `posts`, `post_reactions`, `post_comments`, `announcements`, `notifications`, `friends`, `messages`
- **Storage buckets** (all public): `avatars`, `posts`, `events`

### Get the `SUPABASE_SERVICE_ROLE_KEY`

1. Open [Supabase dashboard](https://supabase.com/dashboard/project/jhwqsnfbblhgaxvewrrd/settings/api-keys)
2. Reveal the **`service_role`** secret
3. Copy it — you'll paste it into Render and your local `.env`

> **Never** put the service role key in the frontend or commit it to GitHub.

---

## 2. Local development

```bash
# Backend
cd siglacast/backend
cp .env.example .env
# Edit .env, paste SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev

# Frontend (new terminal)
cd siglacast/frontend
cp .env.example .env
npm install
npm run dev
```

---

## 3. Deploy backend to Render

1. Push the repo to GitHub (already at `https://github.com/yuzeechualex-design/SiglaCast`).
2. Go to <https://dashboard.render.com> → **New +** → **Blueprint**.
3. Connect the GitHub repo. Render reads `render.yaml` automatically.
4. When prompted for env vars:
   - `SUPABASE_URL` → `https://jhwqsnfbblhgaxvewrrd.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` → paste the secret from step 1
   - `FRONTEND_ORIGIN` → put `*` for now, change to your Vercel URL later
5. Click **Apply**. Render builds the backend.
6. Once live, note the URL (e.g. `https://siglacast-backend.onrender.com`).

Test it:

```
https://siglacast-backend.onrender.com/api/health  →  { "ok": true }
```

> Free tier spins down after 15 min idle. First request after sleep takes ~30 sec.

---

## 4. Deploy frontend to Vercel

1. Go to <https://vercel.com/new> → import the same GitHub repo.
2. **Root Directory** → `frontend`
3. Framework preset: **Vite** (auto-detected)
4. Environment variable:
   - `VITE_API_BASE_URL` → your Render URL (e.g. `https://siglacast-backend.onrender.com`)
5. Click **Deploy**.

Vercel gives you a URL like `https://siglacast.vercel.app`.

### Lock CORS to Vercel

Back in Render → your service → **Environment** → set `FRONTEND_ORIGIN` to your Vercel URL (e.g. `https://siglacast.vercel.app`) and redeploy.

---

## 5. Demo accounts

| Email | Password | Role |
|-------|----------|------|
| `ana@dorsu.edu.ph` | `student123` | student |
| `admin@dorsu.edu.ph` | `admin123` | admin |

You can also register new accounts from the login page.

---

## 6. What changed from the JSON version

- Storage: `db.json` → Supabase Postgres (with foreign keys + indexes)
- Uploads: local `uploads/` → Supabase Storage public buckets
- API now returns full image URLs (e.g. `https://....supabase.co/storage/v1/object/public/avatars/xxx.png`)
- Frontend uses `mediaUrl()` helper that supports both absolute and legacy URLs
- New env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_ORIGIN`, `VITE_API_BASE_URL`
- Backend still uses JWT + bcrypt (kept simple for integrative programming demo)
- Integrative topics still wired: OOP (User/Strategy classes), broker (Rabbit/Kafka/in-memory), XML + XSLT, scripting
