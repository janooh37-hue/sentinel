# Employee Lookup Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/employees` roster list with a search-first lookup page and restructure `/employees/:id` into a sidebar-file profile that surfaces and drives completion of missing employee data.

**Architecture:** A new pure module `core/employee_completeness.py` is the single source of truth for the 14 tracked fields; the detail endpoint embeds per-employee gaps and a new `/employees/completeness` endpoint aggregates them. The frontend replaces `EmployeesPage` with `EmployeeLookupPage` (navy hero search + info cards) and rebuilds `EmployeeDetailPage` as compact-band + sticky sidebar (ID card, gaps checklist) + chip tabs reusing the existing tab bodies.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend); React 19 + React Query + Tailwind 4 + vitest (frontend); generated `api.types.ts` via `/sync-api-types`.

**Spec:** `docs/superpowers/specs/2026-07-08-employee-lookup-redesign-design.md`
**Visual reference:** `docs/employee-page-prototype.html` — match its layout/copy exactly.

## Global Constraints

- Work on branch `feat/employee-lookup`; merge to `main` when green (checkout is production).
- mypy strict, `ruff check`, pytest with `filterwarnings=error` must pass on every commit.
- After ANY backend schema/route change: run `/sync-api-types`; commit `backend/openapi.json` + `frontend/src/lib/api.types.ts` together with the change.
- All UI strings added to BOTH `frontend/src/locales/en.json` and `ar.json` (key parity).
- Logical CSS only: `ms-*/me-*`, `text-start/end`, `inset-inline-*` — never `ml-/left-`.
- Arabic copy comes from the prototype verbatim (e.g. «غير مسجّل», «أكمل البيانات الآن», «عن مَن تبحث؟»).
- Design tokens only (`bg-primary`, `var(--hero-grad)`, `bg-warning-soft`…) — no raw hex in components.
- Do not commit churned `backend/templates/*.docx`.

---

### Task 1: Completeness core (backend)

**Files:**
- Create: `backend/app/core/employee_completeness.py`
- Test: `backend/tests/test_employee_completeness.py`

**Interfaces:**
- Produces: `TRACKED_FIELDS: tuple[str, ...]` (len 14), `missing_fields(emp: Employee) -> list[str]`, `completeness(emp: Employee) -> tuple[int, int]` (filled, tracked). Field name `"position"` is filled when `position` OR `position_ar` is non-blank.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_employee_completeness.py
"""Completeness core: tracked-field gaps on Employee rows."""
from app.core.employee_completeness import TRACKED_FIELDS, completeness, missing_fields
from app.db.models import Employee


def _emp(**overrides: object) -> Employee:
    base: dict[str, object] = dict(
        id="G0001", name_en="TEST", name_ar="اختبار", dob=None, nationality=None,
        contact=None, passport_no=None, passport_expiry=None, uae_id_no=None,
        uae_id_expiry=None, iban=None, position=None, position_ar=None,
        department=None, duty_unit=None, doj=None,
    )
    base.update(overrides)
    return Employee(**base)  # type: ignore[arg-type]


def test_tracked_fields_is_the_agreed_14() -> None:
    assert TRACKED_FIELDS == (
        "name_en", "name_ar", "dob", "nationality", "contact",
        "passport_no", "passport_expiry", "uae_id_no", "uae_id_expiry", "iban",
        "position", "department", "duty_unit", "doj",
    )


def test_missing_fields_reports_gaps_in_stable_order() -> None:
    emp = _emp(nationality=None, contact="0501234567")
    missing = missing_fields(emp)
    assert "nationality" in missing
    assert "contact" not in missing
    assert missing == [f for f in TRACKED_FIELDS if f in missing]


def test_blank_and_whitespace_count_as_missing() -> None:
    emp = _emp(nationality="  ", iban="")
    missing = missing_fields(emp)
    assert "nationality" in missing and "iban" in missing


def test_position_ar_satisfies_position() -> None:
    emp = _emp(position=None, position_ar="حارس أمن")
    assert "position" not in missing_fields(emp)


def test_completeness_counts() -> None:
    emp = _emp(nationality="UAE")  # name_en, name_ar, nationality filled = 3
    filled, tracked = completeness(emp)
    assert tracked == 14
    assert filled == 3
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_completeness.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.employee_completeness`

- [ ] **Step 3: Implement the module**

```python
# backend/app/core/employee_completeness.py
"""Single source of truth for employee-profile completeness.

The 14 tracked fields drive the profile gaps checklist, the ProfileTab
missing-row highlights, and the /employees/completeness aggregate. Field
display names live in frontend i18n under ``employee.field.<name>``.
"""
from __future__ import annotations

from app.db.models import Employee

TRACKED_FIELDS: tuple[str, ...] = (
    "name_en", "name_ar", "dob", "nationality", "contact",
    "passport_no", "passport_expiry", "uae_id_no", "uae_id_expiry", "iban",
    "position", "department", "duty_unit", "doj",
)


def _blank(value: object) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def missing_fields(emp: Employee) -> list[str]:
    missing: list[str] = []
    for field in TRACKED_FIELDS:
        if field == "position":
            if _blank(emp.position) and _blank(emp.position_ar):
                missing.append(field)
        elif _blank(getattr(emp, field)):
            missing.append(field)
    return missing


def completeness(emp: Employee) -> tuple[int, int]:
    gaps = len(missing_fields(emp))
    return len(TRACKED_FIELDS) - gaps, len(TRACKED_FIELDS)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_completeness.py -v`
Expected: 5 PASS

- [ ] **Step 5: Lint/typecheck, commit**

Run: `venv\Scripts\ruff.exe check backend/app/core/employee_completeness.py backend/tests/test_employee_completeness.py && venv\Scripts\mypy.exe`
Expected: clean.

```bash
git add backend/app/core/employee_completeness.py backend/tests/test_employee_completeness.py
git commit -m "feat(employees): completeness core — 14 tracked fields"
```

---

### Task 2: Detail payload gaps + `/employees/completeness` endpoint

**Files:**
- Modify: `backend/app/schemas/employee_detail.py` (class `EmployeeDetailRead`, ~line 74)
- Modify: `backend/app/services/employee_detail_service.py` (the `sx.EmployeeDetailRead(...)` return, ~line 170)
- Modify: `backend/app/api/v1/employees.py` (new route — MUST be registered ABOVE `GET /{employee_id}` at line ~124, or FastAPI will match `completeness` as an employee id)
- Create: `backend/app/schemas/employee_completeness.py`
- Test: `backend/tests/test_employees_completeness_api.py`

**Interfaces:**
- Consumes: Task 1 `missing_fields`, `completeness`, `TRACKED_FIELDS`.
- Produces (frontend relies on these exact shapes):
  - `EmployeeDetailRead.missing_fields: list[str]`, `EmployeeDetailRead.completeness: CompletenessRead {filled: int, tracked: int}`
  - `GET /api/v1/employees/completeness` → `CompletenessSummaryOut {incomplete: int, tracked: int, top_missing: list[{field: str, count: int}], first_incomplete_id: str | None}` (Active employees only, `top_missing` top 3 by count, `first_incomplete_id` = most gaps, ties by id).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_employees_completeness_api.py
"""Detail payload gaps + aggregate completeness endpoint."""
# Follow the existing fixture pattern in backend/tests/test_employees_api.py
# (client + db session + auth override). Reuse its helpers verbatim.


def test_detail_includes_missing_fields(client, db_employee_factory):
    emp = db_employee_factory(id="G9001", nationality=None, iban=None)
    res = client.get(f"/api/v1/employees/{emp.id}/detail")
    assert res.status_code == 200
    body = res.json()
    assert "nationality" in body["missing_fields"]
    assert body["completeness"]["tracked"] == 14


def test_completeness_summary_counts_active_only(client, db_employee_factory):
    db_employee_factory(id="G9002", status="Active", nationality=None)
    db_employee_factory(id="G9003", status="Resigned", nationality=None)
    res = client.get("/api/v1/employees/completeness")
    assert res.status_code == 200
    body = res.json()
    assert body["incomplete"] >= 1
    fields = [m["field"] for m in body["top_missing"]]
    assert "nationality" in fields
    assert len(body["top_missing"]) <= 3
    assert body["first_incomplete_id"] is not None
```

(Adapt fixture names to the actual ones in `backend/tests/test_employees_api.py` — read that file first; do not invent a new fixture stack.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employees_completeness_api.py -v`
Expected: FAIL — `missing_fields` KeyError / 404 or 422 on `/employees/completeness` (route currently swallowed by `/{employee_id}`).

- [ ] **Step 3: Implement**

```python
# backend/app/schemas/employee_completeness.py
from pydantic import BaseModel


class CompletenessRead(BaseModel):
    filled: int
    tracked: int


class MissingFieldCount(BaseModel):
    field: str
    count: int


class CompletenessSummaryOut(BaseModel):
    incomplete: int
    tracked: int
    top_missing: list[MissingFieldCount]
    first_incomplete_id: str | None
```

In `backend/app/schemas/employee_detail.py` add to `EmployeeDetailRead`:

```python
from app.schemas.employee_completeness import CompletenessRead

class EmployeeDetailRead(BaseModel):
    ...
    missing_fields: list[str]
    completeness: CompletenessRead
```

In `backend/app/services/employee_detail_service.py` extend the return:

```python
from app.core.employee_completeness import completeness as _completeness
from app.core.employee_completeness import missing_fields as _missing_fields
from app.schemas.employee_completeness import CompletenessRead

    filled, tracked = _completeness(emp)
    return sx.EmployeeDetailRead(
        ...,
        missing_fields=_missing_fields(emp),
        completeness=CompletenessRead(filled=filled, tracked=tracked),
    )
```

In `backend/app/api/v1/employees.py` — insert ABOVE the `GET /{employee_id}` route:

```python
from collections import Counter

from app.core.employee_completeness import TRACKED_FIELDS, missing_fields
from app.schemas.employee_completeness import CompletenessSummaryOut, MissingFieldCount


@router.get("/completeness", response_model=CompletenessSummaryOut)
def employees_completeness(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("employees.view"))],
) -> CompletenessSummaryOut:
    """Aggregate profile gaps over Active employees (lookup-page hero card)."""
    rows = db.query(Employee).filter(Employee.status == "Active").all()
    counter: Counter[str] = Counter()
    worst: tuple[int, str] | None = None
    incomplete = 0
    for emp in rows:
        gaps = missing_fields(emp)
        if not gaps:
            continue
        incomplete += 1
        counter.update(gaps)
        key = (-len(gaps), emp.id)
        if worst is None or key < (-worst[0], worst[1]):
            worst = (len(gaps), emp.id)
    return CompletenessSummaryOut(
        incomplete=incomplete,
        tracked=len(TRACKED_FIELDS),
        top_missing=[MissingFieldCount(field=f, count=c) for f, c in counter.most_common(3)],
        first_incomplete_id=worst[1] if worst else None,
    )
```

- [ ] **Step 4: Run the full backend suite**

Run: `venv\Scripts\python.exe -m pytest`
Expected: all PASS (including the pre-existing detail tests — they must tolerate the two new fields; fix any snapshot-style assertions).

- [ ] **Step 5: Review the migration-free schema change, sync API types**

No DB migration needed (computed fields). Run the `/sync-api-types` skill: dump `backend/openapi.json`, `pnpm -C frontend gen:api`, `pnpm -C frontend exec tsc -b --noEmit`.
Expected: `api.types.ts` gains `missing_fields`, `completeness`, `CompletenessSummaryOut`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/employee_completeness.py backend/app/schemas/employee_detail.py \
  backend/app/services/employee_detail_service.py backend/app/api/v1/employees.py \
  backend/tests/test_employees_completeness_api.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(employees): per-employee gaps in detail + /employees/completeness aggregate"
```

---

### Task 3: api.ts client + recents storage util (frontend)

**Files:**
- Modify: `frontend/src/lib/api.ts` (~line 797, next to `getEmployeeDetail`)
- Create: `frontend/src/lib/employeeRecents.ts`
- Test: `frontend/src/lib/employeeRecents.test.ts`

**Interfaces:**
- Produces:
  - `api.getEmployeesCompleteness(): Promise<CompletenessSummaryOut>` and exported type `CompletenessSummaryOut = components['schemas']['CompletenessSummaryOut']`.
  - `recordRecentEmployee(e: {id: string; name_en: string; name_ar?: string | null}): void`, `getRecentEmployees(limit?: number): RecentEmployee[]` (`RecentEmployee = {id, name_en, name_ar: string | null, ts: number}`), storage key `gssg.employees.recent`, max 5 kept, most-recent first, de-duped by id, storage failures swallowed.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/lib/employeeRecents.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { getRecentEmployees, recordRecentEmployee } from './employeeRecents'

describe('employeeRecents', () => {
  beforeEach(() => window.localStorage.clear())

  it('records and returns most-recent first, deduped', () => {
    recordRecentEmployee({ id: 'G1', name_en: 'A' })
    recordRecentEmployee({ id: 'G2', name_en: 'B', name_ar: 'ب' })
    recordRecentEmployee({ id: 'G1', name_en: 'A' })
    const rec = getRecentEmployees()
    expect(rec.map((r) => r.id)).toEqual(['G1', 'G2'])
  })

  it('keeps at most 5 and respects limit', () => {
    for (let i = 0; i < 7; i++) recordRecentEmployee({ id: `G${i}`, name_en: `E${i}` })
    expect(getRecentEmployees()).toHaveLength(5)
    expect(getRecentEmployees(3)).toHaveLength(3)
  })

  it('survives corrupted storage', () => {
    window.localStorage.setItem('gssg.employees.recent', '{not json')
    expect(getRecentEmployees()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm -C frontend exec vitest run src/lib/employeeRecents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/src/lib/employeeRecents.ts
/** Recently-opened employee profiles (lookup-page «آخر الملفات المفتوحة» card).
 *  localStorage-backed; failures (private mode, quota) are swallowed. */

export interface RecentEmployee {
  id: string
  name_en: string
  name_ar: string | null
  ts: number
}

const KEY = 'gssg.employees.recent'
const MAX = 5

export function getRecentEmployees(limit = MAX): RecentEmployee[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as RecentEmployee[]).slice(0, limit)
  } catch {
    return []
  }
}

export function recordRecentEmployee(e: { id: string; name_en: string; name_ar?: string | null }): void {
  try {
    const next: RecentEmployee[] = [
      { id: e.id, name_en: e.name_en, name_ar: e.name_ar ?? null, ts: Date.now() },
      ...getRecentEmployees().filter((r) => r.id !== e.id),
    ].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
}
```

In `frontend/src/lib/api.ts` (next to `getEmployeeDetail`):

```ts
export type CompletenessSummaryOut = components['schemas']['CompletenessSummaryOut']
...
  getEmployeesCompleteness: () =>
    request<CompletenessSummaryOut>('GET', '/employees/completeness'),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm -C frontend exec vitest run src/lib/employeeRecents.test.ts && pnpm -C frontend exec tsc -b --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/employeeRecents.ts frontend/src/lib/employeeRecents.test.ts frontend/src/lib/api.ts
git commit -m "feat(employees): completeness client + recent-profiles storage"
```

---

### Task 4: i18n keys (en + ar)

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Produces the key namespaces used by Tasks 5–9. Arabic copy is canonical (matches the prototype); English mirrors it. Keys (structure identical in both files):

```jsonc
// under the existing top-level "employees" object:
"lookup": {
  "eyebrow": "Operations · Employees",            // ar: "العمليات · الموظفون"
  "title": "Who are you looking for?",             // ar: "عن مَن تبحث؟"
  "subtitle": "Active, on leave, or separated — every file appears in search", // ar: "نشط، في إجازة، أو منتهي الخدمة — كل ملف يظهر في البحث"
  "placeholder": "Type a name or employee ID…",    // ar: "اكتب الاسم أو الرقم الوظيفي…"
  "searchBtn": "Search",                           // ar: "بحث"
  "results": "Results",                            // ar: "النتائج"
  "resultCount": "{{count}} results",              // ar: "{{count}} نتيجة"
  "allStatusesShown": "All statuses appear in results", // ar: "كل الحالات تظهر في النتائج"
  "noResults": "No matches — try part of the name or the employee ID", // ar: "لا نتائج مطابقة — جرّب جزءاً من الاسم أو الرقم الوظيفي"
  "createNew": "+ Create a new employee file",     // ar: "+ إنشاء ملف موظف جديد"
  "newEmployee": "New employee — create file",     // ar: "موظف جديد — إنشاء ملف"
  "recentTitle": "Recently opened files",          // ar: "آخر الملفات المفتوحة"
  "expiryTitle": "Documents expiring soon",        // ar: "وثائق تنتهي قريباً"
  "expiryViewAll": "View all expiring documents",  // ar: "عرض كل الوثائق المنتهية"
  "gapsTitle": "Files with missing data",          // ar: "ملفات ناقصة البيانات"
  "gapsSummary": "Most missing: {{fields}}. Completing them readies forms and letters instantly.", // ar: "أكثر البيانات نقصاً: {{fields}}. إكمالها يجهّز النماذج والمخاطبات مباشرة."
  "gapsCta": "Start completing files",             // ar: "ابدأ إكمال الملفات"
  "miniPlaceholder": "New search — type a name or employee ID…", // ar: "بحث جديد — اكتب الاسم أو الرقم الوظيفي…"
  "fileTitle": "Employee file",                    // ar: "ملف موظف"
  "daysLeft": "{{count}} days"                     // ar: "{{count}} يوماً"
},
// under the existing top-level "employee" object:
"card": {
  "label": "Employee card · GSSG",                 // ar: "بطاقة موظف · GSSG"
  "createDoc": "Create document",                  // ar: "إنشاء مستند"
  "addLeave": "Add leave",                         // ar: "إضافة إجازة"
  "edit": "Edit"                                   // ar: "تعديل"
},
"gaps": {
  "title": "{{count}} missing — completeness {{filled}}/{{tracked}}", // ar: "{{count}} بيانات ناقصة — اكتمال {{filled}}/{{tracked}}"
  "hint": "Completing them lets forms and letters generate without the paper file.", // ar: "إكمالها يجعل النماذج والمخاطبات تُنشأ مباشرةً دون الرجوع للملف الورقي."
  "add": "+ Add",                                  // ar: "+ أضف"
  "addNow": "+ Add now",                           // ar: "+ أضف الآن"
  "fixAll": "Complete the data now",               // ar: "أكمل البيانات الآن"
  "notSet": "Not recorded",                        // ar: "غير مسجّل"
  "notSetF": "Not recorded",                       // ar: "غير مسجّلة"
  "sectionMissing": "{{count}} missing",           // ar: "ناقص {{count}}"
  "sectionComplete": "Complete"                    // ar: "مكتملة"
},
"field": {
  "name_en": "English name",  "name_ar": "Arabic name",  "dob": "Date of birth",
  "nationality": "Nationality", "contact": "Contact number", "msg_language": "Message language",
  "passport_no": "Passport number", "passport_expiry": "Passport expiry",
  "uae_id_no": "Emirates ID", "uae_id_expiry": "Emirates ID expiry", "iban": "IBAN",
  "position": "Position", "department": "Department", "duty_unit": "Unit",
  "duty_post": "Post", "doj": "Date of joining", "doj_company": "Company joining date"
  // ar: الاسم إنجليزي، الاسم عربي، تاريخ الميلاد، الجنسية، رقم التواصل، لغة الرسائل،
  //     رقم الجواز، انتهاء الجواز، الهوية الإماراتية، انتهاء الهوية، الآيبان،
  //     المسمى الوظيفي، القسم، الوحدة، النقطة، تاريخ الالتحاق، الالتحاق بالشركة
},
"section": {
  "personal": "Personal data",      // ar: "البيانات الشخصية"
  "identity": "Identity documents", // ar: "وثائق الهوية"
  "work": "Employment data",        // ar: "بيانات العمل"
  "finance": "Financial data"       // ar: "البيانات المالية"
}
```

- [ ] **Step 1: Add the keys to `en.json` and `ar.json`** (respect existing JSON structure; `employees.lookup` under `employees`, the rest under `employee`).

- [ ] **Step 2: Verify parity + lint**

Run: `pnpm -C frontend run lint && pnpm -C frontend exec tsc -b --noEmit`
Expected: clean. If the repo has an i18n parity test, run it: `pnpm -C frontend exec vitest run src/lib/i18n`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "i18n(employees): lookup page + gaps/field/section keys (en/ar)"
```

---

### Task 5: `EmployeeSearchHero` (State A search band)

**Files:**
- Create: `frontend/src/components/employees/EmployeeSearchHero.tsx`
- Test: `frontend/src/components/employees/EmployeeSearchHero.test.tsx`

**Interfaces:**
- Consumes: `api.listEmployees({q, limit: 30})`, `useQuery`, i18n `employees.lookup.*`, `pickEmployeeName`, `pickPosition`.
- Produces: `<EmployeeSearchHero onSelect={(id: string) => void} onCreate={() => void} onLeaveIds={ReadonlySet<string>} children?>` — renders the navy band, debounced (250 ms) search with dropdown (avatar, name, G-number, position, status pill incl. on-leave tint), no-results create CTA, and the «موظف جديد — إنشاء ملف» ghost button; `children` renders below the search column (the info-cards row from Task 6). Status pill styling copied from the deleted `EmployeeMobileCard` logic (`--success-soft`/`--warning-soft`/`--surface-tinted` pills).

- [ ] **Step 1: Write the failing tests** (React Query wrapper + mocked `api.listEmployees`; follow the mock pattern used by `frontend/src/pages/employees/EmployeeDetailPage.test.tsx`)

```tsx
// frontend/src/components/employees/EmployeeSearchHero.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeSearchHero } from './EmployeeSearchHero'

vi.mock('@/lib/api', async (orig) => ({
  ...(await orig()),
  api: {
    listEmployees: vi.fn().mockResolvedValue({
      items: [
        { id: 'G3190', name_en: 'ABDULLA ALABRI', name_ar: 'عبدالله العبرى', status: 'Active', position: 'Guard' },
      ],
      total: 1,
    }),
  },
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('EmployeeSearchHero', () => {
  it('searches on typing and fires onSelect with the employee id', async () => {
    const onSelect = vi.fn()
    wrap(<EmployeeSearchHero onSelect={onSelect} onCreate={() => {}} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'عبد')
    await waitFor(() => expect(screen.getByText(/G3190/)).toBeInTheDocument())
    await userEvent.click(screen.getByText(/G3190/))
    expect(onSelect).toHaveBeenCalledWith('G3190')
  })

  it('offers create from the empty state', async () => {
    const { api } = await import('@/lib/api')
    vi.mocked(api.listEmployees).mockResolvedValueOnce({ items: [], total: 0 } as never)
    const onCreate = vi.fn()
    wrap(<EmployeeSearchHero onSelect={() => {}} onCreate={onCreate} onLeaveIds={new Set()} />)
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    await userEvent.click(await screen.findByRole('button', { name: /إنشاء ملف موظف جديد|Create a new employee file/ }))
    expect(onCreate).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm -C frontend exec vitest run src/components/employees/EmployeeSearchHero.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement the component**

Structure (translate the prototype markup to Tailwind tokens; key points):

```tsx
// frontend/src/components/employees/EmployeeSearchHero.tsx
/** State-A navy search band for the employee lookup page.
 *  Debounced roster search; every status appears (no gate, no totals). */
export function EmployeeSearchHero({ onSelect, onCreate, onLeaveIds, children }: Props): React.JSX.Element {
  const [q, setQ] = useState('')
  const debounced = useDebouncedValue(q, 250) // add tiny local hook in this file
  const query = useQuery({
    queryKey: ['employee-search', debounced],
    queryFn: () => api.listEmployees({ q: debounced, limit: 30 }),
    enabled: debounced.trim().length > 0,
  })
  // band: relative overflow-visible, inner absolute overflow-hidden layer for the
  // decorative circles (rgba(255,255,255,.045)) so the dropdown is NOT clipped —
  // this exact bug was found in the prototype; keep the two-layer structure.
  // searchbox: h-14 rounded-full bg-white shadow, red rounded-full submit (bg-accent).
  // dropdown: absolute inset-inline-0 top-full+8px rounded-2xl bg-surface border-border,
  //   rows = avatar (photo via /api/v1/employees/{id}/photo when has_photo, else initials),
  //   localized name via pickEmployeeName, mono id, pickPosition, StatusDotPill-style pill
  //   (onLeaveIds.has(id) → warning tint like the old list).
  // input: <input type="search" role="searchbox"> for a11y + tests.
}
```

Follow the visual spec in `docs/employee-page-prototype.html` `heroband`/`searchbox`/`results` CSS block-for-block (paddings, radii, shadows), using tokens (`bg-primary` band uses inline `style={{background:'var(--hero-grad)'}}` like `EmployeeHero.tsx:58`).

- [ ] **Step 4: Run tests** — same command → PASS. Also `pnpm -C frontend exec tsc -b --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employees/EmployeeSearchHero.tsx frontend/src/components/employees/EmployeeSearchHero.test.tsx
git commit -m "feat(employees): search hero band with debounced all-status lookup"
```

---

### Task 6: Hero info cards (recents / expiring / gaps)

**Files:**
- Create: `frontend/src/components/employees/LookupHeroCards.tsx`
- Test: `frontend/src/components/employees/LookupHeroCards.test.tsx`

**Interfaces:**
- Consumes: `getRecentEmployees` (Task 3), `api.listExpiry({within: 90})` — check the exact existing client name in `frontend/src/lib/api.ts` (the `/expiry` GET; if only the page uses raw request, add `listExpiry`/reuse existing), `api.getExpirySummary` if present, `api.getEmployeesCompleteness` (Task 3), i18n `employees.lookup.*`, `employee.field.*`.
- Produces: `<LookupHeroCards onOpen={(id: string) => void} />` — three glass cards per the prototype (`herocards-wrap` grid, `hcard` styling); expiry card links to `/expiry`; gaps CTA calls `onOpen(first_incomplete_id)` when non-null.

- [ ] **Step 1: Write the failing tests** — mock the three data sources; assert: recent chips render names and call `onOpen('G3190')`; expiry card shows count badge and 2 rows; gaps card shows `incomplete` count and top-missing field labels resolved through `employee.field.*` (i.e. the AR/EN label, never the raw key).

```tsx
it('renders gaps card from completeness summary', async () => {
  // mock api.getEmployeesCompleteness → { incomplete: 12, tracked: 14,
  //   top_missing: [{field:'nationality',count:9},{field:'iban',count:7}], first_incomplete_id:'G3190' }
  // assert text ١٢/12 badge and the localized labels for nationality/iban render,
  // click CTA → onOpen('G3190')
})
```

- [ ] **Step 2: Run to verify fail.** `pnpm -C frontend exec vitest run src/components/employees/LookupHeroCards.test.tsx`

- [ ] **Step 3: Implement** — grid `grid-cols-1 md:grid-cols-3 gap-3.5`, cards `bg-white/5 border border-white/15 rounded-2xl p-4`; recents from `getRecentEmployees(3)`; expiry rows sorted by `days_remaining` ascending, top 2, day chip amber (`text-[--warning]`-on-soft); empty states: hide recents card when no recents, expiry/gaps cards render zero-state text.

- [ ] **Step 4: Run tests + typecheck.** PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/employees/LookupHeroCards.tsx frontend/src/components/employees/LookupHeroCards.test.tsx
git commit -m "feat(employees): lookup hero cards — recents, expiring docs, data gaps"
```

---

### Task 7: `EmployeeLookupPage` replaces `EmployeesPage`

**Files:**
- Create: `frontend/src/pages/employees/EmployeeLookupPage.tsx`
- Modify: `frontend/src/App.tsx:15,193` (import + route)
- Delete: `frontend/src/pages/employees/EmployeesPage.tsx`, `frontend/src/components/employees/EmployeeList.tsx` (verify no other imports first: `rg "EmployeeList|EmployeesPage" frontend/src`)
- Test: `frontend/src/pages/employees/EmployeeLookupPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 5–6 components, `EmployeeForm` (create mode, `initialExtraction` prop), `api.createEmployee`, dashboard query for `on_leave_today` (copy from old `EmployeesPage.tsx:121-132`), `useShortcutAction('newItem', …)`.
- Produces: route page at `/employees` with behaviors:
  - select result → `navigate('/employees/' + encodeURIComponent(id))`
  - create button / empty-state CTA → inline `EmployeeForm` card below the band (band stays); success → toast + navigate to new profile (copy mutation from old `EmployeesPage.tsx:148-162`)
  - intake handoff: `location.state.openCreate` + `injectedExtraction` opens the form pre-filled, history state cleared on mount (copy `EmployeesPage.tsx:80-93`)
  - smart-link handoff: consume `localStorage['gssg.employees.openId']` on mount → replace-navigate to profile (copy `EmployeesPage.tsx:96-106`)

- [ ] **Step 1: Write the failing tests** — routing wrapper (`MemoryRouter` with routes for `/employees` and `/employees/:id` stub); assert: selecting a mocked search result navigates to the stub; `openCreate` state renders the (mocked) `EmployeeForm`; smart-link localStorage redirects.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement page; rewire route; delete old files.** Keep the page component thin — state A composition only. Grep before deleting: `EmployeeQuickStats` is deleted in Task 8, not here.

- [ ] **Step 4: Run the full frontend suite** — `pnpm -C frontend test` — fix any test importing the deleted page. `pnpm -C frontend run lint && pnpm -C frontend exec tsc -b --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(employees): search-first lookup page replaces roster list"
```

---

### Task 8: Profile restructure — compact band, sidebar, chip tabs

**Files:**
- Create: `frontend/src/pages/employees/EmployeeIdCard.tsx`
- Create: `frontend/src/pages/employees/EmployeeGapsCard.tsx`
- Create: `frontend/src/pages/employees/EmployeeTabChips.tsx`
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx` (full restructure)
- Delete: `frontend/src/pages/employees/EmployeeHero.tsx` + `EmployeeHero.test.tsx`, `frontend/src/pages/employees/EmployeeQuickStats.tsx`, `frontend/src/pages/employees/EmployeeDetailTabs.tsx`
- Test: modify `frontend/src/pages/employees/EmployeeDetailPage.test.tsx`; create `EmployeeGapsCard.test.tsx`

**Interfaces:**
- Consumes: `EmployeeDetailRead` (now with `missing_fields`, `completeness`), `recordRecentEmployee` (Task 3), `StatusDialog`, `useEmployeePhoto` (photo upload moves onto the ID-card photo tile, same camera-button pattern as `EmployeeHero.tsx:87-110`), `useCapabilities().has('employees.edit')`.
- Produces:
  - `<EmployeeIdCard employee onEdit onAddLeave onGenerate onChangeStatus? />` — navy card per prototype `.idcard` (photo tile 80px rounded-14, bilingual name, mono G-number, facts grid: position/status-pill/department/duty_unit, 3 action buttons).
  - `<EmployeeGapsCard missing={string[]} completeness={{filled,tracked}} onFix={(field?: string) => void} />` — warning-soft checklist; hidden entirely when `missing.length === 0`.
  - `<EmployeeTabChips active counts onChange />` — same `Tab` type + counts contract as the deleted `EmployeeDetailTabs` (`Tab = 'documents'|'profile'|'leaves'|'violations'|'activity'|'messages'`), rendered as pill chips (`rounded-full`, active `bg-primary text-primary-foreground`), order: profile, documents, leaves, messages, activity, violations; profile chip badge shows `missing.length` in warning tint when > 0.
  - `EmployeeDetailPage` layout: compact navy band («ملف موظف» + translucent mini-search input whose `onFocus` navigates to `/employees`); grid `md:grid-cols-[350px_1fr]`, sidebar `md:sticky md:top-5` (ID card + gaps card); main = chips + active tab body. Default tab `'profile'`. Calls `recordRecentEmployee` in an effect when data loads. Edit form renders where it does today (above the layout) — unchanged wiring.

- [ ] **Step 1: Update/write failing tests.** `EmployeeDetailPage.test.tsx`: keep the existing edit-wiring assertion but trigger edit from the ID-card «تعديل» button; add: default tab is profile; mini search navigates to `/employees`; gaps card lists `missing_fields` labels. New `EmployeeGapsCard.test.tsx`: renders count title from completeness, one row per field with localized label, `onFix` fires with the field, renders nothing when no gaps.

- [ ] **Step 2: Run to verify fail.** `pnpm -C frontend exec vitest run src/pages/employees`

- [ ] **Step 3: Implement the three components + page restructure; delete the three old files.** Match prototype CSS: sidebar 350px, card paddings/radii, `bandmini` paddings, chip styles. Mobile (<920px → use `max-md:`/`md:` split at Tailwind `md`): single column, sidebar first, chips row `overflow-x-auto`.

- [ ] **Step 4: Full suite + gates.** `pnpm -C frontend test && pnpm -C frontend run lint && pnpm -C frontend exec tsc -b --noEmit`

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src
git commit -m "feat(employees): profile as file — compact band, ID card + gaps sidebar, chip tabs"
```

---

### Task 9: ProfileTab section cards with missing rows

**Files:**
- Modify: `frontend/src/pages/employees/tabs/ProfileTab.tsx` (replace the flat 9-field grid, lines 46-88; keep Identity documents + SignaturePad sections)
- Test: modify `frontend/src/pages/employees/tabs/ProfileTab.test.tsx`

**Interfaces:**
- Consumes: `employee: EmployeeRead`, new prop `missing: string[]` + `onFix: (field: string) => void` (passed from `EmployeeDetailPage`; `onFix` opens the edit form). i18n `employee.section.*`, `employee.field.*`, `employee.gaps.*`.
- Produces: four `<section>` cards (personal / identity / work / finance) per the spec's field grouping; each header has a pill «ناقص N» (warning) or «مكتملة» (success); missing rows render amber gradient background + «غير مسجّل» + «+ أضف الآن» button calling `onFix(field)`; `uae_id_expiry` within 90 days renders the ⚠ chip with day count.

- [ ] **Step 1: Update tests** — assert: nationality row shows «غير مسجّل»/add button when missing and the value when present; section pill flips between ناقص/مكتملة; expiry chip renders when `uae_id_expiry` ≤ 90 days from now (mock a near date).

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement.** Field rows keep the existing `grid-cols-[140px_1fr]` label/value pattern (`ProfileTab.tsx:66-74`); group into cards `rounded-2xl bg-surface p-4 md:p-6` in a `grid gap-4 md:grid-cols-2`; finance card spans one cell. Dates in `font-mono`.

- [ ] **Step 4: Run suite + gates; verify no `employee.profile.*` keys were orphaned** (grep and clean locales if the old flat labels become unused).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/employees/tabs/ProfileTab.tsx frontend/src/pages/employees/tabs/ProfileTab.test.tsx frontend/src/locales
git commit -m "feat(employees): ProfileTab section cards with actionable missing rows"
```

---

### Task 10: Reviews, build, merge & deploy

**Files:** none new.

- [ ] **Step 1: Run the reviewer agents** — `i18n-rtl-reviewer` on the full diff (`git diff main...HEAD`) and `alembic-migration-reviewer` is N/A (no migrations). Fix any findings.

- [ ] **Step 2: Full gates**

```
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

Expected: all green; build outputs to backend static dir.

- [ ] **Step 3: Manual smoke on the built app** (`scripts\mng.ps1 deploy` on a test box or local uvicorn): search finds a resigned employee; profile default tab is profile; gaps checklist opens edit; mini search returns to big search; intake create handoff still works; Arabic UI shows no English leaks.

- [ ] **Step 4: Merge to main + push + deploy**

```bash
git checkout main && git merge feat/employee-lookup
git push origin main
scripts\mng.ps1 deploy
```

- [ ] **Step 5: Verify live** — `scripts\mng.ps1 status`, open `https://gssg.lan/employees`.
