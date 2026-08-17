# Registers a Windows Scheduled Task that keeps the WAHA WhatsApp gateway running
# across reboots (starts the podman container in the WSL distro at boot, at logon, and
# on a 10-minute re-check).
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
# The 10-minute re-check is the one that actually matters. Boot/logon alone left the
# gateway down for 3 days (2026-08-14 -> 2026-08-17): WSL shuts an idle distro down on
# its own, which kills the container, and podman's `--restart unless-stopped` cannot
# help because there is no systemd in podman-uosserver to replay it when the distro
# comes back. Nothing else re-runs until the host reboots, and this host stays up for
# weeks. Re-running waha-autostart.ps1 on a timer bounds an outage at ~10 minutes, and
# each `wsl -d` call also boots the distro, so the idle shutdown stops being terminal.
# Safe on a timer: waha-autostart.ps1 is idempotent, and `podman start` on an
# already-running container is a successful no-op.
$triggers = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -AtLogOn -User $user
  # No -RepetitionDuration on purpose: an omitted <Duration> is how the Task Scheduler
  # schema spells "repeat forever". [TimeSpan]::MaxValue looks like the obvious way to
  # say that and is not - it serializes to P99999999DT23H59M59S and the service rejects
  # the whole registration with "contains a value which is incorrectly formatted or out
  # of range".
  New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 10)
)
# ExecutionTimeLimit stays under the repetition interval, and IgnoreNew means a run that
# hangs on wsl.exe is killed before the next one is due rather than stacking copies.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 8) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Settings $settings -Principal $principal `
  -Description 'Starts the WAHA WhatsApp gateway (podman container in the podman-uosserver WSL distro) at boot and logon.' `
  -Force | Out-Null
Write-Host "Registered scheduled task '$taskName' as $user (whether logged on or not)."
