# Leaves SMS updates + Direct-to-Employee send — design

**Date:** 2026-07-15
**Mockup (approved):** `docs/leaves-sms-direct-send-mockup.html` (v2, final wording locked)
**Scope:** five features in three areas — two new message templates, two leaves-page
changes, and direct-to-employee send on the Send-to-Group page.

All messages go through the existing WhatsApp-first / SMS-fallback router
(`notify_dispatch`), are logged in `outbound_messages`, and render in the
employee's `msg_language`. Wording follows the existing template voice
(`sms_templates.py`): same greeting, same signature, same office lines.

## Decisions (locked in review)

| # | Question | Decision |
|---|----------|----------|
| 1 | Reminder timing | 2 days before end date, 09:00 Asia/Dubai |
| 2 | Reminder scope | Annual Leave only |
| 3 | Sick-leave message | Replaces the generic "approved" wording for sick type |
| 4 | Cancellation reason | Required — Cancel button disabled until filled |
| 5 | Edit approved — editable fields | End date + days only; start date fixed; reason required |
| 6 | Direct-send visibility | Any employee, gated by the existing `messages.broadcast` capability |

---

## Feature 1 — Annual-leave ending reminder (automatic)

A daily scheduler job sends a one-time reminder to employees whose **Approved
Annual Leave** ends in 2 days.

**Message (locked wording):**

AR:
```
عزيزي {name}،
نفيدكم علماً بأن إجازتك السنوية تنتهي بتاريخ {end} ({end_weekday}) على أن تتم المباشرة في اليوم التالي {resume} ({resume_weekday}).
يرجى مراجعة مكتب الإدارة لتسجيل مباشرة العمل.
في حال الإجازات الرسمية تتم المباشرة عند مسؤول السرية المناوبة.
إدارة مركز الإصلاح والتأهيل بالوثبة
```

EN:
```
Dear {name},
Please be informed that your Annual Leave ends on {end} ({end_weekday}), and duty resumption is due on the following day, {resume} ({resume_weekday}).
Please visit the administration office to register your duty resumption.
On official holidays, duty resumption is registered with the on-duty company supervisor.
Al Wathba Rehabilitation Centre
```

`{resume}` = `end_date + 1 day`.

**Mechanics:**

- New event `EVENT_LEAVE_ENDING = "leave_ending"` in `notify_format.py`; builder
  `_leave_ending` in `sms_templates.py`; loader `_load_leave` in `_LOADERS`.
- New scheduler job in `scheduler_service.py`: `CronTrigger(hour=9, minute=0,
  timezone="Asia/Dubai")` (same pattern as the monthly digest job).
- Job body (new function in `notify_dispatch.py` or `leave_service.py`,
  e.g. `send_ending_reminders(db) -> int`):
  - select leaves where `is_annual(leave_type)`, `canonical_status == "Approved"`,
    `end_date == today + 2 days`, `return_date IS NULL`;
  - skip when `last_status(db, EVENT_LEAVE_ENDING, leave.id)` already has a row
    (`event_ref` dedup — sent once per leave, restart-safe);
  - respects the same gating as other auto-sends (`_autosend_enabled`).
- Cancelled leaves are excluded by the status filter; a leave whose dates were
  edited (Feature 4) after the reminder fired does **not** re-send (accepted
  simplification: the edit notification itself carries the new dates).

## Feature 2 — Sick-leave registered message

Sick leave is recorded by HR (not requested), so when a sick-type leave is
registered the employee gets a dedicated confirmation instead of the generic
"approved" wording.

**Message (locked wording):**

AR:
```
عزيزي {name}،
تم تسجيل إجازتك المرضية.
المدة: {days} أيام، من {start} ({start_weekday}) إلى {end} ({end_weekday}).
نتمنى لك الشفاء العاجل.
إدارة مركز الإصلاح والتأهيل بالوثبة
```
(Arabic day-count grammar: use يوم/أيام agreement as in existing templates.)

EN:
```
Dear {name},
Your Sick Leave has been registered.
Duration: {days} day(s), from {start} ({start_weekday}) to {end} ({end_weekday}).
We wish you a speedy recovery.
Al Wathba Rehabilitation Centre
```

**Mechanics:**

- New event `EVENT_SICK_LEAVE_REGISTERED = "sick_leave_registered"` + builder.
- In `notify_dispatch._send_leave_status`: when the canonical status maps to
  `EVENT_LEAVE_APPROVED` **and** `leave_lifecycle.classify_group(leave_type) ==
  "sick"`, send `EVENT_SICK_LEAVE_REGISTERED` instead (decision 3 — replaces,
  never both). Requested/rejected/cancelled events are unaffected.

## Feature 3 — Cancellation reason travels into the message

The decision panel's existing notes box becomes the cancellation reason and is
included in the cancellation message.

**Message change (`_leave_cancelled`):** after the "has been cancelled" line,
insert `Reason: {notes}` / `سبب الإلغاء: {notes}` when the leave has non-empty
`notes`. The rest of the template is unchanged.

**Mechanics:**

- Backend: `_leave_cancelled` reads `leave.notes` (already persisted by
  `update_leave` **before** `auto_send_leave_status` fires — no new plumbing).
- Frontend (both surfaces — desktop `RecordExpansion` and mobile drawer):
  - When the user clicks **Cancel**, the notes field is labelled/hinted as the
    cancellation reason and is **required** (decision 4): the Cancel action is
    disabled until notes is non-empty. Approve/Reject keep notes optional.
  - Field help text: "sent to the employee" (EN/AR locale keys).
- Note: `notes` is a single shared column; a reason entered at cancel time
  overwrites prior decision notes. Accepted — the audit trail keeps history.

## Feature 4 — Edit an approved annual leave (+ notify)

New "Edit leave" action on **Approved Annual Leave** records: shorten/extend the
end date (start fixed), give a required reason, save re-checks and updates the
record, and the employee is notified with old vs new duration and the reason.

**Message (new, pre-rendered):**

AR:
```
عزيزي {name}،
تم تعديل إجازتك السنوية.
تاريخ البداية: {start} ({start_weekday})
تاريخ النهاية: {new_end} ({new_end_weekday})
المدة الجديدة: {new_days} يوماً (بدلاً من {old_days}).
سبب التعديل: {reason}
لأي استفسار يرجى مراجعة مكتب الإدارة.
إدارة مركز الإصلاح والتأهيل بالوثبة
```

EN:
```
Dear {name},
Your Annual Leave has been updated.
Start: {start} ({start_weekday})
End: {new_end} ({new_end_weekday})
New duration: {new_days} day(s) (was {old_days}).
Reason: {reason}
For any clarification, please contact the administration office.
Al Wathba Rehabilitation Centre
```

**Mechanics:**

- **Lifecycle:** extend `leave_lifecycle` with `can_edit_end_date(leave_type,
  status)` → True for `is_annual` + canonical `Approved` (existing
  `can_edit_dates` stays NS-Pending-only and keeps governing start+end edits).
- **API:** new endpoint `POST /leaves/{id}/amend` with payload
  `{end_date: date, reason: str}` (reason required, min length 1 after strip).
  A dedicated endpoint (rather than overloading PATCH) because the operation is
  atomic: validate → capture old days → update → audit → notify-with-old-values.
  Gated by the existing `leaves.edit` capability (decision 5).
- **Service:** `leave_service.amend_approved_leave(db, leave_id, end_date,
  reason, actor)`:
  - validates lifecycle (`can_edit_end_date`), `end_date >= start_date`;
  - recomputes `days`, replaces `notes` with the reason (same overwrite
    semantics as the cancel path; the audit row keeps prior history), audits
    `leave.amended {from, to, reason}`;
  - renders the message via a new `sms_templates.render_leave_amended(leave,
    employee, lang, old_days, reason)` (pre-rendered because `old_days` is gone
    from the record after the update) and sends via
    `notify_dispatch.send_direct(..., event_type="leave_amended",
    event_ref=f"leave_amended:{id}")` — best-effort, same try/except pattern as
    `update_leave`.
  - Balance is surfaced in the UI (meter next to the dialog) but **not**
    hard-enforced server-side — consistent with how approvals work today.
- **Frontend (both surfaces):** "Edit leave" button on Approved annual rows →
  dialog (per mockup): read-only start, end-date picker, computed days badge +
  delta vs current, balance strip (from the existing leave-balance query),
  required reason textarea, "Save & notify employee". Invalidates the same
  query set as `useLeaveDecisionActions`.

## Feature 5 — Send-to-Group: direct message to employees by G-number

A second recipients card under Groups on the Send-to-Group page. Search by
G-number or name, multi-select (no cap), groups become optional: employees-only
⇒ private WhatsApp message (SMS fallback), no group involved.

**Backend (`POST /announce/send`):**

- New optional form field `employee_ids: list[str]` (employee G-numbers).
- Validation: at least one of `group_ids` / `employee_ids` non-empty
  (`group_ids` becomes optional; currently it is required).
- For each employee: resolve → `notify_dispatch.send_direct(db, employee=...,
  body=text, language=employee.msg_language, event_type="announcement_direct",
  event_ref=f"announcement_direct:{employee_id}", sent_by=user.id)`.
  The router handles phone normalization, WhatsApp-first, SMS fallback,
  no-phone failure rows, and outbound_messages logging (decision-card rule 4).
- Attachment behaviour: same book/upload attachment is sent to direct
  recipients the same way it is sent to groups (media send via openwa_client);
  if the current group flow sends media separately, direct reuses that path.
- Mentions (`@name`) are a group-chat concept — ignored/stripped for direct
  recipients; the plain text is sent.
- Response `AnnouncementOut`: keep `results: list[GroupSendOut]` untouched and
  add a parallel `direct_results: list[DirectSendOut]` with
  `{employee_id, employee_name, ok, fell_back, error}` — non-breaking for the
  existing frontend render. `sent`/`failed` counts include both kinds.
- Employee search: reuse the existing employee-search endpoint already used by
  `EmployeeMentionField` (matches name/G-number/designation); no new endpoint.

**Frontend (`SendToGroupPage`):**

- New card under Groups: search box (G-number or name) → dropdown of matches
  (employees without a usable mobile shown disabled with a "no mobile" badge)
  → selected list with remove. State: `Set<string>` of employee ids.
- Reach meter shows two counts: groups | direct.
- Submit rule: `hasRecipient = groups.size > 0 || employees.size > 0`.
- Send hint states (per mockup): groups+employees / groups only /
  "Private message — sends directly to N employees, no group" / none.
- Phone preview (Normal view): when only employees are selected, the preview
  header shows the first selected employee ("private chat — not a group")
  instead of a group name.
- Result panel: per-recipient rows with a group/direct tag; failed direct rows
  show the router's error (e.g. no mobile, WhatsApp failed → SMS fallback is a
  success with `fell_back`).
- All new strings in `en.json` + `ar.json`; logical CSS; `dir="auto"` on inputs.

---

## Cross-cutting

- **Events summary:** new `leave_ending`, `sick_leave_registered`,
  `leave_amended` (send_direct, pre-rendered), `announcement_direct`
  (send_direct, operator text). The first two get builders in
  `sms_templates.py` + entries in `_BUILDERS`/`_LOADERS`.
- **No DB migration expected:** reminder dedup rides on
  `outbound_messages.event_ref`; amend reuses `notes` + audit; direct send
  reuses `outbound_messages`.
- **API types:** backend schema changes (announce send form, amend endpoint,
  possibly `AnnouncementOut`) require the `/sync-api-types` flow and committing
  `openapi.json` + `api.types.ts` together.
- **Testing:** pytest for lifecycle rules, amend service (old/new days in
  message, reason required), sick-type event swap, cancelled-with-reason
  rendering, reminder job (selection window, dedup, skip-cancelled/returned),
  announce endpoint validation (groups optional, employee fan-out, mixed
  results); vitest for the new dialog, direct-recipients card, hint states,
  and both leaf surfaces getting the Edit action.
- **Reviewers:** run `i18n-rtl-reviewer` and `notification-template-reviewer`
  after template/locale work (project rule — bilingual surfaces are the #1
  defect source).
- **Rollout:** feature is dormant-safe — all sends no-op unless channels are
  enabled (existing gating); work on a branch, merge to `main`, deploy via
  `mng deploy`.
