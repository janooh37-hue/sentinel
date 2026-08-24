# Attendance Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scoped attendance review queue and append-only correction/revocation drawer to the existing Attendance page without modifying BioTime punches or automatic evaluations.

**Architecture:** Extend attendance day/exception rows with exact case IDs; make the case endpoint publish typed source evidence, history, audit metadata, and one case-level ETag; then build read-only review first and guarded mutations second. All writes use `If-Match`, mandatory reasons, explicit query invalidation, and no automatic retry.

**Tech Stack:** FastAPI, SQLAlchemy 2, Pydantic 2, SQLite, React 19, TypeScript, TanStack Query, react-hook-form/Zod where consistent with existing forms, react-i18next, Vitest.

## Global Constraints

- The feature lives inside `/employees/attendance`; no new route.
- `workforce.people.view` + `workforce.attendance.review` read case evidence.
- `workforce.attendance.correct` alone exposes create/revoke controls.
- Raw punches, automatic evaluation revisions, and earlier adjustments remain immutable.
- Corrections are not written back to BioTime.
- Every write has a non-blank reason, audit row, and case-level optimistic concurrency.
- Historical location/shift evidence comes from case snapshots, never current employee placement.
- Asia/Dubai wall time is displayed; timezone-aware UTC is sent.
- English/Arabic, RTL, dark theme, keyboard operation, and mobile full-screen behavior are required.
- Backend schema changes require OpenAPI and TypeScript API regeneration.

---

### Task 1: Publish exact case IDs on attendance rows

**Files:**
- Modify: `backend/app/schemas/workforce.py`
- Modify: `backend/app/services/workforce_read_service.py`
- Test: `backend/tests/test_attendance_day_endpoint.py`
- Test: `backend/tests/test_workforce_api_permissions.py`

**Interfaces:**
- Produces: required `case_id: int` on `AttendanceDayRowRead` and `AttendanceExceptionRead`.

- [ ] **Step 1: Write failing double-shift linkage tests**

Seed the same employee into two cases on one operational date and assert each response row carries its own case id:

```python
def test_attendance_day_rows_publish_exact_case_id_on_double_shift(api_db, admin_user):
    morning = seed_case(api_db, employee_id="G1001", shift_code="morning")
    night = seed_case(api_db, employee_id="G1001", shift_code="night")

    response = client_for(api_db, admin_user).get(
        "/api/v1/workforce/attendance/day",
        params={"operational_date": morning.operational_date.isoformat()},
    )

    assert response.status_code == 200
    by_shift = {row["shift_code"]: row["case_id"] for row in response.json()["items"]}
    assert by_shift == {"morning": morning.id, "night": night.id}
```

Add the same assertion to `/attendance/exceptions`; never locate a case client-side by employee/date.

- [ ] **Step 2: Run tests and verify failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_attendance_day_endpoint.py backend/tests/test_workforce_api_permissions.py -p no:cacheprovider -q
```

Expected: `case_id` missing.

- [ ] **Step 3: Extend schemas and service projections**

```python
class AttendanceExceptionRead(RosterRowRead):
    case_id: int
    late_minutes: int | None = Field(default=None, ge=0)
    early_exit_minutes: int | None = Field(default=None, ge=0)
    missing_checkout: bool | None = None

class AttendanceDayRowRead(RosterRowRead):
    case_id: int
    # existing punch/judgment fields unchanged
```

Add `"case_id": case.id` at the point where `list_attendance_day` and `list_exceptions` project each case. Do not add it to plain `/workforce/roster` rows because a roster row need not have a case.

- [ ] **Step 4: Run tests and commit**

Run Step 2 command; expected pass.

```powershell
git add backend/app/schemas/workforce.py backend/app/services/workforce_read_service.py backend/tests/test_attendance_day_endpoint.py backend/tests/test_workforce_api_permissions.py
git commit -m "feat(attendance): expose exact case ids"
```

---

### Task 2: Type the attendance case evidence contract

**Files:**
- Modify: `backend/app/schemas/workforce.py`
- Modify: `backend/app/services/workforce_read_service.py`
- Modify: `backend/app/api/v1/workforce.py`
- Test: `backend/tests/test_workforce_attendance_corrections_api.py`

**Interfaces:**
- Produces: `AttendanceCasePunchRead`, `AttendanceEvaluationRead`, `AttendanceAdjustmentRead`, `AttendanceAdjustmentAuditRead`, expanded `AttendanceCaseRead`, and `get_attendance_case` evidence with no inferred source facts.

- [ ] **Step 1: Write failing evidence and privacy tests**

Create one case with captured placement snapshots, two automatic revisions, one persisted punch, one adjustment, and create/revoke `AuditLog` rows. Assert:

```python
payload = response.json()
assert payload["duty_unit_snapshot"] == "Main Gate"
assert payload["shift_code_snapshot"] == "morning"
assert payload["punches"] == [{
    "occurred_at": "2026-08-24T04:09:00Z",
    "device_name": "Main Gate Terminal",
}]
assert [row["revision"] for row in payload["evaluations"]] == [1, 2]
assert payload["adjustments"][0]["reason"] == "Verified against supervisor register"
assert payload["adjustment_audit"][0]["action"] == "created"
assert payload["adjustment_audit"][1]["action"] == "revoked"
assert "punch_state" not in response.text
```

Also assert an out-of-scope user receives 403 and no source facts.

- [ ] **Step 2: Run the new test and verify failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_workforce_attendance_corrections_api.py -p no:cacheprovider -q
```

- [ ] **Step 3: Add explicit evidence schemas**

Implement:

```python
class AttendanceCasePunchRead(ORMBase):
    occurred_at: datetime
    device_name: str | None = None

class AttendanceEvaluationRead(ORMBase):
    id: int
    revision: int
    presence_state: PresenceState | None = None
    reason_code: str | None = None
    first_in_at: datetime | None = None
    latest_in_at: datetime | None = None
    final_out_at: datetime | None = None
    late_minutes: int | None = None
    early_exit_minutes: int | None = None
    missing_checkout: bool | None = None
    evaluated_at: datetime

class AttendanceAdjustmentRead(ORMBase):
    id: int
    base_evaluation_id: int
    replacement_presence_state: PresenceState | None = None
    replacement_first_in_at: datetime | None = None
    replacement_latest_in_at: datetime | None = None
    replacement_final_out_at: datetime | None = None
    replacement_late_minutes: int | None = None
    replacement_early_exit_minutes: int | None = None
    replacement_missing_checkout: bool | None = None
    reason: str
    created_at: datetime
    revoked_at: datetime | None = None
    supersedes_adjustment_id: int | None = None

class AttendanceAdjustmentAuditRead(ORMBase):
    adjustment_id: int
    action: Literal["created", "revoked"]
    actor: str | None = None
    occurred_at: datetime
    reason: str
```

Extend `AttendanceCaseRead` with employee name fields, case snapshot fields, `punches`, typed `evaluations`, typed `adjustments`, and `adjustment_audit`.

- [ ] **Step 4: Project only persisted evidence**

In `workforce_read_service.get_attendance_case`:

- load the `Employee` only for bilingual name;
- publish `AttendanceCase.department_snapshot`, `duty_unit_snapshot`, `duty_post_snapshot`, `crew_code_snapshot`, `crew_name_snapshot`, `shift_code_snapshot`, and `organization_snapshot_state`;
- select persisted punches associated with the employee and bounded by the case's match window used by evaluation;
- return only `occurred_at` and `device_name`, never infer direction;
- keep evaluation/adjustment rows chronological; and
- resolve create/revoke actor/reason/timestamp from existing `AuditLog` rows for `entity_type="attendance_adjustment"` and matching `entity_id`.

If no persisted punch is available, return `punches=[]`; do not copy `first_in_at` from an evaluation into source facts.

- [ ] **Step 5: Run tests and commit**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_workforce_attendance_corrections_api.py backend/tests/test_workforce_scope_hardening.py -p no:cacheprovider -q
git add backend/app/schemas/workforce.py backend/app/services/workforce_read_service.py backend/app/api/v1/workforce.py backend/tests/test_workforce_attendance_corrections_api.py
git commit -m "feat(attendance): publish typed correction evidence"
```

---

### Task 3: Unify correction concurrency under one case ETag

**Files:**
- Modify: `backend/app/services/workforce_admin_service.py`
- Modify: `backend/app/api/v1/workforce.py`
- Test: `backend/tests/test_workforce_attendance_corrections_api.py`

**Interfaces:**
- Produces: `attendance_case_etag(db, case_id) -> str`; GET/create/revoke all exchange the same case-level ETag.

- [ ] **Step 1: Write failing reload and stale-client tests**

```python
case_response = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
version_1 = case_response.headers["etag"]

created = client.post(
    f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
    headers={"If-Match": version_1},
    json={"replacement_presence_state": "completed", "reason": "Supervisor register"},
)
assert created.status_code == 201
version_2 = created.headers["etag"]
assert version_2 != version_1

stale = client.post(
    f"/api/v1/workforce/attendance/cases/{case.id}/adjustments",
    headers={"If-Match": version_1},
    json={"replacement_presence_state": "absent", "reason": "Stale review"},
)
assert stale.status_code == 409
assert stale.json()["error"]["code"] == "ATTENDANCE_CASE_VERSION_CONFLICT"

reloaded = client.get(f"/api/v1/workforce/attendance/cases/{case.id}")
revoked = client.post(
    f"/api/v1/workforce/attendance/cases/{case.id}/adjustments/{created.json()['id']}/revoke",
    headers={"If-Match": reloaded.headers["etag"]},
    json={"reason": "Correction entered against wrong person"},
)
assert revoked.status_code == 200
assert revoked.headers["etag"] != reloaded.headers["etag"]
```

Also assert missing `If-Match` returns the existing version-conflict error, not a write.

- [ ] **Step 2: Run the test and verify failure**

Use Task 2's correction API test command.

- [ ] **Step 3: Implement one case-version helper**

```python
def attendance_case_etag(db: Session, case_id: int) -> str:
    latest = _latest_evaluation(db, case_id)
    active = _active_adjustment(db, case_id)
    return etag_for({
        "case_id": case_id,
        "automatic_evaluation_id": latest.id,
        "automatic_revision": latest.revision,
        "active_adjustment_id": active.id if active else None,
        "active_adjustment_revoked_at": active.revoked_at if active else None,
    })
```

Use the project's canonical `row_etag`/`etag_for` serialization helper rather
than introducing new hashing code. `apply_adjustment` and
`revoke_adjustment` both call:

```python
require_if_match(
    if_match,
    attendance_case_etag(db, case_id),
    code="ATTENDANCE_CASE_VERSION_CONFLICT",
)
```

Add `response: Response` to the existing GET route signature, then set the
version on the exact scoped case it returns:

```python
case = workforce_read_service.get_attendance_case(
    db,
    scope=_scope(db, user),
    case_id=case_id,
)
_set_etag(
    response,
    workforce_admin_service.attendance_case_etag(db, case_id),
)
return case
```

After create/revoke commit, set the refreshed case ETag, not the adjustment row ETag.

- [ ] **Step 4: Run correction and operational tests; commit**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_workforce_attendance_corrections_api.py backend/tests/test_workforce_operational_smoke.py -p no:cacheprovider -q
git add backend/app/services/workforce_admin_service.py backend/app/api/v1/workforce.py backend/tests/test_workforce_attendance_corrections_api.py
git commit -m "fix(attendance): unify correction case versions"
```

---

### Task 4: Regenerate API types and add version-aware frontend wrappers

**Files:**
- Modify (generated): `backend/openapi.json`
- Modify (generated): `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/api.attendanceCorrection.test.ts`

**Interfaces:**
- Produces: `Versioned<T>`, `requestVersioned`, `api.listAttendanceExceptions`, `api.getAttendanceCase`, `api.createAttendanceAdjustment`, and `api.revokeAttendanceAdjustment`.

- [ ] **Step 1: Regenerate OpenAPI and TypeScript types**

Use `sync-api-types`:

```powershell
venv\Scripts\python.exe scripts\dump_openapi.py
pnpm -C frontend run gen:api
```

- [ ] **Step 2: Write failing client tests for headers and payloads**

```ts
const loaded = await api.getAttendanceCase(42)
expect(loaded.etag).toBe('"case-v1"')

await api.createAttendanceAdjustment(42, loaded.etag, {
  replacement_presence_state: 'completed',
  reason: 'Supervisor register',
})
expect(fetch).toHaveBeenLastCalledWith(
  '/api/v1/workforce/attendance/cases/42/adjustments',
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ 'If-Match': '"case-v1"' }),
  }),
)
```

- [ ] **Step 3: Add a version-aware request helper**

```ts
export interface Versioned<T> {
  data: T
  etag: string
}

async function requestVersioned<T>(
  method: string,
  path: string,
  body?: unknown,
  etag?: string,
): Promise<Versioned<T>> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (etag) headers['If-Match'] = etag
  const res = await fetch(`${BASE}${path}`, {
    method, cache: 'no-store', credentials: 'same-origin', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await unwrap<T>(res)
  const nextEtag = res.headers.get('etag')
  if (!nextEtag) throw new ApiError(500, 'MISSING_ETAG', 'Versioned response omitted ETag')
  return { data, etag: nextEtag }
}
```

Add typed wrappers using generated schemas. Exceptions accept date/presence/exception/limit/cursor. Create/revoke require the caller's current ETag and never accept an absent value.

- [ ] **Step 4: Run tests and commit**

```powershell
pnpm -C frontend exec vitest run src/lib/api.attendanceCorrection.test.ts
pnpm -C frontend exec tsc -b --noEmit
git add backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/api.ts frontend/src/lib/api.attendanceCorrection.test.ts
git commit -m "feat(attendance): add versioned correction client"
```

---

### Task 5: Build the read-only review queue and evidence drawer

**Files:**
- Modify: `frontend/src/pages/employees/attendance/AttendancePage.tsx`
- Modify: `frontend/src/pages/employees/attendance/AttentionQueue.tsx`
- Create: `frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.tsx`
- Create: `frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx`
- Modify: `frontend/src/pages/employees/attendance/AttendancePage.test.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: Task 4 read wrappers and `useCapabilities`.
- Produces: review-only queue/drawer; no mutations yet.

- [ ] **Step 1: Write failing capability, exact-case, and evidence tests**

Assert a reviewer sees a Review control, opening it requests the selected `case_id`, and a non-reviewer issues no case request. In the drawer test, assert separate Source facts, Automatic evaluations, and Human corrections sections and that historical snapshot location is shown instead of current employee placement.

```tsx
await user.click(screen.getByRole('button', { name: /Review Ahmed/ }))
expect(api.getAttendanceCase).toHaveBeenCalledWith(42)
expect(await screen.findByText('Source facts')).toBeInTheDocument()
expect(screen.getByText('Main Gate / Gate 1')).toBeInTheDocument()
expect(screen.getByText('Main Gate Terminal')).toBeInTheDocument()
```

- [ ] **Step 2: Run tests and verify failure**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx src/pages/employees/attendance/AttendancePage.test.tsx
```

- [ ] **Step 3: Query backend exceptions and open exact cases**

On `AttendancePage`, compute:

```ts
const canReview = has('workforce.people.view') && has('workforce.attendance.review')
const exceptionsQuery = useQuery({
  queryKey: ['attendance-exceptions', operationalDate, shiftCode],
  queryFn: () => api.listAttendanceExceptions({
    operational_date: operationalDate,
    limit: 500,
  }),
  enabled: canReview,
})
```

Pass exception rows into `AttentionQueue`; add `onReviewCase(caseId)` without changing employee-navigation behavior. Keep the existing day register as the page's primary query.

- [ ] **Step 4: Implement the read-only drawer**

The drawer owns `selectedCaseId` and queries `api.getAttendanceCase`. Render:

- captured department/unit/post/crew/shift snapshots;
- scheduled window;
- persisted punches;
- effective result;
- automatic revision timeline;
- adjustment timeline; and
- audit actor/time/reason.

Use a side drawer on desktop and full-screen dialog on mobile, focus trap, explicit close, and focus restoration. Do not render correction controls in this task.

- [ ] **Step 5: Run tests and commit**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx src/pages/employees/attendance/AttendancePage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
git add frontend/src/pages/employees/attendance/AttendancePage.tsx frontend/src/pages/employees/attendance/AttentionQueue.tsx frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.tsx frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx frontend/src/pages/employees/attendance/AttendancePage.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(attendance): add correction review drawer"
```

---

### Task 6: Add guarded correction, revocation, and conflict recovery

**Files:**
- Modify: `frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.tsx`
- Modify: `frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx`
- Create: `frontend/src/pages/employees/attendance/attendanceCorrectionForm.ts`
- Create: `frontend/src/pages/employees/attendance/attendanceCorrectionForm.test.ts`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: Task 4 versioned mutations and Task 5 drawer.
- Produces: correction/revoke actions visible only with `workforce.attendance.correct`.

- [ ] **Step 1: Write failing form-diff, revocation, and conflict tests**

Pure form test:

```ts
expect(buildAdjustmentPayload(original, {
  ...original,
  replacement_presence_state: 'completed',
  reason: 'Supervisor register',
})).toEqual({
  replacement_presence_state: 'completed',
  reason: 'Supervisor register',
})
```

Drawer tests must prove:

- review-only users see no write controls;
- blank reasons prevent submission;
- a successful correction sends current ETag and invalidates exact query keys;
- revoke uses the refreshed case ETag and requires confirmation/reason;
- `ATTENDANCE_CASE_VERSION_CONFLICT` reloads evidence while preserving unsaved form values; and
- no mutation has automatic retry.

- [ ] **Step 2: Run tests and verify failure**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/attendance/attendanceCorrectionForm.test.ts src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx
```

- [ ] **Step 3: Implement changed-field payload construction**

```ts
export interface AttendanceEffective {
  presence_state: AttendancePresenceState | null
  first_in_at: string | null
  latest_in_at: string | null
  final_out_at: string | null
  late_minutes: number | null
  early_exit_minutes: number | null
  missing_checkout: boolean | null
}

export interface AttendanceCorrectionDraft {
  presenceState: AttendancePresenceState | null
  firstInAt: string
  latestInAt: string
  finalOutAt: string
  lateMinutes: string
  earlyExitMinutes: string
  missingCheckout: boolean | null
  reason: string
}

function optionalMinutes(value: string): number | null {
  return value.trim() === '' ? null : Number.parseInt(value, 10)
}

function optionalUtc(value: string): string | null {
  return value === '' ? null : localDubaiInputToUtc(value)
}

export function buildAdjustmentPayload(
  effective: AttendanceEffective,
  draft: AttendanceCorrectionDraft,
): AttendanceAdjustmentWrite {
  const reason = draft.reason.trim()
  if (reason === '') throw new Error('CORRECTION_REASON_REQUIRED')
  const payload: AttendanceAdjustmentWrite = { reason }

  if (draft.presenceState !== effective.presence_state) {
    payload.replacement_presence_state = draft.presenceState
  }
  if (draft.firstInAt !== toLocalInput(effective.first_in_at)) {
    payload.replacement_first_in_at = optionalUtc(draft.firstInAt)
  }
  if (draft.latestInAt !== toLocalInput(effective.latest_in_at)) {
    payload.replacement_latest_in_at = optionalUtc(draft.latestInAt)
  }
  if (draft.finalOutAt !== toLocalInput(effective.final_out_at)) {
    payload.replacement_final_out_at = optionalUtc(draft.finalOutAt)
  }
  const lateMinutes = optionalMinutes(draft.lateMinutes)
  if (lateMinutes !== effective.late_minutes) {
    payload.replacement_late_minutes = lateMinutes
  }
  const earlyExitMinutes = optionalMinutes(draft.earlyExitMinutes)
  if (earlyExitMinutes !== effective.early_exit_minutes) {
    payload.replacement_early_exit_minutes = earlyExitMinutes
  }
  if (draft.missingCheckout !== effective.missing_checkout) {
    payload.replacement_missing_checkout = draft.missingCheckout
  }
  if (Object.keys(payload).length === 1) throw new Error('CORRECTION_UNCHANGED')
  return payload
}
```

Define `AttendancePresenceState` from the generated schema union. The three
time comparisons intentionally send `null` only when a reviewer cleared a
previously-present value. Never spread the entire form object into the API
payload.

- [ ] **Step 4: Implement correction and revoke mutations**

Use `useMutation` with `retry: false`. On success invalidate:

```ts
[
  ['attendance-case', caseId],
  ['attendance-exceptions'],
  ['attendance-day'],
  ['employee-attendance'],
  ['workforce', 'snapshot'],
  ['notification-counts'],
]
```

Use prefix invalidation where keys include dates/employee ids. Keep the drawer open after success, replace its versioned case with the refreshed response/refetch, and announce success via toast/live region.

Only the effective leaf adjustment gets a Revoke correction action. Confirm, require a revoke reason, submit current case ETag, and reload.

- [ ] **Step 5: Implement conflict preservation**

On `ApiError.code === 'ATTENDANCE_CASE_VERSION_CONFLICT'`:

1. snapshot the current draft in component state;
2. refetch `getAttendanceCase(caseId)`;
3. reset evidence/version only;
4. restore the saved draft without auto-submitting; and
5. render a warning asking the reviewer to compare new evidence.

Other errors leave all fields untouched and display the backend message.

- [ ] **Step 6: Run tests, TypeScript, and commit**

```powershell
pnpm -C frontend exec vitest run src/pages/employees/attendance/attendanceCorrectionForm.test.ts src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx src/pages/employees/attendance/AttendancePage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
git add frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.tsx frontend/src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx frontend/src/pages/employees/attendance/attendanceCorrectionForm.ts frontend/src/pages/employees/attendance/attendanceCorrectionForm.test.ts frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(attendance): add audited correction actions"
```

---

### Task 7: Verify the complete correction story live

**Files:**
- Modify tests only if live verification exposes a missing observable contract.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: end-to-end evidence that writes reach the backend and preserve source history.

- [ ] **Step 1: Run required focused backend and frontend gates**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_attendance_day_endpoint.py backend/tests/test_workforce_attendance_corrections_api.py backend/tests/test_workforce_operational_smoke.py -p no:cacheprovider -q
pnpm -C frontend exec vitest run src/lib/api.attendanceCorrection.test.ts src/pages/employees/attendance/attendanceCorrectionForm.test.ts src/pages/employees/attendance/AttendanceCorrectionDrawer.test.tsx src/pages/employees/attendance/AttendancePage.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all selected tests pass; TypeScript exits 0.

- [ ] **Step 2: Run bilingual and React quality reviews**

Run `i18n-rtl-reviewer` because strings/layout changed. Run `react-best-practices` because multiple TSX components changed. Resolve findings in source, then rerun the focused gates.

- [ ] **Step 3: Exercise live write reachability against a seeded throwaway backend**

Use the Sentinel live-preview/write-reachability workflow. Verify:

1. an actual exception row opens its exact persisted case;
2. source punches, historical snapshots, evaluation revisions, and adjustments are visually distinct;
3. submitting a correction sends `POST /attendance/cases/{id}/adjustments` with `If-Match`;
4. the effective result changes while raw punches/evaluations remain unchanged in the database;
5. revocation sends its endpoint and restores the prior result;
6. a stale ETag returns 409 and the UI preserves unsaved input;
7. review-only users cannot mutate;
8. out-of-scope cases return 403 without evidence disclosure; and
9. desktop/mobile EN and AR/RTL remain usable.

- [ ] **Step 4: Run test falsification for every new behavior test**

Use `test-falsification-check`: temporarily break case-id linkage, case ETag validation, and changed-field payload construction one at a time; confirm the corresponding new test fails; restore each implementation and rerun.

- [ ] **Step 5: Commit any verification-driven corrections**

If source changes were required, stage the correction surfaces explicitly:

```powershell
git add backend/app/api/v1/workforce.py backend/app/services/workforce_admin_service.py backend/app/services/workforce_read_service.py backend/tests/test_workforce_attendance_corrections_api.py frontend/src/lib/api.ts frontend/src/pages/employees/attendance frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "fix(attendance): address correction verification findings"
```

If no source changes were required, do not create an empty commit.
