# Workforce Pulse and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable, privacy-safe Dashboard widget for self/aggregate Workforce status with lazy department → duty unit → duty post coverage drill-down.

**Architecture:** Reuse the existing `/workforce/access/me`, `/workforce/dashboard/snapshot`, and `/workforce/dashboard/coverage` contracts. Register one hidden-by-default lower-zone dashboard widget; it renders only server-authorized blocks and opens an aggregate-only responsive coverage sheet.

**Tech Stack:** FastAPI/Pydantic settings schema, React 19, TypeScript, TanStack Query, react-i18next, existing dashboard layout model, Vitest.

## Global Constraints

- The widget never enters an existing saved layout as visible.
- It is not eligible for the two top dashboard slots.
- Missing or withheld numbers render named readiness states, never zero.
- Coverage never renders employee identity.
- A capable user with no aggregate scope sees an explicit no-scope state; no scope editor is added.
- English/Arabic, RTL, dark theme, keyboard operation, and mobile full-screen coverage are required.
- No Workforce schedules, policies, corrections, overrides, or provider administration are added here.

---

### Task 1: Register the hidden Workforce widget in persisted dashboard layouts

**Files:**
- Modify: `backend/app/schemas/settings.py`
- Modify: `backend/tests/test_dashboard_layout_read.py`
- Modify (generated): `backend/openapi.json`
- Modify (generated): `frontend/src/lib/api.types.ts`
- Modify: `frontend/src/lib/dashboardLayout.ts`
- Modify: `frontend/src/lib/dashboardLayout.test.ts`
- Modify: `frontend/src/components/dashboard/CustomizeWidgetsDialog.tsx`
- Modify: `frontend/src/components/dashboard/CustomizeWidgetsDialog.test.tsx`

**Interfaces:**
- Produces: `WidgetId` value `workforce_pulse`, `WidgetSource` value `workforce`, and a hidden lower-zone default config.

- [ ] **Step 1: Write failing backend and frontend layout tests**

Backend test:

```python
def test_dashboard_layout_accepts_workforce_pulse_as_hidden_lower_widget():
    layout = DashboardLayout.model_validate({
        "widgets": [{
            "id": "workforce_pulse", "visible": False,
            "order": 13, "zone": "under_workspace",
        }],
        "quick_actions": [],
        "canvas_width": "compact",
    })
    assert layout.widgets[0].id == "workforce_pulse"
```

Frontend tests must assert:

```ts
const resolved = resolveLayout(savedLayoutWithoutWorkforcePulse)
expect(resolved.widgets.find((w) => w.id === 'workforce_pulse')).toMatchObject({
  visible: false,
  zone: 'under_workspace',
})
expect(WIDGET_SOURCE.workforce_pulse).toBe('workforce')
expect(TOP_ELIGIBLE_SET.has('workforce_pulse')).toBe(false)
```

Add a Customize dialog test confirming a Workforce source section lists the widget.

- [ ] **Step 2: Run tests and verify failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_dashboard_layout_read.py -p no:cacheprovider -q
pnpm -C frontend exec vitest run src/lib/dashboardLayout.test.ts src/components/dashboard/CustomizeWidgetsDialog.test.tsx
```

Expected: schema/type failures because the new identifiers are absent.

- [ ] **Step 3: Register the exact identifiers**

Backend:

```python
DashboardWidgetId = Literal[
    # existing ids unchanged
    "workforce_pulse",
]
```

Frontend:

```ts
export type WidgetSource = 'employees' | 'leaves' | 'records' | 'ledger' | 'workforce'
export const WIDGET_SOURCES = ['employees', 'leaves', 'records', 'ledger', 'workforce'] as const

export const WIDGET_IDS = [
  // existing ids unchanged
  'workforce_pulse',
] as const

// Insert inside WIDGET_SIZE:
workforce_pulse: 'panel',

// Insert inside WIDGET_SOURCE:
workforce_pulse: 'workforce',
```

Do not add the id to `TOP_ELIGIBLE_IDS`. Let the existing `resolveLayout` append never-seen IDs hidden.

- [ ] **Step 4: Regenerate the settings contract, run tests, and commit**

Use `sync-api-types`, then rerun the Step 2 commands:

```powershell
venv\Scripts\python.exe scripts\dump_openapi.py
pnpm -C frontend run gen:api
venv\Scripts\python.exe -m pytest backend/tests/test_dashboard_layout_read.py -p no:cacheprovider -q
pnpm -C frontend exec vitest run src/lib/dashboardLayout.test.ts src/components/dashboard/CustomizeWidgetsDialog.test.tsx
```

Expected: generated `DashboardWidgetConfig.id` includes `workforce_pulse`; all
selected tests pass.

```powershell
git add backend/app/schemas/settings.py backend/tests/test_dashboard_layout_read.py backend/openapi.json frontend/src/lib/api.types.ts frontend/src/lib/dashboardLayout.ts frontend/src/lib/dashboardLayout.test.ts frontend/src/components/dashboard/CustomizeWidgetsDialog.tsx frontend/src/components/dashboard/CustomizeWidgetsDialog.test.tsx
git commit -m "feat(dashboard): register workforce pulse widget"
```

---

### Task 2: Add typed Workforce access, snapshot, and coverage clients

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/api.workforce.test.ts`

**Interfaces:**
- Produces: `WorkforceAccess`, `WorkforceSnapshot`, `WorkforceCoverageRow`, `WorkforceCoveragePage`, `api.getWorkforceAccess`, `api.getWorkforceSnapshot`, and `api.getWorkforceCoverage`.

- [ ] **Step 1: Write failing request-shape tests**

Mock `fetch` and lock the three paths and query parameters:

```ts
await api.getWorkforceAccess()
expect(fetch).toHaveBeenLastCalledWith(
  '/api/v1/workforce/access/me',
  expect.objectContaining({ method: 'GET' }),
)

await api.getWorkforceCoverage({
  operational_date: '2026-08-24', parent_kind: 'duty_post',
  department: 'Security', duty_unit: 'Main Gate', limit: 100,
})
expect(fetch).toHaveBeenLastCalledWith(
  expect.stringContaining('parent_kind=duty_post'),
  expect.anything(),
)
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
pnpm -C frontend exec vitest run src/lib/api.workforce.test.ts
```

Expected: methods are undefined.

- [ ] **Step 3: Add generated-schema aliases and wrappers**

```ts
export type WorkforceAccess = components['schemas']['WorkforceAccessRead']
export type WorkforceSnapshot = components['schemas']['WorkforceSnapshotRead']
export type WorkforceCoverageRow = components['schemas']['CoverageRowRead']
export type WorkforceCoveragePage = components['schemas']['CursorPage_CoverageRowRead_']

export interface WorkforceCoverageParams {
  operational_date: string
  parent_kind: 'department' | 'duty_unit' | 'duty_post'
  department?: string
  duty_unit?: string
  duty_post?: string
  limit?: number
  cursor?: string
}
```

Inside `api`:

```ts
getWorkforceAccess: () =>
  request<WorkforceAccess>('GET', '/workforce/access/me'),
getWorkforceSnapshot: () =>
  request<WorkforceSnapshot>('GET', '/workforce/dashboard/snapshot'),
getWorkforceCoverage: (params: WorkforceCoverageParams) =>
  request<WorkforceCoveragePage>('GET', `/workforce/dashboard/coverage${qs({ ...params })}`),
```

- [ ] **Step 4: Run test and TypeScript; commit**

```powershell
pnpm -C frontend exec vitest run src/lib/api.workforce.test.ts
pnpm -C frontend exec tsc -b --noEmit
git add frontend/src/lib/api.ts frontend/src/lib/api.workforce.test.ts
git commit -m "feat(workforce): add pulse and coverage API client"
```

Expected: test pass and TypeScript exits 0.

---

### Task 3: Build the capability- and readiness-aware Workforce Pulse widget

**Files:**
- Create: `frontend/src/pages/dashboard/widgets/WorkforcePulseWidget.tsx`
- Create: `frontend/src/pages/dashboard/widgets/WorkforcePulseWidget.test.tsx`
- Modify: `frontend/src/pages/dashboard/DashboardPage.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: Task 2 API methods and existing `useCapabilities`.
- Produces: `WorkforcePulseWidget({ onOpenCoverage })`, returning `null` when neither self nor aggregate access is authorized.

- [ ] **Step 1: Write failing widget-state tests**

Cover six observable states:

```tsx
it.each([
  ['self', selfSnapshot, /My shift/],
  ['aggregate', aggregateSnapshot, /Current shift/],
  ['no scope', noScopeSnapshot, /No Workforce scope assigned/],
  ['schedules missing', schedulesMissing, /Schedule setup required/],
  ['stale', staleSnapshot, /Attendance source is stale/],
  ['withheld', withheldSnapshot, /Pending verification/],
])('renders %s truthfully', async (_name, payload, expected) => {
  vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(payload)
  renderWidget()
  expect(await screen.findByText(expected)).toBeInTheDocument()
})
```

Also assert that a user lacking both `workforce.self.view` and `workforce.dashboard.view` triggers no request and renders nothing.

- [ ] **Step 2: Run test and verify failure**

```powershell
pnpm -C frontend exec vitest run src/pages/dashboard/widgets/WorkforcePulseWidget.test.tsx
```

Expected: component missing.

- [ ] **Step 3: Implement focused state derivation and the widget**

Keep state interpretation pure and testable:

```ts
export type MissingReadiness = 'schedules' | 'policy' | 'mappings' | 'integration'

export type PulseState =
  | { kind: 'self'; snapshot: WorkforceSnapshot }
  | { kind: 'aggregate'; snapshot: WorkforceSnapshot }
  | { kind: 'no_scope' }
  | { kind: 'setup'; missing: MissingReadiness[] }
  | { kind: 'stale' }
  | { kind: 'withheld'; snapshot: WorkforceSnapshot }

export function derivePulseState(
  access: WorkforceAccess,
  snapshot: WorkforceSnapshot,
): PulseState {
  if (access.workforce_access_tier === 'none') return { kind: 'no_scope' }
  const missing: MissingReadiness[] = []
  if (snapshot.readiness) {
    if (!snapshot.readiness.schedules_ready) missing.push('schedules')
    if (!snapshot.readiness.policy_ready) missing.push('policy')
    if (!snapshot.readiness.mappings_ready) missing.push('mappings')
    if (!snapshot.readiness.integration_ready) missing.push('integration')
  }
  if (missing.length > 0) return { kind: 'setup', missing }
  if (snapshot.sync_health?.punches?.state === 'stale') return { kind: 'stale' }
  if (snapshot.current_shift.working == null && snapshot.current_shift.scheduled > 0) {
    return { kind: 'withheld', snapshot }
  }
  return snapshot.aggregate
    ? { kind: 'aggregate', snapshot }
    : { kind: 'self', snapshot }
}
```

Render existing tokenized surfaces, pair every status with a label and icon,
and expose the Coverage action only for aggregate tiers.

- [ ] **Step 4: Wire the dashboard render switch and bilingual labels**

Add:

```tsx
case 'workforce_pulse':
  return <WorkforcePulseWidget onOpenCoverage={() => setCoverageOpen(true)} />
```

Add widget label/source and state copy under `dashboard.workforcePulse` in EN/AR. The component self-hides before issuing requests when capabilities are absent.

- [ ] **Step 5: Run tests and commit**

```powershell
pnpm -C frontend exec vitest run src/pages/dashboard/widgets/WorkforcePulseWidget.test.tsx src/lib/dashboardLayout.test.ts
pnpm -C frontend exec tsc -b --noEmit
git add frontend/src/pages/dashboard/widgets/WorkforcePulseWidget.tsx frontend/src/pages/dashboard/widgets/WorkforcePulseWidget.test.tsx frontend/src/pages/dashboard/DashboardPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(dashboard): add workforce pulse widget"
```

---

### Task 4: Add privacy-safe hierarchy coverage drill-down

**Files:**
- Create: `frontend/src/pages/dashboard/widgets/WorkforceCoverageSheet.tsx`
- Create: `frontend/src/pages/dashboard/widgets/WorkforceCoverageSheet.test.tsx`
- Modify: `frontend/src/pages/dashboard/DashboardPage.tsx`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `api.getWorkforceCoverage` and Workforce Pulse `onOpenCoverage`.
- Produces: `WorkforceCoverageSheet({ open, onOpenChange, operationalDate })`.

- [ ] **Step 1: Write failing drill-down tests**

Assert lazy loading, hierarchy narrowing, withheld-number copy, identity absence, and ancestor reset:

```tsx
render(<WorkforceCoverageSheet open={false} onOpenChange={vi.fn()} operationalDate="2026-08-24" />)
expect(api.getWorkforceCoverage).not.toHaveBeenCalled()

rerender(<WorkforceCoverageSheet open onOpenChange={vi.fn()} operationalDate="2026-08-24" />)
await user.click(await screen.findByRole('button', { name: 'Security' }))
expect(api.getWorkforceCoverage).toHaveBeenLastCalledWith(
  expect.objectContaining({ parent_kind: 'duty_unit', department: 'Security' }),
)
expect(screen.queryByText('G1001')).not.toBeInTheDocument()
```

Include a `working: null` row and assert “Pending verification,” not `0`.

- [ ] **Step 2: Run the test and verify failure**

```powershell
pnpm -C frontend exec vitest run src/pages/dashboard/widgets/WorkforceCoverageSheet.test.tsx
```

- [ ] **Step 3: Implement the three-level state machine**

Use explicit selections:

```ts
interface CoverageSelection {
  department: string | null
  dutyUnit: string | null
}

const parentKind = selection.department == null
  ? 'department'
  : selection.dutyUnit == null
    ? 'duty_unit'
    : 'duty_post'
```

The query key includes date, parent kind, and both ancestors. Selecting a department sets `{ department, dutyUnit: null }`; selecting another department discards the old unit. Back reverses exactly one level. Rows display scheduled, excused, expected, evaluated, excluded, working, and a gap only when `working != null`.

Use the existing dialog/sheet primitives. Desktop is a side sheet; mobile uses the full viewport. Breadcrumb buttons carry `aria-current` for the active level and logical RTL layout.

- [ ] **Step 4: Integrate with Workforce Pulse and add EN/AR copy**

Hold `coverageOpen` in `DashboardPage`, mount one sheet, and pass the snapshot's `operational_date`. Closing the sheet clears descendant selection but keeps no server state.

- [ ] **Step 5: Run tests, type checking, RTL review, and live smoke**

```powershell
pnpm -C frontend exec vitest run src/pages/dashboard/widgets/WorkforcePulseWidget.test.tsx src/pages/dashboard/widgets/WorkforceCoverageSheet.test.tsx src/lib/dashboardLayout.test.ts
pnpm -C frontend exec tsc -b --noEmit
```

Run `i18n-rtl-reviewer`. In a live seeded stack, verify self-only, scoped manager, no-scope manager, administrator, stale, and not-configured states. Inspect desktop and mobile EN/AR; verify coverage network responses and DOM contain no employee identity.

- [ ] **Step 6: Commit the coverage slice**

```powershell
git add frontend/src/pages/dashboard/widgets/WorkforceCoverageSheet.tsx frontend/src/pages/dashboard/widgets/WorkforceCoverageSheet.test.tsx frontend/src/pages/dashboard/DashboardPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(workforce): add scoped coverage drilldown"
```
