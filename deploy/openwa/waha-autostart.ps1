# Ensures the WAHA WhatsApp gateway container is running under the podman-uosserver
# WSL distro. Idempotent + self-healing: starts the existing 'waha' container, or
# recreates it via run-waha.ps1 if it's missing. Run by a Scheduled Task at boot/logon.
# (Invoking any `wsl -d ...` command implicitly boots the distro first.)
$ErrorActionPreference = 'Continue'
$distro = 'podman-uosserver'
# No systemd in this distro, so nothing creates XDG_RUNTIME_DIR - and /run is tmpfs, so it
# vanishes on every reboot. Without it rootless podman dies with "creating events dirs:
# permission denied". Recreate it first (idempotent) or every command below fails.
wsl.exe -d $distro -u root -- install -d -o 1000 -g 1000 -m 700 /run/user/1000
$exists = (wsl.exe -d $distro -- sh -c "podman container exists waha && echo yes || echo no")
if ($exists -match 'yes') {
    wsl.exe -d $distro -- podman start waha | Out-Null
    Write-Host "waha: started existing container"
} else {
    & (Join-Path $PSScriptRoot 'run-waha.ps1')
    Write-Host "waha: container missing -> recreated via run-waha.ps1"
}
