# =============================================================
# Nordskar PIMS — Deploy Script
# Cloudflare Pages (Direct Upload) + GitHub backup
# =============================================================
# Utilizare:
#   .\deploy.ps1                  → deploy standard
#   .\deploy.ps1 -Message "fix"   → deploy cu mesaj custom
#   .\deploy.ps1 -DryRun          → preview fara upload
# =============================================================

param(
    [string]$Message = "",
    [switch]$DryRun
)

Set-Location $PSScriptRoot
$ErrorActionPreference = "Stop"

function Write-Step($text) { Write-Host "`n► $text" -ForegroundColor Cyan }
function Write-Ok($text)   { Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Err($text)  { Write-Host "  ✗ $text" -ForegroundColor Red }

# ── 1. Build / pregătire ──────────────────────────────────────
Write-Step "1. Pregătire deploy-demo/"
Copy-Item demo.html deploy-demo\index.html -Force
Write-Ok "demo.html → deploy-demo/index.html"

# Verificare fișier
$size = [math]::Round((Get-Item deploy-demo\index.html).Length / 1KB, 1)
Write-Ok "Dimensiune: ${size} KB"

if ($DryRun) {
    Write-Host "`n[DryRun] Oprire înainte de upload." -ForegroundColor Yellow
    exit 0
}

# ── 2. Deploy Cloudflare Pages ────────────────────────────────
Write-Step "2. Deploy → Cloudflare Pages"
npx wrangler pages deploy deploy-demo `
    --project-name nordskar-pims-demo `
    --commit-dirty=true 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Err "Deploy Cloudflare eșuat (exit $LASTEXITCODE)"
    exit 1
}
Write-Ok "Live: https://nordskar-pims-demo.pages.dev"

# ── 3. GitHub backup ──────────────────────────────────────────
Write-Step "3. Push → GitHub (backup + istoric)"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$commitMsg = if ($Message) { $Message } else { "deploy: $timestamp" }

git add deploy-demo/index.html demo.html deploy.ps1
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m $commitMsg
    git push origin main
    Write-Ok "Committed: $commitMsg"
} else {
    Write-Ok "Nicio modificare față de ultimul commit — skip push"
}

# ── Done ──────────────────────────────────────────────────────
Write-Host "`n════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Deploy complet!" -ForegroundColor Green
Write-Host "  URL: https://nordskar-pims-demo.pages.dev" -ForegroundColor Green
Write-Host "════════════════════════════════════════`n" -ForegroundColor Green
