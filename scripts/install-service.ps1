# scripts/install-service.ps1
# Register (or remove) the always-on GSSG Manager Windows service via NSSM.
#
# Run as Administrator. NSSM (https://nssm.cc) must be available -- pass its
# path with -Nssm, or have nssm.exe on PATH.
#
# Install:   powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
# Uninstall: powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -Uninstall

[CmdletBinding()]
param(
    [string] $ServiceName = 'GSSGManager',
    [string] $Nssm        = 'nssm.exe',
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

# repo root = parent of scripts\
$root   = Split-Path -Parent $PSScriptRoot
$venvPy = Join-Path $root 'venv\Scripts\python.exe'
$serve  = Join-Path $root 'backend\serve.py'
$logDir = Join-Path $root 'data\logs'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw 'Run this script from an elevated (Administrator) PowerShell.'
    }
}

Assert-Admin

if ($Uninstall) {
    Write-Host "Stopping + removing service $ServiceName ..." -ForegroundColor Cyan
    & $Nssm stop   $ServiceName 2>$null
    & $Nssm remove $ServiceName confirm
    Write-Host 'Removed.' -ForegroundColor Green
    return
}

if (-not (Test-Path $venvPy)) { throw "venv Python not found at $venvPy." }
if (-not (Test-Path $serve))  { throw "serve.py not found at $serve." }
if (-not (Test-Path (Join-Path $root 'backend\app\static'))) {
    Write-Warning 'backend\app\static is missing -- run scripts\build.ps1 -SkipPyInstaller first.'
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Installing service $ServiceName ..." -ForegroundColor Cyan
& $Nssm install $ServiceName $venvPy $serve
& $Nssm set $ServiceName AppDirectory $root
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $logDir 'service-stdout.log')
& $Nssm set $ServiceName AppStderr (Join-Path $logDir 'service-stderr.log')
# Restart on unexpected exit (crash recovery).
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 3000
& $Nssm set $ServiceName Description 'GSSG Manager LAN web app (headless uvicorn).'

Write-Host 'Starting service ...' -ForegroundColor Cyan
& $Nssm start $ServiceName

Write-Host ''
Write-Host "Service $ServiceName installed and started." -ForegroundColor Green
Write-Host "Verify:  Invoke-RestMethod http://127.0.0.1:8765/api/v1/system/health"
Write-Host "Logs:    $logDir"
Write-Host "Manage:  nssm start/stop/restart $ServiceName"
