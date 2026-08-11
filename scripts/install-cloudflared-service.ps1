# scripts/install-cloudflared-service.ps1
# Register (or remove) the Cloudflare Tunnel connector as a Windows service via NSSM.
# cloudflared makes OUTBOUND-ONLY connections to Cloudflare's edge and serves
# https://gssg.app -> 127.0.0.1:8765. No inbound ports, no router changes; the
# LAN path (Caddy -> gssg.lan / gssgit.local) is untouched and stays the
# offline fallback.
#
# One-time prereqs (interactive, as the Admin user):
#   C:\Tools\cloudflared\cloudflared.exe tunnel login
#   C:\Tools\cloudflared\cloudflared.exe tunnel create gssg
#   C:\Tools\cloudflared\cloudflared.exe tunnel route dns gssg gssg.app
# then fill deploy\cloudflared\config.yml with the tunnel UUID + credentials path.
#
# Run as Administrator.
# Install:   powershell -ExecutionPolicy Bypass -File .\scripts\install-cloudflared-service.ps1
# Uninstall: powershell -ExecutionPolicy Bypass -File .\scripts\install-cloudflared-service.ps1 -Uninstall

[CmdletBinding()]
param(
    [string] $ServiceName    = 'Cloudflared',
    [string] $Nssm           = 'C:\Tools\nssm\nssm-2.24\win64\nssm.exe',
    [string] $CloudflaredExe = 'C:\Tools\cloudflared\cloudflared.exe',
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

$root   = Split-Path -Parent $PSScriptRoot
$cfg    = Join-Path $root 'deploy\cloudflared\config.yml'
$logDir = Join-Path $root 'data\logs'

# nssm writes its status lines to stderr. When this script's output is
# captured (transcript, redirection, remote/automated runs), Windows
# PowerShell 5.1 materializes native stderr as error records — which, under
# $ErrorActionPreference = 'Stop', silently kills the script on nssm's FIRST
# status line before the service is created. Relax EAP for the nssm calls;
# guard `throw`s above are explicit and unaffected.
$ErrorActionPreference = 'Continue'

if ($Uninstall) {
    Write-Host "Stopping + removing service $ServiceName ..." -ForegroundColor Cyan
    & $Nssm stop   $ServiceName
    & $Nssm remove $ServiceName confirm
    Write-Host 'Removed.' -ForegroundColor Green
    return
}

if (-not (Test-Path $Nssm))           { throw "NSSM not found at $Nssm." }
if (-not (Test-Path $CloudflaredExe)) { throw "cloudflared.exe not found at $CloudflaredExe." }
if (-not (Test-Path $cfg))            { throw "config.yml not found at $cfg (create the tunnel first — see header)." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Installing service $ServiceName ..." -ForegroundColor Cyan
& $Nssm install $ServiceName $CloudflaredExe
& $Nssm set $ServiceName AppParameters ('tunnel --config "{0}" run' -f $cfg)
& $Nssm set $ServiceName AppDirectory (Split-Path -Parent $CloudflaredExe)
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $logDir 'cloudflared-stdout.log')
& $Nssm set $ServiceName AppStderr (Join-Path $logDir 'cloudflared-stderr.log')
& $Nssm set $ServiceName AppExit Default Restart
& $Nssm set $ServiceName AppRestartDelay 3000
& $Nssm set $ServiceName Description 'GSSG Manager Cloudflare Tunnel (gssg.app -> 127.0.0.1:8765).'

Write-Host 'Starting service ...' -ForegroundColor Cyan
& $Nssm start $ServiceName

Write-Host ''
Write-Host "Service $ServiceName installed and started." -ForegroundColor Green
Write-Host 'Verify:  Invoke-RestMethod https://gssg.app/api/v1/system/health'
Write-Host "Logs:    $logDir\cloudflared-*.log"
