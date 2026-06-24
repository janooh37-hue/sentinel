# secure_key_acls.ps1 — Owner-only ACL on the off-DB secret keys.
#
# Run as the account that runs GSSG Manager (Administrator or the service account)
# AFTER the first successful app boot (keys are created lazily on first use):
#   - .email_key  — created on first email account setup
#   - .vapid_key  — created on first push subscription
#
# Removes inherited ACEs and grants only the current user Full control.
# This is a Windows equivalent of `chmod 600` on POSIX.
#
# Usage:
#   .\scripts\secure_key_acls.ps1
#   .\scripts\secure_key_acls.ps1 -DataDir "C:\custom\data"

param(
    [string]$DataDir = "$PSScriptRoot\..\data"
)

$DataDir = [System.IO.Path]::GetFullPath($DataDir)

foreach ($name in @(".email_key", ".vapid_key")) {
    $p = Join-Path $DataDir $name
    if (Test-Path $p) {
        # Remove inherited permissions
        icacls $p /inheritance:r | Out-Null
        # Grant current user full control only
        icacls $p /grant:r "$($env:USERNAME):(F)" | Out-Null
        Write-Host "secured: $p"
    } else {
        Write-Host "skip (not yet created): $p"
    }
}

Write-Host ""
Write-Host "Verify with: icacls <data_dir>\.vapid_key"
Write-Host "             icacls <data_dir>\.email_key"
