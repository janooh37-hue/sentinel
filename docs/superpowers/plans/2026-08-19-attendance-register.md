# Attendance (الحضور) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Attendance subpage under Employees at `/employees/attendance` that shows one operational day's duty register (names grouped by `duty_post` inside the on-duty `duty_unit`) with Board and Timeline views of the same day, plus a per-employee Attendance tab at `/employees/:id?tab=attendance`, all reading a read-only mirror of the installed ZKTeco BioTime instance.

**Architecture:** The workforce/attendance backend already exists, live-verified, on branch `dashboard/additive-baseline`; we port it onto `main` **by path and hunk selection, never by cherry-picking commits**, because those commits also carry a rejected dashboard rework and a breaking auth/session change. On top of the ported stack we add exactly two read endpoints (a day register row that carries punch times, and one employee's month), then build one page with three client-side projections of a single day payload plus one employee-file tab.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic (SQLite), pydantic v2, React 19 + TypeScript + TanStack Query + react-router 7 + Tailwind 4, vitest + @testing-library/react, pytest, Playwright.

**Worktree:** `C:/Users/Amh/Documents/projects/sentinel/.worktrees/attendance`, branch `feat/attendance-register`, forked from `main` @ `8f9ddeb`. All paths below are relative to that worktree root. Run Python as the **absolute** path `"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe"` (the venv lives at the main checkout root, not under `backend/`; a relative `../../../venv/Scripts/python.exe` exists on disk but this git-bash refuses to execute relative Windows interpreter paths — verified: `command not found` — so always use the quoted absolute form), and pnpm as `C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd` from `frontend/`. Verified working: `python -c "import fastapi"` → `ok 3.12.13 0.115.5`.

## Global Constraints

- **User-facing name is "Attendance" / "الحضور". Never "BioTime".** The vendor name appears in exactly one UI place: the source/provenance line at the foot of the register (`Source: BioTime mirror · read-only · synced …`), plus Settings → integration. It stays freely in code, config keys and env (`GSSG_BIOTIME_*`).
- **Arabic label is `الحضور` only** — not `الحضور والغياب`. Owner decision, 2026-08-19.
- **Bidi isolation is mandatory.** Any Arabic run rendered adjacent to a number, time or clock range MUST be wrapped in an element carrying `dir="rtl"` and `unicode-bidi: isolate`. Without it, `السرية الثانية · 05:00 – 13:00` renders as `13:00 – 05:00`. This defect was observed in the mockups and fixed there; it is a real rendering bug, not a mockup artifact.
- **Punches carry no direction.** The installed build returns `punch_state = 255` ("Unknown") on every row, so the UI says "seen at", never "checked in". A day with one punch is *present + flag*, never a computed span.
- **Leave leaves the denominator.** A post of 4 with one approved leave is at full strength on 3 (`3/3 +1 leave`), never `3/4`.
- **A window that has not opened is not an absence.** The Night shift before 21:00 renders as "not started · N scheduled" with a neutral meter, never zero-verified.
- **A stale or unimported window is hatched, never counted as absence.** Freshness (`fresh_through`) gates every count.
- **Capability names are fixed** (ported verbatim from the branch): `workforce.self.view`, `workforce.dashboard.view`, `workforce.people.view`, `workforce.schedule.manage`, `workforce.policy.manage`, `workforce.attendance.review`, `workforce.attendance.correct`, `workforce.integration.manage`. Do **not** invent `attendance.*` capabilities — the earlier proposal is superseded by the ported set.
- **Do NOT port these, ever** (they belong to the rejected dashboard rework or break `main`):
  - `backend/app/api/v1/preferences.py`, `backend/app/schemas/preferences.py`, `backend/app/services/preferences_service.py`, the `UserPreference` model, migration `0070_user_preferences`.
  - Any change to `backend/app/api/v1/auth.py`, `backend/app/schemas/auth.py`, `backend/app/services/auth_service.py`, `backend/app/api/v1/notifications.py`, `backend/app/services/perm_service.py`. **The branch deletes `GET /auth/me/capabilities`; `frontend/src/lib/useCapabilities.ts:27` calls it via `api.myCapabilities()`. Porting that hunk breaks every capability gate in the app.**
  - `backend/app/services/dashboard_service.py`, `backend/app/schemas/dashboard.py`, `backend/app/schemas/settings.py`, and `normalize_dashboard_layout` / `_get_dashboard_layout` inside `settings_service.py`.
  - The SPA path-traversal hardening in `backend/app/main.py` (`_STATIC_ROOT`, `spa_fallback` rewrite). It is a real and separate security fix; it is out of scope here and must not ride along in this branch. Report it at the end so it can be raised on its own.
- `requirements.txt` needs **no change**: `httpx>=0.27,<1.0` is already present on `main` at line 36.
- After any backend schema change: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" ../scripts/dump_openapi.py` then `cd frontend && pnpm gen:api`. Never hand-edit `frontend/src/lib/api.types.ts`.
- Every new locale key must exist in **both** `frontend/src/locales/en.json` and `ar.json`.
- Commit after every task. Conventional-commit subjects (`feat(attendance): …`, `fix(attendance): …`, `test(attendance): …`, `chore(workforce): …`).

## Verified Inventory (do not re-derive)

**Migration chain.** `main` head is `0069_merge` (file `backend/app/db/migrations/versions/0069_merge_0068_heads.py`). Branch `0070_user_preferences` revises `0069_merge`; `0071_workforce_attendance` revises `0070_user_preferences`. We re-parent `0071` to `"0069_merge"` and skip `0070` entirely. `0071` references `user_preferences` in exactly one place: `_rewrite_dashboard_layouts` (lines 963–999 of the branch file) called from `upgrade()` line 1005 and `downgrade()` line 1009 — the dashboard widget-id cutover, which we delete.

**`0071` creates 22 tables:** `work_shift_definitions`, `work_rotation_patterns`, `work_rotation_steps`, `work_crews`, `work_crew_schedules`, `work_crew_memberships`, `work_shift_occurrences`, `work_shift_overrides`, `work_staffing_requirements`, `work_attendance_policies`, `attendance_provider_people`, `attendance_punches`, `attendance_sync_state`, `attendance_evaluation_queue`, `duty_assignment_events`, `attendance_cases`, `attendance_evaluations`, `attendance_punch_assignments`, `attendance_evaluation_punch_sources`, `attendance_evaluation_leave_sources`, `attendance_adjustments`, `user_workforce_scopes`. Its other helpers — `_create_workforce_tables`, `_seed_canonical_rotation`, `_seed_role_permissions`, `_seed_baseline_duty_events` — are all required and stay.

**`_seed_role_permissions` does not fight the presets.** Its `_ROLE_DEFAULTS` inside the migration is `{"operator": ("workforce.self.view",), "manager": (), "admin": <all 8>}`, seeded with `INSERT OR IGNORE INTO role_permissions`, which matches the `permissions.py` presets Task 2 ports exactly: operator gains only its own record, manager gains nothing, admin gains everything. Per-user overrides are untouched. Verified by reading the branch file, lines 23–39 and 896–908.

**Files to copy verbatim from `dashboard/additive-baseline`** (all are new files on `main`, and an import scan confirms none of them imports anything from the excluded set):

```
backend/app/db/workforce_models.py
backend/app/schemas/workforce.py
backend/app/api/v1/workforce.py
backend/app/services/attendance_provider.py
backend/app/services/attendance_biotime_provider.py
backend/app/services/attendance_identity_service.py
backend/app/services/attendance_punch_service.py
backend/app/services/attendance_evaluation_service.py
backend/app/services/attendance_queue_service.py
backend/app/services/attendance_sync_service.py
backend/app/services/workforce_scope_service.py
backend/app/services/workforce_read_service.py
backend/app/services/workforce_admin_service.py
backend/app/services/workforce_schedule_service.py
backend/app/services/workforce_dashboard_service.py
backend/app/services/workforce_leave.py
backend/app/services/workforce_retention_service.py
backend/app/services/workforce_seed_service.py
backend/scripts/seed_workforce_demo.py
backend/scripts/biotime_probe.py
backend/scripts/employee_directory.py
backend/tests/fakes/__init__.py
backend/tests/fakes/attendance_provider.py
backend/tests/test_workforce_models.py
backend/tests/test_workforce_migration.py
backend/tests/test_workforce_schedule.py
backend/tests/test_workforce_scope_hardening.py  # copied in Task 4 — it drives the API router
# test_workforce_authorization.py is deliberately NOT copied: see Task 2 Step 1
backend/tests/test_workforce_api_permissions.py
backend/tests/test_workforce_dashboard_api.py
backend/tests/test_workforce_leave_precedence.py
backend/tests/test_workforce_retention.py
backend/tests/test_workforce_seed_service.py
backend/tests/test_workforce_operational_smoke.py
backend/tests/test_attendance_biotime_provider.py
backend/tests/test_attendance_identity_service.py
backend/tests/test_attendance_punch_allocation.py
backend/tests/test_attendance_evaluation_service.py
backend/tests/test_attendance_queue_service.py
backend/tests/test_attendance_sync_service.py
```

**Files needing hunk-level merge (never overwrite):**

| Path | What to take |
|---|---|
| `backend/app/core/permissions.py` | The 8 `Capability(...)` entries in category `workforce`, `"workforce.self.view"` added to `_OPERATOR_CAPS`, and the `_MANAGER_CAPS` re-shape that subtracts `{"workforce.self.view"}` (manager presets intentionally grant no workforce capability). |
| `backend/app/config.py` | `_csv_set` helper; fields `biotime_base_url`, `biotime_username`, `biotime_password`, `biotime_ca_bundle`, `biotime_verify_tls`, `biotime_timeout_seconds`, `biotime_page_size`, `biotime_time_zone`, `biotime_area_names`, `biotime_terminal_sns`, `biotime_department_ids`; properties `biotime_configured`, `biotime_area_name_set`, `biotime_terminal_sn_set`, `biotime_department_id_set`. |
| `backend/app/db/models.py` | The trailing `from app.db.workforce_models import (...)` block with its `# noqa: E402` comment, plus the 22 new names in `__all__`. **Not** the `UserPreference` class. |
| `backend/app/main.py` | Only the in-function `from app.api.v1 import workforce as workforce_v1` and `app.include_router(workforce_v1.router, prefix="/api/v1", dependencies=auth_gate)`. Not the `preferences_v1` lines, not the `spa_fallback` rewrite, not the `NotFoundError` import. |
| `backend/app/services/settings_service.py` | `_WORKFORCE_CONFIGURATION_FIELDS`, `_WORKFORCE_CONFIGURATION_KEYS`, `_upsert_setting`, the `workforce.`-prefix guard inside `_set`, `_set_workforce_configuration_value`, `_as_utc`, `_duty_assignment_baseline`, `_validate_workforce_evaluation_boundary`, `get_workforce_configuration`, `update_workforce_configuration`. **Not** `normalize_dashboard_layout` / `_get_dashboard_layout`. |
| `backend/app/services/scheduler_service.py` | The four workforce jobs and their helpers: `_WORKFORCE_OCCURRENCE_JOB_ID`, `_WORKFORCE_ATTENDANCE_SYNC_JOB_ID`, `_WORKFORCE_QUEUE_DRAIN_JOB_ID`, `_WORKFORCE_RETENTION_JOB_ID`, `_attendance_sync_lock`, `_resolve_verified_attendance_provider`, `_load_workforce_configuration`, `_run_workforce_occurrence_generation`, `run_workforce_evaluation_queue_drain_once`, `_run_workforce_evaluation_queue_drain`, `_run_workforce_retention`, `_sync_attendance_stream` and their registrations. |
| `backend/app/services/leave_service.py` | `_workforce_leave_snapshot` and the enqueue-on-mutation hook (`from app.services.attendance_queue_service import enqueue_evaluation`, `from app.services.workforce_leave import affected_reevaluation_windows`) at its four call sites. |
| `backend/app/services/duty_service.py` | The `DutyAssignmentEvent` write path (`from app.db.workforce_models import DutyAssignmentEvent`) and its `enqueue_evaluation` hook. |

**Existing API surface after the port** (`backend/app/api/v1/workforce.py`, prefix `/api/v1/workforce`): `GET /dashboard/snapshot`, `GET /dashboard/analytics`, `GET /dashboard/coverage`, `GET /access/me`, `GET|PUT /access/users/{user_id}/scopes`, `GET /roster`, `GET /attendance/exceptions`, `GET /attendance/cases/{case_id}`, `POST /attendance/cases/{case_id}/adjustments`, `POST …/revoke`, `GET /duty-assignment-events`, `GET /schedule/definitions`, `GET /schedule/rotation`, crews CRUD + schedules + memberships, `GET|POST /overrides`, `/requirements`, `/policies`, `GET /integration/status`, `POST /integration/test`, `POST /integration/sync`, `GET /integration/people`, `PATCH /integration/people/{id}/mapping`, `GET /integration/evaluation-queue`, `POST …/retry`, `GET|PATCH /configuration`.

**Shapes that matter.**

```python
# backend/app/schemas/workforce.py (ported, verbatim)
PresenceState = Literal["scheduled", "on_duty", "completed", "absent", "excused_leave", "off", "unknown"]

class RosterRowRead(ORMBase):
    model_config = ConfigDict(extra="forbid")
    employee_id: str
    name_en: str
    name_ar: str | None = None
    department: str | None = None
    duty_unit: str | None = None
    duty_post: str | None = None
    crew_code: str | None = None
    shift_code: str | None = None
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None

class AttendanceExceptionRead(RosterRowRead):
    late_minutes: int | None = Field(default=None, ge=0)
    early_exit_minutes: int | None = Field(default=None, ge=0)
    missing_checkout: bool | None = None

class CursorPage[T](BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[T]
    next_cursor: str | None = None
```

`AttendancePunch` columns: `id`, `provider`, `external_event_id`, `provider_person_id → attendance_provider_people.id`, `occurred_at`, `direction` (always `"unknown"` on this build), `device_id`, `device_name`, `source_updated_at`, `imported_at`.

**The gap this plan closes:** neither `RosterRowRead` nor `AttendanceExceptionRead` carries **punch times**, and there is no per-employee month endpoint. The register shows `05:47 +17m` / `06:18 only`; the Timeline needs a first-punch offset; the employee tab needs a month. Two new endpoints (Tasks 6 and 7) close exactly that, and Board and Timeline are client-side projections of the Task 6 payload — no further endpoints.

**Frontend conventions** (`main`, verified):
- `frontend/src/lib/api.ts` — single `request<T>(method, path, body?)` helper; query strings via `qs({...params})`. Example: `listEmployees: (params: ListEmployeesParams = {}) => request<EmployeeListResponse>('GET', \`/employees${qs({ ...params })}\`)`.
- `frontend/src/lib/useCapabilities.ts` — `useCapabilities()` → `{ capabilities: Set<string>, isLoading, has(cap) }`, backed by `GET /auth/me/capabilities`, `staleTime: 5 * 60_000`.
- `frontend/src/components/shell/RequireCapability.tsx` — `<RequireCapability cap="…">{children}</RequireCapability>`, used in `App.tsx` routes.
- Routes live in `frontend/src/App.tsx` lines 210–282; `/employees` at 212, `/employees/:id` at 213. Lazy page imports at lines 35–84.
- Employee-file tabs: `frontend/src/pages/employees/EmployeeTabChips.tsx` — `Tab` union line 11, `Counts` interface lines 13–20, `ORDER` line 28. `frontend/src/pages/employees/EmployeeDetailPage.tsx` — `VALID_TABS` lines 38–45, `tabFromSearch` lines 47–50, `handleTabChange` lines 65–76.
- Hero: `frontend/src/components/employees/EmployeeSearchHero.tsx` (band + search + `children` slot), `frontend/src/components/employees/LookupHeroCards.tsx` (`HCard`/`HCardHead`/`Chip` internals, `mt-[26px] grid grid-cols-1 gap-3.5 md:grid-cols-3` at line 217).
- Locales: `employee.tab` block at `en.json:2154-2162` and `ar.json:2313-2321`.
- Page tests mock `@/lib/api` with `vi.mock('@/lib/api', async (orig) => …)` preserving the real module via `orig<typeof import('@/lib/api')>()`, and render inside `QueryClientProvider` + `MemoryRouter`. See `frontend/src/pages/employees/EmployeeLookupPage.test.tsx:1-60`.
- Backend test fixtures (`backend/tests/conftest.py`): `db_session` (line 36), `admin_user` (line 95), `make_user(db, *, role="operator", status="active", email="u@x.ae")` (line 86), `count_queries` (line 58).

## File Structure

**Backend, new:**
- `backend/app/schemas/workforce.py` gains `AttendanceDayRowRead`, `EmployeeAttendanceDayRead`, `EmployeeAttendancePunchRead`, `EmployeeAttendanceMonthRead` (Tasks 6–7).
- `backend/app/services/workforce_read_service.py` gains `list_attendance_day`, `employee_attendance_range` (Tasks 6–7).
- `backend/app/api/v1/workforce.py` gains `GET /attendance/day`, `GET /employees/{employee_id}/attendance` (Tasks 6–7).
- `backend/tests/test_attendance_day_endpoint.py`, `backend/tests/test_employee_attendance_endpoint.py`.

**Frontend, new** (one directory, one responsibility per file):
- `frontend/src/pages/employees/attendance/AttendancePage.tsx` — route shell: band, tabs, toolbar, view switch, data query.
- `frontend/src/pages/employees/attendance/attendanceModel.ts` — pure helpers: grouping by unit/post, exception ordering, leave-adjusted denominators, arrival offsets, state → tone mapping. No React. Unit-tested directly.
- `frontend/src/pages/employees/attendance/AttendanceToolbar.tsx` — day stepper, 7-day strip, shift segmented control, search, view switch, print/export.
- `frontend/src/pages/employees/attendance/RegisterView.tsx` — the duty register (design 10).
- `frontend/src/pages/employees/attendance/BoardView.tsx` — dark tile wall (design 7).
- `frontend/src/pages/employees/attendance/TimelineView.tsx` — arrival lanes (design 8).
- `frontend/src/pages/employees/attendance/AttentionQueue.tsx` — "needs a decision" side rail, shared by all three views.
- `frontend/src/components/employees/EmployeesSectionTabs.tsx` — `Directory | Attendance | Duty locations` strip, shared by `EmployeeLookupPage` and `AttendancePage`.
- `frontend/src/components/employees/AttendanceHeroCard.tsx` — the 4th hero card.
- `frontend/src/pages/employees/tabs/AttendanceTab.tsx` — per-employee month + day timeline.
- Tests beside each: `attendanceModel.test.ts`, `AttendancePage.test.tsx`, `RegisterView.test.tsx`, `AttendanceToolbar.test.tsx`, `AttendanceTab.test.tsx`, `EmployeesSectionTabs.test.tsx`, `AttendanceHeroCard.test.tsx`.

**Frontend, modified:** `App.tsx` (lazy import + route), `lib/api.ts` (4 wrappers), `lib/api.types.ts` (generated), `pages/employees/EmployeeLookupPage.tsx` (tabs + hero card), `pages/employees/EmployeeTabChips.tsx` (7th chip), `pages/employees/EmployeeDetailPage.tsx` (tab wiring), `locales/en.json`, `locales/ar.json`, `index.css` (one bidi-isolation utility).

---

### Task 1: Port the workforce persistence layer

**Files:**
- Create: `backend/app/db/workforce_models.py` (copy from branch)
- Create: `backend/app/db/migrations/versions/0071_workforce_attendance.py` (copy from branch, then edit)
- Modify: `backend/app/db/models.py` (append import block + `__all__` entries; see inventory)
- Test: `backend/tests/test_workforce_models.py`, `backend/tests/test_workforce_migration.py` (copy from branch)

**Interfaces:**
- Consumes: nothing.
- Produces: all 22 ORM classes listed in the inventory, importable from `app.db.models` and `app.db.workforce_models`; alembic head becomes `0071_workforce_attendance` with `down_revision = "0069_merge"`.

- [ ] **Step 1: Copy the model module and migration**

```bash
cd C:/Users/Amh/Documents/projects/sentinel/.worktrees/attendance
git show dashboard/additive-baseline:backend/app/db/workforce_models.py > backend/app/db/workforce_models.py
git show dashboard/additive-baseline:backend/app/db/migrations/versions/0071_workforce_attendance.py > backend/app/db/migrations/versions/0071_workforce_attendance.py
git show dashboard/additive-baseline:backend/tests/test_workforce_models.py > backend/tests/test_workforce_models.py
git show dashboard/additive-baseline:backend/tests/test_workforce_migration.py > backend/tests/test_workforce_migration.py
```

- [ ] **Step 2: Re-parent the migration and strip the dashboard cutover**

In `backend/app/db/migrations/versions/0071_workforce_attendance.py`:

1. Change the docstring first line from `"""workforce attendance persistence foundation and dashboard widget cutover.` to `"""workforce attendance persistence foundation.`
2. Change `Revises: 0070_user_preferences` to `Revises: 0069_merge`.
3. Change `down_revision: str | Sequence[str] | None = "0070_user_preferences"` to `down_revision: str | Sequence[str] | None = "0069_merge"`.
4. Delete the three functions `_decode_layout`, `_rewrite_widget_id`, `_rewrite_dashboard_layouts` in their entirety.
5. Delete the call `_rewrite_dashboard_layouts("attendance", "staff_overview")` from `upgrade()` and `_rewrite_dashboard_layouts("staff_overview", "attendance")` from `downgrade()`.
6. Delete `import json` (line 10). It is used **only** inside the three deleted helpers, and `backend/app/db/migrations` is not in ruff's `extend-exclude` (`pyproject.toml`), so leaving it fails lint with `F401`.

`upgrade()` must end up exactly:

```python
def upgrade() -> None:
    _create_workforce_tables()
    _seed_canonical_rotation()
    _seed_role_permissions()
    _seed_baseline_duty_events()
```

- [ ] **Step 3: Verify no reference to the removed helpers or to user_preferences remains**

Run: `grep -nE "user_preferences|_rewrite_dashboard_layouts|_decode_layout|_rewrite_widget_id|\bimport json\b" backend/app/db/migrations/versions/0071_workforce_attendance.py`
Expected: no output.

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m ruff check app/db/migrations/versions/0071_workforce_attendance.py`
Expected: `All checks passed!`

- [ ] **Step 4: Wire the models into `app.db.models`**

Append to `backend/app/db/models.py`, immediately **before** the `__all__` assignment (the file's last statement):

```python
# Imported last on purpose: workforce models reference tables defined above, so
# a top-of-module import would close a circular import at class-definition time.
from app.db.workforce_models import (  # noqa: E402
    AttendanceAdjustment,
    AttendanceCase,
    AttendanceEvaluation,
    AttendanceEvaluationLeaveSource,
    AttendanceEvaluationPunchSource,
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendancePunchAssignment,
    AttendanceSyncState,
    DutyAssignmentEvent,
    UserWorkforceScope,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkRotationStep,
    WorkShiftDefinition,
    WorkShiftOccurrence,
    WorkShiftOverride,
    WorkStaffingRequirement,
)
```

Then insert those same 22 names into the existing `__all__` list, preserving its alphabetical order (`AttendanceAdjustment` … after `"AppSetting"`, `DutyAssignmentEvent` after `"DocumentExtraction"`, `UserWorkforceScope` after `"UserPermission"`, the `Work*` names after `"Violation"`).

- [ ] **Step 5: Run the migration and model tests**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_workforce_migration.py tests/test_workforce_models.py -q`
Expected: all pass **after the edits this step authorizes.** `test_workforce_migration.py` is coupled to the excluded dashboard cutover in three places, and all three must be fixed here:

1. `WORKFORCE_PREDECESSOR = "0070_user_preferences"` (line 15, asserted at 80–81) → change to `"0069_merge"`.
2. The dashboard-layout rewrite test (branch lines ~89–140) INSERTs into `user_preferences` and asserts the widget-id rewrite this plan deletes. **Delete that test function.** The table will not exist, and the behaviour is gone by design.
3. `test_workforce_migration_is_the_single_next_head_from_user_preferences` (line 214) → rename to `..._from_the_merge_head` and re-point its expectation at `0069_merge`.

Keep everything else: the table-existence, trigger, index and seed assertions are the reason to port this file. Record all three edits in the commit body.

- [ ] **Step 6: Prove the head is single and applies to a fresh database**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m alembic heads`
Expected: exactly one head, `0071_workforce_attendance`.

Run: `cd backend && GSSG_DATA_DIR=$(mktemp -d) "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m alembic upgrade head`
Expected: exit 0, no error about a missing `user_preferences` table.

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/workforce_models.py backend/app/db/migrations/versions/0071_workforce_attendance.py backend/app/db/models.py backend/tests/test_workforce_models.py backend/tests/test_workforce_migration.py
git commit -m "feat(workforce): port attendance persistence foundation

Re-parented 0071 onto 0069_merge and dropped the dashboard widget cutover,
which was the migration's only dependency on 0070_user_preferences."
```

---

### Task 2: Port capabilities, scope service, and config

**Files:**
- Modify: `backend/app/core/permissions.py` — anchor by symbol, not line: insert into `CAPABILITIES` after the `messages.broadcast` entry; edit `_OPERATOR_CAPS`; replace `_MANAGER_CAPS`. (On `main` these sit near lines 154–160, 173 and 191; the branch's own numbers differ and must not be trusted.)
- Create: `backend/app/services/workforce_scope_service.py` (copy from branch)
- Modify: `backend/app/config.py` — `_csv_set` above `class Settings`, then the 11 fields + 4 properties inside it
- Create: `backend/tests/test_workforce_scope_algebra.py` (salvaged, see Step 1)
- Test: `backend/tests/test_workforce_scope_algebra.py` only. **`test_workforce_scope_hardening.py` is NOT part of this task** — it drives `TestClient(app)` against `/api/v1/workforce/*`, which only exists once Task 4 registers the router; it is copied and run there.

**Interfaces:**
- Consumes: Task 1's ORM classes (`UserWorkforceScope`).
- Produces: `resolve_workforce_scope(db, user) -> WorkforceScope`; `WorkforceScope.is_organization`, `.workforce_access_tier`, `.canonical_payload()`; `scope_allows(scope, employee_id=…, department=…, duty_unit=…, duty_post=…)`; the 8 capability ids; `settings.biotime_configured`.

- [ ] **Step 1: Copy the scope service, then salvage only the scope-algebra tests**

```bash
git show dashboard/additive-baseline:backend/app/services/workforce_scope_service.py > backend/app/services/workforce_scope_service.py
```

**Do NOT copy `backend/tests/test_workforce_authorization.py`.** It cannot even be collected on `main`: it imports `UserPreference` from `app.db.models` (the model this plan refuses to port → `ImportError` at collection time) and `app.api.v1.notifications` for the SSE authorization-frame test, and three of its tests assert the excluded session/auth rework:

| Function (line on the branch) | Why it cannot come along |
|---|---|
| `test_session_projection_is_canonical_and_digest_changes_for_every_authorization_input` (144) | Asserts `SessionUser.capabilities` / `.workforce_access_tier` / `.authorization_version` / `.preferences.theme` and builds a `UserPreference(widget_style="charts")`. |
| `test_legacy_capabilities_endpoint_is_removed_from_the_application_api` (226) | Asserts `GET /api/v1/auth/me/capabilities` returns 404. On `main` that endpoint must keep working — `frontend/src/lib/useCapabilities.ts:27` is its only consumer and every UI capability gate depends on it. Keeping this test would demand we break the app. |
| `test_notification_stream_emits_initial_and_change_only_authorization_frames` (258) | Asserts the SSE `authorization` frame added by the excluded `notifications.py` change. |

Instead, create `backend/tests/test_workforce_scope_algebra.py` containing **only** the three tests that prove what this task delivers, copied verbatim from the branch file with their helpers (`_employee`, `_user`, `_allows` at branch lines 32–63) and only the imports those need:

- `test_workforce_capability_catalog_and_conservative_role_defaults` (branch line 65)
- `test_resolved_self_and_department_scopes_union_then_requested_filter_only_narrows` (79)
- `test_admin_effective_capabilities_still_resolve_explicit_organization_scope` (131)

Then prove the salvage is clean:

```bash
grep -nE "UserPreference|preferences|widget_style|me/capabilities|authorization_version|notifications" backend/tests/test_workforce_scope_algebra.py
# expected: no output
"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -c "import ast,sys;ast.parse(open('backend/tests/test_workforce_scope_algebra.py',encoding='utf-8').read())"
# expected: no output (file parses)
```

- [ ] **Step 2: Add the capabilities**

In `backend/app/core/permissions.py`, insert after the `messages.broadcast` entry and before the closing `)` of `CAPABILITIES`:

```python
    Capability(
        "workforce.self.view",
        "workforce",
        "View own workforce record",
        "View your own schedule, attendance punches, and leave.",
    ),
    Capability(
        "workforce.dashboard.view",
        "workforce",
        "View workforce dashboard",
        "View aggregate workforce dashboard data inside assigned scope.",
    ),
    Capability(
        "workforce.people.view",
        "workforce",
        "View workforce people",
        "View roster and attendance details inside assigned scope.",
    ),
    Capability(
        "workforce.schedule.manage",
        "workforce",
        "Manage workforce schedules",
        "Manage crews, rotations, memberships, and schedule overrides.",
    ),
    Capability(
        "workforce.policy.manage",
        "workforce",
        "Manage workforce policies",
        "Manage staffing requirements, attendance policies, and excusing leave kinds.",
    ),
    Capability(
        "workforce.attendance.review",
        "workforce",
        "Review workforce attendance",
        "Review workforce attendance cases, exceptions, and source facts.",
    ),
    Capability(
        "workforce.attendance.correct",
        "workforce",
        "Correct workforce attendance",
        "Create audited workforce attendance adjustments.",
    ),
    Capability(
        "workforce.integration.manage",
        "workforce",
        "Manage workforce integration",
        "Manage workforce provider status, mappings, tests, and synchronization.",
    ),
```

- [ ] **Step 3: Update the role presets**

Add `"workforce.self.view",` as the last entry of `_OPERATOR_CAPS`, then replace the `_MANAGER_CAPS` assignment with:

```python
_MANAGER_CAPS: Final[frozenset[str]] = (
    _OPERATOR_CAPS
    | frozenset(
        {
            "employees.edit",
            "employees.notify",
            "leaves.edit",
            "violations.manage",
            "books.manage",
            "books.approve",
            "permits.manage",
            "ledger.send",
            "submitters.manage",
            "editor_templates.manage",
        }
    )
) - frozenset({"workforce.self.view"})
```

Also update the comment above `_OPERATOR_CAPS` to the branch text: operator gains their own workforce record; manager presets intentionally grant no workforce capability, so manager access always needs an explicit grant plus a scope.

- [ ] **Step 4: Add the BioTime settings**

In `backend/app/config.py`, add before `class Settings`:

```python
def _csv_set(raw: str) -> frozenset[str]:
    """Parse a comma-separated env value into a trimmed, non-empty set."""
    return frozenset(token.strip() for token in raw.split(",") if token.strip())
```

and inside `Settings`, after the OpenWA block, the 11 fields and 4 properties exactly as quoted in the inventory table (`biotime_base_url` … `biotime_department_id_set`), keeping the explanatory comments — they record measured provider behaviour (device-local wall time, filters that fail open) and are load-bearing documentation.

- [ ] **Step 5: Run the salvaged scope tests**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_workforce_scope_algebra.py -q`
Expected: 3 passed. No API route is exercised here by design — the router does not exist until Task 4.

- [ ] **Step 6: Prove no capability regression for existing roles**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/ -q -k "permission or capabilit"`
Expected: all pass. In particular the admin preset resolves to all capabilities (now 35) and the manager preset contains no `workforce.*` id.

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/permissions.py backend/app/config.py backend/app/services/workforce_scope_service.py backend/tests/test_workforce_scope_algebra.py
git commit -m "feat(workforce): port capabilities, scope resolution, and provider settings"
```

---

### Task 3: Port the attendance ingest and evaluation services

**Files:**
- Create: `backend/app/services/attendance_provider.py`, `attendance_biotime_provider.py`, `attendance_identity_service.py`, `attendance_punch_service.py`, `attendance_evaluation_service.py`, `attendance_queue_service.py`, `attendance_sync_service.py` (copy from branch)
- Create: `backend/tests/fakes/__init__.py`, `backend/tests/fakes/attendance_provider.py`
- Test: `backend/tests/test_attendance_biotime_provider.py`, `test_attendance_identity_service.py`, `test_attendance_punch_allocation.py`, `test_attendance_evaluation_service.py`, `test_attendance_queue_service.py`, `test_attendance_sync_service.py` (copy from branch)

**Interfaces:**
- Consumes: Task 1 ORM classes, Task 2 `settings.biotime_*`.
- Produces: `ProviderHealth`, `ProviderPage`, `ProviderPerson`, `ProviderPunch` (from `attendance_provider`); `build_provider_from_settings(settings) -> BioTimeAttendanceProvider | None`; `enqueue_evaluation(...)`; `drain_evaluation_queue(...)`; `sync_people(...)`, `sync_punches(...)`.

- [ ] **Step 1: Copy the seven services, the fakes package, and the six test modules**

```bash
for f in attendance_provider attendance_biotime_provider attendance_identity_service \
         attendance_punch_service attendance_evaluation_service attendance_queue_service \
         attendance_sync_service; do
  git show dashboard/additive-baseline:backend/app/services/$f.py > backend/app/services/$f.py
done
mkdir -p backend/tests/fakes
git show dashboard/additive-baseline:backend/tests/fakes/__init__.py > backend/tests/fakes/__init__.py
git show dashboard/additive-baseline:backend/tests/fakes/attendance_provider.py > backend/tests/fakes/attendance_provider.py
for t in test_attendance_biotime_provider test_attendance_identity_service \
         test_attendance_punch_allocation test_attendance_evaluation_service \
         test_attendance_queue_service test_attendance_sync_service; do
  git show dashboard/additive-baseline:backend/tests/$t.py > backend/tests/$t.py
done
```

- [ ] **Step 2: Confirm no import reaches an excluded module**

Run: `grep -nE "^(from|import).*(preferences|schemas\.auth|auth_service|dashboard_service|schemas\.dashboard)" backend/app/services/attendance_*.py`
Expected: no output. (Verified on the branch; this step catches a bad copy.)

- [ ] **Step 3: Run the ingest and evaluation suites**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_*.py -q`
Expected: all pass. These are the tests that pin the measured provider contract: JWT auth, plural-route-only, HTML-200-is-a-denial, device-local wall time, oldest-first pages, and `punch_state 255` meaning direction is unknown.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/attendance_*.py backend/tests/fakes backend/tests/test_attendance_*.py
git commit -m "feat(workforce): port BioTime ingest, identity matching, and attendance evaluation"
```

---

### Task 4: Port the workforce read/admin/schedule services, the API router, and the scheduler jobs

**Files:**
- Create: `backend/app/schemas/workforce.py`, `backend/app/api/v1/workforce.py`, `backend/app/services/workforce_read_service.py`, `workforce_admin_service.py`, `workforce_schedule_service.py`, `workforce_dashboard_service.py`, `workforce_leave.py`, `workforce_retention_service.py` (copy from branch)
- Modify: `backend/app/main.py:208` (router registration only), `backend/app/services/settings_service.py` (workforce configuration block only), `backend/app/services/scheduler_service.py` (four jobs), `backend/app/services/leave_service.py` (re-evaluation hook), `backend/app/services/duty_service.py` (duty event write)
- Test: `backend/tests/test_workforce_schedule.py`, `test_workforce_api_permissions.py`, `test_workforce_dashboard_api.py`, `test_workforce_leave_precedence.py`, `test_workforce_retention.py`, `test_workforce_scope_hardening.py` (copy from branch). The last one belongs here, not in Task 2: it drives `TestClient(app)` against `/api/v1/workforce/overrides`, `/configuration`, `/integration/people`, `/dashboard/snapshot`, `/dashboard/analytics` and `/access/me`, all of which 404 until this task registers the router and grafts `workforce_admin_service` + the `settings_service` configuration block.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `router` at `/api/v1/workforce` with the endpoint list in the inventory; `workforce_read_service.list_roster(db, *, scope, operational_date) -> list[dict]`; `list_exceptions(db, *, scope, operational_date, presence, exception) -> list[dict]`; `settings_service.get_workforce_configuration(db) -> WorkforceConfiguration | None`; `scheduler_service.run_workforce_evaluation_queue_drain_once() -> int`.

- [ ] **Step 1: Copy the schemas, services and API router**

```bash
git show dashboard/additive-baseline:backend/app/schemas/workforce.py > backend/app/schemas/workforce.py
git show dashboard/additive-baseline:backend/app/api/v1/workforce.py > backend/app/api/v1/workforce.py
for f in workforce_read_service workforce_admin_service workforce_schedule_service \
         workforce_dashboard_service workforce_leave workforce_retention_service; do
  git show dashboard/additive-baseline:backend/app/services/$f.py > backend/app/services/$f.py
done
for t in test_workforce_schedule test_workforce_api_permissions test_workforce_dashboard_api \
         test_workforce_leave_precedence test_workforce_retention test_workforce_scope_hardening; do
  git show dashboard/additive-baseline:backend/tests/$t.py > backend/tests/$t.py
done
```

- [ ] **Step 2: Register the router in `main.py`**

After the `permits_v1` include (line ~209), insert exactly:

```python
    # Workforce depends on the optional attendance persistence surface.  Import
    # it only while constructing the application so routine module imports
    # (including migration tooling) do not eagerly initialize that surface.
    from app.api.v1 import workforce as workforce_v1

    app.include_router(workforce_v1.router, prefix="/api/v1", dependencies=auth_gate)
```

Do not touch `spa_fallback`, do not add the `NotFoundError` import, do not add `preferences_v1`.

- [ ] **Step 3: Graft the workforce configuration block into `settings_service.py`**

Take from the branch only: `_WORKFORCE_CONFIGURATION_FIELDS`, `_WORKFORCE_CONFIGURATION_KEYS`, `_upsert_setting`, the `workforce.` guard inside `_set`, `_set_workforce_configuration_value`, `_as_utc`, `_duty_assignment_baseline`, `_validate_workforce_evaluation_boundary`, `get_workforce_configuration`, `update_workforce_configuration`, plus the import `from app.schemas.workforce import WorkforceConfiguration`. Skip `normalize_dashboard_layout` and `_get_dashboard_layout` entirely.

Verify: `grep -n "dashboard_layout" backend/app/services/settings_service.py` must show only pre-existing `main` occurrences (compare against `git show main:backend/app/services/settings_service.py | grep -c dashboard_layout`; the count must be unchanged).

- [ ] **Step 4: Graft the four scheduler jobs**

Take from the branch the job ids, `_attendance_sync_lock`, `_resolve_verified_attendance_provider`, `_load_workforce_configuration`, `_run_workforce_occurrence_generation`, `run_workforce_evaluation_queue_drain_once`, `_run_workforce_evaluation_queue_drain`, `_run_workforce_retention`, `_sync_attendance_stream`, and their `add_job` registrations. Keep the guard that resolves no provider unless `settings.biotime_configured` — an unconfigured deployment must report `not_configured`, never manufacture attendance.

- [ ] **Step 5: Graft the leave and duty hooks**

`leave_service.py`: add `_workforce_leave_snapshot(row: Leave) -> Leave` and, at the four mutation sites the branch touches, the pre-mutation snapshot plus the post-mutation enqueue that imports `enqueue_evaluation` from `attendance_queue_service` and `affected_reevaluation_windows` from `workforce_leave` (function-local imports, as on the branch, to avoid an import cycle).

`duty_service.py`: add the `DutyAssignmentEvent` write and its `enqueue_evaluation` call.

- [ ] **Step 6: Regenerate the OpenAPI document and the typed client**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" ../scripts/dump_openapi.py`
Expected: `backend/openapi.json` gains the `/api/v1/workforce/*` paths.

Run: `cd frontend && C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd gen:api`
Expected: `frontend/src/lib/api.types.ts` gains the workforce schemas. Do not hand-edit it.

- [ ] **Step 7: Run the workforce API suites**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_workforce_*.py -q`
Expected: all pass.

- [ ] **Step 8: Prove the rest of the backend is unharmed**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest -q`
Expected: no new failures versus the pre-task baseline. Record the baseline first with `git stash` if unsure — a pre-existing failure must not be attributed to this task.

- [ ] **Step 9: Commit**

```bash
git add backend/app/schemas/workforce.py backend/app/api/v1/workforce.py backend/app/services/workforce_*.py backend/app/main.py backend/app/services/settings_service.py backend/app/services/scheduler_service.py backend/app/services/leave_service.py backend/app/services/duty_service.py backend/openapi.json frontend/src/lib/api.types.ts backend/tests/test_workforce_*.py
git commit -m "feat(workforce): port read/admin/schedule services, API router, and scheduler jobs"
```

---

### Task 5: Port seeding and build the attendance test factory

`seed_workforce_roster` installs **schedule scaffolding only** — shifts, rotation patterns, crews,
crew schedules and one policy. It creates **no** crew memberships, **no** `WorkShiftOccurrence`
rows and **no** `AttendanceCase` rows. Verified signature and behaviour:
`seed_workforce_roster(db, *, actor_user_id: int, effective_from: date | None = None) -> SeedResult`
where `SeedResult` is `(shifts, patterns, crews, schedules, policy_created)`. There is no `today=`
parameter. Memberships come from `scripts/seed_workforce_demo.py::_memberships` (which skips any
employee lacking a **verified** provider mapping), occurrences from
`workforce_schedule_service.generate_occurrences`, and cases from
`attendance_evaluation_service.materialize_started_cases` + `evaluate_case`.

Every later task that needs rows therefore needs a real arrange pipeline. This task builds it once,
as a test factory, so Tasks 6, 7 and 14 stop inventing data that no code path produces.

**Files:**
- Create: `backend/app/services/workforce_seed_service.py`, `backend/scripts/seed_workforce_demo.py`, `backend/scripts/biotime_probe.py`, `backend/scripts/employee_directory.py` (copy from branch)
- Create: `backend/tests/factories/__init__.py`, `backend/tests/factories/attendance.py`
- Test: `backend/tests/test_workforce_seed_service.py`, `backend/tests/test_workforce_operational_smoke.py` (copy from branch), `backend/tests/test_attendance_factory.py` (new)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces `backend/tests/factories/attendance.py`:
  - `build_attendance_day(db, *, operational_date: date, unit: str = "السرية الثانية", posts: Sequence[tuple[str, int]] | None = None, punches: Mapping[str | None, Sequence[time]] | None = None) -> AttendanceDayFixture` — a `None` key in `punches` means "every employee in the fixture".
  - `@dataclass AttendanceDayFixture: admin: User; employees: list[Employee]; crew_id: int; cases: list[AttendanceCase]; provider_people: dict[str, AttendanceProviderPerson]`
  - `add_punch(db, *, provider_person: AttendanceProviderPerson, occurred_at: datetime, device_name: str = "Main Gate Turnstile") -> AttendancePunch` — inserts the punch only; no assignment row exists on this build.
- Also produces the seed-service constants `DUTY_UNIT_TO_CREW`, `OFFICE_CREW_CODE`, `PATTERN_GUARD`, `PATTERN_OFFICE`, `SITE_TIMEZONE`, and the seeded windows 05:00 / 13:00 / 21:00 (480 minutes each) plus office 07:00, with crew 2 anchored to noon on 2026-08-18.

- [ ] **Step 1: Copy the seed service, the scripts, and their tests**

```bash
git show dashboard/additive-baseline:backend/app/services/workforce_seed_service.py > backend/app/services/workforce_seed_service.py
for s in seed_workforce_demo biotime_probe employee_directory; do
  git show dashboard/additive-baseline:backend/scripts/$s.py > backend/scripts/$s.py
done
git show dashboard/additive-baseline:backend/tests/test_workforce_seed_service.py > backend/tests/test_workforce_seed_service.py
git show dashboard/additive-baseline:backend/tests/test_workforce_operational_smoke.py > backend/tests/test_workforce_operational_smoke.py
```

- [ ] **Step 2: Run the ported seed tests**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_workforce_seed_service.py tests/test_workforce_operational_smoke.py -q`
Expected: all pass. They pin the corrected windows (05/13/21, not 04/12/20) and the 5-day cycle in which a crew works noon on day 1 then morning **and** night on day 2.

- [ ] **Step 3: Write the failing factory test**

Create `backend/tests/test_attendance_factory.py`:

```python
"""The attendance test factory produces the rows the read paths need.

This exists because `seed_workforce_roster` installs schedule scaffolding only:
no memberships, no occurrences, no cases. Every read-path test depends on this
factory, so the factory itself is pinned first.
"""

from __future__ import annotations

from datetime import date, time

from app.db.workforce_models import AttendanceCase
from tests.factories.attendance import build_attendance_day


def test_factory_creates_cases_for_every_seeded_person(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=date(2026, 8, 19),
        posts=[("البوابة الرئيسية", 3), ("التفتيش", 2)],
    )

    assert len(fixture.employees) == 5
    assert fixture.cases, "the factory must materialize started cases"
    assert {case.operational_date for case in fixture.cases} == {date(2026, 8, 19)}
    assert {case.duty_post_snapshot for case in fixture.cases} == {
        "البوابة الرئيسية",
        "التفتيش",
    }
    assert all(case.shift_code_snapshot for case in fixture.cases)
    # `fixture.cases` is filtered to the requested operational date, while the
    # generation window necessarily also materializes the neighbouring day's
    # cases (crew 2 works noon on 18 Aug, then morning AND night on 19 Aug), so
    # the table legitimately holds MORE rows than the fixture exposes.
    assert db_session.query(AttendanceCase).count() >= len(fixture.cases)
    # The double day: five people, two shifts each on 19 Aug.
    assert len(fixture.cases) == 2 * len(fixture.employees)


def test_factory_attaches_punches_to_the_right_case(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=date(2026, 8, 19),
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 47), time(12, 6)]},  # None = "every employee"
    )

    case = fixture.cases[0]
    assignments = [a for a in db_session.query(AttendanceCase).all() if a.id == case.id]
    assert assignments, "the case survives"
    # The punch bounds the register will read:
    from sqlalchemy import func, select
    from app.db.workforce_models import AttendancePunch, AttendancePunchAssignment

    first_at, last_at, count = db_session.execute(
        select(
            func.min(AttendancePunch.occurred_at),
            func.max(AttendancePunch.occurred_at),
            func.count(AttendancePunch.id),
        )
        .join(AttendancePunch, AttendancePunch.id == AttendancePunchAssignment.punch_id)
        .where(AttendancePunchAssignment.attendance_case_id == case.id)
    ).one()
    assert count == 2
    assert first_at < last_at
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_factory.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'tests.factories'`.

- [ ] **Step 5: Implement the factory**

Create `backend/tests/factories/__init__.py` (empty) and `backend/tests/factories/attendance.py`. The pipeline, in this exact order — every call signature below was read from the branch and is verified:

```python
"""Build a complete attendance day: crews, people, memberships, occurrences, cases.

Ordering is not incidental. Occurrences can only be generated after a crew has a
schedule (the seed service installs those), cases can only be materialized from
occurrences that have already STARTED relative to `as_of`, and a punch can only
be assigned to a case that exists. Any other order silently produces zero rows,
which is exactly the failure this factory was written to eliminate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Employee, User
from app.db.workforce_models import (
    AttendanceCase,
    AttendanceProviderPerson,
    AttendancePunch,
    AttendanceSyncState,
    WorkCrew,
)
from app.services import (
    attendance_evaluation_service,
    workforce_schedule_service,
    workforce_seed_service,
)
from tests.conftest import make_user

SITE_ZONE = ZoneInfo("Asia/Dubai")
DEFAULT_POSTS: Sequence[tuple[str, int]] = (
    ("البوابة الرئيسية", 6),
    ("التفتيش", 6),
    ("دورية السياج", 5),
)


@dataclass
class AttendanceDayFixture:
    admin: User
    employees: list[Employee] = field(default_factory=list)
    crew_id: int = 0
    cases: list[AttendanceCase] = field(default_factory=list)
    provider_people: dict[str, AttendanceProviderPerson] = field(default_factory=dict)


def _local(day: date, at: time) -> datetime:
    """A site-local instant, timezone-aware.

    Always build instants this way rather than by subtracting a fixed offset:
    `workforce_schedule_service._utc_naive` converts with `astimezone(UTC)`, and
    `create_crew_membership` validates the value against Dubai shift boundaries
    via `_is_shift_boundary`, so an hour-arithmetic approximation is rejected.
    """
    return datetime.combine(day, at, tzinfo=SITE_ZONE)


def _utc_naive(moment: datetime) -> datetime:
    """The UTC-naive form every workforce datetime column stores."""
    return moment.astimezone(UTC).replace(tzinfo=None)

def build_attendance_day(
    db: Session,
    *,
    operational_date: date,
    unit: str = "السرية الثانية",
    posts: Sequence[tuple[str, int]] | None = None,
    punches: Mapping[str | None, Sequence[time]] | None = None,
) -> AttendanceDayFixture:
    admin = make_user(db, role="admin", email=f"factory-{operational_date}@test.ae")
    db.flush()

    # 1. Schedule scaffolding: shifts, patterns, crews, crew schedules, policy.
    workforce_seed_service.seed_workforce_roster(db, actor_user_id=admin.id)
    db.flush()

    crew_code = workforce_seed_service.DUTY_UNIT_TO_CREW[unit]
    crew = db.scalar(select(WorkCrew).where(WorkCrew.code == crew_code))
    assert crew is not None, f"seeding must create crew {crew_code}"

    fixture = AttendanceDayFixture(admin=admin, crew_id=crew.id)

    # 2. Employees carrying the duty hierarchy the register groups by, each with
    #    a VERIFIED provider mapping (an unmapped person is excluded from every
    #    count by design, so a fixture without mappings tests nothing).
    index = 0
    for post, headcount in posts or DEFAULT_POSTS:
        for _ in range(headcount):
            index += 1
            employee = Employee(
                id=f"G-{9000 + index}",
                name_en=f"Factory Person {index}",
                name_ar=f"شخص {index}",
                status="Active",
                department="الأمن",
                duty_unit=unit,
                duty_post=post,
            )
            db.add(employee)
            fixture.employees.append(employee)
            db.flush()

            person = AttendanceProviderPerson(
                provider="biotime",
                external_person_id=str(8000 + index),
                external_employee_code=employee.id,
                display_name_snapshot=employee.name_en,
                employee_id=employee.id,
                mapping_state="verified",
                # ck_attendance_provider_people_verified_fields: a verified row
                # MUST carry employee_id AND verified_by_user_id AND verified_at.
                verified_by_user_id=admin.id,
                verified_at=_utc_naive(_local(date(2026, 8, 1), time(0, 0))),
                active=True,
                first_seen_at=_utc_naive(_local(date(2026, 8, 1), time(0, 0))),
                last_seen_at=_utc_naive(_local(operational_date, time(23, 0))),
            )
            db.add(person)
            fixture.provider_people[employee.id] = person

            # 3. Crew membership: without it the employee has no schedule.
            workforce_schedule_service.create_crew_membership(
                db,
                employee_id=employee.id,
                crew_id=crew.id,
                # MUST be a Dubai shift boundary (05:00 / 13:00 / 21:00 / 07:00):
                # create_crew_membership rejects anything else via
                # _is_shift_boundary("membership changes must use Dubai shift
                # boundaries"). Dubai 05:00 on 1 Aug = 01:00Z.
                effective_from=_local(date(2026, 8, 1), time(5, 0)),
                actor_user_id=admin.id,
            )
    db.flush()

    # 4. Materialize the day's occurrences for this crew. The seeded schedule's
    #    anchor_at/effective_from is its crew's own noon anchor (crew 2 →
    #    2026-08-18 13:00 local), and generate_occurrences skips any start
    #    before effective_from, so the window must reach past that anchor.
    workforce_schedule_service.generate_occurrences(
        db,
        crew_id=crew.id,
        starts_at=_local(operational_date, time(0, 0)) - timedelta(days=3),
        ends_at=_local(operational_date, time(0, 0)) + timedelta(days=2),
    )
    db.flush()

    # 5. Freshness: without an AttendanceSyncState row for ("biotime", "punches")
    #    `_fresh_through` returns None and every decision degrades to a
    #    not-yet-trustworthy state, so presence_state would never be
    #    "completed"/"absent" and every state assertion downstream would be
    #    testing the stale path instead of the real one.
    db.merge(
        AttendanceSyncState(
            provider="biotime",
            stream="punches",
            fresh_through=_utc_naive(_local(operational_date, time(23, 59))),
            last_success_at=_utc_naive(_local(operational_date, time(23, 59))),
        )
    )
    db.flush()

    # 6. Cases exist only for occurrences that have already started, so
    #    materialize as of the end of the operational day.
    as_of = _local(operational_date, time(23, 59))
    evaluation_start_at = _local(date(2026, 8, 1), time(0, 0))
    for employee in fixture.employees:
        attendance_evaluation_service.materialize_started_cases(
            db,
            employee_id=employee.id,
            as_of=as_of,
            evaluation_start_at=evaluation_start_at,
        )
    db.flush()

    fixture.cases = list(
        db.scalars(
            select(AttendanceCase).where(AttendanceCase.operational_date == operational_date)
        )
    )

    # 7. Optional punches. `add_punch` inserts the row and then calls the real
    #    allocator, `attendance_punch_service.resolve_assignment`, which both
    #    writes the assignment and re-evaluates the affected case(s) — so a
    #    double-shift day (this rotation's morning+night day) is allocated by
    #    the production rule, not by a hand-rolled time window.
    if punches:
        for employee_id, times in punches.items():
            targets = (
                fixture.employees
                if employee_id is None
                else [e for e in fixture.employees if e.id == employee_id]
            )
            for employee in targets:
                for at in times:
                    add_punch(
                        db,
                        provider_person=fixture.provider_people[employee.id],
                        occurred_at=_local(operational_date, at),
                    )
    db.flush()

    for case in fixture.cases:
        attendance_evaluation_service.evaluate_case(
            db, case.id, evaluated_at=as_of, evaluation_start_at=evaluation_start_at
        )
    db.commit()
    return fixture


def add_punch(
    db: Session,
    *,
    provider_person: AttendanceProviderPerson,
    occurred_at: datetime,
    device_name: str = "Main Gate Turnstile",
) -> AttendancePunch:
    """Insert one punch. Deliberately no assignment row.

    `attendance_punch_service.resolve_assignment` is NOT called, and no
    `AttendancePunchAssignment` is written by hand, because on this build neither
    can happen: `select_punch_case` returns None unless
    `punch.direction in {"in", "out"}`, and this provider reports
    `punch_state 255`/"unknown" for every event. The assignment table is therefore
    empty in production, and both the evaluator (`_matching_punches`) and the
    register (`list_attendance_day`) find punches by provider person plus the
    case's policy match window. A fixture that faked assignments would test a
    code path the live system never takes.

    `normalized_payload_hash` is NOT NULL with no server default and must be
    supplied; `direction` stays "unknown" for the same reason.
    """
    punch = AttendancePunch(
        provider="biotime",
        external_event_id=f"factory-{provider_person.id}-{occurred_at.isoformat()}",
        provider_person_id=provider_person.id,
        occurred_at=_utc_naive(occurred_at),
        direction="unknown",
        device_name=device_name,
        normalized_payload_hash=f"h{provider_person.id}-{int(occurred_at.timestamp())}",
    )
    db.add(punch)
    db.flush()
    return punch
```

Two guardrails while implementing this file: (1) punches must land inside the seeded policy's match window (`match_before_minutes = 60`, `match_after_minutes = 120`) relative to the case, or the evaluator will not see them — move the punch, never widen the policy; (2) if `materialize_started_cases` returns nothing, the occurrence window or `as_of` is wrong, or the crew's seeded schedule anchor is later than the requested day — print the generated occurrences and compare against `schedule.anchor_at` before changing anything in `app/`.

- [ ] **Step 6: Run the factory test to verify it passes**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_factory.py -q`
Expected: 2 passed. If `materialize_started_cases` returns nothing, the occurrence window or `as_of` is wrong — fix the factory, never the service.

- [ ] **Step 7: Prove the ported reads answer with factory data**

Create `backend/tests/test_attendance_seeded_reads.py`:

```python
"""The ported read endpoints answer for a real operational day.

This is the port's acceptance test: it fails if the roster query, the scope
gate, or the evaluation join regressed during the graft.
"""

from __future__ import annotations

from datetime import date

from app.services import workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.factories.attendance import build_attendance_day


def test_roster_returns_rows_for_the_factory_day(db_session) -> None:
    fixture = build_attendance_day(db_session, operational_date=date(2026, 8, 19))
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_roster(
        db_session, scope=scope, operational_date=date(2026, 8, 19)
    )

    assert rows, "the factory day must have scheduled people"
    for row in rows:
        assert row["employee_id"]
        assert row["scheduled_start_at"] is not None
        assert row["shift_code"] in {"morning", "noon", "night", "office_day"}
        assert row["duty_unit"] == "السرية الثانية"
```

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_seeded_reads.py -q`
Expected: PASS.

- [ ] **Step 8: Prepare the preview database (this is where Task 14's data comes from)**

The preview database is built with the same factory the tests use, so the preview and the suite cannot disagree. Verified prerequisites: `auth_service.register(db, *, email, password, g_number=None, display_name=None) -> tuple[User, bool]` (the **first** account becomes active + admin), and `tests` is a real package (`backend/tests/__init__.py`) that imports cleanly with `backend/` on `sys.path` — `pyproject.toml` sets `pythonpath = ["backend"]` for pytest, and a plain script needs `PYTHONPATH=.` from `backend/`.

```bash
cd backend
export GSSG_DATA_DIR=C:/Users/Amh/AppData/Local/Temp/attendance-preview
export PYTHONPATH=.
"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m alembic upgrade head

# 1. First account = active admin, and it owns every audit row the factory writes.
"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" - <<'PY'
from app.db.session import SessionLocal
from app.services import auth_service

with SessionLocal() as db:
    user, is_first = auth_service.register(
        db,
        email="admin@preview.local",
        password="preview-admin-pw",
        display_name="Preview Admin",
    )
    db.commit()
    print("admin:", user.email, "first:", is_first, "role:", user.role)
PY

# 2. 40 guards across the nine real posts, with memberships, occurrences, cases
#    and two punches each so the register has times to print.
"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" - <<'PY'
from datetime import date, time

from app.db.session import SessionLocal
from tests.factories.attendance import build_attendance_day

GUARD = [
    ("البوابة الرئيسية", 6), ("التفتيش", 6), ("دورية السياج", 5), ("برج المراقبة", 4),
    ("ليوان", 4), ("تفتيش المركبات", 4), ("بوابة الورشة", 4), ("ساحة المخازن", 4),
    ("غرفة التحكم", 3),
]

with SessionLocal() as db:
    fixture = build_attendance_day(
        db,
        operational_date=date(2026, 8, 19),
        posts=GUARD,
        punches={None: [time(4, 52), time(12, 40)]},
    )
    print("employees:", len(fixture.employees), "cases:", len(fixture.cases))
PY
```

`build_attendance_day` calls `make_user` from `tests.conftest`, which creates its own admin; that is harmless here (the registered account above is the one you log in with, and it is the first account, so it is the admin). Expected output: `employees: 40`, and `cases: 80` — **not 40**: 19 Aug 2026 is crew 2's double day in the 5-day rotation (it works both the morning and the night window), so every guard has two cases. The register therefore shows two shift sections for that day, which is correct and is exactly why the toolbar has a shift filter.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/workforce_seed_service.py backend/scripts backend/tests/factories backend/tests/test_workforce_seed_service.py backend/tests/test_workforce_operational_smoke.py backend/tests/test_attendance_factory.py backend/tests/test_attendance_seeded_reads.py
git commit -m "feat(workforce): port seeding and add the attendance test factory

seed_workforce_roster installs schedule scaffolding only, so the factory adds the
memberships, occurrences, cases and punch assignments every read-path test needs."
```

---

### Task 6: New endpoint — `GET /workforce/attendance/day`

The register, board and timeline all read this one payload. It is `RosterRowRead` plus the punch facts the roster deliberately omits.

**Files:**
- Modify: `backend/app/schemas/workforce.py` (add `AttendanceDayRowRead`)
- Modify: `backend/app/services/workforce_read_service.py` (add `list_attendance_day`)
- Modify: `backend/app/api/v1/workforce.py` (add the route beside `get_attendance_exceptions`)
- Test: `backend/tests/test_attendance_day_endpoint.py`

**Interfaces:**
- Consumes: Task 5's `tests.factories.attendance.build_attendance_day` / `add_punch`; `_case_allowed`, `_latest_evaluations`, `_person_fields` (private helpers already in `workforce_read_service`); `AttendancePunch`, `AttendancePunchAssignment`, `AttendanceCase.shift_code_snapshot`.
- Produces: `GET /api/v1/workforce/attendance/day?operational_date=YYYY-MM-DD&shift_code=<code>&limit=&cursor=` → `CursorPage[AttendanceDayRowRead]`, requiring both `workforce.people.view` and `workforce.attendance.review`; and `workforce_read_service.list_attendance_day(db, *, scope, operational_date, shift_code=None) -> list[dict[str, Any]]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_attendance_day_endpoint.py`:

```python
"""GET /workforce/attendance/day — the register payload.

Contract under test:
  * one row per person per scheduled shift for the operational date;
  * first_punch_at / last_punch_at / punch_count come from the punches actually
    assigned to that case, so the register can print "05:47" and "+17m";
  * on_leave is true only for an excused-leave evaluation, because a person on
    approved leave leaves the coverage denominator instead of reading as a gap;
  * the shift_code filter narrows to one window.

All arrangement goes through tests.factories.attendance: seed_workforce_roster
alone creates no memberships, occurrences or cases, so a test that calls it
directly asserts against an empty database.
"""

from __future__ import annotations

from datetime import date, time

from app.services import workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.factories.attendance import build_attendance_day

DAY = date(2026, 8, 19)


def test_day_rows_carry_punch_bounds(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 2)],
        punches={None: [time(4, 47), time(12, 6)]},
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )

    assert rows, "the factory day must produce rows"
    row = rows[0]
    assert row["punch_count"] == 2
    assert row["first_punch_at"] is not None
    assert row["last_punch_at"] is not None
    assert row["first_punch_at"] < row["last_punch_at"]
    assert row["on_leave"] is False


def test_a_person_with_no_punch_reports_no_bounds(db_session) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("التفتيش", 1)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    rows = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )

    assert rows
    assert rows[0]["punch_count"] == 0
    assert rows[0]["first_punch_at"] is None
    assert rows[0]["late_minutes"] is None


def test_shift_code_filter_narrows_the_day(db_session) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 2)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    everything = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY
    )
    codes = {row["shift_code"] for row in everything}
    assert codes, "the day must have at least one shift code"
    one = sorted(codes)[0]

    narrowed = workforce_read_service.list_attendance_day(
        db_session, scope=scope, operational_date=DAY, shift_code=one
    )

    assert narrowed
    assert {row["shift_code"] for row in narrowed} == {one}
    assert len(narrowed) <= len(everything)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_day_endpoint.py -q`
Expected: FAIL with `AttributeError: module 'app.services.workforce_read_service' has no attribute 'list_attendance_day'`.

- [ ] **Step 3: Add the response schema**

In `backend/app/schemas/workforce.py`, immediately after `AttendanceExceptionRead`:

```python
class AttendanceDayRowRead(RosterRowRead):
    """One person's scheduled shift on one operational date, with punch facts.

    `first_punch_at` / `last_punch_at` are the earliest and latest punches that
    fall in this case's policy match window. They are timestamps of events, not a
    check-in and a check-out: this provider reports no direction, so a single
    punch yields `punch_count == 1` with both bounds equal, and the client must
    present it as "seen at", never as a span.
    """

    first_punch_at: datetime | None = None
    last_punch_at: datetime | None = None
    punch_count: int = Field(default=0, ge=0)
    late_minutes: int | None = Field(default=None, ge=0)
    on_leave: bool = False
```

Export it by adding `"AttendanceDayRowRead",` to the module's `__all__` in alphabetical position.

- [ ] **Step 4: Implement the read service function**

In `backend/app/services/workforce_read_service.py`, after `list_exceptions`:

```python
def list_attendance_day(
    db: Session,
    *,
    scope: Any,
    operational_date: date,
    shift_code: str | None = None,
) -> list[dict[str, Any]]:
    """Every scheduled person for one operational date, with their punch bounds.

    Punch bounds are read the same way the evaluator reads evidence
    (`attendance_evaluation_service._matching_punches`): by the employee's active
    verified provider person, inside the case's policy match window, skipping any
    punch already assigned to a DIFFERENT case.

    It deliberately does NOT join `attendance_punch_assignments`. That table only
    ever receives directional punches — `attendance_punch_service.select_punch_case`
    returns None unless `punch.direction in {"in", "out"}` — and this build reports
    `punch_state 255`/"unknown" for every event, so the assignment table is
    permanently empty here and a register built on it would show no times at all.
    """
    cases = [
        case
        for case in db.scalars(
            select(AttendanceCase).where(AttendanceCase.operational_date == operational_date)
        )
        if _case_allowed(case, scope)
    ]
    if shift_code is not None:
        cases = [case for case in cases if case.shift_code_snapshot == shift_code]
    if not cases:
        return []
    latest = _latest_evaluations(db, [case.id for case in cases])

    # One provider-person lookup for the whole page: the unique partial index
    # `uq_attendance_provider_people_verified_active_employee` guarantees at most
    # one active verified row per employee.
    employee_ids = {case.employee_id for case in cases}
    person_by_employee = {
        person.employee_id: person
        for person in db.scalars(
            select(AttendanceProviderPerson).where(
                AttendanceProviderPerson.employee_id.in_(employee_ids),
                AttendanceProviderPerson.mapping_state == "verified",
                AttendanceProviderPerson.active.is_(True),
            )
        )
    }

    bounds: dict[int, tuple[datetime | None, datetime | None, int]] = {}
    for case in cases:
        person = person_by_employee.get(case.employee_id)
        policy = _effective_policy(db, case)
        if person is None or policy is None:
            bounds[case.id] = (None, None, 0)
            continue
        window_start = case.scheduled_start_at - timedelta(minutes=policy.match_before_minutes)
        window_end = case.scheduled_end_at + timedelta(minutes=policy.match_after_minutes)
        first_at, last_at, count = db.execute(
            select(
                func.min(AttendancePunch.occurred_at),
                func.max(AttendancePunch.occurred_at),
                func.count(AttendancePunch.id),
            )
            .outerjoin(
                AttendancePunchAssignment,
                AttendancePunchAssignment.punch_id == AttendancePunch.id,
            )
            .where(
                AttendancePunch.provider_person_id == person.id,
                AttendancePunch.occurred_at >= window_start,
                AttendancePunch.occurred_at <= window_end,
                or_(
                    AttendancePunchAssignment.punch_id.is_(None),
                    AttendancePunchAssignment.attendance_case_id == case.id,
                ),
            )
        ).one()
        bounds[case.id] = (first_at, last_at, count)

    result: list[dict[str, Any]] = []
    for case in cases:
        evaluation = latest.get(case.id)
        first_at, last_at, count = bounds[case.id]
        presence_state = evaluation.presence_state if evaluation else None
        result.append(
            {
                **_person_fields(db, case),
                "presence_state": presence_state,
                "reason_code": evaluation.reason_code if evaluation else None,
                "first_punch_at": first_at,
                "last_punch_at": last_at,
                "punch_count": count,
                "late_minutes": _late_minutes(case, first_at),
                "on_leave": presence_state == "excused_leave",
            }
        )
    return sorted(result, key=lambda row: (row["scheduled_start_at"], row["employee_id"]))
```

`_effective_policy` already exists in `attendance_evaluation_service`; import it there
(`from app.services.attendance_evaluation_service import _effective_policy`) rather than
duplicating policy resolution, or promote it to a public name in that module and use that.
One query per case is acceptable and deliberate: a day is ~150 cases, each query is an
indexed aggregate on `(provider_person_id, occurred_at)`, and the alternative — one query
with per-case windows — needs a correlated subquery whose plan SQLite does not improve on.

Add the one private helper next to it (`_shift_code_of` is NOT needed: `AttendanceCase`
carries `shift_code_snapshot`, and `_person_fields` already returns it — the snapshot is
also the historically correct value, whereas joining today's shift definition would
re-label an old day with today's configuration, and `shift_occurrence_id` is nullable for
override and duty-event cases, so joining through it would silently drop rows):

```python
def _late_minutes(case: AttendanceCase, first_punch_at: datetime | None) -> int | None:
    """Whole minutes between the scheduled start and the first punch.

    Grace is NOT applied here: the client needs the raw lateness so it can show
    both "inside grace" and "+17m past grace" from one number, and the grace
    value itself belongs to the policy, not to a read projection.
    """
    if first_punch_at is None:
        return None
    delta = (first_punch_at - case.scheduled_start_at).total_seconds() // 60
    return int(delta) if delta > 0 else 0
```

Extend the module's imports with `func` from `sqlalchemy` and `AttendancePunch`, `AttendancePunchAssignment` from `app.db.workforce_models` if not already imported. Verified column facts: `AttendancePunchAssignment` has `punch_id` as its single-column primary key and `attendance_case_id` as the case FK (with index `ix_attendance_punch_assignments_case`), so one punch belongs to at most one case and the grouped aggregate needs no de-duplication or validity filter.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_day_endpoint.py -q`
Expected: 3 passed.

- [ ] **Step 6: Add the route**

In `backend/app/api/v1/workforce.py`, directly after `get_attendance_exceptions`:

```python
@router.get("/attendance/day", response_model=CursorPage[AttendanceDayRowRead])
def get_attendance_day(
    operational_date: date,
    user: Annotated[User, Depends(require_capability("workforce.attendance.review"))],
    people_user: Annotated[User, Depends(require_capability("workforce.people.view"))],
    db: Annotated[Session, Depends(get_db)],
    shift_code: Annotated[str | None, Query(pattern="^[a-z_]{1,32}$")] = None,
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 200,
    cursor: str | None = None,
) -> dict[str, Any]:
    """The register payload: one row per person per scheduled shift, with punches."""
    scope = _scope(db, user)
    rows = workforce_read_service.list_attendance_day(
        db, scope=scope, operational_date=operational_date, shift_code=shift_code
    )
    items, next_cursor = _cursor_page(
        rows,
        endpoint="attendance-day",
        scope=scope,
        filters={"operational_date": operational_date, "shift_code": shift_code},
        limit=limit,
        cursor=cursor,
    )
    return {"items": items, "next_cursor": next_cursor}
```

Add `AttendanceDayRowRead` to the schema imports at the top of the module.

- [ ] **Step 7: Test the route through the API, including the capability gate**

Append to `backend/tests/test_attendance_day_endpoint.py` a test that mirrors the existing style in `backend/tests/test_workforce_api_permissions.py`: a user with `workforce.people.view` but **without** `workforce.attendance.review` receives 403 from `/api/v1/workforce/attendance/day`, and an admin receives 200 with `items` present. Copy the client construction and capability-granting helper from that file verbatim rather than inventing one.

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_attendance_day_endpoint.py tests/test_workforce_api_permissions.py -q`
Expected: all pass.

- [ ] **Step 8: Regenerate the client and commit**

```bash
cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" ../scripts/dump_openapi.py && cd ../frontend && C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd gen:api && cd ..
git add backend/app/schemas/workforce.py backend/app/services/workforce_read_service.py backend/app/api/v1/workforce.py backend/tests/test_attendance_day_endpoint.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(attendance): add the day-register read endpoint with punch bounds"
```

---

### Task 7: New endpoint — `GET /workforce/employees/{employee_id}/attendance`

Feeds the per-employee tab: one month of days, plus each day's punch list.

**Files:**
- Modify: `backend/app/schemas/workforce.py` (`EmployeeAttendancePunchRead`, `EmployeeAttendanceDayRead`, `EmployeeAttendanceRangeRead`)
- Modify: `backend/app/services/workforce_read_service.py` (`employee_attendance_range`)
- Modify: `backend/app/api/v1/workforce.py` (the route + self-access rule)
- Test: `backend/tests/test_employee_attendance_endpoint.py`

**Interfaces:**
- Consumes: Task 6's `_late_minutes`, plus the existing `_latest_evaluations`, `_case_allowed`, `_person_fields` and `AttendanceCase.shift_code_snapshot`.
- Produces: `GET /api/v1/workforce/employees/{employee_id}/attendance?from_date=&to_date=` → `EmployeeAttendanceRangeRead`; `workforce_read_service.employee_attendance_range(db, *, scope, employee_id, from_date, to_date) -> dict[str, Any]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_employee_attendance_endpoint.py` with three tests:

```python
"""GET /workforce/employees/{id}/attendance — the per-employee month.

Contract under test:
  * every scheduled day in the window appears once, with its shift code,
    presence state, late minutes and punch bounds;
  * each day carries its own punch list (time + device), because the tab draws a
    per-day timeline;
  * a user holding only workforce.self.view may read their OWN linked employee
    and nobody else's;
  * an over-wide window is refused as a 422, not a 500.
"""

from __future__ import annotations

from datetime import date, time

import pytest

from app.api.errors import ValidationFailedError
from app.services import perm_service, workforce_read_service
from app.services.workforce_scope_service import resolve_workforce_scope
from tests.conftest import make_user
from tests.factories.attendance import build_attendance_day

DAY = date(2026, 8, 19)


def test_range_returns_one_entry_per_scheduled_day(db_session) -> None:
    fixture = build_attendance_day(
        db_session,
        operational_date=DAY,
        posts=[("البوابة الرئيسية", 1)],
        punches={None: [time(4, 52), time(12, 40)]},
    )
    employee_id = fixture.employees[0].id
    scope = resolve_workforce_scope(db_session, fixture.admin)

    payload = workforce_read_service.employee_attendance_range(
        db_session,
        scope=scope,
        employee_id=employee_id,
        from_date=date(2026, 8, 1),
        to_date=date(2026, 8, 31),
    )

    assert payload["employee_id"] == employee_id
    assert payload["days"], "a rostered employee has scheduled days in August"
    seen = [day["operational_date"] for day in payload["days"]]
    assert len(seen) == len(set(seen)), "one entry per day, never duplicated"
    for day in payload["days"]:
        assert day["shift_code"] in {"morning", "noon", "night", "office_day"}
        assert isinstance(day["punches"], list)
    punched = [day for day in payload["days"] if day["punch_count"] > 0]
    assert punched, "the punches the factory attached must appear"
    assert punched[0]["punches"][0]["device_name"] == "Main Gate Turnstile"


def test_self_view_reads_own_record_only(db_session) -> None:
    """workforce.self.view is a self-scoped grant, not a roster grant.

    Built with the module-local client factory from
    tests/test_workforce_api_permissions.py (`_client(db, user)`); there is no
    `client` fixture in conftest.py.
    """
    from tests.test_workforce_api_permissions import _client

    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("البوابة الرئيسية", 2)]
    )
    mine, theirs = fixture.employees[0], fixture.employees[1]

    viewer = make_user(db_session, role="operator", email="self-view@test.ae")
    viewer.employee_id = mine.id
    perm_service.set_user_override(db_session, viewer.id, "workforce.self.view", "grant")
    db_session.commit()

    client = _client(db_session, viewer)
    ok = client.get(
        f"/api/v1/workforce/employees/{mine.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert ok.status_code == 200, ok.text

    denied = client.get(
        f"/api/v1/workforce/employees/{theirs.id}/attendance",
        params={"from_date": "2026-08-01", "to_date": "2026-08-31"},
    )
    assert denied.status_code == 403, denied.text


def test_window_wider_than_ninety_two_days_is_rejected(db_session) -> None:
    fixture = build_attendance_day(
        db_session, operational_date=DAY, posts=[("التفتيش", 1)]
    )
    scope = resolve_workforce_scope(db_session, fixture.admin)

    with pytest.raises(ValidationFailedError):
        workforce_read_service.employee_attendance_range(
            db_session,
            scope=scope,
            employee_id=fixture.employees[0].id,
            from_date=date(2026, 1, 1),
            to_date=date(2026, 12, 31),
        )
```

Read `perm_service` and `tests/test_workforce_api_permissions.py` before writing this: use the real override-granting function (`set_user_override`) and the real `_client` factory signature. Do not add a `client` fixture to `conftest.py` for this.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_employee_attendance_endpoint.py -q`
Expected: FAIL — `employee_attendance_range` does not exist.

- [ ] **Step 3: Add the schemas**

```python
class EmployeeAttendancePunchRead(BaseModel):
    """One provider event. Direction is omitted deliberately: this build reports
    `punch_state 255` for every row, so a client must not render in/out."""

    model_config = ConfigDict(extra="forbid")

    occurred_at: datetime
    device_name: str | None = None


class EmployeeAttendanceDayRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operational_date: date
    shift_code: str | None = None
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    late_minutes: int | None = Field(default=None, ge=0)
    punch_count: int = Field(default=0, ge=0)
    punches: list[EmployeeAttendancePunchRead] = Field(default_factory=list)


class EmployeeAttendanceRangeRead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: str
    from_date: date
    to_date: date
    days: list[EmployeeAttendanceDayRead]
```

- [ ] **Step 4: Implement `employee_attendance_range`**

Bound the window at 92 days and raise `ValidationFailedError("ATTENDANCE_RANGE_TOO_WIDE", "The attendance window may not exceed 92 days.")` from `app.api.errors` beyond it. **Do not raise a bare `ValueError`:** `backend/app/api/errors.py` registers handlers for `AppError`, `RequestValidationError`, `StarletteHTTPException` and a catch-all `Exception` that returns **500** — there is no `ValueError` mapping, so a bare `ValueError` would surface as a server error, not a 422. `ValidationFailedError` is an `AppError` subclass already pinned to 422. Then select this employee's cases inside the window, reuse `_latest_evaluations` and `_late_minutes`, read the shift code from `case.shift_code_snapshot`, and attach each case's punches ordered by `occurred_at` with `device_name`. Enforce scope with the existing `_case_allowed(case, scope)` so a scoped manager cannot read outside their hierarchy.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_employee_attendance_endpoint.py -q`
Expected: 3 passed.

- [ ] **Step 6: Add the route with the self-access rule**

```python
@router.get(
    "/employees/{employee_id}/attendance",
    response_model=EmployeeAttendanceRangeRead,
)
def get_employee_attendance(
    employee_id: str,
    from_date: date,
    to_date: date,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """One employee's attendance days.

    Two separate doors: `workforce.self.view` opens only the caller's own linked
    employee record, while a roster reader needs both `workforce.people.view`
    and `workforce.attendance.review` and stays inside their resolved scope.
    """
    own = bool(user.employee_id) and user.employee_id.strip() == employee_id
    if own and perm_service.has_capability(db, user, "workforce.self.view"):
        scope = _scope(db, user)
    else:
        for capability in ("workforce.people.view", "workforce.attendance.review"):
            if not perm_service.has_capability(db, user, capability):
                raise AppError(
                    "FORBIDDEN",
                    "Capability required.",
                    http_status=status.HTTP_403_FORBIDDEN,
                )
        scope = _scope(db, user)
    return workforce_read_service.employee_attendance_range(
        db, scope=scope, employee_id=employee_id, from_date=from_date, to_date=to_date
    )
```

Use whichever error class `workforce.py` already raises for a capability failure — read the file and match it exactly rather than importing a new one.

- [ ] **Step 7: Regenerate, run, commit**

Run: `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" ../scripts/dump_openapi.py && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest tests/test_employee_attendance_endpoint.py tests/test_workforce_api_permissions.py -q && cd ../frontend && C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd gen:api`
Expected: all pass; `api.types.ts` gains `EmployeeAttendanceRangeRead`.

```bash
git add backend/app/schemas/workforce.py backend/app/services/workforce_read_service.py backend/app/api/v1/workforce.py backend/tests/test_employee_attendance_endpoint.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(attendance): add the per-employee attendance range endpoint"
```

---

### Task 8: Frontend plumbing — api wrappers, route, section tabs, locales

**Files:**
- Modify: `frontend/src/lib/api.ts` (4 wrappers + params types)
- Create: `frontend/src/components/employees/EmployeesSectionTabs.tsx`
- Create: `frontend/src/components/employees/EmployeesSectionTabs.test.tsx`
- Create: `frontend/src/pages/employees/attendance/AttendancePage.tsx` (shell only in this task)
- Modify: `frontend/src/App.tsx:35-84` (lazy import), `:212-213` (route)
- Modify: `frontend/src/pages/employees/EmployeeLookupPage.tsx` (render the tabs)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify: `frontend/src/index.css` (bidi utility)

**Interfaces:**
- Consumes: Task 6/7 endpoints; generated types `AttendanceDayRowRead`, `EmployeeAttendanceRangeRead`, `IntegrationStatusRead`, `WorkforceSnapshotRead`.
- Produces: `api.listAttendanceDay(params)`, `api.getEmployeeAttendance(employeeId, params)`, `api.getWorkforceIntegrationStatus()`, `api.getWorkforceSnapshot()`; `<EmployeesSectionTabs active="directory" | "attendance" attentionCount={number | null} />`; route `/employees/attendance`; i18n namespace `attendance.*` and key `employee.tab.attendance`.

- [ ] **Step 1: Add the api wrappers**

In `frontend/src/lib/api.ts`, beside the other employee wrappers:

```ts
// `api.types.ts` exports only `paths` and `components`; openapi-typescript emits
// no per-schema aliases. Every existing type in api.ts is a local re-export of
// `components['schemas'][…]` (see api.ts:16 and :22), so follow that exactly —
// a bare `CursorPage_AttendanceDayRowRead_` identifier does not exist and will
// not compile.
export type AttendanceDayRow = components['schemas']['AttendanceDayRowRead']
export type AttendanceDayPage = components['schemas']['CursorPage_AttendanceDayRowRead_']
export type EmployeeAttendanceRange = components['schemas']['EmployeeAttendanceRangeRead']
export type WorkforceIntegrationStatus = components['schemas']['IntegrationStatusRead']
export type WorkforceSnapshot = components['schemas']['WorkforceSnapshotRead']

export interface ListAttendanceDayParams {
  operational_date: string
  shift_code?: string
  limit?: number
  cursor?: string
}

export interface EmployeeAttendanceParams {
  from_date: string
  to_date: string
}
```

The generic page schema's key is generator-decided: after `pnpm gen:api`, grep it and use the real key —
`grep -o "CursorPage[A-Za-z_]*AttendanceDayRowRead[A-Za-z_]*" frontend/src/lib/api.types.ts | sort -u`.
If the generator names it differently, fix the alias, not the endpoint.

and inside the `api` object:

```ts
  listAttendanceDay: (params: ListAttendanceDayParams) =>
    request<AttendanceDayPage>('GET', `/workforce/attendance/day${qs({ ...params })}`),
  getEmployeeAttendance: (employeeId: string, params: EmployeeAttendanceParams) =>
    request<EmployeeAttendanceRange>(
      'GET',
      `/workforce/employees/${encodeURIComponent(employeeId)}/attendance${qs({ ...params })}`,
    ),
  getWorkforceIntegrationStatus: () =>
    request<WorkforceIntegrationStatus>('GET', '/workforce/integration/status'),
  getWorkforceSnapshot: () => request<WorkforceSnapshot>('GET', '/workforce/dashboard/snapshot'),
```

- [ ] **Step 2: Write the failing test for the section tabs**

Create `frontend/src/components/employees/EmployeesSectionTabs.test.tsx`:

```tsx
/**
 * EmployeesSectionTabs — the Employees section switcher.
 *
 * Behaviours pinned here:
 *   1. Directory and Attendance both render as links to their routes.
 *   2. The active tab is marked with aria-current="page".
 *   3. A non-null attentionCount renders on the Attendance tab; null hides it,
 *      so a clean day shows no badge at all.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { EmployeesSectionTabs } from './EmployeesSectionTabs'

function renderTabs(props: Parameters<typeof EmployeesSectionTabs>[0]) {
  return render(
    <MemoryRouter>
      <EmployeesSectionTabs {...props} />
    </MemoryRouter>,
  )
}

describe('EmployeesSectionTabs', () => {
  it('links both destinations and marks the active one', () => {
    renderTabs({ active: 'attendance', attentionCount: null })
    expect(screen.getByRole('link', { name: /employees\.sectionTabs\.directory/ })).toHaveAttribute(
      'href',
      '/employees',
    )
    const attendance = screen.getByRole('link', { name: /employees\.sectionTabs\.attendance/ })
    expect(attendance).toHaveAttribute('href', '/employees/attendance')
    expect(attendance).toHaveAttribute('aria-current', 'page')
  })

  it('shows the attention count only when there is one', () => {
    const { unmount } = renderTabs({ active: 'directory', attentionCount: 20 })
    expect(screen.getByText('20')).toBeInTheDocument()
    unmount()
    renderTabs({ active: 'directory', attentionCount: null })
    expect(screen.queryByText('20')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd vitest run src/components/employees/EmployeesSectionTabs.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `EmployeesSectionTabs`**

A `<nav>` of `NavLink`s styled as the mockup's band-foot strip: `rounded-t-xl px-4 py-2.5 text-[0.84em] font-semibold`, inactive `text-white/70`, active `bg-background text-primary`. The Attendance tab renders its Arabic label inside a bidi-isolated span and the count in an accent pill:

```tsx
<span dir="rtl" className="isolate-bidi text-[0.8em] font-normal opacity-75">
  {t('employees.sectionTabs.attendanceAr')}
</span>
```

Gate the tab on `workforce.people.view` via `useCapabilities()`; a user without it sees only Directory.

- [ ] **Step 5: Add the bidi utility to `index.css`**

```css
/* Any Arabic run rendered next to a number or a clock range must be isolated:
   without this, "السرية الثانية · 05:00 – 13:00" renders as "13:00 – 05:00"
   because the bidi algorithm reorders the trailing neutral run. */
.isolate-bidi {
  unicode-bidi: isolate;
}
```

- [ ] **Step 6: Add the locale keys**

`en.json` — new top-level `"attendance"` namespace (alphabetical position beside `"application"`), plus `"attendance": "Attendance"` inside the existing `employee.tab` block, plus `"sectionTabs"` inside `employees`:

```json
"employees": {
  "sectionTabs": {
    "directory": "Directory",
    "attendance": "Attendance",
    "attendanceAr": "الحضور",
    "dutyLocations": "Duty locations"
  }
},
"attendance": {
  "title": "Attendance",
  "titleAr": "الحضور",
  "subtitle": "{{date}} · duty register by unit and post",
  "shift": { "morning": "Morning", "noon": "Noon", "night": "Night", "office_day": "Office" },
  "state": {
    "verified": "Verified",
    "late": "Late past grace",
    "singlePunch": "Single punch",
    "noPunch": "No punch",
    "onLeave": "On leave",
    "notStarted": "Not started"
  },
  "toolbar": {
    "today": "Today",
    "search": "Name, G-number, or post…",
    "print": "Print",
    "export": "Export",
    "keyboardDay": "change day",
    "keyboardShift": "switch shift",
    "keyboardSearch": "search"
  },
  "register": {
    "masthead": "{{shift}} duty register · {{unit}}",
    "assigned": "assigned",
    "seen": "seen",
    "late": "late",
    "unpaired": "unpaired",
    "leave": "leave",
    "showOffice": "Show office register",
    "source": "Source: BioTime mirror · read-only · synced {{ago}} · fresh through {{through}}"
  },
  "attention": { "title": "Needs a decision", "reviewAll": "Review all" },
  "empty": "No attendance rows for this day yet.",
  "notStartedHint": "This window has not opened yet, so nothing is missing."
}
```

`ar.json` — the same key tree with Arabic values; `employee.tab.attendance` = `"الحضور"`, `attendance.title` = `"الحضور"`.

- [ ] **Step 7: Add the route and the lazy import**

`App.tsx`, beside the other lazy pages:

```tsx
const AttendancePage = lazy(() =>
  import('@/pages/employees/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })),
)
```

and **above** `/employees/:id` (static segments outrank dynamic ones in react-router 7, but keeping the order explicit documents the intent for the next reader):

```tsx
              <Route
                path="/employees/attendance"
                element={
                  <RequireCapability cap="workforce.people.view">
                    <AttendancePage />
                  </RequireCapability>
                }
              />
```

- [ ] **Step 8: Render the tabs on the Directory page**

In `EmployeeLookupPage.tsx`, render `<EmployeesSectionTabs active="directory" attentionCount={…} />` immediately after the hero section so it sits at the band foot exactly as in `attendance-place-A.png`. Pass `null` for the count in this task; Task 9 supplies the real number.

- [ ] **Step 9: Prove it renders and the route resolves**

Run: `cd frontend && C:/Users/Amh/AppData/Roaming/npm/pnpm.cmd vitest run src/components/employees/EmployeesSectionTabs.test.tsx src/pages/employees/EmployeeLookupPage.test.tsx`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/employees/EmployeesSectionTabs.tsx frontend/src/components/employees/EmployeesSectionTabs.test.tsx frontend/src/pages/employees/attendance/AttendancePage.tsx frontend/src/App.tsx frontend/src/pages/employees/EmployeeLookupPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/index.css
git commit -m "feat(attendance): add the route, section tabs, api wrappers, and locales"
```

---

### Task 9: The live Attendance hero card

**Files:**
- Create: `frontend/src/components/employees/AttendanceHeroCard.tsx`, `AttendanceHeroCard.test.tsx`
- Modify: `frontend/src/components/employees/LookupHeroCards.tsx:217` (grid becomes 4 columns when the card is present)
- Modify: `frontend/src/pages/employees/EmployeeLookupPage.tsx` (feed the real attention count into the tabs)

**Interfaces:**
- Consumes: `api.listAttendanceDay({ operational_date })`, `useCapabilities()`.
- Produces: `<AttendanceHeroCard onOpen={() => void} />`; `useAttendanceAttention()` hook exported from `AttendanceHeroCard.tsx` returning `{ attention: number | null, seen: number, late: number, unpaired: number, worst: AttendanceDayRow[], allowed: boolean }`.

**The query MUST be capability-gated.** `/workforce/attendance/day` requires `workforce.attendance.review` **and** `workforce.people.view`, and the ported role defaults give an operator only `workforce.self.view` and a manager nothing at all — so an ungated card would 403 on every `/employees` visit for the default operator, which is precisely the failure `RequireCapability` exists to prevent. In `useAttendanceAttention`:

```ts
const { has, isLoading } = useCapabilities()
const allowed = has('workforce.people.view') && has('workforce.attendance.review')
const query = useQuery({
  queryKey: ['attendance-day', operationalDate] as const,
  queryFn: () => api.listAttendanceDay({ operational_date: operationalDate }),
  enabled: allowed && !isLoading,
  staleTime: 60_000,
})
```

`AttendanceHeroCard` returns `null` when `!allowed`, so the hero silently stays a three-card grid for users without the capability. Add a test for exactly that: with `has` mocked false, the card renders nothing and `api.listAttendanceDay` is never called.

- [ ] **Step 1: Write the failing test**

Pin three behaviours: (1) it renders `seen / late / unpaired` from the payload; (2) it lists the two worst rows, ordered no-punch → single-punch → late-descending; (3) when the day has no exceptions it renders the clean state and **no** accent badge. Mock `@/lib/api` in the established style.

- [ ] **Step 2: Run it to verify it fails.** Expected: module not found.

- [ ] **Step 3: Implement the card** using the existing glass shell classes copied from `LookupHeroCards` (`rounded-2xl border border-white/[.14] bg-white/[.07] p-4 backdrop-blur-sm`), the three mini stats, the two worst chips, and one accent CTA. Order the worst list with the shared helper from `attendanceModel.ts` (Task 10 owns that file; if it does not exist yet, create it in this task with just `orderByAttention`).

- [ ] **Step 4: Run the test to verify it passes.**

- [ ] **Step 5: Widen the hero grid.** `LookupHeroCards` takes an optional `extraCard?: React.ReactNode`; when present the grid is `md:grid-cols-4`, otherwise it stays `md:grid-cols-3`. No other card changes.

- [ ] **Step 6: Run the lookup page tests.** Expected: pass, including the existing recents/expiry/gaps assertions.

- [ ] **Step 7: Commit** — `feat(attendance): surface today's attendance on the employees hero`

---

### Task 10: The toolbar and the day model

**Files:**
- Create: `frontend/src/pages/employees/attendance/attendanceModel.ts`, `attendanceModel.test.ts`
- Create: `frontend/src/pages/employees/attendance/AttendanceToolbar.tsx`, `AttendanceToolbar.test.tsx`
- Modify: `AttendancePage.tsx` (own the day/shift/view state, keyboard shortcuts)

**Interfaces:**
- Consumes: `AttendanceDayRowRead[]`.
- Produces, from `attendanceModel.ts`:
  - `type AttendanceRow = AttendanceDayRowRead`
  - `type RowState = 'verified' | 'late' | 'single' | 'missing' | 'leave' | 'pending'`
  - `rowState(row: AttendanceRow, graceMinutes: number, windowOpen: boolean): RowState`
  - `groupByUnitAndPost(rows: AttendanceRow[]): Map<string, Map<string, AttendanceRow[]>>`
  - `postSummary(rows: AttendanceRow[]): { due: number; seen: number; leave: number; exceptions: number }`
  - `orderByAttention(rows: AttendanceRow[]): AttendanceRow[]`
  - `arrivalOffsetMinutes(row: AttendanceRow): number | null`
  - `shiftCounts(rows: AttendanceRow[]): Record<string, { seen: number; due: number }>`

- [ ] **Step 1: Write the failing model tests** — one test per exported function, each pinning a rule from Global Constraints: leave leaves the denominator (`postSummary` returns `due: 3` for four people with one on leave); a not-yet-open window yields `pending`, never `missing`; a single punch yields `single`, never `verified`; `orderByAttention` puts missing before single before late and sorts late descending; `arrivalOffsetMinutes` returns `null` with no punch and a negative number for an early arrival.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement `attendanceModel.ts`** as pure functions over the generated row type. No React, no i18n, no date library beyond `Date`.

- [ ] **Step 4: Run the model tests to verify they pass.**

- [ ] **Step 5: Write the failing toolbar test** — the day stepper moves one day per click and emits the new ISO date; the 7-day strip marks the active day and shows a red slice sized by exception count; each shift button shows `seen/due` from `shiftCounts`; `ArrowLeft`/`ArrowRight` change the day and `1`–`4` change the shift; the view switch emits `register | board | timeline`.

- [ ] **Step 6: Run it to verify it fails.**

- [ ] **Step 7: Implement `AttendanceToolbar.tsx`** — sticky (`sticky top-0 z-20`), the stepper, the strip, the segmented shift control, the search field with a `/` hint, the view switch, print/export. Keyboard handling lives in `AttendancePage` (one listener, cleaned up on unmount) and is passed down as callbacks.

- [ ] **Step 8: Run the toolbar tests to verify they pass.**

- [ ] **Step 9: Commit** — `feat(attendance): add the day model and the register toolbar`

---

### Task 11: The Register view

**Files:**
- Create: `frontend/src/pages/employees/attendance/RegisterView.tsx`, `RegisterView.test.tsx`, `AttentionQueue.tsx`
- Modify: `AttendancePage.tsx` (render the register + queue)
- Test: `frontend/src/pages/employees/attendance/AttendancePage.test.tsx`

**Interfaces:**
- Consumes: `attendanceModel` exports, `AttendanceDayRowRead[]`.
- Produces: `<RegisterView rows={…} unitLabel={…} shiftCode={…} graceMinutes={…} windowOpen={…} onOpenEmployee={(id) => void} />`; `<AttentionQueue rows={…} onOpenEmployee={…} />`.

- [ ] **Step 1: Write the failing tests** — five behaviours: (1) posts render as sections ordered exceptions-first; (2) inside a post, rows are ordered missing → single → late → verified → leave; (3) a post with one person on leave shows `3/3` and a leave chip, never `3/4`; (4) the Arabic unit name in the masthead is inside an element with `dir="rtl"` and class `isolate-bidi`, and the clock range renders in the original order `05:00 – 13:00`; (5) clicking a name calls `onOpenEmployee` with that employee id.

- [ ] **Step 2: Run them to verify they fail.**

- [ ] **Step 3: Implement `RegisterView.tsx`** — masthead (shift + unit + Arabic unit + window + counters), CSS multi-column sections (`columns-3` for a guard shift, `columns-4` for office), per-post heading with `seen/due` and a red rule when flagged, muted verified rows with a green bead, bold exception rows with the time in accent, office register folded behind a disclosure, and the source line at the foot. Mobile: `columns-1` below `md`.

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Implement `AttentionQueue.tsx`** with the same ordering helper, so the hero count, the tab badge and the queue are one list.

- [ ] **Step 6: Write and run the page test** — `AttendancePage` renders the toolbar, the register and the queue from one mocked `listAttendanceDay` response, shows the empty state when `items` is `[]`, and shows the not-started hint for a night shift whose window has not opened.

- [ ] **Step 7: Commit** — `feat(attendance): add the duty register view`

---

### Task 12: The Board and Timeline views

**Files:**
- Create: `frontend/src/pages/employees/attendance/BoardView.tsx`, `BoardView.test.tsx`, `TimelineView.tsx`, `TimelineView.test.tsx`
- Modify: `AttendancePage.tsx` (switch on the view)

**Interfaces:**
- Consumes: the same rows and model helpers. No new endpoint.
- Produces: `<BoardView rows={…} … />`, `<TimelineView rows={…} shiftStartAt={…} graceMinutes={…} … />`.

- [ ] **Step 1: Write the failing Board tests** — one tile per person grouped into post blocks; a block with an exception gets the hot treatment; tiles show the last three digits of the employee id and carry the full name in `title`; colour is applied only to non-verified tiles.

- [ ] **Step 2: Run to verify they fail. Step 3: Implement `BoardView.tsx`.** Dark panel using the `--rail-*` tokens, `grid-template-columns: repeat(auto-fill, minmax(196px, 1fr))`, 26px tiles.

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Write the failing Timeline tests** — a lane per post; a dot per person positioned by `arrivalOffsetMinutes` on an axis of `start − 45min … start + 165min`; a late dot draws a tail back to the grace line; people with no punch are counted in the right gutter as `−n` and are not plotted; the axis omits a tick within 25 minutes of the start or grace label.

- [ ] **Step 6: Run to verify they fail. Step 7: Implement `TimelineView.tsx`.**

- [ ] **Step 8: Run to verify they pass.**

- [ ] **Step 9: Commit** — `feat(attendance): add the board and timeline views`

---

### Task 13: The per-employee Attendance tab

**Files:**
- Create: `frontend/src/pages/employees/tabs/AttendanceTab.tsx`, `AttendanceTab.test.tsx`
- Modify: `frontend/src/pages/employees/EmployeeTabChips.tsx:11,13-20,28`, `frontend/src/pages/employees/EmployeeDetailPage.tsx:38-45`, and the tab-body switch
- Modify: `RegisterView.tsx` / `AttentionQueue.tsx` (names deep-link here)

**Interfaces:**
- Consumes: `api.getEmployeeAttendance(employeeId, { from_date, to_date })`.
- Produces: `<AttendanceTab employeeId={string} />`; `Tab` union gains `'attendance'`; `Counts` gains `attendance: number`.

- [ ] **Step 1: Write the failing tab tests** — (1) KPIs computed from the month payload (punctuality = days inside grace ÷ scheduled days, late minutes summed, missing punches counted); (2) the month grid renders one cell per day with the shift letters actually worked and the outcome colour, and rest days render as dashed; (3) selecting a day renders its punch timeline with the scheduled window, the grace band and one marker per punch, and the marker labels do not overlap the axis ticks (assert on computed `left` percentages, not on pixels); (4) a month with no scheduled days renders the empty state.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Add the chip.** `Tab` union → `'documents' | 'profile' | 'leaves' | 'violations' | 'activity' | 'messages' | 'attendance'`; `Counts` gains `attendance: number`; `ORDER` becomes `['profile', 'documents', 'leaves', 'messages', 'activity', 'attendance', 'violations']`; the badge branch reads `counts.attendance`. In `EmployeeDetailPage`, add `'attendance'` to `VALID_TABS` and render `<AttendanceTab employeeId={id} />` in the body switch. The chip is gated on `workforce.self.view` for one's own file or `workforce.attendance.review` otherwise, using `useCapabilities()`.

- [ ] **Step 4: Implement `AttendanceTab.tsx`** — identity/KPI row, month grid, day timeline (reuse the axis maths from `TimelineView` by extracting it into `attendanceModel.ts` rather than duplicating it), open-exceptions list.

- [ ] **Step 5: Run the tab tests to verify they pass.**

- [ ] **Step 6: Wire the deep links** — `onOpenEmployee` navigates to `/employees/${encodeURIComponent(id)}?tab=attendance`. Assert it in `RegisterView.test.tsx`.

- [ ] **Step 7: Run the whole employees suite.** Run: `cd frontend && pnpm vitest run src/pages/employees` — expected: all pass, including the pre-existing tab tests.

- [ ] **Step 8: Commit** — `feat(attendance): add the per-employee attendance tab`

---

### Task 14: Verification, RTL review, live smoke, and preview

**Files:**
- Create: `frontend/e2e/attendance.spec.ts`
- Create: `docs/attendance-verification-2026-08-19.md` (the evidence record)
- [ ] **Step 1: Run both suites.** `cd backend && "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -m pytest -q` and `cd frontend && pnpm vitest run`. Compare against a stashed baseline before attributing any failure to this branch.

- [ ] **Step 2: Type-check and lint.** `cd frontend && pnpm build` (runs `tsc -b`) and `pnpm lint`.

- [ ] **Step 3: Seed and start the stack.** Backend on `127.0.0.1:8765` against the preview `GSSG_DATA_DIR` built in **Task 5 Step 8** (registered admin + 40 guards across the 9 real posts + memberships + occurrences + 80 cases via `tests.factories.attendance.build_attendance_day`); frontend `pnpm dev` on `5173` with `GSSG_API_TARGET=http://127.0.0.1:8765`. Launch both through the process supervisor, never a bare shell, and wait for readiness (`Local:.*http` + port 5173). Then prove the data exists **before** opening a browser — the endpoint is behind the session cookie, so an anonymous `curl` returns 401 and proves nothing:

```bash
# authenticate, keep the cookie, then count
curl -s -c /tmp/att.jar -X POST http://127.0.0.1:8765/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@preview.local","password":"preview-admin-pw"}' >/dev/null
curl -s -b /tmp/att.jar \
  "http://127.0.0.1:8765/api/v1/workforce/attendance/day?operational_date=2026-08-19&limit=200" \
  | "C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe" -c "
import json,sys
page = json.load(sys.stdin)
items = page['items']
print('rows', len(items))
print('posts', len({row['duty_post'] for row in items}))
print('shifts', sorted({row['shift_code'] for row in items}))
"
```

Expected: `rows 80`, `posts 9`, `shifts ['morning', 'night']` — 19 Aug 2026 is crew 2's double day. If the login route path or payload differs, read `backend/app/api/v1/auth.py` and use the real one. If `rows 0`, the preview database was not built and every assertion below would be vacuous.


- [ ] **Step 4: Playwright review — English.** `frontend/e2e/attendance.spec.ts` logs in as the preview admin, opens `/employees/attendance`, and asserts: with the Morning shift selected the register renders 9 post sections and 40 names (19 Aug is crew 2's double day, so the unfiltered day holds 80 rows across Morning and Night — the shift filter is what makes the register readable); the toolbar shift buttons show `seen/due`; `ArrowLeft` changes the day; the view switch reaches Board and Timeline; no horizontal page overflow at 1440, 1280 and 1024 (`document.documentElement.scrollWidth <= window.innerWidth`); zero console errors. Capture a screenshot per viewport.

- [ ] **Step 5: Playwright review — Arabic RTL.** Switch the language to Arabic, then assert: `document.documentElement.dir === 'rtl'`; the register masthead's clock range still reads `05:00 – 13:00` (this is the bidi-isolation regression guard); no element overflows the viewport on either edge; the toolbar, month grid and timeline mirror correctly (start-side controls sit on the right); the Arabic label is `الحضور` everywhere and the string `BioTime` appears exactly once per page, in the source line. Capture Arabic screenshots at the same three viewports.

- [ ] **Step 6: Fix every defect found** in Steps 4–5 before proceeding, re-running the specific spec after each fix.

- [ ] **Step 7: Live BioTime smoke.** With the real `GSSG_BIOTIME_*` env pointing at the installed instance, run `backend/scripts/biotime_probe.py` in its read-only mode and then `POST /api/v1/workforce/integration/test`. Record: authentication succeeded, one bounded page read, and `GET /workforce/integration/status` reporting `provider_state: "ready"`. This runs against the live vendor system — read-only only, no sync into the production database.

- [ ] **Step 8: Write the evidence record** `docs/attendance-verification-2026-08-19.md`: commands run, suite counts, the six screenshots, the RTL findings and their fixes, and the live-smoke result.

- [ ] **Step 9: Present on localhost.** Leave the seeded stack running, report the URL, and hand over: `/employees` (tabs + hero card), `/employees/attendance` (three views), `/employees/<id>?tab=attendance`.

- [ ] **Step 10: Commit** — `test(attendance): add the e2e register spec and record verification evidence`

---

## Self-Review

**Spec coverage.** Design E's two screens are covered by Tasks 8–12 (tab strip, hero card, toolbar, register, board, timeline); the per-employee tab (design 3) by Task 13; Arabic naming by the Global Constraints plus Task 8's locales; the backend by Tasks 1–7; "Playwright review for UI + Arabic RTL" and "present on localhost" by Task 14. The owner's four locked answers — cherry-pick the workforce stack, seed for tests plus one live smoke, all three views, employee tab in this pass — map to Tasks 1–5, 5+14, 11–12, and 13 respectively.

**Placeholder scan.** One deliberate `...` remains, in Task 7 Step 1's `test_self_view_reads_own_record_only`, with an explicit instruction to implement it from the existing helper and a statement that a placeholder test is unacceptable. Every other code step carries complete content.

**Type consistency.** `AttendanceDayRowRead` (Task 6) is the single row type consumed by Tasks 9–13; `attendanceModel.ts` exports one `RowState` union used by all three views; `list_attendance_day` and `employee_attendance_range` are the only two new service functions and are referenced by their exact signatures in Tasks 6, 7 and 8. `_late_minutes` is defined in Task 6 and reused (not redefined) in Task 7. The timeline axis maths is defined once in Task 12 and extracted to `attendanceModel.ts` before reuse in Task 13.

**Verified against the branch before review** (three claims that were wrong in the first draft and are now corrected): `AttendancePunchAssignment`'s case FK is `attendance_case_id`, not `case_id`, and its primary key is `punch_id` alone, so a punch belongs to exactly one case; `AttendanceCase` carries `shift_code_snapshot`, `duty_unit_snapshot`, `duty_post_snapshot`, `crew_code_snapshot` and `department_snapshot`, so no join to `work_shift_occurrences` or `work_shift_definitions` is needed anywhere in Tasks 6–7; `workforce_read_service` really does expose `_latest_evaluations(db, case_ids)`, `_case_allowed(case, scope)`, `_employee_row(db, employee_id)` and `_person_fields(db, case)` with those names, and `_person_fields` already returns `shift_code` from the snapshot.

**Remaining unverified assumption.** The generated `CursorPage_…_` type alias name in Task 8 Step 1 must be read from `frontend/src/lib/api.types.ts` after `gen:api` rather than assumed.

## Review round 1 — fable-reviewer verdict REJECT (6 blockers, 6 concerns, 4 nits), all addressed

| # | Finding | Fix applied |
|---|---|---|
| B1 | Every backend command used `../../backend/venv/Scripts/python.exe`, which does not exist — the venv is at the main-checkout root, and this git-bash refuses relative Windows interpreter paths anyway | All 24 occurrences replaced with the quoted absolute `"C:/Users/Amh/Documents/projects/sentinel/venv/Scripts/python.exe"`; verified executable (`ok 3.12.13 0.115.5`) |
| B2 | `AttendancePunchAssignment` has no `case_id`; the fixtures also omitted NOT NULL `algorithm_version` and `normalized_payload_hash` | Query, keyword and factory now use `attendance_case_id`; `add_punch` supplies both NOT NULL columns; documented that PK `punch_id` means no validity filter is needed |
| B3 | `seed_workforce_roster(db, *, actor_user_id, effective_from=None)` has no `today=` kwarg and creates no memberships, occurrences or cases, so every read-path test asserted against an empty database — and Task 14's e2e had no data source at all | Task 5 rewritten around a new verified test factory (`backend/tests/factories/attendance.py`) that builds admin → seed → employees + verified provider people → memberships → occurrences → cases → punches → evaluation; Tasks 6, 7 and 14 all consume it; Task 5 Step 8 builds the preview database the same way and Task 14 Step 3 proves it non-empty before asserting |
| B4 | `test_workforce_authorization.py` imports `UserPreference` and `app.api.v1.notifications` at module level → `ImportError` at collection, and one test asserts `/auth/me/capabilities` is gone | The file is no longer copied at all; Task 2 salvages the three scope-algebra tests into a new `test_workforce_scope_algebra.py` with only the imports they need, and greps to prove no excluded symbol survives |
| B5 | `test_workforce_scope_hardening.py` drives `TestClient(app)` against workforce routes, two tasks before the router is registered | Moved from Task 2 to Task 4, with the reason recorded in both places |
| B6 | `test_workforce_migration.py` contains a `user_preferences` INSERT and asserts the deleted widget-id rewrite, so one assertion edit could not make it pass | Task 1 Step 5 now authorizes three specific edits: re-point `WORKFORCE_PREDECESSOR`, delete the layout-rewrite test, rename/re-point the head test |
| C1 | `_shift_code_of` was redundant and would drop override-sourced cases (`shift_occurrence_id` is nullable) | Deleted; filtering uses `case.shift_code_snapshot`, which `_person_fields` already returns |
| C2 | `ValueError` is not mapped to 422 — the catch-all handler returns 500 — and `ForbiddenError` does not exist | Task 7 now raises `ValidationFailedError` and `AppError("FORBIDDEN", …, http_status=403)`, both real classes in `app/api/errors.py` |
| C3 | The hero card fired a capability-gated request for operators who lack the capability → 403 on every `/employees` visit | `useAttendanceAttention` is gated with `enabled: allowed && !isLoading`; the card renders `null` when not allowed, with a test asserting the request is never issued |
| C4 | Task 7's test used a `client` fixture that does not exist | Rewritten to `(db_session)` plus the module-local `_client(db, user)` factory from `test_workforce_api_permissions.py` |
| C5 | Capability arithmetic said 33 | Corrected to 35 (main has 27, the port adds 8) |
| C6 | The migration edit left `import json` unused, and ruff lints migrations | Step 2 deletes the import; Step 3 greps for it and runs `ruff check` on the file |
| N1–N4 | react-router is v7 not v6; `permissions.py` line anchors were branch-relative; `test_attendance_provider.py` does not exist on the branch; the httpx annotation | Version corrected in two places; Task 2 now anchors by symbol with main's approximate lines noted; the phantom test file removed from the copy list; the httpx claim left as-is (functionally correct — one flat requirements file, pin present at line 36) |

Two findings I had already caught and fixed before the review landed (`attendance_case_id` and the redundant `_shift_code_of`) are folded into the same rows above.

## Review round 2 — fable-reviewer verdict REJECT (3 blockers, 3 concerns, 3 nits), all addressed

Round 2 confirmed every round-1 fix and then found three defects in the code that round 1 had never seen, because that code did not exist yet. One of them was a product bug, not a test bug.

| # | Finding | Fix applied |
|---|---|---|
| **B1** | **`list_attendance_day` read punch bounds from `attendance_punch_assignments`, a table that can never be populated on this build.** `attendance_punch_service.select_punch_case` returns `None` unless `punch.direction in {"in", "out"}`, and this provider reports `punch_state 255`/"unknown" for every event; `resolve_assignment` also has no production caller. The register would have shipped showing **no punch times at all** against the live mirror | Rewritten to the evaluator's own evidence shape (`attendance_evaluation_service._matching_punches`): aggregate `AttendancePunch` by the employee's active **verified** `AttendanceProviderPerson` inside `[scheduled_start − match_before_minutes, scheduled_end + match_after_minutes]`, with the `outerjoin` guard that skips a punch already owned by a different case. The assignment join is gone, and the docstring records why so nobody re-adds it |
| **B2** | The factory's `AttendanceProviderPerson(mapping_state="verified")` omitted `verified_by_user_id` / `verified_at`, violating `ck_attendance_provider_people_verified_fields` on first flush | Both fields supplied from the factory's admin; the constraint text is quoted inline |
| **B3** | The factory test asserted a global case count equal to the fixture's, ignoring the neighbouring day's cases the generation window necessarily creates | Global assertion relaxed to `>=`, and a precise one added: `len(fixture.cases) == 2 * len(fixture.employees)`, because 19 Aug is crew 2's double day |
| **C1** | The preview gate expected 40 rows and probed with an unauthenticated `curl` (401) | Step 3 now logs in with a cookie jar and asserts `rows 80`, `posts 9`, `shifts ['morning', 'night']`; Step 4 asserts 40 names **with the Morning filter applied** |
| **C2** | `openapi-typescript` emits no per-schema aliases, so `CursorPage_AttendanceDayRowRead_` as a bare identifier cannot compile | Task 8 now re-exports through `components['schemas'][…]`, matching `api.ts:16,22`, and includes the grep that confirms the generic page key. This also closes the plan's last flagged unknown |
| **C3** | The office shift code is `office_day`, not `office` | Corrected in three test sets and in the `attendance.shift` locale block |
| N1–N3 | `perm_service.set_user_override` is the real name; `fixture.cases[0]` relied on an unordered SELECT; the reviewed revision was uncommitted | Name corrected; ordering noted where it matters; this revision is committed below |

**Round-1 coverage confirmed by round 2:** B1 (venv path), B2 (`attendance_case_id`), B4 (authorization test), B5 (scope-hardening placement), B6 (migration test edits), C1–C6 and N1–N4 all verified fixed against the branch and `main`. B3 was structurally fixed; its replacement code carried the three new blockers above, which are now fixed in turn.

**Net effect on the shipped product, not just the plan:** the register's punch times now come from the same query shape the evaluator uses, so the page will show real times against the live BioTime mirror instead of a permanently empty column.
