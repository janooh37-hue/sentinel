# GSSG Manager: Move Production to `GSSGAPP`

Use this runbook to move the live GSSG Manager application from `GSSGIT` to the new Windows PC `GSSGAPP`.

`GSSGIT` remains online as the office file server. After cutover, its GSSG backend, Caddy application route, Cloudflare connector, WAHA sender, and GSSG scheduler must remain stopped.

## Required outcome

| Role | Value |
|---|---|
| Old application/file server | `GSSGIT` |
| New application server | `GSSGAPP` |
| Windows service user | local user `Admin` |
| Repository path | `C:\Users\Admin\sentinel` |
| Backend port | `8765` |
| Stable office URL | `https://gssg.lan` |
| New hostname URL | `https://gssgapp.local` |
| Public URL | `https://gssg.app` |
| Retired application URL | `https://gssgit.local` |

The office router must give `GSSGAPP` its own reserved address. Do not reuse `GSSGIT`'s computer name or IP address while that PC remains online.

## Stop conditions

Stop the migration instead of guessing when any of these is true:

- `GSSGIT` still accepts application writes when the final data copy starts.
- A copied `gssg.db` is opened while its source `serve.py` process is still running.
- `data\.email_key` or `data\.vapid_key` existed on `GSSGIT` but is absent from the final copy.
- The Caddy CA, Cloudflare credential, or WAHA session cannot be accounted for.
- Old and new Cloudflare connectors route users to different database copies.
- Old and new schedulers or notification senders are both enabled.

At every point: **one writable GSSG database, one active scheduler, one production notification sender**.

## Secrets and production data

Never commit or paste the contents of:

- root `.env`;
- `deploy\openwa\.env`;
- `data`;
- `data\.email_key` or `data\.vapid_key`;
- Cloudflare tunnel credential JSON;
- `C:\Tools\caddy\data` private keys;
- the WAHA session volume;
- Windows account, SMS, BioTime, email, or WhatsApp credentials.

Use an encrypted USB disk or a protected administrator-only share for transfer artifacts. Delete temporary copies after the migration and rollback window end.

---

# 1. Inventory: software not installed by project dependency files

`requirements.txt` installs Python packages. `frontend\pnpm-lock.yaml` installs frontend packages. Neither installs the following Windows/runtime dependencies.

## Source-host baseline

These versions were observed on `GSSGIT` on 2026-08-24. Compatible security-patched releases may be newer; keep Python on 3.12 and pnpm on 11.6.0 for this move.

| Dependency | Source version | Why it is required |
|---|---:|---|
| Windows 11 Pro x64 | 10.0.22631 | Windows services, Word COM, WSL2 |
| Python | 3.12.10 | FastAPI backend |
| Node.js | 24.18.0 | Frontend build |
| pnpm | 11.6.0 | Locked frontend package manager |
| Git | 2.54.0 | Safe deployment from `origin/main` |
| Microsoft Word desktop | 16.0 | DOCX editing and PDF conversion |
| NSSM | 2.24 | Windows service wrapper |
| Caddy | 2.11.4 | Office HTTPS and reverse proxy |
| cloudflared | 2026.7.3 | Public `gssg.app` tunnel |
| Tesseract | 5.4.0.20240606 | Arabic/English OCR |
| WSL2 | version 2 distro | WAHA host |
| Podman | 5.8.6, rootless | WAHA container runtime |
| WAHA | existing `devlikeapro/waha` image | WhatsApp gateway |

Optional: install Tailscale only if it remains part of remote administration. GSSG does not require it to run.

## External systems that do not move inside Sentinel

| Dependency | Action | Verification after cutover |
|---|---|---|
| Android SMS gateway | Keep the external device and its reserved address | `GSSGAPP` can reach it; controlled SMS arrives |
| ZKTeco BioTime | Keep the external server | Existing attendance source remains healthy and fresh |
| Cloudflare account/tunnel | Move the existing connector credential; do not create another tunnel | `https://gssg.app` reaches `GSSGAPP` |
| Office router | Reserve the new address and repoint `gssg.lan` at cutover | Office DNS returns the `GSSGAPP` address |
| Office WhatsApp number | Preserve through WAHA session state | WAHA session is `WORKING` |
| Old file shares | Keep on `GSSGIT` | Existing mapped drives still open |

The following observed tasks are outside Sentinel and point to `C:\Users\Admin\Projects\N8Nionos` on `GSSGIT`:

- `GSSG Attendance Watchdog`
- `GSSG Attendance Worker`
- `GSSG n8n`

Leave them on `GSSGIT` unless they receive a separate migration. Verify their production endpoint after `gssg.app` moves. Do not recreate them on `GSSGAPP` during this runbook.

`backend\app\config.py` loads the repository-root `.env`. It does not load `backend\.env`. Do not move BioTime credentials into root `.env` merely because they are found in `backend\.env`: that could enable a second attendance provider beside the retained N8N worker. Preserve the current attendance ownership; enabling built-in BioTime sync is a separate reviewed change.

---

# 2. Prepare `GSSGAPP`

Run Windows setup as local user `Admin`.

## 2.1 Hardware and Windows

Required:

- Windows 11 Pro x64 with current security updates;
- at least 8 GB RAM;
- system-managed page file;
- enough free disk for the repository, `data`, WSL image, transfer archive, and backups;
- approximately 1.8 GB free Windows commit before frontend builds;
- local user `Admin` with a password suitable for an unattended Windows service;
- computer name `GSSGAPP`;
- a unique office-LAN DHCP reservation or static address.

If the name is not already correct, run in elevated PowerShell and reboot:

```powershell
Rename-Computer -NewName GSSGAPP -Restart
```

After reboot, verify identity and capacity:

```powershell
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
[pscustomobject]@{
  Computer = $env:COMPUTERNAME
  Windows  = $os.Caption
  Version  = $os.Version
  RAMGB    = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
}
Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter, SizeRemaining, Size
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '127.*' } |
  Select-Object InterfaceAlias, IPAddress, PrefixLength
```

Record the `192.168.15.*` address reserved for `GSSGAPP`. The old source address `192.168.15.102` remains assigned to `GSSGIT` unless the office network administrator explicitly changes it.

## 2.2 Install build/runtime tools

Install Python 3.12, Git, and Node.js 24 LTS using approved Windows installers or `winget`:

```powershell
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

Open a new PowerShell after installation. Enable the package manager version declared by `frontend\package.json`:

```powershell
corepack enable
corepack prepare pnpm@11.6.0 --activate
python --version
node --version
pnpm --version
git --version
```

Expected major versions: Python 3.12, Node 24, pnpm 11.6.0.

If `corepack` is not installed by the selected Node distribution, install Corepack with npm, then repeat the activation:

```powershell
npm install --global corepack
corepack enable
corepack prepare pnpm@11.6.0 --activate
```

## 2.3 Install and activate Microsoft Word

Install the licensed Microsoft Word desktop application. Sign in and complete activation as `Admin`. Open Word once, dismiss first-run dialogs, create and save a temporary document, then close Word.

Verify COM from the same `Admin` account:

```powershell
$word = New-Object -ComObject Word.Application
[pscustomobject]@{ Version = $word.Version; Path = $word.Path }
$word.Quit()
```

Do not continue until this succeeds without an activation or first-run dialog.

## 2.4 Install fixed-path service tools

The repository service scripts expect these paths:

```text
C:\Tools\nssm\nssm-2.24\win64\nssm.exe
C:\Tools\caddy\caddy.exe
C:\Tools\cloudflared\cloudflared.exe
```

Install official binaries there, or securely copy the known-good binaries from the same paths on `GSSGIT`. Do not copy `C:\Tools\caddy\data` yet; it contains CA private state and is transferred separately.

Verify:

```powershell
& 'C:\Tools\nssm\nssm-2.24\win64\nssm.exe' version
& 'C:\Tools\caddy\caddy.exe' version
& 'C:\Tools\cloudflared\cloudflared.exe' --version
```

## 2.5 Install Tesseract with Arabic and English

```powershell
winget install -e --id UB-Mannheim.TesseractOCR `
  --accept-package-agreements --accept-source-agreements --silent

$ArabicPack = 'C:\Program Files\Tesseract-OCR\tessdata\ara.traineddata'
if (-not (Test-Path $ArabicPack)) {
  Invoke-WebRequest -UseBasicParsing `
    -Uri 'https://github.com/tesseract-ocr/tessdata/raw/main/ara.traineddata' `
    -OutFile $ArabicPack
}

& 'C:\Program Files\Tesseract-OCR\tesseract.exe' --version
& 'C:\Program Files\Tesseract-OCR\tesseract.exe' --list-langs
```

The language list must include `ara`, `eng`, and `osd`.

## 2.6 Enable WSL2

Run in elevated PowerShell, then reboot if Windows requests it:

```powershell
wsl.exe --install --no-distribution
wsl.exe --set-default-version 2
wsl.exe --status
```

Do not create a fresh WAHA session. The existing `podman-uosserver` distribution will be exported from `GSSGIT` and imported later.

---

# 3. Prepare a secure transfer

On the transfer disk or protected share, use one root directory. This runbook uses `D:\GSSG-Transfer`. If `D:` is not the encrypted transfer disk, change this one value before running any copy command.

Use BitLocker-protected NTFS storage or an administrator-only NTFS share. FAT32 cannot hold a large WSL export, and filesystems without Windows ACL support cannot preserve Caddy private-key permissions.

```powershell
$TransferRoot = 'D:\GSSG-Transfer'
New-Item -ItemType Directory -Force $TransferRoot | Out-Null
```

Record the current source state without exposing secrets:

```powershell
Set-Location C:\Users\Admin\sentinel
git status --short
git branch --show-current
git log -1 --oneline
git remote get-url origin
.\scripts\mng.ps1 status
```

Production code must be committed and pushed to `origin/main` before migration. Do not use uncommitted source files as the new deployment.

## 3.1 Copy source and operational configuration early

Preferred source installation on `GSSGAPP`: clone or update `origin/main`, then transfer only ignored operational state. If the complete Sentinel folder is copied, do not reuse its virtual environment, package directories, caches, or worktrees.

From `GSSGIT`, copy a clean installation input:

```powershell
$Source = 'C:\Users\Admin\sentinel'
$Dest = Join-Path $TransferRoot 'sentinel'
robocopy $Source $Dest /E /COPY:DAT /DCOPY:DAT /XJ /R:2 /W:2 `
  /XD "$Source\venv" "$Source\frontend\node_modules" "$Source\frontend\dist" `
      "$Source\backend\app\static" "$Source\.worktrees" "$Source\.pytest_cache" `
      "$Source\.mypy_cache" "$Source\.ruff_cache" "$Source\.playwright-cli" `
      "$Source\.playwright-mcp" "$Source\.tmp" `
  /XF *.pyc
if ($LASTEXITCODE -ge 8) { throw "robocopy source failed with exit code $LASTEXITCODE" }
```

This early copy may contain a staged `data` snapshot, but it is not the production cutover copy. Never validate current records or make production decisions from that staged database.

## 3.2 Export state outside Sentinel early

Record whether the admin gate exists:

```powershell
Test-Path C:\Users\Admin\.gssg_admin_key
```

Copy it when present:

```powershell
if (Test-Path C:\Users\Admin\.gssg_admin_key) {
  Copy-Item C:\Users\Admin\.gssg_admin_key $TransferRoot -Force
}
```

Securely copy the existing Cloudflare credential without displaying its content:

```powershell
$TunnelCredential = 'C:\Users\Admin\.cloudflared\561c7c0f-32f1-435a-8cc7-bcbe780704fa.json'
if (-not (Test-Path $TunnelCredential)) { throw 'Cloudflare tunnel credential is missing' }
New-Item -ItemType Directory -Force (Join-Path $TransferRoot 'cloudflared') | Out-Null
Copy-Item $TunnelCredential (Join-Path $TransferRoot 'cloudflared') -Force
```

Take an early protected copy of Caddy's CA state:

```powershell
$EarlyCaddy = Join-Path $TransferRoot 'caddy-data'
robocopy C:\Tools\caddy\data $EarlyCaddy /E /COPY:DATS /DCOPY:DAT /XJ /R:2 /W:2
if ($LASTEXITCODE -ge 8) { throw "early Caddy state copy failed with exit code $LASTEXITCODE" }
```

```powershell
$CaddyRoot = 'C:\Tools\caddy\data\pki\authorities\local\root.crt'
if (-not (Test-Path $CaddyRoot)) { throw 'Caddy root CA is missing' }
(Get-FileHash $CaddyRoot -Algorithm SHA256).Hash |
  Set-Content (Join-Path $TransferRoot 'caddy-root-sha256.txt') -NoNewline
```

The final cutover repeats this copy while old Caddy is stopped.

Record the Podman default user and rootless state:

```powershell
$PodmanUser = (wsl.exe -d podman-uosserver -- id -un).Trim()
if (-not $PodmanUser) { throw 'Could not determine the Podman WSL user' }
Set-Content -Path (Join-Path $TransferRoot 'podman-user.txt') -Value $PodmanUser -NoNewline
wsl.exe -d podman-uosserver -- id
wsl.exe -d podman-uosserver -- podman info --format '{{.Host.Security.Rootless}}'
wsl.exe -d podman-uosserver -- podman volume inspect waha_sessions
```

Stop WAHA briefly, export the entire distro, then restore production WAHA:

```powershell
wsl.exe -d podman-uosserver -- podman stop waha
wsl.exe --terminate podman-uosserver
wsl.exe --export podman-uosserver (Join-Path $TransferRoot 'podman-uosserver.tar')
powershell -ExecutionPolicy Bypass -File C:\Users\Admin\sentinel\deploy\openwa\run-waha.ps1
```

The distro export preserves Podman, the WAHA image, `waha_sessions`, WhatsApp authentication, and the NOWEB delivery store. A final export is still required if WAHA state changes before cutover.

---

# 4. Install Sentinel on `GSSGAPP`

Copy the clean source input to `C:\Users\Admin\sentinel`, or clone the same `origin` URL and check out `main`. Confirm source control before installing:

```powershell
Set-Location C:\Users\Admin\sentinel
git switch main
git pull --ff-only origin main
git status --short
git log -1 --oneline
```

`git status --short` may show only intentionally copied ignored operational files; no tracked modification is allowed in production.

## 4.1 Recreate Python and frontend dependencies

```powershell
Set-Location C:\Users\Admin\sentinel
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
pnpm -C frontend install --frozen-lockfile
.\scripts\mng.ps1 build
```

Do not copy `venv`, `node_modules`, or generated static assets from `GSSGIT`.

## 4.2 Restore staged operational files

Restore root `.env`, `deploy\openwa\.env`, and a staged `data` copy for loopback-only checks. Do not print their values.

If the repository was cloned rather than copied, restore them explicitly:

```powershell
Set-Location C:\Users\Admin\sentinel
Copy-Item D:\GSSG-Transfer\sentinel\.env .env -Force
Copy-Item D:\GSSG-Transfer\sentinel\deploy\openwa\.env deploy\openwa\.env -Force
Remove-Item data -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item D:\GSSG-Transfer\sentinel\data data -Recurse -Force
```

Verify required hidden keys by existence and size only:

```powershell
Get-Item C:\Users\Admin\sentinel\data\.email_key -ErrorAction Stop |
  Select-Object FullName, Length
Get-Item C:\Users\Admin\sentinel\data\.vapid_key -ErrorAction Stop |
  Select-Object FullName, Length
```

If a key did not exist on `GSSGIT`, absence is acceptable only after confirming the corresponding email or Web Push feature was never configured.

Apply migrations to the staged copy:

```powershell
Set-Location C:\Users\Admin\sentinel
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m alembic current
.\venv\Scripts\python.exe -m alembic heads
```

`alembic heads` must report exactly one head.

## 4.3 Restore Caddy CA and Cloudflare credential

Restore Caddy state only from the secured transfer copy. Preserve the complete directory tree under `C:\Tools\caddy\data`.

```powershell
New-Item -ItemType Directory -Force C:\Tools\caddy | Out-Null
Remove-Item C:\Tools\caddy\data -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item D:\GSSG-Transfer\caddy-data C:\Tools\caddy\data -Recurse -Force
```

Verify that the trusted CA identity survived the copy:

```powershell
$ExpectedCaHash = (Get-Content D:\GSSG-Transfer\caddy-root-sha256.txt -Raw).Trim()
$ActualCaHash = (Get-FileHash C:\Tools\caddy\data\pki\authorities\local\root.crt -Algorithm SHA256).Hash
if ($ActualCaHash -cne $ExpectedCaHash) { throw 'Restored Caddy root CA does not match GSSGIT' }
```

Restore the tunnel credential:

```powershell
$CloudflaredHome = 'C:\Users\Admin\.cloudflared'
New-Item -ItemType Directory -Force $CloudflaredHome | Out-Null
Copy-Item `
  'D:\GSSG-Transfer\cloudflared\561c7c0f-32f1-435a-8cc7-bcbe780704fa.json' `
  $CloudflaredHome -Force
```

Confirm `deploy\cloudflared\config.yml` names tunnel `561c7c0f-32f1-435a-8cc7-bcbe780704fa` and points to the exact restored JSON. Do not run `cloudflared tunnel create` or `cloudflared tunnel route dns`.

Restore `C:\Users\Admin\.gssg_admin_key` when it was present on `GSSGIT`.

## 4.4 Import WAHA

```powershell
New-Item -ItemType Directory -Force C:\WSL\podman-uosserver | Out-Null
wsl.exe --import podman-uosserver C:\WSL\podman-uosserver `
  D:\GSSG-Transfer\podman-uosserver.tar --version 2
wsl.exe -d podman-uosserver -- podman --version
wsl.exe -d podman-uosserver -- podman info --format '{{.Host.Security.Rootless}}'
wsl.exe -d podman-uosserver -- podman volume inspect waha_sessions
```

The rootless value and Linux user must match the values recorded on `GSSGIT`. Imported distributions can default to `root` if the original default-user metadata was Windows-side. If that occurs, restore the recorded default user before running repository WAHA scripts:

```powershell
$PodmanUser = (Get-Content D:\GSSG-Transfer\podman-user.txt -Raw).Trim()
if (-not $PodmanUser) { throw 'Recorded Podman WSL user is missing' }
wsl.exe --manage podman-uosserver --set-default-user $PodmanUser
wsl.exe --terminate podman-uosserver
```

If the installed WSL version lacks `--manage`, stop and update WSL rather than running WAHA as root against the wrong volume.

Confirm `deploy\openwa\.env` and root `.env` contain matching API keys without printing either value:

```powershell
Set-Location C:\Users\Admin\sentinel
$OpenWaKey = (Select-String -Path deploy\openwa\.env -Pattern '^\s*OPENWA_API_KEY\s*=\s*(.+)$').Matches[0].Groups[1].Value.Trim()
$BackendKey = (Select-String -Path .env -Pattern '^\s*GSSG_OPENWA_API_KEY\s*=\s*(.+)$').Matches[0].Groups[1].Value.Trim()
if (-not $OpenWaKey -or $OpenWaKey -cne $BackendKey) { throw 'OpenWA API keys are absent or do not match' }
Remove-Variable OpenWaKey, BackendKey
```

Do not start WAHA for production until the final export is restored at cutover.

## 4.5 Prepare tracked Caddy hostname support

Before cutover, make this repository change in an isolated worktree, commit it, push it to `origin/main`, and update `GSSGAPP` from `origin/main`:

```text
Add https://gssgapp.local and https://gssgapp to the existing Caddy site list.
Keep https://gssg.lan.
Keep the old gssgit names during the migration window; remove them only after rollback is no longer needed.
```

Do not leave a host-only tracked `deploy\Caddyfile` edit in the production checkout.

Update the ignored root `.env` on `GSSGAPP` without printing its secrets:

```text
GSSG_HOST=0.0.0.0
GSSG_PORT=8765
GSSG_LOG_LEVEL=INFO
GSSG_DEV_MODE=false
GSSG_SECURE_COOKIES=1
GSSG_PUBLIC_BASE_URL=https://gssg.lan
```

Preserve the existing enable/disable state of SMS, OpenWA, and attendance integrations. Do not infer that an integration should be enabled from the presence of an old credential file.

## 4.6 Secure copied key files

Run as `Admin` after final key restoration:

```powershell
Set-Location C:\Users\Admin\sentinel
powershell -ExecutionPolicy Bypass -File .\scripts\secure_key_acls.ps1 -DataDir C:\Users\Admin\sentinel\data
icacls C:\Users\Admin\sentinel\data\.email_key
icacls C:\Users\Admin\sentinel\data\.vapid_key
```

Only the `Admin` service account should have access to these key files.

---

# 5. Staging without duplicate production work

Do not install or start `GSSGManager`, Caddy, Cloudflared, or the WAHA autostart task yet.

For any staged backend smoke run:

- use only a disposable staged database copy;
- bind to loopback;
- set `GSSG_DISABLE_SCHEDULER=1` in the process environment;
- temporarily set SMS and OpenWA disabled in the staged root `.env`;
- do not run email sync, attendance ingestion, notifications, or user traffic.

Start the actual program in one PowerShell:

```powershell
Set-Location C:\Users\Admin\sentinel
$env:GSSG_DISABLE_SCHEDULER = '1'
$env:GSSG_HOST = '127.0.0.1'
.\venv\Scripts\python.exe .\backend\serve.py
```

From another PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/api/v1/system/health
```

Stop the backend with `Ctrl+C`. Clear the process-only variables by closing that PowerShell. Restore the copied production enable/disable values before final service installation.

Do not point `gssg.lan` or `gssg.app` to `GSSGAPP` during staging.

---

# 6. Final cutover

Perform these steps in order. Do not parallelize them.

Use elevated PowerShell on both PCs for service, scheduled-task, firewall, and WSL operations.

## 6.1 Freeze the old application

1. Announce a write freeze.
2. On `GSSGIT`, stop the application:

```powershell
Set-Location C:\Users\Admin\sentinel
.\scripts\mng.ps1 stop
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'serve\.py' } |
  Select-Object ProcessId, CommandLine
```

The process query must return nothing.

3. Stop public and local application routing on `GSSGIT`, then disable all three auto-start services so a Windows Update reboot cannot resurrect the stale application:

```powershell
Stop-Service Cloudflared
Stop-Service Caddy
Set-Service GSSGManager -StartupType Disabled
Set-Service Cloudflared -StartupType Disabled
Set-Service Caddy -StartupType Disabled
```

4. Stop WAHA and its task on `GSSGIT`:

```powershell
Disable-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
wsl.exe -d podman-uosserver -- podman stop waha
wsl.exe --terminate podman-uosserver
```

5. Confirm `GSSGManager`, `Cloudflared`, and `Caddy` are stopped and disabled. Do not stop Windows file sharing or the explicitly retained N8N tasks.

## 6.2 Take the final data and external-state copy

On `GSSGIT`, overwrite the staged `data` transfer with the final closed state:

```powershell
$TransferRoot = 'D:\GSSG-Transfer'
$SourceData = 'C:\Users\Admin\sentinel\data'
$FinalData = Join-Path $TransferRoot 'final-data'
New-Item -ItemType Directory -Force $FinalData | Out-Null
robocopy $SourceData $FinalData /E /COPY:DAT /DCOPY:DAT /XJ /R:2 /W:2
if ($LASTEXITCODE -ge 8) { throw "final data copy failed with exit code $LASTEXITCODE" }
Get-Item (Join-Path $FinalData 'gssg.db') | Select-Object FullName, Length, LastWriteTime
Get-ChildItem $FinalData -Force -Filter '.email_key'
Get-ChildItem $FinalData -Force -Filter '.vapid_key'
```

Do not delete SQLite WAL or SHM files. A clean shutdown normally checkpoints them; if they remain, copy them with `gssg.db` as the command does.

Copy the final Caddy state while old Caddy is stopped:

```powershell
$FinalCaddy = Join-Path $TransferRoot 'final-caddy-data'
robocopy C:\Tools\caddy\data $FinalCaddy /E /COPY:DATS /DCOPY:DAT /XJ /R:2 /W:2
if ($LASTEXITCODE -ge 8) { throw "Caddy state copy failed with exit code $LASTEXITCODE" }
```

Take a final WAHA distribution export because authentication or delivery-store state may have changed after the early export:

```powershell
wsl.exe --export podman-uosserver (Join-Path $TransferRoot 'podman-uosserver-final.tar')
```

Record the cutover time and source database facts:

```powershell
Get-Date -Format o
Get-Item C:\Users\Admin\sentinel\data\gssg.db | Select-Object FullName, Length, LastWriteTime
```

## 6.3 Restore final state on `GSSGAPP`

Replace the staged `data` directory with the final copy only after confirming no staged backend is running:

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'serve\.py' }
Remove-Item C:\Users\Admin\sentinel\data -Recurse -Force
Copy-Item D:\GSSG-Transfer\final-data C:\Users\Admin\sentinel\data -Recurse -Force
```

The process query must return nothing before `Remove-Item`. This destination is the disposable staged copy, not user-authored data.

Replace Caddy state:

```powershell
if (Get-Service Caddy -ErrorAction SilentlyContinue) { Stop-Service Caddy -ErrorAction SilentlyContinue }
Remove-Item C:\Tools\caddy\data -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item D:\GSSG-Transfer\final-caddy-data C:\Tools\caddy\data -Recurse -Force
```

Replace the early WSL import with the final export:

```powershell
wsl.exe --terminate podman-uosserver
wsl.exe --unregister podman-uosserver
Remove-Item C:\WSL\podman-uosserver -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force C:\WSL\podman-uosserver | Out-Null
wsl.exe --import podman-uosserver C:\WSL\podman-uosserver `
  D:\GSSG-Transfer\podman-uosserver-final.tar --version 2
```

Restore the recorded default Linux user if needed, then verify rootless Podman and `waha_sessions` again.

Apply migrations and secure keys:

```powershell
Set-Location C:\Users\Admin\sentinel
.\venv\Scripts\python.exe -m alembic upgrade head
.\venv\Scripts\python.exe -m alembic current
.\venv\Scripts\python.exe -m alembic heads
powershell -ExecutionPolicy Bypass -File .\scripts\secure_key_acls.ps1 -DataDir .\data
Get-Item .\data\gssg.db | Select-Object FullName, Length, LastWriteTime
```

Exactly one Alembic head is required.

## 6.4 Install the backend service as `Admin`

The installer starts the service. Run it only now, after `GSSGIT` is stopped and the final database is restored:

```powershell
Set-Location C:\Users\Admin\sentinel
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 `
  -Nssm C:\Tools\nssm\nssm-2.24\win64\nssm.exe
Stop-Service GSSGManager
& 'C:\Tools\nssm\nssm-2.24\win64\nssm.exe' edit GSSGManager
```

In the NSSM **Log on** tab, choose **This account**, enter `.\Admin`, and enter the password interactively. Do not put the password in a command, file, chat, or screenshot.

Verify NSSM settings:

```powershell
$nssm = 'C:\Tools\nssm\nssm-2.24\win64\nssm.exe'
@('Application','AppParameters','AppDirectory','ObjectName','Start','AppRestartDelay') |
  ForEach-Object { "$_=$((& $nssm get GSSGManager $_ 2>$null) -join ' ')" }
```

Required values:

```text
Application=C:\Users\Admin\sentinel\venv\Scripts\python.exe
AppParameters=C:\Users\Admin\sentinel\backend\serve.py
AppDirectory=C:\Users\Admin\sentinel
ObjectName=.\Admin
Start=SERVICE_AUTO_START
AppRestartDelay=3000
```

Start and verify the backend before exposing traffic:

```powershell
Start-Service GSSGManager
.\scripts\mng.ps1 status
Invoke-RestMethod http://127.0.0.1:8765/api/v1/system/health
```

## 6.5 Install Caddy and office firewall rules

Install Caddy after final CA state is restored:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-caddy-service.ps1
```

Create only required office-LAN firewall rules:

```powershell
New-NetFirewallRule -DisplayName 'GSSG HTTPS (Caddy)' -Direction Inbound `
  -Protocol TCP -LocalPort 443 -Action Allow -Profile Private,Public `
  -RemoteAddress LocalSubnet
New-NetFirewallRule -DisplayName 'GSSG HTTP redirect (Caddy)' -Direction Inbound `
  -Protocol TCP -LocalPort 80 -Action Allow -Profile Private,Public `
  -RemoteAddress LocalSubnet
```

Optional direct diagnostics only:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\firewall-lan.ps1 -Port 8765
```

Do not recreate broad Python or Node allow-all firewall rules.

Before changing router DNS, test Caddy locally:

```powershell
Resolve-DnsName gssg.lan -ErrorAction SilentlyContinue
Invoke-RestMethod https://gssg.lan/api/v1/system/health
```

If `gssg.lan` still resolves to `GSSGIT`, test from `GSSGAPP` only after temporarily mapping the name to the new address in the local hosts file, then remove that temporary entry before DNS cutover.

Change the router's local DNS record for `gssg.lan` to the reserved `GSSGAPP` address. Flush client DNS caches or wait for the local TTL.

## 6.6 Move the existing Cloudflare connector

Confirm the old `Cloudflared` service is stopped on `GSSGIT`. Then install the connector on `GSSGAPP`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-cloudflared-service.ps1
Get-Service Cloudflared
```

Do not create a new tunnel. The existing tunnel must use:

```text
Tunnel: 561c7c0f-32f1-435a-8cc7-bcbe780704fa
Hostname: gssg.app
Origin: http://127.0.0.1:8765
```

Verify:

```powershell
Invoke-RestMethod https://gssg.app/api/v1/system/health
```

## 6.7 Start WAHA and production tasks

Start WAHA from the restored distribution:

```powershell
Set-Location C:\Users\Admin\sentinel
powershell -ExecutionPolicy Bypass -File .\deploy\openwa\run-waha.ps1
powershell -ExecutionPolicy Bypass -File .\deploy\openwa\install-autostart-task.ps1
Get-ScheduledTask WAHA-WhatsApp-Gateway
```

Use the local WAHA API with the key loaded from `deploy\openwa\.env`; do not print it. Confirm session `gssg` is `WORKING`. A QR re-login is the last recovery path, used only when the restored session cannot be recovered.

Install a nightly backup. Prefer a second local disk or secured backup share; this example uses `D:\GSSG-Backups`:

```powershell
New-Item -ItemType Directory -Force D:\GSSG-Backups | Out-Null
powershell -ExecutionPolicy Bypass -File .\scripts\install-backup-task.ps1 `
  -Dest D:\GSSG-Backups -Keep 14
Start-ScheduledTask -TaskName GSSGManagerBackup
```

Use the actual protected backup location if `D:` is only the temporary transfer disk.

The scheduled task is not a complete machine-recovery bundle. It backs up `gssg.db` and selected file trees (`vault`, `book_attachments`, `ledger_attachments`, `signatures`, `output`, and `leave_certificates`). It does not back up `.env`, `.email_key`, `.vapid_key`, Caddy CA state, Cloudflare credentials, the WAHA WSL distribution, or every newer `data` subdirectory. Keep the encrypted final migration bundle and a protected full-state copy until a separately reviewed backup expansion replaces this requirement.

---

# 7. Verification matrix

Record the result and evidence for every enabled production surface.

| Surface | Check | Required evidence |
|---|---|---|
| Identity | `$env:COMPUTERNAME` | `GSSGAPP` |
| Build tools | Python, Node, pnpm, Git version commands | Python 3.12; Node 24; pnpm 11.6.0 |
| OCR runtime | Tesseract version and language list | `ara`, `eng`, `osd` |
| Word COM | Create and quit `Word.Application` as `Admin` | Version/path returned without dialog |
| WSL/Podman | `wsl -l -v`, Podman info | `podman-uosserver`, WSL2, rootless |
| Database | Alembic current/heads | Current revision; exactly one head |
| Backend | `scripts\mng.ps1 status` | Running and healthy |
| Office HTTPS | Health URL from another office PC and phone | `https://gssg.lan` succeeds without certificate warning |
| Hostname HTTPS | Health URL on capable office client | `https://gssgapp.local` succeeds |
| Public HTTPS | Public health URL | `https://gssg.app` reaches new version |
| Existing data | Login and inspect representative records/attachments | Current records and files present |
| Email | Connect/sync a configured account | Stored credential decrypts and connection succeeds |
| Documents | Generate DOCX, open Edit in Word, create PDF | All three operations succeed |
| OCR | Known Arabic/English scan | Extracted text returned |
| WhatsApp | WAHA session and controlled message | `WORKING`; message arrives |
| SMS | Controlled message | Message arrives |
| Attendance | Current owner/provider health | Freshness advances without duplicate ingestion |
| Web Push | Controlled notification to existing subscription | Notification arrives; old VAPID identity preserved |
| Backup | Start scheduled task and inspect destination | Readable backup created |
| Old shares | Open existing mapped share | Files remain accessible on `GSSGIT` |
| Old app | Check old services | Old backend, Caddy application route, Cloudflared, and WAHA sender remain stopped |

Run these service checks before ending the write freeze:

```powershell
Get-Service GSSGManager, Caddy, Cloudflared
Get-ScheduledTask WAHA-WhatsApp-Gateway, GSSGManagerBackup
Invoke-RestMethod http://127.0.0.1:8765/api/v1/system/health
Invoke-RestMethod https://gssg.lan/api/v1/system/health
Invoke-RestMethod https://gssg.app/api/v1/system/health
```

Reboot `GSSGAPP`, then repeat service, WAHA, office HTTPS, public HTTPS, and backup checks. The migration is not complete until the system survives this reboot.

An integration that was disabled before migration may remain disabled. Every integration that was enabled before migration must pass its observable check.

---

# 8. Rollback

## Before `GSSGAPP` accepts writes

1. On `GSSGAPP`, stop and disable every application component so a reboot cannot reactivate the destination during rollback:

```powershell
Stop-Service GSSGManager, Caddy, Cloudflared
Set-Service GSSGManager -StartupType Disabled
Set-Service Caddy -StartupType Disabled
Set-Service Cloudflared -StartupType Disabled
Disable-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
wsl.exe -d podman-uosserver -- podman stop waha
wsl.exe --terminate podman-uosserver
```

2. On `GSSGIT`, restore and start the source components:

```powershell
Set-Service GSSGManager -StartupType Automatic
Set-Service Caddy -StartupType Automatic
Set-Service Cloudflared -StartupType Automatic
Enable-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
Start-Service GSSGManager
Start-Service Caddy
Start-Service Cloudflared
Start-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
```

3. Repoint `gssg.lan` to `GSSGIT`.
4. Verify office/public health and representative records.

## After `GSSGAPP` accepts writes

DNS-only rollback is forbidden because it loses or forks production data.

1. Announce a write freeze.
2. On `GSSGAPP`, stop and disable every application component:

```powershell
Stop-Service GSSGManager, Caddy, Cloudflared
Set-Service GSSGManager -StartupType Disabled
Set-Service Caddy -StartupType Disabled
Set-Service Cloudflared -StartupType Disabled
Disable-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
wsl.exe -d podman-uosserver -- podman stop waha
wsl.exe --terminate podman-uosserver
```

3. Confirm no `serve.py` process remains.
4. Copy the complete latest `GSSGAPP\data` directory back to `GSSGIT`, preserving hidden files, keys, attachments, SQLite WAL/SHM files, ACLs, and timestamps.
5. Confirm `.email_key`, `.vapid_key`, and database size on `GSSGIT`.
6. Apply only migrations required by the code commit that will run on `GSSGIT`.
7. On `GSSGIT`, restore automatic startup and start only the backend:

```powershell
Set-Service GSSGManager -StartupType Automatic
Set-Service Caddy -StartupType Automatic
Set-Service Cloudflared -StartupType Automatic
Start-Service GSSGManager
```

8. Verify the old backend over loopback and inspect representative records.
9. Repoint `gssg.lan`, then restore routing and WAHA:

```powershell
Start-Service Caddy
Start-Service Cloudflared
Enable-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
Start-ScheduledTask -TaskName WAHA-WhatsApp-Gateway
```

10. Confirm schedulers, email sync, and notifications are active only on `GSSGIT`.
11. Repeat the production verification matrix.

Never enable notification workers on both hosts during rollback.

---

# 9. Closeout

After successful reboot verification and the agreed rollback window:

- keep the old GSSG application services disabled;
- keep required file shares and approved N8N tasks on `GSSGIT`;
- remove old `gssgit` hostnames from `deploy\Caddyfile` in a normal reviewed commit;
- update office bookmarks from `gssgit.local` to `gssg.lan`;
- securely delete transfer copies containing secrets;
- retain at least one verified backup outside `GSSGAPP`;
- document the reserved `GSSGAPP` address and backup location in the office operations system, not in Git;
- use `scripts\mng.ps1 update` for future production updates only after changes are committed and pushed to `origin/main`.