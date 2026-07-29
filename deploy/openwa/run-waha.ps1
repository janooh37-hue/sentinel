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
  --log-driver k8s-file `
  -p 127.0.0.1:2785:3000 `
  -e WAHA_API_KEY="$key" -e WHATSAPP_DEFAULT_ENGINE=NOWEB `
  -v waha_sessions:/app/.sessions `
  docker.io/devlikeapro/waha:latest

# Baileys pins a WA-Web version WhatsApp eventually rejects with 405, which leaves the
# session stuck in STARTING and the QR endpoint 422ing. Repin it, then restart so Node
# reloads the module. Lives in the container's writable layer, so it must run on every
# `podman run` - hence here and not a manual step.
$patch = Join-Path $PSScriptRoot 'patch-baileys-version.mjs'
$wslPatch = '/mnt/' + $patch.Substring(0, 1).ToLowerInvariant() + ($patch.Substring(2) -replace '\\', '/')
wsl.exe -d $distro -- podman cp "$wslPatch" waha:/tmp/patch-baileys-version.mjs
wsl.exe -d $distro -- podman exec waha node /tmp/patch-baileys-version.mjs
if ($LASTEXITCODE -ne 0) { throw "Baileys WA-version patch failed - WhatsApp will reject the session with 405." }
wsl.exe -d $distro -- podman stop waha | Out-Null
# pasta (podman's port forwarder) can hold 2785 for a few seconds after a stop, so
# the immediate start loses the bind. Retry instead of failing the whole script.
for ($i = 1; $i -le 10; $i++) {
  wsl.exe -d $distro -- podman start waha 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
if ($LASTEXITCODE -ne 0) { throw "WAHA failed to restart after the Baileys patch - port 2785 still held." }

Write-Host "WAHA started on http://localhost:2785 (session 'gssg'). Status: GET /api/sessions/gssg"
