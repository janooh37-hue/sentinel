# Record Included Papers — Managed Combined PDF

**Date:** 2026-08-10  
**Status:** Approved
**Area:** Records, generated documents, PDF packaging, record history, Web Push

## 1. Problem

A form may be created before every supporting paper is ready. Today the operator has two incomplete choices:

1. Add the paper during form creation, which merges it into the generated PDF; or
2. Add a scan later in Records, which stores and displays it as a separate film-strip paper.

When a late paper must be distributed as part of one official file, the operator downloads the form and paper, merges them in an external service such as iLovePDF, receives a generic filename such as `ilovepdf_merged.pdf`, and manually renames it. The same workaround is required when a paper was forgotten during form creation.

Records needs a distinct **Included papers** workflow that adds PDF/image sources to the main document package after creation. The normal preview, print, email attachment, and download must use one combined PDF while preserving the existing correct record filename.

## 2. Goals

- Add PDF, PNG, JPG, or JPEG papers to an existing generated record before or after approval.
- Keep the fixed generated or signed form bundle first—including automatic companion pages already supplied by the current document flow—then append included files in an operator-controlled order.
- Preview the complete combined PDF and exact page order before Save.
- Add, remove, replace, and reorder several included files in one atomic editing session.
- Use the combined PDF automatically for the normal preview, print, email, and download paths.
- Preserve the private generated and signed base artifacts so package changes remain reversible.
- Keep the existing export filename rules unchanged.
- Support existing and future v4 generated records.
- Preserve approval state after post-approval changes, record one durable history summary, and send one localized push to all approving managers.
- Provide equivalent desktop, mobile, English, and Arabic/RTL workflows.

## 3. Non-goals

- No page-level splitting or reordering inside an attached PDF. A file and all its pages move together.
- No ability to place included papers before or between pages of the generated/signed form.
- No support for legacy imported records without a reconstructable generated source.
- No change to the separate **Add scan / Scan signed copy** workflow or `Book.attachment_paths` film-strip papers.
- No approval reset, re-approval, or manager acknowledgment requirement after a package edit.
- No notification-bell item, email, SMS, or WhatsApp message for package changes.
- No manager/admin override of creator-only editing.
- No Office-document attachment formats; the existing PDF/image allowlist remains authoritative.

## 4. Approved product decisions

| Decision | Approved behavior |
|---|---|
| Availability | Before and after approval |
| Presentation | One main combined PDF plus a manageable Included papers list; no duplicate film-strip papers |
| Default output | Combined PDF automatically for preview, print, email, and download |
| Surfaces | Records pane and full/mobile record page |
| Editing | Review all pending changes, then Save once; Cancel leaves the record unchanged |
| Order | Fixed generated/signed form bundle first; reorder complete included files after it |
| Existing creation-time papers | Visible and fully editable, including removal |
| Approved-record edits | Approval remains unchanged |
| Notification recipients | All users who approved the current version |
| Notification delivery | Localized Web Push; no bell item |
| Durable in-app copy | Record history |
| Notification content | One summary per Save with actor and added/removed/replaced/reordered changes |
| Editor | User who originally generated the record |
| Historical scope | Existing and future generated records; imports excluded |
| Flattened signed scan | Replace the signed scan with a form-only signed base before editing pages already flattened into it |
| Architecture | Preserved base plus atomically rebuilt managed package |

## 5. Current system boundary

Records already has two distinct attachment stores:

| Store | Current behavior | This feature |
|---|---|---|
| `Book.attachment_paths` | Separate scan papers in the Records film strip | Unchanged |
| `Book.merged_attachment_paths` | Ordered source papers merged destructively during generation | Becomes the ordered Included papers package |

The normal document download endpoint already controls the filename through `document_service.download_filename_for`. Existing consumers—including `RecordPaperViewer`, `BookRecordPage`, printing, the email basket, and direct download—route through the current document URLs. The design keeps those URLs and filename rules stable.

## 6. User experience

### 6.1 Entry points

Only the original record creator sees **Manage included papers**:

- in the Records pane action row; and
- in the full/mobile record page action row.

The backend independently enforces the same ownership rule. Imported, deleted, and voided records do not expose the action.

The existing **Add scan / Scan signed copy** actions remain separate. A user chooses **Manage included papers** only when the paper must become pages in the main PDF.

### 6.2 Desktop workspace

The approved desktop design is a large, focused dialog aligned to the existing Records visual language:

- **Header:** record reference, form title, approval state, final page count, and close action.
- **Preview pane:** the dominant surface, rendering the complete proposed PDF at readable size with zoom, fit-width, full-screen, and grouped page thumbnails.
- **Order pane:** generated/signed form fixed as item 1, followed by numbered included files with filename, type, page count, and final page range.
- **Controls:** Add papers, Replace, Remove, drag reorder, keyboard Move up/Move down, Cancel, and one sticky Save combined PDF action.
- **Approved-record notice:** restrained notice explaining that approval remains unchanged and approving managers will receive one summary.

The preview visibly groups pages by source. Selecting a file in the order pane selects its first preview page; selecting a page highlights its source file.

### 6.3 Mobile workspace

Mobile uses a full-height sheet rather than compressing the two desktop columns. It has two tabs backed by the same unsaved state:

- **Preview:** complete combined PDF and grouped page thumbnails.
- **Order:** included file list, file actions, final summary, and sticky Save.

The sheet preserves focus, returns focus to its trigger when closed, and confirms before discarding a dirty session.

### 6.4 Editing behavior

- Add accepts multiple files and appends them in picker order.
- Replace preserves the file's current order position.
- Remove only updates unsaved state until Save.
- Reordering moves whole files; PDF pages remain together.
- The fixed form bundle, including automatic companion pages, is never movable and remains first.
- Any add, replace, remove, or reorder regenerates the proposed preview using the same server-side package builder used by Save.
- Preview errors remain inside the workspace; pending order and staged files remain available for correction.
- Closing a dirty workspace asks whether to discard changes.
- Successful Save closes the workspace, refreshes both Records surfaces, and immediately shows the published combined PDF.

### 6.5 Accessibility and bilingual behavior

- Dialog/sheet semantics, focus trap, Escape handling, focus restoration, and visible focus rings are required.
- Every reorder operation has labelled Move up/Move down controls; drag-and-drop is never the only method.
- Status is never communicated by color alone.
- Arabic mirrors the control layout using logical CSS. Filenames use `dir="auto"`; record references, page numbers, file sizes, and extensions remain LTR.
- All new strings ship together in `en.json` and `ar.json`.
- Reduced-motion preferences apply to dialog/sheet transitions and reorder feedback.

## 7. Persistence and file architecture

### 7.1 Preserved bases and published outputs

Each current version has separate private bases and published outputs:

- `Document.base_pdf_path`: pristine fixed generated bundle before Included papers (primary form plus automatic companion pages supplied by the current flow).
- Existing `Document.pdf_path`: published generated combined PDF.
- `BookVersion.signed_base_pdf_path`: pristine in-app signed form or uploaded flattened signed scan.
- Existing `BookVersion.signed_pdf_path`: published signed combined PDF.

The normal unsigned/generated and signed URLs continue serving `pdf_path` and `signed_pdf_path`. The private bases are not exposed as user downloads. Existing export naming remains unchanged.

Future generation writes the pristine fixed bundle before producing the combined output. In-app signing writes the canonical signed base before producing its signed combined output. Automatic companion pages are resolved into the fixed bundle before Included papers, never appended after them.

Published combined outputs use immutable, revisioned filenames. Save writes a
new complete output, commits the database pointer to that path, and only then
removes the superseded output best-effort. A failed database commit therefore
leaves the previous pointer and downloadable bytes authoritative; the
unreferenced candidate can be cleaned safely.

### 7.2 Included-paper metadata

`Book.merged_attachment_paths` remains the ordered source of truth but its JSON entries gain stable metadata:

```json
{
  "id": "opaque-stable-id",
  "path": "book_attachments/42/medical-certificate.pdf",
  "original_name": "Medical certificate.pdf",
  "slot_key": "medical_certificate",
  "page_count": 3,
  "added_by_user_id": 7,
  "added_at": "2026-08-10T09:30:00Z"
}
```

- `slot_key` remains nullable for free-form papers.
- Order in the JSON list is final package order.
- Existing `{path, slot_key}` entries receive stable IDs and computed metadata during lazy normalization and are persisted only by a successful Save.
- All entries—including creation-time required-slot entries—are fully editable.

### 7.3 Package revision and flattened-scan boundary

- `Book.included_papers_revision` is a non-null integer incremented on every successful package Save. Preview and Save requests carry the revision they opened; a mismatch returns conflict instead of overwriting a newer package.
- `BookVersion.signed_embedded_paper_ids` records included-paper IDs already flattened into an uploaded physical signed scan.
- Those embedded IDs cannot be removed, replaced, or reordered while that flattened scan remains the base.
- The creator may use **Replace signed base** to upload a corrected, form-only signed PDF/image. A successful replacement clears the embedded-ID snapshot and rebuilds the signed combined output from the current Included papers list.

### 7.4 Existing generated records

No bulk file rewrite runs during migration or deployment.

On the first Included papers preview/save for an existing record:

- If the generated PDF has no baked Included papers, the current canonical form bundle can be copied into the private generated base.
- If it has creation-time merged papers, a pristine fixed bundle is reconstructed from the committed DOCX and the current companion-document resolver before Included papers are applied.
- An existing in-app signed base is re-rendered through the current signature pipeline without appending Included papers.
- An existing flattened physical signed scan is copied as the signed base, and current Included papers are recorded as embedded in that scan.

All reconstruction occurs into temporary files. Save writes new immutable base/output candidates only after every validation and merge succeeds, then publishes them by committing their database paths. Failure leaves current database paths and downloads untouched.

## 8. API and service boundaries

### 8.1 Read model

Detailed record responses expose:

- ordered Included paper metadata;
- current `included_papers_revision`;
- page counts and published page ranges;
- whether the current physical signed base blocks editing an embedded item; and
- filtered package-change history for the record timeline.

List rows keep only the existing paper count behavior; they do not carry file metadata.

### 8.2 Staging

New files and replacements use the existing staged-attachment store:

1. validate extension, non-empty bytes, 25 MiB per-file cap, token shape, and containment;
2. return opaque staged token, original filename, and size;
3. resolve tokens only on preview/save; and
4. leave abandoned files to the existing 24-hour opportunistic cleanup.

### 8.3 Preview endpoint

A record-scoped preview endpoint accepts:

- the opened package revision;
- ordered existing paper IDs;
- staged additions/replacements; and
- removal/reorder state represented by omission/order.

It checks creator ownership, resolves every source, builds a temporary combined PDF from the correct generated or signed base, and returns base64 PDF bytes plus total pages and per-file page ranges. It performs no database mutation.

### 8.4 Save endpoint

A record-scoped Save endpoint accepts the same ordered proposal and package revision. The service:

1. checks generated-record scope, original creator, current version, and revision;
2. validates and resolves every existing/staged source before changing state;
3. copies staged sources into collision-safe `book_attachments/<book_id>/` paths;
4. builds a temporary combined PDF using the same builder as preview;
5. computes the change summary against prior metadata;
6. writes immutable base/output candidates at new revisioned paths;
7. points the document/version to those candidates, persists ordered metadata, increments the revision, and writes one `AuditLog` history event in the same transaction;
8. commits, then removes superseded files best-effort; and
9. sends one localized push to each distinct approving user for the current version.

A repeated request carrying the old revision conflicts, preventing duplicate state changes and duplicate pushes.

### 8.5 Existing download consumers

No new download choice is introduced. The current document URLs automatically serve the published combined output:

For package-managed documents, the builder resolves automatic companion pages
into the fixed base before Included papers. The download handler must therefore
skip its legacy serve-time companion append when a published package path is
present; otherwise companions would appear after Included papers or be
duplicated. Records not yet normalized keep the existing serve-time behavior.

- generated/original preview uses the generated combined PDF;
- signed/default preview uses the signed combined PDF;
- print uses the same URL;
- the email basket attaches the same combined PDF; and
- explicit download uses the same endpoint and existing correct filename.

## 9. Authorization

- The original creator is the `created_by_user_id` on version 1, not the current submitter or last revision author.
- The server requires an authenticated user who can view the book and whose user ID matches that original creator.
- UI visibility is convenience only; both preview and Save repeat the ownership check.
- Records with no known original creator, including unsupported legacy imports, are read-only for this feature.
- Approvers receive notifications but gain no edit permission from having approved.

## 10. Approved-record history and push

Every successful Save writes one `AuditLog` row:

- `action="update_included_papers"`;
- `entity_type="book"`;
- record/book ID;
- actor identity;
- package revision before/after; and
- summarized added, removed, replaced, and reordered names/counts.

The full record timeline renders these filtered events as **Included papers updated** entries. This is the durable in-app history; no notification-bell item is created.

After commit, the service de-duplicates user IDs from approved steps on the current version and sends one localized Web Push per user. The message includes record reference, actor, and a concise summary, with a deep link to the full record. Push delivery failure is logged and does not roll back the package or history event.

## 11. Error handling and atomicity

The prior package remains authoritative unless Save completes.

| Failure | Result |
|---|---|
| Unsupported extension, empty file, oversized file | Reject staging/Save with precise validation message |
| Expired or malformed staged token | Reject preview/Save; ask user to add that file again |
| Unreadable/corrupt image or PDF | Reject preview/Save; identify the failing filename |
| Missing existing source | Reject preview/Save; do not silently omit a requested paper |
| Stale package revision | Return conflict and require reload |
| Flattened signed item edited | Block with Replace signed base instruction |
| Base reconstruction or Word/PDF conversion failure | Keep current paths and package unchanged |
| Merge or candidate-file write failure | Keep current paths and package unchanged; clean candidate files best-effort |
| Database commit failure | Keep the prior database pointers and downloadable bytes; clean unreferenced candidates best-effort |
| Push failure after commit | Keep successful package/history; log delivery failure |

Serve-time package downloads never silently drop configured sources. Missing published output is an error, not a partial PDF.

## 12. Component boundaries

### Backend

- **Package service:** normalize metadata, enforce ownership/revision rules, resolve sources, compute change summaries, and coordinate preview/save.
- **PDF builder:** one pure path-to-bytes/file operation shared by preview and Save; generated/signed base is always first.
- **Document/signing services:** create preserved generated/signed bases and rebuild published outputs when generation/signing occurs.
- **Books API/schema:** record-scoped preview/save endpoints and Included paper/history read models.
- **Push integration:** post-commit notification to approving users.

### Frontend

- **Pure state module:** existing IDs, staged files, replacements, removals, ordering, dirty state, and request serialization.
- **Included papers workspace:** approved desktop dialog/mobile sheet, full preview, ordered list, and error states.
- **Shared hook:** staging, preview, Save, cache invalidation, and stale-revision handling.
- **Records surfaces:** two thin entry points gated by original creator identity.

The existing film-strip mapper/viewer continues handling generated, signed, imported, and separate scan papers; it does not acquire Included-paper management logic.

## 13. Verification

### 13.1 Backend tests

- Creator can preview/save; other viewer, approver, and manager cannot.
- Imported/deleted/voided/creatorless records reject the feature.
- The fixed form bundle, including any automatic companions, remains first and is not duplicated; Included papers follow it.
- Multi-page PDFs retain all pages; PNG/JPG/JPEG become one page.
- Add, remove, replace, and reorder produce exact page counts and order.
- Existing creation-time papers normalize and remain editable.
- Preview and Save use identical builder output/order.
- Correct current filename and `Content-Disposition` remain unchanged for generated and signed downloads.
- Successful Save increments package revision and stale Save conflicts.
- Corrupt/missing/expired inputs and merge/write/commit failures preserve old metadata and downloadable bytes.
- In-app signed records rebuild from their signed base without changing approval state.
- Flattened scan items block until Replace signed base; late papers remain editable.
- Approved Save writes one complete history summary and targets each distinct approving user once.
- Push failure does not roll back package/history.
- Migration upgrade/downgrade is SQLite-safe and leaves exactly one Alembic head.

### 13.2 Frontend tests

- Original creator sees both entry points; non-creator does not.
- Initial state maps existing metadata and page ranges correctly.
- Multi-file add appends in picker order.
- Replace preserves position; Remove is reversible; reorder serializes correctly.
- Dirty close confirms; clean close does not.
- Preview loading/error/retry retains pending state.
- Stale Save prompts reload rather than silently retrying.
- Successful Save closes, invalidates record queries, and displays the refreshed combined PDF.
- Keyboard Move up/Move down and focus restoration work.
- Mobile Preview/Order tabs share one pending state.

### 13.3 End-to-end smoke test

On a scratch database/data directory, never live production data:

1. Create a generated form.
2. Add one multi-page PDF and one image after creation.
3. Reorder and inspect every page in the proposed preview.
4. Save and download; confirm page sequence and existing correct filename.
5. Print and add the record to an email; confirm both use the combined PDF.
6. Approve/sign the record, then add/remove/reorder an Included paper.
7. Confirm approval/signature state remains unchanged, one history entry appears, and all approving users receive the localized push.
8. Repeat on an existing generated record to exercise lazy normalization.
9. Exercise a flattened physical signed scan and confirm embedded-page edits require Replace signed base.
10. Verify English/LTR and Arabic/RTL on desktop and mobile viewports.

### 13.4 Required project reviews

- Regenerate `backend/openapi.json` and `frontend/src/lib/api.types.ts` with the project `sync-api-types` workflow after route/schema changes.
- Run the Alembic migration reviewer and confirm exactly one head.
- Run the i18n/RTL reviewer after UI strings/layout are complete.
- Run the notification-template reviewer after push text is complete.

## 14. Rollout

- Implement and verify in the isolated feature worktree.
- Do not rewrite existing document files during migration/deploy.
- New records immediately create preserved bases.
- Existing records normalize lazily and atomically on first use.
- Validate legacy generated, in-app signed, and physical scan-signed paths against a scratch copy of production data before deployment.
- Deploy only after changes are committed and pushed to `origin/main`, then exercise the live service with a newly created non-sensitive test record.

## 15. Success criteria

The feature is complete when the original creator can open either Records surface, add/review/reorder PDF/images, Save one combined document, and then preview, print, email, and download the same page sequence under the existing correct filename. The workflow must work before and after approval, preserve the original/signed base, keep approval unchanged, record one history summary, notify all approving managers by localized push, reject unsafe or stale edits without data loss, and provide equivalent accessible English/Arabic desktop/mobile behavior.
