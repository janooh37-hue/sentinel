# SMS Auto-Send + Employee Messages Tab — Design

**Date:** 2026-07-06
**Status:** Approved (brainstorm); pending spec review
**Builds on:** the 7 service-form SMS templates merged in `4260ab9`.

## Goal

Turn the 7 HR service-form SMS notifications from **manual (button)** into **automatic on generation**, add a master on/off switch, and replace the per-document button with a per-employee **Messages** tab that shows every SMS sent to that employee (text, recipient, sent/failed). Plus a test-hygiene fix so the config-default tests pass against the live `.env`.

## Decisions (from brainstorming)

- **All 7** services auto-send (Salary Transfer, Salary Deduction, Employee Clearance, HR Request, Passport Release, Warning, Resignation).
- **Trigger:** the *real, initial* generation only — `generate_document(commit=True, revise_of_book_id=None)`. No SMS on drafts/previews (`commit=False`) or revisions.
- **Switch:** a new app setting `settings.sms_autosend_enabled` (default **on**), flippable in the Settings UI. Independent of `GSSG_SMS_ENABLED` (the channel master switch).
- **Display:** a new **Messages** tab on the employee profile (6th tab), keyed by G-number — its own surface, not mixed into the Activity feed. Shows message text, recipient phone, status (✓ sent / ✗ failed + reason), timestamp.
- **Remove** the per-document `SendSmsButton` from `BookRecordPage`.

## Architecture

### 1. Store the sent body (schema change)
`SmsMessage` currently stores no body (privacy). The Messages tab must show *what was sent*, so add a nullable `body: Text` column via a new migration (`0046_sms_message_body`). `sms_service._log_row` gains a `body` param; `send_for_event` passes the rendered text on success (and the intended text on failure, so failed sends are still auditable). Existing rows have `body = NULL` (rendered as "—"). This is a deliberate, user-requested reversal of the no-body decision, scoped to employee-facing audit.

### 2. Auto-send hook
A new `sms_service.auto_send_for_book(db, book_id, sent_by=None) -> SmsMessage | None`:
- Returns `None` (no-op) unless: `sms_enabled` AND `settings.sms_autosend_enabled` AND the book's latest version `template_id` maps to one of the 7 events AND the book has an `employee_id`.
- Otherwise calls the existing `send_for_event(db, event, book_id, sent_by=None)` path (which already loads the `BookEvent`, renders, sends, logs).
- A backend `TEMPLATE_EVENTS: dict[str, str]` (template_id → event constant) lives in `notify_format.py` (the 7 pairs; mirrors the frontend map that is being removed).

**Call site:** `api/v1/documents.py` generate endpoint, *after* a successful `generate_document` when `request.commit is True and request.revise_of_book_id is None and result.book_id is not None`. Wrapped in try/except so a send failure NEVER affects the generation response (the document is already committed). One SMS per initial generation → naturally idempotent (revisions and re-previews don't fire).

### 3. Master switch
`settings_service`: add `settings.sms_autosend_enabled` to `_DEFAULTS` (True), read it in `get_settings`, write it in `update_settings`; extend `AppSettingsRead`/`AppSettingsUpdate` schemas. Settings UI: a labeled toggle (follow the existing `sentry_opt_in` bool pattern).

### 4. Employee Messages data
- New schema `SmsMessageRead` (id, event_type, body, phone, status, error, language, created_at).
- `employee_detail_service.get_employee_detail` adds `recent_sms: list[SmsMessageRead]` (query `sms_messages` by `employee_id`, newest first, capped e.g. 50). Added to `EmployeeDetailRead`.

### 5. Frontend
- **Remove** `SendSmsButton` + `TEMPLATE_SMS_EVENTS` from `BookRecordPage.tsx` (revert that block). Keep `SendSmsButton` component + the leave/violation usages untouched.
- **Messages tab:** add `'messages'` to `StatTabTarget`/`Tab`; add the tab to `EmployeeDetailTabs`; new `tabs/MessagesTab.tsx` (timeline/list of `SmsMessageRead` — text, phone, status chip sent/failed, timestamp; empty-state when none). `EmployeeDetailPage` passes `data.recent_sms`. `api.ts` gains `SmsMessageRead` + the field on the employee-detail type.
- **Settings toggle:** add the auto-send toggle control to the Settings page, bound to the new setting.

### 6. Test-hygiene fix (bundled)
`test_sms_config.py::test_sms_disabled_by_default` and `test_whatsapp_config.py::test_whatsapp_defaults_are_disabled_and_safe` fail on this live checkout because pydantic loads the real `.env` even after `monkeypatch.delenv`. Fix: construct `Settings(_env_file=None)` in those tests (disables dotenv loading; process env already cleared) so they assert true defaults. No production change.

## Testing

- **Backend:** auto-send fires on commit+initial for a mapped template with an employee; does NOT fire on `commit=False`, on a revision, when `sms_autosend_enabled` is off, when `sms_enabled` is off, or for a non-mapped template; failure path logs a `failed` row with body and never raises; `body` is persisted on send; `get_employee_detail` returns `recent_sms`; settings get/update round-trips the toggle; the two config tests pass under a live-`.env` simulation.
- **Frontend:** `MessagesTab` renders sent + failed rows and the empty state; `BookRecordPage` no longer renders the SMS button; settings toggle round-trips.

## Non-goals

- No change to the leave/duty/violation manual SMS buttons (they stay manual).
- No retry/scheduler — a failed auto-send is visible in the Messages tab; re-generation is the retry path.
- No bulk/backfill of bodies for historical rows.
