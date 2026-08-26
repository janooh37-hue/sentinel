# GSSG Manager Server Migration Runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authoritative, agent-executable Windows migration runbook that moves the live application to `GSSGAPP` while `GSSGIT` remains the office file server.

**Architecture:** Keep migration knowledge in one root-level operational runbook and make it discoverable from `AGENTS.md`. The runbook separates prerequisite installation, non-repository state transfer, safe staging, single-writer cutover, verification, and rollback; it does not add an installer or commit secrets.

**Tech Stack:** Windows 11 Pro, PowerShell 5.1+, Python 3.12, pnpm 11.6.0, Microsoft Word COM, NSSM, Caddy, cloudflared, WSL2, rootless Podman, WAHA, SQLite.

## Global Constraints

- Old file server identity remains `GSSGIT`; new application server identity is `GSSGAPP`.
- Preserve `https://gssg.lan` and `https://gssg.app`; use `https://gssgapp.local` for the new hostname and retire `https://gssgit.local` as an application URL.
- Never run old and new application hosts as independent writable production servers.
- Never run both Cloudflare connectors while they target divergent application data.
- Never commit `.env`, `deploy/openwa/.env`, `data`, Cloudflare credentials, Caddy private keys, WAHA session data, passwords, or generated static assets.
- Recreate `venv`, `frontend/node_modules`, and frontend static output on `GSSGAPP`; do not treat copied build artifacts as installation inputs.
- Preserve `data/.email_key`, `data/.vapid_key`, the Caddy CA, Cloudflare tunnel credential, `.gssg_admin_key`, and the WAHA session state.
- `GSSGManager` runs as `.\Admin`; Caddy and Cloudflared may run as `LocalSystem`.
- Do not open or resave `backend/templates/*.docx` while preparing documentation.
- Documentation must contain variable names and paths, never live secret values.
- No automated application tests are required because this change is documentation-only; validation covers command accuracy, referenced repository paths, internal consistency, and secret hygiene.

---

## File structure

- Create `SERVER-MIGRATION.md`: complete execution runbook. One file owns prerequisites, exports, staging, cutover, verification, and rollback so an operator never has to merge partial instructions.
- Modify `AGENTS.md`: one production-safety pointer to `SERVER-MIGRATION.md` and the single-writer rule.

No application code, deployment script, environment file, database, generated asset, or template changes are part of this implementation.

### Task 1: Create the authoritative migration runbook

**Files:**
- Create: `SERVER-MIGRATION.md`
- Reference: `docs/superpowers/specs/2026-08-24-server-migration-design.md`
- Reference: `requirements.txt`
- Reference: `frontend/package.json`
- Reference: `frontend/pnpm-lock.yaml`
- Reference: `scripts/install-service.ps1`
- Reference: `scripts/install-caddy-service.ps1`
- Reference: `scripts/install-cloudflared-service.ps1`
- Reference: `scripts/install-backup-task.ps1`
- Reference: `scripts/firewall-lan.ps1`
- Reference: `scripts/secure_key_acls.ps1`
- Reference: `scripts/mng.ps1`
- Reference: `deploy/Caddyfile`
- Reference: `deploy/cloudflared/config.yml`
- Reference: `deploy/openwa/run-waha.ps1`
- Reference: `deploy/openwa/install-autostart-task.ps1`
- Reference: `docs/superpowers/ocr-server-setup.md`

**Interfaces:**
- Consumes: approved server identity, current production inventory, and repository deployment scripts.
- Produces: a sequential checklist that an administrator or agent can execute without reading the design specification.

- [ ] **Step 1: Write the title, audience, outcome, and stop conditions**

Create `SERVER-MIGRATION.md` with an opening block that states:

- Source application host: `GSSGIT`.
- Destination application host: `GSSGAPP`.
- `GSSGIT` remains online only for shared folders and any explicitly retained adjacent jobs.
- Office URL remains `https://gssg.lan`.
- Public URL remains `https://gssg.app`.
- `https://gssgit.local` is not an application URL after cutover.
- The operator must stop if the old backend still accepts writes, a secret/key file is missing, the final SQLite copy was taken while Python was running, or verification finds both Cloudflare connectors serving divergent data.

Add a prominent invariant: one writable GSSG database, one active scheduler, and one production notification sender at every point in the migration.

- [ ] **Step 2: Add the migration constants and live inventory**

Document these exact identities and paths:

```text
Old PC: GSSGIT
New PC: GSSGAPP
Windows user: Admin
Repository: C:\Users\Admin\sentinel
Backend port: 8765
Office URL: https://gssg.lan
New hostname URL: https://gssgapp.local
Public URL: https://gssg.app
Tunnel ID: 561c7c0f-32f1-435a-8cc7-bcbe780704fa
Tunnel credential: C:\Users\Admin\.cloudflared\561c7c0f-32f1-435a-8cc7-bcbe780704fa.json
Caddy state: C:\Tools\caddy\data
WAHA WSL distribution: podman-uosserver
WAHA container: waha
WAHA volume: waha_sessions
WAHA loopback endpoint: http://127.0.0.1:2785
```

Record the observed source-host versions as migration baselines:

```text
Python 3.12.10
Node.js 24.18.0
pnpm 11.6.0
Git 2.54.0
Microsoft Word 16.0 desktop
NSSM 2.24
Caddy 2.11.4
cloudflared 2026.7.3
Tesseract 5.4.0.20240606
Podman 5.8.6
```

State that compatible security-patched releases may be newer, except Python remains 3.12 and pnpm remains 11.6.0 for this migration. Do not claim that Python and frontend package files install Word, NSSM, Caddy, cloudflared, Tesseract, WSL, Podman, or WAHA.

- [ ] **Step 3: Add the external dependency inventory**

Create a table with columns `Dependency`, `Location`, `Move or retain`, and `Verification`. Include:

- Android SMS gateway: retained external device; verify from `GSSGAPP`.
- BioTime: retained external server; verify provider health and attendance freshness.
- Cloudflare named tunnel: move connector credential; never create a second tunnel.
- Office router: reserve `GSSGAPP` address and repoint `gssg.lan` during cutover.
- Office WhatsApp number: preserve through WAHA session state or perform a controlled QR re-login only if restore fails.
- `N8Nionos` tasks on `GSSGIT`: retain unless separately migrated; verify their production endpoint after cutover.
- Tailscale: optional remote-administration dependency, not required by GSSG runtime.

Name the observed old-PC scheduled tasks so the next agent does not mistake them for Sentinel-owned files:

```text
GSSG Attendance Watchdog
GSSG Attendance Worker
GSSG n8n
```

State that these tasks point to `C:\Users\Admin\Projects\N8Nionos` and are outside the Sentinel migration.

- [ ] **Step 4: Add destination hardware, account, and Windows preparation**

Require:

- Windows 11 Pro x64 and an `Admin` local account.
- The computer name set to `GSSGAPP` before services are installed.
- At least 8 GB RAM and a system-managed page file; frontend build requires approximately 1.8 GB free commit.
- A DHCP reservation or static address unique from `GSSGIT`.
- Interactive login as `Admin` before configuring Word COM or user-owned WSL state.
- Current Windows updates and a reboot before application installation.

Provide PowerShell verification commands that print the hostname, Windows edition, RAM, active IPv4 address, and free disk space. Derive the active office address at execution time; do not embed the old `192.168.15.102` address as the new server address.

- [ ] **Step 5: Add host-software installation and verification**

Write one subsection per prerequisite. Prefer standard installers or copied known-good binaries where repository scripts require fixed paths.

Include these requirements and outcomes:

1. Install Python 3.12 for all users; verify `py -3.12 --version` or the installed `python.exe` reports 3.12.
2. Install Git.
3. Install Node.js 24 LTS, enable Corepack, and activate pnpm 11.6.0:

```powershell
corepack enable
corepack prepare pnpm@11.6.0 --activate
pnpm --version
```

4. Install Microsoft Word desktop, sign in/activate as `Admin`, open and close Word once, and verify COM creation from the same account.
5. Place NSSM 2.24 at `C:\Tools\nssm\nssm-2.24\win64\nssm.exe`.
6. Place Caddy at `C:\Tools\caddy\caddy.exe` and verify `caddy version`.
7. Place cloudflared at `C:\Tools\cloudflared\cloudflared.exe` and verify `cloudflared --version`.
8. Install Tesseract at `C:\Program Files\Tesseract-OCR\tesseract.exe`. Install and verify `ara`, `eng`, and `osd`; reuse the Arabic language-pack command from `docs/superpowers/ocr-server-setup.md`.
9. Enable WSL2 and Virtual Machine Platform, then reboot before importing the WAHA distribution.

Where an installer path differs, require passing the explicit path to the repository PowerShell installer rather than editing scripts casually.

- [ ] **Step 6: Add source-host export instructions**

Separate the early copy from the final write-frozen copy.

For the early copy:

- Copy the Sentinel tree with hidden files and empty directories.
- Exclude `venv`, `frontend/node_modules`, backend generated static output, caches, logs that are not required, and worktrees from the installation input.
- Preserve `.env`, `deploy/openwa/.env`, `data`, source, migrations, lockfiles, templates, and scripts.
- Do not place the transfer archive in Git.

For non-repository state:

- Export or securely copy `C:\Tools\caddy\data` while preserving ACLs.
- Securely copy the exact Cloudflare credential JSON.
- Copy `C:\Users\Admin\.gssg_admin_key` when present.
- Record any backup destination outside Sentinel.
- Export the complete `podman-uosserver` WSL distribution after stopping WAHA and terminating the distribution:

```powershell
wsl.exe -d podman-uosserver -- podman stop waha
wsl.exe --terminate podman-uosserver
wsl.exe --export podman-uosserver D:\GSSG-Transfer\podman-uosserver.tar
```

Explain that exporting the distribution preserves Podman, the WAHA image, rootless configuration, `waha_sessions`, WhatsApp authentication, and the delivery-store configuration in one artifact. Restart WAHA on the old host after the early export so production continues until cutover.

Do not show or log environment values, the WAHA API key, SMS credentials, BioTime credentials, email passwords, or Cloudflare credential contents.

- [ ] **Step 7: Add destination repository installation**

Provide exact PowerShell commands from `C:\Users\Admin\sentinel`:

```powershell
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install --upgrade pip
.\venv\Scripts\python.exe -m pip install -r requirements.txt
pnpm -C frontend install --frozen-lockfile
.\scripts\mng.ps1 build
.\venv\Scripts\python.exe -m alembic upgrade head
```

Require checking `frontend/package.json` still declares pnpm 11.6.0 before installation. Explain that `mng build` generates `frontend\dist` and copies it into `backend\app\static`; generated output is local and is not committed.

Run `scripts\secure_key_acls.ps1` after final secret and key restoration, using the script's supported parameters and an elevated shell.

- [ ] **Step 8: Add WSL/WAHA restoration**

Import the exported distribution to a durable local directory:

```powershell
New-Item -ItemType Directory -Force C:\WSL\podman-uosserver | Out-Null
wsl.exe --import podman-uosserver C:\WSL\podman-uosserver D:\GSSG-Transfer\podman-uosserver.tar --version 2
wsl.exe -d podman-uosserver -- podman --version
wsl.exe -d podman-uosserver -- podman volume inspect waha_sessions
```

Require verifying that the imported distribution runs Podman as the expected rootless user and that `waha_sessions` exists before starting the container. Restore `deploy/openwa/.env` securely, confirm its key matches root `GSSG_OPENWA_API_KEY` without printing either value, then use `deploy\openwa\run-waha.ps1`.

Install `WAHA-WhatsApp-Gateway` with `deploy\openwa\install-autostart-task.ps1`. Confirm the session reports `WORKING`. If it does not, stop and diagnose the imported user/volume before recreating the session; QR login is the explicit last recovery path.

- [ ] **Step 9: Add Caddy, Cloudflare, environment, and network configuration**

Require the migration agent to make and push the tracked Caddy hostname change before it becomes production configuration:

```text
Replace gssgit.local and gssgit with gssgapp.local and gssgapp.
Keep gssg.lan.
Keep the fixed Caddy storage root C:/Tools/caddy/data.
```

Restore Caddy state before starting Caddy. Restore the Cloudflare credential JSON and confirm `deploy/cloudflared/config.yml` still points to the exact tunnel and credential path. Do not run `tunnel create` or `tunnel route dns`; reuse the existing tunnel.

Update the new host's root `.env` locally:

```text
GSSG_HOST=0.0.0.0
GSSG_PORT=8765
GSSG_DEV_MODE=false
GSSG_SECURE_COOKIES=1
GSSG_PUBLIC_BASE_URL=https://gssg.lan
```

Preserve all existing secret/integration values without copying them into the runbook. State that `backend/app/config.py` loads the repository-root `.env`, not `backend/.env`. Do not automatically move BioTime credentials into root `.env`: that could enable a second provider beside the retained N8N worker. Preserve current attendance ownership and require a separate reviewed change before enabling built-in BioTime sync.

Create narrowly scoped firewall rules for TCP 80 and 443 from `LocalSubnet`. Retain TCP 8765 from `LocalSubnet` only if direct backend access is intentionally required. Do not recreate broad Python or Node inbound rules.

- [ ] **Step 10: Add safe staging instructions**

Before the final data copy:

- Keep `GSSGManager`, Caddy, and Cloudflared uninstalled or stopped on `GSSGAPP`.
- Disable application scheduler execution for any manual backend smoke run with `GSSG_DISABLE_SCHEDULER=1`.
- Disable SMS and OpenWA in the staged environment.
- Bind staging to loopback.
- Do not run email synchronization, attendance ingestion, scheduled jobs, outbound notifications, or migrations against the old host's live database over a share.
- Use only a disposable staged database copy.

Provide a loopback health smoke command using `backend\serve.py` and require terminating the process after observing `/api/v1/system/health`. Do not expose staging through `gssg.lan` or `gssg.app`.

- [ ] **Step 11: Add service and scheduled-task installation**

Use the repository installers from an elevated PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1 -Nssm C:\Tools\nssm\nssm-2.24\win64\nssm.exe
powershell -ExecutionPolicy Bypass -File .\scripts\install-caddy-service.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-cloudflared-service.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\install-backup-task.ps1 -Dest D:\GSSG-Backups
```

State that these installers start their service or task. Do not execute the GSSG, Caddy, Cloudflared, or WAHA installers during staging. Run each only at its named cutover step after the old conflicting component is stopped and disabled. If the backup destination is not `D:\GSSG-Backups`, use the actual second-disk or secured network destination recorded during preparation.

Immediately after installing `GSSGManager`, open the NSSM editor and set **Log on** to `.\Admin` interactively. Never include the password in the runbook or an agent command. Verify NSSM reports:

```text
Application=C:\Users\Admin\sentinel\venv\Scripts\python.exe
AppParameters=C:\Users\Admin\sentinel\backend\serve.py
AppDirectory=C:\Users\Admin\sentinel
ObjectName=.\Admin
Start=SERVICE_AUTO_START
AppRestartDelay=3000
```

- [ ] **Step 12: Add final single-writer cutover**

Write a numbered, check-off sequence with no parallel production steps:

1. Announce write freeze and stop user activity.
2. Stop `GSSGManager` on `GSSGIT`.
3. Confirm no Python command line contains `serve.py`.
4. Stop Caddy and Cloudflared on `GSSGIT`, then set `GSSGManager`, Caddy, and Cloudflared startup type to `Disabled` so a reboot cannot resurrect stale application services.
5. Disable `WAHA-WhatsApp-Gateway`, stop WAHA, and terminate `podman-uosserver` on `GSSGIT`.
6. Take the final Sentinel `data` copy, preserving hidden files, ACLs, timestamps, SQLite database, WAL, SHM, attachments, and keys.
7. Take the final WSL export if WhatsApp state changed after the early export; replace the staged import on `GSSGAPP` with this final export before starting WAHA.
8. Restore final `data` to `GSSGAPP`.
9. Apply Alembic migrations with the new venv.
10. Start only the backend and confirm loopback health.
11. Change router DNS `gssg.lan` to the reserved `GSSGAPP` address.
12. Start Caddy and verify office HTTPS.
13. Start the new Cloudflared connector and verify public HTTPS.
14. Start WAHA and production scheduling/notifications.
15. Run the verification matrix.
16. Confirm the old GSSG backend, old Caddy application routing, old Cloudflared connector, and old WAHA notification role remain stopped and disabled across reboot; leave Windows file sharing and approved `N8Nionos` tasks running.

Require recording the cutover timestamp and final source/destination database file sizes. Do not declare success merely because the Windows services are running.

- [ ] **Step 13: Add the verification matrix**

Create a table with `Surface`, `Command or action`, `Expected evidence`, and `Result`. Include:

- `hostname` reports `GSSGAPP`.
- Python, Node, pnpm, Git, NSSM, Caddy, cloudflared, Tesseract, Word COM, WSL, and Podman versions.
- Tesseract language list includes `ara`, `eng`, and `osd`.
- Alembic reports current head and repository history has exactly one head.
- `scripts\mng.ps1 status` and loopback health are healthy.
- `https://gssg.lan/api/v1/system/health` works from another office PC.
- `https://gssg.app/api/v1/system/health` works through Cloudflare.
- Existing user login and representative records succeed.
- Stored email account decrypts and a controlled connection/sync succeeds.
- A representative DOCX is generated, opened for editing in Word, and converted to PDF.
- Arabic and English OCR return text from a known document.
- WAHA session is `WORKING` and one controlled WhatsApp test arrives.
- One controlled SMS test arrives.
- BioTime provider health is healthy and attendance freshness advances.
- Existing Web Push subscription receives a controlled notification, proving `.vapid_key` was preserved.
- Backup scheduled task creates a readable SQLite backup in the external destination.
- Reboot restores backend, Caddy, Cloudflared, WAHA, and scheduled backup behavior.
- File shares on `GSSGIT` remain accessible.
- Old `GSSGManager`, Caddy, Cloudflared, and `WAHA-WhatsApp-Gateway` remain stopped and disabled across reboot.

State that failed optional integrations may remain disabled only when they were disabled before migration; enabled production features must pass before ending the write freeze.

- [ ] **Step 14: Add rollback instructions**

Separate rollback into two cases:

- Before new writes: stop new services, point `gssg.lan` back, start the old backend and old Cloudflared connector, then verify health.
- After new writes: freeze writes, stop all new application processes, copy the complete latest `data` state back to `GSSGIT`, verify key files and SQLite closure, start the old backend, restore DNS/tunnel routing, and verify representative records.

State explicitly that DNS-only rollback after new writes is forbidden. Enable WAHA, schedulers, email sync, and notifications on only one host.

- [ ] **Step 15: Validate the runbook against repository reality**

Check every referenced repository path exists. Confirm commands match parameter names in the actual PowerShell scripts. Confirm the runbook explains the current differences that installers do not infer automatically:

- `GSSGManager` must use `.\Admin`.
- Caddy state lives outside Sentinel.
- Cloudflare credential JSON lives outside Sentinel.
- WAHA session state lives in WSL/Podman.
- Root `.env`, not `backend/.env`, is the Pydantic settings file.
- Caddy needs explicit office firewall rules for 80 and 443.
- The old PC stays online but not as an application writer.

Scan the runbook for incomplete markers, ambiguous host references, and accidental secret values. Replace every bare “server” with `GSSGIT`, `GSSGAPP`, or a clearly defined generic role where confusion is possible.

- [ ] **Step 16: Commit the runbook**

```powershell
git add SERVER-MIGRATION.md
git commit -m "docs: add production server migration runbook"
```

### Task 2: Make the runbook mandatory and discoverable

**Files:**
- Modify: `AGENTS.md` under `## Production safety`
- Reference: `SERVER-MIGRATION.md`

**Interfaces:**
- Consumes: the root-level migration runbook from Task 1.
- Produces: an instruction automatically visible to future repository agents.

- [ ] **Step 1: Add the production-safety pointer**

Add one bullet under `## Production safety`:

```markdown
- Before moving production to another Windows host, read and follow `SERVER-MIGRATION.md`. Never start the destination backend, scheduler, notification senders, or Cloudflare connector against a copied production database while the source application is still writable.
```

Do not duplicate the runbook inside `AGENTS.md`; the pointer and invariant are enough.

- [ ] **Step 2: Verify discoverability and consistency**

Confirm:

- `SERVER-MIGRATION.md` exists at the repository root.
- The final server name is `GSSGAPP` everywhere.
- The old server name is `GSSGIT` everywhere.
- `gssg.lan` and `gssg.app` remain stable URLs.
- `gssgapp.local` replaces `gssgit.local` as the hostname URL.
- The pointer does not imply the old file server must be shut down; only its application writer and connectors are disabled.

- [ ] **Step 3: Commit the agent instruction**

```powershell
git add AGENTS.md
git commit -m "docs: require server migration runbook"
```

### Task 3: Final documentation gate

**Files:**
- Verify: `SERVER-MIGRATION.md`
- Verify: `AGENTS.md`
- Verify: `docs/superpowers/specs/2026-08-24-server-migration-design.md`

**Interfaces:**
- Consumes: both documentation deliverables.
- Produces: a clean, committed branch ready for review and later migration execution.

- [ ] **Step 1: Run repository-path checks**

From the repository root, use `Test-Path` for every script and config referenced by the runbook. Every result must be `True`:

```powershell
@(
  'requirements.txt',
  'frontend\package.json',
  'frontend\pnpm-lock.yaml',
  'scripts\install-service.ps1',
  'scripts\install-caddy-service.ps1',
  'scripts\install-cloudflared-service.ps1',
  'scripts\install-backup-task.ps1',
  'scripts\firewall-lan.ps1',
  'scripts\secure_key_acls.ps1',
  'scripts\mng.ps1',
  'deploy\Caddyfile',
  'deploy\cloudflared\config.yml',
  'deploy\openwa\run-waha.ps1',
  'deploy\openwa\install-autostart-task.ps1',
  'docs\superpowers\ocr-server-setup.md'
) | ForEach-Object { "$_=$([bool](Test-Path $_))" }
```

- [ ] **Step 2: Check documentation formatting**

Run:

```powershell
git diff --check HEAD~2..HEAD
```

Expected: no output and exit code 0.

Confirm all checklist code blocks are syntactically complete PowerShell or clearly marked text, and every destructive operation names the source and destination host.

- [ ] **Step 3: Check repository state and commit history**

Run:

```powershell
git status --short
git log -3 --oneline
```

Expected: clean status. The recent history contains the runbook commit and the `AGENTS.md` pointer commit, in addition to the already committed design specification.

- [ ] **Step 4: Request review before executing the migration**

Present the files and state explicitly that this implementation prepares instructions only. Do not install software, stop production services, copy live data, change router DNS, or begin cutover until the administrator starts a separate migration-execution session on the two PCs.