# scripts/install-backup-task.ps1  (run as Administrator)
# Register (or remove) the nightly Windows Scheduled Task that backs up the GSSG
# data dir via scripts/backup-db.ps1. The Scheduled Task is the PRIMARY backup
# driver -- it runs even when the GSSGManager service is stopped or the app has
# crashed (an in-process APScheduler job would not).
#
# Usage (elevated PowerShell):
#   .\scripts\install-backup-task.ps1                       # nightly 02:30, keep 14, dest data\backups\auto
#   .\scripts\install-backup-task.ps1 -At 03:15 -Keep 30
#   .\scripts\install-backup-task.ps1 -Dest 'D:\gssg-backups'   # recommend a second disk
#   .\scripts\install-backup-task.ps1 -Uninstall
[CmdletBinding()]
param(
    [string] $At        = '02:30',
    [int]    $Keep      = 14,
    [string] $Dest      = '',
    [string] $TaskName  = 'GSSGManagerBackup',
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

# Require elevation -- Register-ScheduledTask for an unattended SYSTEM task needs it.
$admin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "Run this script in an elevated (Administrator) PowerShell." }

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Yellow
    } else {
        Write-Host "No scheduled task '$TaskName' to remove." -ForegroundColor DarkGray
    }
    return
}

$root      = Split-Path -Parent $PSScriptRoot
$backupPs1 = Join-Path $root 'scripts\backup-db.ps1'
if (-not (Test-Path $backupPs1)) { throw "Missing $backupPs1" }

# Build the powershell.exe argument string that runs the wrapper.
$inner = "-NoProfile -ExecutionPolicy Bypass -File `"$backupPs1`" -Keep $Keep"
if ($Dest -ne '') { $inner += " -Dest `"$Dest`"" }

$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $inner -WorkingDirectory $root
$trigger   = New-ScheduledTaskTrigger -Daily -At $At
# SYSTEM so it runs unattended at the boot/idle hour without a logged-in user.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
                 -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null

$destLabel = if ($Dest) { $Dest } else { 'data\backups\auto' }
Write-Host "Registered '$TaskName' -- daily at $At (keep=$Keep, dest=$destLabel)." -ForegroundColor Green
Write-Host "Run it now to verify:  Start-ScheduledTask -TaskName $TaskName" -ForegroundColor Cyan
