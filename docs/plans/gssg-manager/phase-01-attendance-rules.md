# Phase 1 — Attendance rules

Status: verification complete; merge and deployment pending. Branch: `refactor/p1-attendance-rules`. Dependency: Phase 0 (merged and deployed in PR #73).

Follow [WORKFLOW.md](WORKFLOW.md): prepare behavior tests first; verify current code and the test result before every implementation slice and every build.

## Outcome and boundaries

One approved-policy resolver, one lifecycle-live leave classifier, and one attendance correction service. Keep `AttendanceAdjustment`, `/adjustments`, ETag `If-Match`, read-time overlays, audit behavior and transaction ownership unchanged. Do not enqueue reevaluation for a correction.

Agreed boundaries: `attendance_policy.policy_for` / `policy_for_case`; `leave_lifecycle.live_kind`; `attendance_correction_service.correct`, `revoke`, `active_correction`, `active_corrections`, `overlay`, `case_etag` and `case_etag_for`; existing workforce HTTP/dashboard tests.

## Verify the code before writing tests

- [x] Compare `attendance_evaluation_service.effective_policy`, `attendance_punch_service._effective_policy`, and `attendance_queue_service._effective_policy_for_case`; record any real differences.
- [x] Read `workforce_leave._excusing_reason`, dashboard `_leave_kind` / `_live_leaves`, and `leave_lifecycle.classify_group` / `is_annual`.
- [x] Verify dashboard `_live_leaves` already filters deleted rows. Treat deleted sick leave as an existing green regression, not the claimed new defect.
- [x] Trace all correction helpers and their imports, including the alternate evaluation-service path. Prove a path is unused before removing it.
- [x] Read test factories and run the existing attendance/correction/dashboard baseline. Preserve useful tests before touching production code.

## Test-first slices and implementation tasks

Each table row is a backlog of behaviors. Implement one case at a time using the WORKFLOW checkpoint, not every row's tests followed by bulk implementation.

| Slice | Tests to prepare and run first | Expected baseline / implementation after verification |
| --- | --- | --- |
| 1.1 Approved policy | `test_attendance_policy.py`: unapproved excluded; general fallback; shift-specific beats newer general; newest start wins; equal start uses higher ID; `effective_to == day` excluded; occurrence shift beats supplied fallback | Characterize old callers first; new boundary may initially be absent. Add `services/attendance_policy.py` and move equivalent selection logic |
| 1.2 Leave liveness | `test_leave_lifecycle.py`: Approved sick/annual, Pending or Completed national service, pending sick excluded, deleted excluded, Leave Permit excluded, bilingual suffix handled, unknown type excluded | Protect current excusing behavior; introduce `live_kind(leave_type, status, deleted=...)` and keep reason-priority mapping with its caller |
| 1.3 Dashboard drift | `test_workforce_dashboard_api.py`: deleted sick absent; unknown Approved request-group leave does not enter annual bucket; real annual still does | Deleted case should be green. Confirm unknown-type failure on current code before changing dashboard to the shared classifier |
| 1.4 Correction lifecycle | `test_attendance_correction_service.py` plus existing correction HTTP tests: complete snapshot applies, second correction supersedes, revoke restores automatic result, stale/missing ETag behavior, invalid snapshot, audit and unchanged automatic evaluation | Characterize before moving bodies; preserve exact existing error codes and commit ownership |
| 1.5 Caller parity | Punch, queue, evaluation, workforce range and dashboard return unchanged effective attendance after each caller migration | Move one caller at a time; keep regression tests green |

- [x] Keep generic `require_if_match` and `row_etag` where other workforce operations use them; avoid a new import cycle with the correction module.
- [x] Migrate `workforce.py`, `workforce_read_service.py`, `workforce_dashboard_service.py` and policy callers together in this PR.
- [x] Keep correction service functions free of implicit commits if their existing callers own transactions.
- [x] Verify no reevaluation side effect via the public queue/read behavior already covered by integration tests.
- [x] Remove dead correction code and obsolete exports only after usage search and replacement-coverage review. Do not delete tests merely because they live in an old module test file.

## Verification before build and release

- [x] Run `test_attendance_policy.py`, `test_leave_lifecycle.py`, `test_attendance_correction_service.py`, `test_workforce_attendance_corrections_api.py`, `test_workforce_dashboard_api.py`, `test_attendance_punch_allocation.py`, `test_attendance_queue_service.py`, `test_attendance_evaluation_service.py`, and `test_workforce_leave_precedence.py` through the project Python.
- [x] Search old policy/correction symbols and inspect every remaining executable reference; test names and historical documentation are not stale imports.
- [x] Complete the backend release gate in WORKFLOW; regenerate API types only if contract inspection reveals a schema change.
- [x] Smoke with synthetic attendance: correction survives reload, stale tab gets conflict, revocation restores automatic verdict, dashboard agrees with live leave rules.
- [x] Rollback: reviewed revert; correction rows remain compatible because table/route semantics are preserved. Verify dashboard totals after either deployment.

## Execution evidence

Starting commit: `f6f19382582fe04c8b2d6131b222e9deb8172481`, in a clean new
worktree after Phase 0 deployed successfully. Two Sol builders own disjoint
policy/liveness and correction/integration files. The coordinator reviews all
caller migrations and test transfers before the phase gate.

Baseline verification, before application changes:

- Linux full backend: 1,886 passed, 9 skipped (live database/finance-share
  golden tests deliberately unavailable), Python 3.12.14, 483.70 seconds.
  Command: `PYTHONDONTWRITEBYTECODE=1 GSSG_DATA_DIR=/tmp/gssg-phase-baseline-data /tmp/gssg-load/venv/bin/python -m pytest -p no:cacheprovider -o faulthandler_timeout=45`.
- Windows isolated worktree at the same commit: correction and dashboard HTTP
  tests, 26 passed in 36.39 seconds, Python 3.12.10. The production virtual
  environment runs the temporary worktree with a separate synthetic data
  directory; production data and `.env` were not copied.
- Both platforms already report 29 Ruff lint errors. Windows formatting has
  158 pre-existing unformatted files and 455 formatted files. Windows mypy
  reports 33 errors in 12 files; the initial Linux run had one additional
  missing-stub error, addressed by installing type stubs in the temporary
  environment. These are baseline failures, not passing gates; compare final
  diagnostics and resolve relevant errors in changed modules.
- Frontend starting baseline: 2,215 tests passed across 224
  files and TypeScript passed. Existing frontend lint: 8 errors, 10 warnings.

Implementation evidence:

| Slice | Current-code finding and test-first evidence | Result |
| --- | --- | --- |
| Approved policy | Existing policy, punch and queue behavior was characterized green. New public resolver first failed import; precedence/date cases then passed. A one-query regression failed at two queries and a missing-occurrence fallback failed before the scalar-subquery/coalesce fix. | One approved resolver; occurrence shift has priority, supplied shift is the fallback. |
| Leave liveness | Existing lifecycle and excusing suites were green. New classifier first failed import; the original lifecycle tests were retained verbatim and a kind/status/deletion matrix appended. | Shared explicit national-service/sick/annual classification; existing reason priority and source evidence preserved. |
| Dashboard drift | Deleted sick leave was already excluded and its regression passed. An unknown Approved request-group leave incorrectly counted as annual; its regression failed before migration. | Unknown types no longer inflate annual-leave totals; real annual leave remains counted. |
| Corrections | Existing HTTP/evaluation characterization passed before extraction. New service tests cover complete snapshots, supersession, predecessor revelation, no reevaluation, and caller-owned commit/rollback. | Routes keep their schemas, capabilities, scope checks, ETags, audit payloads and transaction boundaries. Snapshot overlays include nulls. |
| Coverage transfer | The unused evaluator correction API had only test callers. Its two unique lifecycle tests now exercise the canonical correction service, preserving stale-version/raw-evidence and predecessor assertions. HTTP tests were migrated, not removed. | No unique test coverage was deleted; executable searches find no old policy/correction symbols. |

Focused command (temporary Linux environment):

```text
PYTHONDONTWRITEBYTECODE=1 GSSG_DATA_DIR=/tmp/gssg-p1-check-data /tmp/gssg-load/venv/bin/python -m pytest -p no:cacheprovider backend/tests/test_attendance_policy.py backend/tests/test_leave_lifecycle.py backend/tests/test_attendance_correction_service.py backend/tests/test_workforce_attendance_corrections_api.py backend/tests/test_workforce_dashboard_api.py backend/tests/test_attendance_punch_allocation.py backend/tests/test_attendance_queue_service.py backend/tests/test_attendance_evaluation_service.py backend/tests/test_workforce_leave_precedence.py
```

The builders' final combined phase matrix passed 98 tests in 18.69 seconds. Independent behavior/security and i18n/RTL reviews passed with no material
findings. The Windows backend gate and synthetic HTTP smoke passed. Windows frontend unit, type and build checks and the final full browser suite
also passed. Deployment remains pending; this phase is not yet complete. No route or Pydantic contract changed, so generated
API artifacts do not require regeneration. No migrations or document templates
changed. The two existing dashboard mypy tuple-inference errors were corrected
in the touched code.

Full Linux static comparison: Ruff decreased from 29 to 27 diagnostics; mypy
reports 31 errors in 11 untouched files (two dashboard errors removed). No new
diagnostics were introduced. Changed-file lint and new-file formatting pass;
legacy whole-file formatting remains a documented baseline failure.


### Windows backend gate and HTTP smoke

Backend source: `e27a0b030f31a7458b2014acd2e2ec554bc5c16c`, tested in the detached
Windows temporary worktree with a synthetic data directory and the project
virtual environment. `python.exe -m pytest -p no:cacheprovider -o
faulthandler_timeout=60`: **1,911 passed, 9 skipped in 1,195.37 seconds**.
The nine skips require live database/finance-share golden fixtures; no such
production data was used. Full Windows Ruff: 27 existing errors (baseline 29);
formatting: 156 legacy files would be reformatted (baseline 158), 461 formatted;
mypy: 31 existing errors in 11 untouched files (baseline 33 in 12). Changed-file
checks pass; whole-repository lint/type/format checks remain baseline failures,
not clean gates.

A real loopback backend with migrated temporary SQLite and two independently
authenticated cookie sessions verified correction persistence, stale ETag 409,
revocation restoring every original automatic field, unchanged evaluation and
queue counts, and exactly two correction audit rows. Dashboard leave totals
were Annual 1 / Sick 0 / National Service 0 / Other 0 with an unknown Approved
request and deleted Sick row excluded. The captured temporary server was stopped
and a connection probe confirmed shutdown.

### Timestamp round-trip defect found during smoke

Presence-only corrections could fail 422: nested read values contain legacy
UTC-naive timestamps, while the write schema requires timezone-aware timestamps.
The form returned untouched read timestamps verbatim. A failing form regression
reproduced this with fractional seconds before the fix. Commit
`e984d3187bf16ffea00d34aa33f359899a828046` appends `Z` to retained naive UTC strings,
preserving fractional precision and already-aware offsets; edited Dubai wall
times still use their existing UTC conversion. No backend/API contract changed.

The form, drawer and API focused suites pass 19 tests; changed-file ESLint and
TypeScript pass. Independent code and i18n/RTL review found no material issue.
The original HTTP smoke succeeded after explicit UTC normalization; permanent
browser coverage and the full Windows frontend release gate validate the form
fix before release. PR: [#74](https://github.com/janooh37-hue/sentinel/pull/74).


Windows frontend source: `e984d3187bf16ffea00d34aa33f359899a828046` (the backend
is unchanged from its verified revision). Frozen-lockfile dependency install
passed in the isolated Windows worktree. `pnpm -C frontend test --maxWorkers=2`
passed **2,216 tests in 224 files, 467.39 seconds**. Full ESLint JSON diagnostics
exactly match the starting baseline by relative path, rule, severity, line and
column: 8 existing errors and 10 warnings, with no additions. The comparison
uses sorted signatures rather than relying only on equal diagnostic counts.

The permanent correction browser regression covers UTC/Dubai wall-time display,
presence-only wire timestamps, 201 persistence, a stale 409 with preserved draft,
revocation revealing its predecessor, and English/Arabic drawer bounds at 1280
and 375 pixels. Before any mutation it proves the exact 80-case / 40-person
synthetic roster, including IDs and bilingual factory names. Focused Playwright,
ESLint and standalone TypeScript checks pass. Windows `tsc -b --noEmit` and
`pnpm -C frontend run build` both passed on the same application revision. The
build reported only its existing large-chunk warning. The final full browser suite passed as recorded below.

The first full browser run passed 27 tests and exposed two pre-existing
date-dependent tests: employee attendance opened the current month (September)
while the synthetic roster contains August 2026. Both failures reproduced on
an isolated archive of Phase 0 `f6f19382` with its own backend/frontend and fresh
fixture. The tests now select the fixture month through the existing controls;
all original grid, timeline and screenshot assertions remain. The two focused
tests then passed in 12.2 seconds. No product date behavior changed.

Final full Playwright run on a newly migrated/seeded isolated fixture:
**29 passed in 57.6 seconds**, including all 13 print regressions, the correction
lifecycle, register/board/timeline/filter checks, English/Arabic layouts,
overflow and refresh. ESLint and a standalone TypeScript check passed for all
three changed E2E specs. Captured baseline/focused/final servers were stopped;
connection probes confirmed their four loopback ports were clear.

Rollback was reviewed for compatibility, not executed: this phase has no schema
change, and existing correction rows preserve their meaning under a reviewed
revert. Recheck dashboard classification and correction projections after any
rollback deployment.
