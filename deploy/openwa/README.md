# WAHA deploy guide

WAHA (`devlikeapro/waha`) provides the WhatsApp channel for GSSG Manager
notifications. The container runs under rootless Podman in the
`podman-uosserver` WSL2 distro on the `.\Admin` office box and exposes a
local REST API that the backend's `openwa_client.py` calls.

---

## Prerequisites

- **WSL2 distro `podman-uosserver`** with rootless Podman installed.
- The `docker.io/devlikeapro/waha:latest` image already pulled in that distro.
- The office WhatsApp number available for a QR scan.

---

## Two .env files — matching key

Two gitignored `.env` files must contain the **same** API key:

| File | Variable | Used by |
|------|----------|---------|
| `deploy/openwa/.env` | `OPENWA_API_KEY=<key>` | `run-waha.ps1` → container |
| repo-root `.env` | `GSSG_OPENWA_API_KEY=<key>` | Backend service (`openwa_client.py`) |

Generate a strong key once (`openssl rand -hex 32`) and set it in both files.
Also set `GSSG_OPENWA_API_BASE=http://localhost:2785` and
`GSSG_OPENWA_SESSION=gssg` in the repo-root `.env`.

---

## Bring-up

Run the PowerShell script from the repo root (or any directory — it uses
`$PSScriptRoot` to locate `.env`):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\openwa\run-waha.ps1
```

The script reads `deploy/openwa/.env`, removes any stale `waha` container,
and starts a fresh one. It is idempotent — safe to run again after a reboot.

The container binds only to `127.0.0.1:2785` (loopback only, never reachable
from the LAN directly); the backend calls it over loopback.

> **Note:** `docker compose` is kept as documentation/future reference but is
> NOT the primary bring-up path here — the `podman-uosserver` distro has no
> compose provider. Use `run-waha.ps1` instead.

---

## Boot persistence (Scheduled Task)

To restart WAHA automatically after the office box reboots, create a Windows
Scheduled Task that runs at logon:

```
Action: wsl.exe -d podman-uosserver -- podman start waha
Trigger: At log on (of .\Admin)
Run as: .\Admin
```

The container's `--restart unless-stopped` policy also restarts it inside the
distro if the process crashes.

---

## First-time QR login

1. Confirm WAHA is up — Swagger UI:  `http://localhost:2785/api/docs`

2. Start the `gssg` session:

   ```bash
   curl -X POST http://localhost:2785/api/sessions \
     -H "X-Api-Key: <OPENWA_API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name": "gssg", "start": true}'
   ```

   Status flows: `STARTING` → `SCAN_QR_CODE` → `WORKING`.

3. Fetch the QR code (returns a PNG image):

   ```bash
   curl http://localhost:2785/api/gssg/auth/qr \
     -H "X-Api-Key: <OPENWA_API_KEY>" \
     --output qr.png
   ```

   Open `qr.png` and scan it with the office WhatsApp number.
   The in-app QR dialog (Settings → WhatsApp) can also display this code once
   `GSSG_OPENWA_ENABLED=1` and the session is live.

4. Confirm the session is connected:

   ```bash
   curl http://localhost:2785/api/sessions/gssg \
     -H "X-Api-Key: <OPENWA_API_KEY>"
   ```

   Look for `"status": "WORKING"`.

---

## Pin the image digest before production

`docker.io/devlikeapro/waha:latest` is a floating tag. Before going to
production, pin it to a specific digest to prevent unexpected updates:

```powershell
# Find the digest of the currently-pulled image
wsl.exe -d podman-uosserver -- podman inspect docker.io/devlikeapro/waha:latest --format '{{.Digest}}'
```

Copy the `sha256:...` digest and replace `:latest` in `docker-compose.yml`
and in `run-waha.ps1`:

```
docker.io/devlikeapro/waha@sha256:<digest>
```

---

## Backend wiring

Add these to the service environment (repo-root `.env`):

```
GSSG_OPENWA_ENABLED=0          # keep 0 until verified; flip to 1 at go-live
GSSG_OPENWA_API_BASE=http://localhost:2785
GSSG_OPENWA_API_KEY=<same value as OPENWA_API_KEY in deploy/openwa/.env>
GSSG_OPENWA_SESSION=gssg       # must match the session name used at QR login
```

---

## Go-live checklist

- [ ] Fill `deploy/openwa/.env` with `OPENWA_API_KEY=<key>`
- [ ] Fill repo-root `.env` with matching `GSSG_OPENWA_API_KEY=<key>` + `GSSG_OPENWA_API_BASE` + `GSSG_OPENWA_SESSION`
- [ ] `powershell -ExecutionPolicy Bypass -File deploy\openwa\run-waha.ps1`
- [ ] Create the Scheduled Task for boot persistence (see above)
- [ ] Complete QR login — confirm session shows `"status": "WORKING"`
- [ ] Pin image digest in `docker-compose.yml` and `run-waha.ps1`
- [ ] Flip `GSSG_OPENWA_ENABLED=1` in repo-root `.env`
- [ ] `scripts\mng.ps1 deploy`
- [ ] Send a test notification and confirm it arrives via WhatsApp

While `GSSG_OPENWA_ENABLED=0` the router sends via SMS only; WhatsApp is
fully dormant. Do not flip the flag until the session is confirmed `WORKING`.

---

## "Session down" runbook

If the office WhatsApp number is logged out or temporarily banned:

1. Notifications automatically fall back to SMS — no manual intervention needed.
2. To restore WhatsApp delivery, re-scan the QR (see **First-time QR login**
   above). The session volume persists across container restarts; a re-scan is
   only needed after a ban or explicit logout.
3. To restart the container:

   ```powershell
   wsl.exe -d podman-uosserver -- podman restart waha
   ```

---

## Migration / ops note

Rolling back Alembic migration `0051` on a live database will delete **all**
rows from `outbound_messages`, including any messages accumulated after the
migration ran. This is a known SQLite limitation documented in the 0051
migration docstring. Treat migration 0051 as effectively one-way in production;
do not roll it back unless the database is otherwise being reset.
