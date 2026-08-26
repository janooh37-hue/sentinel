# GSSG Manager Server Migration Design

## Purpose

Move the live GSSG Manager application from the current Windows PC to a new Windows PC named `GSSGAPP`, while leaving the old `GSSGIT` PC online as a file server. Preserve production data, integrations, trusted URLs, document conversion, notifications, and recovery behavior.

This design produces an agent-executable migration runbook. It does not automate secrets, Windows account passwords, Microsoft Word activation, router configuration, or the final production cutover.

## Chosen approach

Create `SERVER-MIGRATION.md` at the repository root and add a short discovery pointer to `AGENTS.md`. The runbook is the authoritative checklist for preparing, staging, cutting over, verifying, and rolling back the server.

A documentation-first runbook is safer than a general bootstrap script because several required operations are interactive or host-specific: Microsoft Word activation, NSSM service credentials, Cloudflare tunnel credentials, router DNS, the Caddy trust root, and the WAHA session volume. Disk cloning is rejected because the old PC remains online; cloning would duplicate machine identity, services, tunnels, and scheduled jobs.

## Production identity and URLs

- Old file server: `GSSGIT`; remains online for shared folders.
- New application server: `GSSGAPP`.
- Stable office URL: `https://gssg.lan`.
- New hostname URL: `https://gssgapp.local`.
- Public URL: `https://gssg.app`.
- Retired application URL: `https://gssgit.local`; it continues to identify the old PC and must not route to the application after cutover.

The new PC receives its own DHCP reservation or static LAN address. The migration agent discovers that assigned address with `Get-NetIPAddress` and records it in the execution log. At cutover, office DNS changes `gssg.lan` to that address. No fixed address is embedded in repository documentation because the address is an office-network allocation, not an application constant.

The production root `.env` changes `GSSG_PUBLIC_BASE_URL` to `https://gssg.lan`. The Caddy site names become `gssgapp.local`, `gssgapp`, and `gssg.lan`. The public `gssg.app` origin remains unchanged.

## Required host software

The runbook inventories, installs, and verifies software that is not fully represented by Python or frontend dependency files:

- Windows 11 Pro x64 with current security updates.
- Python 3.12. The virtual environment is recreated on the new PC.
- Node.js with Corepack.
- pnpm 11.6.0, matching `frontend/package.json`.
- Git.
- Microsoft Word desktop, installed and activated for local user `Admin`.
- NSSM 2.24 at the repository scripts' expected path or supplied explicitly to installers.
- Caddy 2.11.4 or a compatible current 2.x release.
- cloudflared compatible with the existing named tunnel.
- Tesseract OCR 5.4-compatible binary with `ara`, `eng`, and `osd` language data.
- WSL2.
- Rootless Podman and a WSL distribution named `podman-uosserver`.
- WAHA using the repository launcher and a persistent `waha_sessions` volume.
- Tailscale only when it is still required for remote administration; it is not an application runtime dependency.

Python packages come from `requirements.txt`. Frontend packages come from `frontend/pnpm-lock.yaml` and are installed with the frozen lockfile. The copied `venv`, `frontend/node_modules`, and generated frontend build are not trusted as migration inputs; they are recreated.

## External systems and adjacent workloads

The runbook distinguishes host dependencies from external services:

- Android SMS gateway, including its reserved address and credentials.
- ZKTeco BioTime endpoint and credentials.
- Cloudflare account, named tunnel, DNS route, and tunnel credential JSON.
- Office router DHCP reservation and local DNS record.
- Office WhatsApp number used by WAHA.
- Existing `N8Nionos` attendance scheduled tasks on the old PC.

The `N8Nionos` tasks point outside the Sentinel repository. They remain on `GSSGIT` unless a separate migration is approved. The runbook requires verifying that they still target the production application endpoint after `gssg.app` moves. They must not be silently recreated on `GSSGAPP`.

## State inventory

### State inside the Sentinel folder

The transfer preserves hidden and ignored files as operational data, not source-control content:

- Root `.env`.
- `deploy/openwa/.env`.
- Entire `data` directory.
- SQLite database and any WAL/SHM files present before shutdown.
- `.email_key`, needed to decrypt stored email credentials.
- `.vapid_key`, needed to preserve existing Web Push subscriptions.
- Attachments, vault files, book packages, generated documents, logs, and backups stored under `data`.
- `backend/templates` without opening or resaving Word files.

Secrets and `data` remain uncommitted. The runbook never prints their values.

### State outside the Sentinel folder

Copying the repository alone is insufficient. The runbook migrates or recreates:

- `C:\Tools\caddy\data`, preserving the existing internal Caddy CA and client trust.
- `C:\Users\Admin\.cloudflared\561c7c0f-32f1-435a-8cc7-bcbe780704fa.json`, with the configured path updated when needed.
- `C:\Users\Admin\.gssg_admin_key`, preserving the admin-gate state.
- Podman's `waha_sessions` volume, preserving WhatsApp authentication and the NOWEB delivery store.
- NSSM service definitions.
- Windows Scheduled Tasks.
- Windows Firewall rules.
- Any backup destination outside `data`.

The Caddy CA is copied before Caddy starts on the new host. Reusing this CA lets existing office devices trust newly issued `gssg.lan` and `gssgapp.local` certificates without installing another root certificate.

## Service model

The new host recreates these production components:

- `GSSGManager` Windows service.
- `Caddy` Windows service.
- `Cloudflared` Windows service.
- `WAHA-WhatsApp-Gateway` Scheduled Task.
- `GSSGManagerBackup` Scheduled Task.

`GSSGManager` must run as local user `.\Admin`, not `LocalSystem`. Microsoft Word COM requires an activated interactive user profile. The runbook uses the NSSM graphical editor or another non-logged interactive mechanism for the password; it never embeds the password in repository files, command history, or agent output.

Caddy and Cloudflared may run as `LocalSystem`. The WAHA task runs as `Admin` and starts `podman-uosserver` after reboot. The backup task runs unattended as `SYSTEM`.

Required inbound firewall rules are limited to office-LAN TCP 80 and 443 for Caddy. TCP 8765 may remain available to `LocalSubnet` only when direct backend diagnostics are intentionally retained. Broad Python or Node allow-all rules are not recreated.

## Staging safety

The new host is prepared without becoming a second live writer.

During staging:

- The old application remains authoritative.
- The new GSSG service is not enabled for automatic start.
- Cloudflared is not started on the new PC.
- Scheduler execution is disabled.
- SMS and WhatsApp sending are disabled.
- Test traffic uses loopback or a temporary host-only path.
- A staged copy of production data is treated as disposable until final cutover.

This prevents duplicate attendance ingestion, scheduled notifications, email sync, SMS, WhatsApp messages, and split-brain SQLite writes.

## Build and configuration flow

On `GSSGAPP`, the migration agent:

1. Installs and verifies host software.
2. Places Sentinel under the `Admin` profile using paths compatible with repository scripts.
3. Creates a new Python virtual environment and installs `requirements.txt`.
4. Installs frontend packages using the frozen pnpm lockfile.
5. Builds the frontend into backend static assets.
6. Applies Alembic migrations to the staged database.
7. Installs and verifies Tesseract language packs.
8. Opens Microsoft Word once as `Admin`, completes activation prompts, and verifies COM automation.
9. Restores Caddy CA state, Cloudflare credentials, the admin gate, and the WAHA volume.
10. Updates host-specific Caddy names and production environment URLs.
11. Installs services and scheduled tasks without enabling production traffic.

## Cutover

The final cutover is a controlled single-writer operation:

1. Announce a write freeze.
2. Stop `GSSGManager` on `GSSGIT` and confirm all `serve.py` Python processes have exited.
3. Stop the old Cloudflared connector so public traffic cannot reach stale data.
4. Stop WAHA when its persistent volume is being exported or copied.
5. Perform the final copy of the entire `data` directory, including hidden key files and attachments.
6. Verify that SQLite is closed. Any remaining WAL and SHM files are copied with the database rather than discarded.
7. Restore the final data on `GSSGAPP` and apply only migrations required by the checked-out commit.
8. Start the backend locally and verify health before exposing it.
9. Repoint `gssg.lan` to the reserved `GSSGAPP` address.
10. Start Caddy, the new Cloudflared connector, WAHA, and production scheduling.
11. Verify every production surface before ending the write freeze.
12. Leave the old GSSG application and old Cloudflared connector disabled. Leave its file-sharing role unchanged.

Both application services are never active against divergent data.

## Verification contract

The runbook records commands and observed results for:

- Hostname and reserved LAN address.
- Python, Node.js, pnpm, Git, NSSM, Caddy, cloudflared, Tesseract, Word, WSL, and Podman.
- Tesseract languages `ara`, `eng`, and `osd`.
- Python imports and frontend build.
- Alembic current revision and exactly one head.
- Local backend health.
- `https://gssg.lan` from another office PC and phone.
- `https://gssg.app` through Cloudflare.
- Login and representative existing records.
- Email credential decryption and mailbox connectivity.
- Word document generation, Word editing, and PDF conversion.
- Arabic and English OCR.
- WAHA session `WORKING` status and a controlled WhatsApp test.
- Controlled SMS test.
- BioTime/provider health and attendance freshness.
- Web Push using the migrated VAPID key.
- Scheduled backup creation and restore readability.
- Service recovery after a reboot.
- Continued file-share access on `GSSGIT`.

The migration is complete only after the application survives a reboot and all enabled integrations have passed their observable checks.

## Rollback

Before the new server accepts writes, rollback consists of stopping new services, restarting the old backend and old Cloudflared connector, and restoring `gssg.lan` DNS.

After the new server accepts writes, DNS reversal alone is forbidden because it loses or forks production data. The rollback procedure is:

1. Freeze writes.
2. Stop all new application processes.
3. Copy the latest complete `data` state from `GSSGAPP` back to `GSSGIT`.
4. Verify SQLite closure and key-file presence.
5. Start the old application.
6. Restore the old Cloudflared connector and local DNS.
7. Verify health and representative records.

WAHA and notification workers are enabled on only one application host throughout rollback.

## Deliverables

Implementation creates:

- `SERVER-MIGRATION.md`: complete dependency, state-transfer, installation, cutover, verification, and rollback instructions for an agent or administrator.
- `AGENTS.md`: a short pointer requiring migration work to read the runbook first.

No installer script, secret file, generated static asset, database, or copied credential is committed.