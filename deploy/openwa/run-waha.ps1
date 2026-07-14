# Bring up WAHA under the existing podman-uosserver WSL distro (no compose provider).
# Reads deploy/openwa/.env for OPENWA_API_KEY. Idempotent.
# Run from Windows PowerShell (this calls wsl.exe), NOT from inside the WSL distro.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) { throw "Missing $envFile - create it with OPENWA_API_KEY=<key> first." }
$match = Select-String -Path $envFile -Pattern '^\s*OPENWA_API_KEY\s*=\s*(.+)$' | Select-Object -First 1
$key = if ($match) { $match.Matches[0].Groups[1].Value.Trim() } else { '' }
if (-not $key) { throw "OPENWA_API_KEY is empty or missing in $envFile - fill it first." }

$distro = 'podman-uosserver'
wsl.exe -d $distro -- podman rm -f --ignore waha 2>$null | Out-Null
wsl.exe -d $distro -- podman run -d --name waha --restart unless-stopped `
  -p 127.0.0.1:2785:3000 `
  -e WAHA_API_KEY="$key" -e WHATSAPP_START_SESSION=gssg -e WHATSAPP_RESTART_ALL_SESSIONS=True `
  -e WHATSAPP_DEFAULT_ENGINE=NOWEB `
  -v waha_sessions:/app/.sessions `
  docker.io/devlikeapro/waha:latest
Write-Host "WAHA started on http://localhost:2785 (session 'gssg'). Status: GET /api/sessions/gssg"
