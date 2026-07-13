# OpenWA deploy guide

OpenWA provides the WhatsApp channel for GSSG Manager notifications. The container
runs on the `.\Admin` office box alongside the main service and exposes a local
REST API that the backend's `openwa_client.py` calls.

---

## Prerequisites

- **Docker Desktop** installed and running on the `.\Admin` office box.
- The office WhatsApp number available for a QR scan (a single session is enough;
  it stays connected as long as the container is up).

---

## Bring-up

1. Create `deploy/openwa/.env` (this file is `.gitignore`d — keep it off source control):

   ```
   OPENWA_API_KEY=<generate a strong random string, e.g. openssl rand -hex 32>
   ```

2. From the repo root, start the container:

   ```powershell
   docker compose -f deploy/openwa/docker-compose.yml --env-file deploy/openwa/.env up -d
   ```

   The container binds only to `127.0.0.1:2785` — it is not reachable from the LAN
   directly; the backend calls it over loopback.

---

## First-time QR login

1. Swagger UI is available at `http://localhost:2785/api/docs` once the container
   is up.

2. Start a session via the Swagger UI or:

   ```bash
   curl -X POST http://localhost:2785/api/sessions \
     -H "x-api-key: <OPENWA_API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"name": "gssg"}'
   ```

3. Fetch the QR code:

   ```bash
   curl http://localhost:2785/api/sessions/gssg/qr \
     -H "x-api-key: <OPENWA_API_KEY>"
   ```

   This returns a base64 QR image. Scan it with the office WhatsApp number.

4. Confirm the session is connected:

   ```bash
   curl http://localhost:2785/api/sessions/gssg \
     -H "x-api-key: <OPENWA_API_KEY>"
   ```

   The response should show `"status": "CONNECTED"` (exact field name may differ —
   see the **Pin-the-contract** step below).

---

## Pin-the-contract step (do this before go-live)

The client in `backend/app/services/openwa_client.py` was written against the
**expected** OpenWA REST API shapes. Verify each endpoint against the live Swagger
at `http://localhost:2785/api/docs` and correct the client if the real paths or
response shapes differ:

| Operation | Expected path | Expected payload/response |
|-----------|--------------|--------------------------|
| Send text | `POST /api/sessions/{session}/messages/send-text` | `{ "to": "<phone>", "text": "<body>" }` → `{ "id": "..." }` |
| Registration check | `GET /api/sessions/{session}/contacts/check?phone=<phone>` | `{ "numberExists": true/false }` |
| Delivery/ack lookup | `GET /api/sessions/{session}/messages/{id}` | `{ "ack": 3 }` (3 = read) |
| Session health | `GET /api/sessions/{session}` | `{ "status": "CONNECTED" }` |

Record the confirmed paths and shapes in this table and adjust
`openwa_client.py` accordingly before flipping the feature on.

---

## Backend wiring

Add these to the service environment (e.g. in `deploy/.env`):

```
GSSG_OPENWA_ENABLED=0          # keep 0 until verified; flip to 1 at go-live
GSSG_OPENWA_API_BASE=http://localhost:2785
GSSG_OPENWA_API_KEY=<same value as OPENWA_API_KEY in deploy/openwa/.env>
GSSG_OPENWA_SESSION=gssg       # must match the session name used at QR login
```

---

## Go-live checklist

- [ ] Provision env vars above in the service environment
- [ ] `docker compose -f deploy/openwa/docker-compose.yml --env-file deploy/openwa/.env up -d`
- [ ] Complete QR login (session shows CONNECTED)
- [ ] Pin-the-contract step done and `openwa_client.py` adjusted if needed
- [ ] Flip `GSSG_OPENWA_ENABLED=1`
- [ ] `scripts\mng.ps1 deploy`
- [ ] Send a test notification and confirm it arrives via WhatsApp

While `GSSG_OPENWA_ENABLED=0` the router sends via SMS only; WhatsApp is fully
dormant. Do not flip the flag until the session is confirmed connected and the
contract is verified.

---

## Migration / ops note

Rolling back Alembic migration `0051` on a live database will delete **all** rows
from `outbound_messages`, including any messages accumulated after the migration
ran. This is a known SQLite limitation documented in the 0051 migration docstring.
Treat migration 0051 as effectively one-way in production; do not roll it back
unless the database is otherwise being reset.

---

## "Session down" runbook

If the office WhatsApp number is logged out or temporarily banned:

1. Notifications automatically fall back to SMS — no manual intervention needed.
2. To restore WhatsApp delivery, re-scan the QR (see **First-time QR login**
   above). The session volume persists across container restarts; a re-scan is only
   needed after a ban or explicit logout.
3. If the container itself needs a full restart:

   ```powershell
   docker compose -f deploy/openwa/docker-compose.yml restart openwa
   ```
