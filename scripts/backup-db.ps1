# scripts/backup-db.ps1
# Nightly consistent backup of the GSSG data dir (DB via SQLite online-backup +
# file trees) with retention. All logic lives in the tested Python module
# app.services.backup_service; this is a thin, path-portable wrapper invoked by
# the Windows Scheduled Task (scripts/install-backup-task.ps1).
#
# Usage:
#   .\scripts\backup-db.ps1                       # dest data\backups\auto, keep 14
#   .\scripts\backup-db.ps1 -Keep 30
#   .\scripts\backup-db.ps1 -Dest 'D:\gssg-backups'   # recommended: second disk
[CmdletBinding()]
param(
    [int]    $Keep = 14,
    [string] $Dest = ''
)

$ErrorActionPreference = 'Stop'

$root   = Split-Path -Parent $PSScriptRoot
$venvPy = Join-Path $root 'venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    throw "venv Python not found at $venvPy"
}

$pyArgs = @('-X', 'utf8', '-m', 'app.services.backup_service', '--keep', "$Keep")
if ($Dest -ne '') { $pyArgs += @('--dest', $Dest) }

# Run from backend/ so `-m app.services.backup_service` resolves on the
# pyproject pythonpath; AppDirectory is set by the service/task too.
Push-Location (Join-Path $root 'backend')
try {
    & $venvPy @pyArgs
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($code -ne 0) { throw "backup-db.ps1: python exited $code" }
Write-Host "backup-db.ps1: done (keep=$Keep)" -ForegroundColor Green
