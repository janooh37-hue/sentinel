# SMS Service Templates — Design

**Date:** 2026-07-03
**Status:** Copy approved (see `docs/sms-services-templates-preview.html`); wiring pending
**Owner surface:** `backend/app/services/sms_templates.py`, `backend/app/services/notify_format.py`, `backend/app/services/sms_service.py`

## Goal

Extend the manual "Notify by SMS" channel from the current 3 record events
(leave approved, duty resumption, violation) to **7 HR document/form services**,
so an admin can text an employee a bilingual (Arabic-default) confirmation when a
form is finalized. Arabic correctness and zero English-leak are the primary bar;
each message reuses the existing formatting helpers so the guarantee is inherited,
not re-implemented.

## Scope — the 7 services

| Service (template_id) | Type | Arabic verb | Carries |
|---|---|---|---|
| Salary Transfer Request | completion | تم اعتماد | bank name, salary month |
| Salary Deduction Form | completion (future) | سيتم خصم | amount |
| Employee Clearance Form | completion | تم إنجاز | effective date |
| HR Request Form | acknowledgement | تم تقديم طلب | requested document(s) |
| Passport Release Form | acknowledgement | تم تقديم طلب | — |
| Resignation Letter | acknowledgement | تم استلام | date |
| Warning Form | disciplinary | تم إصدار إنذار | violation type (reuses `type_label`) |

Out of scope (leave-adjacent or internal): Acknowledgment/Material Request,
Leave Permit, Administrative Leave.

## Approved copy

The exact bilingual bodies are the source of truth in
`docs/sms-services-templates-preview.html` (reviewed by the
notification-template-reviewer across 4 passes). Key resolved decisions:

- **No second SMS.** HR Request / Passport / Resignation say "سيتم إبلاغك … / you
  will be notified"; that later notice is delivered by phone or in person.
- **Register:** singular `سيتم إبلاغك` (matches «عزيزي {name}» + «طلبك»).
- **Salary Deduction:** future tense `سيتم خصم مبلغ {amount} درهم من المرتب الشهري`
  — sent *before* payroll, so it states an upcoming deduction, not a completed one.
- **Salary month (definite rule):** finalized on/before the **15th** → **next**
  month's salary; after the 15th → the **month after**. Stated with `سيتم`, no hedge.
- **Warning** routes to `مكتب الإدارة` (like the violation template); the other
  HR services route to `مكتب الموارد البشرية`.
- **Passport** uses the catalog name `طلب جواز السفر` (not the leave-type label
  `تسليم جواز`).

## Data model / trigger

The existing channel is `POST /sms/send {event_type, record_id}` →
`sms_service.send_for_event` → per-event loader → `record.employee` →
`sms_templates.render_text(event_type, lang, record, employee)` → gateway → log row.

The 7 new services are **form documents**, persisted as:
- `Book` (`Book.employee_id` → employee; nullable, but per-employee forms have it).
- `BookVersion.template_id` — identifies the service (matches `TEMPLATE_FILES` keys).
- `BookVersion.fields` (JSON) — the submitted values: `bank_name`, `amount`,
  `doc_selections`, `violation_type`, etc.

So the new events load a **Book** as their record:
- `record_id` = `book.id`.
- Loader fetches the Book + its latest `BookVersion`; reads `version.fields`.
- `event_type` is derived from `version.template_id` (or passed explicitly by the
  caller, matching the existing explicit-event pattern — decided in the plan).
- Employee = `book.employee`.

## Components to add

1. **`notify_format.py`**
   - 7 new `EVENT_*` constants.
   - `salary_transfer_month(today: date) -> str` — applies the ≤15th rule, returns
     Arabic Gregorian month name + year (e.g. «أغسطس 2026»), **no leading «شهر»**
     (the template already contains «شهر» — documented token contract to avoid the
     doubled-word bug this codebase has hit before).
   - Arabic Gregorian month-name table (يناير…ديسمبر) + English months.
   - `hr_request_doc_label(option: str, lang: str) -> str` — the confirmed 7-option
     map (خطاب عمل / شهادة راتب / بطاقة التأمين / بطاقة الهوية / خطاب تحويل راتب /
     قسيمة الراتب / شهادة خبرة). Joins multiple selections with «، » (AR) / ", " (EN).
   - `_SIGNATURE`/routing constants: pin `مكتب الموارد البشرية` and `مكتب الإدارة`
     as named constants so the routing phrase can't drift.

2. **`sms_templates.py`**
   - 7 new builder functions following the existing `_leave_approved` shape.
   - Register them in `_BUILDERS`.
   - Warning reuses `nf.type_label(fields["violation_type"], lang)`.

3. **`sms_service.py`**
   - `_LOADERS` entries for the 7 events → a Book loader that returns a lightweight
     record object exposing `.employee` + the needed `fields` (or pass fields
     through). Salary-transfer month computed from the send date at render time.

4. **Frontend** — surface the existing "Notify by SMS" button on the form/document
   (Book) detail surface for these template types, gated on `sms_enabled` +
   `employees.notify` (mirrors the current leave/violation button). Exact surface
   identified in the plan.

## Testing

- Extend `backend/tests/test_sms_templates.py`: one AR + one EN assertion per
  service, asserting the exact body and **no cross-language leak** (`_has_arabic`
  checks), mirroring existing template tests.
- `test_notify_format.py`: the salary-month rule at boundaries (15th vs 16th, year
  rollover Dec→Jan), and the doc-label map (each option, AR+EN, plural join).
- Guard the doubled-«شهر» contract explicitly (assert the month token has no
  leading «شهر»).

## Non-goals

- No automatic/scheduled sending — manual button only, as today.
- No second/follow-up SMS.
- No new gateway or config changes (reuses the existing `GSSG_SMS_*` channel).
