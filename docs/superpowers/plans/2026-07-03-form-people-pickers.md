# Form People-Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Passport Release List a searchable employee picker (type a G-number or name), and add manager + submitter pickers to the Employee Clearance Form.

**Architecture:** Part 1 is a frontend-only refactor of `EmployeesTableField` to drive its "add a row" action through the existing shared `EmployeePicker` combobox instead of a manual G-number text input. Part 2 is a data-only change to `backend/templates/_fields.json` — the manager/submitter pickers are already wired end-to-end by field *type* (frontend payload extraction + backend name resolution), so no code is needed.

**Tech Stack:** React 18 + react-hook-form + TanStack Query + Vitest/Testing-Library (frontend); FastAPI + Pydantic + pytest (backend).

## Global Constraints

- Per-employee document forms must stay `personnel` category; do NOT change the category of any form in this plan.
- Passport table output row shape is fixed: `{ employee_id, name, nationality, passport_no }` (feeds the DOCX `item(i, field)` tokens). Do not rename or reshape it.
- Passport table hard cap is 15 rows (`MAX_ROWS`) — the DOCX has exactly 15 data rows.
- The passport row `name` must be `name_ar || name_en` (the document renders the Arabic name).
- **Option B (locked):** do NOT edit any `.docx` template. The clearance manager/submitter tokens are the user's own follow-up.
- Follow existing i18n: user-facing strings go through `t(...)` with the same `application.employeesTable.*` keys already present.

---

### Task 1: Passport table — swap manual G-number input for EmployeePicker

**Files:**
- Modify: `frontend/src/components/application/fields/EmployeesTableField.tsx`
- Create: `frontend/src/components/application/fields/EmployeesTableField.test.tsx`

**Interfaces:**
- Consumes:
  - `EmployeePicker` from `frontend/src/pages/application/EmployeePicker.tsx` — props
    `{ selectedId: string | null; onSelect: (id: string | null) => void }`. On choosing a
    dropdown row it calls `onSelect(row.id)` then closes; driven with `selectedId={null}` it
    stays empty (transient add).
  - `api.getEmployee(id: string): Promise<EmployeeRead>` — returns `{ id, name_ar, name_en, nationality, passport_no, ... }`.
  - `api.listEmployees({ q, limit }): Promise<{ items: EmployeeListItem[] }>` — used internally by `EmployeePicker`; ILIKE-matches `id` / `name_en` / `name_ar`.
- Produces: unchanged form value at `name` — an array of `{ employee_id, name, nationality, passport_no }`.

**Design note (read before Step 3):** Keep the entire existing row table, `MAX_ROWS`, the
duplicate guard, the `add()` resolve-and-append logic, and the error state. The ONLY change is
the input control: replace the `<Input id={`${name}__g`}>` + *Add* `<Button>` block with an
`<EmployeePicker selectedId={null} onSelect={...} />`. Selecting from the picker replaces the
old "type G-number then click Add" — so the picker's `onSelect` calls the existing append flow.
Rename the `add()` param path to accept the id directly.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/application/fields/EmployeesTableField.test.tsx`:

```tsx
/**
 * EmployeesTableField — passport list picker tests.
 *
 * Drives the shared EmployeePicker combobox: focus opens the list (listEmployees),
 * clicking a row resolves the employee (getEmployee) and appends a table row.
 * Mocks `@/lib/api`; i18n comes from the global test/setup.ts.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useForm, FormProvider } from 'react-hook-form'
import React from 'react'

vi.mock('@/lib/api', () => ({
  api: {
    listEmployees: vi.fn(),
    getEmployee: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    code?: string
  },
}))

import { EmployeesTableField } from './EmployeesTableField'
import { api } from '@/lib/api'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function Host() {
  const methods = useForm({ defaultValues: { items: [] } })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <EmployeesTableField
          name="items"
          label_en="Employees"
          label_ar="الموظفون"
          required
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

const EMP = {
  id: 'G1234',
  name_en: 'Ali Hassan',
  name_ar: 'علي حسن',
  nationality: 'Egyptian',
  passport_no: 'A1112223',
  department: 'Ops',
}

async function pickFirstEmployee() {
  const combo = screen.getByRole('combobox')
  fireEvent.focus(combo)
  const option = await screen.findByRole('option')
  fireEvent.mouseDown(option)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [EMP] } as never)
  vi.mocked(api.getEmployee).mockResolvedValue(EMP as never)
})

describe('EmployeesTableField', () => {
  it('appends a row filled from the picked employee (Arabic name)', async () => {
    render(<Host />)
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByText('G1234')).toBeInTheDocument())
    expect(screen.getByText('علي حسن')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A1112223')).toBeInTheDocument()
  })

  it('rejects a duplicate employee (no second row)', async () => {
    render(<Host />)
    await pickFirstEmployee()
    await waitFor(() => expect(screen.getByText('G1234')).toBeInTheDocument())
    await pickFirstEmployee()
    await waitFor(() => {
      expect(screen.getAllByText('G1234')).toHaveLength(1)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/application/fields/EmployeesTableField.test.tsx`
Expected: FAIL — the component still renders a plain G-number `<Input>`, so `getByRole('combobox')` finds nothing (no `EmployeePicker`).

- [ ] **Step 3: Refactor the component to use EmployeePicker**

Edit `frontend/src/components/application/fields/EmployeesTableField.tsx`:

1. Add the import near the other imports:

```tsx
import { EmployeePicker } from '@/pages/application/EmployeePicker'
```

2. Remove the now-unused `Input` import **only if** it is no longer referenced (the row cells
   for Nationality / Passport still use `<Input>` — keep the import; do NOT remove it).

3. Change the `add` function signature to take the id directly, and drop the `g`/`setG` local
   state. Replace:

```tsx
  const [g, setG] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const atCap = fields.length >= MAX_ROWS

  async function add(): Promise<void> {
    const id = g.trim()
    if (!id || busy || atCap) return
    const existing = (getValues(name) as Row[] | undefined) ?? []
    if (existing.some((r) => (r.employee_id ?? '').toUpperCase() === id.toUpperCase())) {
      setLookupErr(t('application.employeesTable.duplicate', { defaultValue: 'Already added.' }))
      setG('') // already in the list — clear so the next entry starts fresh
      return
    }
    setBusy(true)
    setLookupErr(null)
    try {
      const emp = await api.getEmployee(id)
      append({
        employee_id: emp.id,
        name: emp.name_ar || emp.name_en || '',
        nationality: emp.nationality ?? '',
        passport_no: emp.passport_no ?? '',
      } satisfies Row)
      setG('')
    } catch (e) {
      setLookupErr(
        e instanceof ApiError && e.code === 'EMPLOYEE_NOT_FOUND'
          ? t('application.employeesTable.notFound', {
              defaultValue: 'No employee with that G-number.',
            })
          : t('application.employeesTable.lookupError', { defaultValue: 'Lookup failed.' }),
      )
    } finally {
      setBusy(false)
    }
  }
```

with:

```tsx
  const [busy, setBusy] = useState(false)
  const [lookupErr, setLookupErr] = useState<string | null>(null)
  const atCap = fields.length >= MAX_ROWS

  async function add(id: string | null): Promise<void> {
    const gid = (id ?? '').trim()
    if (!gid || busy || atCap) return
    const existing = (getValues(name) as Row[] | undefined) ?? []
    if (existing.some((r) => (r.employee_id ?? '').toUpperCase() === gid.toUpperCase())) {
      setLookupErr(t('application.employeesTable.duplicate', { defaultValue: 'Already added.' }))
      return
    }
    setBusy(true)
    setLookupErr(null)
    try {
      const emp = await api.getEmployee(gid)
      append({
        employee_id: emp.id,
        name: emp.name_ar || emp.name_en || '',
        nationality: emp.nationality ?? '',
        passport_no: emp.passport_no ?? '',
      } satisfies Row)
    } catch (e) {
      setLookupErr(
        e instanceof ApiError && e.code === 'EMPLOYEE_NOT_FOUND'
          ? t('application.employeesTable.notFound', {
              defaultValue: 'No employee with that G-number.',
            })
          : t('application.employeesTable.lookupError', { defaultValue: 'Lookup failed.' }),
      )
    } finally {
      setBusy(false)
    }
  }
```

4. Replace the "Add-by-G-number row" JSX block (the `<div className="flex flex-wrap items-end gap-2">…</div>`) with the picker:

```tsx
      {/* Add-by-search row — same combobox as the rest of the app */}
      <div className="flex flex-col gap-1">
        {!atCap ? (
          <EmployeePicker selectedId={null} onSelect={(id) => void add(id)} />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t('application.employeesTable.capReached', {
              defaultValue: 'Maximum of {{n}} employees reached.',
              n: MAX_ROWS,
            })}
          </p>
        )}
        <span className="text-xs text-muted-foreground">
          {t('application.employeesTable.cap', {
            defaultValue: '{{n}}/15',
            n: fields.length,
          })}
        </span>
      </div>
```

5. If TypeScript now flags `register` or `getValues` as unused, leave them — both are still
   used (`register` in the row cells, `getValues` in `add`). Remove only genuinely unused
   symbols the compiler reports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/components/application/fields/EmployeesTableField.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck + lint the changed files**

Run: `cd frontend && npx tsc -b && npx eslint src/components/application/fields/EmployeesTableField.tsx src/components/application/fields/EmployeesTableField.test.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/application/fields/EmployeesTableField.tsx frontend/src/components/application/fields/EmployeesTableField.test.tsx
git commit -m "feat(passport): searchable employee picker in the release table"
```

---

### Task 2: Employee Clearance Form — add manager + submitter pickers

**Files:**
- Modify: `backend/templates/_fields.json` (the `"Employee Clearance Form"` entry, ends at line ~353)
- Create: `backend/tests/test_clearance_pickers.py`

**Interfaces:**
- Consumes: `template_service.get_template_fields(template_id: str) -> TemplateDetailResponse`
  whose `.fields` is a `list[TemplateField]`, each with `.key: str` and `.type` (a Literal that
  already includes `"manager_picker"` and `"submitter_picker"`).
- Produces: two new fields on the clearance form — `manager_id` (`manager_picker`) and
  `submitter_id` (`submitter_picker`) — auto-consumed by the existing frontend payload
  extraction and `document_service` name resolution (no code change).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_clearance_pickers.py`:

```python
"""Employee Clearance Form must expose manager + submitter pickers.

The pickers are wired end-to-end by field *type*: ApplicationPage extracts
manager_picker/submitter_picker into the payload, and document_service resolves
manager_id -> manager_name and submitter_id -> submitter_name. So exposing the
two fields in the schema is the whole change. Regression guard."""

from __future__ import annotations

from app.services import template_service


def _fields_by_type(template_id: str) -> dict[str, str]:
    detail = template_service.get_template_fields(template_id)
    return {f.type: f.key for f in detail.fields}


def test_clearance_has_manager_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("manager_picker") == "manager_id"


def test_clearance_has_submitter_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("submitter_picker") == "submitter_id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_clearance_pickers.py -v`
Expected: FAIL — both `manager_picker` and `submitter_picker` are absent from the clearance schema.

- [ ] **Step 3: Add the two fields to `_fields.json`**

In `backend/templates/_fields.json`, in the `"Employee Clearance Form"` entry, the `fields`
array currently ends with the `clearance_table` object. Change the tail of that array from:

```json
      {
        "key": "clearance_table",
        "type": "clearance_table",
        "label_en": "Clearance Items",
        "label_ar": "بنود إخلاء الطرف",
        "required": false
      }
    ]
  },
```

to (append the two pickers after `clearance_table`):

```json
      {
        "key": "clearance_table",
        "type": "clearance_table",
        "label_en": "Clearance Items",
        "label_ar": "بنود إخلاء الطرف",
        "required": false
      },
      {
        "key": "manager_id",
        "type": "manager_picker",
        "label_en": "Line Manager",
        "label_ar": "المدير المباشر",
        "required": false
      },
      {
        "key": "submitter_id",
        "type": "submitter_picker",
        "label_en": "Submitter",
        "label_ar": "مقدم الطلب",
        "required": false
      }
    ]
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && python -m pytest tests/test_clearance_pickers.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Guard the catalog didn't regress**

Run: `cd backend && python -m pytest tests/test_templates_catalog.py -q`
Expected: PASS (JSON still parses, all templates still load).

- [ ] **Step 6: Commit**

```bash
git add backend/templates/_fields.json backend/tests/test_clearance_pickers.py
git commit -m "feat(clearance): manager + submitter pickers on the clearance form"
```

---

### Task 3: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Frontend suite**

Run: `cd frontend && npm run test`
Expected: PASS (existing suite + the new EmployeesTableField test).

- [ ] **Step 2: Frontend build/typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no type errors.

- [ ] **Step 3: Backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS (existing suite + the two new clearance tests).

- [ ] **Step 4: Confirm no stray template churn**

Run: `git status --porcelain backend/templates`
Expected: only `_fields.json` shows as modified (staged/committed) — no `.docx` files changed.
If any `.docx` shows churn, revert it (`git checkout -- backend/templates/*.docx`) per the
"templates churn in place" note before finishing.

---

## Self-Review

**Spec coverage:**
- Part 1 (passport searchable picker, reuse EmployeePicker, keep cap/dedupe/shape) → Task 1. ✓
- Part 2 (clearance manager + submitter pickers, `_fields.json` only) → Task 2. ✓
- Option B / no `.docx` edits → Global Constraints + Task 3 Step 4. ✓
- Testing (component test for Part 1, schema test for Part 2) → Task 1 Step 1, Task 2 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code and command step is concrete. ✓

**Type consistency:** `add(id: string | null)` matches `EmployeePicker.onSelect: (id: string | null) => void`; row shape `{ employee_id, name, nationality, passport_no }` unchanged; backend test reads `TemplateField.type` / `.key` (real fields). ✓
