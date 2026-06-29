# Employee WhatsApp Notifications — Design

**Date:** 2026-06-29
**Status:** Approved (design); pending implementation plan
**Author:** brainstormed with the operator

## 1. Summary

Let an admin notify an employee, on their phone, when a key HR event is recorded
about them — via **WhatsApp Business (Cloud API)**. The message is **text-only**,
**bilingual** (Arabic by default, English for the few non-Arabic speakers), and
**manually triggered** by a "Send to employee" button on each record (never
auto-fired).

Three event types are covered:

1. **Leave approved** — any leave type (Annual, Sick, National Service, …).
2. **Duty resumption** — a return-to-duty form is filed.
3. **Violation / warning** — a disciplinary record is issued.

Each message states the relevant details the operator asked for — for leaves:
the start date, end date, **day of the week** for each, the leave type and the
duration.

## 2. Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| **Channel** | WhatsApp Business Cloud API (Meta direct) | Cheapest for this in the UAE (utility templates beat UAE A2P SMS), most reliable (near-universal WhatsApp + delivery receipts), native Arabic, free API. BSP swap possible later behind the client. |
| **Egress** | Server has outbound HTTPS | Confirmed; same box already syncs IMAP. |
| **Phone storage** | Reuse existing `employees.contact`, normalize to E.164 at send time | No migration/backfill; assume `+971` default; skip + report when unparseable. |
| **Language selection** | Explicit per-employee preference, default Arabic | Most reliable; only the English exceptions need setting. |
| **Trigger scope** | Leave approval (all types) + duty resumption + violation/warning | One dispatcher, per-event template registry. |
| **Send model** | Manual "Send to employee" button | Safest for sensitive items (violations); admin reviews before sending; no auto-fire on half-drafted records. |
| **Attachment** | Text-only | Simplest to approve/build; least privacy exposure. Designed so PDF attachments can be added later without rework. |
| **Provider** | Meta Cloud API directly | Free API, pay per message, single HTTPS endpoint. |

## 3. Architecture

A single WhatsApp notification subsystem with a pluggable, per-event template
registry. No auto-triggers anywhere; every send is an explicit admin action.

```
Admin clicks "Send to employee" on a record
        │
        ▼
POST /api/v1/whatsapp/send   { event_type, record_id }
        │
        ▼
whatsapp_service.send_for_event(db, event_type, record_id, sent_by)
   1. Load the record (leave / return / violation) + its employee
   2. Resolve phone   → normalize contact → E.164 (+971 default)   ─┐ fail-fast,
   3. Resolve language → employee.msg_language (default 'ar')       │ structured
   4. Build params    → event-specific template variables           │ errors
   5. Pick template   → (event_type, language) → approved template ─┘
   6. POST to WhatsApp Cloud API  (httpx, short timeout, 1 retry)
   7. Record outcome in whatsapp_messages log
        │
        ▼
Returns { status: sent|failed, error?, message_id? }
        →  toast + record shows "Sent ✓ <date>"
```

### Modules

- **`whatsapp_client.py`** — thin transport. One `send_text(phone, template_name,
  lang, params)` that POSTs to the Meta Cloud API. The only module that knows the
  HTTP shape. Config (token, phone-number-id, base URL) from env/Settings. One
  retry on network/timeout. Maps API error responses to structured errors.
- **`whatsapp_service.py`** — the brain. Event → record loading, phone/language
  resolution, param building, template selection, logging. Unit-testable with the
  client mocked.
- **`whatsapp_templates.py`** — the registry. Maps `(event_type, language)` →
  template name + a function turning a record into ordered params. Holds the
  EN↔AR label maps (leave types, violation types), Arabic weekday names, the
  shared signature constant, and the name-language pick. Adding an event type =
  one entry here.
- **API** — `POST /whatsapp/send` (send), plus a per-record/per-employee status
  read (`GET /whatsapp/messages?employee_id=` or per `event_ref`) that powers the
  "Sent ✓" badge.

The provider is isolated behind `whatsapp_client.py`; switching to a BSP
(360dialog / Twilio-for-WhatsApp) is a drop-in replacement of that module.

## 4. Data model

Two additive migrations. Nothing destructive; no backfill (phone stays in
`contact`, normalized at send time).

### 4.1 `employees.msg_language`

```python
msg_language: Mapped[str] = mapped_column(
    String(2), default="ar", server_default="ar"  # 'ar' | 'en'
)
```

- Every existing employee defaults to Arabic; only the English exceptions need
  changing.
- Surfaced as a small Arabic/English toggle in the employee edit form.

### 4.2 `whatsapp_messages` (send log)

One row per send attempt. Powers the "Sent ✓" badge, prevents silent
double-sends, and provides an audit trail.

```python
class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    id:              int            # PK
    employee_id:     str            # FK → employees.id
    event_type:      str            # 'leave_approved' | 'duty_resumption' | 'violation'
    event_ref:       str            # 'leave:42' | 'violation:17' — stable per-record key
    language:        str            # 'ar' | 'en' actually sent
    phone:           str            # normalized E.164 sent to (audit)
    template:        str            # approved template name used
    status:          str            # 'sent' | 'failed'
    provider_msg_id: str | None     # WhatsApp message id (for later receipts)
    error:           str | None     # failure reason (bad number, API error…)
    sent_by:         int | None     # User.id who clicked
    created_at:      datetime
    # Index(event_type, event_ref) for fast "has this record been sent?" lookups
```

**Why a log table, not a flag on each record:** source records (leave/violation)
stay untouched; re-sends are first-class (each attempt is a row with history);
failures are visible; new event types need no schema change. The record view
queries this table by `event_ref` for status.

## 5. Message templates

Three event types × two languages = six WhatsApp templates, each pre-registered
in WhatsApp Manager with positional variables (`{{1}}`, `{{2}}`…). Our code fills
the variables in the exact registered order.

- **Arabic weekday names:** الأحد، الإثنين، الثلاثاء، الأربعاء، الخميس، الجمعة، السبت
- **Date format:** `DD/MM/YYYY`
- **Signature constant (one place, both languages):**
  - AR: `إدارة مركز الإصلاح والتأهيل بالوثبة`
  - EN: `Al Wathba Rehabilitation Centre`
- **Greeting:** neutral `عزيزي` / `Dear` for everyone (gender not tracked).
- **Name language:** Arabic message uses `name_ar`; English uses `name_en`;
  fall back to whichever exists.
- **Type labels:** leave types and violation types are stored as English
  strings; an EN→AR label map in `whatsapp_templates.py` translates `{{2}}` for
  Arabic messages, falling back to the stored string for unknown types.

### 5.1 Leave approved — `leave_approved_en` / `leave_approved_ar`

**EN**
```
Dear {{1}},
Your {{2}} leave has been approved.
Start: {{3}} ({{4}})
End:   {{5}} ({{6}})
Duration: {{7}} day(s).
Al Wathba Rehabilitation Centre
```
**AR**
```
عزيزي {{1}}،
تمت الموافقة على إجازتك ({{2}}).
تاريخ البداية: {{3}} ({{4}})
تاريخ النهاية: {{5}} ({{6}})
المدة: {{7}} يوم.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Vars: `1`=name, `2`=leave type, `3`=start date, `4`=start weekday, `5`=end date,
`6`=end weekday, `7`=days.

### 5.2 Duty resumption — `duty_resumption_en` / `duty_resumption_ar`

**EN**
```
Dear {{1}},
Your return to duty on {{2}} ({{3}}) has been recorded.
Welcome back.
Al Wathba Rehabilitation Centre
```
**AR**
```
عزيزي {{1}}،
تم تسجيل مباشرتك للعمل بتاريخ {{2}} ({{3}}).
أهلاً بعودتك.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Vars: `1`=name, `2`=resumption date, `3`=weekday.

### 5.3 Violation / warning — `violation_en` / `violation_ar`

**EN**
```
Dear {{1}},
A {{2}} has been recorded on {{3}} ({{4}}).
Action: {{5}}.
Please contact HR for any clarification.
Al Wathba Rehabilitation Centre
```
**AR**
```
عزيزي {{1}}،
تم تسجيل {{2}} بتاريخ {{3}} ({{4}}).
الإجراء: {{5}}.
يرجى مراجعة الموارد البشرية لأي استفسار.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
Vars: `1`=name, `2`=violation type, `3`=date, `4`=weekday, `5`=action taken /
deduction summary.

> **Implementation constraint:** the copy registered in WhatsApp Manager must
> match these exactly, and the param order in code must match the registered
> template. The strings above are the source of truth for both.

## 6. Config, failure handling, permissions

### Config (Settings + env)

- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_BASE` — secrets via
  env, never in code.
- Default country code `+971` for normalizing `contact`.
- Template names per `(event_type, language)`.
- A master on/off. When off or unconfigured, the "Send to employee" button is
  hidden/disabled.

### Failure handling — fail loud, never silent

- **No/unparseable phone** → button clickable, returns a clear error toast ("No
  valid phone number for this employee"); logged as `failed`.
- **Number has no WhatsApp / API rejects** → reason captured from the API
  response, stored in `whatsapp_messages.error`, shown to the admin.
- **Network/timeout** → one retry, then `failed` with the reason; the admin can
  click again.
- Every attempt (success or fail) writes a `whatsapp_messages` row. The record
  view shows the true state: `Sent ✓ 29/06`, or `Failed – <reason> · Retry`.
- **Double-send guard:** if a `sent` row already exists for that `event_ref`, the
  button shows "Already sent — Resend?" so re-sends are deliberate.

### Permissions

Sending is gated behind a capability in the existing permission system (e.g.
`employees.notify`) so not everyone can message employees.

## 7. Testing (TDD)

- **`whatsapp_client`** — mock the HTTP layer; assert payload shape, retry-once,
  error mapping. No real network calls.
- **Phone normalization** — `05x`, `+9715x`, spaces/dashes, empty, junk → E.164
  or rejected.
- **Template registry** — each `(event_type, language)` builds the right ordered
  params; weekday computation; EN↔AR type-label mapping; name picks
  `name_ar`/`name_en` correctly; signature constant applied.
- **`send_for_event`** — happy path logs `sent`; bad phone logs `failed` and
  sends nothing; double-send guard.
- **API endpoint** — auth/permission gating, 404 on unknown record, returns
  status.

## 8. Out of scope (this iteration)

- PDF / media attachments (designed for, not built).
- Auto-firing on the event (manual only).
- Inbound replies / two-way conversation handling.
- Delivery/read-receipt webhooks (the schema keeps `provider_msg_id` so this can
  be added later).
- Backfilling/validating existing `contact` numbers.

## 9. Operational prerequisites (one-time, outside code)

1. Meta Business account + business verification.
2. A phone number dedicated to WhatsApp Business (not an existing personal
   WhatsApp).
3. Register the six templates above (utility category) and get them approved.
4. Provision the access token + phone-number-id into Settings/env.
