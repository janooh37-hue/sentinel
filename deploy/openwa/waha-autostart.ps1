# Ensures the WAHA WhatsApp gateway container is running under the podman-uosserver
# WSL distro. Idempotent + self-healing: starts the existing 'waha' container, or
# recreates it via run-waha.ps1 if it's missing. Run by a Scheduled Task at boot/logon.
# (Invoking any `wsl -d ...` command implicitly boots the distro first.)
$ErrorActionPreference = 'Continue'
$distro = 'podman-uosserver'
$exists = (wsl.exe -d $distro -- sh -c "podman container exists waha && echo yes || echo no")
if ($exists -match 'yes') {
    wsl.exe -d $distro -- podman start waha | Out-Null
    Write-Host "waha: started existing container"
} else {
    & (Join-Path $PSScriptRoot 'run-waha.ps1')
    Write-Host "waha: container missing -> recreated via run-waha.ps1"
}
