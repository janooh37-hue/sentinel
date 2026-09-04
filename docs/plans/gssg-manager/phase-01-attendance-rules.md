# Phase 1 — Attendance rules

Status: not started. Branch: `refactor/p1-attendance-rules`. Dependency: Phase 0.

Follow [WORKFLOW.md](WORKFLOW.md): prepare behavior tests first; verify current code and the test result before every implementation slice and every build.

## Outcome and boundaries

One approved-policy resolver, one lifecycle-live leave classifier, and one attendance correction service. Keep `AttendanceAdjustment`, `/adjustments`, ETag `If-Match`, read-time overlays, audit behavior and transaction ownership unchanged. Do not enqueue reevaluation for a correction.

Agreed boundaries: `attendance_policy.policy_for` / `policy_for_case`; `leave_lifecycle.live_kind`; `attendance_correction_service.correct`, `revoke`, `active_correction`, `active_corrections`, `overlay`, `case_etag` and `case_etag_for`; existing workforce HTTP/dashboard tests.

## Verify the code before writing tests

- [ ] Compare `attendance_evaluation_service.effective_policy`, `attendance_punch_service._effective_policy`, and `attendance_queue_service._effective_policy_for_case`; record any real differences.
- [ ] Read `workforce_leave._excusing_reason`, dashboard `_leave_kind` / `_live_leaves`, and `leave_lifecycle.classify_group` / `is_annual`.
- [ ] Verify dashboard `_live_leaves` already filters deleted rows. Treat deleted sick leave as an existing green regression, not the claimed new defect.
- [ ] Trace all correction helpers and their imports, including the alternate evaluation-service path. Prove a path is unused before removing it.
- [ ] Read test factories and run the existing attendance/correction/dashboard baseline. Preserve useful tests before touching production code.

## Test-first slices and implementation tasks

Each table row is a backlog of behaviors. Implement one case at a time using the WORKFLOW checkpoint, not every row's tests followed by bulk implementation.

| Slice | Tests to prepare and run first | Expected baseline / implementation after verification |
| --- | --- | --- |
| 1.1 Approved policy | `test_attendance_policy.py`: unapproved excluded; general fallback; shift-specific beats newer general; newest start wins; equal start uses higher ID; `effective_to == day` excluded; occurrence shift beats supplied fallback | Characterize old callers first; new boundary may initially be absent. Add `services/attendance_policy.py` and move equivalent selection logic |
| 1.2 Leave liveness | `test_leave_lifecycle.py`: Approved sick/annual, Pending or Completed national service, pending sick excluded, deleted excluded, Leave Permit excluded, bilingual suffix handled, unknown type excluded | Protect current excusing behavior; introduce `live_kind(leave_type, status, deleted=...)` and keep reason-priority mapping with its caller |
| 1.3 Dashboard drift | `test_workforce_dashboard_api.py`: deleted sick absent; unknown Approved request-group leave does not enter annual bucket; real annual still does | Deleted case should be green. Confirm unknown-type failure on current code before changing dashboard to the shared classifier |
| 1.4 Correction lifecycle | `test_attendance_correction_service.py` plus existing correction HTTP tests: complete snapshot applies, second correction supersedes, revoke restores automatic result, stale/missing ETag behavior, invalid snapshot, audit and unchanged automatic evaluation | Characterize before moving bodies; preserve exact existing error codes and commit ownership |
| 1.5 Caller parity | Punch, queue, evaluation, workforce range and dashboard return unchanged effective attendance after each caller migration | Move one caller at a time; keep regression tests green |

- [ ] Keep generic `require_if_match` and `row_etag` where other workforce operations use them; avoid a new import cycle with the correction module.
- [ ] Migrate `workforce.py`, `workforce_read_service.py`, `workforce_dashboard_service.py` and policy callers together in this PR.
- [ ] Keep correction service functions free of implicit commits if their existing callers own transactions.
- [ ] Verify no reevaluation side effect via the public queue/read behavior already covered by integration tests.
- [ ] Remove dead correction code and obsolete exports only after usage search and replacement-coverage review. Do not delete tests merely because they live in an old module test file.

## Verification before build and release

- [ ] Run `test_attendance_policy.py`, `test_leave_lifecycle.py`, `test_attendance_correction_service.py`, `test_workforce_attendance_corrections_api.py`, `test_workforce_dashboard_api.py`, `test_attendance_punch_allocation.py`, `test_attendance_queue_service.py`, `test_attendance_evaluation_service.py`, and `test_workforce_leave_precedence.py` through the project Python.
- [ ] Search old policy/correction symbols and inspect every remaining executable reference; test names and historical documentation are not stale imports.
- [ ] Complete the backend release gate in WORKFLOW; regenerate API types only if contract inspection reveals a schema change.
- [ ] Smoke with synthetic attendance: correction survives reload, stale tab gets conflict, revocation restores automatic verdict, dashboard agrees with live leave rules.
- [ ] Rollback: reviewed revert; correction rows remain compatible because table/route semantics are preserved. Verify dashboard totals after either deployment.

## Execution evidence

Pending: per-slice source review, baseline/RED/GREEN commands, coverage-transfer map, static checks, smoke and PR/release evidence. No implementation or test execution is claimed.
