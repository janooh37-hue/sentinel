# Per-book "Notify employee" switch on the form preview

**Date:** 2026-07-20
**Branch:** `feature/preview-sms-toggle` (worktree `.claude/worktrees/preview-sms-toggle`)
**Mockup:** `docs/preview-sms-toggle-mockup.html`

## Goal

Give the operator a per-book opt-out for the employee notification, right on the
form preview. A switch sits in the Save-Book footer, **On by default** (today's
behaviour). Flipping it **off before pressing Save** saves that one book without
notifying the employee. The choice is not remembered — the next form starts On.

## Scope

**In:** the 8 document forms whose `commit`-save already fires a notification via
`notify_dispatch.auto_send_for_book()`:

- Salary Transfer Request
- Salary Deduction Form
- Employee Clearance Form
- HR Request Form
- Passport Release Form
- Warning Form
- Resignation Letter
- Leave Permit Form

These are exactly the keys of `TEMPLATE_EVENTS` in
`backend/app/services/notify_format.py`.

**Out (explicitly not touched):**

- Leave *status* notifications (approve/reject/amend leave → `auto_send_leave_status`
  / `auto_send_leave_amended`) — a different code path with no book-preview screen.
- Direct-to-employee sends.
- Persisting or auditing the opt-out (the book simply has no `outbound_messages`
  row — nothing new to store).
- Frontend "no phone on file" detection — `notify_dispatch` already no-ops
  cleanly when the employee has no valid number; nothing to add here.

## Behaviour

1. The switch renders **only** when the selected template is one of the 8 above
   **and** the global setting `sms_autosend_enabled` is on. If notifications are
   turned off app-wide, the switch would do nothing, so it is hidden.
2. Default **On**. Local component state only; resets per form.
3. On **Save Book** (`commit: true`), the switch value rides along in the
   generate payload as `notify_employee`. The preview call (`commit: false`)
   never notifies, so the value is irrelevant there.
4. Backend sends the notification only when `notify_employee` is true **and** the
   existing conditions hold (`commit`, new book, global autosend on). Default
   `true` keeps every existing caller unchanged.

## Backend

**`backend/app/api/v1/documents.py`**

- Add to `DocumentGenerateRequest`:
  ```python
  notify_employee: bool = True
  ```
- Gate the existing dispatch (currently ~line 213):
  ```python
  if _should_autosend(
      commit=request.commit,
      revise_of_book_id=request.revise_of_book_id,
      book_id=result.book_id,
  ) and request.notify_employee:
      notify_dispatch.auto_send_for_book(db, result.book_id, sent_by=None)
  ```

Default `True` = backward compatible. The global `sms_autosend_enabled` gate
inside `notify_dispatch` is unchanged, so the effective rule is
`autosend-enabled AND notify_employee`.

**API types resync (mandatory):** the request schema changed, so dump
`backend/openapi.json`, run `pnpm gen:api`, typecheck, and commit `openapi.json`
+ `frontend/src/lib/api.types.ts` together (the `/sync-api-types` flow).

## Frontend

**`frontend/src/pages/application/ApplicationPage.tsx`** (single surface — this is
the generation preview, not a record detail, so there is no second surface to
wire).

- `const SMS_FORMS = new Set([...8 template ids...])` (module-level).
- Read the global setting with the existing `api.getSettings()`
  (`GET /settings`, already returns `sms_autosend_enabled`; SettingsPage uses it).
- Local state `const [notifyEmployee, setNotifyEmployee] = useState(true)`.
- Render a switch **row** in the Save-Book footer (above the Add-to-basket / Save
  buttons) only when `SMS_FORMS.has(selectedTemplate) && settings.sms_autosend_enabled`.
- Control: native `<input type="checkbox">` styled as a toggle (accent = primary,
  matching `CheckboxField`) — no new dependency. `role`/`aria-label` on the input.
- In `buildPayload()`, include `notify_employee: notifyEmployee`.
- Hint text under the label flips with the switch (see wording below).

## Wording (bilingual — `frontend/src/locales/{en,ar}.json`)

Label chosen: **"Notify employee"** (channel-accurate — delivery is WhatsApp-first
with SMS fallback).

| Key | EN | AR |
|-----|----|----|
| label | Notify employee | إشعار الموظف |
| hint (on) | The employee will get a message when this form is saved. | سيصل الموظف إشعار عند حفظ هذا النموذج. |
| hint (off) | Saved without notifying the employee. | سيتم الحفظ دون إشعار الموظف. |

Use logical CSS (`ms-`/`me-`, `text-start/end`, `dir`) — the switch, label and
hint must mirror correctly in RTL. Run the `i18n-rtl-reviewer` and
`notification-template-reviewer` agents after.

## Testing

**Backend** (`backend/tests/`, pytest):

- `commit=True, notify_employee=False` on an SMS-form template ⇒
  `auto_send_for_book` **not** called (spy/monkeypatch).
- `commit=True` with `notify_employee` defaulting True ⇒ `auto_send_for_book`
  **called** (guards the default-on backward-compat path).

**Frontend** (`frontend/src/.../*.test.tsx`, vitest):

- Switch renders for an SMS-form template when `sms_autosend_enabled` is true;
  not rendered for a non-SMS template, and not rendered when the setting is off.
- Toggling off ⇒ the Save payload carries `notify_employee: false`.

## Files touched

- `backend/app/api/v1/documents.py` (schema field + gate)
- `backend/openapi.json`, `frontend/src/lib/api.types.ts` (regenerated)
- `frontend/src/pages/application/ApplicationPage.tsx` (switch + state + payload + hide logic)
- `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (3 strings)
- Tests: one backend test file, one frontend test file
- `docs/preview-sms-toggle-mockup.html` (mockup, committed alongside)

## Reviewers

`i18n-rtl-reviewer`, `notification-template-reviewer` (bilingual surface), and a
correctness pass on the backend gate.
