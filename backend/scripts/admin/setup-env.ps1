param([string]$Target = "dev")
Write-Host "SiglaCast setup ($Target)" -ForegroundColor Cyan
if (!(Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host ".env created" -ForegroundColor Green }
Write-Host "Done." -ForegroundColor Green
