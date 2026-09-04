# Phase 8 — Vehicles

Status: not started. Branch: `refactor/p8-vehicles`. Release dependency: Phase 7.

Follow [WORKFLOW.md](WORKFLOW.md): tests precede application changes; verify current code before each implementation slice and required checks before each build.

## Outcome and design checkpoint

Make vehicle workflows easier to call and change while preserving HTTP contracts, file ownership and audit behavior. Start with fines/EVG, where a distinct external boundary already exists. The original seven-module split is a candidate design, not proof of improvement. After fines/EVG, assess caller simplicity and dependencies before extracting remaining groups; record the decision for every group.

Agreed candidate boundaries: fleet core, sites, files, fines/EVG, accidents, maintenance and licence workflows, plus existing vehicle HTTP routes and EVG parser tests. Keep external fetch behind an injectable `TicketFetcher` matching the actual client contract.

## Verify current code first

- [ ] Read `vehicle_service.py`, `vehicle_evg_service.py`, vehicle routes, letters/reminders and `evg_client`.
- [ ] Map call graphs and private cross-module calls, especially file ownership/path resolution and `_audit` calls.
- [ ] Trace EVG ticket identity, plate matching, preview/confirm validation, repeated import, wrong-vehicle/file access and external failures.
- [ ] Run vehicle API/EVG/letter/reminder baselines and inventory parser fixtures before moving code.
- [ ] Define success evidence: callers perform fewer orchestration steps, workflow rules have one owner, and no new dependency cycle. File count or lines moved alone is insufficient.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 8.1 Fines/EVG | `test_vehicle_fines_service.py`: fixture ticket rows match correct plate; unmatched/ambiguous rows handled explicitly; preview/confirm works; repeat confirm is idempotent; fetch failure does not partially import | Consolidate fine workflow and EVG orchestration with injected fetch; preserve parser tests in `test_evg_fines.py` |
| 8.2 Files/audit | Existing public file/API boundaries: wrong vehicle/file rejected, unsafe path rejected, correct file resolves, deletion consistent; visible audit effects for workflow changes | Choose owner for file and audit behavior; expose only operations needed by legitimate callers |
| 8.3 Sites/fleet | Create/update/list validation and duplicate plate/site behavior | Extract sites only if boundary reduces caller knowledge; retain fleet core name and useful serializers |
| 8.4 Accidents | Create/list/status/delete plus invalid transition, ownership and audit behavior | Move accident workflow as one responsibility if dependency review supports it |
| 8.5 Maintenance/licence | Due/expiry boundary dates, create/delete or renewal, reminders and letter behavior | Extract maintenance/licence operations with stable clock input/fake and shared rules for callers |
| 8.6 Route/caller migration | Existing vehicle API responses, permission denials, route precedence, generated letters and reminders | Migrate routes/letters/reminders to selected public modules; remove obsolete EVG module after usage search |

## Detailed tasks

- [ ] Keep `test_vehicles_api.py` as HTTP contract coverage throughout; add behavior tests for selected workflow boundaries before each move.
- [ ] Extract reusable synthetic fixtures to `backend/tests/factories/vehicles.py` when useful; do not make one test module import another's fixtures.
- [ ] Review fines extraction before proceeding: compare caller imports, required arguments, orchestration and cycles. Document keep/extract choice for each remaining workflow.
- [ ] Preserve file ownership in every workflow. Avoid making `_owned_file` public merely to allow more callers to bypass the file service.
- [ ] If a shared `audit` operation becomes public, define its responsibility and keep actor/action/entity/payload semantics intact in letters/reminders.
- [ ] Remove private cross-service calls and obsolete imports only after caller parity passes. Update route order without shadowing static paths by ID routes.

## Verification before build and release

- [ ] Run exact vehicle and EVG test paths, including parsers, HTTP, files, letters and reminders; then backend checks. Confirm unchanged OpenAPI or use sync-api-types for an intentional change.
- [ ] Review dependency graph and callable surface against the initial success criteria; document any extraction deferred for lack of benefit.
- [ ] Smoke synthetic EVG preview/confirm/repeat, fine edit/delete, file ownership, letter generation and due/expiry display. Use fixture fetch by default; real external interactions require the applicable authorization.
- [ ] Run required document/notification reviewers if letters or reminders change; preserve EN/AR parity.
- [ ] Rollback: imported fine IDs and files must remain usable; repeat imports must stay idempotent after revert. Do not remove persisted fines as a code rollback step.

## Execution evidence

Pending: workflow keep/extract decisions, dependency comparison, test map, baseline/RED/GREEN commands, HTTP/content parity and release evidence.
