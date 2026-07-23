# Report authored in Word (remove HugeRTE) — design

**Date:** 2026-07-23
**Status:** approved-pending-review

## Goal

Make the **Report** (تقرير) document body authored in **real Word**, the same way
the General Book is (Word-only since M5), instead of the in-browser HugeRTE editor.
The Report keeps its distinguishing traits: no classification, no register ref
(`REPORT-{id}`), a full-roster **employee signer**, footer = signed-in account,
optional signature. HugeRTE is removed from the Report entirely.

## Decisions (locked with operator, 2026-07-23)

1. **Word-only** — remove the HugeRTE rich editor from the Report; no fallback toggle.
2. **Signature embedded at Finish** — after the body is written in Word, stamp the
   signer's signature into the authored docx (not baked at create). More robust:
   the operator can't disturb the signature while editing in Word.
3. **Same rails as the General Book** — Report reuses the existing Word-session
   endpoints (`POST /books/word-sessions`, `POST /books/{id}/word-sessions/finish`,
   `DELETE /books/{id}/word-sessions`, `GET /books/{id}/word-sessions/preview`) and
   the existing `WordHandoffDialog`, extended minimally for the Report case. The
   old one-shot `POST /books/reports` + `report_service.create_report` (HugeRTE
   `body_html` path) are **removed**.

## Flow

```
Web form (Report): Signer* · To (recipient) · Subject* · Date* · [x] Sign now
   │  "Create & open in Word →"   (api.createWordBook, report payload)
   ▼
POST /books/word-sessions  →  report branch:
   • Book(ref=REPORT-{id}, classification_code=NULL, category=GS, approval_state=approved)
   • render report.docx: author block = picked employee name/title (embed=False,
     NO signature yet), footer=account, recipient/subject/date filled, BODY EMPTY
   • NO Aztec / ref stamp
   • BookEditSession(active) carrying signer_employee_id + sign_on_finish
   • → WordSessionRead (ms-word: url)
   ▼
WordHandoffDialog (reused): Open in Word → type the body → live preview → Finish
   │  POST /books/{id}/word-sessions/finish
   ▼
finish_word_session → report branch (session has signer_employee_id):
   • move docx → stable, convert PDF
   • Document + BookVersion(template_id="Report", fields={signer_employee_id, signed})
   • if sign_on_finish: resolve signer's Submitter.stored_sig_path →
     document_service.render_signed_pdf(version, sig_path, signer_names=[name_ar,name_en])
     → signed_pdf_path, manager_sig_embedded=True
   • → BookRead → navigate to /books?ref=REPORT-{id}
```

Abandoning in Word → `DELETE /books/{id}/word-sessions` (existing discard) voids the
Report because it has no committed version. WebDAV serving and live preview are
reused unchanged (session-keyed, template-agnostic).

## Backend changes

### Schema — `WordBookCreate`
Add two Report-only optional fields (General Book payload unaffected):
- `signer_employee_id: str | None = None` — present ⇒ this is a Report.
- `sign: bool = True` — embed the signer's signature at Finish.

`classification_code` is already `str | None`; the Report path passes `None`.

### Endpoint — `POST /books/word-sessions` (`create_word_session`)
Dispatch on `signer_employee_id`:
- **present → Report:** `word_book_service.create_report_word_book(...)` (new).
- **absent → General Book:** existing `create_word_book(...)` unchanged.

`create_report_word_book` mirrors `create_word_book` MINUS classification/ref
allocation and Aztec/ref stamp:
- `ref = f"REPORT-{book.id}"`, `classification_code=None`, `approval_state="approved"`.
- template = `report.docx` (`_TEMPLATE_ID="Report"`), not the General Book paper.
- author block via `manager_override.apply({name/title from the picked Employee},
  embed=False)` (tokens `manager_name`/`manager_title`/`manager_sig` in report.docx),
  `submitter_g = user.employee_id` (footer=account), `body` sentinel + empty `body_html`.
- `BookEditSession(signer_employee_id=..., sign_on_finish=sign, ...)`.
- **created_at:** local `datetime.now()` on Book/BookVersion/Document (the QA fix —
  Word path must not regress to UTC).

### Endpoint — `POST /books/{id}/word-sessions/finish` (`finish_word_session`)
Detect a Report by the durable `book.ref_number.startswith("REPORT-")` (survives
across sessions, unlike the per-session field). For a Report:
- `version.template_id = "Report"` (keeps the Report badge + discriminator) and
  `fields = {"signer_employee_id": ..., "signed": embedded}` — instead of General
  Book's `template_id="General Book"`, `fields={}`.
- if the finishing session carries `sign_on_finish` and `signer_employee_id`: resolve
  the signer's `Submitter.stored_sig_path` (`report_service._resolve_signer` logic),
  then `document_service.render_signed_pdf(version, signer_signature_path, signer_names=
  [emp.name_ar, emp.name_en])` — the same name-anchored stamp `book_service.sign_book`
  uses for word-authored docs — → `signed_pdf_path`, `signed_by_user_id=user.id`,
  `signed_at`, `manager_sig_embedded=True`. No signature on file ⇒ unsigned doc
  (lenient, as today), surfaced by the existing "no signature" behavior.

Preview / discard: **reused unchanged** (session-keyed, template-agnostic).
**Reopen** is NOT exposed for Reports in the UI (no revise flow); the shared
`POST /books/{id}/word-sessions` reopen endpoint still exists, and a reopened
Report's re-finish keeps `template_id="Report"` (ref-prefix detection) but does
not re-embed the signature (the new session has no `signer_employee_id`) — an
accepted limitation of the out-of-scope reopen path.

### Removed
- `POST /books/reports` route and `report_service.create_report` (one-shot HugeRTE
  path) + its test `test_create_report_no_ref_signer_and_footer`. `report_service`
  keeps `_resolve_signer` / `_resolve_recipient` (reused by the Word path).

### Migration
`NNNN_book_edit_session_report_signer`: `op.add_column` on `book_edit_sessions`:
- `signer_employee_id` `String`, nullable.
- `sign_on_finish` `Boolean`, nullable (Report-only; NULL for General Book sessions).

SQLite `ADD COLUMN` is in-place; nullable ⇒ no `server_default` needed. Single
linear head (use `/new-migration`).

## Frontend changes

- `backend/templates/_fields.json` → `Report`: remove the `body` (`arabic_rich_full`)
  field. Report fields become `signer_id`, `recipient_id`, `subject`, `report_date`,
  `sign`. (HugeRTE never mounts for Report.)
- `ApplicationPage.tsx`: replace the `isReportForm` one-shot branch. Report now
  submits via a Word-handoff mutation → `api.createWordBook({ subject, recipient_id,
  signer_employee_id: values.signer_id, sign: values.sign !== false, cc: [] })` →
  set `pendingWordSession` → `WordHandoffDialog` (reused) drives finish/discard.
  Keep Report as its **own** branch (skips the classification picker + template
  library that the General Book Word branch shows).
- Remove `reportMutation` + `api.createReport` + the `ReportCreate` usage.
- Button label: "Create & open in Word →" (reuse `books.word.createAndOpen`),
  Word-blue, like the General Book.
- Resync `openapi.json` → `api.types.ts`.

## Templates

`report.docx` already carries `body` + author-block tokens and is built from the
General Book paper, so the empty-body Word-authoring approach works with no template
change. Verify during implementation that `render_signed_pdf`'s name anchor lands on
the author block (the signer name rendered at create is the anchor).

## Testing

- `create_report_word_book`: Book has `REPORT-` ref, `classification_code is None`,
  active session with `signer_employee_id` + `sign_on_finish`; working docx exists,
  body region empty, author name present, no Aztec stamp.
- `finish` (report session, seeded signer signature): version `template_id=="Report"`,
  `manager_sig_embedded is True`, `signed_pdf_path` set; created_at local (guard).
- `finish` with signer that has no signature: unsigned, `manager_sig_embedded` False,
  no crash.
- `discard` on an unfinished Report voids the book.
- Dispatch: `create_word_session` with no `signer_employee_id` still builds a General
  Book (regression guard — the shared endpoint didn't change GB behavior).
- Frontend: Report form renders no rich editor; submit calls `createWordBook` with
  the signer id (not `createReport`).

## Out of scope (YAGNI)

- No revise flow for Report (reopen rides the shared endpoint for free but isn't a
  targeted deliverable).
- No signature preview in the web form.
- The three earlier QA UX follow-ups (dead Preview tab, header subtitle) are separate;
  the Preview tab naturally disappears since Report no longer uses the tab strip.

## Deploy notes

Backend + frontend + a migration. Ship: `/sync-api-types`, commit, push, then
`mng update` runs the migration (`alembic upgrade head`) + rebuild. See
[[report-template-feature]].
