# Phase 2 — Workforce access

Status: implementation complete; release verification in progress. Branch: `refactor/p2-workforce-access`. Dependency: Phase 1, except the independently extractable requirements fix in slice 2.1.

Follow [WORKFLOW.md](WORKFLOW.md). Tests and current-code verification precede every implementation slice; passing verification precedes every build.

## Outcome and boundaries

Workforce services enforce caller scope on employee-bound reads and writes. Routes retain authentication, capability and field-level policy checks, parsing, HTTP serialization and explicit transaction ownership. A pagination scope fingerprint binds a cursor; it never substitutes for filtering rows.

Agreed boundaries: `workforce_access_service`, scoped public functions in read/schedule/admin services, existing workforce HTTP routes. Keep `FORBIDDEN` and established ETag errors. Preserve self-view and aggregate permissions.

## Verify the code before writing tests

- [x] Inspect `api/v1/workforce.py:list_requirements` and `_cursor_page`; confirm unscoped query and pre-pagination limit at the execution commit.
- [x] Inventory every read, write, scope helper, ETag helper and scheduler/seed caller across workforce services.
- [x] Inspect `WorkforceScope`, `scope_allows`, normalization and department/duty-unit/duty-post hierarchy semantics; do not infer organization-wide visibility from a missing employee ID.
- [x] Trace both participants of shift swaps and membership transitions; checking only one employee is insufficient.
- [x] Run workforce permission/schedule/read baseline tests with synthetic users having organization, department, duty-unit, duty-post and empty scopes.

## Test-first slices

| Slice | Tests prepared before code | Implementation only after source/test verification |
| --- | --- | --- |
| 2.1 Requirements defect | Existing requirements HTTP boundary: mixed departments; scoped user sees only allowed rows; organization sees all; empty scope sees none; disallowed newest rows cannot hide allowed older rows; paginate across allowed rows; reject cursor replay under changed scope | Observe actual visibility failure. Filter before `_MAX_LIMIT` and pagination; retain deterministic order and existing response shape |
| 2.2 Scope administration | `test_workforce_access_service.py`: missing user, duplicate normalized entry (`DUPLICATE_WORKFORCE_SCOPE`), stale ETag, replacement and changed ETag, audit | Move `user_scopes`, `replace_user_scopes` and normalization/ETag responsibilities without moving route commit implicitly |
| 2.3 Scoped reads | Public read services: requirements hierarchy; crew memberships and overrides exclude outsiders; exception severity order absent → missing_checkout → late → early_exit → unknown → ok, with stable employee/case tie-break | Move filters and sorting inside read functions; list functions own matching collection ETags |
| 2.4 Scoped writes | Parametrize each mutation below: allowed success, outsider gets `FORBIDDEN`/403, organization-only operation denies narrower scope, stale ETag preserves state; shift swaps deny either outsider independently | Add keyword-only scope and checks to the owning service before mutation |
| 2.5 Route/caller migration | Preserve HTTP capability-denial matrix, self attendance access, aggregate restrictions, provider/config field guards and cursor/ETag behavior | Migrate handlers individually; preserve route capability checks and non-workforce routes |

## Detailed task inventory

- [x] Implement scope administration plus `assert_scope_filter`, `intersect_coverage_scope`, `forbid_outside_scope`, `require_organization`, and explicit `organization_scope` for trusted scheduler/seed callers.
- [x] Migrate scoped read functions: exceptions, crew memberships, shift overrides, staffing requirements, shift definitions, crews/detail, attendance policies, provider people and failed queue. Classify organization-wide entities explicitly; do not invent employee scope for global configuration.
- [x] Add scope enforcement to `create_crew`, `update_crew`, `retire_crew`, `create_crew_schedule`, `replace_crew_schedule`, `create_crew_membership`, `end_crew_membership`, `create_shift_override`, `cancel_shift_override`, and `create_shift_swap`.
- [x] Add scope enforcement to `create_staffing_requirement`, `approve_staffing_requirement`, `create_attendance_policy`, `approve_attendance_policy`, and `update_provider_mapping`.
- [x] Move employee-range/punch-history scope checks into their services; preserve explicit self-view exceptions at the appropriate boundary.
- [x] Move relevant If-Match checks before side effects. Keep HTTP response headers and serialization compatible.
- [x] Delete unused route scope helpers only after every caller is migrated. Keep `_scope`, cursor fingerprint/page helpers, serializers, configuration ETag and field/capability checks where still required.
- [x] Retain HTTP payload assertions that uniquely prove security or pagination; do not delete them merely because a service test also exists.

## Verification before build and release

- [ ] Run resolved workforce and attendance test files, including `test_workforce_api_permissions.py`, requirements regressions and `test_workforce_schedule.py`; then the full backend gate.
- [x] Review every employee-bound service call for explicit scope, including background callers. Check outsider denial leaves state unchanged.
- [x] Verify public OpenAPI compatibility; use `sync-api-types` for actual route/schema changes.
- [ ] Smoke requirements pagination, crew membership, overrides, and self attendance with distinct scoped test users; denied writes must be 403.
- [ ] Rollback: reverting the refactor must retain the requirements security fix. Prefer a targeted revert that keeps slice 2.1, and rerun visibility tests before deployment.

## Execution evidence

Starting commit: `cd913c65fa5b1ffc14dcefb2d1ab744c790c8462`, in a new clean
worktree created after Phase 1 merged and deployed successfully. Slice 2.1
remains the first slice of this phase and was not expedited separately. Two Sol
builders own disjoint access/read/route and mutation/background modules; an
independent reviewer tracks coverage and checks the final diff.

Scope policy is explicit: preserve capability-global metadata reads and
integration connection-test, manual-sync and failed-queue retry actions. Move
existing organization gates for crew/policy/configuration mutations and provider
people/failed-queue lists inward. The separate `documents.generate` duty-transfer
route remains unchanged. Its duty-event read projections already enforce scope.

The Phase 1 correction service gains the workforce route's existing case-snapshot
scope enforcement at its `correct`/`revoke` boundary, retaining snapshot, ETag,
audit and transaction semantics. Punch-history application errors must remain
403/404 after authorization moves inward; only external provider failures are
sanitized to 502. Unit/post requirements continue to permit an absent department.

The leaf `services/workforce_etag.py` owns the existing canonical hashing and
precondition helpers, with byte-equivalent behavior and temporary admin-module
re-exports. This prevents cycles when admin and schedule import access. Owning
modules retain the state snapshots being hashed.

Baseline verification before application edits:

- Access/read/HTTP/correction matrix: 69 passed in 29.61 seconds.
- ETag characterization plus existing schedule/seed tests: 24 passed in 2.02
  seconds. Five tests first pinned the old admin-owned hashing/precondition
  behavior; the canonical leaf and compatibility exports then passed six tests.
- Runtime OpenAPI captured from the identical frozen Phase 1 application:
  275 paths. Final runtime comparison is exactly equal, so no generated API
  artifact changed.

The independent smoke harness uses a fresh migrated SQLite database and real
cookie logins for an administrator, a department manager, a unit manager with no
department, and a self-only employee. On frozen Phase 1 it reproduced the
requirements defect: Operations received newer Finance IDs 505/504 and 503/502
instead of its own 3/2 and 1. Existing cursor replay rejection, membership and
override filtering, self attendance, denied writes with unchanged counts, and
seven capability-global metadata reads passed.

Additional findings within these boundaries:

- Crew GET hashed rows sorted by code, while POST compared rows sorted by ID.
  With differing code/ID order, a fresh GET ETag was rejected as stale (409),
  independently reproduced through real HTTP. Read and write must share one
  canonical collection snapshot while keeping code-sorted presentation.
- Employee attendance range filters case rows but reads employee habits by ID
  without scope. Up-front current-employee authorization protects that separate
  profile data; historical case reads/corrections retain captured-snapshot scope.
- The batched `_visible_crew_memberships` route helper was unused; actual list
  and create handlers still loaded employees per row. The new read boundary
  must preserve visibility while using a batched query.

Workflow deviation: Builder B prepared eleven future-boundary tests and an
initial implementation pass as one horizontal batch. Those failures proved the
absent `scope` interface, not each authorization bypass. The coordinator caught
this and required operation-by-operation checks for the remaining work, with
separate unchanged-baseline bypass evidence. No per-slice history is claimed for
that batch. Existing unique tests are retained.

Final local verification:

| Boundary | Before / current-code evidence | Final result |
| --- | --- | --- |
| Requirement pagination | Exact-start HTTP regression returned foreign `[503, 502]` instead of `[3, 2]` | Visible pages `[3, 2]`, then `[1]`; hierarchy and cursor assertions retained |
| Override pagination | Exact-start HTTP regression returned an empty page behind 500 foreign rows | Visible older rows remain pageable |
| Crew collection ETag | Exact-start GET tag was rejected by POST with 409 when ID/code order differed | Same snapshot hashes canonically; POST returns 201 and display stays code-sorted |
| Employee range / provider history | Real HTTP baseline exposed foreign habits; provider authorization existed only in the route | Current employee authorized before profile/provider access; exact 403/404 and zero external calls |
| Scope administration / corrections | Existing baseline passed; new seam tests initially lacked their public interface | Normalization, duplicate/stale errors, audit, caller rollback and captured-case scope pass |
| Mutation families | Existing schedule/seed baseline passed; direct old foreign swap created two overrides, audits and queue rows | Both foreign legs deny before effects; allowed lifecycles, stale ETags and caller rollback pass |
| Membership batching | The unused route helper was batched, actual handlers used per-employee loads | Public rows-plus-ETag uses exactly three SELECTs at 2 and 32 memberships, including one employee batch |
| Trusted callers | Inventory found scheduler, factories and two maintenance scripts | Explicit organization scope and current collection ETags; no permissive default |

Builder A's access/read/route/correction matrix passed 102 tests in 40.04 seconds.
Builder B's ETag/admin/schedule/seed/factory matrix passed 50 tests in 4.10 seconds.
The final membership query-count addition passed its four-test file in 4.45
seconds; production code stayed frozen. Unique HTTP, lifecycle, evaluation and
factory assertions were retained.

The coordinator resolved every `backend/tests/test_*.py` whose name starts with
`test_workforce`, `test_attendance`, or `test_scheduler`, plus
`test_employee_attendance_endpoint.py`, and ran those 35 paths using:
`PYTHONDONTWRITEBYTECODE=1 GSSG_DATA_DIR=/tmp/gssg-p2-integrated /tmp/gssg-load/venv/bin/python -m pytest -q -p no:cacheprovider <resolved paths>`.
Result: **301 passed in 52.77 seconds**. The later query-count test change has its
separate focused result above.

Full local `ruff check .` reports 26 existing findings versus 27 at Phase 1;
normalized diagnostics show only one removed import-sorting finding and no new
ones. Full `mypy --no-incremental` reports the same 31 diagnostic signatures in
11 files as Phase 1. New modules and compact touched files pass format checks;
large legacy files retain their existing formatting. `git diff --check` passes.
Runtime `create_app().openapi()` is exactly equal to the frozen Phase 1 schema
across 275 paths, including component schemas. No UI, notification, or database
schema change is included.

The independent reviewer found and resolved missing positive mutation coverage,
a missed demo-script caller, missing post-denial flushes in tests, and the public
SQL-count regression. Final sign-off, real HTTP smoke and supported Windows
release gate remain pending; no build or merge is authorized by these pending
results.

Read filtering currently loads candidate rows before applying scope and cursor
pagination. This removes the visibility/starvation defects and membership N+1,
but very large candidate sets may warrant a later SQL predicate implementation.
Schedule creation checks its precondition snapshot and reloads schedules for
existing overlap/version computation under the same SQLite write lock.

Rollback uses a reviewed targeted revert PR merged and pushed before deployment.
Retain the requirement visibility fix, foreign-habits authorization and their
regressions; rerun visibility and ETag tests. This phase adds no migration or
new durable-state format. Deployment and exact production commit verification
remain pending.
