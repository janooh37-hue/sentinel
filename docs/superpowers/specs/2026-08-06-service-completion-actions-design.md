# Service completion actions and per-save notification control

**Date:** 2026-08-06  
**Status:** UI and workflow approved  
**Branch:** `design/post-save-actions`  
**Review artifact:** `docs/service-post-save-actions-review.html`

## Goal

Replace toast-only completion after a service creates a document record with a
durable, useful handoff. The operator must be able to:

1. choose whether a notifier-backed form sends its employee notification;
2. save the document to Records;
3. print the saved document;
4. send the saved record for approval; and
5. open the full record.

The same completion treatment applies to generated forms, Word-authored General
Books, Word-authored Reports, and the Duty Locations transfer letter. The
unsupported **Save as template** action must not appear for Reports.

## Current problems

### Completion is fragmented

- A committed generated form ends with a success toast and a disabled Saved
  button below the preview. The useful record actions live elsewhere.
- Word-authored documents finish in `WordHandoffDialog`, which shows the final
  PDF but only offers Close and Save as template.
- Duty transfer closes its dialog and leaves only a toast action to open the
  record.
- The full record page already has working Print and Send for approval actions,
  but staff must find and reopen the new record to use them.

### Notification coverage is incomplete in the frontend

`frontend/src/pages/application/notifyToggle.ts` hardcodes the eight keys in
`notify_format.TEMPLATE_EVENTS`. However,
`notify_dispatch.auto_send_for_book()` also automatically notifies for four
special document-backed paths:

- Leave Application Form;
- Administrative Leave Form;
- Duty Resumption Form; and
- Violation Form.

Those forms can currently auto-notify while offering no per-save opt-out. A
frontend-maintained list can drift again when another notifier is added.

### Report exposes a rejected action

`WordHandoffDialog` renders Save as template for every finished Word document.
The backend accepts only versions whose `template_id` is `General Book`; a
Report therefore receives a button that always fails with
`NOT_A_GENERAL_BOOK`.

## Approved scope

### Included

- Every standard form committed through `/documents/generate`.
- General Book authored through a Word session.
- Report authored through a Word session.
- Duty Locations transfer when it creates a General Book letter.
- Word sessions reopened from Records: finishing a new Word version receives
  the same post-save actions.
- All automatically notifying form templates, including special
  leave/violation routes and `TEMPLATE_EVENTS` routes.
- Desktop and phone layouts, English/LTR and Arabic/RTL, light and dark themes.

### Excluded

- National Service: its Services tile routes to a leave record flow and does not
  create a document/book through this service-completion path.
- Adding notifications to General Book, Report, or Duty transfer. They receive a
  notification switch only if a future backend notifier capability explicitly
  marks them as notifying.
- Choosing WhatsApp versus SMS per save. Delivery remains WhatsApp-first with
  SMS fallback; the operator controls the notification, not the transport.
- Changing outbound notification wording or templates.
- Persisting a user preference for the switch. Each new form starts On.
- Database or Alembic changes.

## Locked product decisions

1. **Inline handoff, not a modal or automatic redirect.** The document/result
   stays visible and the actions remain available until the operator starts
   another task or leaves the page.
2. **Top placement.** The handoff area sits above the document preview/result,
   not below a long PDF.
3. **Two states in the same position.**
   - Before commit: notification choice when applicable + Save to Records.
   - After commit: Saved/reference + notification choice summary + Print + Send
     for approval + Open record.
4. **Notification default On.** Turning it Off suppresses only the current
   committed save. Selecting a new form or starting a new item resets it to On.
5. **Server-owned notifier capability.** The backend determines whether a form
   has an automatic notifier; the frontend does not maintain a second template
   list.
6. **Channel-accurate label.** The switch label is **Notify employee / إشعار
   الموظف**, not Send SMS, because the dispatcher tries WhatsApp before SMS.
7. **No false delivery claim.** The saved bar says **Notification enabled for
   this save** or **Saved without notifying the employee**. It does not say
   “sent”: dispatch is best-effort and the current job response does not prove
   delivery. Actual attempts remain visible in the record notification log.
8. **Existing approval workflow is reused.** Send for approval opens the current
   manager/reviewer dialog; no second approval implementation is introduced.
9. **One reliable print path.** Every completion surface prints through the
   existing full-record printable canvas.
10. **Save as template is General Book only.** Report never renders it.
11. **No duplicate final-save button.** Moving the committed Save and notification
    choice above the preview removes the old committed-save footer action. Add
    to email basket remains a separate secondary action after save.

## User experience

### Generated form: preview ready

After the preview job reaches `done`, the top handoff area shows:

- **Ready to save to Records**;
- for notifier-backed forms with global auto-send enabled:
  - **Notify employee**;
  - “WhatsApp, then SMS fallback” explanatory copy;
  - an accessible switch, On by default;
- **Save to Records** as the primary action.

The switch is hidden when:

- template metadata says the form has no automatic notifier;
- global `sms_autosend_enabled` is Off; or
- the page is revising an existing record, because the backend intentionally
  does not auto-notify revisions.

Preview (`commit=false`) never sends. The switch value matters only when Save to
Records submits `commit=true`.

### Generated form: saved

On successful commit, the same area changes to:

- **Saved to Records**;
- reference number;
- **Notification enabled for this save** when the switch was On, or **Saved
  without notifying the employee** when it was Off;
- Print;
- Send for approval, when permitted and valid for the record state;
- Open record.

The document preview remains visible. Edit fields and New form remain quiet
secondary controls. The toast remains a short confirmation, not the only
handoff surface.

### General Book and Report through Word

Before Finish, `WordHandoffDialog` keeps its current Word-specific behavior:
Open in Word, first-save detection, live preview, Finish, and Discard.

After Finish succeeds and returns `BookRead`, the final-PDF view gains the same
Saved actions above the paper.

- General Book: Save as template stays as a quiet secondary action below the
  preview.
- Report: Save as template is absent.
- A reopened Word session receives the same finish treatment.

General Book and Report do not show Notify employee unless backend template
metadata later marks their template as automatically notifying.

### Duty Locations transfer

When `/duty/transfer` returns a `book_id` and reference:

- the transfer dialog closes;
- the employee selection clears as today;
- a page-level completion bar persists below the Duty Locations heading;
- the bar shows the transfer result, reference, Print, Send for approval, and
  Open record.

If the transfer succeeds without a book, keep the existing informational toast
and do not render document actions.

### Responsive behavior

Desktop order:

1. status/reference;
2. Print;
3. Send for approval, navy primary;
4. Open record.

Phone before save:

1. status;
2. full-width notification row;
3. full-width Save to Records.

Phone after save:

1. status/reference and notification choice summary;
2. full-width Send for approval;
3. Print and Open record side by side.

All spacing uses logical properties. The switch thumb mirrors in RTL. All
buttons remain real `button`/`a` controls with visible focus rings. The switch
uses `role="switch"`, `aria-checked`, and an accessible label.

## Architecture

### Backend notifier capability

Create one backend source of truth for document templates that can auto-notify.
It must include:

- every key in `notify_format.TEMPLATE_EVENTS`; and
- Leave Application Form;
- Administrative Leave Form;
- Duty Resumption Form;
- Violation Form.

The source may be a constant or predicate in `notify_format`, but both template
metadata and notifier tests must consume it. `auto_send_for_book()` keeps its
special record-routing logic; this capability only answers whether a template
can notify.

Add `notifies_employee: bool` to `template_service.TemplateMeta`. The value is
computed from the backend capability source and returned by both template list
and detail endpoints. Remove `SMS_FORMS` and derive frontend visibility from
`selectedMeta.notifies_employee`.

This changes the FastAPI contract. Regenerate and commit
`backend/openapi.json` and `frontend/src/lib/api.types.ts` together using the
project `sync-api-types` workflow.

### Completed generation identity

Post-save actions require the new `book_id`. The generation service already has
`result.book_id`, but the job response drops it and the frontend later resolves
by reference.

Add nullable `book_id` to the job registry result and `JobStatusResponse`:

- committed new document: new book ID;
- committed revision: existing book ID;
- preview: null;
- failed/incomplete job: null.

`ApplicationPage.lastSaved` becomes the single saved-result shape containing at
least `bookId`, `docId`, and `ref`. Email-basket addition reuses this `bookId`
instead of making a second `getBookByRef` request.

This is also part of the generated API contract sync above.

### Shared post-save action surface

Add one focused frontend component, `SavedRecordActions`, with this contract:

- `bookId: number`;
- `refNumber: string`;
- optional result detail text;
- optional notification choice summary.

The component:

- fetches/reuses the book-detail query for current approval state and PDF
  availability;
- reads `books.manage` capability;
- shows Print and Open record;
- shows Send for approval only for a draft (`approval_state === "none"`) when
  `canSendForApproval` permits it;
- owns the `SubmitForApprovalDialog` open state;
- reflects the refetched pending state after submission.

It is rendered by:

- `ApplicationPage` after a committed generation;
- `WordHandoffDialog` after Finish;
- `DutyLocationsPage` after a transfer result with a book.

Pre-save notification selection remains the existing
`NotifyEmployeeToggle`, repositioned into the top handoff area. Do not create a
second switch component.

### Duty transfer result propagation

Change `TransferDialog.onTransferred` to pass the successful transfer result to
its parent. `DutyLocationsPage` stores the latest document-producing result for
the persistent completion bar. A later successful transfer replaces it.

### Report template eligibility

In the finished Word view, derive the latest version. Render Save as template
only when `latest.template_id === "General Book"`. Do not use the originating
page or subject as a proxy: `WordHandoffDialog` is also opened for sessions
reopened from Records, and the finished version is authoritative.

## Print behavior

The existing record page and `.print-paper` stylesheet are the canonical print
surface. Completion actions must not duplicate print CSS inside each source
page or Radix portal.

Print performs this sequence:

1. from the user click, open `/books/{bookId}?print=1` in a new app tab/window;
2. load the full record and its current PDF;
3. wait for `DocPdfCanvas` to report `ready` through a new optional `onReady`
   callback;
4. invoke `window.print()` once;
5. remove the one-shot print query from the URL so refresh does not print again.

If a new window is blocked, navigate the current page to the same print route as
a fallback. If no printable PDF exists or rendering fails, do not open a blank
print dialog; keep the record page visible with its existing PDF/DOCX fallback.

## Approval behavior

Send for approval opens the existing `SubmitForApprovalDialog` for `bookId`.
The existing dialog remains responsible for:

- manager selection/default;
- reviewer selection;
- priority;
- no-signature warning;
- submission and query invalidation;
- error messages.

After successful submission, the invalidated book-detail query changes the
record state to `pending`; the completion surface replaces the action with the
pending status rather than leaving a re-submit-looking control.

The action is absent when the user lacks `books.manage`, when
`canSendForApproval()` rejects the state, or when the record is already
`pending`. The full record screen may still offer its existing pending-request
reroute action; the completion surface deliberately shows status instead of a
re-submit-looking control. Print and Open record remain available.

## State and reset rules

- New template selection: notification switch resets On; saved result clears.
- New form: notification switch resets On; saved result clears.
- Return to Services gallery: saved result clears.
- Preview regeneration before commit: notification choice remains as selected
  for that form.
- Successful commit: saved result persists and the notification control becomes
  a summary, not an editable post-send switch.
- Revision: no auto-notification control; existing backend no-notify behavior is
  preserved.
- Word Finish: returned `BookRead` becomes the saved result for the dialog.
- Word Discard: no completion actions.
- Duty transfer without book: no completion actions.

## Error handling

- Generation/Word Finish/transfer errors keep their current error surfaces; no
  completion bar appears before a book exists.
- A saved document remains shown as saved even if best-effort notification
  delivery fails. Delivery status is not inferred from the switch.
- Approval errors stay in the existing approval dialog; the saved bar remains.
- Print render failure stays on the full record page with its existing PDF
  unavailable/DOCX fallback.
- Book-detail refetch failure does not erase the saved reference. Open record
  remains available; state-dependent approval is withheld until state is known.

## Accessibility and bilingual requirements

- English and Arabic strings ship together.
- Use logical CSS properties and verify LTR/RTL at the same viewport.
- The notification switch is keyboard reachable and exposes current state to
  assistive technology.
- Every icon is paired with visible text; decorative icons are `aria-hidden`.
- Status is communicated by text and icon, never color alone.
- Focus order follows visual order on desktop and phone.
- Motion is limited to existing calm transitions and obeys reduced motion.
- After UI string/layout changes, run the project `i18n-rtl-reviewer`.
- Because notification controls/copy change, run the
  `notification-template-reviewer`; outbound template text itself must remain
  unchanged.

## Verification contract

### Backend tests

1. Template metadata reports `notifies_employee=true` for every
   `TEMPLATE_EVENTS` key and for the four special routed templates.
2. Representative non-notifying templates, including General Book and Report,
   report false.
3. A consistency test prevents a newly added auto-notifier route from missing
   metadata coverage.
4. `commit=true, notify_employee=false` suppresses
   `auto_send_for_book()` for both a mapped book event and a special routed form.
5. Default/explicit true preserves auto-send for those paths when global
   auto-send is enabled.
6. Job completion returns `book_id`; preview returns null.

### Frontend tests

1. Notify employee renders only when metadata is true, global auto-send is On,
   and the action is not a revision.
2. Switch defaults On and resets On for a new form/template.
3. Switching Off sends `notify_employee:false` on committed save.
4. Preview never commits or triggers notification.
5. Saved generated result renders ref, notification choice summary, and all
   permitted actions from returned `book_id`.
6. `SavedRecordActions` gates approval by capability/state and opens the current
   dialog.
7. Word finished view renders shared actions; Save as template appears for
   General Book and not Report.
8. Duty transfer passes the successful result to the persistent page bar and
   omits it for no-book outcomes.
9. Print mode triggers only after PDF canvas readiness and only once.

### End-to-end smoke checks

- Save one notifier-backed form with the switch On; confirm the committed
  record and an outbound-message attempt/log.
- Save another with the switch Off; confirm the committed record and no outbound
  message for that save.
- Exercise one of the previously uncovered special forms.
- Print a generated form from its completion bar and inspect the A4 output.
- Submit the new record for approval and confirm the bar reflects pending state.
- Finish a General Book and a Report in Word; verify equal post-save actions and
  Report has no Save as template.
- Complete a Duty transfer and use all three actions.
- Repeat the visual paths in English/LTR and Arabic/RTL on desktop and phone,
  light and dark.

## Expected affected areas

- `backend/app/services/notify_format.py`
- `backend/app/services/notify_dispatch.py` tests/consistency coverage
- `backend/app/services/template_service.py`
- `backend/app/services/job_registry.py`
- `backend/app/api/v1/documents.py`
- `backend/openapi.json`
- `frontend/src/lib/api.types.ts`
- `frontend/src/pages/application/ApplicationPage.tsx`
- `frontend/src/pages/application/notifyToggle.ts` (remove or reduce to a
  metadata/global/revision predicate)
- `frontend/src/pages/application/DocPdfCanvas.tsx`
- `frontend/src/pages/books/BookRecordPage.tsx`
- `frontend/src/pages/books/WordHandoffDialog.tsx`
- `frontend/src/pages/dutyLocations/TransferDialog.tsx`
- `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx`
- one shared record-action component under `frontend/src/components/books/`
- `frontend/src/locales/en.json`
- `frontend/src/locales/ar.json`
- focused backend/frontend tests for the contracts above

No dependency, migration, or outbound-template change is required.
