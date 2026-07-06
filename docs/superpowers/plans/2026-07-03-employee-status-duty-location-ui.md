# Employee Status & Duty Location UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make employee status (Active/Resigned/Terminated) and duty location (unit/post) viewable and changeable from the employee detail page — frontend only, all backend endpoints already exist.

**Architecture:** Three additions to the existing Employee Detail page: (1) the hero's existing-but-dead Edit button opens the existing `EmployeeForm` in edit mode inline (same card the intake flow already uses); (2) the hero status pill becomes a button opening a new compact `StatusDialog` (PATCH); (3) `ProfileTab` gains duty unit/post rows plus a Transfer button opening a new `TransferEmployeeDialog` with an "Issue transfer letter" checkbox — checked routes through `POST /duty/transfer` (letter + General Book), unchecked does a plain PATCH.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, react-hook-form, Radix dialogs (`@/components/ui/dialog`), i18next (en.json + ar.json), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-03-employee-status-duty-location-design.md`

## Global Constraints

- Branch: `feature/employee-status-duty-ui` (already created off `main`). NEVER commit to `main` — it is the live production checkout; the user merges/deploys.
- Frontend only. No files under `backend/` change.
- Every new user-facing string gets a key in BOTH `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` (key parity is the #1 recurring bug source).
- All commands run from `C:\Users\Admin\sentinel\frontend` (pnpm). Tests: `pnpm exec vitest run <path>`. Lint: `pnpm lint`. Typecheck: `pnpm exec tsc -b`.
- Existing API surface used (all already in `frontend/src/lib/api.ts`): `api.updateEmployee(id, EmployeeUpdate)`, `api.transferDuty(DutyTransferRequest)`, `api.listEmployees({limit})` → `{ items: EmployeeListItem[] }`, `api.getEmployeeDetail(id)`.
- Capability gate: `useCapabilities().has('employees.edit')` — same pattern already used in `EmployeeHero.tsx:48-49`.

---

### Task 1: Gate the hero Edit button by capability

The Edit button in `EmployeeHero` currently shows for everyone (the API would reject a non-privileged PATCH anyway). Gate it — and the two new affordances added in later tasks — behind `employees.edit`.

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeHero.tsx:143-150`
- Test: `frontend/src/pages/employees/EmployeeHero.test.tsx` (new)

**Interfaces:**
- Produces: `EmployeeHero` renders the Edit button only when `has('employees.edit')` is true. Props unchanged in this task.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/EmployeeHero.test.tsx`:

```tsx
/**
 * EmployeeHero capability-gating tests: the Edit action must only render for
 * users holding `employees.edit`.
 */
import { render, screen } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

let allowed = true
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (_c: string) => allowed }),
}))
vi.mock('@/components/employees/useEmployeePhoto', () => ({
  useEmployeePhoto: () => ({ upload: { mutate: vi.fn(), isPending: false } }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}))

import { EmployeeHero } from './EmployeeHero'
import type { EmployeeRead } from '@/lib/api'

const employee = {
  id: 'G100',
  name_en: 'John Doe',
  name_ar: 'جون دو',
  status: 'Active',
  has_photo: false,
} as unknown as EmployeeRead

test('shows Edit button when user has employees.edit', () => {
  allowed = true
  render(<EmployeeHero employee={employee} onEdit={vi.fn()} onAddLeave={vi.fn()} onGenerate={vi.fn()} />)
  expect(screen.getByText('actions.edit')).toBeInTheDocument()
})

test('hides Edit button without employees.edit', () => {
  allowed = false
  render(<EmployeeHero employee={employee} onEdit={vi.fn()} onAddLeave={vi.fn()} onGenerate={vi.fn()} />)
  expect(screen.queryByText('actions.edit')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/EmployeeHero.test.tsx`
Expected: FAIL — 'hides Edit button without employees.edit' fails (button renders unconditionally today).

- [ ] **Step 3: Gate the button**

In `frontend/src/pages/employees/EmployeeHero.tsx`, wrap the Edit button (lines 143-150) in `{canEdit && (...)}`:

```tsx
          {canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-4 py-2 text-[0.85em] font-medium backdrop-blur transition-colors hover:bg-white/25"
            >
              <Pencil className="h-3.5 w-3.5" />
              {t('actions.edit')}
            </button>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/EmployeeHero.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/employees/EmployeeHero.tsx src/pages/employees/EmployeeHero.test.tsx
git commit -m "fix(employees): gate hero Edit button by employees.edit capability"
```

---

### Task 2: Wire the Edit button to the inline edit form

Today `onEdit={() => setTab('profile')}` (EmployeeDetailPage.tsx:121) — a dead end onto the read-only Profile tab. Reuse the inline `EmployeeForm mode="edit"` card that the intake-extraction flow already renders (lines 101-117); an `editing` state now also shows it. The existing `editMutation` (PATCH + invalidate + toast) is reused unchanged, plus it now closes the form on success.

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx:35-126`
- Test: `frontend/src/pages/employees/EmployeeDetailPage.test.tsx` (new)

**Interfaces:**
- Consumes: `EmployeeForm({ mode: 'edit', initial, onSubmit, onCancel, submitting })` from `@/components/employees/EmployeeForm` (exists).
- Produces: clicking the hero Edit button renders `EmployeeForm` in edit mode above the hero; Cancel or successful save hides it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/EmployeeDetailPage.test.tsx`:

```tsx
/**
 * EmployeeDetailPage edit wiring: clicking the hero Edit action must render
 * the EmployeeForm in edit mode (it previously just switched tabs).
 * Children are stubbed — hero internals are covered by EmployeeHero.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getEmployeeDetail: vi.fn(),
    updateEmployee: vi.fn(),
  },
}))
/* eslint-disable @typescript-eslint/no-explicit-any */
vi.mock('./EmployeeHero', () => ({
  EmployeeHero: ({ onEdit }: any) => (
    <button onClick={onEdit}>hero-edit</button>
  ),
}))
vi.mock('./EmployeeQuickStats', () => ({ EmployeeQuickStats: () => null }))
vi.mock('./EmployeeDetailTabs', () => ({ EmployeeDetailTabs: () => null }))
vi.mock('./tabs/DocumentsTab', () => ({ DocumentsTab: () => null }))
vi.mock('./tabs/ProfileTab', () => ({ ProfileTab: () => null }))
vi.mock('./tabs/LeavesTab', () => ({ LeavesTab: () => null }))
vi.mock('./tabs/ViolationsTab', () => ({ ViolationsTab: () => null }))
vi.mock('./tabs/ActivityTab', () => ({ ActivityTab: () => null }))
vi.mock('@/components/employees/EmployeeForm', () => ({
  EmployeeForm: ({ mode }: any) => <div data-testid="employee-form" data-mode={mode} />,
}))
/* eslint-enable @typescript-eslint/no-explicit-any */

import { api } from '@/lib/api'
import { EmployeeDetailPage } from './EmployeeDetailPage'

const detail = {
  employee: { id: 'G100', name_en: 'John Doe', name_ar: 'جون دو', status: 'Active', has_photo: false },
  stats: { documents: 0, leaves_taken_days: 0, violations: 0, ledger_count: 0 },
  recent_documents: [],
  recent_leaves: [],
  recent_violations: [],
  recent_activity: [],
}

test('clicking Edit renders EmployeeForm in edit mode', async () => {
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail as never)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/employees/G100']}>
        <Routes>
          <Route path="/employees/:id" element={<EmployeeDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByText('hero-edit'))
  const form = screen.getByTestId('employee-form')
  expect(form).toBeInTheDocument()
  expect(form.dataset.mode).toBe('edit')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/EmployeeDetailPage.test.tsx`
Expected: FAIL — `getByTestId('employee-form')` finds nothing (onEdit only switches tabs).

- [ ] **Step 3: Wire the editing state**

In `frontend/src/pages/employees/EmployeeDetailPage.tsx`:

3a. Add state next to the existing `tab` state (line 35):

```tsx
  const [tab, setTab] = useState<Tab>('documents')
  const [editing, setEditing] = useState(false)
```

3b. In `editMutation.onSuccess` (line 58), close the form:

```tsx
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', id] })
      setInitialExtraction(undefined)
      setEditing(false)
      toast.success(t('employees.toast.updated'))
    },
```

3c. Replace the inline-form condition (line 101, `{initialExtraction && (`) so the card renders for plain editing too, and give the form a working Cancel:

```tsx
      {(editing || initialExtraction) && (
        <div className="mb-6 rounded-2xl border border-hairline bg-surface p-6">
          {initialExtraction && (
            <p className="mb-4 text-[0.82em] font-medium text-muted-foreground">
              {t('employees.intake.reviewAndApply', { defaultValue: 'Review the scanned data and apply to this employee record.' })}
            </p>
          )}
          <EmployeeForm
            mode="edit"
            initial={data.employee}
            initialExtraction={initialExtraction}
            onSubmit={async (values) => {
              await editMutation.mutateAsync(values)
            }}
            onCancel={() => {
              setEditing(false)
              setInitialExtraction(undefined)
            }}
            submitting={editMutation.isPending}
          />
        </div>
      )}
```

3d. Point the hero at it (line 121):

```tsx
        onEdit={() => setEditing(true)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/EmployeeDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/employees/EmployeeDetailPage.tsx src/pages/employees/EmployeeDetailPage.test.tsx
git commit -m "feat(employees): Edit button opens inline employee edit form"
```

---

### Task 3: Quick status-change dialog from the hero pill

New compact `StatusDialog`: status select + end-date input (shown and required when status ≠ Active — mirrors the backend invariant). The hero status pill becomes a button (with a small pencil) when the user can edit. Saving with status Active sends `end_date: null` so a stale end date is cleared when re-activating.

**Files:**
- Create: `frontend/src/pages/employees/StatusDialog.tsx`
- Modify: `frontend/src/pages/employees/EmployeeHero.tsx:37-42, 126-130` (new optional prop + pill button)
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx` (state + render dialog)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/employees/StatusDialog.test.tsx` (new)

**Interfaces:**
- Produces: `StatusDialog({ open: boolean, employee: EmployeeRead, onOpenChange: (open: boolean) => void })` — PATCHes `{ status, end_date }`, invalidates `['employee-detail', id]` and `['employees']`.
- Produces: `EmployeeHero` gains optional prop `onChangeStatus?: () => void`; pill is a button only when `canEdit && onChangeStatus`.
- Consumes: `EMPLOYEE_STATUSES` from `@/components/employees/schema`; `EmployeeStatus` type from `@/lib/api`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/StatusDialog.test.tsx`:

```tsx
/**
 * StatusDialog invariant tests. Radix Select is not driven in jsdom — the
 * end-date rule is exercised by mounting with a non-Active employee instead.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: { updateEmployee: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))

import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
import { StatusDialog } from './StatusDialog'

function renderDialog(employee: Partial<EmployeeRead>): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StatusDialog open employee={employee as EmployeeRead} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
}

test('non-Active without end date: save disabled and requirement shown', () => {
  renderDialog({ id: 'G100', name_en: 'John', status: 'Resigned', end_date: null })
  expect(screen.getByText('employees.validation.endDateRequired')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()
})

test('non-Active with end date: saves status + end_date', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({ id: 'G100', name_en: 'John', status: 'Resigned', end_date: null })
  // Label text is "employees.fields.end_date *" (required asterisk) — match loosely.
  fireEvent.change(screen.getByLabelText(/employees\.fields\.end_date/), {
    target: { value: '2026-07-31' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      status: 'Resigned',
      end_date: '2026-07-31',
    }),
  )
})

test('Active: saves with end_date null (clears stale end date)', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog({ id: 'G100', name_en: 'John', status: 'Active', end_date: '2026-01-01' })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      status: 'Active',
      end_date: null,
    }),
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/StatusDialog.test.tsx`
Expected: FAIL — `StatusDialog.tsx` does not exist.

- [ ] **Step 3: Create StatusDialog**

Create `frontend/src/pages/employees/StatusDialog.tsx`:

```tsx
/**
 * StatusDialog — quick status change from the employee hero pill.
 *
 * Status select + end-date input; the end date appears and is required when
 * status ≠ Active (same invariant the backend enforces). Saving as Active
 * sends end_date: null so re-activating clears a stale end date.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type EmployeeRead, type EmployeeStatus } from '@/lib/api'
import { EMPLOYEE_STATUSES } from '@/components/employees/schema'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  open: boolean
  employee: EmployeeRead
  onOpenChange: (open: boolean) => void
}

export function StatusDialog({ open, employee, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [status, setStatus] = useState<EmployeeStatus>(employee.status)
  const [endDate, setEndDate] = useState(employee.end_date ?? '')

  const endDateRequired = status !== 'Active'
  const canSave = !endDateRequired || endDate.trim().length > 0

  const mutation = useMutation({
    mutationFn: () =>
      api.updateEmployee(employee.id, {
        status,
        end_date: status === 'Active' ? null : endDate,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('employees.toast.updated'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('employees.statusDialog.title')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{employee.id}</span>
            {' · '}
            <span dir="auto">{pickEmployeeName(employee, i18n.language)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-4 py-4 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status-dialog-status">{t('employees.fields.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as EmployeeStatus)}>
              <SelectTrigger id="status-dialog-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPLOYEE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`employees.status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {endDateRequired && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="status-dialog-end-date">{`${t('employees.fields.end_date')} *`}</Label>
              <Input
                id="status-dialog-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="font-mono"
              />
              {!endDate.trim() && (
                <span role="alert" className="text-xs text-destructive">
                  {t('employees.validation.endDateRequired')}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
```

Note: the `Label` import comes from `@/components/ui/label`; `getByLabelText` in the test relies on `htmlFor`/`id` matching, as written above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/StatusDialog.test.tsx`
Expected: PASS (3 tests). If Radix dialog complains about missing `aria-describedby`, that's a warning, not a failure — ignore.

- [ ] **Step 5: Make the hero pill clickable**

In `frontend/src/pages/employees/EmployeeHero.tsx`:

5a. Extend Props (lines 37-42):

```tsx
interface Props {
  employee: EmployeeRead
  onEdit: () => void
  onAddLeave: () => void
  onGenerate: () => void
  onChangeStatus?: () => void
}
```

…and destructure it in the signature (line 44):

```tsx
export function EmployeeHero({ employee, onEdit, onAddLeave, onGenerate, onChangeStatus }: Props): React.JSX.Element {
```

5b. Replace the status pill `<span>` (lines 127-130) with a conditional button/span:

```tsx
              {canEdit && onChangeStatus ? (
                <button
                  type="button"
                  onClick={onChangeStatus}
                  aria-label={t('employees.statusDialog.title')}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-0.5 text-[0.86em] font-semibold transition-colors hover:bg-white/25"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`} aria-hidden />
                  {t(`employees.status.${employee.status}`, employee.status)}
                  <Pencil className="h-3 w-3 opacity-70" aria-hidden />
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-0.5 text-[0.86em] font-semibold">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLS[employee.status] ?? 'bg-muted'}`} aria-hidden />
                  {t(`employees.status.${employee.status}`, employee.status)}
                </span>
              )}
```

5c. In `frontend/src/pages/employees/EmployeeDetailPage.tsx`, add state, prop, and render the dialog:

```tsx
  const [statusOpen, setStatusOpen] = useState(false)
```

Add to the hero (after `onEdit`):

```tsx
        onChangeStatus={() => setStatusOpen(true)}
```

Render the dialog right after `<EmployeeHero … />` (conditional mount so state resets each open):

```tsx
      {statusOpen && (
        <StatusDialog open employee={data.employee} onOpenChange={setStatusOpen} />
      )}
```

Import at the top of the file, in the SAME edit that adds the JSX (the local hook strips momentarily-unused imports):

```tsx
import { StatusDialog } from './StatusDialog'
```

- [ ] **Step 6: Add i18n keys**

In `frontend/src/locales/en.json`, inside the `"employees"` object (next to the existing `"status"` block around line 245), add:

```json
    "statusDialog": {
      "title": "Change status"
    },
```

In `frontend/src/locales/ar.json`, same position in the `"employees"` object:

```json
    "statusDialog": {
      "title": "تغيير الحالة"
    },
```

- [ ] **Step 7: Run all page tests + lint**

Run: `pnpm exec vitest run src/pages/employees` then `pnpm lint`
Expected: PASS / no new lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/employees/StatusDialog.tsx src/pages/employees/StatusDialog.test.tsx src/pages/employees/EmployeeHero.tsx src/pages/employees/EmployeeDetailPage.tsx src/locales/en.json src/locales/ar.json
git commit -m "feat(employees): quick status-change dialog from hero status pill"
```

---

### Task 4: Show duty unit/post on the Profile tab

Two read-only rows in the existing info grid. (The Transfer button comes in Task 5.)

**Files:**
- Modify: `frontend/src/pages/employees/tabs/ProfileTab.tsx:40-48`
- Modify: `frontend/src/locales/en.json` (`employee.profile`, ~line 1515), `frontend/src/locales/ar.json` (`employee.profile`, ~line 1598)
- Test: `frontend/src/pages/employees/tabs/ProfileTab.test.tsx` (new)

**Interfaces:**
- Consumes: `employee.duty_unit`, `employee.duty_post` (already on `EmployeeRead` / returned by the detail endpoint).
- Produces: rows keyed `employee.profile.dutyUnit` / `employee.profile.dutyPost` in the info grid.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/tabs/ProfileTab.test.tsx`:

```tsx
/**
 * ProfileTab info-grid tests — duty unit/post rows must render (em dash when
 * unassigned). Vault query is stubbed to undefined so the identity section
 * stays un-rendered; SignaturePad is stubbed out.
 */
import { render, screen } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
vi.mock('@/components/employees/SignaturePad', () => ({ SignaturePad: () => null }))
// ProfileTab imports './PassportField' — mock the same specifier (test lives in the same dir).
vi.mock('./PassportField', () => ({ PassportField: () => null }))
vi.mock('@/components/employees/IdentityDocCard', () => ({ IdentityDocCard: () => null }))

import { ProfileTab } from './ProfileTab'
import type { EmployeeRead } from '@/lib/api'

test('renders duty unit and post values', () => {
  const employee = {
    id: 'G100',
    name_en: 'John',
    status: 'Active',
    duty_unit: 'السرية الأولى',
    duty_post: 'البوابة الرئيسية',
  } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} />)
  expect(screen.getByText('employee.profile.dutyUnit')).toBeInTheDocument()
  expect(screen.getByText('السرية الأولى')).toBeInTheDocument()
  expect(screen.getByText('employee.profile.dutyPost')).toBeInTheDocument()
  expect(screen.getByText('البوابة الرئيسية')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/tabs/ProfileTab.test.tsx`
Expected: FAIL — `employee.profile.dutyUnit` row not rendered.

- [ ] **Step 3: Add the rows**

In `frontend/src/pages/employees/tabs/ProfileTab.tsx`, extend the `fields` array (lines 40-48) — insert after the `department` entry:

```tsx
  const fields: { k: string; v: string | null | undefined }[] = [
    { k: 'employee.profile.idEn', v: employee.id },
    { k: 'employee.profile.nameEn', v: employee.name_en },
    { k: 'employee.profile.nameAr', v: employee.name_ar },
    { k: 'employee.profile.position', v: pickPosition(employee, i18n.language) },
    { k: 'employee.profile.department', v: employee.department },
    { k: 'employee.profile.dutyUnit', v: employee.duty_unit },
    { k: 'employee.profile.dutyPost', v: employee.duty_post },
    { k: 'employee.profile.doj', v: employee.doj },
    { k: 'employee.profile.status', v: t(`employees.status.${employee.status}`, employee.status) },
  ]
```

- [ ] **Step 4: Add i18n keys**

`frontend/src/locales/en.json` — in `employee.profile` (line ~1515), after `"department"`:

```json
      "dutyUnit": "Duty unit",
      "dutyPost": "Duty post",
```

`frontend/src/locales/ar.json` — in `employee.profile` (line ~1598), after `"department"` (terminology matches `dutyLocations.field.unit`/`.post`):

```json
      "dutyUnit": "الوحدة",
      "dutyPost": "النقطة",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/tabs/ProfileTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/employees/tabs/ProfileTab.tsx src/pages/employees/tabs/ProfileTab.test.tsx src/locales/en.json src/locales/ar.json
git commit -m "feat(employees): show duty unit/post on profile tab"
```

---

### Task 5: Transfer dialog on the Profile tab (letter checkbox)

New `TransferEmployeeDialog` — single-employee variant combining the two existing duty flows: with "Issue transfer letter" checked (default) it POSTs `/duty/transfer` exactly like `TransferDialog` (letter + General Book + recipient/manager/CC pickers); unchecked it PATCHes like `AssignPopover`. A Transfer button under the Profile info grid opens it.

**Files:**
- Create: `frontend/src/pages/employees/TransferEmployeeDialog.tsx`
- Modify: `frontend/src/pages/employees/tabs/ProfileTab.tsx` (button + dialog under the info grid)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/employees/TransferEmployeeDialog.test.tsx` (new)

**Interfaces:**
- Produces: `TransferEmployeeDialog({ open: boolean, employee: EmployeeRead, onOpenChange: (open: boolean) => void })`.
- Consumes: `unitOptions`/`postsForUnit` from `@/lib/dutyUnits`; `buildTransferRequest` from `@/pages/dutyLocations/transferRequest`; `loadTransferDefaults`/`saveTransferDefaults` from `@/pages/dutyLocations/transferDefaults`; picker fields from `@/components/application/fields/*` (all exist — see `TransferDialog.tsx` for the reference usage).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/employees/TransferEmployeeDialog.test.tsx`:

```tsx
/**
 * TransferEmployeeDialog endpoint-selection tests: the "issue transfer letter"
 * checkbox (default ON) decides POST /duty/transfer vs plain PATCH.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    updateEmployee: vi.fn(),
    transferDuty: vi.fn(),
    listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('@/pages/dutyLocations/transferDefaults', () => ({
  loadTransferDefaults: () => ({ recipientId: null, managerId: null, cc: [] }),
  saveTransferDefaults: vi.fn(),
}))
vi.mock('@/components/application/fields/RecipientPickerField', () => ({ RecipientPickerField: () => null }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({ ManagerPickerField: () => null }))
vi.mock('@/components/application/fields/MultiRecipientPickerField', () => ({ MultiRecipientPickerField: () => null }))

import { api } from '@/lib/api'
import type { EmployeeRead } from '@/lib/api'
import { TransferEmployeeDialog } from './TransferEmployeeDialog'

const employee = {
  id: 'G100',
  name_en: 'John',
  duty_unit: 'السرية الأولى',
  duty_post: null,
} as unknown as EmployeeRead

function renderDialog(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TransferEmployeeDialog open employee={employee} onOpenChange={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('checkbox on (default): confirms via POST /duty/transfer', async () => {
  vi.mocked(api.transferDuty).mockResolvedValue({ moved: ['G100'], book_id: 7, ref: 'GB-1' } as never)
  renderDialog()
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destUnit'), {
    target: { value: 'السرية الثانية' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'dutyLocations.transfer.generate' }))
  await waitFor(() => expect(api.transferDuty).toHaveBeenCalled())
  expect(vi.mocked(api.transferDuty).mock.calls[0][0]).toMatchObject({
    employee_ids: ['G100'],
    to_unit: 'السرية الثانية',
  })
  expect(api.updateEmployee).not.toHaveBeenCalled()
})

test('checkbox off: confirms via plain PATCH', async () => {
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  renderDialog()
  fireEvent.click(screen.getByLabelText('dutyLocations.transfer.issueLetter'))
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destUnit'), {
    target: { value: 'السرية الثانية' },
  })
  fireEvent.change(screen.getByLabelText('dutyLocations.transfer.destPost'), {
    target: { value: 'البوابة' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() =>
    expect(api.updateEmployee).toHaveBeenCalledWith('G100', {
      duty_unit: 'السرية الثانية',
      duty_post: 'البوابة',
    }),
  )
  expect(api.transferDuty).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/TransferEmployeeDialog.test.tsx`
Expected: FAIL — `TransferEmployeeDialog.tsx` does not exist.

- [ ] **Step 3: Create TransferEmployeeDialog**

Create `frontend/src/pages/employees/TransferEmployeeDialog.tsx`:

```tsx
/**
 * TransferEmployeeDialog — change one employee's duty unit/post from his
 * profile. "Issue transfer letter" (default ON) routes through POST
 * /duty/transfer — official letter + General Book record, identical to the
 * Duty Locations page. Unchecked does a silent PATCH (like AssignPopover).
 */
import { useId, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { api, apiErrorMessage, type DutyTransferResult, type EmployeeRead } from '@/lib/api'
import { unitOptions, postsForUnit } from '@/lib/dutyUnits'
import { buildTransferRequest } from '@/pages/dutyLocations/transferRequest'
import { loadTransferDefaults, saveTransferDefaults } from '@/pages/dutyLocations/transferDefaults'
import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { MultiRecipientPickerField } from '@/components/application/fields/MultiRecipientPickerField'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  employee: EmployeeRead
  onOpenChange: (open: boolean) => void
}

export function TransferEmployeeDialog({ open, employee, onOpenChange }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const unitListId = useId()
  const postListId = useId()
  const checkboxId = useId()

  const [unit, setUnit] = useState(employee.duty_unit ?? '')
  const [post, setPost] = useState(employee.duty_post ?? '')
  const [issueLetter, setIssueLetter] = useState(true)

  // Roster fetch only feeds the unit/post combobox suggestions.
  const { data: roster } = useQuery({
    queryKey: ['employees', { limit: 500 }],
    queryFn: () => api.listEmployees({ limit: 500 }),
    enabled: open,
  })
  const all = roster?.items ?? []
  const units = unitOptions(all)
  const posts = postsForUnit(all, unit.trim())

  const [initial] = useState(loadTransferDefaults)
  const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
    defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
  })

  const mutation = useMutation({
    mutationFn: async (): Promise<DutyTransferResult | null> => {
      if (!issueLetter) {
        await api.updateEmployee(employee.id, {
          duty_unit: unit.trim() || null,
          duty_post: post.trim() || null,
        })
        return null
      }
      const v = methods.getValues()
      return api.transferDuty(
        buildTransferRequest({
          employeeIds: [employee.id],
          toUnit: unit,
          toPost: post,
          recipientId: v.recipient_id,
          managerId: v.manager_id,
          cc: v.cc,
        }),
      )
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', employee.id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      if (result == null) {
        toast.success(t('dutyLocations.assign.saved'))
      } else {
        const v = methods.getValues()
        saveTransferDefaults({ recipientId: v.recipient_id, managerId: v.manager_id, cc: v.cc })
        void qc.invalidateQueries({ queryKey: ['books'] })
        if (result.book_id == null) {
          toast.success(t('dutyLocations.transfer.movedNoBook', { count: result.moved.length }))
        } else {
          toast.success(t('dutyLocations.transfer.success', { ref: result.ref }), {
            action: {
              label: t('dutyLocations.transfer.viewRecord'),
              onClick: () => navigate(`/books/${result.book_id}`),
            },
          })
        }
      }
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  // The letter path needs a destination unit (backend requires to_unit); the
  // silent PATCH may clear both fields (unassign), so an empty unit is fine.
  const canSubmit = !mutation.isPending && (!issueLetter || unit.trim().length > 0)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('employee.profile.transfer')}</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{employee.id}</span>
            {' · '}
            <span dir="auto">{pickEmployeeName(employee, i18n.language)}</span>
            {' — '}
            <span dir="auto">
              {employee.duty_unit
                ? `${employee.duty_unit}${employee.duty_post ? ` · ${employee.duty_post}` : ''}`
                : t('dutyLocations.unassigned')}
            </span>
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${unitListId}-input`} className="text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.destUnit')}
              </label>
              <input
                id={`${unitListId}-input`}
                list={unitListId}
                value={unit}
                dir="auto"
                autoComplete="off"
                placeholder={t('dutyLocations.field.unitPlaceholder')}
                onChange={(e) => setUnit(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id={unitListId}>
                {units.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${postListId}-input`} className="text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.destPost')}
              </label>
              <input
                id={`${postListId}-input`}
                list={postListId}
                value={post}
                dir="auto"
                autoComplete="off"
                placeholder={t('dutyLocations.field.postPlaceholder')}
                onChange={(e) => setPost(e.target.value)}
                className="h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <datalist id={postListId}>
                {posts.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm">
              <input
                id={checkboxId}
                type="checkbox"
                checked={issueLetter}
                onChange={(e) => setIssueLetter(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              {t('dutyLocations.transfer.issueLetter')}
            </label>

            {issueLetter && (
              <>
                <RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
                <ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
                <MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
              </>
            )}
          </div>
        </FormProvider>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {issueLetter ? t('dutyLocations.transfer.generate') : t('common.save')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
```

Note: check `DutyTransferResult` is exported from `@/lib/api` (it is — `TransferDialog` relies on the same shape via `api.transferDuty`). If the named export is missing, import the type via `Awaited<ReturnType<typeof api.transferDuty>>` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/TransferEmployeeDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the Transfer button to ProfileTab**

In `frontend/src/pages/employees/tabs/ProfileTab.tsx`:

5a. Add imports and state (imports in the SAME edit as their first use — the on-edit lint hook strips momentarily-unused imports):

```tsx
import { useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TransferEmployeeDialog } from '../TransferEmployeeDialog'
```

Inside the component:

```tsx
  const [transferOpen, setTransferOpen] = useState(false)
```

5b. Inside the info-grid card `<div className="rounded-2xl bg-surface p-4 md:p-6">`, after the grid `</div>`, add:

```tsx
        {canEdit && (
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />
              {t('employee.profile.transfer')}
            </Button>
          </div>
        )}
        {transferOpen && (
          <TransferEmployeeDialog open employee={employee} onOpenChange={setTransferOpen} />
        )}
```

5c. Extend `ProfileTab.test.tsx` with a gating test — add mocks and a test at the end:

Add to the existing mock block (module paths relative to the test file):

```tsx
vi.mock('../TransferEmployeeDialog', () => ({ TransferEmployeeDialog: () => null }))
```

Add test:

```tsx
test('shows Transfer button for editors', () => {
  const employee = { id: 'G100', name_en: 'John', status: 'Active' } as unknown as EmployeeRead
  render(<ProfileTab employee={employee} />)
  expect(screen.getByText('employee.profile.transfer')).toBeInTheDocument()
})
```

- [ ] **Step 6: Add i18n keys**

`frontend/src/locales/en.json`:

In `employee.profile` (after the `dutyPost` key added in Task 4):

```json
      "transfer": "Transfer duty location",
```

In `dutyLocations.transfer` (~line 2151, after `"generate"`):

```json
      "issueLetter": "Issue transfer letter (General Book)",
```

`frontend/src/locales/ar.json`:

In `employee.profile`:

```json
      "transfer": "نقل مكان العمل",
```

In `dutyLocations.transfer` (after `"generate"` — Arabic mirrors the page subtitle terminology):

```json
      "issueLetter": "إصدار كتاب نقل في الكتب العامة",
```

- [ ] **Step 7: Run tests + lint**

Run: `pnpm exec vitest run src/pages/employees` then `pnpm lint`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add src/pages/employees/TransferEmployeeDialog.tsx src/pages/employees/TransferEmployeeDialog.test.tsx src/pages/employees/tabs/ProfileTab.tsx src/pages/employees/tabs/ProfileTab.test.tsx src/locales/en.json src/locales/ar.json
git commit -m "feat(employees): duty-location transfer dialog on profile tab (optional letter)"
```

---

### Task 6: Full verification + i18n/RTL review

**Files:** none created — verification only (fixes land as follow-up edits to the files above).

- [ ] **Step 1: Full frontend suite**

Run (from `frontend/`): `pnpm exec tsc -b && pnpm lint && pnpm test`
Expected: typecheck clean, lint clean, all tests pass (the only allowed pre-existing failures are backend `test_sms_config`/`test_whatsapp_config`, which are not part of `pnpm test`).

- [ ] **Step 2: i18n/RTL review**

Dispatch the `i18n-rtl-reviewer` agent on the branch diff (`git diff main...HEAD`). Fix any parity/RTL findings it reports, re-run `pnpm test`, and amend nothing — commit fixes as `fix(i18n): …`.

- [ ] **Step 3: Manual smoke check (optional but recommended)**

If a dev server is practical: `pnpm dev`, open an employee detail page and verify (a) Edit opens the pre-filled form and saves, (b) the status pill opens the dialog and requires an end date for Resigned, (c) the Profile tab shows duty rows and the Transfer dialog switches endpoints with the checkbox. Otherwise leave verification to the user on the live deployment after merge.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feature/employee-status-duty-ui
```

Do NOT merge into `main` — the user merges and deploys (`mng deploy` now auto-runs migrations; none are needed here since this is frontend-only).
