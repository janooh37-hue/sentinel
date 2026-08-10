# Approved inmate-violation upload

**Date:** 2026-08-10  
**Status:** Design approved  
**Branch:** `feature/inmate-approved-upload`

## Goal

Allow staff to open **Services → Inmate Conduct Violations**, upload a finalized
approved report, and file it directly under **Records → Inmate Conduct
Violations** without recreating the report or sending it through approval.

The app must allocate the next NAT reference, stamp that reference and the
existing Aztec code onto the uploaded paper, and create a normal versioned,
approved Records entry. The uploaded report concerns inmates, not a staff
employee, so this workflow must not create an employee `Violation` row.

## Approved product decisions

1. The current **Create form** path remains unchanged and remains the default.
2. **Upload approved copy** is a second path inside the existing Inmate Conduct
   Violations service, not a generic Records dialog or Scan-drawer action.
3. Accepted sources are PDF, PNG, JPEG, and JPG, up to the existing 25 MiB book
   attachment limit.
4. OCR assists metadata entry but never silently decides authoritative values.
   Staff review and can correct extracted values before filing.
5. The app allocates a new NAT reference on final save and stamps both the
   human-readable reference and the standard Aztec code on page 1.
6. A successfully imported record starts in `approved` state. No approval
   request, approver step, or employee notification is created.
7. The version's template ID is exactly `Inmate Conduct Violations`; this is the
   authoritative Records service classification.
8. The approved PDF is the legal artifact. Staff do not re-enter the violation
   narrative, actions, reporter, or manager merely to file it.
9. PDF-only documents are represented honestly. `Document.docx_path` becomes
   nullable; the system must not store PDF bytes under a fake DOCX path.

## Scope

### Included

- A Create/Upload mode choice on the Inmate Conduct Violations service page.
- File selection and first-page preview for PDF and supported images.
- OCR-assisted extraction of the report date and inmate names.
- Editable confirmation of report date, inmate names, and record subject.
- User-scoped temporary staging with expiry.
- Image-to-PDF conversion using the existing PyMuPDF dependency.
- NAT reference allocation and first-page reference/Aztec stamping.
- Atomic creation of the `Document`, `Book`, and first `BookVersion`.
- Approved-state and uploader audit attribution.
- Correspondence-log filing.
- Records search indexing from confirmed metadata and extracted text.
- Existing signed-copy replace/unfile behavior adapted so refiling or replacing
  an approved-upload copy reapplies the record's existing reference stamp.
- English and Arabic strings, LTR/RTL parity, desktop and phone layouts.
- FastAPI/OpenAPI and generated TypeScript contract updates.
- One SQLite-safe migration making `documents.docx_path` nullable.

### Excluded

- Creating an employee violation-history row.
- Replacing the current generated Inmate Conduct Violations form.
- Generic approved-document import for other services.
- Automatic approval of an unsigned document.
- Full OCR reconstruction of the form's violation narrative, actions, reporter,
  or manager.
- Editing the uploaded paper in Word.
- Notification delivery.
- Automatic classification of arbitrary documents from the global Scan drawer.

## User experience

### Mode choice

After staff select **Inmate Conduct Violations**, the detail surface presents two
peer actions:

- **Create form** — the existing fields, preview, and save workflow;
- **Upload approved copy** — the new finalized-document workflow.

Create form is selected by default. Switching modes clears only transient state
owned by the other mode; it does not alter saved Records entries.

### Inspect an approved copy

Upload mode contains one accessible dropzone/file button. It accepts one PDF,
PNG, JPEG, or JPG. The UI states the 25 MiB limit and that the document must
already be approved.

Selecting a file starts inspection and shows a determinate busy state. On
success, the page shows:

- the selected filename and size;
- a first-page preview using a client object URL, so preview does not need a
  second download endpoint;
- **Report date**, required and OCR-prefilled when found;
- **Inmate names**, OCR-prefilled as editable rows;
- **Record subject**, required and defaulted to
  `Inmate Conduct Violations — <inmate names>` when names were found, otherwise
  `Inmate Conduct Violations`;
- extraction warnings beside uncertain or missing values; and
- a notice: **This copy will be filed as approved. No approval request will be
  sent.**

OCR is optional assistance. Inspection may return no date or names without
blocking the workflow; the operator supplies the required report date and may
correct or add inmate names. The subject remains editable.

### Save

**Save approved record** stays disabled while inspection is pending, the staged
file is unavailable, report date is empty, the subject is empty, or a commit is
already running.

On save, the backend consumes the staged token and confirmed metadata. Success
replaces the form controls with the standard durable completion handoff:

- **Saved to Records**;
- the new NAT reference;
- **Approved copy filed**;
- Print;
- Open record; and
- New upload.

There is no Send for approval action in this completion state because the copy
is already approved.

### Responsive and accessible behavior

Desktop may place the preview beside the metadata form. Phone stacks preview,
metadata, notice, and the full-width primary action in that order. No horizontal
scroll is required.

All fields have associated labels and inline errors. The dropzone is keyboard
operable, the preview has an accessible filename description, focus moves to the
first validation error, and the success heading receives focus after filing.
Logical spacing/alignment utilities are mandatory. Arabic labels and reading
order are peers, not fallbacks to English.

## Backend architecture

### Inspection endpoint

Add a dedicated route under the documents API:

`POST /api/v1/documents/inmate-violations/approved-imports/inspect`

The multipart request contains `file`. The route requires
`documents.generate`, enforces the existing 25 MiB limit, and validates content
by magic bytes and successful parsing rather than trusting MIME type or
filename.

The response contains:

- an opaque staged token;
- source filename and size;
- extracted report date, when found;
- extracted inmate-name candidates with confidence;
- a proposed subject;
- warnings; and
- an expiry timestamp.

PDF inspection first uses its embedded text layer, then OCRs rendered page
images only when usable text is absent. Image inspection uses the existing OCR
gate. A focused inmate-report parser recognizes the known official form's date
and inmate table. It returns partial results rather than inventing values.

The staged original and a small metadata sidecar live under a dedicated
`data/staged_approved_imports/` area. The sidecar records the uploading user,
original filename, detected type, extracted text, creation time, and expiry.
Commit verifies token ownership. Expired staging is removed by the same TTL
cleanup pattern used for other staged uploads.

### Commit endpoint

Add:

`POST /api/v1/documents/inmate-violations/approved-imports`

The JSON request contains:

- staged token;
- confirmed `report_date`;
- confirmed `inmate_names`;
- confirmed `subject`.

The route requires `documents.generate`. It rejects missing, expired, consumed,
or differently-owned tokens and validates the confirmed fields server-side.

The service then:

1. begins the serialized reference-allocation transaction;
2. allocates the next reference in category `NAT`;
3. converts an image source to a real PDF, or validates/copies a PDF source;
4. preserves an unstamped normalized original for signed-copy unfile behavior;
5. creates a stamped PDF copy;
6. writes the human-readable reference in the same page-1 header position used
   by the generated Inmate Conduct Violations form;
7. writes the standard Aztec code in that form's existing top-right position;
8. creates and flushes the persistence rows described below;
9. adds the audit and correspondence-log rows;
10. commits; and
11. consumes the staged original after the durable commit.

Reference or Aztec stamping is required for this workflow. Unlike best-effort
DOCX decoration, a stamp failure aborts the import because the user explicitly
asked the app to allocate and stamp the official record reference.

### Persistence contract

Create one `Document`:

- `employee_id = null`;
- `template_id = "Inmate Conduct Violations"`;
- allocated NAT `ref_number`;
- `docx_path = null`;
- `pdf_path` pointing to the normalized, unstamped original;
- ordinary primary role and submission identity.

Create one `Book`:

- `category_id = "NAT"`;
- the same allocated reference;
- confirmed subject;
- `direction = "outgoing"`;
- standard header stamp style;
- no employee link;
- `approval_state = "approved"`;
- `doc_path` pointing to the stamped approved PDF;
- `created_at` as the filing timestamp; and
- `search_text` containing the reference, subject, confirmed date/names, and
  extracted text.

Create version 1:

- linked to the new Document;
- `template_id = "Inmate Conduct Violations"`;
- `trigger = "approved-upload"`;
- `status = "approved"`;
- `created_by_user_id` set to the uploader;
- `signed_pdf_path` pointing to the stamped PDF;
- `signed_by_user_id` set to the uploader who filed the physical approval;
- `signed_at` set to the filing timestamp;
- `manager_sig_embedded = false`; and
- `fields` containing `source = "approved_upload"`, confirmed `report_date`,
  confirmed inmate names, and the source filename.

No `Violation` ORM row is created and `Document.violation_id` remains null.
`BookVersion.template_id` makes the entry appear in the existing Inmate Conduct
Violations Records rail without a second classification convention.

### Signed-copy controls

The normalized original and stamped signed copy are distinct files. Existing
unfile behavior may return the record to its unsigned/original state without
losing the source document.

When a version carries `fields.source == "approved_upload"`:

- filing a replacement signed copy converts it to PDF when needed and stamps the
  existing book reference and Aztec code before approval;
- replacing the current signed copy does the same; and
- audit behavior remains the existing signed-copy audit behavior.

This preserves the invariant that every approved artifact filed through this
workflow displays the record reference.

### Nullable DOCX migration

Add the next sequential Alembic revision using `batch_alter_table` to make
`documents.docx_path` nullable. No backfill is required because existing rows
already contain paths. The downgrade restores non-nullability only after
verifying or rejecting rows whose path is null; the migration must remain
reversible and SQLite-safe.

Update the ORM annotation, `DocumentRead`, and every download path:

- PDF and signed downloads continue to work when DOCX is absent;
- a DOCX request for a PDF-only document returns a precise
  `DOCX_NOT_AVAILABLE` response;
- generated documents retain current behavior; and
- original-PDF access remains available to authorized Records viewers.

## Reference stamping

Use PyMuPDF for the finalized PDF, not Word COM. Stamp page 1 only.

- Human-readable text: `Ref: <reference>`, matching the existing header stamp's
  typography, color, and logical position.
- Machine-readable mark: the existing `make_aztec_png(reference)` output, using
  the Inmate Conduct Violations top-right corner and current physical size.
- Preserve all source pages, page dimensions, rotations, text layers, and image
  quality outside the two overlays.
- Tests decode or otherwise verify the Aztec payload; a mere non-empty image
  assertion is insufficient.

## File and transaction safety

- Empty, oversized, unsupported, encrypted/unreadable, or corrupt sources fail
  before reference allocation.
- Filenames are sanitized and never determine content type or final paths.
- Every resolved path must remain under the configured data directory.
- Final filenames are version-scoped and collision-safe.
- Commit uses temporary output names. If conversion, stamping, row creation, or
  database commit fails, remove new output files and leave the staged source for
  retry until expiry.
- The staged token is consumed once. Concurrent or repeated commits cannot
  create duplicate Records entries.
- Deleting the staged source happens only after database commit. A failed
  post-commit deletion is left for TTL cleanup and does not invalidate the
  saved record.
- Raw OCR text is stored only in the existing protected Records search corpus;
  it is not returned by normal list APIs or logged.

## API and frontend integration

Add generated request/response schemas for inspection and commit. Regenerate
`backend/openapi.json` and `frontend/src/lib/api.types.ts` using the project
`sync-api-types` workflow; do not hand-maintain parallel TypeScript interfaces.

In `ApplicationPage`, isolate the new state in a focused approved-upload
component rather than adding more form-generation branches to `TemplateForm`.
The parent owns only the mode and successful saved-result handoff. The component
owns the selected file object URL, staged token, extracted values, corrections,
inspection state, and commit state.

Reuse the existing file-drop, PDF/image preview, API-error, toast, and saved
record action patterns where their contracts fit. Do not change attachment
behavior for ordinary generated forms.

## Error behavior

- Unsupported type: state accepted formats.
- File too large: state the 25 MiB limit.
- Unreadable source: ask for a valid PDF, PNG, or JPEG.
- OCR unavailable: keep the staged file and allow manual metadata entry; OCR
  failure alone is not an import failure.
- Missing/uncertain extraction: leave editable values empty or marked for
  review; never guess.
- Expired token: keep the local selected file and offer one-click re-inspection.
- Stamp or save failure: preserve confirmed metadata in the UI and allow retry;
  show no success handoff and create no record.
- Authentication/authorization failure: discard exposed staged state from the
  UI and use the normal session handling.

All user-facing errors ship in English and Arabic and identify the corrective
action.

## Verification

### Backend tests

- Inspect a born-digital PDF and extract report date/inmate names.
- Inspect an image and use the OCR path.
- Return partial metadata when extraction is uncertain.
- Reject empty, oversized, unsupported, corrupt, or unreadable files.
- Enforce token ownership, expiry, and one-time consumption.
- Import PDF, PNG, and JPEG sources as real PDFs.
- Allocate one NAT reference and use it on Book, Document, and PDF stamp.
- Verify human-readable reference placement and decode/verify the Aztec payload.
- Create one approved Book and one approved version with the expected template
  ID, metadata, uploader, and signed artifact.
- Create no employee Violation row.
- Classify the record under the Inmate Conduct Violations service.
- Index confirmed metadata and OCR text without exposing raw OCR in list output.
- Roll back rows and output files on conversion, stamping, and commit failures.
- Restamp approved-upload replacements with the existing reference.
- Return `DOCX_NOT_AVAILABLE` only for PDF-only documents; generated-document
  downloads remain unchanged.
- Migration upgrade/downgrade and exactly one Alembic head.

### Frontend tests

- Create form remains the default and its existing tests remain unchanged.
- Upload mode accepts the three supported formats and rejects other selections.
- Inspection renders preview and extracted metadata.
- Staff can correct date, inmate names, and subject.
- Required fields and pending state gate Save approved record.
- Commit sends the staged token and confirmed values exactly once.
- Success shows the reference and Open record action without Send for approval.
- Inspection/commit errors preserve correctable state.
- English and Arabic labels are explicit assertions.
- Phone layout has no horizontal overflow; controls remain keyboard reachable.

### End-to-end smoke test

In a running app, for both English/LTR and Arabic/RTL:

1. open Services → Inmate Conduct Violations;
2. switch to Upload approved copy;
3. inspect and correct a sample PDF;
4. save it;
5. open Records → Inmate Conduct Violations;
6. verify the new reference and approved status;
7. preview/print the stamped PDF and verify reference plus Aztec code;
8. repeat with an image source; and
9. repeat the layout check at a phone viewport.

Run the project `i18n-rtl-reviewer`, `alembic-migration-reviewer`, and
`sync-api-types` workflows before completion.

## Acceptance criteria

1. Staff can file a PDF or scan image directly from the Inmate Conduct
   Violations service without completing the generated form.
2. The app captures every piece of metadata required by Records: OCR prefills
   the report date, inmate names, and searchable subject for staff confirmation;
   the system supplies service identity, artifact links, filing user, and
   approval state.
3. The final approved PDF visibly carries the newly allocated NAT reference and
   valid Aztec payload on page 1.
4. Exactly one approved, versioned entry appears under Records → Inmate Conduct
   Violations and opens/prints normally.
5. No employee Violation row or approval request is created.
6. Failed or duplicate submissions create neither partial records nor duplicate
   references.
7. Existing generated inmate reports and all other service workflows behave as
   before.
8. English/Arabic, LTR/RTL, desktop/phone, API types, and SQLite migration checks
   pass with the required review evidence.
