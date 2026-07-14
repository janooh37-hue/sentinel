# OpenWA → WAHA gateway reconciliation — design

**Date:** 2026-07-14
**Status:** approved (brainstorming)
**Branch:** `feat/openwa-waha-reconcile`

## Problem

The WhatsApp channel (the "OpenWA" subsystem, merged Phase 1–2c, dormant behind
`GSSG_OPENWA_ENABLED=0`) **has never actually run**. Two blockers surfaced while
trying to activate it:

1. **The gateway image is fictional.** `deploy/openwa/docker-compose.yml`
   references `rmyndharis/openwa:latest`, which returns HTTP 404 on Docker Hub.
2. **The client's API contract is speculative.** `backend/app/services/openwa_client.py`
   was written against *expected*, never-verified REST shapes (paths like
   `/api/sessions/{session}/messages/send-text`). The README's "pin-the-contract"
   step admits this. No real gateway matches those paths.

The office box also has **no Docker Desktop**. The available container runtime is
**Podman 5.3.1 (rootless)** inside the pre-existing `podman-uosserver` WSL2 distro
(the `docker` command there is a podman shim; there is **no compose provider**).

## Decision

Use **WAHA** (`devlikeapro/waha`, Core edition, free/MIT — ~2.0M Docker Hub pulls)
as the real gateway, running under the existing Podman-in-WSL. Reconcile
`openwa_client.py` to WAHA's actual REST contract. Keep everything else — the
`GSSG_OPENWA_*` setting names, the `openwa_client` module name, the router /
dispatch architecture, and the DB schema — **unchanged** to minimize churn on
merged code. The channel stays gated by `GSSG_OPENWA_ENABLED=0` until the operator
scans the QR and flips it.

Delivery status: **poll per message** (chosen over WAHA webhooks and over
deferring acks). The existing 5-minute poller stays; `get_ack` derives the chatId
from the row's stored `phone`, so **no schema change** is needed.

## Non-goals

- Webhooks for delivery status (WAHA's recommended push model) — not this pass.
- Any DB migration — `OutboundMessage.phone` already carries what `get_ack` needs.
- Frontend / i18n changes — the client is transport code, not user-facing copy.
- Installing Docker Desktop — reuse the existing Podman runtime.
- Provisioning the real API key, scanning the QR, or flipping `ENABLED=1` — those
  are the operator's go-live steps.

## WAHA contract (pinned from official docs; re-verify against live Swagger first)

Config: default port **3000** (`WHATSAPP_API_PORT`); API key env **`WAHA_API_KEY`**
(plain) sent in header **`X-Api-Key`**; session bootstrap via
`WHATSAPP_START_SESSION=gssg` + `WHATSAPP_RESTART_ALL_SESSIONS=True`.

| Operation | WAHA endpoint | Request | Response |
|-----------|---------------|---------|----------|
| Send text | `POST /api/sendText` | `{session, chatId, text}` | message obj → `id` (`id._serialized` if nested) |
| Send file | `POST /api/sendFile` | `{session, chatId, file:{mimetype,filename,data(base64)}, caption}` | `id` |
| Check number | `GET /api/contacts/check-exists?phone=&session=` | — | `{numberExists, chatId}` |
| List groups | `GET /api/{session}/groups` | — | `[{id:{_serialized}|str, name}, …]` |
| Session health | `GET /api/sessions/{session}` | — | `{status: WORKING|SCAN_QR_CODE|STARTING|FAILED|STOPPED, me, …}` |
| Message ack | `GET /api/{session}/chats/{chatId}/messages/{messageId}` | — | `{ack: int, …}` |
| QR | `GET /api/{session}/auth/qr` | — | image / `{value}` (confirm) |
| Start session | `POST /api/sessions` | `{name, start}` | — |

chatId format: individual `<number>@c.us`, group `<id>@g.us`.

ack integers → `delivery_state`: `-1 → failed`, `0 → sent` (pending/clock),
`1 → sent` (server), `2 → delivered` (device), `3 → read`, `4 → read` (played).
(`_TERMINAL_DELIVERY` already covers the terminal states.)

## Components & changes

### 1. `deploy/openwa/` (runtime)
- **`docker-compose.yml`:** image → `devlikeapro/waha` (pin digest once verified);
  env `WAHA_API_KEY=${OPENWA_API_KEY}`, `WHATSAPP_START_SESSION=gssg`,
  `WHATSAPP_RESTART_ALL_SESSIONS=True`; port `127.0.0.1:2785:3000`; session volume.
  Kept for documentation / future compose use.
- **`run-waha.ps1` (new):** reads `deploy/openwa/.env`, runs `podman run` inside
  `podman-uosserver` with the same image/env/port/volume (the actual bring-up
  path, since the distro has no compose provider). Idempotent (rm + run, or
  `podman start` if it exists).
- **Boot persistence:** documented Windows Scheduled Task that runs
  `wsl -d podman-uosserver -- podman start waha` at logon, so the container is up
  whenever the always-on backend is.
- **`README.md`:** rewrite to WAHA reality — endpoints, port 2785→3000 mapping,
  session start (`POST /api/sessions`), QR at `/api/{session}/auth/qr`, ack model,
  and the two-`.env` / matching-key setup.

### 2. `backend/app/services/openwa_client.py` (contract fixes; public API preserved)
- `send_to_chat`, `send_file` (adds `mimetype: str = "application/pdf"` param),
  `is_registered`, `list_groups`, `fetch_qr` → repointed to the WAHA paths/payloads
  above; response id read as `id` or `id._serialized`.
- `get_ack(message_id, chat_id)` → new required `chat_id` arg; hits WAHA's
  chat-scoped path; maps ack int → state string.
- `notify_dispatch.py` call sites (2) pass `_chat_id(row.phone)`.
- Session name now travels in the JSON body (`session`) for send endpoints, not the
  URL, per WAHA.
- `session_state` / `health` already accept `WORKING`; leave as-is.

### 3. Tests (TDD)
- Rewrite `test_openwa_client.py` and the openwa parts of `test_notify_dispatch.py`
  (they assert the fictional paths) using the existing httpx `MockTransport`
  pattern. Add: ack-int→state mapping; `send_file` mimetype; `get_ack` chatId in
  the URL; `check-exists` query params.

## Data flow (unchanged)

`notify_dispatch` routes an event → `openwa_client.send()` (WhatsApp-first) →
on failure, SMS fallback. The 5-min `poll_delivery` scheduler re-checks
non-terminal WhatsApp rows via `get_ack(provider_msg_id, _chat_id(phone))`.
All of this stays dormant while `openwa_enabled` is False.

## Error handling (unchanged posture)

Transport errors → one retry, then a result dataclass (never a raw raise).
`list_groups` / `fetch_qr` / `session_state` swallow errors and return
empty/None/`unreachable`. WAHA non-2xx bodies map to `SendResult(ok=False)`;
422 / "not registered" bodies set `not_registered=True`.

## Testing strategy

- Unit: httpx `MockTransport` asserts each new URL + payload + response mapping.
- Gate: full `pytest` (filterwarnings=error), `mypy --strict`, `ruff`. Frontend
  unaffected (no `api.types.ts` / route changes).
- Manual pin-the-contract (first implementation task): start WAHA locally, read
  `http://localhost:2785/api/docs`, confirm exact paths/fields for the pinned tag,
  and correct the table above + the client if anything differs.

## Rollout

Branch `feat/openwa-waha-reconcile` → TDD → gates green → merge to `main` + push
(live checkout). The channel remains off (`ENABLED=0`) after merge. Operator
go-live: fill both `.env` keys (must match), `run-waha.ps1`, scan QR (session →
`WORKING`), flip `ENABLED=1`, `mng deploy`, send a test.
