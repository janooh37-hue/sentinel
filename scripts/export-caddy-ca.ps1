# scripts/export-caddy-ca.ps1
# Export Caddy's internal root CA cert so LAN devices can trust https://gssg.lan.
# Copies the root.crt to the Desktop (and -OutDir if given) for easy transfer
# to phones/PCs. The cert is PUBLIC (no private key) — safe to share internally.
#
# Run after the Caddy service has started at least once (it generates the CA).
# Install on devices:
#   * Windows: double-click -> Install -> Local Machine -> "Trusted Root
#     Certification Authorities".
#   * Android: Settings -> Security -> Encryption & credentials -> Install a
#     certificate -> CA certificate.
#   * iOS/iPadOS: AirDrop/email the .crt -> Settings -> General -> VPN & Device
#     Management -> install profile, then Settings -> General -> About ->
#     Certificate Trust Settings -> enable full trust for the Caddy root.

[CmdletBinding()]
param(
    [string] $CaRoot = 'C:\Tools\caddy\data\pki\authorities\local\root.crt',
    [string] $OutDir  = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CaRoot)) {
    throw "Caddy root CA not found at $CaRoot. Start the Caddy service first, then re-run."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$dest = Join-Path $OutDir 'gssg-ca.crt'
Copy-Item -Path $CaRoot -Destination $dest -Force

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $CaRoot
Write-Host "Exported root CA to: $dest" -ForegroundColor Green
Write-Host ("Subject : {0}" -f $cert.Subject)
Write-Host ("Expires : {0}" -f $cert.NotAfter)
Write-Host ''
Write-Host 'Transfer gssg-ca.crt to each phone/PC and install it as a trusted root CA.'
Write-Host 'Then browse to https://gssg.lan/ — the padlock should be valid (no warning).'
