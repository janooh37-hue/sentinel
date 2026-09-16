# PR #159 follow-up: stuck approved-then-edited records + review findings

Branch `prototype/approvals-flow-mockup`, ships as additional commits on PR #159.

## A. Root cause: Word edit of an approved record leaves it stuck at `approved`

Reproduced in code, not fixed by PR #159.

- `BookWordActions` offers "Edit new version" for any finished record, including `approved`.
- `word_book_service.finish_word_session` appends `BookVersion(status="none")` but never
  touches `Book.approval_state` / `Book.submitted_by_user_id` (lines 463-473, 540-572).
- `document_service.generate_document`'s revise path does reset both
  (`approval_state="none"`, `submitted_by_user_id=None`, lines 1548-1549). The Word path
  is the only revision path that does not.
- Frontend `canSendForApproval(state)` reads `Book.approval_state` → `approved` → no
  Submit button. Backend `submit_for_approval` would already accept it (it checks the
  *version*), so the block is purely the stale derived book state. Admin must use the
  state-override dialog.

### Fix

1. `finish_word_session`: after the version is built, when
   `max_version_no > 0 and not signed and not is_report` (the same predicate as
   `invalidate_revision`), set `book.approval_state = "none"` and
   `book.submitted_by_user_id = None`. Reports stay `approved` by design
   (`create_report_word_book` line 270). Signed-on-finish reports keep `approved`.
2. Regression test in `backend/tests/test_word_book_reopen.py`: approved v1 → reopen →
   PUT → finish → `book.approval_state == "none"`, `submitted_by_user_id is None`,
   v1 untouched (`status="approved"`, steps intact), then `submit_for_approval` succeeds
   and the old signer still resolves v1 via `resolve_book_read_access`.
3. Data backfill for records already stuck in production: migration
   `0090_resync_word_revised_book_state` — `UPDATE books SET approval_state='none',
   submitted_by_user_id=NULL WHERE approval_state='approved' AND ref_number NOT LIKE
   'REPORT-%' AND current version (max version_no) has status='none' AND version_no>1
   AND signed_pdf_path IS NULL`. Only the Word path produces that mismatch (override and
   auto-sign write both columns). Downgrade is a no-op (state derivation is idempotent).
   Run alembic-migration review; single head `0090` after `0089`.

## B. Spec findings from the two-axis review (fix all)

1. `BookRecordPage.tsx:603-620` `onDecided`: stop navigating on return/reject; stay on
   the record (plan §6). Delete `nextAfterDecision` from `useAwaitingQueue.ts` and its
   two tests in `BookRecordPage.queueNav.test.tsx` (only caller was this branch).
2. `ApprovalPreviewDialog.tsx`: lazy-load `RecordPaperViewer` with `isOverlay=true`, one
   selected-revision Paper, no mutation callbacks (plan §6). Keep `DocPdfCanvas` for the
   thumbnail only.
3. "Review ended: newer revision" (plan §1): in `ReviewerList`/`BookDetailDrawer` render
   that label (EN + AR) for pending steps whose version is not the current one; no
   action button.
4. Neighbors `scope=sent` capability gate (plan §4, permissions-enforcement §3): extract a
   `_sent_worklist_rows(db, user, status)` helper used by both `approval_log_sent` and
   `approval_log_neighbors`; raise the same `FORBIDDEN books.view` in the route as
   `get_approval_log` does. Test: books.view-denied submitter gets 403 on
   `/approval-log/{id}/neighbors?scope=sent`.
5. `_sort_worklist`: tie-break Book ID ascending in both directions (plan §4). Sort
   timestamps descending via key negation, not `reverse=`. Extend the existing paging
   test with a tied-timestamp pair.
6. `add_reviewers` legacy branch (`book_service.py:~2269`): call
   `capture_approval_context` instead of assigning `_approval_context(...)` directly.
7. Dashboard copy (plan §7): `WaitingApprovalsCard` heading → `headingSign`; aria-label
   and empty state branch on `primaryIsReview` with review wording. `BooksAwaitingWidget`
   header/empty state likewise when `primaryKind === 'review'`. New keys in both locales.
8. `api.ts` (plan §8): `listApprovalLog(options: {scope, kind?, status?, sort?, limit?,
   offset?})` single object, migrate the ~6 callers; `documentDownloadUrl(docId, format,
   versionId?)` and `getDocument` accept the optional selected version.
9. `CONTEXT.md`: remove the five unrequested glossary entries (Submitter, Signer,
   Advisory reviewer, Awaiting signature, Returned for correction); keep the three the
   plan named.

## C. Standards findings (fix)

1. `RevisionAccessPanel.tsx:99`: replace `md:left-1/2 md:-translate-x-1/2` with
   `md:inset-x-0 md:mx-auto` (direction-neutral centring, no physical props).
2. `RevisionAccessPanel.tsx` Radix `Dialog.Content`: add `aria-describedby={undefined}`
   like `RecordStateOverrideDialog` does, or a real `Dialog.Description`.
3. Vocabulary: `books.approval.revisionAccess` → "Retained revision access" /
   "الوصول المحتفظ به للإصدار". Keep "Needs your changes" and "Review next waiting
   record"/"No signatures waiting": those strings are the plan's own mandated copy
   (§6 l.126, §7 l.140); spec wins over the vocabulary reviewer here.
4. Delete `book_service.require_book_access` (zero callers after the cutover).
5. Dedupe: import `RECEIVED_STATUSES`/`SENT_STATUSES` from `lib/approvals.ts` in
   `ApprovalsPage.tsx` and `BookRecordPage.tsx` (export them); move `isLateAdvisory` into
   `lib/approvals.ts`, import from `ApprovalsPage.tsx` and `BooksAwaitingWidget.tsx`.
6. `useWaitingSignals.ts:39-45`: use `useApprovalSummary()` (user-scoped key) instead of a
   second `['books','approval-summary']` query — removes the duplicate GET and the
   cross-user stale cache. Add `['books','approval-summary']` to the SSE invalidation
   list in `useNotificationStream.ts` beside `['books','awaiting']`.
7. `<bdi dir="ltr">` around `ref_number` in `BooksAwaitingWidget.tsx:80-82` and the
   post-sign CTA in `BookRecordPage.tsx:~1088`, matching the `ApprovalsPage` row.
8. `RevokeRevisionAccessRequest.reason`: `Field(..., min_length=1, max_length=2000)` with
   `str_strip_whitespace` via `model_config`, so length is checked after trim.
9. `normalizeApprovalContext` (`lib/approvals.ts:~104-122`): when the URL kind is not
   authorized, fall back to `defaultApprovalContext(summary)` as its docstring says,
   instead of forcing `status=pending` on the substituted kind. Add one case to
   `useAwaitingQueue.test.tsx`/`ApprovalsPage.test.tsx`.

## D. Verification, then push to the PR

- Backend: `test_word_book_reopen.py test_word_book_finish.py test_books_approval_log.py
  test_book_revision_access_routes.py test_mirror_permissions_backend.py`, plus
  migration upgrade/downgrade/upgrade against a disposable copy of the fixture DB.
- `sync-api-types` after B.4/C.8 (schema changes) — commit regenerated types.
- Frontend: the plan's nine-file suite + `BookWordActions.test.tsx`; full suite once at
  the end.
- Browser smoke on the isolated stack (`approvals-flow-ui-smoke`): approve v1 → Edit new
  version → finish → Submit for approval appears and succeeds; return/reject stays on
  the record; preview shows `RecordPaperViewer` zoom; Arabic panel centring.
- Reviews: alembic-migration (0090), i18n-rtl (new strings, panel centring, bdi).
- One or two conventional commits (`fix(books): reset state after Word revision of an
  approved record`, `fix(books): address PR #159 review findings`), push to
  `prototype/approvals-flow-mockup`, update the PR body.
