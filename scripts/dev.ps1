# scripts/dev.ps1
# Launches backend (uvicorn --reload) and frontend (vite) in two new PowerShell windows.
#
# Backend: 127.0.0.1:8765 with reload — matches frontend/vite.config.ts proxy target.
# Frontend: 127.0.0.1:5173 with /api proxied to 8765.
# to test run the app From the project root (path-with-space matters):
# powershell.exe -ExecutionPolicy Bypass -File ".\scripts\dev.ps1"

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venvPy = Join-Path $root 'venv\Scripts\python.exe'
$frontendDir = Join-Path $root 'frontend'

if (-not (Test-Path $venvPy)) {
    Write-Error "Python venv not found at $venvPy. Run 'uv venv --python 3.12 venv' first."
}
# Check for the vite shim, not just the folder — a partially deleted/interrupted
# install leaves node_modules present but .bin gutted ('vite' is not recognized).
if (-not (Test-Path (Join-Path $frontendDir 'node_modules\.bin\vite.cmd'))) {
    Write-Error "frontend/node_modules is missing or incomplete (no .bin\vite.cmd). Run 'pnpm install' in frontend/ first."
}

# A leftover backend silently keeps winning port 8765 on Windows (both uvicorns
# bind, the older one receives the connections) — the app then serves stale code
# with no error anywhere. Refuse to start until the old one is closed.
$busy8765 = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy8765) {
    $owner = (Get-Process -Id $busy8765.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Write-Error "Port 8765 is already in use by PID $($busy8765.OwningProcess) ($owner) — a previous dev backend is still running. Close its window (or Stop-Process -Id $($busy8765.OwningProcess) -Force) and re-run dev.ps1."
}
$busy5173 = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy5173) {
    Write-Warning "Port 5173 is already in use by PID $($busy5173.OwningProcess) — vite will pick the next free port; check the frontend window for the actual URL."
}

# Regenerate OpenAPI types up front so the frontend sees fresh schemas.
Write-Host "Refreshing OpenAPI types ..." -ForegroundColor Cyan
& $venvPy -X utf8 (Join-Path $root 'scripts\dump_openapi.py')
if ($LASTEXITCODE -eq 0) {
    Push-Location $frontendDir
    try {
        pnpm run gen:api | Out-Null
    } finally {
        Pop-Location
    }
} else {
    Write-Warning "OpenAPI dump failed (exit $LASTEXITCODE) — skipping 'pnpm run gen:api'; frontend types may be stale and the backend will likely fail to boot. Check the backend can import (e.g. run 'venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py')."
}

# Local dev keeps the interactive docs + JSON-free logs; production defaults dev_mode off.
$backendCmd = "`$env:GSSG_DEV_MODE='true'; & '$venvPy' -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8765 --app-dir '$root\backend'"
$frontendCmd = "Set-Location '$frontendDir'; pnpm dev"

Write-Host "Starting backend on http://127.0.0.1:8765 ..." -ForegroundColor Cyan
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit', '-NoProfile', '-Command', $backendCmd
) | Out-Null

Write-Host "Starting frontend on http://127.0.0.1:5173 ..." -ForegroundColor Cyan
Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoExit', '-NoProfile', '-Command', $frontendCmd
) | Out-Null

Write-Host ""
Write-Host "Open http://127.0.0.1:5173 in a browser." -ForegroundColor Green
Write-Host "Close the two new PowerShell windows to stop dev mode."
