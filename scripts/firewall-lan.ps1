# scripts/firewall-lan.ps1
# Open (or close) the LAN port for GSSG Manager on the Windows firewall.
# Restricted to the local subnet + Private profile -- NOT any network.
#
# Run as Administrator.
# Open:  powershell -ExecutionPolicy Bypass -File .\scripts\firewall-lan.ps1 -Port 8765
# Close: powershell -ExecutionPolicy Bypass -File .\scripts\firewall-lan.ps1 -Remove

[CmdletBinding()]
param(
    [int]    $Port        = 8765,
    [string] $DisplayName = 'GSSG Manager LAN',
    [switch] $Remove
)

$ErrorActionPreference = 'Stop'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    throw 'Run this script from an elevated (Administrator) PowerShell.'
}

$existing = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue

if ($Remove) {
    if ($existing) {
        $existing | Remove-NetFirewallRule
        Write-Host "Removed firewall rule $DisplayName." -ForegroundColor Green
    } else {
        Write-Host "No firewall rule $DisplayName to remove." -ForegroundColor DarkGray
    }
    return
}

if ($existing) {
    Write-Host "Firewall rule $DisplayName already exists -- removing + re-adding to update the port." -ForegroundColor Cyan
    $existing | Remove-NetFirewallRule
}

New-NetFirewallRule `
    -DisplayName $DisplayName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Action Allow `
    -Profile Private `
    -RemoteAddress LocalSubnet | Out-Null

Write-Host "Allowed inbound TCP $Port from LocalSubnet (Private profile)." -ForegroundColor Green
Write-Host "Coworkers reach the app at: http://$($env:COMPUTERNAME):$Port/"
