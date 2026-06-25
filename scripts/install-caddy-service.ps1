# scripts/install-caddy-service.ps1
# Register (or remove) the Caddy TLS reverse-proxy as a Windows service via NSSM.
# Caddy owns :443 (+ :80 redirect) and proxies to uvicorn on 127.0.0.1:8765,
# giving LAN devices https://gssg.lan/ with Caddy's internal CA.
#
# Run as Administrator.
# Install:   powershell -ExecutionPolicy Bypass -File .\scripts\install-caddy-service.ps1
# Uninstall: powershell -ExecutionPolicy Bypass -File .\scripts\install-caddy-service.ps1 -Uninstall

[CmdletBinding()]
param(
    [string] $ServiceName = 'Caddy',
    [string] $Nssm        = 'C:\Tools\nssm\nssm-2.24\win64\nssm.exe',
    [string] $CaddyExe    = 'C:\Tools\caddy\caddy.exe',
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
        throw 'Run this script from an elevated (Administrator) PowerShell.'
    }
}
Assert-Admin

$root    = Split-Path -Parent $PSScriptRoot
$cfg     = Join-Path $root 'deploy\Caddyfile'
$caddyDir = Split-Path -Parent $CaddyExe
$logDir  = Join-Path $root 'data\logs'

if ($Uninstall) {
    Write-Host "Stopping + removing service $ServiceName ..." -ForegroundColor Cyan
    & $Nssm stop   $ServiceName
    & $Nssm remove $ServiceName confirm
    Write-Host 'Removed.' -ForegroundColor Green
    return
}

if (-not (Test-Path $Nssm))     { throw "NSSM not found at $Nssm." }
if (-not (Test-Path $CaddyExe)) { throw "caddy.exe not found at $CaddyExe." }
if (-not (Test-Path $cfg))      { throw "Caddyfile not found at $cfg." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Installing service $ServiceName ..." -ForegroundColor Cyan
& $Nssm install $ServiceName $CaddyExe
& $Nssm set $ServiceName AppParameters ('run --config "{0}" --adapter caddyfile' -f $cfg)
& $Nssm set $ServiceName AppDirectory $caddyDir
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $logDir 'caddy-stdout.log')
& $Nssm set $ServiceName AppStderr (Join-Path $logDir 'caddy-stderr.log')
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 3000
& $Nssm set $ServiceName Description 'GSSG Manager TLS reverse proxy (Caddy -> 127.0.0.1:8765).'

Write-Host 'Starting service ...' -ForegroundColor Cyan
& $Nssm start $ServiceName

Write-Host ''
Write-Host "Service $ServiceName installed and started." -ForegroundColor Green
Write-Host "Test:  Invoke-RestMethod https://gssg.lan/api/v1/system/health"
Write-Host "CA:    run scripts\export-caddy-ca.ps1 to get the root cert for devices"
