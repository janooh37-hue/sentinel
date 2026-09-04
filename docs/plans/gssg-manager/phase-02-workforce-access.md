# Phase 2 — Workforce access

Status: not started. Branch: `refactor/p2-workforce-access`. Dependency: Phase 1, except the independently extractable requirements fix in slice 2.1.

Follow [WORKFLOW.md](WORKFLOW.md). Tests and current-code verification precede every implementation slice; passing verification precedes every build.

## Outcome and boundaries

Workforce services enforce caller scope on employee-bound reads and writes. Routes retain authentication, capability and field-level policy checks, parsing, HTTP serialization and explicit transaction ownership. A pagination scope fingerprint binds a cursor; it never substitutes for filtering rows.

Agreed boundaries: `workforce_access_service`, scoped public functions in read/schedule/admin services, existing workforce HTTP routes. Keep `FORBIDDEN` and established ETag errors. Preserve self-view and aggregate permissions.

## Verify the code before writing tests

- [ ] Inspect `api/v1/workforce.py:list_requirements` and `_cursor_page`; confirm unscoped query and pre-pagination limit at the execution commit.
- [ ] Inventory every read, write, scope helper, ETag helper and scheduler/seed caller across workforce services.
- [ ] Inspect `WorkforceScope`, `scope_allows`, normalization and department/duty-unit/duty-post hierarchy semantics; do not infer organization-wide visibility from a missing employee ID.
- [ ] Trace both participants of shift swaps and membership transitions; checking only one employee is insufficient.
- [ ] Run workforce permission/schedule/read baseline tests with synthetic users having organization, department, duty-unit, duty-post and empty scopes.

## Test-first slices

| Slice | Tests prepared before code | Implementation only after source/test verification |
| --- | --- | --- |
| 2.1 Requirements defect | Existing requirements HTTP boundary: mixed departments; scoped user sees only allowed rows; organization sees all; empty scope sees none; disallowed newest rows cannot hide allowed older rows; paginate across allowed rows; reject cursor replay under changed scope | Observe actual visibility failure. Filter before `_MAX_LIMIT` and pagination; retain deterministic order and existing response shape |
| 2.2 Scope administration | `test_workforce_access_service.py`: missing user, duplicate normalized entry (`DUPLICATE_WORKFORCE_SCOPE`), stale ETag, replacement and changed ETag, audit | Move `user_scopes`, `replace_user_scopes` and normalization/ETag responsibilities without moving route commit implicitly |
| 2.3 Scoped reads | Public read services: requirements hierarchy; crew memberships and overrides exclude outsiders; exception severity order absent → missing_checkout → late → early_exit → unknown → ok, with stable employee/case tie-break | Move filters and sorting inside read functions; list functions own matching collection ETags |
| 2.4 Scoped writes | Parametrize each mutation below: allowed success, outsider gets `FORBIDDEN`/403, organization-only operation denies narrower scope, stale ETag preserves state; shift swaps deny either outsider independently | Add keyword-only scope and checks to the owning service before mutation |
| 2.5 Route/caller migration | Preserve HTTP capability-denial matrix, self attendance access, aggregate restrictions, provider/config field guards and cursor/ETag behavior | Migrate handlers individually; preserve route capability checks and non-workforce routes |

## Detailed task inventory

- [ ] Implement scope administration plus `assert_scope_filter`, `intersect_coverage_scope`, `forbid_outside_scope`, `require_organization`, and explicit `organization_scope` for trusted scheduler/seed callers.
- [ ] Migrate scoped read functions: exceptions, crew memberships, shift overrides, staffing requirements, shift definitions, crews/detail, attendance policies, provider people and failed queue. Classify organization-wide entities explicitly; do not invent employee scope for global configuration.
- [ ] Add scope enforcement to `create_crew`, `update_crew`, `retire_crew`, `create_crew_schedule`, `replace_crew_schedule`, `create_crew_membership`, `end_crew_membership`, `create_shift_override`, `cancel_shift_override`, and `create_shift_swap`.
- [ ] Add scope enforcement to `create_staffing_requirement`, `approve_staffing_requirement`, `create_attendance_policy`, `approve_attendance_policy`, and `update_provider_mapping`.
- [ ] Move employee-range/punch-history scope checks into their services; preserve explicit self-view exceptions at the appropriate boundary.
- [ ] Move relevant If-Match checks before side effects. Keep HTTP response headers and serialization compatible.
- [ ] Delete unused route scope helpers only after every caller is migrated. Keep `_scope`, cursor fingerprint/page helpers, serializers, configuration ETag and field/capability checks where still required.
- [ ] Retain HTTP payload assertions that uniquely prove security or pagination; do not delete them merely because a service test also exists.

## Verification before build and release

- [ ] Run resolved workforce and attendance test files, including `test_workforce_api_permissions.py`, requirements regressions and `test_workforce_schedule.py`; then the full backend gate.
- [ ] Review every employee-bound service call for explicit scope, including background callers. Check outsider denial leaves state unchanged.
- [ ] Verify public OpenAPI compatibility; use `sync-api-types` for actual route/schema changes.
- [ ] Smoke requirements pagination, crew membership, overrides, and self attendance with distinct scoped test users; denied writes must be 403.
- [ ] Rollback: reverting the refactor must retain the requirements security fix. Prefer a targeted revert that keeps slice 2.1, and rerun visibility tests before deployment.

## Execution evidence

Pending. Record whether 2.1 was expedited, its PR/commit, every mutation's test coverage, baseline/RED/GREEN results, code verification and release evidence.
