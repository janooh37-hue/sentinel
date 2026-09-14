# GSSG Manager

A local/LAN web application for HR document generation, approvals, leave tracking,
and correspondence — **FastAPI** (Python) backend + **React** (TypeScript/Vite)
frontend, served same-origin.

This is the **live (production) build** of the app — the clean, deployable
application only. It is pulled to the office server.

## Features

- Document generation from tokenized Word templates (per-form workflows)
- Approvals with reviewer chains and manager routing
- Per-user email mailboxes (IMAP/SMTP) with a private inbox + admin "All mail" view
- Leave tracking and lifecycle management
- Instant in-app notifications (SSE) + installable PWA with Web Push
- Shared vehicle-photo library with reusable named images and lightweight WebP previews
- Runs as an always-on Windows service on the office LAN

## Requirements

- Python 3.12
- Node.js + pnpm
- (Windows) for the always-on service: NSSM (see `deploy/`)

## Run (development)

```bash
# Backend deps
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt

# DB migrations
venv/Scripts/python -m alembic upgrade head

# Frontend
pnpm -C frontend install
pnpm -C frontend run build      # builds into the backend's static dir

# Serve (headless, binds the LAN)
venv/Scripts/python backend/serve.py
```

Then open `http://<server>/` from any device on the network.

## Vehicle photo library

Choose an existing main photo from **Add vehicle**, **Edit vehicle**, or the
vehicle details page. Uploading a named PNG, JPEG, or WebP adds it to the shared
library; saving a selection changes only that vehicle. Gallery promotion copies
the image into the library without changing the vehicle's original attachment.

New uploads produce 160 px thumbnails, 640 px previews, and a full-resolution
WebP. Full images preserve normalized source pixels; smaller metadata-free WebP
sources are retained without another lossy conversion. Originals remain under
the data directory for recovery. Licences, accident evidence, receipts, and
gallery originals are not compressed by this feature.

### Existing installation cutover

1. During a maintenance window, stop the backend and back up the database and
   its complete data directory before upgrading. Install the aligned dependency
   requirements, including `Pillow>=12.2.0,<13.0`.
2. Apply Alembic migrations. Revision `0087_vehicle_photo_library` preserves
   existing main-photo assignments in the independent library.
3. Preview conversion using the **actual installation data directory**, not a
   copied database paired with another installation's files:

   ```powershell
   venv\Scripts\python.exe backend\scripts\convert_vehicle_photos.py --database "<data-dir>\gssg.db" --data-dir "<data-dir>" --seed-starters
   ```

4. Inspect the JSON report, then repeat with `--apply`. Apply creates a SQLite
   backup before writes. `--report "<report-path>.json"` saves the report.
   Repeating the command reuses exact pixel-identical assets rather than adding
   duplicates. Missing or invalid source files are reported, never silently
   reassigned or deleted.
5. Restart the backend and verify the fleet photos. Keep the pre-upgrade backup
   and original files until the installation is accepted.

`--seed-starters` adds the five supplied Hiace, Hilux, Coaster, Everest, and
Fortuner composites. It does not replace existing vehicle selections or guess
which model should use which photo. Choose the desired library entry explicitly.
Omit that flag to convert existing main photos without adding starter entries.
The command is dry-run by default and never runs automatically at startup.

Rollback requires the matching database **and files**. A downgrade preserves
cleared selections and materializes independent vehicle-owned files for changed
shared selections; it refuses unsafe or missing recovery sources rather than
creating broken references. Review the downgrade error before retrying.

## Deploy (LAN service + HTTPS + backups)

See **`deploy/`** for the reverse-proxy (Caddy) config and runbooks, and the
PowerShell installers under `scripts/`:

- `scripts/install-service.ps1` — register the always-on Windows service
- `scripts/firewall-lan.ps1` — open the LAN port
- `scripts/install-backup-task.ps1` — schedule nightly backups
- `scripts/secure_key_acls.ps1` — lock down credential key files

HTTPS (required for PWA install + Web Push) is configured via `deploy/Caddyfile`;
set `GSSG_SECURE_COOKIES=1` once TLS is terminated.

## License

See [LICENSE](LICENSE).
