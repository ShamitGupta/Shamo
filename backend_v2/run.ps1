# Start the tutor API for local development.
#
#   .\backend_v2\run.ps1            # port 8000
#   .\backend_v2\run.ps1 -Port 8001
#
# Wraps two Windows papercuts that cost time otherwise:
#
#   WinError 10013 -- "socket ... forbidden by its access permissions". Almost
#   always a previous server still holding the port rather than a permissions
#   problem, and the message points nowhere useful. This reports the process
#   that has it, by name, so the fix is obvious.
#
#   UnicodeEncodeError on '\U0001f680' -- `fastapi dev` prints a rocket emoji
#   and the default console encoding is cp1252. Setting PYTHONIOENCODING=utf-8
#   avoids it. This script uses uvicorn, which prints no emoji, but sets the
#   variable anyway so a stray emoji anywhere cannot take the server down.

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".env")) {
    Write-Host "No backend_v2/.env found." -ForegroundColor Yellow
    Write-Host "Copy .env.example to .env and fill in SUPABASE_URL," -ForegroundColor Yellow
    Write-Host "SUPABASE_SERVICE_ROLE_KEY (service role, not anon) and OPENAI_API_KEY." -ForegroundColor Yellow
    exit 1
}

$holder = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($holder) {
    $owner = Get-Process -Id $holder.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "Port $Port is already in use by PID $($holder.OwningProcess) ($($owner.ProcessName))." -ForegroundColor Yellow
    Write-Host "Stop it with:  Stop-Process -Id $($holder.OwningProcess) -Force" -ForegroundColor Yellow
    Write-Host "Or pick another port:  .\run.ps1 -Port 8001" -ForegroundColor Yellow
    exit 1
}

$env:PYTHONIOENCODING = "utf-8"
Write-Host "Tutor API on http://127.0.0.1:$Port  (Ctrl+C to stop)" -ForegroundColor Green
python -m uvicorn app.main:app --reload --port $Port
