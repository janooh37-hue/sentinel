# Mandatory workflow for every phase

## Worktree and baseline

- [ ] Read repository AGENTS.md and any applicable nested instructions at the actual execution commit.
- [ ] Read the phase file, relevant skills, CONTEXT.md and ADRs if present. For UI work read PRODUCT.md and DESIGN.md.
- [ ] Create a separate worktree from current `origin/main`; never switch branches or implement a feature in the live checkout. Example: `git worktree add <separate-path> -b refactor/p1-attendance-rules origin/main`.
- [ ] Record the starting commit and a clean worktree status. Keep production data, credentials and Word template resaves out of fixtures and commits.
- [ ] Inventory every current caller and existing behavior test using `rg`. Revalidate symbols; old plan line numbers are not stable.
- [ ] Run the narrow existing test suite before application edits. Record exact commands, failures and skips. Diagnose environment errors separately from product defects.
- [ ] Build a behavior-to-test map before coding: existing test to keep, new test to add, expected result, public boundary, and failure mode. Use the phase's tables as the starting backlog.

## Tests before application changes

The TDD skill requires agreed public test boundaries and vertical slices. Do not generate an entire suite around an imagined future API before inspecting the first behavior. Prepare the phase's test matrix first, then write executable tests one behavior at a time.

For existing behavior being moved, add or retain a characterization test and run it on the old implementation **before** the move. Its expected initial result is green. Do not deliberately break working code to manufacture red evidence. A newly introduced public boundary can initially fail because the boundary does not exist, but must also carry assertions that protect the actual behavior after wiring it.

For a confirmed defect or new behavior, write a test first, run it, and observe the intended failure. A test collection failure caused by a typo, unavailable dependency, unconfigured database, or missing executable does not demonstrate the defect. Fix the harness before treating the test as RED.

Use independent expected values: literal outcomes, approved response fixtures, real DOCX contents, and externally observable state transitions. Prefer real temporary SQLite and files. Fake OCR, IMAP, PDF conversion, push delivery, clocks and EVG at their external boundaries. Do not mock the internal function being moved and then claim its behavior was tested.

## Checkpoint before every implementation slice

- [ ] Identify the next single behavior and its public boundary.
- [ ] Re-read the affected implementation and all callers since the last change or rebase.
- [ ] Check authorization, liveness, transactions, exceptions, concurrency, and locale behavior applicable to this slice.
- [ ] Run the new/retained test against the current code. Record intentional RED for changed behavior or baseline GREEN for a behavior-preserving move.
- [ ] Review the test for meaningful assertions, correct fixtures, and boundary-only mocks.
- [ ] Name exactly which production functions will change; confirm that no necessary information is lost at the proposed interface.
- [ ] Only now change application code, then run the focused tests to GREEN.
- [ ] Record the result before starting the next slice. Structural cleanup belongs to review after the behavior is green, protected by the same tests.

## Checkpoint before every code build

This checkpoint is required even for a repeat build after a correction. Reuse valid results from unchanged code; rerun checks affected by the correction. Never report a result from an earlier revision as evidence for changed code.

- [ ] Inspect `git diff --check` and the application/test diff; ensure the change matches this phase.
- [ ] Run focused behavior tests and applicable static checks on the exact code to be built.
- [ ] Verify all callers have migrated; use `rg` to find obsolete imports and private cross-module calls. Historical docs can mention old symbols; executable imports cannot.
- [ ] Review any test deletion against a coverage-transfer table: old behavior → replacement test → passing command. Preserve tests with unique content, parser, route, race or failure coverage.
- [ ] Complete required reviewers. Resolve material findings and rerun affected checks.
- [ ] For API/schema changes run the repository `sync-api-types` skill and inspect generated changes. Investigate unrelated generated drift instead of committing it blindly.
- [ ] For schema changes follow `new-migration`, use SQLite-safe batch operations, run `alembic-migration-reviewer`, and confirm one Alembic head.
- [ ] Run a build only after these checks pass; record build output and run the phase smoke checks on that build.

## Commands and release gate

Run from the implementation worktree root on the supported Windows environment. Backend commands use the project virtual environment, and frontend commands use pnpm. Resolve the actual environment before execution; this Linux planning session did not run the Windows application checks.

```powershell
# Focused backend test example; replace with the phase's exact existing/new files.
venv\Scripts\python.exe -m pytest backend/tests/test_leave_lifecycle.py

# Backend phase release checks, run sequentially.
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe

# Frontend phases: focused Vitest files first, then these release checks sequentially.
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
pnpm -C frontend run e2e
```

For frontend-only Phase 9, run backend/API checks if investigation reveals contract changes; otherwise frontend checks and browser evidence are sufficient. For documentation-only Phase 0, use its document checks and required review. Do not run memory-heavy frontend checks in parallel. Pytest shell globs are not portable to PowerShell: supply exact file paths or select paths with `Get-ChildItem` and pass those resolved paths to pytest.

Never treat a skipped external-adapter test as proof that the adapter works. Run required Word/OCR integration checks on a suitable isolated host with synthetic data; record a missing check as pending, not passed. An unrelated baseline failure must be documented and assessed; a relevant failed check blocks phase completion.

- [ ] One PR per phase, explaining the concrete behavior and actual test evidence.
- [ ] Do not merge while required checks or material reviews remain unresolved.
- [ ] After merge and push to `origin/main`, use the deploy skill and its status/health checks. Never deploy uncommitted work.
- [ ] External smoke actions (sending mail/push, real mailbox drafts, EVG writes) require explicit authorization and an identified test recipient/account; prefer isolated fixtures. Do not create real external messages merely because a smoke test mentions them.
- [ ] Record a rollback approach: normally a reviewed revert PR, merged/pushed before redeploy. Include phase-specific durable-state concerns; do not reset the live checkout or restore a live DB blindly.
- [ ] Mark the phase complete only after required verification and release evidence exist, then start the next phase.

## Evidence record to maintain in each phase

| Slice | Commit | Current-code findings | Test and exact command | Before: RED/GREEN and reason | After: result | Reviewer / build / smoke evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Pending | — | — | — | — | — | — |

Record unresolved business decisions separately from technical defects. A change to retry guarantees, scope policy, approval behavior or document retention requires an explicit decision; code movement must not quietly decide it.
