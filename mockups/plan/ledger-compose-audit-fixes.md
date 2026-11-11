# Ledger compose audit fixes implementation plan

> For agentic workers: use test-first implementation and scoped independent review. User authorized Sol subagents, implementation, PR updates, and bot-review iteration.

**Goal:** Fix the five new-compose findings on draft PR #268 without overlapping Fable's Books/Records work.

**Architecture:** Keep React Query as the server snapshot and react-hook-form as the live editing state. Preserve serialized diff-only autosaves; use supported navigation protection and isolate subscriptions from unrelated form controls. Keep the HugeRTE and fallback textarea accessible through one focus interface.

**Tech stack:** React 19, React Query 5, react-hook-form 7, React Router 7, HugeRTE, Vitest.

**Spec:** The five findings in this thread: stale draft cache, pending-edit loss on exit, misleading Saved status, subject/body error focus, whole-form rerenders. Fable's audit reports corroborate the first two; other desk/Records findings remain Fable's scope.

## Constraints and ownership

- Continue existing `feat/ledger-html-books` worktree; baseline `f5bc6b72`. Do not merge/deploy, restart shared services, alter sandbox data, or rewrite branch history.
- Core Sol worker owns LedgerComposerPage, useDraftAutosave, SubjectLines, their tests, and narrowly required router integration. No edits to LedgerBodyEditor.
- Editor Sol worker owns LedgerBodyEditor and LedgerBodyEditor.test only. Add optional `ref` exposing `{ focus(): void }`; the core worker consumes it. Keep existing callers source compatible.
- Parent owns this plan, integration, EN/AR key changes if needed, checks, commits, pushes, and PR review loop. Stage only owned changes; never commit Fable's work.
- No new dependencies or unrelated performance refactors. English/Arabic parity is required.

## Review focus and regression checks

1. Save, navigate away, reopen using the same QueryClient: latest server-accepted body and metadata appear.
2. Leave within 800 ms, during an in-flight save, or after network failure: no silent loss; failed saves keep the user able to retry. Browser close/reload warns while dirty or saving. Clean navigation and successful Send/Delete remain unblocked.
3. After a successful save, new typing immediately stops claiming Saved; failure remains visible; status recovers after retry.
4. Subject/body server validation focuses the actual control after dialog dismissal, in EN/AR and textarea fallback. The iframe editing document must contain valid error-description relationships.
5. Body typing does not rerender unrelated recipient controls; latest body still autosaves and preview refreshes only from accepted saves.

## Tasks

- [x] Core worker: add failing regression tests for checks 1–3 and 5; verify failures, implement minimal fixes, rerun focused tests. Inspect all hook callers. Prefer a supported router blocker over history monkey-patching; if router bootstrap changes, test existing routing behavior.
- [x] Editor worker: add failing tests for imperative focus and error semantics on HugeRTE plus fallback; implement optional focus ref and accessible error description, then run editor tests.
- [x] Core worker: wire subject and body focus into validation handling using editor ref; add regression tests for check 4.
- [x] Parent: inspect combined diff, run composer/editor tests and TypeScript/lint sequentially. Run independent Sol code review and required i18n/RTL review, fix actionable findings, record evidence here.
- [ ] Parent: commit only reviewed compose changes, push PR #268, link it, read bot comments and review score. Address actionable findings and revalidate until bot reports 5/5; if no score-producing bot is configured, report that exact blocker rather than invent a score. Watch PR for pending reviews/checks. No merge or production deployment.

## Progress

- 2026-11-11: Baseline PR and worktree clean at f5bc6b72. Existing PR has no reviews or inline bot comments. Fable contacted with ownership boundaries. Its sandbox uses frontend 5173/backend 8775; configured tailnet dev is separate.
- Fable agreed to a separate branch, no overlapping composer edits or PR pushes. It owns NewLedgerBookButton cache seeding, PDF preview retention, Books/Records/desk and issued-content-editor work. Exported query-key names stay stable.
- Sol implementers completed the five fixes. Initial stale-cache and pending-status tests failed before implementation. Editor suite: 10 passed, including real installed HugeRTE serializer exclusion of accessibility text.
- Independent Sol code review found late PATCH cache resurrection after Delete and StrictMode duplicate router creation; both reproduced in failing tests and fixed. Existing failed-save/revert status gap was also covered and fixed. Sol i18n/RTL review found missing exit-dialog return focus; Cancel and Escape tests reproduced it and now pass. No other i18n findings.
- Parent verification: combined composer/App run initially 129 passed; after review fixes, composer/App subset 108 passed. TypeScript passed. Scoped ESLint now passes after correcting hook dependencies. Final combined run/build pending. Live screen-reader/browser validation not claimed.
- Existing PR #268 has merge conflicts with main and no initial bot score. No rebase, renumbering, merge, or deployment performed as part of these five fixes.
- Final verification: `pnpm -C frontend test src/pages/ledger/composer src/App.permissions.test.tsx` — 134 passed across 7 files. Scoped ESLint — clean. `pnpm -C frontend run build` — passed (TypeScript + Vite); existing large-chunk warning remains. `git diff --check` — clean. No backend tests were needed for these frontend-only changes.

## PR Agent round 1

- Published compose fixes: `f16c12e4`; PR Agent reviewed that head at **1/5**. The four active findings concern the wider draft PR, not the five completed compose fixes.
- [ ] Backend Sol worker: snapshot selected revision grade and preserve signed historical paper on correction regrade (comment 4534338350). Prefer existing revision JSON metadata; cover legacy missing snapshots before mutation.
- [ ] Backend Sol worker: serialize save_content with signing and refresh ORM revision state under the write lock (4534338456). Verify with two-session regression.
- [ ] Fable: correction-editor dirty navigation/reload protection with explicit discard or successful save (4534338546), using the newly available data router.
- [ ] Fable: invalidate Books routing/detail caches after correction saves (4534338642).
- [ ] Parent: review/test/integrate fixes, assess existing main conflicts, push and request another bot review. Keep watching; 5/5 remains unachieved.

## Main integration plan

- Main head inspected: `4d57ea01`. Read-only merge-tree found 20 conflicts; no merge started while workers edit.
- Preserve main's ordered Administrative Leave approvals, outcome unread tracking, attachment/Word flows, optional submitter, notification defaults and unified category permissions alongside Ledger grade/distribution and chain-only rules.
- Preserve all published main migration identities through `0118_drop_record_category_overreach`. Renumber the unpublished Ledger chain to `0119_record_grade` through `0124_ledger_paper_preset`, update test references, and verify on disposable databases only. Existing sandbox stamps require separate reconciliation before a future restart/upgrade.
- Regenerate OpenAPI and TypeScript after resolving routes/schemas. Validate migration chain, affected backend/frontend tests, i18n/RTL and Alembic review. No merge into main or deployment is authorized.

## Round 1 integration evidence

- Backend bot fixes committed in `7d198ffc`: signed grade snapshots, historical access/image filtering, and write-lock serialization. Four snapshot/locking regressions plus access/image regression passed before main integration.
- Resolved 20 conflicts with `origin/main` at `4d57ea01`; preserved ordered Administrative Leave approvals, attachments, notification defaults and grade privacy. API regenerated (447 paths). Backend Ruff, 92 changed-file format checks, and migration numbering pass.
- Required migration review prompted fail-closed downgrade guards for visibility and unrecoverable recipient journals; batch downgrade preserves FTS triggers. Two migration modules: 20 passed; malformed-journal regression: 1 passed. Published main migration identities unchanged. Existing dev stamps need separate reconciliation; no services/data migrated.
- Fable isolated correction-editor commit `f219e8ed` applied for integration. Parent reproduced/fixed loss of edits typed during pending save and discard-dialog return focus. i18n/RTL re-review clean. Composer: 77 passed; App permission tests: 101 passed after adapting main's new test navigation to the data router. Initial overloaded parallel run had timing failures; single-worker rerun passed composer.
- Main integration exposed canonical approval queue navigation race; fixed without weakening regression. Approvals: 31 passed; Application generated handoff: 18 passed; service navigation: 6 passed. Notification reviewer found no remaining integration defects.
- Full merged backend suite running in background; final build/lint and PR push/review remain pending. Latest external score remains 1/5.
- Follow-up correction race checks: reverting to the initial text while a different save is pending remains protected, accepted saves refresh the dirty baseline, and a late save after explicit discard does not redirect the writer. Correction editor: 13 passed; scoped ESLint and TypeScript passed. Production build passed before this small follow-up (existing large chunks and one inherited Application react-hook-form compiler warning).
- Shared venv is Python 3.13.15 despite project requiring3.12. Initial full run stopped after repeated SQLite ResourceWarnings were promoted to setup errors. Created isolated ignored `.tmp/venv312` with installed CPython3.12.13 and unchanged requirements; narrow check passes original failure boundary. Full supported-runtime suite now running; no shared environment or service change.

## PR Agent round 2

- Confirmed reference-date drift after signing (4534538494); Sol snapshots reference number/date per signed revision, while `can_open` remains a current access decision. Related prepared-by writer name/G-number drift is included in the same integrity fix. Existing legacy signatures without snapshots cannot reconstruct their original printed metadata.
- Confirmed background query error unmounted dirty correction forms (4534538760). Full-page error now requires missing data; cached forms remain mounted with an inline translated error/Retry. Regression checks edits and navigation protection survive failure and retry. Required i18n/RTL review: no findings.
- Editor configuration claim (4534538624) is not reproducible: test runs real HugeRTE React wrapper; installed `Editor` calls `mergePlugins`, which converts plugin strings to arrays before engine.init. Kept supported production string and correct observed-array assertion; clarified the test seam. Both editor files: 24 passed. Scoped ESLint, TypeScript and whitespace checks pass.
- Full Python3.12 backend suite continues against the round-one baseline; no failures reported so far. New reference/writer regressions are validated separately before push.
- Round-two verification complete: paper preset/reference/writer API suite 13 passed on Python 3.12; changed backend Ruff/format and whitespace checks clean. Both confirmed bugs reproduced before fixes. No service restart or deployment.

## PR Agent round 3

- Bot confirmed prior findings fixed at 448c4ca7; confidence 2/5. Sol ownership: retained edit session on revision lock/replacement; reject untracked generic Ledger subject updates; suppress navigation from abandoned draft creation. Each confirmed issue gets a focused regression; parent reviews recovery UX and required i18n/RTL before push.
- Previous head CI: both checks passed. Full supported-runtime backend baseline still running; no services or data touched.
- Round-three regression evidence: generic subject changed/null/no-op rejected without list/paper/save mutation; 7 backend checks passed including tracked content and signed lock precedence. Draft creation: normal/StrictMode abandonment reproduced; 4 focused creation tests pass with cache/list updates retained. Correction lock/replacement and pending-save redirect reproduced; final editor + API error suites 43 passed. Required i18n/RTL review clean; recovery is explicit copy-before-leaving, not automatic correction creation.
- Round-three final TypeScript, scoped ESLint and whitespace checks passed. Full backend baseline remains in progress; live browser verification not repeated. No deployment or service restart.

## PR Agent round 4

- Bot cleared round-three findings at 446e0315 (both CI checks passed), confidence remains 2/5. New scope: recheck access to draft preview references/folders; guard NewLedgerBookButton late completion; forward iframe-local body validation description; exclude metadata-only reference results. Three Sol workers own independent fixes, parent owns picker and integration. No services/data changes.
- Round-four validation: all4 findings reproduced before fixes. Button4tests pass incl StrictMode, editor29tests pass incl EN/AR iframe-local descriptions, picker8tests pass incl metadata-only empty result. TypeScript/scoped ESLint/whitespace pass; required i18n/RTL review clean. Paper API15tests passed; final revoked-access2case rerun follows narrower NotFoundError handling. Preview omits inaccessible targets without mutating draft selections; unrelated errors propagate. Full baseline backend still running, no failure reported; no live UI recheck.
- Final narrowed-handler revoked-access rerun:2passed on Python3.12; changed backend Ruff/format checks clean. Ready for bot review round4.

## PR Agent round 5

- Bot cleared round4 at51c04b53, both CI checks passed; new stale-content race requires mandatory expected revision/content hash under write lock. Parent synchronizes frontend baseline+conflict recovery and generated API; Sol owns backend, exclusive Save&Send editor/control freeze, and late correction navigation. No deployment or service changes.
- Round5 regression evidence: stale revision and same-revision content overwrite reproduced before server guard;24focused backend tests pass incl required token validation and real concurrent editors with exactly one winner. OpenAPI/types regenerated together447paths; TypeScript/scopedESLint/Ruff/format/diff checks pass. Frontend baseline keeps dirty-refetch token, adopts clean refresh/accepted-save token, preserves input+navigation on conflict;45editor/API-error tests pass.
- Save&Send locks controls and actual HugeRTE before final flush, ignores late picker callbacks and restores failure editing;60composer/body tests pass. Follow-on issuance/delete departure races reproduced and fixed,6focused lifecycle tests pass. Correction action guards active book and returned book identity;21action tests pass. Required i18n/RTL review clean; independent integration review pending. No deployment or service operations.
- Independent Sol integration review: no concrete bugs found in revision/hash guard, editor baseline/recovery, issuance freeze or late navigation. Full Python3.12 baseline suite still running; browser/real-PDF checks not repeated.

## PR Agent round 6

- Bot cleared round5 at767729f3; new review covers generic-reference delivery and signing integrity. Actual reference reproduction: downstream chain guard already prevents recipient grant, but generic sends fail409 after primary send; skip Ledger references before processing to retain normal delivery and links. New signed/unsigned target404/no-recipient tests plus existing generic refs:5passed.
- Signing now requires reviewed revision/hash under write lock. Required LedgerSignRequest schema+OpenAPI/types regenerated together. UI keys dialog state perbook, pins tokens at confirmation open, reloads PDF on contenthash and disables Sign until matching paper paints. Actions29tests pass; parent integration and backend focusedtests running. No services/deployment.
- Round6 independent review found PDF cache-buster alone did not bind rendered content (A metadata/B preview/A restore); server now validates optional v against same read used for rendering before conversion. Original mismatch reproduced200; fix matching/mismatch/malformed and interleaving tests pass. Reviewer recheck confirms gap closed. Signing17focused + PDF7focused pass; ordinary reference5pass. i18n/RTL clean.
- Frontend: Actions29pass, preview/desk targeted10pass, full desk/content/i18n/API-error integration135pass after fixing async test assertions to wait for React Query notification. Sign requires matching first-painted paper, bookchanges reset dialogs, confirmation tokens remain pinned. API schema/types regenerated after final v parameter. No browser/live-PDF verification or deployment; full baseline backend still running.
- Final round6 TypeScript/scoped ESLint and whitespace checks pass; backend changed-file Ruff/format pass. Ready for next bot review.

## Combined audit integration and sandbox preview

- User authorized Fable audit commits c56bd27f/a96b0fc6/532090b3 and running the combined feature on laptop dev. Merged with round6 signing safeguards; retained confirmations, cache invalidation and stable paper zoom while binding readiness to the requested document's first paint.
- Combined Actions33 and preview/desk/locales167 tests pass. TypeScript passes; scoped ESLint0errors (8existing Outlook warnings). Required i18n/RTL review clean. Fixed the inherited noteCounter interpolation regression in both locales and its caller. Production build running.
- Sandbox old0115 stamp assessed read-only: six Ledger upgrades match renumbered0119–0124; main0110–0118 changes genuinely missing. Rehearsing those changes on a SQLite backup before any source replacement; existing drafts and original rollback copy must be preserved. Production and normal dev data untouched.
