# OpenWA WhatsApp channel with SMS fallback — design

**Date:** 2026-07-13
**Status:** Approved (brainstorm) — pending spec review
**Author:** Claude + user

## Summary

Replace the Infobip WhatsApp path with a **self-hosted OpenWA gateway** and add a
**dispatch router** that sends every HR notification over WhatsApp when possible and
falls back to SMS only as a genuine last resort. WhatsApp becomes the primary channel
(free-form text, no per-message fees, no template approvals); the on-site Android SMS
gateway becomes the safety net for numbers that aren't on WhatsApp or when WhatsApp is
unrecoverable.

A single unified `outbound_messages` table replaces the split
`whatsapp_messages` / `sms_messages` logging, so each record shows **one** delivery
badge (e.g. "Delivered · WhatsApp" / "Sent · SMS"). Legacy rows are backfilled into it
so history is preserved as if the unified system existed from the start.

## Decisions (from brainstorming)

1. **OpenWA replaces Infobip entirely** — OpenWA is the sole WhatsApp channel. The
   Infobip transport, templates, service, router and API are retired.
2. **Auto WhatsApp-first, SMS fallback** — the system decides the channel; admins do
   not pick per send.
3. **Unified log + one badge** — new `outbound_messages` table with a `channel` column;
   one badge per record.
4. **Single "Send" button** — the manual action auto-routes (same logic as auto-send),
   wired into BOTH detail surfaces (desktop inline + mobile modal).
5. **OpenWA hosted in Docker on the office `.\Admin` box**; backend reaches it over
   `localhost`.
6. **WhatsApp hardened to stay up; SMS is the true last resort.** SMS fires only when a
   number is not on WhatsApp, or WhatsApp is confirmed unrecoverable after a bounded
   retry window.
7. **Retry window ≈ 5 minutes** before last-resort SMS fires for a transient WhatsApp
   outage.
8. **Backfill legacy `sms_messages` + `whatsapp_messages`** into `outbound_messages`.
9. **Light health signal** — a Settings status line + a one-time admin alert when the
   WhatsApp session goes down (not per message).

## Non-goals

- No admin per-send channel override menu (auto-routing only).
- No per-employee channel preference.
- No new notification *content* — WhatsApp reuses the existing bilingual SMS copy.
- Not deleting the legacy tables (kept intact underneath the backfill).

## Architecture

### The router (core)

```
event  (auto-send hook  OR  manual "Send" button)
        │
        ▼
notify_dispatch.send(db, event_type, record_id, sent_by)      ← NEW router
   1. resolve record → employee → phone → bilingual text
        (reuses existing loaders + sms_templates.render_text)
   2. channel decision:
        ├─ number not on WhatsApp ─────────────► SMS immediately  (fell_back, reason=not_on_whatsapp)
        ├─ WhatsApp healthy + registered ──────► OpenWA send
        └─ WhatsApp transiently down ──────────► queue for retry (up to ~5 min);
                                                  on expiry → SMS  (fell_back, reason=whatsapp_unrecoverable)
   3. write ONE row to `outbound_messages` (channel, status, fell_back, reason, provider_msg_id, body, …)
```

**Why a router over baking the logic into each service:** transport clients stay dumb
("send this text to this number, tell me if it worked"); the *policy* (WhatsApp-first,
when to fall back, retry window) lives in one testable place. The clients never know
about each other.

**Text reuse:** `sms_templates.render_text(event_type, lang, record, employee)` already
produces free-form bilingual text. OpenWA sends free-form too, so **both channels share
the same rendered message**. The Infobip approved-template machinery is retired.

### Failure taxonomy (the heart of the fallback)

The router distinguishes two failure kinds because they deserve opposite responses:

| Kind | Signal | Response |
|---|---|---|
| **A. Not on WhatsApp** | pre-check says unregistered, or send rejects "not a WA user" | SMS **immediately** — won't change in minutes |
| **B. WhatsApp struggling** | session dropped, transient send/HTTP error, container restarting | **Keep trying WhatsApp** — queue + retry over ~5 min; SMS only if still down at expiry |

Registration is checked **pre-send when OpenWA exposes it**, with **attempt-and-catch**
as the safety net (a rejected send is treated as kind A or B by its error). *(To verify
in planning: OpenWA's actual "is-registered" REST endpoint and its "not a WA user"
error shape.)*

### Robustness (make kind B rare)

Three layers so WhatsApp stays up and SMS rarely fires:

1. **Session survival (OpenWA/Docker):** persist the WhatsApp session in a Docker named
   volume so restarts/updates do **not** require re-scanning the QR;
   `restart: unless-stopped` for self-healing after crashes/reboots.
2. **Auto-reconnect + retry (client + router):** `openwa_client` retries transient
   errors with backoff; on a kind-B failure the router marks the row **`queued`** (not
   `failed`) and a retry worker on the existing scheduler re-attempts, giving a dropped
   session time to auto-reconnect.
3. **Last-resort SMS + health signal:** only when the ~5-min window expires with
   WhatsApp still down does the message go SMS (`fell_back=true,
   reason=whatsapp_unrecoverable`). A Settings status line shows
   "WhatsApp: connected ✓ / session down — re-scan QR", and one in-app admin alert
   fires the first time the session flips to down (not per message). The scheduler pings
   OpenWA's health endpoint periodically so "down" is visible even during quiet periods.

## Components

| Component | Action | Purpose |
|---|---|---|
| `services/openwa_client.py` | **new** | Thin transport to OpenWA's REST API. Mirrors `sms_client.py`: `send(phone, text) -> SendResult`, `is_registered(phone) -> bool \| None`, `get_ack(msg_id) -> DeliveryResult`, `health() -> bool`. Only module that knows OpenWA's HTTP shape. One retry on transport error. |
| `services/notify_dispatch.py` | **new** | The router. Absorbs resolve→render→log (today split across `sms_service`/`whatsapp_service`) and adds the channel decision + retry queueing. Auto-send hooks + the manual endpoint both call this. |
| `db/models.py` `OutboundMessage` | **new table** `outbound_messages` | Unified log. Columns: `id`, `employee_id`, `event_type`, `event_ref`, `language`, `phone`, `channel` (`whatsapp`\|`sms`), `status` (`queued`\|`sent`\|`failed`), `delivery_state`, `delivery_checked_at`, `fell_back` (bool), `fallback_reason`, `attempts`, `next_retry_at`, `provider_msg_id`, `error`, `body`, `sent_by`, `created_at`. |
| migration `NNNN_outbound_messages` | **new** | Create `outbound_messages`; **backfill** existing `sms_messages` + `whatsapp_messages` (channel-stamped, mapping their status/delivery fields). SQLite: additive, no destructive alters. |
| `services/scheduler_service.py` | **extend** | (a) retry worker for `queued` WhatsApp rows within the window; (b) unified delivery poller — per row `channel`, call `sms_client.get_delivery` or `openwa_client.get_ack`; (c) periodic OpenWA health ping. |
| `whatsapp_client.py`, `whatsapp_templates.py`, `whatsapp_service.py`, `api/v1/whatsapp.py`, `schemas/whatsapp.py` | **retire** | Infobip path removed. `whatsapp_messages` table kept read-only (data backfilled). |
| `sms_client.py`, `sms_templates.py` | **keep** | `sms_client` = SMS transport (unchanged). `sms_templates` = shared text (now feeds both channels). `sms_service` logic folds into `notify_dispatch`. |
| `config.py` | **new settings** | `openwa_enabled`, `openwa_api_base` (e.g. `http://localhost:2785`), `openwa_api_key`, `openwa_session`, `openwa_country_code`. Retire `whatsapp_*` (Infobip). Keep `sms_*`. Retry window ≈ 5 min as a constant (not a setting). |
| `api/v1/` send endpoint | **rework** | One "send for event" endpoint calling `notify_dispatch`; one delivery re-check endpoint reading `outbound_messages`. `books.manage`-gated as today. |
| frontend `SendSmsButton.tsx` → `SendButton.tsx` | **rework** | Single "Send" button; badge shows unified status incl. channel. Wired into desktop inline (report/RecordExpansion) **and** mobile modal (TabRecords). |
| `frontend/src/locales/{en,ar}.json` | **extend** | New/renamed keys ("Send", "Delivered · WhatsApp", "Sent · SMS", "WhatsApp session down", fallback reasons). Full AR/EN parity. |
| `deploy/` OpenWA guide + compose | **new** | Docker Desktop setup, `docker-compose`, first-time QR login with the office WhatsApp number, API-key config, localhost wiring, session-volume persistence, restart policy. Mirrors existing WhatsApp/SMS helper scripts. |

## Data flow

- **Auto-send** (`auto_send_leave_status`, `auto_send_for_book` equivalents) → call
  `notify_dispatch.send()` instead of `sms_service`. Gated by `sms/openwa enabled` +
  the existing `*_autosend_enabled` setting.
- **Manual send** → same `notify_dispatch.send()` via the reworked endpoint/button.
- **Retry** → scheduler picks `queued` rows where `next_retry_at <= now` and
  `created_at` within the window; re-attempts WhatsApp; on window expiry routes to SMS.
- **Delivery status** → scheduler polls non-terminal rows; per `channel` calls the right
  client; unified badge reflects `delivery_state`.
- **Health** → scheduler pings OpenWA `health()`; on down→up/up→down transition, updates
  the Settings status and (on first down) fires one admin in-app alert.

## Error handling

- Transport clients never raise to callers — errors map to `SendResult`/`DeliveryResult`
  (existing pattern).
- Every attempt writes/updates an `outbound_messages` row; re-sends are first-class.
- No valid phone → `failed` row with a clear error (existing behavior, preserved).
- WhatsApp down at send time → `queued`, not `failed` (so the retry worker owns it).
- SMS last-resort failure → `failed` with the SMS error, `fell_back=true`.

## Testing

- **Router unit tests:** kind-A → SMS immediately; kind-B → queued then retried;
  window-expiry → SMS; registered+healthy → WhatsApp; no-phone → failed. Clients mocked.
- **openwa_client:** `httpx.MockTransport` for send / is_registered / get_ack / health,
  incl. transport-error retry (mirrors `sms_client` tests).
- **Migration + backfill:** legacy rows land in `outbound_messages` channel-stamped with
  correct status/delivery mapping; counts match.
- **Scheduler:** retry worker respects window + `next_retry_at`; unified poller routes by
  channel; health transitions fire exactly one alert.
- **Frontend:** `SendButton` renders unified badge per channel/status; wired into both
  surfaces; AR/EN parity (run `i18n-rtl-reviewer` + `notification-template-reviewer`).
- Strict gates: mypy strict, ruff, `pytest -W error`, vitest, tsc.

## Open items to verify during planning

1. OpenWA REST specifics: send-text endpoint, is-registered endpoint (or how to derive
   registration from a send error), delivery/ack read, health endpoint, auth header shape.
2. Exact retry cadence inside the 5-min window (e.g. 30s backoff) — a constant.
3. Backfill status-field mapping from each legacy table to the unified schema.
4. Whether to keep `sms_service.py` as a thin shim during transition or fold it wholesale.

## Rollout

- `openwa_enabled=false` by default → dormant until the office provisions the QR-linked
  number (mirrors how SMS/WhatsApp shipped dormant).
- Ship behind config; enable after Docker + QR login verified on the office box.
- Deploy/push to `origin/main` (this checkout is live) once gates pass and merged.
