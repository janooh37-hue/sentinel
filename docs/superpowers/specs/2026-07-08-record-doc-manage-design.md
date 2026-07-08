# Manage record documents — view original · delete · replace

**Date:** 2026-07-08
**Status:** Design (approved for planning)
**Area:** Books / Records — document viewing and attachment management

## Problem

When an operator files a scanned copy (or attaches any document) to a record, the
original generated form disappears from view and there is no way to delete or
replace a wrongly-uploaded scan. Concretely:

1. **Original form is hidden after a signed copy is filed.** The generated
   `Document` and its signed copy share **one** `document_id`.
   `GET /documents/{id}/download?format=pdf` *swaps* to serving the signed
   artifact once the version is signed-locked
   (`documents.py` `download_document`, via `is_document_signed_locked`). After a
   scan-back flip sets `version.signed_pdf_path` to the scanned file
   (`book_service.add_attachment`, scan-back branch), that same URL returns the
   **scan**. Both the film-strip "generated" paper (`recordPapers.ts`) and
   `BookRecordPage`'s `pdfUrl` fetch that URL, so both render the scan. The
   original PDF (`Document.pdf_path`) still exists on disk but is unreachable via
   any URL — hence "2 documents shown, but both show the scan; the original is
   hidden."

2. **No delete / replace for scans.** `book_service.detach_attachment` exists but
   is only called internally by scan-inbox undo — it has no API route and no UI,
   and it does not handle a scan filed as the signed copy (which also changed the
   approval state).

## Goals

- Always be able to **view the original generated form**, even after a signed
  copy or attachment is filed.
- **Delete** a wrongly-uploaded scan — both a plain attachment and one filed as
  the signed/approved copy.
- **Replace** a wrongly-uploaded scan in one step — plain attachment or signed
  copy.
- Wire these into every surface that shows a record's documents, with correct
  permissions, confirmation, and EN/AR + RTL parity.

## Non-goals

- No unified "record documents" backend abstraction / refactor of the three
  document sources (deferred; higher risk on the live system).
- No retraction of the original Correspondence Log entry on unfile (a
  compensating event is logged instead — see §5).
- No change to how documents are *generated* or *signed in-app*.

## Background: the three document sources

A record's papers come from three sources with different identities:

| Paper            | Backend source                              | Identity     |
|------------------|---------------------------------------------|--------------|
| Original form    | `Document.pdf_path` via version.document_id | document id  |
| Signed copy      | `BookVersion.signed_pdf_path`               | version      |
| Plain attachment | `Book.attachment_paths[i]`                  | list index   |

The signed copy is served through the **same** `document_id` download URL as the
original (the endpoint swaps in the signed artifact when locked). Plain
attachments are served by index via `GET /books/{id}/attachments/{index}`.

Relevant state machine (`document_service`, `book_service`):

- `signing_path == "scan"` → record enters **`awaiting_scan`** with **no approver
  steps** (the physical scan *is* the signature). Filing any scan flips it to
  `approved`, setting `signed_pdf_path`.
- `as_signed=true` on a `none`/`pending` record → the flip auto-approves every
  pending approver step, stamping `step.decided_at == version.signed_at`, and
  sets `signed_pdf_path`.
- `_recompute_approval_state` derives book/version state from approver steps
  (rejected → returned → all-approved → pending → none).

## Design

### 1. Always view the original form

**Backend** — `GET /documents/{id}/download` gains `original: bool = False`.

- When `original=true`, serve `Document.pdf_path` (the pre-signature generated
  PDF) regardless of signed-lock. `format` is forced to `pdf`; if `pdf_path` is
  `None`, raise `PDF_NOT_AVAILABLE` (404).
- Authorization: `books.view` (a locked record's original must be viewable by
  anyone who can view the record, without `documents.generate`).
- Honours the existing `encoding=base64` branch (in-app viewer path).
- Leaves the default (no param) behaviour untouched: it still swaps to the signed
  artifact when locked.

**Frontend** — `recordPapers.ts`:

- The "Original form" paper (kind `generated`) always fetches
  `/api/v1/documents/{id}/download?format=pdf&original=true`, so it renders the
  real generated form in every state.
- When a signed copy exists (`current.status === 'approved' && signed_pdf_url`),
  add a **separate** "Signed copy" paper (kind `signed`) using the swapped URL
  (no `original` param). Result: *Original form* + *Signed copy* are two distinct,
  correctly-rendering papers — the double-scan bug is gone.
- `paperCountOf` stays consistent with `papersOf`.

`BookRecordPage` keeps its main canvas as the authoritative doc (signed when
signed) and gains an **"Original form"** view/link using `original=true` whenever
a signed copy exists.

### 2. Delete / replace a plain attachment

**Backend** (`books.py` + `book_service`):

- `DELETE /books/{id}/attachments/{index}` — resolve `attachment_paths[index]`,
  call `detach_attachment(rel_path)`; 404 on out-of-range. Returns updated
  `BookRead`. Cap: `books.manage`.
- `PUT /books/{id}/attachments/{index}` (multipart `file`) — new
  `replace_attachment(db, book_id, index, filename, data)`: validate
  (extension/size/non-empty, reusing `add_attachment`'s guards), write the new
  file to a unique dest, swap `attachment_paths[index]` to the new rel path,
  unlink the old file. Index is preserved. Returns updated `BookRead`. Cap:
  `books.manage`.

### 3. Unfile / replace a signed copy

**Replace** — `PUT /books/{id}/signed-copy` (multipart `file`):

- `replace_signed_copy(db, book_id, filename, data, user)`: require the current
  version to have a `signed_pdf_path`; validate; convert image→PDF as
  `add_attachment` does; write a new version-scoped file; update
  `version.signed_pdf_path`, `signed_by_user_id = user.id`, `signed_at = now`;
  unlink the old signed file. **Approval state is unchanged.** Cap:
  `books.manage`. This is the safe, common "wrong signed scan" fix.

**Unfile (delete)** — `DELETE /books/{id}/signed-copy`:

- `unfile_signed_copy(db, book_id)`:
  1. Require `version.signed_pdf_path`; capture `flip_at = version.signed_at`.
  2. Delete the signed file from disk (best-effort unlink).
  3. Clear `signed_pdf_path`, `signed_by_user_id`, `signed_at`.
  4. Revert state:
     - `book.signing_path == "scan"` → set `version.status` and
       `book.approval_state` to **`awaiting_scan`** (no approver steps exist).
     - otherwise → reopen exactly the approver steps with
       `state == "approved" and decided_at == flip_at` (approved → pending,
       clear `decided_at`), leaving earlier human approvals intact, then call
       `_recompute_approval_state` (→ `pending`, or `none` if no steps).
  5. Log a compensating Correspondence event (see §5).
  6. Return updated `BookRead`. Cap: `books.manage`.

### 4. Frontend surfaces & UX

Wire per-paper **Delete** and **Replace** actions, plus the always-present
**Original form** view, into all three surfaces:

- **Film-strip** (`RecordPaperViewer` in `RecordPane`): each `Paper` carries its
  action identity (`kind` + attachment `index` when `kind === 'scan'`). Scan
  papers → attachment delete/replace; the signed paper → unfile/replace-signed.
  Replace opens the same hidden file input, scoped to the target paper.
- **`BookRecordPage`**: Original-form view + delete/replace on the signed copy and
  on each executed-copy row.
- **`BookDetailDrawer`** executed-copy list: delete/replace per row.

All destructive actions use `ConfirmDialog`; all are gated to `books.manage`
(mirroring the existing add-scan gate `canScan = books.manage && documents.scan`
where scan-specific, but management actions use `books.manage`). New UI strings
added to `en.json` + `ar.json` with RTL-safe logical CSS. Run `i18n-rtl-reviewer`
after.

### 5. Audit / Correspondence Log

Unfiling or deleting does **not** retract the original Correspondence Log entry
(it records what genuinely happened). On **unfile of a signed copy**, write a
compensating **`AuditLog`** row (`action="unfile_signed_copy"`, `entity_type="book"`,
payload with `ref_number` + `reverted_to`). Implementation note: the Correspondence
Log (`correspondence_service.log_event`) is rule-gated and its rule triggers are
pattern-restricted to a fixed set, so an arbitrary `book_unsigned` correspondence
event would be a silent no-op — `AuditLog` (the same mechanism `document_service`
uses for `auto_sign_embed`) is the reliable audit trail. Deleting a plain
attachment does not write a compensating event.

### 6. API types sync

Any new/changed Pydantic schema or route requires the `/sync-api-types` flow
(dump `openapi.json`, `pnpm gen:api`, typecheck) and committing `openapi.json` +
`api.types.ts` together. The new endpoints return the existing `BookRead`, so
schema drift is limited to path additions.

## Testing

**Backend (pytest):**

- `download_document` with `original=true` serves the pre-signature `pdf_path`
  even when the version is signed-locked; 404 when `pdf_path` is `None`; still
  honours `encoding=base64`.
- `DELETE`/`PUT /attachments/{index}`: delete removes file + list entry; replace
  swaps bytes and preserves index; out-of-range → 404.
- `replace_signed_copy`: swaps the signed artifact, keeps `approval_state ==
  approved`, image→PDF conversion path.
- `unfile_signed_copy`: scan-path record reverts to `awaiting_scan`; `as_signed`
  record reverts to `pending` with **only** the flip-approved step reopened
  (a pre-existing human approval stays approved); file unlinked; compensating
  correspondence event written.
- Permission gates: all mutating routes require `books.manage`; `original=true`
  requires `books.view`.

**Frontend (vitest):**

- `papersOf` yields distinct Original-form and Signed-copy papers when signed,
  each with the correct URL (`original=true` vs swapped).
- Delete/replace actions call the right endpoint for scan vs signed papers and
  invalidate the record query.

**E2E (optional):** file a signed copy → original still viewable → replace with a
different file → unfile and confirm state reverts.

## Risks

- **Signed-copy revert** is the highest-risk piece on a live production system.
  The `decided_at == flip_at` rule is precise but must be covered by the tests
  above before deploy.
- **Live checkout:** every change must be committed and pushed to `origin/main`
  (see project memory) or the next `mng update` overwrites it.
