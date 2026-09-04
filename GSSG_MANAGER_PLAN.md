# Deepening refactor — GSSG Manager, nine phases

## Context

Architecture review (`improve-codebase-architecture`) surfaced eleven deepening candidates; the user chose to execute all of them as a phased, test-first refactor. Report: `local://architecture-review.html`. End state: each candidate collapsed into one deep module behind a small interface, tests at that interface only, old past-the-interface tests deleted, one PR per phase merged and deployed before the next phase starts. No `CONTEXT.md` or `docs/adr/` exists yet; Phase 0 creates them.

## Decisions settled with the user (do not reopen)

- One worktree branch + PR per phase; `main` deployable after each; deploy (`deploy` skill) before starting the next phase.
- Replace, don't layer: once interface tests exist, delete tests that reach past the interface (listed per phase).
- Attendance corrections keep production semantics: ETag `If-Match`, read-time overlay, no re-evaluation enqueued. Domain term **Attendance correction**; module `attendance_correction_service.py`; table `AttendanceAdjustment` and route `/adjustments` unchanged.
- Dashboard leave counts adopt `workforce_leave` liveness (deleted_at guard, `is_annual()`); one classifier in `core/leave_lifecycle.py`.
- Artifact module covers name→render→stamp→convert→place only; filing rows stay with each caller.
- Capability catalog carries EN+AR label/description + `sensitive`; `GET /auth/capabilities` readable by any authenticated user; locale JSON drops the per-capability label/description trees; nav/route membership and domain labels stay in the frontend.
- `list_requirements` is scoped like its write path.
- Outlook handoff merges into `email_service`; `outlook_handoff_service.py` deleted; IMAP connection is the injected adapter.
- Mobile record decision: dock only; in-document mobile actions removed.
- Canonical nouns: **Record** (persisted as `Book`; "General Book" is a form kind); **Attendance correction** (persisted as `AttendanceAdjustment`).
- Order: 0 domain files → 1 attendance rules → 2 workforce access → 3 capability catalog → 4 mailbox → 5 scan triage → 6 document artifact → 7 push → 8 vehicles → 9 record decision.
- Seams under test are exactly the ones listed per phase; nothing below them gets a direct test.

## Conventions for every phase

- Branch: `git worktree add ../sentinel-p<N> -b refactor/p<N>-<slug> origin/main` (never switch branches in this checkout — AGENTS.md).
- TDD loop per slice: write one failing test at the phase seam → minimal implementation → next slice. No horizontal slicing. Expected values are literals, never recomputed.
- Test placement: backend `backend/tests/test_<module>.py`; frontend colocated `*.test.tsx`. Fixtures: `db_session` (`backend/tests/conftest.py:35`, in-memory SQLite), `api_db` (`:100`, file-backed for TestClient), `make_user` (`:87`), `admin_user` (`:95`).
- Cutover rule: every caller migrated in the same PR; no aliases, re-exports, or "deprecated" shims. `__all__` lists updated. A final `grep` for each removed symbol must return only the new module and its tests.
- Schema/route changes → run `sync-api-types` skill; commit `backend/openapi.json` + `frontend/src/lib/api.types.ts`; update the hand-mirrored types in `frontend/src/lib/api.ts` where named.
- Phase gate before PR: `venv\Scripts\python.exe -m pytest` (full), `venv\Scripts\ruff.exe check .`, `venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`; frontend phases add `pnpm -C frontend exec tsc -b --noEmit` and `pnpm -C frontend test -- <changed files>`; plus the phase's smoke check. UI-string phases (3, 9) run `i18n-rtl-reviewer`; notification phases (3, 7) run `notification-template-reviewer`.
- EN and AR keys added/removed together.
- Errors: reuse `app.api.errors` classes (`NotFoundError`, `ValidationFailedError`, `ConflictError`, `AppError`); new error codes are named in the phase.

## Phase 0 — Domain files

Goal: glossary and the one ADR exist before any module is named after a term.

1. Create `CONTEXT.md` at repo root (`# GSSG Manager`, one-sentence description, `## Language`, grouped bold terms with `_Avoid_` lines). Definitions only:
   - **Record**: The approval-routed document that operators file, route, sign, and archive. Persisted as `Book`. _Avoid_: Book (in prose), entry.
   - **General Book**: One form kind a Record can carry, authored in Word or the rich editor on the single General Book template.
   - **Generated artifact**: The DOCX and its PDF produced from a template and data for a Record. Persisted as `Document`.
   - **Revision**: One committed version of a Record's artifact. Persisted as `BookVersion`.
   - **Attendance case**: One employee's expected attendance on one operational date.
   - **Automatic verdict**: The system's evaluation of an attendance case from punches, policy, and leave. Persisted as `AttendanceEvaluation`.
   - **Attendance correction**: A supervisor's replacement of an automatic verdict, overlaid at read time until revoked. Persisted as `AttendanceAdjustment`. _Avoid_: adjustment (in prose), override.
   - **Effective attendance**: The automatic verdict overlaid by the active correction.
   - **Approved attendance policy**: A `WorkAttendancePolicy` with `approved_at` set; the most specific approved policy for a case wins (shift-specific over general, then newest `effective_from`).
   - **Lifecycle-live leave**: A leave whose status makes it in force today for its kind (sick: Approved; annual: Approved; national service: Pending or Completed).
   - **Excusing leave**: A lifecycle-live leave that removes the attendance expectation for a case.
   - **Superseding leave**: A leave whose paper explains absence days, so those absence rows are removed (Sick, Annual, Leave Permit, Administrative Leave).
   - **Absence episode**: A contiguous run of absence days for one employee.
   - **Capability**: One permission key (`domain.action`) with bilingual label, sensitivity, and role defaults. _Avoid_: permission (for the key), right.
   - **Sensitive capability**: A capability that is admin-only by role: never granted per user, never requestable (`users.manage`, `system.admin`).
   - **Workforce scope**: The set of employees a user may see or change in workforce screens.
   - **Mailbox**: An IMAP account the app syncs and drafts into. Persisted as `EmailAccount`. _Avoid_: Outlook (for the account).
   - **Outlook handoff**: A drafted outgoing message parked in the mailbox Drafts folder and tracked as a pending ledger entry until sent.
   - **Scan**: An inbound file waiting to be classified and filed. Persisted as `ScanInbox`.
   - **Triage decision**: The classification of a scan — which Record or returned form it belongs to and how confident the app is.
   - **Vehicle fine / accident / maintenance event / licence renewal**: The four vehicle workflows.
2. Create `docs/adr/0001-superseding-vs-excusing-leave.md`: `# Superseding leave and excusing leave are different questions` — Context: `absence_service.SUPERSEDING_LEAVE_TYPES` (Sick, Annual, Leave Permit, Administrative Leave) and the `workforce_leave` excusing kinds (sick, annual, national service) look like drifted copies. Decision: they stay separate. Why: superseding answers "does this paper explain absence days on the timesheet" (Leave Permit does; national service is not a paper); excusing answers "is an attendance expectation removed today" (national service is; Leave Permit is a record, not an excuse). Merging the lists changes payroll-visible timesheet cells.
3. No tests. Verification: both files exist; `CONTEXT.md` contains no code identifiers except the `Persisted as` notes. Commit on `main` directly (docs only) or as the first commit of the Phase 1 branch.

## Phase 1 — Attendance rules

Branch `refactor/p1-attendance-rules`. Three slices, in order.

### Slice 1.1 — One approved-policy resolver

Seam: `attendance_policy.policy_for(db, *, operational_date: date, shift_definition_id: int | None) -> WorkAttendancePolicy | None` and `attendance_policy.policy_for_case(db, case: AttendanceCase, *, override_shift_definition_id: int | None = None) -> WorkAttendancePolicy | None` in new `backend/app/services/attendance_policy.py`.

1. RED — new `backend/tests/test_attendance_policy.py` on `db_session`; seed `WorkAttendancePolicy` rows directly; literal assertions:
   - approved general policy (`approved_at` set) effective 2026-01-01 → `policy_for(operational_date=date(2026,3,1), shift_definition_id=None)` returns it; `approved_at=None` → `None`.
   - shift-specific approved policy beats a newer general one for that shift; general wins for another shift id.
   - two approved general policies: newer `effective_from` wins; equal `effective_from`: higher id wins.
   - `effective_to == operational_date` → excluded (half-open window).
   - `policy_for_case`: case with occurrence shift A and `override_shift_definition_id=B` → shift-A policy; case without occurrence, override B → shift-B policy.
2. GREEN — SQL form from `attendance_evaluation_service.effective_policy` (`:98-117`): `approved_at IS NOT NULL`, `effective_from <= d`, `effective_to IS NULL OR effective_to > d`, `shift_definition_id IS NULL OR == sid`, `order_by(shift_definition_id.is_not(None).desc(), effective_from.desc(), id.desc()).first()`. No `approved_by_user_id` condition (approval sets both together, `workforce_admin_service.py:257-258`). `policy_for_case` resolves `sid = occurrence.shift_definition_id or override_shift_definition_id` (rule from `attendance_punch_service.py:67-75`).
3. Cutover: delete `attendance_punch_service._effective_policy` (`:34-64`) and `_case_shift_definition_id` (`:67-75`); caller `:101-104` → `policy_for_case(db, case, override_shift_definition_id=<the value it already computes>)`. Delete `attendance_queue_service._effective_policy_for_case` (`:130-157`); caller `:188` → `policy_for_case(db, case)`. Delete `attendance_evaluation_service.effective_policy` (`:89-118`); callers `:452`, `workforce_read_service.py:311,384` → `policy_for_case(db, case)`; remove `"effective_policy"` from `__all__` (`:924`). Grep `effective_policy` → only the new module and its test.
4. `test_attendance_punch_allocation.py`, `test_attendance_queue_service.py`, `test_attendance_evaluation_service.py` unchanged and green.

### Slice 1.2 — One lifecycle-live leave classifier

Seam: `leave_lifecycle.live_kind(leave_type: str, status: str, *, deleted: bool) -> Literal["national_service","sick","annual"] | None` in `backend/app/core/leave_lifecycle.py`; add it and the already-public `english_part` to `__all__` (`:197-213`).

1. RED — extend `backend/tests/test_leave_lifecycle.py` with a parametrised table: `("Sick Leave","Approved",False)→"sick"`; `("Sick Leave","Pending",False)→None`; `("Annual Leave","Approved",False)→"annual"`; `("National Service","Pending",False)→"national_service"`; `("National Service","Completed",False)→"national_service"`; `("Leave Permit","Approved",False)→None`; `("Sick Leave","Approved",True)→None`; `("Sick Leave - الإجازة المرضية","Approved",False)→"sick"`.
2. GREEN — body = `workforce_leave._excusing_reason` (`:65-76`) mapped to kinds: `deleted→None`; `classify_group=="national_service" and canonical_status in {"Pending","Completed"}→"national_service"`; `group=="sick" and status=="Approved"→"sick"`; `is_annual(leave_type) and status=="Approved"→"annual"`; else `None`.
3. Cutover: `workforce_leave._excusing_reason` (`:58-76`) → `{"national_service":"LEAVE_NATIONAL_SERVICE","sick":"LEAVE_SICK","annual":"LEAVE_ANNUAL"}.get(live_kind(leave.leave_type, leave.status, deleted=leave.deleted_at is not None))`; keep `_REASON_PRIORITY`. Delete `workforce_dashboard_service._leave_kind` (`:104-116`); `_live_leaves` (`:119-137`) calls `live_kind(row.leave_type, row.status, deleted=row.deleted_at is not None)`; priority map `:121` unchanged.
4. RED (dashboard seam, drift made observable) — in `backend/tests/test_workforce_dashboard_api.py` using `workforce_api_db`, `_add_employee`, `_seed_coverage_cases` (`:78-132`): an employee whose Approved Sick Leave has `deleted_at` set is not counted in the snapshot's sick bucket. GREEN by step 3.
5. `test_workforce_leave_precedence.py` unchanged and green.

### Slice 1.3 — One attendance correction module

Seam: new `backend/app/services/attendance_correction_service.py` exporting exactly:
- `correct(db, *, case_id: int, snapshot: Mapping[str, object], if_match: str | None, actor: User) -> AttendanceAdjustment` — body `workforce_admin_service.apply_adjustment` `:400-442` (same `NotFoundError("ATTENDANCE_CASE_NOT_FOUND", …)`, `require_if_match`, full-snapshot validation, audit; no commit).
- `revoke(db, *, case_id: int, adjustment_id: int, reason: str, if_match: str | None, actor: User, now: datetime | None = None) -> AttendanceAdjustment` — body `:444-459`.
- `active_correction(rows: Sequence[AttendanceAdjustment]) -> AttendanceAdjustment | None` (= `active_attendance_adjustment` `:309`).
- `active_corrections(db, case_ids: Iterable[int]) -> dict[int, AttendanceAdjustment]` (= `:320`).
- `overlay(automatic: Mapping[str, Any], correction: AttendanceAdjustment | None) -> dict[str, Any]` (= `overlay_attendance_adjustment` `:345`).
- `case_etag(db, case_id: int) -> str` (= `:392`), `case_etag_for(*, case_id, latest, active) -> str` (= `:378`).
`require_if_match` (`:75`) and `row_etag` (`:64`) stay in `workforce_admin_service` (generic; 12 other routes use them).

1. RED — `backend/tests/test_attendance_correction_service.py` on `db_session` with `build_attendance_day` (`backend/tests/factories/attendance.py:88`): (a) `correct` with `if_match=case_etag(db, case.id)` and `snapshot={"replacement_presence_state":"completed","reason":"Supervisor register", …full snapshot}` → `overlay(auto, row)["presence_state"] == "completed"`; (b) `if_match="stale"` → `ConflictError`; (c) second `correct` → `active_correction(rows).id` is the newer id; (d) `revoke` → `active_correction` is `None`, `overlay` returns the automatic `presence_state`. Move the direct-service cases from `test_workforce_attendance_corrections_api.py:200-215,431-520,649-674` into this file; HTTP cases there stay (route path unchanged).
2. GREEN — move bodies; remove from `workforce_admin_service.__all__` (`:461-478`): `apply_adjustment`, `revoke_adjustment`, `active_attendance_adjustment`, `active_attendance_adjustments`, `attendance_case_etag`, `attendance_case_etag_for`, `overlay_attendance_adjustment`.
3. Cutover callers: `api/v1/workforce.py:626,635,628,637`; `workforce_read_service.py:37-42` (imports), `:97,126,302,375,465,598,624`; `workforce_dashboard_service.py:36-39`, `:275,289,363,365,782,825`; `test_workforce_dashboard_api.py:275,288,328,333`.
4. Delete the dead path: `attendance_evaluation_service.py:646-905` (`EffectiveAttendance`, `_active_adjustment`, `get_effective_attendance`, `apply_adjustment`, `revoke_adjustment`), `__all__` entries `:922,923,926,929`; delete `test_attendance_evaluation_service.py:286-350`. Keep the punch re-export at `:916`. Grep `apply_adjustment|revoke_adjustment|get_effective_attendance|EffectiveAttendance` → only the new module, its test, and the route.

### Verification (Phase 1)

- `venv\Scripts\python.exe -m pytest backend/tests/test_attendance_policy.py backend/tests/test_leave_lifecycle.py backend/tests/test_attendance_correction_service.py backend/tests/test_workforce_attendance_corrections_api.py backend/tests/test_workforce_dashboard_api.py backend/tests/test_attendance_punch_allocation.py backend/tests/test_attendance_queue_service.py backend/tests/test_attendance_evaluation_service.py backend/tests/test_workforce_leave_precedence.py`, then the full gate.
- Smoke: employee attendance drawer → submit a correction → reload shows it; resubmit from a stale tab → conflict toast. Dashboard sick tile count unchanged for live leaves.

## Phase 2 — Workforce access

Branch `refactor/p2-workforce-access`. Goal: each `api/v1/workforce.py` handler is parse → `Depends(require_capability)` → one module call → serialise; scope is a keyword-only parameter of every module function that reads or writes employee-bound rows.

### Interface

New `backend/app/services/workforce_access_service.py` (replaces route helpers `_scope_rows/_scope_payload/_scope_etag` at `workforce.py:102-334`):
- `user_scopes(db, user_id: int) -> tuple[list[UserWorkforceScope], str]` (rows, etag); `NotFoundError("USER_NOT_FOUND", "User was not found.")`.
- `replace_user_scopes(db, *, user_id: int, scopes: Sequence[WorkforceScopeWrite], if_match: str | None, actor: User) -> tuple[list[UserWorkforceScope], str]` (`WorkforceScopeWrite` from `backend/app/schemas/workforce.py:191`) — body from `workforce.py:432-445` (normalize via `normalize_scope_entry(**scope.model_dump())`, `ValidationFailedError("DUPLICATE_WORKFORCE_SCOPE", …)`, delete+insert, `AuditLog(action="workforce.scope.replaced", …)`); no commit (route commits).
- `assert_scope_filter(scope, *, department, duty_unit, duty_post) -> WorkforceScope` (= `_assert_scope_filter` `:149-163`) and `intersect_coverage_scope(scope, *, department, duty_unit) -> WorkforceScope` (= `:165-185`); both raise the same `AppError("FORBIDDEN", "Requested filter is outside workforce scope.", http_status=403)`. Used by `create_staffing_requirement`, `approve_staffing_requirement`, `get_coverage_children`.
- `organization_scope() -> WorkforceScope` = `WorkforceScope(entries=(WorkforceScopeEntry(scope_kind="organization", department=None, duty_unit=None, duty_post=None),))` for `scheduler_service.py:232` and `workforce_seed_service.py:244`.
- `forbid_outside_scope(db, scope: WorkforceScope, *, employee_id: str) -> Employee` and `require_organization(scope: WorkforceScope, *, message: str) -> None`, raising `AppError("FORBIDDEN", <message>, http_status=403)` exactly as the route helpers do today (bodies and messages verbatim from `_require_employee_schedule_scope` `:214-238` — "The employee is outside the assigned workforce scope." — and `_require_organization_schedule_scope` `:188-196` / `_require_organization_workforce_scope` `:198-212`). Keep the `"FORBIDDEN"` code: no `ForbiddenError` class exists and the frontend keys on the code.

`workforce_read_service.py`:
- `list_exceptions(db, *, scope, operational_date, presence, exception)` returns rows sorted by the severity key now inline at `workforce.py:461-473` (absent 0, missing_checkout 1, late 2, early_exit 3, unknown 4, else 5; tie-break `employee_id`, `case_id`). Route drops the sort.
- `list_crew_memberships(db, *, crew_id, scope)` applies `scope_allows` (replaces hand filters `workforce.py:959-969`, `:1024-1034`; delete dead `_visible_crew_memberships` `:282`).
- New: `list_shift_overrides(db, *, scope)` (from `:1090-1108`); `list_shift_definitions`, `list_crews`, `crew_detail`, `list_attendance_policies`, `list_provider_people`, `list_failed_queue` (from inline queries `:649-730`, `:1199-1205`, `:1274-1300`) each returning `(items, etag)`.
- `list_staffing_requirements(db, *, scope)` filters with `scope_allows(scope, employee_id="", department=row.department, duty_unit=row.duty_unit, duty_post=row.duty_post)` — same predicate as the write path (`:1165-1170`).

`workforce_schedule_service.py` / `workforce_admin_service.py`: every mutating function gains `scope: WorkforceScope` (keyword-only) and performs the check the route did: `create_crew`, `update_crew`, `retire_crew`, `create_crew_schedule`, `replace_crew_schedule`, `create_crew_membership`, `end_crew_membership`, `create_shift_override`, `cancel_shift_override`, `create_shift_swap`, `create_staffing_requirement`, `approve_staffing_requirement`, `create_attendance_policy`, `approve_attendance_policy`, `update_provider_mapping`. `require_if_match` calls at `workforce.py:742,869,905,1035,1072,1126` move into the functions.

Capability checks stay in routes (they are HTTP-level: `has_capability` branches at `workforce.py:342-345`, `:519-526`, `:572-585`, `:1361-1383` remain, computing flags). What moves is the scope check that follows them: `workforce_dashboard_service.get_workforce_snapshot(db, *, scope, self_employee_id, include_aggregate)` already has this shape (`:346`) — unchanged; `workforce_read_service.employee_attendance_range(db, *, scope, employee_id, …)` and `attendance_history_service.employee_punch_history(db, *, scope, employee_id, …)` gain `scope` and call `forbid_outside_scope` internally (replacing the route's `_require_employee_schedule_scope` call at `:585` and its equivalent at `:527-535`). `settings_service.update_workforce_configuration` is unchanged; the route keeps its field-level capability guards.

After cutover the route module keeps exactly: `_scope`, `_scope_fingerprint`, `_cursor_page`, `_set_etag`, `_crew_read`, `_provider_read`, `_queue_read`, `_configuration_etag`, `_require_management`, `_is_own_employee`, and the `get_attendance_provider` dependency (`:539-552`). Deleted from `:102-334`: `_scope_rows`, `_scope_payload`, `_scope_etag`, `_assert_scope_filter`, `_intersect_coverage_scope`, `_require_organization_schedule_scope`, `_require_organization_workforce_scope`, `_require_employee_schedule_scope`, `_visible_crew_memberships`, `_crew_collection_etag`, `_crew_schedule_collection_etag`, `_crew_membership_collection_etag` (the three collection etags move next to the list functions that return `(items, etag)`). `books.py:583`, `documents.py:107,404,562` untouched (non-goal).

### TDD slices (one module function per cycle, this order)

RED at the module seam on `db_session` with `build_attendance_day` / `_seed_coverage_cases`, passing a `WorkforceScope` literal; GREEN moves the body.
1. `list_exceptions` — seeded cases yield the literal order `["absent","missing_checkout","late","early_exit","unknown","ok"]`.
2. `replace_user_scopes` — duplicate entry → `ValidationFailedError` code `DUPLICATE_WORKFORCE_SCOPE`; wrong `if_match` → `ConflictError`; success returns the new rows and a different etag.
3. `list_staffing_requirements` — department-scoped scope sees only its department's rows; `organization_scope()` sees all.
4. `list_crew_memberships`, `list_shift_overrides` — out-of-scope employee rows excluded.
5. Each mutating function — out-of-scope employee → `AppError` with `code == "FORBIDDEN"` and `http_status == 403`; organization-only op with a department scope → same; happy path unchanged.
6. Route cutover handler by handler; `test_workforce_api_permissions.py` keeps its capability-denial matrix and drops payload-content assertions now covered above; add one TestClient test: department-scoped user `GET /api/v1/workforce/requirements` → only that department's rows.

### Verification (Phase 2)

- `pytest backend/tests/test_workforce_*.py backend/tests/test_attendance_*.py backend/tests/test_workforce_schedule.py` then the full gate.
- Smoke: crews, overrides, requirements pages load; scoped user creating an override for an out-of-scope employee → 403.

## Phase 3 — Capability catalog

Branch `refactor/p3-capability-catalog`.

### Catalog shape

`backend/app/core/permissions.py:31-37`:
`Capability(NamedTuple): id: str; domain: str; label_en: str; label_ar: str; description_en: str; description_ar: str; sensitive: bool = False`.
`SENSITIVE_CAPABILITY_IDS: Final[frozenset[str]] = frozenset(c.id for c in CAPABILITIES if c.sensitive)`; add to `__all__` (`:470-482`). Fill `label_ar`/`description_ar` for all 56 entries verbatim from `frontend/src/locales/ar.json` keys `access.permissions.caps.<id>` (`:4193-4264`) and `perms.caps.<id>.desc` (`:4296-4352`); `label_en`/`description_en` = current `label`/`description`. `users.manage`, `system.admin` → `sensitive=True`. Domain labels remain in locale JSON (`access.permissions.domains.*`).

`backend/app/schemas/auth.py:146-153` `CapabilityRead`: `id, domain, label_en, label_ar, description_en, description_ar, sensitive: bool, default_roles`. Dynamic entries (`api/v1/auth.py:360-393`) set `label_ar=label_en`, `description_ar=description_en`, `sensitive=False`.

`api/v1/auth.py:345` `list_capabilities`: `require_admin` → `get_current_user`.

### TDD slices

1. RED `backend/tests/test_permissions_catalog.py`: every entry's `label_ar` and `description_ar` contain a char in `\u0600-\u06FF`; `SENSITIVE_CAPABILITY_IDS == frozenset({"users.manage","system.admin"})`. GREEN: catalog edit.
2. RED (TestClient on `api_db`, operator via `make_user`): `GET /api/v1/auth/capabilities` → 200; entry `employees.view` has `label_ar` equal to the literal copied from `ar.json` and `sensitive is False`; `users.manage` → `sensitive is True`. GREEN: dependency + schema.
3. Keep `test_permission_request_service.py:23-27` and `test_permissions_bulk_api.py:100-108` green while deleting `perm_service._SENSITIVE_CAPS` (`:41`, used `:214-225`) and `permission_request_service._SENSITIVE` (`:13`, used `:31-33`) in favour of `SENSITIVE_CAPABILITY_IDS`.
4. RED `backend/tests/test_admin_notify.py`: the `"ar"` body for `employees.view` contains the Arabic label literal and not `"View employees"`. GREEN: `admin_notify.notify_admins_new_request(db, requester, *, label_en: str, label_ar: str, request_id: int)`; caller `permission_request_service.py:53-62` resolves the `Capability` by id (fallback `dynamic_capability_label(db, id)` for both languages); move the local imports at `:54,60` to module top (`admin_notify` does not import `permission_request_service`; no cycle).
5. Remove `capability_label` from `PermissionRequestRead` (schema) and `_to_read` (`api/v1/permissions.py:41-45,52`); run `sync-api-types`.
6. Frontend `frontend/src/lib/useCapabilityCatalog.ts`: `useQuery({ queryKey: ['capability-catalog'], queryFn: () => api.listCapabilities(), enabled: status === 'authed', staleTime: 5 * 60_000 })` → `{ byId: Map<string, CapabilityRead>, labelOf(id): string, descriptionOf(id): string, isSensitive(id): boolean, isLoading }`; `labelOf` returns `label_ar` when `i18n.language.startsWith('ar')` else `label_en`, and the id while loading. Update the hand-mirrored `CapabilityRead` in `lib/api.ts:449-458`.
7. Cutover: `components/shell/CapabilityGate.tsx:33` delete `SENSITIVE_CAPS`, `:62-80` replace its own query with the hook and `isSensitive`; `RequireCapability.tsx:17-20` delete `NON_REQUESTABLE`, `:39-45` use `isSensitive`; `components/access/AdvancedPermissionsPanel.tsx:29-36,128-129,182-185,270-277`, `PermissionRequestsTab.tsx:107,233-236,317`, `pages/access/PermissionsPage.tsx:568-571` replace `t('access.permissions.caps.<id>')` / `t('perms.caps.<id>.desc')` with `labelOf`/`descriptionOf`. Keep `t('access.permissions.domains.<domain>')`.
8. Delete locale trees `access.permissions.caps` (`en.json:3879-3950`, `ar.json:4193-4264`) and `perms.caps` (`en.json:3982-4038`, `ar.json:4296-4352`); delete `frontend/src/locales/permissions.i18n.test.ts`. `timesheet.i18n.test.ts:308-334` must stay green (pins timesheet keys only).
9. Frontend RED/GREEN: `components/perms/CapabilityGate.test.tsx:117-134` and `components/shell/RequireCapability.test.tsx:45-73` mock `api.listCapabilities` returning `[{ id: 'users.manage', sensitive: true, label_en: 'Manage users', label_ar: '…', … }]`; assert no lock affordance / "administrator-managed" copy. `PermissionsPage.test.tsx:165` and `PermissionRequestsTab.test.tsx:92` fixtures gain the new fields.

### Verification (Phase 3)

- `pytest backend/tests/test_permissions_catalog.py backend/tests/test_permission_request_service.py backend/tests/test_permissions_bulk_api.py backend/tests/test_admin_notify.py backend/tests/test_mirror_permissions_backend.py backend/tests/test_capabilities_api_description.py` + full gate; `pnpm -C frontend test -- CapabilityGate RequireCapability PermissionsPage PermissionRequestsTab`; `tsc -b --noEmit`.
- New behaviour: operator under AR opens a gated page → lock affordance shows the Arabic label; `POST /api/v1/permissions/requests` for `users.manage` → 400.
- Run `i18n-rtl-reviewer` and `notification-template-reviewer`.

## Phase 4 — Mailbox

Branch `refactor/p4-mailbox`. Goal: `email_service` is the one mailbox module; `outlook_handoff_service.py` deleted; the IMAP connection is an injected adapter with an in-memory fake.

### Interface (`backend/app/services/email_service.py`)

- `class ImapConnection(Protocol)`: `append(mailbox: str, flags, date_time, message: bytes)`, `create(mailbox)`, `login`, `list`, `select`, `search`, `fetch`, `noop`, `logout` — exactly the `imaplib.IMAP4` methods the module calls (`:358-375`, `:600-694`, `:847-1000`, `outlook_handoff_service.py:99-116`).
- `type Connector = Callable[[EmailAccount], ImapConnection]`; module default `connect_imap(account) -> imaplib.IMAP4` (= current `_connect` `:358`). Every public function that opens a connection takes `*, connector: Connector = connect_imap`: `test_connection`, `sync_now`, `sync_all_accounts`, `draft_outgoing`.
- `draft_outgoing(db, *, owner_user_id, to, cc, subject, html, mode, related_book_id, related_employee_id, in_reply_to, references, use_signature, attachments: list[HandoffAttachment], connector: Connector = connect_imap) -> LedgerEntry` — body = `outlook_handoff_service.create_handoff` (`:119-248`) using the now-local helpers directly (no `email_service._x` prefixes).
- `reconcile_sent_entry(db, *, entry, msg, account) -> None` and `flag_stale_handoffs(db, *, account) -> None` — bodies from `:357-418`, `:420-451`; called from `_sync_account_locked` at `:976-981`, `:994` without the dynamic imports (`:547`, `:974`, `:992` become plain in-module calls).
- Private helpers move with their callers: `_attachment_content_type`, `_plain_text`, `_is_ok`, `_remove_saved_attachments`, `_append_draft(conn, account, message)`, `_tag_filter`, `_live_pending_by_id`, `_find_pending_match`, `_resolve_book` (`outlook_handoff_service.py:53-342`). `HandoffAttachment` moves to `backend/app/schemas/email.py`.
- Add `__all__` to `email_service` listing only public names.

### TDD slices

1. RED — move `_FakeImap` from `test_outlook_handoff.py:133-151` to `backend/tests/fakes/imap.py` as `FakeImap` implementing `ImapConnection` (add `login/noop/list/select/search/fetch/logout` no-ops returning `("OK", [])`), plus fixture `fake_imap` in `conftest.py` returning a `(connector, instance)` pair. Rewrite each of the 10 tests in `test_outlook_handoff.py` → `backend/tests/test_email_service.py` to call `email_service.draft_outgoing(..., connector=fake_imap.connector)` and the HTTP route; delete the two `monkeypatch.setattr(email_service, "_connect", …)` at `:218,283`. Assertions unchanged (literal subjects, tags `outlook-pending`, saved attachment paths, reconciliation outcomes at `:361-603`).
2. GREEN — move functions; route `api/v1/email.py:177` calls `email_service.draft_outgoing(...)` (default connector). Response schema `EmailHandoffResult` unchanged; HTTP contract unchanged; no `sync-api-types` needed (assert `openapi.json` diff is empty).
3. Delete `backend/app/services/outlook_handoff_service.py`; grep `outlook_handoff_service` → 0 hits. `test_granular_permits_ledger_gates.py:157-177` stays green (HTTP).

### Verification (Phase 4)

- `pytest backend/tests/test_email_service.py backend/tests/test_granular_permits_ledger_gates.py backend/tests/test_scheduler_notify.py` + full gate.
- Smoke: ledger → Outlook handoff dialog → create draft → Drafts folder in the mailbox shows it; sent-mail sync flips the pending entry.

## Phase 5 — Scan triage and filing

Branch `refactor/p5-scan-triage`. Goal: one classification module with an injected OCR adapter; one filing module; the queue drain and the manual intake route are two callers of the same interface.

### Interface

`backend/app/core/extraction/ocr.py` gains the single raw-bytes entry `read_document(raw: bytes) -> DocumentText` where `DocumentText(text: str, qr_refs: list[str])`: `%PDF` → `text_from_pdf`, else `extract_text(load_image(raw)).text`; QR via `qr_refs_from_bytes`; runs under `OCR_GATE`; raises `OcrUnavailableError`/`InvalidImageError` unchanged. This replaces the two route copies (`api/v1/intake.py:42-54`, `api/v1/extractions.py:31-`) and the inline block in `scan_inbox_service.py:119-122`. `type Reader = Callable[[bytes], DocumentText]`.

`backend/app/services/scan_triage_service.py` becomes the classification module:
- `classify(db, *, raw: bytes, employees: list[_Emp], reader: Reader = ocr.read_document) -> TriageDecision` — reads, then applies the existing `route(...)` rules (`:57-137`) with intake's exact/fuzzy precedence folded in: QR refs → OCR `candidate_refs` exact live-Book hit (the block now duplicated at `scan_triage_service.py:57-68` and `intake_service.py:42-75` exists once here), then stamped-token canonical/edit-distance matching (`intake_service.py:77-121`), then external pipeline (`:123-124`). `TriageDecision` (`:29`) unchanged; it gains `mode: Literal["book","returned_form","external"]` so the intake route can build its discriminated response.
- `classify_text(db, *, text: str, qr_refs: list[str], employees) -> TriageDecision` — the pure part (no OCR), used by `classify` and by tests.
- Delete `intake_service.py` entirely (`IntakeResult` replaced by `TriageDecision.mode` + existing fields); `api/v1/intake.py:57-145` calls `classify(db, raw=..., employees=...)` and maps `mode` to its current response shapes; size-check/422/503 mapping stays in the route.

`backend/app/services/scan_inbox_service.py` becomes the filing module: `drain_pending(db, *, limit=20, reader: Reader = ocr.read_document)`; `_process_one` calls `scan_triage_service.classify(db, raw=raw, employees=employees, reader=reader)`; `confirm/route_item/dismiss/undo/list_items/counts/get_item/abs_file_path` unchanged. `api/v1/extractions.py` uses `ocr.read_document(raw).text`.

### TDD slices

1. RED `backend/tests/test_ocr_read_document.py`: a one-page PDF fixture bytes (`backend/tests/fixtures/` — reuse an existing PDF fixture if present, else generate with `reportlab`-free minimal PDF literal) → `read_document` returns `text` containing a known literal; a PNG with a QR encoding `"GB-0001"` → `qr_refs == ["GB-0001"]`. Skip-marked when `tesseract_available()` is `False`. GREEN: implement `read_document`.
2. RED `backend/tests/test_scan_triage_service.py` (`db_session`, seeded `Book` rows): `classify_text(text="Ref GB-0001", qr_refs=[])` with a live book `GB-0001` → `tier=="auto"`, `proposed_book_id==book.id`, `mode=="book"`; awaiting-scan book → `tier=="confirm"`; typo `"GB-0O01"` (edit distance 1, same digits) → the book with `tier=="confirm"`; no match and no employee → `tier=="manual"`, `mode=="external"`. Port `test_triage_candidates.py:15-34` here without the `run_intake` monkeypatch; delete that file.
3. RED `backend/tests/test_scan_inbox_service.py` (`db_session`, `tmp_path` data dir): enqueue a scan whose `reader` fake returns `DocumentText("GB-0001", [])` for a live book → after `drain_pending(db, reader=fake)`, item state `auto_filed`, `Book.attachments` contains the file, `undo` returns it to confirmation and detaches; a reader raising `OcrUnavailableError` twice leaves `pending` with `attempts==2`, a third time → `error`. GREEN: wire `reader` through.
4. Cutover: delete `intake_service.py`, both `_ocr_file` copies; `scheduler_service.py:130` unchanged (default reader). Grep `run_intake|_ocr_file|IntakeResult` → 0 hits. `openapi.json` unchanged (route responses keep their shape).

### Verification (Phase 5)

- `pytest backend/tests/test_ocr_read_document.py backend/tests/test_scan_triage_service.py backend/tests/test_scan_inbox_service.py backend/tests/test_scan_inbox_document.py backend/tests/test_scan_inbox_nplus1.py backend/tests/test_scanback_*.py` + full gate.
- Smoke: email a PDF with a stamped ref to the mailbox → scan inbox shows it auto-filed on the record within one drain tick; manual intake upload of a returned form → returned-form response.

## Phase 6 — Document artifact

Branch `refactor/p6-document-artifact`. Goal: one artifact module owns name → render → stamp → convert → place; `generate_document`, its companion loop, `render_signed_pdf`, and `word_book_service` are its four callers; the PDF converter is an injected adapter with a fake.

### Interface — new `backend/app/core/artifact.py` (core may import `app.config`; see `crypto.py:20`)

- `type Converter = Callable[[Path], Path | None]`; default `_pdf_executor.convert_docx_to_pdf` is imported lazily inside `produce` to keep `core` free of `services` at import time (mirror the existing lazy pattern at `docx_engine.py:817-820`).
- `@dataclass(frozen=True) class Stamps: ref_number: str | None = None; ref_style: str = STAMP_STYLE_HEADER; aztec_ref: str | None = None; aztec_corner: str = "top-left"; general_book_footer: bool = False`.
- `@dataclass(frozen=True) class Artifact: docx_path: Path; pdf_path: Path | None; conversion_error: str | None`.
- `produce(*, template_id: str, data: Mapping[str, Any], output_dir: Path, name_en: str, timestamp: datetime, stamps: Stamps, templates_dir: Path, library_template: Path | None = None, converter: Converter | None = None, convert: bool = True) -> Artifact`:
  1. filename = `_build_docx_filename` logic (`document_service.py:435-441`) → `Vault.collision_safe_name(output_dir, filename)`;
  2. render: `DocxEngine(templates_dir).fill_general_book_path(library_template, data, path, sandboxed=True)` when `library_template` else `.fill(template_id, data, path)`;
  3. stamps in this order: `_postprocess_general_book_footer(path)` if `general_book_footer`; `stamp_ref_number(path, ref_number, ref_style)` if `ref_number`; `stamp_aztec_code(path, aztec_ref, corner=aztec_corner)` if `aztec_ref`;
  4. if `convert`: `pdf = converter(path)` inside `try/except Exception as exc` → `conversion_error=str(exc)`, `pdf=None`; log as today (`document_service.py:1467-1489`).
  Callers decide what a `None` pdf means (raise `GENERATION_PDF_FAILED` / `INCLUDED_PAPERS_PDF_REQUIRED`, or continue DOCX-only) — that policy stays with them.
- `output_dir_for(template_id: str, employee_g: str | None, vault: Vault) -> Path` = `Vault.form_output_dir` or `_output_dir_for_admin` (`document_service.py:443-449`, `:1317-1323`).

### TDD slices

1. RED `backend/tests/test_artifact.py` (`tmp_path`, real `backend/templates`): `produce(template_id="General Book", data={...minimal…}, converter=fake_pdf)` where `fake_pdf` writes `b"%PDF-fake"` next to the docx → `Artifact.pdf_path.exists()`, docx exists, filename matches `^GeneralBook_.*\.docx$` literal pattern from `_build_docx_filename`; second call same inputs → collision-safe suffix; `converter` raising → `pdf_path is None`, `conversion_error` is the message; `stamps.ref_number="GB-0007"` → the docx XML contains `GB-0007`. Add `fake_pdf_converter` fixture to `conftest.py` returning that callable.
2. GREEN: implement `artifact.py`.
3. Cutover `generate_document`: steps 8–10 (`document_service.py:1396-1489`) → one `artifact.produce(...)` call; companion loop (`:1902-1929`) → `produce(..., stamps=…)`; `render_signed_pdf` rich path (`:2227-2255`) → `produce(...)`. Delete `_build_docx_filename`, `_output_dir_for_admin` from `document_service` (moved). `generate_document` gains `converter: Converter | None = None` (keyword) and threads it to `produce`; `render_signed_pdf` likewise.
4. Cutover `word_book_service`: `:40-44` import `artifact` instead of the privates; `:186-197` initial render → `produce(..., convert=False)`; finish (`:382-417`) → `produce(..., convert=True)` replacing the manual collision loop and copy; preview (`:646-655`) → `produce(..., convert=True)`. `finish`/`preview` gain `converter` keyword.
5. Tests: every `monkeypatch.setattr(... "convert_docx_to_pdf" ...)` listed in the inventory (`test_book_text.py:236-239`, `test_document_generation_included_papers.py:47`, `test_general_book_classified_ref.py:30`, `test_included_papers_service.py:215`, `test_inmate_violations_default_signing.py:47`, `test_inmate_violations_report_datetime.py:55`, `test_leave_return_signature.py:37`, `test_mirror_permissions_backend.py:1868`, `test_permit_approval_flow.py:46,349-350`, `test_permit_book_generation.py:35,172-206`, `test_permit_manager_signature.py:64`, `test_permits_service.py:36`, `test_timesheet_api.py:956`, `test_vehicle_letters.py:74`, `test_word_book_finish.py:105-411`, `test_word_book_preview.py:55-277`, `test_word_book_reopen.py:200-202`, `test_word_book_sign.py:71,192`) → pass `converter=fake_pdf_converter` (or, for HTTP tests, a `conftest` autouse fixture `fast_pdf` that sets `artifact.DEFAULT_CONVERTER = fake` — one named module attribute is the internal seam; document it in `artifact.py`). Delete the engine-internal patches at `test_word_book_sign.py:119,191,193,194-195` and replace those tests with behaviour through `render_signed_pdf`/`finish` using the fake converter (assert on returned paths/exception codes only).
6. `included_papers_service.py:359-370` keeps calling `convert_docx_to_pdf` directly (it converts an existing docx, not a template render) — non-goal. Vehicle letters unchanged (already through `generate_document`).

### Verification (Phase 6)

- `pytest backend/tests/test_artifact.py backend/tests/test_word_book_*.py backend/tests/test_document_*.py backend/tests/test_general_book_*.py backend/tests/test_permit_*.py backend/tests/test_vehicle_letters.py` + full gate. Grep `monkeypatch.setattr(.*convert_docx_to_pdf` → 0 hits.
- Smoke (Windows host with Word): generate a Leave Application → DOCX + PDF in the employee vault, ref stamped, Aztec present; finish a Word-authored General Book → PDF present; bug #61 formatting still preserved (compare with a pre-phase render).

## Phase 7 — Push

Branch `refactor/p7-push`. Goal: `push_service` is the one push module (subscriptions, bilingual copy, dedup, delivery); the scheduler only schedules; delivery is an adapter with a fake.

### Interface (`backend/app/services/push_service.py`)

- `class Deliverer(Protocol): def __call__(self, *, subscription: PushSubscription, title: str, body: str, url: str) -> None` raising `PushGone` (404/410) or `PushError`. Default `WebPushDeliverer` wraps `pywebpush.webpush` (`:126-145`). Module attribute `deliverer: Deliverer = WebPushDeliverer()` is the one internal seam; `conftest.py` fixture `push_outbox` replaces it with `FakeDeliverer` (records `(user_id, locale, title, body, url)`) for the test's duration.
- Public: `store_subscription`, `remove_subscription`, `send_to_user(db, user_id, messages, url="/") -> int` (unchanged signature; uses `deliverer`), `compose_actionable(kind: str, items: list[ActionableItem], section_url: str) -> tuple[dict[str, tuple[str,str]], str]` (= `scheduler_service._build_push` `:617` plus `_email_push/_doc_push/_scan_push/_scanback_push/_ar_records_waiting/_attachments_line/_localized` `:487-616`), `notify_actionable(db, user: User) -> int` (= `_notify_user` `:632-653`; returns pushes sent), `notify_all_active(db) -> int` (= `_run_push_notifier` body `:656-669` minus session management). `sent_refs/mark_sent/prune_sent` become private.
- `scheduler_service._run_push_notifier` becomes: open `SessionLocal`, `push_service.notify_all_active(db)`, close. `_run_pending_departure_flip` (`:720-769`) keeps its copy but calls `send_to_user` (unchanged).
- Callers unchanged in shape: `admin_notify.py:25`, `vehicle_reminder_service.py:39`, `included_papers_service.py:1248`.

### TDD slices

1. RED `backend/tests/test_push_service.py`: port every case from `test_push_copy.py:19-109` and `test_scanback_push.py:21-73` to call `push_service.compose_actionable(...)` (public) with the same literal expected EN/AR strings; delete `test_push_copy.py` (its `_email_preview/_sender_name` cases at `:114-134` move to `backend/tests/test_notification_service.py` calling the same private names is not allowed — make `notification_service.email_preview` and `sender_name` public instead and test them there). GREEN: move builders.
2. RED: `send_to_user` with `push_outbox` — two subscriptions for one user (`locale="ar"`, `locale=None`) → outbox has Arabic body for the first, English for the second; fake raising `PushGone` → subscription row deleted; returns count of successes. GREEN: `Deliverer` seam.
3. RED: `notify_actionable(db, user)` with seeded actionable items (reuse `test_scanback_api.py:92-147` seeding helpers) → first call sends 1, second call sends 0 (durable dedup via `PushSent`). GREEN: move `_notify_user`.
4. Cutover tests that monkeypatch `send_to_user` (`test_book_included_papers_routes.py:281-285`, `test_included_papers_service.py:317-320`, `test_scheduler_departure_flip.py:47-154`, `test_vehicle_reminders.py:83-347`) → use `push_outbox` and assert on the outbox.

### Verification (Phase 7)

- `pytest backend/tests/test_push_service.py backend/tests/test_notification_service.py backend/tests/test_scheduler_*.py backend/tests/test_vehicle_reminders.py backend/tests/test_included_papers_service.py backend/tests/test_book_included_papers_routes.py backend/tests/test_scanback_*.py` + full gate. Grep `_build_push|_notify_user|monkeypatch.setattr(.*send_to_user` → 0 hits.
- Smoke: subscribe a device under AR; trigger a new scan → Arabic push arrives once; second tick → no duplicate. Run `notification-template-reviewer`.

## Phase 8 — Vehicles

Branch `refactor/p8-vehicles`. Goal: one module per workflow with a narrow interface; a fleet core that is public; EVG fetch behind an adapter with a fixture-backed fake. HTTP contract unchanged.

### Modules (split of `vehicle_service.py` by the inventory's group column)

- `vehicle_service.py` (fleet core, keeps the name): `plate_label`, `to_list_item`, `to_read`, `list_vehicles`, `get_vehicle`, `create_vehicle`, `update_vehicle`, `summary`, `audit(db, action, vehicle_id, actor, payload, *, entity_type="vehicle")` (public; was `_audit` `:1287`), `validate_employee` (was `_validate_employee` `:425`), `_plate_exists`, `_raise_plate_exists`, `_list_options`, `_detail_options`, `_notify_window`, `_utcnow`.
- `vehicle_sites_service.py`: `site_read`, `list_sites`, `create_site`, `update_site`, `_get_site` (`:278,:625-720,:389`).
- `vehicle_files_service.py`: `store_file`, `resolve_file`, `delete_file`, `_file_read`, `_vehicle_file`, `_file_url`, `_owned_file`, `_safe_filename`, `_resolve_file_path` (`:99-123,:434,:1155-1284`).
- `vehicle_fines_service.py`: `fine_read`, `add_fine`, `update_fine`, `delete_fine`, `list_fines`, `_get_fine` (`:124,:760-864,:1049`), plus `vehicle_evg_service` contents (`preview`, `confirm`, `_traffic_codes`) with `fetch: TicketFetcher = evg_client.fetch_tickets` as a keyword parameter of `preview`/`confirm` (`type TicketFetcher = Callable[..., list[EvgTicketRow]]` matching `evg_client.fetch_tickets(tcn, *, details_for, timeout_s)`); delete `vehicle_evg_service.py`.
- `vehicle_accidents_service.py`: `accident_read`, `create_accident`, `set_accident_status`, `delete_accident`, `list_accidents`, `_get_accident` (`:139,:865-972,:1079`).
- `vehicle_maintenance_service.py`: `due_state`, `maintenance_read`, `create_maintenance`, `delete_maintenance`, `list_maintenance`, `_get_maintenance` (`:82,:158,:974-1047,:1097`).
- `vehicle_licence_service.py`: `expiry_status`, `renew_license`, `_renewal_read` (`:73,:180,:720`).
- `vehicle_letter_service.py` and `vehicle_reminder_service.py` import the public `audit`/`plate_label`/`expiry_status`/`due_state` from their new homes (`vehicle_letter_service.py:84,110,124,149,170,195`; `vehicle_reminder_service.py:49,72,101,131`; `vehicle_evg_service.py:20` gone).
- `api/v1/vehicles.py`: update imports per route (table in inventory); route order constraint (`:69-71`) unchanged.

### TDD slices

1. RED `backend/tests/test_vehicle_fines_service.py`: `preview(db, traffic_codes=[...], fetch=fake_fetch)` where `fake_fetch` returns two `EvgTicketRow` literals → response rows matched to the seeded vehicle by plate; `confirm(db, rows, user=…, fetch=fake_fetch)` → one `VehicleFine` per row, idempotent on repeat. Port `test_evg_fines.py:340-670` import/preview/confirm cases here without the `fetch_tickets` monkeypatch (`:344`); parser cases (`:14-330`) stay in `test_evg_fines.py`.
2. RED one interface test per new module (create/list/delete happy path with literal fields) using `api_db` fixtures from `test_vehicles_api.py:45-148` moved to `backend/tests/factories/vehicles.py`.
3. GREEN: move functions file by file; `test_vehicles_api.py` (11 tests) stays green throughout — it is the HTTP contract.
4. Grep `vehicle_service\._|vehicle_evg_service` → 0 hits.

### Verification (Phase 8)

- `pytest backend/tests/test_vehicle*.py backend/tests/test_evg_fines.py` + full gate; `openapi.json` diff empty.
- Smoke: vehicles hub → add fine via EVG preview (real fetch) → confirm; generate fines letter.

## Phase 9 — Record decision (frontend)

Branch `refactor/p9-record-decision`. Goal: one decision module owns availability, mutation, aftermath, and reason state; desktop and mobile are two presentation adapters; the mobile in-document duplicate is removed.

### Interface — `frontend/src/components/books/useRecordDecision.ts`

```ts
export type DecisionAct = 'return' | 'reject'
export interface RecordDecision {
  canDecide: boolean               // action === 'decide' (caller passes the record's action)
  busy: boolean                    // either mutation pending
  pending: DecisionAct | null      // reason form open for this act
  reason: string
  reasonValid: boolean
  sign(): void
  begin(act: DecisionAct): void    // clears reason, sets pending
  cancel(): void
  setReason(v: string): void
  confirm(): void                  // decideMutation.mutate({ act: pending, note: reason.trim() })
  reasonInputRef: React.RefObject<HTMLTextAreaElement | null>
}
export function useRecordDecision(args: { bookId: number | undefined; action: string | undefined; onDecided: (act: BookDecideAction) => void; onSigned: () => void }): RecordDecision
```
Implementation composes `useBookApprovalActions` (`components/books/useBookApprovalActions.ts:19-30`, unchanged; export its `Params`/`Actions` types) and the state now local to `BookRecordPage.tsx:366-372,573-603`. `DecisionReasonForm` (`BookRecordPage.tsx:262-327`) moves to `components/books/DecisionReasonForm.tsx` taking `decision: RecordDecision` as its only prop. `RecordDecisionActions` (`pages/books/RecordDecisionActions.tsx`) moves to `components/books/` and takes `{ decision: RecordDecision; refs? }`.

### Render sites after cutover (`BookRecordPage.tsx`)

- Desktop header (`:710-744`): `<RecordDecisionActions decision={d} />` (HeaderBtn styling via a `variant="header"` prop) + `<DecisionReasonForm decision={d} />` at `:947-951` when `d.pending && !isMobile`.
- Mobile: delete the in-document site (`:1022-1047`); keep the portal dock (`:1119-1140`) as `<RecordDecisionActions decision={d} />`; the reason form for mobile renders once, inside the dock sheet (the dock's `openMobileDecision` scroll/focus at `:590-603` is deleted). `dockHidden`/`IntersectionObserver` (`:455-466`) and the `inert` workaround (`:1119-1131`) are deleted with the duplicate.
- `BookDetailDrawer.tsx:283` switches to `useRecordDecision` too (second caller).

### TDD slices

1. RED `components/books/useRecordDecision.test.tsx` (wrapper from `useBookApprovalActions.test.tsx:10-15`, mock `@/lib/api`): `begin('return')` → `pending==='return'`, `reasonValid===false`; `setReason('late')` → valid; `confirm()` → `api.decideBook` called with `(7, 'return', 'late')` and `onDecided('return')`; `sign()` → `api.signBook(7)` and `onSigned()`; `busy` true while pending. GREEN: implement hook.
2. RED `components/books/RecordDecisionActions.test.tsx` (moved): renders three buttons with EN/AR literal labels from `books.approval.*`; clicking Return calls `begin('return')`; `busy` disables. GREEN: adapt component.
3. RED `pages/books/BookRecordPage.decision.test.tsx` (fixture helpers from `BookRecordPage.queueNav.test.tsx:139-199`): with `useIsMobile` mocked `true`, exactly **one** element with text `books.approval.return` exists (was two); clicking it opens exactly one reason textarea; with `useIsMobile` false, the header button and inline form appear. GREEN: cutover render sites.
4. Delete the local `DecisionReasonForm`/state from `BookRecordPage.tsx`; `pages/books/RecordDecisionActions.test.tsx` removed (moved). `useBookApprovalActions.test.tsx` unchanged.

### Verification (Phase 9)

- `pnpm -C frontend test -- useRecordDecision RecordDecisionActions BookRecordPage useBookApprovalActions BookDetailDrawer`; `tsc -b --noEmit`; `pnpm -C frontend run lint`.
- Browser smoke at 375px and 1280px, EN and AR: open a record awaiting your decision → one decision surface per breakpoint; Return with reason → record leaves the queue; RTL dock alignment correct. Run `i18n-rtl-reviewer`.

## Critical files & anchors

- `backend/app/services/attendance_evaluation_service.py:646-930` — dead correction path and `__all__`; Phase 1 deletes.
- `backend/app/api/v1/workforce.py:102-334` — route helpers that Phase 2 dissolves into module interfaces.
- `backend/app/services/document_service.py:1396-1489` — steps 8–10 that become one `artifact.produce` call.
- `backend/app/services/email_service.py:358,847-1000` — `_connect` and the sync hook where the connector seam lands.
- `frontend/src/pages/books/BookRecordPage.tsx:366-372,573-603,1022-1047,1119-1140` — decision state and the duplicate mobile site.

## Assumptions & contingencies

- Phase 2 depends on Phase 1 (routes call `attendance_correction_service`). Phases 3–9 are independent of each other; keep the agreed order anyway so each deploy carries one concern.
- If the full `pytest` run exposes an unrelated pre-existing failure on `main`, record it in the PR description and proceed; do not fix unrelated tests in-phase.
- If `sync-api-types` produces diffs outside the phase's routes, commit the regenerated files anyway (they are generated) and note it in the PR.
- Phase 5: if no PDF/PNG fixture with a QR exists under `backend/tests/fixtures/`, generate the PNG in the test with `qrcode` only if it is already a dependency; otherwise mark the QR case `skip` and keep the text case.
- Phase 6: if `core/artifact.py` importing `_pdf_executor` lazily still trips `mypy`'s import cycle check, place the module at `backend/app/services/artifact_service.py` instead; interface unchanged.
- Phase 8: if `test_vehicles_api.py` fixtures resist extraction to a factory without behaviour change, leave them in place and import them from the new module tests.
