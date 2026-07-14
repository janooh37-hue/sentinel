# Registers a Windows Scheduled Task that keeps the WAHA WhatsApp gateway running
# across reboots (starts the podman container in the WSL distro at boot AND at logon).
# MUST be run elevated (Administrator). Runs as the current admin account, whether
# logged on or not (S4U — no stored password), highest privileges, self-restarting.
#
# Usage (from an elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File deploy\openwa\install-autostart-task.ps1
$ErrorActionPreference = 'Stop'
$taskName = 'WAHA-WhatsApp-Gateway'
$script   = Join-Path $PSScriptRoot 'waha-autostart.ps1'
$user     = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script)
$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn -User $user
)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Settings $settings -Principal $principal `
  -Description 'Starts the WAHA WhatsApp gateway (podman container in the podman-uosserver WSL distro) at boot and logon.' `
  -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' as $user (whether logged on or not)."
