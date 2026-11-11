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
