# SMS Notification Channel (on-site Android SIM gateway) — Design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation plan
**Author:** session brainstorm

## Background & motivation

Employee notifications (leave approved, duty resumption, violation) already
ship via email and PWA web-push, and a WhatsApp channel was built but is
**permanently blocked**: Meta requires business/identity verification (video
selfie + WhatsApp Business Account onboarding) and the UAE SMS A2P route
requires TDRA sender-ID registration (trade license, Enterprise ID) — neither
of which is obtainable at the operator's authority level.

The one channel that is both **universal** (reaches every phone, no app, no
internet on the recipient side) and **paperwork-free** is **P2P SMS sent from
an ordinary SIM**. The organisation already operates a company Android phone
with a working SIM (currently used to send WhatsApp manually). That phone,
running an SMS-gateway app on the local network, becomes the transport.

## Goal

Add an **SMS notification channel** that an admin triggers manually per record,
sending the leave/duty/violation message as an SMS from the on-site Android
phone's SIM, with every attempt audited and surfaced as a status badge —
mirroring the existing WhatsApp UX.

## Non-goals

- No automatic/scheduled sending (manual per-record only, like WhatsApp).
- No automation of the WhatsApp consumer app (against ToS, risks the number).
- No bulk/marketing SMS (consumer-SIM fair-use; low volume only).
- No removal of the WhatsApp code in this work. WhatsApp stays in place and
  dormant; if SMS proves out, WhatsApp removal is a separate later task.
- No delivery-receipt polling in v1 (record the gateway's submission ack only;
  delivery polling can be added later).

## Decisions (settled during brainstorm)

- **Channel relationship:** add SMS as a parallel channel; leave WhatsApp
  untouched and dormant (Approach A — full isolation).
- **Gateway app:** SMS Gate (`sms-gate.app` / `capcom6/android-sms-gateway`) in
  **Local mode** — open source, exposes a password-protected HTTP API on the
  phone over the LAN. Nothing leaves the local network.
- **Message text:** SMS has no pre-registered template, so we render the full
  text (body + signature) ourselves, reusing the exact six WhatsApp bodies.
- **Shared helpers:** extract formatting helpers + event constants into a new
  `notify_format.py`, imported by both `whatsapp_templates.py` (one pure,
  test-guarded refactor) and the new `sms_templates.py`.
- **PII:** do not store the rendered message body in the audit table; store
  status, phone, gateway message id, and error only.

## SMS Gate local API contract

```
POST http://<phone-ip>:8080/message        (HTTP Basic auth)
Content-Type: application/json
body: {"textMessage": {"text": "<message>"}, "phoneNumbers": ["+9715XXXXXXXX"]}
→ 2xx: {"id": "<gateway-message-id>", "state": "Pending", ...}
GET  http://<phone-ip>:8080/message/{id}    → state: Pending|Sent|Delivered|Failed
```

The phone must have a **stable LAN IP** (router DHCP reservation or static IP)
so `GSSG_SMS_GATEWAY_URL` does not drift.

## Architecture

A self-contained SMS channel mirroring the WhatsApp pipeline. New modules:

| Module | Responsibility | Depends on |
|---|---|---|
| `services/sms_client.py` | The only gateway-specific module. `send(phone, text) -> SendResult`. POSTs to SMS Gate local API, Basic auth, 10s timeout, one retry on transport error, maps non-2xx to an error result. | httpx, config |
| `services/sms_templates.py` | `render_text(event_type, language, record, employee) -> str` — full message text incl. signature, per event × language. | notify_format |
| `services/notify_format.py` | Shared pure helpers: `employee_name`, `fmt_date`, `weekday`, `type_label`, `action_text`, `ENGLISH_WEEKDAYS`, and `EVENT_*` constants. | constants, models |
| `services/sms_service.py` | `send_for_event(db, event_type, record_id, sent_by)` and `last_status(...)`: resolve record → normalize phone → render → send → log. Raises `SmsDisabledError`, `RecordNotFoundError`. | client, templates, notify_format, phone, model |
| `api/v1/sms.py` | `POST /sms/send`, `GET /sms/status`; both require `employees.notify`. | sms_service, schemas |
| `schemas/sms.py` | `SmsSendRequest`, `SmsSendResponse`, `SmsStatusItem`, `SmsStatusResponse`. | — |
| `db/models.py` :: `SmsMessage` | Audit row. | — |
| migration `0044_sms_messages` | Create `sms_messages` table. | 0043 |
| frontend `SendSmsButton` + api client | Manual-send button + status badge on leave/duty/violation records. | — |

Reused as-is: `core/phone.py` (E.164 normalization), `employees.notify`
capability, the per-record manual-send + status-badge UX, the `_LOADERS`
record-resolution pattern (re-expressed against shared event constants).

`whatsapp_templates.py` changes only by importing the extracted helpers/constants
from `notify_format.py` — no behavioral change; the existing 39 WhatsApp tests
guard it.

## Data model — `sms_messages`

Columns (mirrors `whatsapp_messages` minus the template field; no body stored):

- `id` PK
- `employee_id` FK → employees
- `event_type` (`leave_approved` | `duty_resumption` | `violation`)
- `event_ref` (`"{event_type}:{record_id}"`)
- `language` (`ar` | `en`)
- `phone` (E.164 string, may be empty when normalization failed)
- `status` (`sent` | `failed`)
- `provider_msg_id` (gateway message id, nullable)
- `error` (nullable text)
- `sent_by` FK → users (nullable)
- `created_at` (server default now)

## Data flow

1. Admin opens a leave/duty/violation record, clicks **Send SMS**.
2. `POST /sms/send {event_type, record_id}` (auth: `employees.notify`).
3. `sms_service.send_for_event`:
   - If `not cfg.sms_enabled` → raise `SmsDisabledError` → `409`.
   - Load record via the event loader; missing → `RecordNotFoundError` → `404`.
   - Resolve employee; pick `lang = employee.msg_language or "ar"`.
   - `phone = normalize_phone(employee.contact, default_cc=cfg.sms_country_code)`.
   - `text = sms_templates.render_text(event_type, lang, record, employee)`.
   - If `phone is None` → log `failed` row ("No valid phone number"), return.
   - `result = sms_client.send(phone, text)`; log `sent`/`failed` row with id/error.
4. `GET /sms/status?event_type=&record_id=` → `{enabled, last}` for the badge.
5. Re-sends write a new row; the badge reflects the latest attempt.

## Configuration (`GSSG_SMS_*` env vars)

- `GSSG_SMS_ENABLED` (bool, default `false`) — master switch; button hidden and
  sends blocked until `true`.
- `GSSG_SMS_GATEWAY_URL` (e.g. `http://192.168.1.50:8080`) — tolerates a missing
  scheme and a trailing slash.
- `GSSG_SMS_USERNAME`, `GSSG_SMS_PASSWORD` — SMS Gate local-server Basic auth.
- `GSSG_SMS_COUNTRY_CODE` (default `971`) — phone normalization default.

## Message text (reuse WhatsApp bodies verbatim)

`leave_approved` / en:
```
Dear {name},
Your {type} leave has been approved.
Start: {start} ({start_weekday})
End: {end} ({end_weekday})
Duration: {days} day(s).
Al Wathba Rehabilitation Centre
```
`leave_approved` / ar:
```
عزيزي {name}،
تمت الموافقة على إجازتك ({type}).
تاريخ البداية: {start} ({start_weekday})
تاريخ النهاية: {end} ({end_weekday})
المدة: {days} يوم.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
`duty_resumption` / en:
```
Dear {name},
Your return to duty on {date} ({weekday}) has been recorded.
Welcome back.
Al Wathba Rehabilitation Centre
```
`duty_resumption` / ar:
```
عزيزي {name}،
تم تسجيل مباشرتك للعمل بتاريخ {date} ({weekday}).
أهلاً بعودتك.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
`violation` / en:
```
Dear {name},
A {type} has been recorded on {date} ({weekday}).
Action: {action}.
Please contact HR for any clarification.
Al Wathba Rehabilitation Centre
```
`violation` / ar:
```
عزيزي {name}،
تم تسجيل {type} بتاريخ {date} ({weekday}).
الإجراء: {action}.
يرجى مراجعة الموارد البشرية لأي استفسار.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Date format `dd/mm/yyyy`; weekday from `notify_format.weekday` (Monday-first,
matching `datetime.weekday()` and `ARABIC_WEEKDAYS`). Arabic encodes as UCS-2
(~70 chars/segment) → ~3–4 segments per message; acceptable at this volume.

## Error handling

- Channel disabled → `409` (UI hides the button so this is a safety net).
- Unparseable/empty phone → `failed` row, no send, reason "No valid phone number".
- Gateway timeout / transport error → one retry, then `failed` row with the error.
- Auth failure / non-2xx → `failed` row storing `HTTP <code>: <gateway message>`.
- Unknown `event_type` / missing record → `RecordNotFoundError` → `404`.

## Testing (TDD)

- `sms_client` (httpx `MockTransport`): 2xx → `ok` + message id; non-2xx →
  `error` with status+text; transport error → retried once then error.
- `sms_templates`: each event × {ar, en} renders the expected full string
  (correct name, `dd/mm/yyyy` date, correct weekday, signature present, action
  fallback for empty `action_taken` with deduction days).
- `notify_format`: helper unit tests (weekday tables, date format, type-label
  split on `" - "`, action-text fallback).
- `sms_service` (monkeypatched client): disabled raises; no-phone → `failed`
  row; success → `sent` row with id; re-send writes a new row; `last_status`
  returns the latest.
- `api/v1/sms`: send + status happy paths; permission gate (403 without
  `employees.notify`); disabled → `409`; missing record → `404`.
- `whatsapp_templates`: existing suite must stay green after the
  `notify_format` extraction (regression guard).

## Frontend

- `SendSmsButton` component mirroring `SendWhatsAppButton`: shows `Send SMS`,
  posts to `/sms/send`, then refreshes `/sms/status`; renders
  `Sent ✓ <date>` / `Failed – <reason>`. Hidden when `enabled` is false.
- API client methods `sendSms` / `getSmsStatus`.
- Wired into the same record detail surfaces as the WhatsApp button
  (leave approval, duty resumption, violation).

## Gateway provisioning — `deploy/SMS-SETUP.md`

1. Install **SMS Gate** on the company Android phone.
2. Enable **Local Server**; set a username + password.
3. Give the phone a **static LAN IP** (or DHCP reservation on the router).
4. Grant the **SMS send** permission; disable **battery optimization** for the
   app so it stays alive.
5. Ensure the SIM has SMS balance/allowance.
6. Set the `GSSG_SMS_*` env vars in `C:\Users\Admin\sentinel\.env`; `mng restart`.
7. `configure-sms.ps1` helper: validate gateway reachability + Basic auth, then
   upsert `.env` (mirrors `configure-whatsapp.ps1`; `-Enable` flips ENABLED).

## Operational notes

- The sender appears as the **SIM's phone number** (no branded sender) — fine
  for internal staff notifications.
- Keep the phone powered, on the office Wi-Fi, and the app exempt from battery
  optimization.
- Consumer-SIM fair-use applies; this is for low-volume manual notifications,
  not bulk sending.

## Future (out of scope now)

- Delivery-receipt polling via `GET /message/{id}` to upgrade `sent` → `delivered`.
- Retiring the WhatsApp channel once SMS is validated in production.
