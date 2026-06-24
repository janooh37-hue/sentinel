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
