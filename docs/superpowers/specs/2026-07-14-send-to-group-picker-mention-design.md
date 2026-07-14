# Send-to-Group: record search+preview picker & employee mention

**Date:** 2026-07-14
**Surface:** `frontend/src/pages/announcements/SendToGroupPage.tsx` (WhatsApp "Send to Group" composer)
**Type:** Frontend-only. No backend, schema, migration, or `api.types.ts` change.

## Problem

The Send-to-Group composer lets an operator attach a record to a WhatsApp group
announcement, but only by typing a bare numeric **record ID** into an
`<input type="number">` — no search, no preview, no validation until the send
round-trips. To find the right ID the operator leaves the app. There is also no
way to reference a *person* in an announcement.

Two upgrades, both requested by the operator:

1. **Record link** — replace the numeric ID box with a **search + preview**
   picker. The outcome is unchanged (the record's PDF is attached to the group
   message); only *how you find the record* changes.
2. **Employee mention** — search an employee and insert their **name +
   G-number (+ optional designation)** as an editable note in the message body,
   for announcements that are about a specific person.

## Why this is frontend-only

Everything the feature needs already exists server-side:

| Need | Existing capability |
|------|--------------------|
| Attach record PDF to group msg | `POST /announcements/send` with `book_id` → `announce_service.resolve_book_pdf` (unchanged) |
| Search records | `GET /books?q=` (`api.listBooks({ q })`) |
| Resolve a book's current PDF doc id | `frontend/src/lib/bookDocument.ts` helper |
| Preview a PDF (WebView2-safe) | `DocPdfCanvas` (pdf.js canvas, `?encoding=base64`) — same pattern scan-inbox uses |
| Search employees | `GET /employees?q=` (`api.listEmployees({ q })`) |
| Deliver the mention | It is plain text inside the existing `text` form field |

No new route, no Pydantic change, so **no `openapi.json` / `api.types.ts`
resync** and **no Alembic migration**.

## Current composer (baseline)

`SendToGroupPage.tsx`:
- Group selection (checkboxes) from `api.listGroups()`.
- Message `<textarea>` (`dir="auto"`), bound to `message` state.
- Attach-mode radio: `book` → `<input type="number">` bound to `bookId`;
  `upload` → `<input type="file">` via `fileRef`.
- Submit builds `FormData`: `group_ids[]`, `text`, `book_id?`, `file?` →
  `api.sendAnnouncement(form)` → `POST /announcements/send`.

Only the `book` sub-control and a new mention control change. Groups, message,
upload mode, and the submit payload are untouched.

## Design

### 1. Record link → `RecordAnnouncePicker` (new component)

A modal dialog that replaces the numeric input inside the existing "attach a
record" radio mode.

- **Trigger:** the numeric input becomes a **"Choose record…" button**. When a
  record is chosen, the button is replaced by a compact **chip** (ref number +
  subject + small PDF thumbnail) with **change / clear** actions.
- **Layout:** left = search + results list; right = preview pane. Responsive:
  stacks on mobile (preview above/below), splits on `md+` — mirrors
  `ScanMatchDialog`'s split.
- **Search:** debounced text field → `api.listBooks({ q, limit })`. Each result
  row shows ref number, subject, and approval status.
- **Preview:** on selecting a result, resolve its current `document_id` via
  `bookDocument.ts` and render the first page with `DocPdfCanvas`
  (`?encoding=base64`, `credentials: 'same-origin'`). Reuse
  `DocumentViewerDialog` for an optional full-screen view (not required for v1).
- **No-document state:** if the selected record has no resolvable PDF (the case
  that makes the backend raise `BookPdfError`), show an explicit "no document to
  attach" message and **disable Confirm** — we fail in the picker instead of
  after the send.
- **Result:** on Confirm, set the existing `bookId` state to the chosen id. The
  submit payload is byte-for-byte the same (`book_id`).

### 2. Employee mention (new, independent of attach mode)

A lightweight **"Mention employee"** search control near the textarea. It is
independent of the attach-mode radio — an announcement may attach a record AND
mention a person, or mention only.

- **Search:** debounced → `api.listEmployees({ q, limit })`. Results show the
  localized name + G-number (+ position).
- **Insertion:** on pick, insert plain text **at the textarea caret** (append
  with a leading space if there is no caret/selection). Format:
  - designation **off**: `{name} ({G-number})`
  - designation **on**: `{name} ({G-number}), {designation}`
- **Localization of inserted content:** name uses `name_ar` when the UI is in
  Arabic else `name_en` (fall back to whichever exists); designation uses
  `position_ar` / `position_en` the same way. G-number is the employee id.
- **No forced prefix** (no "Regarding:"). The operator places the note inside
  their own sentence and edits freely. It is ordinary message text thereafter.
- **Designation toggle:** a checkbox next to the mention control controls
  whether the designation is appended. Default: off.

### 3. Bilingual / RTL

- All new UI strings added to **both** `frontend/src/locales/en.json` and
  `ar.json` with key parity: picker button/placeholder/empty/no-document states,
  mention control label/placeholder, designation toggle label, chip actions.
- Use logical CSS (`ms-`/`me-`, `text-start`/`text-end`), `dir="auto"` retained
  on the message.
- Run the `i18n-rtl-reviewer` agent on the diff before merge.

### 4. Components & boundaries

- `RecordAnnouncePicker.tsx` — self-contained: props `{ open, onClose,
  onPick(book) }`; owns its search + preview state; depends only on
  `api.listBooks`, `bookDocument.ts`, `DocPdfCanvas`. Testable in isolation.
- Employee mention: a small `EmployeeMentionField.tsx` (search + designation
  toggle) with a single `onInsert(text: string)` callback; the page owns caret
  insertion into the textarea, or the component receives a ref — decided at plan
  time, kept to one seam either way.
- `SendToGroupPage.tsx` — wires the two in; keeps `bookId`, attach-mode,
  submit, and group logic as-is.

### 5. Testing (vitest)

- `RecordAnnouncePicker`: search renders results; selecting shows preview;
  no-document record disables Confirm; Confirm calls `onPick` with the book.
- Employee mention: format with designation off/on; AR vs EN name/designation
  selection; caret insertion and append-fallback.
- Composer integration: choosing a record sets the `book_id` sent in the
  payload; a mention appends to `text`; both together; upload mode and group
  selection unaffected; payload shape unchanged from baseline.

## Scope / non-goals

- **In:** record search+preview picker; employee mention text insertion;
  bilingual strings; the above tests.
- **Out:** attaching a *specific scan/attachment* of a record (main/signed PDF
  only); any backend/schema/migration change; a structured (non-text) mention
  field; changes to upload mode, group selection, or the send payload contract;
  reworking `ReferencePicker` (we lift its search pattern + reuse `DocPdfCanvas`
  rather than bending it — it is an anchored popover using a fragile `<object>`
  embed).

## Risks

- **PDF preview reliability in WebView2** — mitigated by reusing the proven
  `DocPdfCanvas` base64 path (same as scan-inbox / compose), not `<object>`.
- **Caret insertion edge cases** (no focus, RTL text) — covered by the
  append-fallback and a test.
- **Record with no attachable PDF** — surfaced in-picker (disabled Confirm)
  instead of failing at send time.
