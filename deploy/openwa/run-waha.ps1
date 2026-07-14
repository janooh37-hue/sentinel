# Bring up WAHA under the existing podman-uosserver WSL distro (no compose provider).
# Reads deploy/openwa/.env for OPENWA_API_KEY. Idempotent.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
$key = (Select-String -Path $envFile -Pattern '^\s*OPENWA_API_KEY\s*=\s*(.+)$').Matches[0].Groups[1].Value.Trim()
if (-not $key) { throw "OPENWA_API_KEY is empty in $envFile — fill it first." }

$distro = 'podman-uosserver'
wsl.exe -d $distro -- podman rm -f waha 2>$null | Out-Null
wsl.exe -d $distro -- podman run -d --name waha --restart unless-stopped `
  -p 127.0.0.1:2785:3000 `
  -e WAHA_API_KEY="$key" -e WHATSAPP_START_SESSION=gssg -e WHATSAPP_RESTART_ALL_SESSIONS=True `
  -v waha_sessions:/app/.sessions `
  docker.io/devlikeapro/waha:latest
Write-Host "WAHA started. Swagger: http://localhost:2785/api/docs"
