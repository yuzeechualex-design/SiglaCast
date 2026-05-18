# SiglaCast - push current changes to GitHub
# Run this in PowerShell (right-click > Run with PowerShell) OR paste line by line.
$ErrorActionPreference = "Stop"

Set-Location "C:\Users\lexca\.cursor\projects\empty-window\siglacast"

Write-Host "==> Removing tracked node_modules from index (keeps files on disk)..." -ForegroundColor Cyan
git rm -r --cached --ignore-unmatch backend/node_modules 2>$null | Out-Null
git rm -r --cached --ignore-unmatch frontend/node_modules 2>$null | Out-Null

Write-Host "==> Staging changes..." -ForegroundColor Cyan
git add -A

Write-Host "==> Current status:" -ForegroundColor Cyan
git status --short

$msg = @"
Add messaging feature, JWT refresh, profile/avatar, and capstone docs

- Private messages with friends, search, conversations
- JWT refresh tokens + bcrypt password hashing
- Profile editing and avatar upload
- Community posts with images, reactions, comments
- Announcements and notifications
- RabbitMQ/Kafka broker abstraction with in-memory fallback
- XML and XSLT endpoints for events
- Admin scripts (setup-env, monitor-queue)
- Capstone documentation template (Chapters 1 & 2)
- .gitignore for node_modules, .env, uploads
"@

Write-Host "==> Committing..." -ForegroundColor Cyan
git commit -m $msg

Write-Host "==> Pushing to origin/main..." -ForegroundColor Cyan
git push origin main

Write-Host "Done." -ForegroundColor Green
Read-Host "Press Enter to close"
