# Scheduled departures — resignation date + pending status flip

**Date:** 2026-07-30
**Status:** approved design, not yet planned

## Problem

The Resignation Letter (301-010) renders its body date —
`أتقدم لسيادتكم بطلب إستقالة عن العمل بتاريخ __/__/__` — from the paper's
creation day. `_adapt_resignation_letter` (`core/docx_engine.py:147`) splits
`today` into `day`/`month`/`year`, and the form (`templates/_fields.json`) has no
date input at all, so the resignation date is *always* the day the paper was
made. The operator's workaround is to generate the letter, download the DOCX,
edit the date in Word, and re-upload it as an attachment.

Separately, a resignation letter has no effect on the employee record. Someone
resigns, the paper is filed, and the employee stays `Active` forever until a
human remembers to change it by hand.

## Scope

Two connected pieces:

1. **An operator-set resignation date** on the letter, independent of the
   creation date.
2. **Scheduled departures** — a resignation (or termination) dated in the future
   keeps the employee `Active` through their notice period, then flips them
   automatically on the day, with reminders in the meantime.

Explicitly out of scope: **employee-facing messaging.** No SMS, WhatsApp, or
push to the employee is added or changed. `sms_templates._resignation` (the
"resignation letter has been received on {date}" message) keeps reading the
letter's creation date and is not touched.

---

## Part 1 — Resignation date on the letter

The letter has three date slots. Only the body one becomes editable:

| Slot | Token | Behaviour |
|---|---|---|
| Header `التاريخ` | `{{ today }}` | unchanged — creation day |
| Body `بتاريخ __/__/__` | `{{ day }}/{{ month }}/{{ year }}` | **new field** |
| Signature block `التاريخ` | `{{ today }}` | unchanged — creation day |

### Changes

**`backend/templates/_fields.json`** — Resignation Letter gains a field, placed
before `reason`:

```json
{
  "key": "resignation_date",
  "type": "date",
  "label_en": "Resignation Date",
  "label_ar": "تاريخ الاستقالة",
  "required": true
}
```

`type: "date"` is already fully generic on the frontend — `TemplateForm.tsx:145`
renders `DateField`, `applicationFormSchema.ts:52` applies the ISO-date Zod
regex. 14 fields across other forms already use it. No new component, no new
field type, no frontend plumbing.

**`core/docx_engine.py`** — `_adapt_resignation_letter` splits
`resignation_date` instead of `today`:

- Parse `resignation_date` accepting ISO (`%Y-%m-%d`, what the date input sends)
  and `%d/%m/%Y`.
- Fall back to `today` when it is absent or unparseable, so the 5 existing
  resignation-letter records, previews, and re-renders on sign keep working.
- Leave `out["today"]` alone — the header and signature dates stay on the
  creation day.

**`pages/application/ApplicationPage.tsx`** — prefill the input to today's ISO
date on schema load, so an untouched form produces byte-identical output to
today's behaviour.

### Deliberately skipped

A generic `"default": "today"` property in `_fields.json` (would need the prop
threaded through the schema endpoint, the generated types, and the form builder).
One field needs a default. Add the prop when a second one does.

---

## Part 2 — Scheduled departures

### Storage

The live DB (`data/gssg.db`, 280 Active / 12 Terminated / 9 Resigned) has **zero**
rows where `status = 'Active'` and `end_date IS NOT NULL`, zero non-Active rows
with a null `end_date`, and zero future `end_date` values. That combination is an
unused state, so it is safe to repurpose as "pending departure" — no new date
column is needed. Only the *target* status has to be recorded, because
resignation vs termination is not derivable.

```
employees.pending_status  TEXT NULL      # 'Resigned' | 'Terminated'
```

Pending departure ⇔ `status = 'Active' AND pending_status IS NOT NULL AND end_date IS NOT NULL`.
The date is the existing `end_date` (already means "last day"), which keeps the
Employee Clearance Form's `termination_date` — derived from `employee.end_date`
at `document_service.py:664` — correct for a pending departure for free.

`status` deliberately stays `'Active'` while pending, so every existing
active-roster query, search, notification, and report keeps treating the person
as the working employee they still are.

**Migration** `0065_employee_pending_status` (current head is
`0064_book_edit_session_report_signer`): one nullable column via
`op.batch_alter_table` (SQLite), no FK, no `server_default` needed since it is
nullable. Single linear head — confirm with `alembic heads` before writing it.

`pending_status` is a free-text column (SQLite has no enum), so the two writers
are the only place the value is set and both write a literal from
`EMPLOYEE_STATUSES`. The flip job additionally filters
`pending_status IN ('Resigned', 'Terminated')` so a hand-edited or imported junk
value can never be promoted into `status`.

### Writers

One rule, applied in both places: **an end date in the future schedules; today
or past applies immediately.**

**1. Resignation Letter creation** — in `generate_document`, gated on
`commit=True` and `template_id == "Resignation Letter"`, just before the terminal
`db.commit()` (`document_service.py:1707`) so it is atomic with the Document
insert:

- Only when the employee is currently `Active` — never overwrite someone already
  Resigned or Terminated.
- `resignation_date` in the future → `pending_status='Resigned'`,
  `end_date=resignation_date`, `status` untouched.
- `resignation_date` today or past → flip now: `status='Resigned'`,
  `end_date=resignation_date`, `pending_status=NULL`.

**2. `update_employee`** (the PATCH behind both `StatusDialog` and the full
`EmployeeForm`) — putting the rule in the service, not the dialog, means every
caller gets it and there is one place to be correct:

- Incoming `status != 'Active'` with `end_date` in the future → store
  `pending_status=<that status>`, `end_date`, and keep `status='Active'`.
- Otherwise unchanged — immediate flip, today's behaviour preserved.
- A patch that explicitly sets `status='Active'` or `end_date=None` clears
  `pending_status`. A patch touching neither (e.g. `department`) leaves it alone.

`validate_status_end_date` stays satisfied: it only requires an `end_date` when
status is *not* Active, and setting one while Active was always legal.

### The flip

New daily scheduler job beside `_run_leave_ending_reminder`
(`scheduler_service.py:324`, registered at `:421`):

```sql
UPDATE employees
   SET status = pending_status, pending_status = NULL
 WHERE pending_status IN ('Resigned', 'Terminated')
   AND end_date <= :today
   AND status = 'Active'
```

`end_date` is already correct, so it is not rewritten. One in-app notification
per flip.

### Cancelling

The operator asked for a cancel path because the paper carries a
`مشروحات مدير المشروع` manager-remarks block — a resignation can be refused.

Cancel needs **no new API surface**: the widget's Cancel button sends the PATCH
that already exists, `{status: 'Active', end_date: null}`, which under the
clearing rule above also nulls `pending_status`. The employee is already `Active`,
so it is a no-op on status and a clean reset of the pending fields.
`EmployeeUpdate` therefore gains no writable field.

### Reads and UI

`EmployeeRead` gains `pending_status: str | None` (read-only). This changes the
schema, so `openapi.json` + `frontend/src/lib/api.types.ts` must be regenerated
and committed together (`/sync-api-types`).

Three reminder surfaces, all requested:

1. **Dashboard widget — "Pending departures."** Name, target status, date, days
   remaining, Cancel. `list_employees` already has a filter layer (`status`,
   `department`, `duty_unit` — `employee_service.py:34`), so this adds a
   `pending: bool` filter and rides `GET /employees?pending=true`. No new
   endpoint. Same card shape as `ExpiringSoonWidget`.
2. **Notification bell.** On flip day, via the existing rail in
   `admin_notify.py` — `push_service.send_to_user(db, admin.id, {en, ar}, url)`
   for `active_admins(db)`, deep-linking to the employee. Admins only; the
   employee is not messaged.
3. **Profile badge.** A chip beside `StatusPill` while `status='Active'` and
   `pending_status` is set: `مستقيل — اعتباراً من 15/08` /
   `منتهي الخدمة — اعتباراً من 15/08`. Shown on the employee page and in search
   results.

### Deliberately skipped

- A separate `pending_resignations` table. Two nullable-ish fields on `employees`
  carry it; a table earns its place when a departure needs history or an audit
  trail of its own.
- Advance warnings ("3 days before"). Add if a departure ever slips past the
  operator.
- Any change to termination as an *immediate* action — someone walked off site
  today still flips instantly.

---

## Bilingual / RTL

New strings: the `resignation_date` label (in `_fields.json`, both languages),
the widget title and column headers, the pending badge for both target statuses,
and the flip notification copy (bilingual dict, as `admin_notify.py` does).

Per `CLAUDE.md` this is the project's top recurring defect class, so both
reviewers run before merge: `i18n-rtl-reviewer` and
`notification-template-reviewer`. Badge and widget use logical CSS
(`ms-`/`me-`, `text-start`/`text-end`), and dates inside Arabic text need the
RTL-bidi handling already established for the permit letter.

Tests assert the **Arabic** string under `lng=ar`, not just the English — an
English-only assertion cannot catch an AR leak when the EN label equals the key.

## Testing

**Backend**
- `_adapt_resignation_letter`: ISO input splits into day/month/year; `%d/%m/%Y`
  input works; missing/garbage `resignation_date` falls back to `today`; `today`
  is never shifted by a resignation date.
- Letter creation: future date → pending, `status` still `Active`; past/today →
  immediate flip; already-Resigned employee is untouched.
- `update_employee`: future end date schedules; past end date flips now;
  `status='Active'` clears `pending_status`; an unrelated patch preserves it.
- Flip job: flips only rows due today or earlier, leaves future rows, is
  idempotent across two runs on the same day.
- Migration: upgrade then downgrade on a populated copy.

**Frontend**
- The resignation-date input renders and prefills to today.
- Pending badge appears for both target statuses and is absent when
  `pending_status` is null.
- Widget lists pending departures; Cancel fires the reset PATCH.
- i18n parity for every new key, asserted in Arabic.

## Risks

- **The letter is a request, not a fact.** Mitigated by keeping the employee
  `Active` until the date and giving Cancel a first-class place in the widget.
- **`status` staying `Active` while pending** is the whole point, but it means a
  pending departure does *not* suppress anything gated on active status. That is
  intended — they are still working.
- **Timezone.** The flip job compares dates, not timestamps. `created_at` is
  stored UTC elsewhere in this codebase and has caused a bug before; the job must
  use the same local-date notion the operator sees.
