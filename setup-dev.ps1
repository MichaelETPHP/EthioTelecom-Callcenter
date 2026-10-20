# One-time setup for a new developer on this machine. Run once, then use
# start-dev.bat (or run call/app.py directly) for everyday dev.
#
#   powershell -ExecutionPolicy Bypass -File setup-dev.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "=== Ethio SMS Platform - dev setup ===" -ForegroundColor Cyan

# --- 1. Check prerequisites -------------------------------------------------
function Test-Command($name) {
    $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "python")) {
    Write-Host "Python not found on PATH. Install Python 3.10+ first: https://python.org" -ForegroundColor Red
    exit 1
}
Write-Host "[ok] python found: $(python --version)"

if (-not (Test-Command "go")) {
    Write-Host "[warn] go not found on PATH - you can still run the call center console, but not sms-gateway-server locally (start-dev.bat needs it). Install from https://go.dev if you need it." -ForegroundColor Yellow
} else {
    Write-Host "[ok] go found: $(go version)"
}

# --- 2. Create .env from the template, without overwriting one that exists -
$envPath = Join-Path $root ".env"
$envExamplePath = Join-Path $root ".env.example"

if (Test-Path $envPath) {
    Write-Host "[ok] .env already exists - leaving it alone"
} else {
    Copy-Item $envExamplePath $envPath
    Write-Host "[ok] Created .env from .env.example - fill in real values before running anything" -ForegroundColor Yellow
    Write-Host "     At minimum you need: SIP_USERNAME/SIP_PASSWORD (ask whoever manages telecontactcenter.et)," -ForegroundColor Yellow
    Write-Host "     and either SMS_PROVIDER=android + ANDROID_SMS_GATEWAY_* or leave SMS single-SMS untested for now." -ForegroundColor Yellow
}

# --- 3. Install the call app's Python dependencies --------------------------
Write-Host "Installing call/requirements.txt ..."
python -m pip install -r (Join-Path $root "call\requirements.txt")

Write-Host ""
Write-Host "=== Setup done ===" -ForegroundColor Cyan
Write-Host "Next steps:"
Write-Host "  1. Open .env and fill in the real SIP/AfroMessage/etc. credentials"
Write-Host "     you actually need (ask the project owner, don't guess)."
Write-Host "  2. Read call/README.md for how each feature works (agent seats,"
Write-Host "     Bulk SMS vs single SMS, click-to-call, embedding in another app)."
Write-Host "  3. Run start-dev.bat to start both services, OR just"
Write-Host "     'cd call; python app.py' for the call console alone."
Write-Host "     NOTE: start-dev.bat hardcodes a Go SDK path (GOBIN_DIR) for this"
Write-Host "     machine - if go is already on your PATH, you can likely delete"
Write-Host "     that line/prefix in start-dev.bat; otherwise point it at your own install."
Write-Host "  4. See DEPLOY.md when you're ready to deploy, not just run locally."
