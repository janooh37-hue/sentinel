# Sick-leave OCR merge + G-number export naming — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## Problem

Two related gaps in the sick-leave flow:

1. When a medical certificate / DOH sick-leave report is scanned and OCR'd, the
   scan is used only to pre-fill the Leave Application form — the scan file itself
   is **discarded**. Salary Transfer, by contrast, merges its uploaded scans
   (IBAN letter, clearance) into the generated form PDF. Sick leave should do the
   same: the OCR'd medical scan should be **merged as an appended page** into the
   sick-leave form PDF.

2. Exported document filenames are `{ref}_{template}.pdf`
   (e.g. `HR-0042_Leave_Application_Form.pdf`). The requirement is to name exports
   by the employee's **G-number** — sick leave gets the **G-number only**
   (`G3082.pdf`), every other document gets **G-number + Arabic form name**
   (`G3082_طلب إجازة سنوية.pdf`).

## Background — how the existing machinery works

- **Attachment slots** are declared per `template_id` in
  `backend/app/core/form_policy.py` (`ATTACHMENT_SLOTS`). Only Salary Transfer
  declares any today.
- Slots surface to the frontend automatically through
  `template_service.get_template_fields()` →
  `TemplateDetailResponse.attachment_slots`. The frontend `AttachmentsBlock`
  renders whatever slots a template exposes.
- Upload flow: client stages a file via `POST /documents/attachments/stage`
  (returns an opaque token) → echoes the token back inside the generate request
  as `{source: "staged", slot_key: "..."}`.
- `document_service.generate_document()` resolves staged specs, copies them under
  `book_attachments/{book_id}/`, records them in `Book.merged_attachment_paths`,
  and appends them into the primary PDF via
  `core/pdf_merge.merge_attachments_into_pdf()` (PyMuPDF). The merged file **is**
  `Document.pdf_path`. `book_service.sign_book()` re-merges so the signed copy
  also carries the attachments.
- Sick-leave forms use the shared `"Leave Application Form"` template (leave type
  is a *field*, not a separate template) and produce a `Document` linked to a
  `Leave` row (`Document.leave_id`).
- OCR sick-leave intake is **read-only classify** today (`POST /intake` →
  `route_kind="leave"`); the frontend navigates to a pre-filled Leave form. The
  ambient Scan Inbox does **not** file the `leave` route
  (`scan_inbox_service._apply_file` handles only `book_attach` / `employee_doc`).

## Design

### Part 1 — Merge the OCR medical scan into the sick-leave form (at generation)

**Backend (`form_policy.py`):** add one **optional** slot to the
`"Leave Application Form"` entry in `ATTACHMENT_SLOTS`:

```python
"Leave Application Form": [
    AttachmentSlot(
        key="medical_certificate",
        label_en="Medical certificate / sick-leave report",
        label_ar="التقرير الطبي / تقرير الإجازة المرضية",
        required=False,
        hint_en="Attach the scanned sick-leave report; it is appended to the form.",
        hint_ar="أرفق تقرير الإجازة المرضية الممسوح؛ يُلحق بالنموذج.",
    ),
],
```

This is the **only** backend change needed for the merge — the existing staging →
merge → re-merge-on-sign pipeline handles the rest with zero new merge code. The
slot is `required=False` so annual/other leave types (same template) can generate
without it.

**Frontend:**
- Gate the `medical_certificate` slot in `AttachmentsBlock` so it renders **only
  when the form's `leave_type` field == `"Sick Leave"`**. (Slots are template-level;
  the leave type is a field value, so the gate is a frontend concern.)
- **Auto-carry from OCR:** when `POST /intake` classifies a scan as `sick_leave`
  and the user is routed to the Leave Application form, stage that same scanned
  file (`POST /documents/attachments/stage`) and pre-populate the
  `medical_certificate` slot with the returned token. The user reviews and
  generates; the scan merges into the PDF. Requires carrying the scanned `File`
  through the intake → form navigation in frontend state.

### Part 2 — Export filenames (`documents.py` `download_document`)

Replace the single `filename = f"{ref}_{template}{ext}"` line with rules applied to
**every** document download (PDF and DOCX):

1. Resolve `g = Document.employee_id`.
2. **Sick leave** — `Document.leave` present and `leave.leave_type == "Sick Leave"`:
   → `filename = f"{g}{ext}"` → `G3082.pdf`.
3. **Any other document with an employee:**
   → `filename = f"{g}_{arabic_name}{ext}"` → `G3082_طلب إجازة سنوية.pdf`,
   where `arabic_name = load_fields_meta().get(template_id, {}).get("name_ar")`
   (fallback to the English `template_id` when empty/missing).
4. **No linked employee** (admin forms, e.g. General Book, `employee_id is None`):
   → `filename = f"{ref}_{arabic_name}{ext}"` (keeps a meaningful name without a
   G-number).

Details:
- **Sanitize** the composed name — reuse a helper mirroring
  `leave_service._safe_filename` (strip path separators / control / bidi chars,
  **keep** Arabic letters).
- Emit the name as RFC 5987 `filename*` UTF-8 in `Content-Disposition` so Arabic
  survives non-UTF-8 clients. `FileResponse(filename=...)` already does this; verify
  the header for Arabic filenames.
- The signed-artifact branch (`locked and signed_rel`) and the base64 preview
  branch keep their current behavior for content; only the download filename
  changes.

## Components touched

| Area | File | Change |
|------|------|--------|
| Slot policy | `backend/app/core/form_policy.py` | Add `medical_certificate` slot to Leave Application Form |
| Export naming | `backend/app/api/v1/documents.py` | New filename rules in `download_document` |
| (read) Arabic name | `backend/app/services/document_service.py` `load_fields_meta` | Source of `name_ar` — no change |
| Slot UI gating | `frontend/src/components/application/AttachmentsBlock.tsx` | Show `medical_certificate` only for Sick Leave |
| Auto-carry | intake → Leave form flow (`ApplicationPage.tsx` + intake nav state) | Stage the OCR scan into the slot |

## Testing (TDD)

**Backend**
- `form_policy.attachment_slots_of("Leave Application Form")` returns the
  `medical_certificate` slot; it is optional.
- Generating a Leave Application Form (leave_type Sick Leave) with a staged
  `medical_certificate` produces a PDF whose page count = form pages + scan pages,
  and records the path in `merged_attachment_paths`.
- `download_document` filename:
  - sick-leave doc → `G3082.pdf`;
  - non-sick doc with employee → `G3082_<arabic>.pdf`;
  - doc with no employee → `{ref}_<arabic>.pdf`;
  - missing `name_ar` → falls back to English template id;
  - DOCX export mirrors the base name with `.docx`.
- Sanitization strips an injected path/control char but preserves Arabic letters.

**Frontend**
- The `medical_certificate` slot renders when leave_type is Sick Leave and is
  hidden for other leave types.
- After an OCR sick-leave intake, the scan is staged and the slot shows it
  pre-attached before generation.

## Out of scope / non-goals

- Wiring the `leave` route into the ambient Scan Inbox `_apply_file` (auto-carry
  lives in the existing intake → form frontend flow, matching salary transfer).
- Changing the leave lifecycle / approval states.
- Retroactively renaming or re-merging already-generated documents.

## Open considerations

- Arabic characters in download filenames are valid via `filename*` but should be
  verified against the primary browsers used on site (Chrome/Edge).
- Duplicate sick-leave exports for one employee collide on `G3082.pdf`; the
  browser/OS de-duplicates (`G3082 (1).pdf`). This is the explicitly requested
  behavior ("G-number only").
