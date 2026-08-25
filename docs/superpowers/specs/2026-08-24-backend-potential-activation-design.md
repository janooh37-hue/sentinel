# Backend potential activation: Workforce Pulse, attendance correction, and duty activity

2026-08-24. Approved by the site owner in session.

## Purpose

Expose valuable, already-built backend capability without turning Sentinel into a second workforce product or disturbing existing workflows.

This design activates three bounded capabilities:

1. a read-only Workforce Pulse with privacy-safe coverage drill-down;
2. an audited attendance-correction workflow on the existing Attendance page; and
3. Duty Location placement history inside Employee Activity and employee Recent Activity.

The work deliberately reuses the current Workforce evaluation engine, duty-placement event log, dashboard layout system, capability model, and Employee Activity surfaces. It does not add scheduling, shift swaps, policy editing, provider administration, or manual correspondence logging.

## Product boundaries

### In scope

- A configurable `workforce_pulse` Dashboard widget.
- Self-only pulse data for linked users holding `workforce.self.view`.
- Aggregate pulse data for users holding `workforce.dashboard.view`, restricted to their stored Workforce scope.
- Lazy hierarchy drill-down through department, duty unit, and duty post.
- An attendance review queue and correction drawer inside `/employees/attendance`.
- Append-only attendance corrections and revocations with mandatory reasons.
- Duty Location `initial_placement` and `transfer` events in both employee activity APIs and both frontend activity surfaces.
- English/Arabic parity, RTL, dark theme, keyboard operation, and responsive behavior.

### Out of scope

- Workforce crew, rotation, schedule, override, swap, staffing-policy, or integration-management UI.
- Creating or changing Workforce scopes in the frontend. Administrators and already-scoped users retain current behavior; a capable user with no aggregate scope receives a truthful no-scope state.
- Writing attendance corrections back to BioTime.
- Editing or deleting raw punches or automatic evaluation revisions.
- Reconstructing Duty Location history that predates recorded assignment events.
- Reviewer management, saved-contact deletion, and manual correspondence logging.
- A standalone Duty Location history page or a Workforce-branded movement-history page.

## Existing backend assets

The implementation builds on existing contracts rather than replacing them:

- `GET /api/v1/workforce/dashboard/snapshot` already separates self and aggregate blocks and publishes readiness, sync health, current shift, next shift, leave composition, mapping completeness, and schedule completeness.
- `GET /api/v1/workforce/dashboard/coverage` already returns scoped, aggregate-only hierarchy rows with no person identity.
- Attendance cases already preserve automatic evaluations and append attendance adjustments.
- Adjustment writes already require `workforce.attendance.correct`, a reason, and optimistic concurrency.
- Revocation already reveals the prior effective result without deleting history.
- `duty_service` already writes immutable `DutyAssignmentEvent` rows for `initial_placement` and `transfer` before mutating the employee placement.
- `GET /api/v1/employees/activity` and `GET /api/v1/employees/{id}/detail` already provide the global/paginated and profile/recent activity projections.

The frontend currently calls only the daily attendance, employee attendance/history, and integration-status Workforce reads. The new surfaces add typed wrappers rather than making component-local fetches.

## 1. Workforce Pulse

### Placement and dashboard-layout behavior

Add `workforce_pulse` to the canonical dashboard widget identifiers in both backend settings schema and frontend dashboard layout model.

The new widget is appended **hidden** when an existing saved layout does not contain it. This preserves the dashboard contract: newly introduced widgets never backfill themselves into a user's customized layout. Users can enable and place it through the existing Customize Widgets dialog.

The widget belongs to a new `workforce` source group in the customization dialog. It is a lower-zone panel, not a top-card candidate. Its main action opens coverage drill-down only when aggregate coverage is authorized and available.

### Data contract

Add typed frontend wrappers for:

- `getWorkforceAccess()` → `GET /workforce/access/me`;
- `getWorkforceSnapshot()` → `GET /workforce/dashboard/snapshot`; and
- `getWorkforceCoverage(params)` → `GET /workforce/dashboard/coverage`.

The widget requests the access tier first or in parallel with the snapshot. Backend authorization remains decisive; the access response exists to choose truthful frontend copy, not to replace capability checks.

The widget renders only blocks present in the snapshot response:

- **self tier:** current attendance/presence state and scheduled start/end;
- **aggregate tier:** current shift, next shift, verified gap, evaluated/excluded counts, leave composition, and readiness;
- **organization tier:** the same aggregate contract, with organization scope supplied by the backend.

A manager with a Workforce capability but no assigned aggregate scope receives an explicit “No Workforce scope assigned” state. The client must not reinterpret an empty result as zero staffing.

### Truthful states

The backend readiness and health fields control the display:

- missing schedules → setup-required message;
- missing policy → policy-required message;
- incomplete mappings → mapping-completeness count;
- integration `not_configured`, stale, pending, or error → named state, never a fabricated working count;
- pending/error evaluation rows → displayed as excluded from verified attendance;
- no authorized self or aggregate block → widget returns `null` and does not occupy layout space.

### Coverage drill-down

Selecting Coverage opens a side sheet on desktop and a full-screen sheet on narrow viewports. Data loads only when the sheet opens.

Navigation is a three-level breadcrumb:

1. departments;
2. duty units inside the selected department; and
3. duty posts inside the selected duty unit.

Each row displays:

- scheduled;
- excused;
- expected;
- evaluated;
- pending/error excluded;
- verified working; and
- verified gap, derived only when the backend supplied enough verified data.

Rows never contain employee identifiers or names. A response that omits/withholds `working` displays “Pending verification,” not `0`.

The sheet resets its descendant selection when an ancestor changes, keeps the operational date visible, and provides Back/Breadcrumb navigation that works in LTR and RTL.

## 2. Attendance correction

### Placement

Extend the existing `/employees/attendance` page. Do not create a separate administration route.

The page keeps its Register, Board, and Timeline projections. Users holding both `workforce.people.view` and `workforce.attendance.review` receive a Review queue derived from backend attendance exceptions. Users without review capability retain the current page without correction controls.

### Case linkage bridge

The current day and exception rows do not expose their attendance case identifier. Add `case_id` to the `AttendanceDayRowRead` and `AttendanceExceptionRead` response models and service projections.

This is the only discovery bridge: selecting an exception must address the exact persisted case; the client must not search for a case by employee/date/shift and risk opening the wrong duty on a double-shift day.

Add frontend wrappers for:

- list attendance exceptions;
- get one attendance case;
- create an adjustment; and
- revoke an adjustment.

After the backend schema changes, regenerate `backend/openapi.json` and `frontend/src/lib/api.types.ts` using the project API-sync workflow.

### Review queue

The queue groups actionable rows without changing the existing attendance classification rules:

- absent;
- late;
- early exit;
- missing checkout; and
- any row whose current effective result differs from the latest automatic evaluation because an adjustment is active.

Filters include operational date, shift, and exception kind. The queue respects the same resolved Workforce scope as the daily register.

Selecting a row opens the correction drawer. On desktop it is a side drawer; on narrow screens it is full-screen.

### Case evidence

The drawer shows:

- employee identity and the case's captured department, Duty Location, post, crew, and shift snapshots (never the employee's current placement substituted into a historical case);
- operational date and scheduled shift window;
- immutable raw punch timestamps and device names when available;
- latest automatic evaluation and reason code;
- effective result;
- leave/excusal evidence represented by evaluation data;
- chronological automatic evaluation revisions;
- chronological adjustment history, including superseded and revoked rows; and
- the actor, timestamp, and reason for every adjustment when available from the API.

The existing case response does not yet publish raw punches, placement
snapshots, typed evaluation rows, correction actors, or revocation reasons.
Extend it with explicit `AttendanceCasePunchRead`,
`AttendanceEvaluationRead`, `AttendanceAdjustmentRead`, and
`AttendanceAdjustmentAuditRead` schemas. `AttendanceCaseRead` also publishes
the persisted department, duty unit, duty post, crew, shift, and
organization-snapshot state from `AttendanceCase`; historical evidence never
joins the employee's mutable current placement.

Source punches are selected from the persisted punch facts used for that
employee and case window; direction remains omitted because this installation's
provider does not supply reliable in/out state. Adjustment audit metadata is
resolved from the existing `AuditLog` rows, including the revocation reason,
rather than adding a second mutable history column.

If a source fact is unavailable, the API omits it and the drawer names the
evidence as unavailable. It must not reconstruct a punch from the effective
evaluation timestamps.

The UI distinguishes source facts, automatic judgment, and human correction. A corrected value must never be presented as if it came from BioTime.

### Creating a correction

Only `workforce.attendance.correct` exposes the correction form. Review-only users can inspect evidence and history but cannot mutate it.

The reviewer can replace any subset of:

- presence state;
- first arrival;
- latest arrival;
- final departure;
- late minutes;
- early-exit minutes; and
- missing-checkout state.

The replacement form starts from the current effective result. Untouched fields remain absent from the request so the backend keeps its existing value. A non-blank reason is mandatory.

Local date/time controls display Asia/Dubai wall time and serialize timezone-aware UTC timestamps. The client never sends a timezone-naive timestamp.

### Revocation and append-only history

A correction does not update raw punches, automatic evaluations, or earlier adjustments. The backend appends a new adjustment that supersedes the current active adjustment.

Only the effective leaf adjustment can be revoked. Revocation requires a reason. After revocation, the prior valid adjustment or latest automatic evaluation becomes effective again.

The interface uses “Revoke correction,” not “Delete,” and confirms the consequence before writing.

### Concurrency contract

Make case concurrency consistent and reload-safe:

- define one `attendance_case_etag` helper from the latest automatic revision plus the active leaf adjustment;
- `GET /attendance/cases/{case_id}` returns that ETag;
- create and revoke both require `If-Match` against the same case ETag;
- successful create/revoke responses return the refreshed case ETag; and
- the frontend API helper exposes `{ data, etag }` for these versioned calls.

This replaces the current mismatch where create validates a case-level value, revoke validates an adjustment-row value, and a fresh GET publishes no ETag.

On `ATTENDANCE_CASE_VERSION_CONFLICT`, the drawer reloads the case, preserves the reviewer's unsaved reason/replacement values locally, and asks them to review the newer evidence before resubmitting.

### Failure behavior

- A correction failure leaves the drawer open with all entered values intact.
- A revoked/already-superseded correction reloads the current case and explains that another reviewer changed it.
- Provider/integration failure does not block reviewing already-persisted case evidence.
- No mutation is retried automatically.
- Successful writes invalidate the case, exception queue, daily register, employee attendance, Workforce Pulse, and relevant notification/attention queries.

## 3. Duty Location transformations in Employee Activity

### Domain ownership

Duty placement history is a Duty Locations fact displayed on an employee timeline. It must not be labeled, routed, or permissioned as a Workforce feature.

The shared `DutyAssignmentEvent` persistence model remains an implementation detail because attendance evaluation also needs historical placement snapshots. Frontend copy uses “Duty location,” “Initial placement,” and “Transferred.”

Do not expose `/workforce/duty-assignment-events` to the frontend for this feature. Instead, query `DutyAssignmentEvent` inside the employee activity/detail services under their existing Employee access rules.

### Activity contracts

Extend both activity kinds with `duty_location`:

- `EmployeeActivityKind` and `EmployeeActivityItemRead` for the paginated global feed;
- `ActivityItemRead` for employee detail Recent Activity; and
- their generated TypeScript counterparts.

Add structured optional fields rather than encoding movement semantics into English backend strings:

- `event_type` (`initial_placement` or `transfer`);
- `from_department`, `from_unit`, `from_post`;
- `to_department`, `to_unit`, `to_post`;
- `effective_at`; and
- `reason`.

The frontend creates localized summaries from these fields. Existing activity kinds remain unchanged.

### Global Employee Activity

`GET /employees/activity` includes Duty Location events in its merged, newest-first pagination and accepts `kind=duty_location`.

When an employee is selected, every recorded placement event for that employee participates in the total and pagination. Without an employee filter, events can appear in the organization activity feed under the same Employee visibility rules as the other kinds.

The frontend filter bar gains a bilingual Duty location chip. A movement row displays:

- event type;
- previous location when present;
- destination location;
- effective date/time; and
- reason when present.

The row links to the employee profile Activity tab, not to Workforce. It does not open or preselect the Duty Locations transfer workflow.

### Employee Recent Activity

`GET /employees/{id}/detail` includes the same events when building its merged `recent_activity`, subject to the existing `ACTIVITY_LIMIT` newest-first cap.

The employee Activity tab renders the same localized movement row. The global Employee Activity feed remains the paginated full-history surface; Recent Activity is intentionally only the latest mixed activity.

### Historical truth

`initial_placement` and `transfer` rows are immutable recorded history and are shown. Synthetic `baseline` rows used by Workforce seeding are not user actions and are excluded.

No backfill guesses earlier movements from the employee's current unit/post. If the first recorded event is later than the employee's employment start, the timeline may state “Recorded Duty Location history begins on …”. It must not imply that no earlier movement occurred.

## Permissions

| Surface | Read capability | Write capability |
| --- | --- | --- |
| Workforce Pulse self block | `workforce.self.view` | none |
| Workforce Pulse aggregate/coverage | `workforce.dashboard.view` plus resolved stored scope | none |
| Attendance queue/case evidence | `workforce.people.view` + `workforce.attendance.review` | none |
| Attendance create/revoke | all review capabilities above | `workforce.attendance.correct` |
| Duty Location activity events | existing Employee Activity/detail access (`employees.view`) | none |

Frontend gates optimize navigation and copy. Backend checks remain authoritative.

## Component boundaries

### Backend

- `workforce.py`: case-id projection, consistent case ETags, snapshot/coverage contracts unchanged otherwise.
- `workforce_read_service.py`: publish case ids, persisted punch evidence, typed evaluation/adjustment history, audit metadata, and version inputs.
- `workforce_admin_service.py`: shared case-version validation for create/revoke; existing audit writes remain the source for actor/reason history.
- `employee_activity_service.py`: merge and paginate Duty Location events.
- `employee_detail_service.py`: merge Duty Location events into recent activity.
- Activity/workforce schemas: structured new fields and case identifiers.

### Frontend

- `lib/api.ts`: typed Workforce snapshot/access/coverage and versioned correction wrappers.
- Dashboard layout/settings: canonical `workforce_pulse` widget id and source.
- `WorkforcePulseWidget`: capability/readiness-aware compact projection.
- `WorkforceCoverageSheet`: lazy aggregate hierarchy browser.
- Attendance page: review queue integration.
- `AttendanceCorrectionDrawer`: evidence, history, correction, revoke, and conflict recovery.
- Employee activity section/filter/row: `duty_location` kind.
- Employee detail Activity tab: the same Duty Location presentation.

The shared presentation logic for a Duty Location event should be one focused component/helper used by both activity surfaces. Attendance correction state and Workforce Pulse state remain separate; they have different permissions, freshness, and mutation behavior.

## Query invalidation

- Workforce Pulse: `['workforce', 'access']`, `['workforce', 'snapshot']`, and scoped/date-specific coverage keys.
- Attendance case: `['attendance-case', caseId]`.
- Attendance queue: date/filter-specific exception keys.
- Existing daily register and employee-attendance keys are invalidated after correction.
- Duty transfers invalidate both employee detail and employee activity queries so the new movement appears immediately after a completed transfer.

No global “invalidate everything” operation is introduced.

## Accessibility and bilingual behavior

- Every new string is added in English and Arabic together.
- Coverage breadcrumbs and from/to movement arrows mirror semantically in RTL.
- Location paths use logical layout properties; G-numbers, timestamps, and numeric counts preserve readable direction.
- Drawers trap focus, restore focus to the triggering row, support Escape where safe, and provide an explicit close button.
- Correction state never depends on color alone; labels and icons accompany status tones.
- Reduced motion is honored; no new decorative motion is required.
- Mobile correction and coverage surfaces are full-screen so evidence and actions are not compressed into stacked modal layers.

## Verification

### Backend contracts

- Snapshot self-only responses omit aggregate identity/state.
- Coverage remains scoped, paginated, aggregate-only, and withholds unverifiable working counts.
- Day and exception rows identify the correct case on double-shift days.
- Case GET/create/revoke use one reload-safe ETag contract.
- Corrections append; they never mutate punches or evaluations.
- A newer automatic revision or human correction produces a conflict for a stale client.
- Revocation reveals the correct prior effective result.
- Case evidence distinguishes persisted punches, automatic revisions, adjustments, and adjustment audit metadata; unavailable source facts are never inferred.
- Actor, reason, timestamps, and before/after audit entries are present for create and revoke.
- Duty Location events appear in both employee activity endpoints, sort correctly, filter by kind/employee, paginate correctly, and exclude baselines.

### Frontend contracts

- Workforce Pulse renders self, aggregate, readiness, no-scope, stale, and withheld-count states correctly.
- Coverage drill-down never renders person identity and resets descendants when ancestors change.
- Review-only users cannot see correction/revoke controls.
- Correction form submits only changed replacement fields and timezone-aware timestamps.
- Conflict recovery preserves unsaved input while refreshing evidence.
- Duty Location activity appears in both activity surfaces and the kind filter.
- Every new surface is verified in English and Arabic/RTL, desktop and mobile.

### Live verification

Because attendance correction is a write surface, unit tests are insufficient. Against a seeded throwaway backend:

1. open an actual persisted exception case;
2. submit a correction and prove the request reaches the adjustment endpoint;
3. verify the effective case result changes while raw punches/evaluations remain unchanged;
4. revoke the correction and verify the prior result returns;
5. exercise a stale ETag conflict;
6. complete a Duty Location transfer and verify the movement appears in both activity surfaces; and
7. exercise Workforce Pulse and coverage as self-only, scoped manager, no-scope manager, and administrator.

## Delivery order

1. Backend contract bridge: case ids, case ETags, activity schemas/services, OpenAPI regeneration.
2. Duty Location activity frontend integration (read-only, smallest end-to-end slice).
3. Workforce Pulse widget and readiness states.
4. Coverage drill-down.
5. Attendance review queue and read-only case evidence.
6. Correction and revocation writes with conflict handling.
7. Bilingual/RTL review and full live verification.

This order lands read-only value first and leaves the highest-risk mutation surface until its evidence and concurrency contracts are already exercised.