# Record Included Papers Implementation Plan

> **For implementation:** Use `skill://executing-plans` in the isolated worktree and execute tasks in order with review checkpoints.
>
> **Spec:** `docs/superpowers/specs/2026-08-10-record-included-papers-design.md`
>
> **Worktree:** `C:/Users/Admin/sentinel-worktrees/record-included-papers`

## Goal

Let the user who originally generated a record manage PDF/image papers as pages of its official PDF package. The fixed generated or signed bundle stays first; included files follow in operator-controlled order. Preview, print, email, and download continue using the existing document URL and filename. Package edits are atomic, reversible, creator-only, approval-preserving, audited once per Save, and followed by one localized Web Push to each distinct approving user.

## Non-negotiable invariants

1. `Book.attachment_paths` and the existing **Add scan / Scan signed copy** film-strip workflow remain unchanged.
2. `Book.merged_attachment_paths` remains the ordered metadata source of truth. Do not introduce a second included-paper table or a second ordering convention.
3. The original creator is `created_by_user_id` on version 1. Submitter, latest revision author, approver, manager, and capability grants do not override ownership.
4. The active fixed base is generated before approval and signed after approval. It is always page 1 onward; included files can move only after it.
5. Preview and Save call the same pure PDF builder. No client-side merge and no independent preview algorithm.
6. Published generated/signed URLs and `download_filename_for()` remain unchanged. A package-aware download never appends companions a second time.
7. Save validates every source and builds complete candidates before changing persisted pointers or metadata. A stale revision, merge failure, write failure, or commit failure leaves the previous package authoritative.
8. Package edits never alter book/version approval state, approval steps, signature attribution, or signed timestamp.
9. New files use the existing `/documents/attachments/stage` endpoint and token containment checks. No client-supplied path is accepted.
10. Physical signed scans may contain pages already represented by included-paper metadata. IDs in `signed_embedded_paper_ids` are locked until the existing signed-copy replacement flow receives a form-only signed base and clears the snapshot.

## API contract to implement

Use generated OpenAPI types for these models; names may follow existing schema naming conventions exactly.

```text
POST /api/v1/books/{book_id}/included-papers/preview
body: {
  revision: number,
  items: [{
    id: string,                 # existing stable ID or client UUID for a staged addition
    staged_token?: string,      # absent = retain existing source; present = add/replace
    original_name?: string      # required with staged_token; basename only
  }]
}
response: {
  revision: number,
  pdf_base64: string,
  fixed_page_count: number,
  total_page_count: number,
  items: IncludedPaperRead[]    # proposal order with exact final ranges
}

PUT /api/v1/books/{book_id}/included-papers
body: same proposal
response: enriched BookRead
```

Detailed `BookRead` adds:

```text
original_creator_user_id: number | null
included_papers_revision: number
included_papers: IncludedPaperRead[]            # detail only; list rows return []
included_papers_history: IncludedPaperEventRead[] # detail only; list rows return []
included_papers_fixed_page_count: number | null
included_papers_total_page_count: number | null
```

`IncludedPaperRead` contains stable ID, original name, slot key, media type, byte size, page count, added-by ID/name, added timestamp, final start/end pages when separable, and `embedded_in_signed_base`. For flattened scan entries, range may be null because the physical scan cannot be split reliably; late non-embedded papers still receive exact ranges after the scan base.

Proposal rules:

- Existing ID without token: retain.
- Existing ID with token/name: replace, preserving ID and position.
- New client UUID with token/name: add.
- Existing ID omitted: remove.
- Array order: final metadata order.
- Duplicate/unknown IDs, duplicate staged tokens, staged additions without token/name, embedded-item changes, and malformed UUIDs: `422`.
- Revision mismatch: `409`, no merge and no push.

## Task 1: Add SQLite-safe package persistence

**Files**

- Modify: `backend/app/db/models.py`
- Create: `backend/app/db/migrations/versions/0068_record_included_papers.py`
- Create: `backend/tests/test_migration_record_included_papers.py`

**Steps**

1. Write a migration test that upgrades a populated 0067-shaped database and asserts:
   - nullable `documents.base_pdf_path`;
   - nullable `book_versions.signed_base_pdf_path`;
   - non-null JSON `book_versions.signed_embedded_paper_ids` with `[]` server default;
   - non-null integer `books.included_papers_revision` with `0` server default;
   - existing `books.merged_attachment_paths` JSON remains unchanged;
   - downgrade removes only these four additions and preserves existing data.
2. Run the test and confirm it fails because revision 0068/fields do not exist.
3. Add matching SQLAlchemy fields:

```python
# Document
base_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)

# Book
included_papers_revision: Mapped[int] = mapped_column(
    Integer, nullable=False, default=0, server_default="0"
)

# BookVersion
signed_base_pdf_path: Mapped[str | None] = mapped_column(Text, nullable=True)
signed_embedded_paper_ids: Mapped[list[str]] = mapped_column(
    JSON, nullable=False, default=list, server_default="[]"
)
```

4. Implement reversible migration 0068 from current head 0067. Use `batch_alter_table` for SQLite. Do not rewrite PDFs or normalize JSON in migration code.
5. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_migration_record_included_papers.py -q
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m alembic -c backend/alembic.ini heads
```

Expected: test passes; exactly one head, `0068_record_included_papers`.

6. Commit this task.

## Task 2: Build one pure fixed-base-first PDF packager

**Files**

- Modify: `backend/app/core/pdf_merge.py`
- Create: `backend/tests/test_included_papers_pdf.py`

**Steps**

1. Write focused tests using generated in-memory PDFs/images:
   - base pages always precede every included source;
   - a three-page PDF stays three ordered pages;
   - PNG/JPG/JPEG each become one page;
   - source array order is exact;
   - page count/ranges match output;
   - corrupt PDF/image identifies the supplied display filename;
   - missing source fails instead of being skipped;
   - input files are not modified.
2. Run the test and confirm the missing builder fails.
3. Add a small immutable result model and pure builder, reusing PyMuPDF and existing conversion logic:

```python
@dataclass(frozen=True)
class PackageBuildResult:
    pdf_bytes: bytes
    fixed_page_count: int
    total_page_count: int
    item_page_counts: tuple[int, ...]

def build_pdf_package(
    fixed_base: Path,
    sources: Sequence[tuple[Path, str]],  # path, display filename
) -> PackageBuildResult: ...
```

4. Do not silently skip absent sources as `merge_pdfs_to_bytes()` currently does for optional companions. Package sources are requested state and must fail closed.
5. Keep the existing companion helper behavior for legacy serve-time paths; change only shared internals where doing so does not alter legacy semantics.
6. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_included_papers_pdf.py -q
```

7. Commit this task.

## Task 3: Implement metadata normalization, ownership, and base selection

**Files**

- Create: `backend/app/services/included_papers_service.py`
- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/services/book_service.py`
- Create: `backend/tests/test_included_papers_service.py`

**Steps**

1. Write service tests for scope and ownership:
   - version-1 creator allowed;
   - later revision author, current submitter, approver, records manager, and ordinary viewer denied;
   - creatorless, imported, deleted, voided, and missing-current-document records denied;
   - current version, not an obsolete version, supplies the active package.
2. Write normalization tests for existing `{path, slot_key}` JSON:
   - synthesize deterministic UUIDs from book ID + list position + path until Save persists them;
   - derive safe original basename/media type/actual byte size/page count;
   - retain slot key and list order;
   - never mutate `merged_attachment_paths` during read or preview;
   - missing/corrupt configured source raises a precise error.
3. Write base-resolution tests:
   - generated record with no baked papers may use/copy its current canonical PDF;
   - generated record with creation-time papers reconstructs the fixed bundle from committed DOCX plus companion PDFs, not from the already combined PDF;
   - existing in-app signed record re-renders a signed fixed form through the existing signer path and appends companions before included papers;
   - physical signed scan uses the scan as signed base and marks current IDs embedded;
   - preview reconstruction uses temporary files and does not set base paths.
4. Run the focused tests and confirm failures.
5. Implement the service as the only owner of:
   - generated-record scope checks;
   - version-1 creator checks;
   - full metadata parsing/normalization;
   - active generated/signed base selection;
   - temporary reconstruction for legacy records;
   - proposal validation/source resolution;
   - exact range calculation.
6. Refactor `document_service.render_signed_pdf()` so the package service can request a canonical signed form **without** appending `merged_attachment_paths`. Preserve its existing default for callers until Task 7 migrates signing atomically, then remove the obsolete append branch.
7. Resolve signer names/signature path through existing `book_service` helpers; do not duplicate signature lookup rules.
8. Use the existing staged token resolver and containment-checked book attachment resolver. Validate actual staged size/non-empty bytes again at preview/Save, not only at stage time.
9. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_included_papers_service.py -q
```

10. Commit this task.

## Task 4: Implement side-effect-free preview and atomic Save

**Files**

- Modify: `backend/app/services/included_papers_service.py`
- Modify: `backend/app/db/models.py` only if a relationship/type annotation is needed; do not add storage beyond Task 1
- Modify: `backend/tests/test_included_papers_service.py`

**Steps**

1. Add preview tests asserting:
   - opened revision is required and checked before expensive conversion;
   - normalized existing metadata plus staged add/replace/remove/reorder produces exact bytes and ranges;
   - repeated previews do not persist metadata/base paths, increment revision, consume staged files, write audit history, or push;
   - embedded scan IDs cannot be omitted, replaced, or reordered, while late IDs can be edited.
2. Add Save tests asserting:
   - complete source validation happens before writes;
   - staged sources are copied to collision-safe `book_attachments/<book_id>/...` names;
   - new/legacy metadata is persisted in proposal order with stable IDs;
   - first normalization publishes an immutable base; later saves reuse that unchanged base;
   - output filename is immutable and revisioned, then the correct generated or signed pointer changes;
   - `included_papers_revision` increments exactly once;
   - the staged token is consumed only after commit;
   - old output/replaced source cleanup happens only after commit and only when unreferenced;
   - approval/signature fields remain byte-for-byte/state-for-state unchanged.
3. Add failure-injection tests for merge, candidate write, and `db.commit()` failures. Assert old DB pointers, old JSON metadata, old revision, and old downloadable bytes remain authoritative; candidate files are cleaned best-effort.
4. Add stale replay test: first Save succeeds, repeated old request returns conflict and creates no second audit/push.
5. Run tests and confirm failures.
6. Implement one proposal pipeline shared by preview and Save. Save sequence:
   1. authorize/scope/revision check;
   2. normalize in memory and validate proposal;
   3. resolve every retained/staged source;
   4. reconstruct or resolve fixed base;
   5. build package bytes/ranges;
   6. copy staged sources and write immutable candidate base/output paths in the destination filesystem;
   7. update `merged_attachment_paths`, revision, base/output pointer, embedded snapshot as applicable, and add one audit row;
   8. commit;
   9. consume staged files and remove superseded unreferenced outputs/sources best-effort;
   10. return an enriched read model/change summary for post-commit push.
7. Candidate names must include package revision plus a collision-safe suffix; never overwrite an existing base/output in place. It is acceptable for base/output pointers to share the same immutable file only when there are zero included pages and the bytes are identical; once they diverge, the base pointer never follows output revisions.
8. Serialize `AuditLog.payload` as stable JSON with actor ID/name, revision before/after, and arrays for added, removed, replaced (`from`/`to`), and reordered names. Use `action="update_included_papers"`, `entity_type="book"`, and string book ID.
9. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_included_papers_service.py -q
```

10. Commit this task.

## Task 5: Expose schemas, routes, history, and package-aware downloads

**Files**

- Modify: `backend/app/schemas/book.py`
- Modify: `backend/app/api/v1/books.py`
- Modify: `backend/app/api/v1/documents.py`
- Modify: `backend/app/services/included_papers_service.py`
- Create: `backend/tests/test_book_included_papers_routes.py`
- Modify: `backend/tests/test_document_download_companion.py`
- Modify: `backend/tests/test_document_download_filename.py`
- Modify: `backend/tests/test_document_download_original.py`

**Steps**

1. Write route tests for the exact contract above:
   - preview/Save success shapes;
   - `books.view` plus original-creator enforcement on both endpoints;
   - 404 for unsupported record scope/missing record, 409 for stale revision, 422 for malformed proposal/source failures;
   - preview is base64 text in JSON and preserves full PDF bytes;
   - Save returns enriched detail data.
2. Add schema/read-model tests for list/detail separation:
   - list rows expose `original_creator_user_id` and revision needed for action gating but no included-file metadata/history;
   - detail exposes normalized metadata, edit lock, page counts/ranges when available, and only `update_included_papers` history for that book;
   - `BookVersionRead` need not expose private base paths.
3. Add download regression tests:
   - package-managed generated/default signed/original URLs serve persisted published outputs;
   - companion pages occur once and before included pages;
   - records without base markers retain legacy serve-time companion behavior;
   - missing managed output fails rather than returning base/partial bytes;
   - `Content-Disposition` and `download_filename_for()` remain unchanged.
4. Run tests and confirm failures.
5. Add Pydantic request/response/read models and handlers. Keep staging at existing `/documents/attachments/stage`; do not add a redundant record-scoped staging endpoint.
6. Extend `_build_versions`/detail enrichment with the version-1 creator ID, included-paper read state, revision, page totals, and filtered audit events. For list enrichment, compute only creator ID/revision and leave heavy lists empty.
7. In `documents.download_document`, treat `base_pdf_path`/`signed_base_pdf_path` as the package-managed marker. Skip legacy `companion_pdf_paths()` append only for the corresponding managed published output. Preserve `original=true` behavior.
8. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_book_included_papers_routes.py backend/tests/test_document_download_companion.py backend/tests/test_document_download_filename.py backend/tests/test_document_download_original.py -q
```

9. Commit this task.

## Task 6: Make future generation produce fixed bases and managed outputs

**Files**

- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/core/pdf_merge.py` only if the shared builder needs a file-writing wrapper
- Create: `backend/tests/test_document_generation_included_papers.py`
- Modify: existing generation/attachment tests only where their public expectations change

**Steps**

1. Write generation tests for:
   - no included paper: non-null generated base marker and published PDF with identical pages;
   - automatic companion: companion is inside the fixed base exactly once;
   - creation-time PDF/image attachments: full metadata written immediately and included after the fixed base in slot/request order;
   - required slot behavior remains unchanged;
   - revise with `attachments=None` retains/rebuilds the existing managed set;
   - explicit empty attachments clears it;
   - generation conversion/merge failure does not commit a partial Book/Document/package.
2. Confirm existing focused tests plus new tests fail at the new assertions.
3. Refactor generation ordering:
   - convert primary form;
   - generate companion documents;
   - create the immutable fixed base from primary + companion PDFs;
   - persist full metadata for ordered creation-time sources;
   - call the shared package builder once to append included papers;
   - point `Document.base_pdf_path` and `Document.pdf_path` to the correct immutable files before commit.
4. Remove the old destructive section that merges sources into the primary before companion generation. Keep staged cleanup post-commit.
5. Keep `Book.merged_attachment_paths` backward-compatible for historical rows while all new rows use the full schema.
6. Ensure revision remains `0` for initial generation; it increments only when the creator later performs a package Save.
7. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_document_generation_included_papers.py backend/tests/test_book_attachment_manage.py backend/tests/test_document_download_companion.py -q
```

8. Commit this task.

## Task 7: Make in-app signing and physical scan replacement package-aware

**Files**

- Modify: `backend/app/services/book_service.py`
- Modify: `backend/app/services/document_service.py`
- Modify: `backend/app/api/v1/books.py` only for signed-source enrichment if needed
- Create: `backend/tests/test_book_signing_included_papers.py`
- Modify: `backend/tests/test_book_attachment_manage.py`
- Modify: `backend/tests/test_render_signed_pdf_manager.py`

**Steps**

1. Write tests for in-app signing:
   - canonical signed form/companion bundle is stored at `signed_base_pdf_path`;
   - signed published output appends all included papers exactly once;
   - generated/original package stays available;
   - approval/signature fields match existing behavior.
2. Write tests for first physical signed-copy filing:
   - PDF and image uploads become `signed_base_pdf_path`;
   - every current included-paper ID is snapshotted in `signed_embedded_paper_ids` because those pages may already be flattened in the scan;
   - signed published output does not append embedded papers again;
   - a paper added after the scan remains non-embedded and is appended/editable.
3. Write tests for existing signed-copy replacement:
   - treat replacement as the creator/operator supplying a corrected form-only signed base;
   - clear `signed_embedded_paper_ids`;
   - rebuild signed output from the new base plus the complete current included list;
   - preserve approved state.
4. Write unfile tests: clear signed base/output/embedded IDs together and preserve the generated package.
5. Update `_signed_source_of()` to classify from `signed_base_pdf_path` first, because a revisioned signed output path no longer reliably identifies scan vs in-app.
6. Migrate `sign_book`, scan filing, signed-copy replacement, and unfile to the shared package builder. Delete the obsolete unconditional `_merge_book_attachments()` path after every caller is migrated.
7. Run:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_book_signing_included_papers.py backend/tests/test_book_attachment_manage.py backend/tests/test_render_signed_pdf_manager.py -q
```

8. Commit this task.

## Task 8: Add one post-commit localized push per approving user

**Files**

- Modify: `backend/app/services/included_papers_service.py`
- Modify: `backend/app/services/push_service.py` only if a small reusable delivery helper is justified
- Modify: `backend/tests/test_included_papers_service.py`
- Create or modify the focused notification-format test following existing conventions

**Steps**

1. Add tests that an approved Save:
   - collects distinct assignee IDs from current-version approval steps whose state is `approved`;
   - sends once per distinct user even if the user appears in multiple steps;
   - excludes reviewers/non-approved/pending users;
   - sends after DB commit with `/books/{id}` deep link;
   - contains English and Arabic title/body with record ref, actor, and concise one-Save summary;
   - creates no `Notification`/bell item;
   - logs push failure without rolling back package/history.
2. Add tests that an unapproved Save writes history but sends no approving-manager push.
3. Implement a narrow post-commit notifier. Reuse `push_service.send_to_user()`; do not add a queue, email, SMS, WhatsApp, or notification-bell path.
4. Run the focused notification tests.
5. Run the required `notification-template-reviewer`; apply only validated findings.
6. Commit this task.

## Task 9: Regenerate OpenAPI and add typed frontend clients

**Files**

- Regenerate: `backend/openapi.json`
- Regenerate: `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts`

**Steps**

1. Read and follow the project `sync-api-types` skill.
2. Generate the contract:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -X utf8 scripts/dump_openapi.py
pnpm -C frontend run gen:api
```

3. Export the generated proposal/preview/read/event types from `api.ts`; do not hand-copy schema interfaces.
4. Add typed methods:

```typescript
previewIncludedPapers(bookId, proposal): Promise<IncludedPapersPreview>
saveIncludedPapers(bookId, proposal): Promise<BookRead>
```

Reuse existing `stageAttachment(file)` for add/replace.
5. Run:

```powershell
pnpm -C frontend exec tsc -b --noEmit
```

6. Commit generated schema/types and client changes together.

## Task 10: Implement the pure frontend editing state and shared hook

**Files**

- Create: `frontend/src/pages/books/includedPapers.ts`
- Create: `frontend/src/pages/books/includedPapers.test.ts`
- Create: `frontend/src/pages/books/useIncludedPapers.ts`
- Create: `frontend/src/pages/books/useIncludedPapers.test.tsx`

**Steps**

1. Write pure-state tests for:
   - mapping existing normalized/legacy metadata;
   - multi-file add in picker order with client UUIDs;
   - replacement retains stable ID/position;
   - remove and reorder serialize as omission/order;
   - embedded IDs cannot change;
   - dirty comparison against opened state;
   - exact page groups/ranges from preview response.
2. Write hook tests for:
   - stage each file then preview one proposal;
   - preview loading/error/retry retains pending state;
   - stale `409` exposes reload-required state and never silently retries Save;
   - successful Save invalidates `['books']` list/detail queries, then closes only after refreshed data is available;
   - failed Save leaves workspace state intact.
3. Implement plain reducer/helper functions; no state-management dependency.
4. Use one debounced preview request after a burst of adds/reorders. Abort obsolete preview requests so old results cannot replace a newer order.
5. Keep the opened revision stable until successful Save or explicit reload.
6. Run with one worker:

```powershell
pnpm -C frontend exec vitest run src/pages/books/includedPapers.test.ts src/pages/books/useIncludedPapers.test.tsx --maxWorkers=1
```

7. Commit this task.

## Task 11: Generalize the PDF canvas for package preview

**Files**

- Modify: `frontend/src/pages/application/DocPdfCanvas.tsx`
- Modify: its focused tests or create `frontend/src/pages/application/DocPdfCanvas.package.test.tsx`

**Steps**

1. Add tests that existing URL mode still fetches `?encoding=base64` and renders all pages.
2. Add tests for optional in-memory `pdfBase64` mode: it bypasses URL fetch, reports page count, and remounts on a caller-provided revision key.
3. Add optional package-preview capabilities without a second pdf.js viewer:
   - grouped thumbnail rail generated only when requested;
   - selected page/source callback and scroll-to-page;
   - zoom controls/fit-width state owned by the workspace;
   - rendered page metadata callback;
   - existing annotation overlay behavior unchanged.
4. Generate thumbnail images/canvases only in package mode to avoid extra work in ordinary record/document previews.
5. Keep IDM bypass and `disableFontFace` behavior unchanged for URL mode.
6. Run:

```powershell
pnpm -C frontend exec vitest run src/pages/application/DocPdfCanvas.package.test.tsx --maxWorkers=1
```

7. Commit this task.

## Task 12: Build the approved desktop/mobile Included Papers workspace

**Files**

- Create: `frontend/src/pages/books/IncludedPapersWorkspace.tsx`
- Create: `frontend/src/pages/books/IncludedPapersWorkspace.test.tsx`
- Reuse: `frontend/src/components/ui/dialog.tsx`
- Reuse: `frontend/src/components/ui/tabs.tsx`
- Modify shared UI primitives only when required for proper sheet/dialog semantics

**Steps**

1. Write component tests for:
   - complete initial preview and exact fixed/item page groups;
   - multi-file picker and append order;
   - replace/remove/native drag reorder/Move up/Move down;
   - fixed base cannot move;
   - embedded scan rows show locked guidance while late papers remain editable;
   - approved notice says approval stays unchanged and approvers are notified;
   - preview loading/error/retry keeps order controls usable;
   - clean close exits immediately; dirty close opens discard confirmation;
   - Save disabled until preview matches current proposal;
   - success closes/restores focus; failure stays open;
   - Escape, focus trap, labelled controls, and visible status text.
2. Implement the approved desktop layout from the polished mockup:
   - record ref/title/state/final-page header;
   - dominant preview pane with zoom, fit-width, full-screen, grouped thumbnails;
   - numbered order pane with filename/type/pages/size/final range;
   - native multi-file Add, Replace, Remove, native drag reorder plus keyboard buttons;
   - sticky final summary, Cancel, and one **Save combined PDF** action.
3. Implement mobile as a full-height sheet using shared unsaved state and **Preview**/**Order** tabs. Do not render two independent editors.
4. File names use `dir="auto"`; refs, sizes, extensions, and page numbers remain LTR. Use logical CSS properties and reduced-motion-safe transitions.
5. Do not add a new drag/drop dependency; native pointer drag plus mandatory Move up/down is sufficient.
6. Run:

```powershell
pnpm -C frontend exec vitest run src/pages/books/IncludedPapersWorkspace.test.tsx --maxWorkers=1
```

7. Commit this task.

## Task 13: Wire both Records entry points and history

**Files**

- Modify: `frontend/src/pages/books/RecordPane.tsx`
- Modify: `frontend/src/pages/books/BookRecordPage.tsx`
- Create: `frontend/src/pages/books/RecordPane.includedPapers.test.tsx`
- Create or modify: `frontend/src/pages/books/BookRecordPage.includedPapers.test.tsx`

**Steps**

1. Write tests that **Manage included papers** appears on both surfaces only when:
   - authenticated user ID equals `original_creator_user_id`;
   - current record is generated/reconstructable;
   - record is not imported, deleted, or voided.
2. Assert approver/manager capability alone does not reveal the action.
3. Add one workspace instance per surface with thin open/close wiring; do not put package logic into `RecordPaperViewer` or `recordPapers.ts`.
4. After Save, ensure the Records pane and full record canvas receive a cache-busting revision and show the new published output immediately.
5. Render filtered `included_papers_history` in the full page timeline as **Included papers updated**, including actor, timestamp, and concise localized change summary.
6. Ensure the existing **Add scan**, signed-copy replace/unfile, print, email-basket, and approval controls remain present and unchanged.
7. Run:

```powershell
pnpm -C frontend exec vitest run src/pages/books/RecordPane.includedPapers.test.tsx src/pages/books/BookRecordPage.includedPapers.test.tsx --maxWorkers=1
```

8. Commit this task.

## Task 14: Add peer English/Arabic copy and RTL behavior

**Files**

- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`
- Modify: focused workspace/surface tests

**Steps**

1. Add peer strings for entry actions, header, file actions, fixed/embedded labels, page/range/size summaries, preview states, dirty confirmation, stale conflict/reload, corrupt/expired upload guidance, approved notice, Save success/failure, history summary, and signed-base replacement instruction.
2. Keep formal, plain GSSG product voice. Do not translate filenames, refs, extensions, or numeric page ranges.
3. Add one Arabic component test proving mirrored control placement/logical classes while proposal array order remains identical.
4. Add reduced-motion assertion where the workspace adds animation.
5. Run focused English and Arabic tests.
6. Run the required `i18n-rtl-reviewer`; apply validated findings.
7. Commit this task.

## Task 15: Backend verification and migration review

**Files**

- Modify implementation/tests only for validated failures or reviewer findings

**Steps**

1. Run all affected backend contracts:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/python.exe -m pytest backend/tests/test_migration_record_included_papers.py backend/tests/test_included_papers_pdf.py backend/tests/test_included_papers_service.py backend/tests/test_book_included_papers_routes.py backend/tests/test_document_generation_included_papers.py backend/tests/test_book_signing_included_papers.py backend/tests/test_book_attachment_manage.py backend/tests/test_document_download_companion.py backend/tests/test_document_download_filename.py backend/tests/test_document_download_original.py backend/tests/test_render_signed_pdf_manager.py -q
```

2. Run narrow static checks on changed backend files, then broader checks only after they pass:

```powershell
C:/Users/Admin/sentinel/venv/Scripts/ruff.exe check backend/app/db/models.py backend/app/core/pdf_merge.py backend/app/services/included_papers_service.py backend/app/services/document_service.py backend/app/services/book_service.py backend/app/api/v1/books.py backend/app/api/v1/documents.py backend/app/schemas/book.py backend/app/db/migrations/versions/0068_record_included_papers.py
C:/Users/Admin/sentinel/venv/Scripts/mypy.exe
```

3. Run the required `alembic-migration-reviewer`; apply validated findings.
4. Confirm exactly one Alembic head.
5. Re-run focused tests after findings. Do not run migrations against live production data.
6. Commit verification fixes.

## Task 16: Frontend verification, scratch smoke test, and branch completion

**Files**

- Modify implementation/tests only for verified failures
- Do not touch `backend/templates/*.docx`, `data/`, generated frontend static assets, or production service state

**Steps**

1. Run focused frontend tests with one worker:

```powershell
pnpm -C frontend exec vitest run src/pages/books/includedPapers.test.ts src/pages/books/useIncludedPapers.test.tsx src/pages/application/DocPdfCanvas.package.test.tsx src/pages/books/IncludedPapersWorkspace.test.tsx src/pages/books/RecordPane.includedPapers.test.tsx src/pages/books/BookRecordPage.includedPapers.test.tsx --maxWorkers=1
```

2. Run type-check, lint, and build sequentially to respect workstation memory:

```powershell
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

3. Use a scratch database and scratch data directory, never live production paths. Launch the app through the harness process manager and exercise in a real browser:
   1. create a generated test form;
   2. open Included papers from Records pane;
   3. add a multi-page PDF and one image;
   4. reorder, select page groups, and compare preview order;
   5. Cancel once and verify unchanged output;
   6. repeat and Save;
   7. verify full-page preview, print URL, email basket attachment URL, and download bytes all match the package and retain the existing filename;
   8. approve/sign, then add/remove/reorder and verify approval/signature fields unchanged, one history entry, and one push invocation per distinct approver;
   9. open from the full/mobile record page and verify shared behavior/focus restoration;
   10. verify Arabic/RTL and English/LTR at desktop and mobile viewports;
   11. exercise an existing generated record's lazy normalization;
   12. exercise a physical signed scan: embedded rows blocked, late row editable, signed-base replacement clears the block and rebuilds once.
4. Re-run the exact checks affected by any smoke-test fix.
5. Review changed paths for accidental PII, local data, static build output, secrets, or DOCX resaves.
6. Use `skill://requesting-code-review`, resolve validated correctness findings, then use `skill://verification-before-completion`.
7. Commit the complete feature on `feature/record-included-papers`. Do not deploy or modify the live checkout. Integration/deploy happens only after push/merge to `origin/main` under the project deployment workflow.

## Completion evidence

Before calling the feature complete, retain exact evidence for:

- one Alembic head and reversible migration test;
- creator-only backend authorization and both UI gates;
- byte/page-order parity between preview and persisted download;
- unchanged export filename/Content-Disposition;
- unchanged approval/signature state after approved Save;
- atomic failure tests preserving old pointers/bytes;
- one audit event and one localized push per distinct approving user;
- no bell/email/SMS/WhatsApp side effect;
- desktop/mobile EN/AR browser smoke results;
- passing focused backend/frontend tests, type-check, lint, and build.
