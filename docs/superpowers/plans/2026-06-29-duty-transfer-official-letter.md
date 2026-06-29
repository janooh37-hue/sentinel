# Duty Transfer — Official Letter & Email Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the duty-transfer document and its cover email reproduce the office's real correspondence (the letter `النقل 1106.pdf` and ledger email id=5) exactly, instead of the current plain output.

**Architecture:** The transfer already mints a **General Book** whose template prints the letterhead, ref number, date, addressee (`recipient_name`), signature (`manager_id`) and CC line (`cc`). We (1) rewrite the server-built body to the formal intro + a red-header 5-column RTL table + closing, (2) thread operator-chosen recipient/manager/CC from a new dialog into the existing General-Book pipeline, and (3) add a dedicated transfer branch to the email-basket builder that emits the narrative cover email.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (backend), React + react-hook-form + TanStack Query + Vitest (frontend), `core/arabic_rtl.html_to_docx` for DOCX rendering.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-duty-transfer-official-letter-design.md`.
- **Live checkout:** this working copy is the production server. Every commit MUST be pushed to `origin/main` immediately or a server pull overwrites it. (memory: live-server-fixes-must-go-to-main)
- **Exact Arabic copy — letter body:**
  - Subject: `النقل`
  - Intro: `يطيب لنا أن نتقدم لسيادتكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المرفق إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .`
  - Closing line 1: `للتفضل بالعلم وأمركم حول تعديل الكشوفات لديكم ولإجراءاتكم لطفاً.`
  - Closing line 2: `هذا وتفضلوا بقبول فائق الإحترام والتقدير.`
- **Exact Arabic copy — email body:**
  - Greeting: `السلام عليكم ورحمة الله وبركاته :`
  - Intro: `يطيب لنا أن نتقدم إليكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المبين مضمون الكتاب الرقم {ref} تاريخ {date} م إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .`
  - Closing line 1: `للتفضل بالعلم ولإجراءاتكم لطفاً.`
  - Closing line 2: `هذا وتفضلوا بقبول فائق الإحترام والتقدير.`
  - Subject: `تنقلات يوم {date}`
- **Table columns (5, no serial column), visual right→left:** `الرقم الوظيفي` (employee.id) · `المسمى الوظيفي` (position_ar) · `الاسم` (name_ar) · `من` (pre-move unit-post) · `إلى` (destination unit-post).
- **Table styling (inline, survives `html_to_docx` + SMTP):** header `background:#C00000;color:#fff;font-weight:bold`, cells `border:1px solid #000000;padding:4px 9px;text-align:center`, `border-collapse:collapse`.
- **Unit-post join:** `unit - post` (space-hyphen-space); unit only when no post; `غير محدد` when both empty.
- **`{date}` format:** `DD/MM/YYYY` from the book's issue date (`BookRead.created_at`).
- **No effective-date and no reason** anywhere in body, dialog, schema, or request.

---

### Task 1: Rewrite the letter body builder (`_build_body_html`)

**Files:**
- Modify: `backend/app/services/duty_service.py` (`_build_body_html`, `_location_label`, `_SUBJECT`)
- Test: `backend/tests/test_duty_transfer_body.py` (create)

**Interfaces:**
- Produces: `_build_body_html(employees: list[Employee], *, to_unit: str, to_post: str | None) -> str` — note the signature **drops** `effective_date` and `reason`. Emits `<p>intro</p>` + styled `<table>` (header row + one `<tr>` per employee) + two closing `<p>` lines.
- Produces: module constant `_SUBJECT = "النقل"`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_duty_transfer_body.py
from app.db.models import Employee
from app.services.duty_service import _build_body_html


def _emp(**kw) -> Employee:
    base = dict(id="G3309", name_ar="ماجد خالد محمد الحوسني", name_en="Majid",
                position_ar="حارس أمن", duty_unit="السرية الخامسة", duty_post="تفتيش")
    base.update(kw)
    return Employee(**base)


def test_body_has_intro_columns_rows_and_closing():
    html = _build_body_html(
        [_emp(), _emp(id="G4017", name_ar="محمد سعيد", duty_unit="السرية الثانية", duty_post="تفتيش")],
        to_unit="السرية الثانية", to_post="ليوان",
    )
    # Fixed intro (no date, no reason)
    assert "يطيب لنا أن نتقدم لسيادتكم بخالص التحية و التقدير" in html
    assert "إعتباراً من تاريخه" in html
    assert "السبب" not in html  # reason never rendered
    # Five headers, no serial column
    for col in ["الرقم الوظيفي", "المسمى الوظيفي", "الاسم", "من", "إلى"]:
        assert f">{col}<" in html
    assert ">م<" not in html
    # Row data: G-number, job title, name, from (pre-move), to
    assert ">G3309<" in html
    assert ">حارس أمن<" in html
    assert "السرية الخامسة - تفتيش" in html      # من
    assert "السرية الثانية - ليوان" in html       # إلى
    # Red header styling + closing
    assert "#C00000" in html
    assert "للتفضل بالعلم وأمركم حول تعديل الكشوفات لديكم ولإجراءاتكم لطفاً." in html
    assert "هذا وتفضلوا بقبول فائق الإحترام والتقدير." in html
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `pytest tests/test_duty_transfer_body.py -v`
Expected: FAIL — current `_build_body_html` requires `effective_date`/`reason` kwargs (TypeError) and lacks the new columns/strings.

- [ ] **Step 3: Implement the new builder**

Replace `_SUBJECT`, `_location_label`, and `_build_body_html` in `backend/app/services/duty_service.py`:

```python
_UNSPECIFIED = "غير محدد"
_SUBJECT = "النقل"

_INTRO = (
    "يطيب لنا أن نتقدم لسيادتكم بخالص التحية و التقدير , يرجى العلم أنه "
    "ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المرفق إلى الجهات "
    "المبينة بجانب أسمائهم إعتباراً من تاريخه ."
)
_CLOSING_1 = "للتفضل بالعلم وأمركم حول تعديل الكشوفات لديكم ولإجراءاتكم لطفاً."
_CLOSING_2 = "هذا وتفضلوا بقبول فائق الإحترام والتقدير."

_COLS = ["الرقم الوظيفي", "المسمى الوظيفي", "الاسم", "من", "إلى"]
_TH = (
    "border:1px solid #000000;background:#C00000;color:#ffffff;"
    "padding:4px 9px;text-align:center;font-weight:bold"
)
_TD = "border:1px solid #000000;padding:4px 9px;text-align:center"


def _location_label(unit: str | None, post: str | None) -> str:
    """``unit - post`` / just the unit / ``غير محدد`` when empty."""
    unit = (unit or "").strip()
    post = (post or "").strip()
    if unit and post:
        return f"{unit} - {post}"
    if unit:
        return unit
    return _UNSPECIFIED


def _employee_display_name(emp: Employee) -> str:
    """Prefer the Arabic name; fall back to English; never blank."""
    return (emp.name_ar or emp.name_en or emp.id or "").strip()


def _build_body_html(
    employees: list[Employee], *, to_unit: str, to_post: str | None
) -> str:
    """Formal intro + a red-header from→to ``<table>`` + the two closing lines.

    The ``من`` column reads each employee's CURRENT unit/post, so callers must
    build the body BEFORE staging the move. No effective date or reason is
    rendered — the letter uses ``إعتباراً من تاريخه`` verbatim (see the spec).
    """
    to_label = _location_label(to_unit, to_post)

    head = "".join(f'<th style="{_TH}">{html.escape(c)}</th>' for c in _COLS)
    rows = [f"<tr>{head}</tr>"]
    for emp in employees:
        cells = [
            html.escape(emp.id),
            html.escape((emp.position_ar or "").strip()),
            html.escape(_employee_display_name(emp)),
            html.escape(_location_label(emp.duty_unit, emp.duty_post)),
            html.escape(to_label),
        ]
        rows.append(
            "<tr>" + "".join(f'<td style="{_TD}">{c}</td>' for c in cells) + "</tr>"
        )
    table = (
        '<table dir="rtl" style="border-collapse:collapse">'
        + "".join(rows)
        + "</table>"
    )

    intro = f"<p>{html.escape(_INTRO)}</p>"
    closing = f"<p>{html.escape(_CLOSING_1)}</p><p>{html.escape(_CLOSING_2)}</p>"
    return intro + table + closing
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `pytest tests/test_duty_transfer_body.py -v`
Expected: PASS

- [ ] **Step 5: Commit and push**

```bash
git add backend/app/services/duty_service.py backend/tests/test_duty_transfer_body.py
git commit -m "feat(duty): formal letter body for transfers (intro + 5-col red table + closing)"
git push origin main
```

---

### Task 2: Thread recipient / manager / CC through the schema, service, and endpoint

**Files:**
- Modify: `backend/app/schemas/duty.py` (`DutyTransferRequest`)
- Modify: `backend/app/services/duty_service.py` (`transfer`)
- Modify: `backend/app/api/v1/duty.py` (endpoint)
- Test: `backend/tests/test_duty_transfer_service.py` (create)

**Interfaces:**
- Consumes: `_build_body_html(employees, *, to_unit, to_post)` (Task 1), `_SUBJECT` (Task 1).
- Produces: `DutyTransferRequest(employee_ids, to_unit, to_post, recipient_id: int | None, manager_id: int | None, cc: list[str] | None)` — **no** `effective_date`/`reason`.
- Produces: `transfer(db, *, employee_ids, to_unit, to_post, recipient_id=None, manager_id=None, cc=None, current_user=None) -> DutyTransferResult` — forwards `recipient_id`, `manager_id`, `cc`, `subject=_SUBJECT`, and the built `body` into `document_service.generate_document`'s `fields`.

- [ ] **Step 1: Update the schema**

In `backend/app/schemas/duty.py`, replace `DutyTransferRequest` (drop the `from datetime import date` import too — no longer used):

```python
from pydantic import BaseModel, Field


class DutyTransferRequest(BaseModel):
    # Bound the id list and free-text fields so one transfer can't generate a
    # runaway DOCX / DB write (API-02).
    employee_ids: list[str] = Field(min_length=1, max_length=500)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)
    # Official-letter metadata — fed into the General Book pipeline.
    recipient_id: int | None = None      # addressee (recipient_name)
    manager_id: int | None = None        # signing manager
    cc: list[str] | None = Field(default=None, max_length=50)  # printed CC names
```

- [ ] **Step 2: Write the failing service test**

```python
# backend/tests/test_duty_transfer_service.py
import types
from app.db.models import Employee
from app.services import duty_service
from app.schemas.duty import DutyTransferRequest


def _seed(db, **kw):
    base = dict(id="G3309", name_en="Majid", name_ar="ماجد", position_ar="حارس أمن",
                duty_unit="السرية الخامسة", duty_post="تفتيش")
    base.update(kw)
    emp = Employee(**base)
    db.add(emp)
    db.commit()
    return emp


def test_transfer_forwards_letter_metadata_and_moves(db_session, monkeypatch):
    _seed(db_session)
    captured = {}

    def fake_generate(db, *, employee_id, template_id, fields, current_user, commit):
        captured["template_id"] = template_id
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=7, ref_number="1/12/GSSG/106", document_id=9)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session,
        employee_ids=["G3309"],
        to_unit="السرية الثانية",
        to_post="ليوان",
        recipient_id=3,
        manager_id=5,
        cc=["مدراء الأفرع"],
    )

    assert captured["template_id"] == "General Book"
    assert captured["fields"]["subject"] == "النقل"
    assert captured["fields"]["recipient_id"] == 3
    assert captured["fields"]["manager_id"] == 5
    assert captured["fields"]["cc"] == ["مدراء الأفرع"]
    # من column captured the PRE-move location
    assert "السرية الخامسة - تفتيش" in captured["fields"]["body"]
    # Employee actually moved
    moved = db_session.get(Employee, "G3309")
    assert moved.duty_unit == "السرية الثانية" and moved.duty_post == "ليوان"
    assert result.book_id == 7 and result.moved == ["G3309"]
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `pytest tests/test_duty_transfer_service.py -v`
Expected: FAIL — `transfer()` doesn't accept `recipient_id`/`manager_id`/`cc` yet and doesn't forward them.

- [ ] **Step 4: Update `transfer()` and the body call**

In `backend/app/services/duty_service.py`, update the signature and the two relevant blocks (remove `from datetime import date` if now unused):

```python
def transfer(
    db: Session,
    *,
    employee_ids: list[str],
    to_unit: str,
    to_post: str | None,
    recipient_id: int | None = None,
    manager_id: int | None = None,
    cc: list[str] | None = None,
    current_user: User | None = None,
) -> DutyTransferResult:
    ...  # keep the existing validation + ordered de-dup load unchanged

    # Build the body from CURRENT (FROM) locations BEFORE mutating.
    body_html = _build_body_html(employees, to_unit=to_unit, to_post=to_post)

    for emp in employees:
        emp.duty_unit = to_unit
        emp.duty_post = to_post

    fields: dict = {"subject": _SUBJECT, "body": body_html}
    if recipient_id is not None:
        fields["recipient_id"] = recipient_id
    if manager_id is not None:
        fields["manager_id"] = manager_id
    if cc:
        fields["cc"] = cc

    result = document_service.generate_document(
        db,
        employee_id=None,
        template_id="General Book",
        fields=fields,
        current_user=current_user,
        commit=True,
    )
    book_id = result.book_id or 0
    return DutyTransferResult(
        book_id=book_id, ref=result.ref_number,
        document_id=result.document_id, moved=[emp.id for emp in employees],
    )
```

- [ ] **Step 5: Update the endpoint**

In `backend/app/api/v1/duty.py`, forward the new fields:

```python
    return duty_service.transfer(
        db,
        employee_ids=payload.employee_ids,
        to_unit=payload.to_unit,
        to_post=payload.to_post,
        recipient_id=payload.recipient_id,
        manager_id=payload.manager_id,
        cc=payload.cc,
        current_user=user,
    )
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `backend/`): `pytest tests/test_duty_transfer_service.py tests/test_duty_transfer_body.py -v`
Expected: PASS

- [ ] **Step 7: Regenerate the OpenAPI schema + commit and push**

Regenerate so the frontend types (Task 3) stay in sync. Run (from `backend/`):
`python -m app.scripts.export_openapi` if it exists, else `python -c "import json,app.main as m; open('openapi.json','w',encoding='utf-8').write(json.dumps(m.app.openapi(), ensure_ascii=False))"`.
(If neither path applies in this repo, skip — Task 3 hand-edits the TS type.)

```bash
git add backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py backend/tests/test_duty_transfer_service.py backend/openapi.json
git commit -m "feat(duty): accept recipient/manager/cc on transfer, subject النقل, drop date/reason"
git push origin main
```

---

### Task 3: Update the frontend request type + builder

**Files:**
- Modify: `frontend/src/lib/api.ts` (the `DutyTransferRequest` type — search for it)
- Modify: `frontend/src/pages/dutyLocations/transferRequest.ts`
- Test: `frontend/src/pages/dutyLocations/transferRequest.test.ts` (create)

**Interfaces:**
- Produces: `DutyTransferRequest` type `{ employee_ids: string[]; to_unit: string; to_post: string | null; recipient_id: number | null; manager_id: number | null; cc: string[] | null }`.
- Produces: `buildTransferRequest({ employeeIds, toUnit, toPost, recipientId, managerId, cc }): DutyTransferRequest`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/pages/dutyLocations/transferRequest.test.ts
import { describe, expect, it } from 'vitest'
import { buildTransferRequest } from './transferRequest'

describe('buildTransferRequest', () => {
  it('builds the new request shape and normalizes empties', () => {
    expect(
      buildTransferRequest({
        employeeIds: ['G1', 'G2'],
        toUnit: '  السرية الثانية  ',
        toPost: '  ',
        recipientId: 3,
        managerId: null,
        cc: ['مدراء الأفرع'],
      }),
    ).toEqual({
      employee_ids: ['G1', 'G2'],
      to_unit: 'السرية الثانية',
      to_post: null,
      recipient_id: 3,
      manager_id: null,
      cc: ['مدراء الأفرع'],
    })
  })

  it('sends null cc when the list is empty', () => {
    const req = buildTransferRequest({
      employeeIds: ['G1'], toUnit: 'X', toPost: 'Y',
      recipientId: null, managerId: null, cc: [],
    })
    expect(req.cc).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/pages/dutyLocations/transferRequest.test.ts`
Expected: FAIL — `buildTransferRequest` has the old signature/shape.

- [ ] **Step 3: Update the type and builder**

In `frontend/src/lib/api.ts`, update the `DutyTransferRequest` interface to:

```ts
export interface DutyTransferRequest {
  employee_ids: string[]
  to_unit: string
  to_post: string | null
  recipient_id: number | null
  manager_id: number | null
  cc: string[] | null
}
```

Replace `frontend/src/pages/dutyLocations/transferRequest.ts`:

```ts
/**
 * Pure builder for the `/duty/transfer` request body, kept in its own module so
 * the TransferDialog component file only exports a component (react-refresh).
 */
import type { DutyTransferRequest } from '@/lib/api'

export function buildTransferRequest(input: {
  employeeIds: readonly string[]
  toUnit: string
  toPost: string
  recipientId: number | null
  managerId: number | null
  cc: readonly string[]
}): DutyTransferRequest {
  return {
    employee_ids: [...input.employeeIds],
    to_unit: input.toUnit.trim(),
    to_post: input.toPost.trim() || null,
    recipient_id: input.recipientId,
    manager_id: input.managerId,
    cc: input.cc.length > 0 ? [...input.cc] : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/pages/dutyLocations/transferRequest.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + commit and push**

Run (from `frontend/`): `npx tsc -b --noEmit` (expect: clean; the dialog in Task 4 still references the old call — if tsc flags `TransferDialog.tsx`, that's expected and fixed in Task 4, so run tsc after Task 4 instead).

```bash
git add frontend/src/lib/api.ts frontend/src/pages/dutyLocations/transferRequest.ts frontend/src/pages/dutyLocations/transferRequest.test.ts
git commit -m "feat(duty): new transfer request shape (recipient/manager/cc, drop date/reason)"
git push origin main
```

---

### Task 4: Transfer dialog — pickers, last-used defaults, drop date/reason

**Files:**
- Create: `frontend/src/pages/dutyLocations/transferDefaults.ts` (localStorage last-used)
- Test: `frontend/src/pages/dutyLocations/transferDefaults.test.ts` (create)
- Modify: `frontend/src/pages/dutyLocations/TransferDialog.tsx`
- Modify: `frontend/src/locales/ar.json`, `frontend/src/locales/en.json` (labels)

**Interfaces:**
- Consumes: `buildTransferRequest` (Task 3), `RecipientPickerField`, `ManagerPickerField`, `MultiRecipientPickerField` from `@/components/application/fields/*` (each requires a react-hook-form `FormProvider` and writes `recipient_id: number|null`, `manager_id: number|null`, `cc: string[]`).
- Produces: `loadTransferDefaults(): { recipientId: number | null; managerId: number | null; cc: string[] }` and `saveTransferDefaults(d): void` (key `gssg.dutyTransfer.defaults`).

- [ ] **Step 1: Write the failing defaults test**

```ts
// frontend/src/pages/dutyLocations/transferDefaults.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { loadTransferDefaults, saveTransferDefaults } from './transferDefaults'

describe('transferDefaults', () => {
  beforeEach(() => localStorage.clear())

  it('returns empty defaults when nothing stored', () => {
    expect(loadTransferDefaults()).toEqual({ recipientId: null, managerId: null, cc: [] })
  })

  it('round-trips saved defaults', () => {
    saveTransferDefaults({ recipientId: 4, managerId: 9, cc: ['مدراء الأفرع'] })
    expect(loadTransferDefaults()).toEqual({ recipientId: 4, managerId: 9, cc: ['مدراء الأفرع'] })
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('gssg.dutyTransfer.defaults', '{not json')
    expect(loadTransferDefaults()).toEqual({ recipientId: null, managerId: null, cc: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/pages/dutyLocations/transferDefaults.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `transferDefaults.ts`**

```ts
/** Persist the last-used recipient / signing-manager / CC for transfers so the
 *  dialog pre-fills them next time. Non-fatal on any storage error. */
export interface TransferDefaults {
  recipientId: number | null
  managerId: number | null
  cc: string[]
}

const KEY = 'gssg.dutyTransfer.defaults'
const EMPTY: TransferDefaults = { recipientId: null, managerId: null, cc: [] }

export function loadTransferDefaults(): TransferDefaults {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    const p = JSON.parse(raw) as Partial<TransferDefaults>
    return {
      recipientId: typeof p.recipientId === 'number' ? p.recipientId : null,
      managerId: typeof p.managerId === 'number' ? p.managerId : null,
      cc: Array.isArray(p.cc) ? p.cc.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveTransferDefaults(d: TransferDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d))
  } catch {
    /* quota / private mode — non-fatal */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/pages/dutyLocations/transferDefaults.test.ts`
Expected: PASS

- [ ] **Step 5: Rewire `TransferDialog.tsx`**

Wrap the form in react-hook-form so the existing pickers work, remove the effective-date and reason inputs, add the three picker fields, and persist defaults on success. Key changes:

- Add imports:
```tsx
import { FormProvider, useForm } from 'react-hook-form'
import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { MultiRecipientPickerField } from '@/components/application/fields/MultiRecipientPickerField'
import { loadTransferDefaults, saveTransferDefaults } from './transferDefaults'
```
- Remove the `effectiveDate`, `reason`, and `todayIso` state/helper. Keep `toUnit`/`toPost` state.
- Create the form, seeding from last-used defaults (map the `transferDefaults`
  keys to the form's `recipient_id`/`manager_id`/`cc` field names):
```tsx
const initial = loadTransferDefaults()
const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
  defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
})
```
- Mutation body now reads the form values:
```tsx
mutationFn: () => {
  const v = methods.getValues()
  return api.transferDuty(
    buildTransferRequest({
      employeeIds, toUnit, toPost,
      recipientId: v.recipient_id ?? null,
      managerId: v.manager_id ?? null,
      cc: v.cc ?? [],
    }),
  )
},
onSuccess: (result) => {
  const v = methods.getValues()
  saveTransferDefaults({ recipientId: v.recipient_id ?? null, managerId: v.manager_id ?? null, cc: v.cc ?? [] })
  // ...existing invalidate + toast + onTransferred + close
},
```
- In the destination column JSX, **delete** the effective-date and reason `<div>` blocks and add, inside a `<FormProvider {...methods}>` wrapping the destination form:
```tsx
<RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
<ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
<MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
```
(Place the `<FormProvider>` so it wraps at least the three fields; wrapping the whole `DialogContent` body is fine.)

- [ ] **Step 6: Typecheck + lint the whole frontend**

Run (from `frontend/`): `npx tsc -b --noEmit && npx eslint src/pages/dutyLocations`
Expected: clean. Fix any type/lint errors (e.g. unused imports, the removed `todayIso`).

- [ ] **Step 7: Run the full frontend test suite**

Run (from `frontend/`): `npm run test`
Expected: PASS (transferRequest + transferDefaults green).

- [ ] **Step 8: Commit and push**

```bash
git add frontend/src/pages/dutyLocations/ frontend/src/locales/ar.json frontend/src/locales/en.json
git commit -m "feat(duty): transfer dialog adds recipient/manager/cc pickers, drops date+reason"
git push origin main
```

---

### Task 5: Dedicated transfer cover-email builder

**Files:**
- Modify: `frontend/src/lib/emailBasket.ts` (`EmailBasketItem` — add `bookDate?`)
- Modify: `frontend/src/pages/books/recordsBasket.ts` (`deriveRecordItem` — populate `bookDate`)
- Modify: `frontend/src/lib/basketEmail.ts` (`buildBasketSubject`, `buildBasketBodyHtml`)
- Test: `frontend/src/lib/basketEmail.transfer.test.ts` (create)

**Interfaces:**
- Consumes: `EmailBasketItem` with `formKind`, `ref`, `detail` (= book subject), and new `bookDate?: string` (ISO).
- Produces: a transfer branch in `buildBasketBodyHtml` keyed on `formKind === 'General Book' && detail === 'النقل'`, and a matching `buildBasketSubject` returning `تنقلات يوم {DD/MM/YYYY}`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/basketEmail.transfer.test.ts
import { describe, expect, it } from 'vitest'
import { buildBasketBodyHtml, buildBasketSubject } from './basketEmail'
import type { EmailBasketItem } from './emailBasket'

const transferItem = (over: Partial<EmailBasketItem> = {}): EmailBasketItem => ({
  bookId: 1, docId: 2, ref: '1/ 12 /GSSG/ 106', employeeId: '', nameEn: '', nameAr: null,
  formKind: 'General Book', detail: 'النقل', bookDate: '2026-06-11', ...over,
})

describe('transfer cover email', () => {
  it('subject is تنقلات يوم {date} (zero-padded)', () => {
    expect(buildBasketSubject([transferItem()])).toBe('تنقلات يوم 11/06/2026')
  })

  it('body is the narrative cover email citing ref + date, no table', () => {
    const html = buildBasketBodyHtml([transferItem()])
    expect(html).toContain('السلام عليكم ورحمة الله وبركاته :')
    expect(html).toContain('نتقدم إليكم بخالص التحية و التقدير')
    expect(html).toContain('مضمون الكتاب الرقم 1/ 12 /GSSG/ 106 تاريخ 11/06/2026 م')
    expect(html).toContain('للتفضل بالعلم ولإجراءاتكم لطفاً.')
    expect(html).toContain('هذا وتفضلوا بقبول فائق الإحترام والتقدير.')
    expect(html).not.toContain('<table')   // no inline table
  })

  it('a non-transfer General Book still uses the generic branch', () => {
    const html = buildBasketBodyHtml([transferItem({ detail: 'كتاب عام آخر' })])
    expect(html).toContain('البيان')        // generic table column
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/basketEmail.transfer.test.ts`
Expected: FAIL — no transfer branch; subject falls through to `fk || 'مستندات'`.

- [ ] **Step 3: Add `bookDate` to the basket item**

In `frontend/src/lib/emailBasket.ts`, add to the `EmailBasketItem` interface:

```ts
  bookDate?: string // ISO issue date (book.created_at) — transfer cover-email date
```

In `frontend/src/pages/books/recordsBasket.ts`, in the returned object of `deriveRecordItem`, add:

```ts
    bookDate: typeof book.created_at === 'string' ? book.created_at.slice(0, 10) : undefined,
```
(The `book` param type already includes `BookRead`; ensure `created_at` is in the `Pick<...>` of `RecordDetailInput.book` — extend it to `'id' | 'ref_number' | 'subject' | 'employee_id' | 'created_at'`, and pass `book` from the list which carries `created_at`.)

- [ ] **Step 4: Add the transfer branch to `basketEmail.ts`**

Near the top constants, add:

```ts
const TRANSFER_SUBJECT = 'النقل' // General Book subject minted by /duty/transfer

/** ISO → DD/MM/YYYY, ZERO-PADDED (the office writes transfers as 11/06/2026).
 *  Note: the shared `dmy()` strips leading zeros, so it must NOT be used here. */
function dmyPad(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function transferEmailBody(item: EmailBasketItem): string {
  const date = dmyPad(item.bookDate ?? '')
  const ref = esc(item.ref)
  const intro =
    'يطيب لنا أن نتقدم إليكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل ' +
    `تم نقل المذكورين بالجدول المبين مضمون الكتاب الرقم ${ref} تاريخ ${esc(date)} م ` +
    'إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .'
  return (
    p('السلام عليكم ورحمة الله وبركاته :') +
    p(intro) +
    buildClosing(['للتفضل بالعلم ولإجراءاتكم لطفاً.', 'هذا وتفضلوا بقبول فائق الإحترام والتقدير.'])
  )
}

function isTransfer(item: EmailBasketItem): boolean {
  return item.formKind === 'General Book' && item.detail === TRANSFER_SUBJECT
}
```

In `buildBasketSubject`, before the `const fk = ...` fallback section, add:

```ts
  if (isTransfer(items[0])) return `تنقلات يوم ${dmyPad(items[0].bookDate ?? '')}`
```

In `buildBasketBodyHtml`, add the branch as the FIRST check (before the `leaveType === 'Sick'` chain), and return it directly (it carries its own closing, so do not append `STANDARD_CLOSING`):

```ts
  if (isTransfer(items[0])) return transferEmailBody(items[0])
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/lib/basketEmail.transfer.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + full suite**

Run (from `frontend/`): `npx tsc -b --noEmit && npm run test`
Expected: clean + all green.

- [ ] **Step 7: Commit and push**

```bash
git add frontend/src/lib/emailBasket.ts frontend/src/pages/books/recordsBasket.ts frontend/src/lib/basketEmail.ts frontend/src/lib/basketEmail.transfer.test.ts
git commit -m "feat(duty): dedicated transfer cover-email (narrative, cites book ref+date)"
git push origin main
```

---

### Task 6: End-to-end manual verification

**Files:** none (manual).

- [ ] **Step 1: Build the frontend**

Run (from `frontend/`): `npm run build`
Expected: clean build.

- [ ] **Step 2: Deploy/restart per the project flow**

Use the project's deploy path (memory: deploy-and-mng-cli — `scripts\mng.ps1 update`/`deploy`). Confirm the service restarts cleanly.

- [ ] **Step 3: Run a transfer and compare the document**

In the app: select employees → Transfer → pick destination unit/post, recipient, signing manager, CC → generate. Open the generated book (`/books/:id`) and compare against `C:\Users\Admin\Desktop\النقل 1106.pdf`:
- addressee, subject `النقل`, intro wording,
- red-header table with `الرقم الوظيفي · المسمى الوظيفي · الاسم · من · إلى` and correct from/to,
- the two closing lines, signature block, and CC line.

- [ ] **Step 4: Compose the email and compare**

Add the transfer book to the basket → compose. Confirm subject `تنقلات يوم …`, the greeting + narrative citing the book ref/date, the shorter closing, no inline table, and the book PDF attached. Compare against ledger entry id=5.

- [ ] **Step 5: Final confirmation**

Confirm `git status` is clean and `origin/main` is up to date (`git log origin/main -1`).

---

## Notes for the implementer

- The General Book pipeline already resolves `recipient_id` → `recipient_name` (`document_service.py:1097`) and the General Book adapter joins `cc` names into `{{ cc }}` and applies `manager_id`. Passing them in `fields` is all that's required — no new adapter code.
- `html_to_docx` honours `<th>` and inline `background`/`border` (`core/arabic_rtl.py`), so the same inline-styled table renders correctly in the DOCX/PDF.
- Baskets are keyed per kind; all `General Book` items share one basket and `buildBasketBodyHtml` keys off `items[0]`. Mixing a transfer book with a non-transfer General Book in one basket is a pre-existing limitation, out of scope here.
