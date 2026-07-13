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

**Phased.** Phase 1 is the OpenWA router + unified log + per-record auto-routing.
**Phase 2** (Broadcast & Digests) rides on that router: permission-gated **broadcast
messaging** to selectable audiences, and a **designation-routed annual-leave digest** to
duty-unit supervisors. Phase 2 is fully designed here but implemented after Phase 1.

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
- Phase 1 adds no new per-record notification *content* — WhatsApp reuses the existing
  bilingual SMS copy. (Phase 2 introduces new content: broadcasts + the leave digest.)
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
5. (Phase 2) Broadcast throttle rate + per-broadcast/day cap values — ban-safe constants.
6. (Phase 2) Digest schedule specifics: day/time of the monthly auto-run; whether it
   runs at month-start for that month's currently-approved annual leaves.

## Phase 2 — Broadcast & Digests

Phase 2 rides entirely on the Phase 1 router (`notify_dispatch`) and the unified
`outbound_messages` log: every message it sends is one more call through
WhatsApp-first / SMS-fallback, so it inherits delivery status, read receipts, and
fallback for free. Phase 1 must ship first (everything here depends on it).

### 2a. Duty-unit supervisor routing (designation-based)

Supervisors are **not pinned people** — they are resolved from a **designation**
(`duty_post` value) *within a duty unit* at send time, so moving staff around the roster
never breaks routing. This uses existing fields only (`Employee.duty_unit`,
`Employee.duty_post`, `contact`, `msg_language`); no role change, no per-person flag.

- **New table `duty_supervisors`:** rows of `(duty_unit, recipient_duty_post)`. A unit may
  have several rows (several recipients). Managed on the **existing Duty Locations page**
  (admin adds/removes designations per unit).
- **Resolution at send:** recipients for unit *U* = active employees where
  `duty_unit == U` AND `duty_post` ∈ the unit's configured designations AND `contact`
  normalizes to a valid mobile. Send to all matches.
- **Seed mapping (verified against live data 2026-07-13):**

  | Duty unit | `recipient_duty_post` |
  |---|---|
  | السرية الأولى … الخامسة | `مسؤول سرية` (exactly one per company) |
  | الدوام الرسمي (official duty) | `مدير فرع الخدمات العامة` (G4488) + `مدير مشروع` (G3007) |
  | دعم 1/2/3, منتهي الخدمات | (none — excluded) |

  Note: `position_ar = مشرف` is **not** used for routing — it covers only 2 of 5
  companies and includes a terminated employee; `duty_post = مسؤول سرية` is the reliable
  one-per-company signal.

### 2b. Annual-leave digest to supervisors

- **Content:** per duty unit, the list of that unit's employees on **annual leave
  overlapping the current month** (name + dates), rendered bilingually (recipient's
  `msg_language`), sent to the unit's resolved supervisor(s) via the router.
- **Triggers:** on-demand (send for one unit or all) **+** monthly auto (1st of month) on
  the existing scheduler.
- **Skips (each logged, never silent):** units with no configured supervisor, no
  qualifying leaves, or a supervisor with no valid mobile.
- **Extensibility:** built on a small digest-template layer (bilingual list rendering) so
  future digests ("returning to duty this week", "pending approvals") drop in without
  reworking routing.

### 2c. Broadcast messaging

- **Compose:** bilingual (Arabic + English boxes); each recipient gets their
  `msg_language`, falling back to the other box if one is empty. Optional **reusable
  template library** (saved bilingual canned messages).
- **Audience selectors (v1):** by **duty unit**, by **department**, by **role /
  employment status**, **everyone**, and **manual pick** (add/remove individuals).
  Terminated (منتهي الخدمات) excluded by default.
- **Send-safety (mandatory for OpenWA ban-avoidance):** a confirmation gate showing
  recipient count + channel split ("183 WhatsApp · 34 SMS · 5 no phone"); a **test-send
  to self**; **throttled pacing** (spaced sends) with a **per-broadcast/day cap**.
- **Logging:** a **new `broadcasts` parent row** + one `outbound_messages` child per
  recipient (channel-stamped, each with its own fallback + delivery status). Powers a live
  **delivery dashboard**: delivered / read / SMS-fallback / failed.
- **Permission:** new capability **`messages.broadcast`** (admin-grantable; single
  capability — any grantee may broadcast to any audience).

### Phase 2 components (delta on Phase 1)

| Component | Action | Purpose |
|---|---|---|
| `db/models.py` + migration | **new** `duty_supervisors` | `(duty_unit, recipient_duty_post)` rows; seeded with the verified mapping. |
| `db/models.py` + migration | **new** `broadcasts` | Broadcast parent (author, audience descriptor, AR/EN body, counts, created_at). Children are `outbound_messages` rows tagged with `broadcast_id`. |
| `outbound_messages` | **add** `broadcast_id` (nullable FK-omitted) | Ties per-recipient rows to their broadcast; NULL for per-record sends. |
| `core/permissions.py` | **add** `messages.broadcast` | Grantable capability; default off (admin/opt-in). |
| `services/duty_supervisor_service.py` | **new** | Resolve a unit's supervisor recipients (designation → current holders). |
| `services/digest_service.py` | **new** | Build + send the annual-leave digest per unit; the extensible digest layer. |
| `services/broadcast_service.py` | **new** | Audience resolution, throttled fan-out through `notify_dispatch`, broadcast logging. |
| `services/scheduler_service.py` | **extend** | Monthly digest run; broadcast pacing worker. |
| `api/v1/` (new routers) | **new** | Broadcast compose/send + dashboard; digest send/preview; duty-supervisor mapping CRUD. Gated `messages.broadcast` / `settings.edit`. |
| Duty Locations page | **extend** | Per-unit supervisor-designation editor. |
| Broadcast UI + digest UI | **new** | Compose + audience + preview + dashboard; digest trigger + preview. |
| locales `{en,ar}.json` | **extend** | All new copy, full AR/EN parity; run `i18n-rtl-reviewer` + `notification-template-reviewer`. |

### Phase 2 deferred (explicit non-goals for v1)

- Scheduled broadcasts (send-at-time) — later; adds scheduler machinery.
- Two-way inbound (employees replying) — out of scope; large subsystem.
- Smart audiences ("contracts expiring", "missing documents") — start with the selectors above.
- Real-time supervisor alert on each new annual leave — optional future toggle, not v1.
- Dept-scoped broadcast permission — v1 uses a single capability.

## Rollout

- **Phased:** Phase 1 (OpenWA router) first — everything depends on it; then 2a→2b→2c.
- `openwa_enabled=false` by default → dormant until the office provisions the QR-linked
  number (mirrors how SMS/WhatsApp shipped dormant).
- Ship behind config; enable after Docker + QR login verified on the office box.
- Deploy/push to `origin/main` (this checkout is live) once gates pass and merged.
