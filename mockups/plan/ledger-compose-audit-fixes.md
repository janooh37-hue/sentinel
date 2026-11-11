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
