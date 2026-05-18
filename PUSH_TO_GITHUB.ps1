# SiglaCast - commit Supabase migration + push to GitHub
# Right-click > Run with PowerShell, or paste line by line.
$ErrorActionPreference = "Stop"

Set-Location "C:\Users\lexca\.cursor\projects\empty-window\siglacast"

Write-Host "==> Removing tracked node_modules / db.json / uploads from index..." -ForegroundColor Cyan
git rm -r --cached --ignore-unmatch backend/node_modules 2>$null | Out-Null
git rm -r --cached --ignore-unmatch frontend/node_modules 2>$null | Out-Null
git rm -r --cached --ignore-unmatch backend/uploads 2>$null | Out-Null
git rm --cached --ignore-unmatch backend/src/data/db.json 2>$null | Out-Null

Write-Host "==> Staging changes..." -ForegroundColor Cyan
git add -A

Write-Host "==> Current status:" -ForegroundColor Cyan
git status --short

$msg = @"
Migrate from db.json to Supabase + add Render/Vercel hosting

- Postgres schema: users, events, candidates, votes, posts, post_reactions,
  post_comments, announcements, notifications, friends, messages
- Supabase Storage buckets: avatars, posts, events (replaces local uploads/)
- New backend/src/supabase.js client with service_role
- Server.js rewritten to use Supabase queries (no more db.json saveDb)
- multer memory storage + uploadToBucket helper
- Frontend mediaUrl() helper supports absolute Supabase URLs
- VITE_API_BASE_URL for configurable backend origin
- render.yaml blueprint, vercel.json SPA rewrite
- supabase/migrations/0001_initial_schema.sql for reproducibility
- DEPLOY.md step-by-step guide
- Kept JWT/bcrypt auth and all integrative programming topics
"@

Write-Host "==> Committing..." -ForegroundColor Cyan
git commit -m $msg

Write-Host "==> Pushing to origin/main..." -ForegroundColor Cyan
git push origin main

Write-Host "Done." -ForegroundColor Green
Read-Host "Press Enter to close"
