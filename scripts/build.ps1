# scripts/build.ps1
# Full production build pipeline for GSSG Manager v4.0.0.
#
# Steps (in order):
#   1. Build frontend (pnpm run build)
#   2. Copy frontend/dist/* -> backend/app/static/
#   3. Regenerate OpenAPI JSON (used by gen:api in dev and baked into /openapi.json route)
#   4. PyInstaller — produces dist/GSSG-Manager/ onedir build
#   5. post_build.py — fix native-package truncation (fitz, pymupdf, etc.)
#
# Skip flags for incremental builds:
#   -SkipFrontend   skip steps 1-2 (use when only Python changed)
#   -SkipOpenApi    skip step 3
#   -SkipPyInstaller skip steps 4-5 (use when only building for dev)
#
# Usage:
#   .\scripts\build.ps1
#   .\scripts\build.ps1 -SkipFrontend
#   .\scripts\build.ps1 -SkipPyInstaller   # fast: just rebuild the static bundle

[CmdletBinding()]
param(
    [switch] $SkipFrontend,
    [switch] $SkipOpenApi,
    [switch] $SkipPyInstaller,
    [int]    $MaxBundleKB = 5120    # warn if JS assets exceed this (5 MB)
)

$ErrorActionPreference = 'Stop'

$root        = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $root 'frontend'
$staticDir   = Join-Path $root 'backend\app\static'
$venvPy      = Join-Path $root 'venv\Scripts\python.exe'

if (-not (Test-Path $venvPy)) {
    throw "venv Python not found at $venvPy. Recreate with: uv venv --python 3.12 venv"
}

# ── Step 3: Regenerate OpenAPI ────────────────────────────────────────────────
# Done before the frontend build so gen:api picks up any schema changes.
if (-not $SkipOpenApi) {
    Write-Host "[3/5] Dumping OpenAPI schema ..." -ForegroundColor Cyan
    & $venvPy -X utf8 (Join-Path $root 'scripts\dump_openapi.py')
    if ($LASTEXITCODE -ne 0) { throw "OpenAPI dump failed" }
} else {
    Write-Host "[3/5] OpenAPI dump skipped (-SkipOpenApi)." -ForegroundColor DarkGray
}

# ── Step 1+2: Frontend build + copy ──────────────────────────────────────────
if (-not $SkipFrontend) {
    Write-Host "[1/5] Building frontend ..." -ForegroundColor Cyan
    Push-Location $frontendDir
    try {
        if (Test-Path (Join-Path $root 'backend\openapi.json')) {
            pnpm run gen:api
            if ($LASTEXITCODE -ne 0) { throw "openapi-typescript generation failed" }
        }
        pnpm run build
        if ($LASTEXITCODE -ne 0) { throw "pnpm run build failed" }
    } finally {
        Pop-Location
    }

    $distDir = Join-Path $frontendDir 'dist'
    if (-not (Test-Path $distDir)) { throw "Expected frontend build output not found at $distDir" }

    Write-Host "[2/5] Copying dist -> backend/app/static ..." -ForegroundColor Cyan
    if (Test-Path $staticDir) {
        Get-ChildItem -Path $staticDir -Force | Remove-Item -Recurse -Force
    } else {
        New-Item -ItemType Directory -Path $staticDir | Out-Null
    }
    Copy-Item -Path (Join-Path $distDir '*') -Destination $staticDir -Recurse -Force

    $assetsDir = Join-Path $staticDir 'assets'
    if (Test-Path $assetsDir) {
        $totalKB = (Get-ChildItem $assetsDir -File | Measure-Object -Property Length -Sum).Sum / 1KB
        $totalKB = [math]::Round($totalKB, 1)
        Write-Host ("    Bundle size: {0} KB" -f $totalKB) -ForegroundColor Cyan
        if ($totalKB -gt $MaxBundleKB) {
            Write-Warning "Bundle size $totalKB KB exceeds budget $MaxBundleKB KB."
        }
    }
} else {
    Write-Host "[1/5] Frontend build skipped (-SkipFrontend)." -ForegroundColor DarkGray
    Write-Host "[2/5] Static copy skipped (-SkipFrontend)." -ForegroundColor DarkGray
}

# ── Step 4: PyInstaller ───────────────────────────────────────────────────────
if (-not $SkipPyInstaller) {
    Write-Host "[4/5] Running PyInstaller ..." -ForegroundColor Cyan
    $specFile = Join-Path $root 'GSSG_Manager.spec'
    if (-not (Test-Path $specFile)) {
        throw "Spec file not found: $specFile"
    }
    & $venvPy -m PyInstaller $specFile --noconfirm
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

    # ── Step 5: post_build fix-ups ────────────────────────────────────────────
    Write-Host "[5/5] Running post_build.py ..." -ForegroundColor Cyan
    & $venvPy (Join-Path $root 'scripts\post_build.py')
    if ($LASTEXITCODE -ne 0) { throw "post_build.py failed" }
} else {
    Write-Host "[4/5] PyInstaller skipped (-SkipPyInstaller)." -ForegroundColor DarkGray
    Write-Host "[5/5] post_build skipped (-SkipPyInstaller)." -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Build complete." -ForegroundColor Green

if (-not $SkipPyInstaller) {
    $distPath = Join-Path $root 'dist\GSSG-Manager'
    if (Test-Path $distPath) {
        $sizeMB = (Get-ChildItem $distPath -Recurse -File |
                   Measure-Object -Property Length -Sum).Sum / 1MB
        $sizeMB = [math]::Round($sizeMB, 1)
        Write-Host ("    dist/GSSG-Manager/  {0} MB" -f $sizeMB) -ForegroundColor Cyan
    }
    Write-Host "    Executable: dist\GSSG-Manager\GSSG-Manager.exe" -ForegroundColor Cyan
}
