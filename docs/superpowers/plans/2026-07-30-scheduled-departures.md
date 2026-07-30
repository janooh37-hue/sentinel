# Scheduled Departures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator set a resignation date independent of the paper's creation date, and have a future-dated resignation or termination keep the employee Active through their notice period before flipping their status automatically on the day, with reminders in three places.

**Architecture:** The Resignation Letter's body date stops deriving from `today` and reads a new `resignation_date` form field. On the employee record, the previously-unused `status='Active' AND end_date IS NOT NULL` state becomes "pending departure", qualified by one new column `pending_status` holding the status the employee will become. Two writers set it (letter creation, `update_employee`); one daily scheduler job applies it; three read surfaces show it.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic on SQLite (Python 3.12), APScheduler, React 19 + Vite + TypeScript, React Query, react-hook-form + Zod, Tailwind 4, vitest + pytest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-30-scheduled-departures-design.md`. Read it before Task 1.
- **This checkout is the live production build.** Work on a branch; every commit must eventually reach `origin/main` or `mng update` overwrites it.
- **Never touch employee-facing messaging.** `services/sms_templates.py`, `services/notify_format.py`, and `notify_dispatch` outbound paths are out of scope. No SMS, WhatsApp, or push is sent to any employee by this feature. The flip notification goes to **admins only**, via `push_service.send_to_user`.
- **`sms_templates._resignation`** keeps reading the letter's creation date. Do not repoint it at `resignation_date`.
- **Canonical status values are English-only in the DB:** `"Active"`, `"Resigned"`, `"Terminated"` (`app/schemas/employee.py:27-36`). Arabic labels come from i18n. The Arabic for `Terminated` is **`مفصول`** and for `Resigned` is **`مستقيل`** — use the existing `employees.status.*` keys, never invent new wording.
- **Bilingual parity is the project's #1 recurring defect.** Every new user-visible string lands in BOTH `frontend/src/locales/en.json` and `ar.json`. Tests assert the **Arabic** string under `lng=ar` — an English-only assertion cannot catch an AR leak when the EN label equals the key.
- **Logical CSS only:** `ms-`/`me-`, `text-start`/`text-end`. Never `ml-`/`mr-`/`left`/`right`.
- **Strict gates are real:** `mypy` is `strict`, `pytest` runs with `filterwarnings=error`. Both must pass.
- **All Python runs through the repo venv:** `venv\Scripts\python.exe`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`, `venv\Scripts\alembic.exe`. Frontend uses `pnpm -C frontend`.
- **Migrations keep a single linear head.** Hand-numbered `NNNN_<slug>`. Verify with `venv\Scripts\alembic.exe heads` before and after.
- **"Today" convention:** service functions that need the current date take `today: date | None = None` and default to `date.today()`, matching `notify_dispatch.send_ending_reminders` (`notify_dispatch.py:390,402`). This makes them testable without freezing the clock.
- **Do not commit `backend/templates/*.docx` churn.** The live service and Word re-save these during operation. `git checkout -- backend/templates/` any unintended change before committing. This feature changes NO .docx file.

---

## File Structure

**Backend**

| File | Responsibility | Task |
|---|---|---|
| `backend/templates/_fields.json` | Declares the new `resignation_date` form field | 1 |
| `backend/app/core/docx_engine.py` | `_adapt_resignation_letter` splits `resignation_date` instead of `today` | 1 |
| `backend/app/db/migrations/versions/0065_employee_pending_status.py` | Adds the column | 3 |
| `backend/app/db/models.py` | `Employee.pending_status` | 3 |
| `backend/app/schemas/employee.py` | `pending_status` on `EmployeeRead` **and** `end_date` + `pending_status` on `EmployeeListItem` (both read-only) | 3 |
| `backend/app/services/employee_service.py` | Schedule-vs-immediate rule; `apply_due_departures`; `pending` list filter | 4, 6, 7 |
| `backend/app/services/document_service.py` | Letter creation records the pending departure | 5 |
| `backend/app/services/scheduler_service.py` | Daily job wrapper + admin notification | 6 |
| `backend/app/api/v1/employees.py` | `pending` query param | 7 |

**Frontend**

| File | Responsibility | Task |
|---|---|---|
| `frontend/src/pages/application/ApplicationPage.tsx` | Prefills `resignation_date` to today | 2 |
| `frontend/src/lib/api.ts` | `ListEmployeesParams.pending` | 7 |
| `frontend/src/components/employees/PendingDepartureBadge.tsx` | The "Resigned — effective 15/08" chip | 9 |
| `frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.tsx` | The dashboard list + Cancel | 10 |
| `frontend/src/lib/dashboardLayout.ts` | Registers the `pending_departures` widget id | 10 |
| `frontend/src/pages/dashboard/DashboardPage.tsx` | Renders it in the widget switch | 10 |
| `backend/app/schemas/settings.py` | Backend mirror of the widget id | 10 |
| `frontend/src/locales/{en,ar}.json` | Every new string, both languages | 1, 9, 10 |

**Generated — never hand-edited**

`backend/openapi.json` + `frontend/src/lib/api.types.ts` (Task 8).

---

### Task 1: Resignation date on the letter

The body cell of `GSSG-HR_301-010` reads `أتقدم لسيادتكم بطلب إستقالة عن العمل بتاريخ {{ day }} / {{ month }} / {{ year }}`. Today those three tokens are split out of `today`, so the resignation date is always the creation date. After this task they follow an operator-set field, and `today` (the header `التاريخ` and the signature-block `التاريخ`) is left alone.

**Files:**
- Modify: `backend/templates/_fields.json` — the `"Resignation Letter"` entry's `fields` array
- Modify: `backend/app/core/docx_engine.py:147-161` (`_adapt_resignation_letter`) and `:213-223` (`_adapt_resignation_declaration`)
- Test: `backend/tests/test_docx_engine_resignation.py` (create)

**Interfaces:**
- Consumes: `app.core.dateutils.excel_date_to_datetime(value: object) -> datetime | None` — already parses `%d/%m/%Y`, `%Y-%m-%d`, and `%Y-%m-%d %H:%M:%S`, returns `None` on blank/garbage (`core/dateutils.py:25`). Reused instead of writing a new parser.
- Produces: the template context keys `day`, `month`, `year` (each `str`, zero-padded) now derived from `resignation_date`; `today` unchanged. Task 2 consumes the form-field key `resignation_date`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_docx_engine_resignation.py`:

```python
"""Resignation Letter / Declaration date adaptation.

The letter carries three date slots. `today` feeds the header and the
signature block (both the paper's creation date); only the body line
"بطلب إستقالة عن العمل بتاريخ __/__/__" follows the operator's
`resignation_date`.
"""

from app.core.docx_engine import _adapt_resignation_declaration, _adapt_resignation_letter


def test_body_date_follows_resignation_date_iso():
    """The date input sends ISO; the body cell must show that date."""
    out = _adapt_resignation_letter(
        {"today": "30/07/2026", "resignation_date": "2026-08-15"}
    )
    assert (out["day"], out["month"], out["year"]) == ("15", "08", "2026")


def test_body_date_accepts_dd_mm_yyyy():
    """Legacy/template-shaped input still parses."""
    out = _adapt_resignation_letter(
        {"today": "30/07/2026", "resignation_date": "15/08/2026"}
    )
    assert (out["day"], out["month"], out["year"]) == ("15", "08", "2026")


def test_today_is_not_shifted_by_the_resignation_date():
    """The header and signature dates stay on the creation day."""
    out = _adapt_resignation_letter(
        {"today": "30/07/2026", "resignation_date": "2026-08-15"}
    )
    assert out["today"] == "30/07/2026"


def test_missing_resignation_date_falls_back_to_today():
    """The 5 pre-existing records, previews, and re-renders on sign have no
    `resignation_date` — they must keep rendering the creation date."""
    out = _adapt_resignation_letter({"today": "30/07/2026"})
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_unparseable_resignation_date_falls_back_to_today():
    out = _adapt_resignation_letter(
        {"today": "30/07/2026", "resignation_date": "not a date"}
    )
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_blank_resignation_date_falls_back_to_today():
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": ""})
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_reason_still_routes_from_purpose_plain():
    """Regression guard — this task must not disturb the reason routing."""
    out = _adapt_resignation_letter(
        {"today": "30/07/2026", "purpose_plain": "  relocating  "}
    )
    assert out["reason"] == "relocating"


def test_declaration_still_gets_arabic_weekday():
    """The companion Declaration has no resignation date — only weekday + today."""
    out = _adapt_resignation_declaration({"today": "30/07/2026"})
    assert out["today"] == "30/07/2026"
    assert out["weekday_ar"] == "الخميس"  # 30 July 2026 is a Thursday
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_engine_resignation.py -v`

Expected: the ISO and `dd/mm/yyyy` body-date tests FAIL (`day` is `"30"`, not `"15"`, because the adapter still splits `today`). The fallback, `reason`, and declaration tests should already PASS — they encode existing behaviour and are regression guards.

- [ ] **Step 3: Add the field to the form schema**

In `backend/templates/_fields.json`, in the `"Resignation Letter"` object, insert this as the **first** entry of its `fields` array, before the existing `"reason"` field:

```json
    {
      "key": "resignation_date",
      "type": "date",
      "label_en": "Resignation Date",
      "label_ar": "تاريخ الاستقالة",
      "required": true
    },
```

No frontend work is needed to render it: `type: "date"` already maps to `DateField` (`components/application/TemplateForm.tsx:145`) and to an ISO-date Zod rule (`lib/applicationFormSchema.ts:52`). Fourteen fields on other forms already use this type.

Keep the file valid UTF-8 JSON with the existing 2-space indentation. Verify:

```bash
venv\Scripts\python.exe -c "import json;d=json.load(open('backend/templates/_fields.json',encoding='utf-8'));print([f['key'] for f in d['Resignation Letter']['fields']])"
```

Expected output: `['resignation_date', 'reason', 'hand_sign_employee', 'employee_sig_path']`

- [ ] **Step 4: Point the adapter at the new field**

In `backend/app/core/docx_engine.py`, add the import near the other `app.core` imports at the top of the file:

```python
from app.core.dateutils import excel_date_to_datetime
```

Replace `_adapt_resignation_letter` (currently lines 147-161) with:

```python
def _adapt_resignation_letter(data: dict[str, Any]) -> dict[str, Any]:
    """Split the operator's resignation date into the body cell's three slots.

    The paper has three date positions. `today` feeds the header `التاريخ` and
    the signature-block `التاريخ` — both the day the paper was made, and both
    left alone here. Only the body line
    "أتقدم لسيادتكم بطلب إستقالة عن العمل بتاريخ __/__/__" follows the
    operator's `resignation_date`, so an employee can hand in notice today for a
    departure next month.

    Falls back to `today` when `resignation_date` is absent or unparseable: the
    records created before the field existed, the preview path, and the
    re-render on sign all reach here without it.

    Also routes purpose_plain → reason.
    """
    out = _adapt_common(data)
    today_str = out.get("today") or datetime.now().strftime(_TODAY_FMT)
    out["today"] = today_str
    dt = (
        excel_date_to_datetime(out.get("resignation_date"))
        or excel_date_to_datetime(today_str)
        or datetime.now()
    )
    out["day"] = dt.strftime("%d")
    out["month"] = dt.strftime("%m")
    out["year"] = dt.strftime("%Y")
    out["reason"] = (out.get("purpose_plain") or out.get("reason") or "").strip()
    return out
```

Replace `_adapt_resignation_declaration` (currently lines 213-223) with the same helper, deleting the duplicated try/except:

```python
def _adapt_resignation_declaration(data: dict[str, Any]) -> dict[str, Any]:
    """Use Arabic weekday + date for the header row."""
    out = _adapt_common(data)
    today_str = out.get("today") or datetime.now().strftime(_TODAY_FMT)
    out["today"] = today_str
    dt = excel_date_to_datetime(today_str) or datetime.now()
    out["weekday_ar"] = ARABIC_WEEKDAYS[dt.weekday()]
    return out
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_docx_engine_resignation.py -v`
Expected: all 8 PASS.

- [ ] **Step 6: Run the wider suites this touches**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_templates_catalog.py -v
venv\Scripts\ruff.exe check backend/app/core/docx_engine.py
venv\Scripts\ruff.exe format --check backend/app/core/docx_engine.py
venv\Scripts\mypy.exe
```

Expected: all PASS. `test_templates_catalog.py` validates `_fields.json` against the templates — if it asserts a field count or an exact field list for Resignation Letter, update that assertion to include `resignation_date` and say so in the commit message.

- [ ] **Step 7: Confirm no template churn, then commit**

```bash
git status --short backend/templates/
```

Expected: only `_fields.json` modified. If any `.docx` appears, run `git checkout -- backend/templates/*.docx` first — the live service re-saves those during operation and committing that churn can break Jinja tokens.

```bash
git add backend/templates/_fields.json backend/app/core/docx_engine.py backend/tests/test_docx_engine_resignation.py
git commit -m "feat(resignation): body date follows an operator-set resignation_date

The 301-010 body cell split its day/month/year out of `today`, so the
resignation date was always the paper's creation date and the operator had to
download the DOCX, edit it in Word, and re-upload. It now reads a
`resignation_date` form field and falls back to `today` for records created
before the field existed. Header and signature dates are unchanged."
```

---

### Task 2: Prefill the resignation date to today

An untouched form must produce byte-identical output to today's behaviour, so the input starts on today's date rather than blank.

**Files:**
- Modify: `frontend/src/pages/application/ApplicationPage.tsx:622-655` (the `schemaReady` effect)
- Test: `frontend/src/pages/application/ApplicationPage.resignationDate.test.tsx` (create)

**Interfaces:**
- Consumes: the `resignation_date` field key from Task 1; the existing `schemaReady` boolean (`ApplicationPage.tsx:619`) and `loadDraft(selectedTemplate)` restore path.
- Produces: nothing consumed downstream.

**Critical ordering constraint.** The seed must run *after* the draft/revise restore inside the same effect, and must only write when the current value is empty. This codebase has already shipped a bug of exactly this shape — a stale saved draft overriding a default-on toggle. Seeding before the restore, or seeding unconditionally, reintroduces it: the operator's saved date would be silently replaced with today's.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/application/ApplicationPage.resignationDate.test.tsx`:

```tsx
/**
 * The resignation-date input starts on today's date so an untouched form
 * renders exactly what it rendered before the field existed — but a restored
 * draft's own date always wins.
 */
import { describe, expect, it } from 'vitest'

import { seedResignationDate } from './resignationDate'

describe('seedResignationDate', () => {
  it('returns today when the form has no value yet', () => {
    expect(seedResignationDate(undefined, '2026-07-30')).toBe('2026-07-30')
    expect(seedResignationDate('', '2026-07-30')).toBe('2026-07-30')
  })

  it('leaves a restored draft value alone', () => {
    expect(seedResignationDate('2026-08-15', '2026-07-30')).toBeNull()
  })

  it('leaves a whitespace-only value alone rather than treating it as empty', () => {
    // A blank-but-present value is still the operator's state; only truly
    // absent values get seeded.
    expect(seedResignationDate('   ', '2026-07-30')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/application/ApplicationPage.resignationDate.test.tsx`
Expected: FAIL — `Failed to resolve import "./resignationDate"`.

- [ ] **Step 3: Write the helper**

Create `frontend/src/pages/application/resignationDate.ts`:

```ts
/**
 * Seed rule for the Resignation Letter's date input.
 *
 * Returns the value to write, or `null` to leave the form as-is. Only a truly
 * absent value is seeded: a restored draft or a revise snapshot is the
 * operator's own state and must never be overwritten by today's date.
 */
export function seedResignationDate(
  current: unknown,
  todayIso: string,
): string | null {
  if (current === undefined || current === null || current === '') return todayIso
  return null
}

/** Today as `YYYY-MM-DD` in the browser's local timezone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
```

Note: `todayIso` builds the string from local date parts rather than `toISOString().slice(0, 10)`, which would return the **UTC** date and show yesterday for the Asia/Dubai evening.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/application/ApplicationPage.resignationDate.test.tsx`
Expected: 3 PASS.

- [ ] **Step 5: Wire it into the page**

In `frontend/src/pages/application/ApplicationPage.tsx`, add the import beside the other local imports:

```ts
import { seedResignationDate, todayIso } from './resignationDate'
```

In the `schemaReady` effect (currently ending at line 655), add the seed **after** the revise-snapshot branch and after the `loadDraft` restore, immediately before the `const slots = ...` line:

```ts
    // Prefill the Resignation Letter's date to today, so an untouched form
    // renders what it rendered before the field existed. Runs AFTER the draft /
    // revise restore and only when the value is absent — seeding earlier or
    // unconditionally would overwrite the operator's saved date.
    if (schemaQuery.data?.fields?.some((f) => f.key === 'resignation_date')) {
      const seed = seedResignationDate(form.getValues('resignation_date'), todayIso())
      if (seed !== null) form.setValue('resignation_date', seed)
    }
```

Note the revise branch `return`s early (line 633), so a revise snapshot is never touched by this.

- [ ] **Step 6: Verify the page still typechecks and its tests pass**

```bash
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend exec vitest run src/pages/application
pnpm -C frontend run lint
```

Expected: all PASS. If `schemaQuery.data.fields` is typed such that `f.key` needs a narrowing, use the field type already imported in the file rather than `any` — `mypy`'s frontend equivalent here is `tsc`, and `any` will fail lint.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/application/resignationDate.ts frontend/src/pages/application/ApplicationPage.resignationDate.test.tsx frontend/src/pages/application/ApplicationPage.tsx
git commit -m "feat(resignation): prefill the resignation-date input to today

Keeps an untouched form byte-identical to the previous behaviour. Seeds only
when the value is absent and only after the draft/revise restore, so a saved
draft's date is never overwritten."
```

---

### Task 3: `pending_status` column

**Files:**
- Create: `backend/app/db/migrations/versions/0065_employee_pending_status.py`
- Modify: `backend/app/db/models.py:67` (after `end_date`)
- Modify: `backend/app/schemas/employee.py` (`EmployeeRead`)
- Test: `backend/tests/test_employee_pending_departure.py` (create — grows in Tasks 4, 6, 7)

**Interfaces:**
- Produces: `Employee.pending_status: Mapped[str | None]` and `EmployeeRead.pending_status: EmployeeStatus | None`. Tasks 4-7 and 9-10 consume both.

- [ ] **Step 1: Confirm the current head is `0064`**

Run: `venv\Scripts\alembic.exe heads`
Expected: exactly one head, `0064`. If more than one line appears, stop — a split head must be resolved before adding a revision.

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_employee_pending_departure.py`:

```python
"""Scheduled departures — a future-dated resignation or termination keeps the
employee Active through their notice period, then flips on the day.

Pending departure ⇔ status == 'Active' AND pending_status IS NOT NULL AND
end_date IS NOT NULL. `status` deliberately stays 'Active' while pending so
every active-roster query keeps treating the person as the working employee
they still are.
"""

from datetime import date

from app.db.models import Employee


def test_pending_status_defaults_to_none(db_session):
    row = Employee(id="G9101", name_en="Pending Default", status="Active")
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status is None


def test_pending_status_round_trips(db_session):
    row = Employee(
        id="G9102",
        name_en="Pending Resigned",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    assert row.pending_status == "Resigned"
    assert row.status == "Active"
    assert row.end_date == date(2026, 8, 15)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v`
Expected: FAIL — `TypeError: 'pending_status' is an invalid keyword argument for Employee`.

- [ ] **Step 4: Add the column to the model**

In `backend/app/db/models.py`, insert immediately after the `end_date` line (line 67):

```python
    # Scheduled departure — the status this employee flips to on `end_date`,
    # while `status` stays 'Active' through the notice period. NULL means no
    # pending departure. Only ever 'Resigned' or 'Terminated': written by the
    # Resignation Letter and by update_employee, cleared on flip or cancel.
    pending_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

- [ ] **Step 5: Write the migration**

Create `backend/app/db/migrations/versions/0065_employee_pending_status.py`:

```python
"""employees: pending_status for scheduled departures

Revision ID: 0065
Revises: 0064
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0065"
down_revision: str | Sequence[str] | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("pending_status", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "pending_status")
```

`op.add_column` is safe on SQLite without `batch_alter_table` — `0064` adds columns the same way. The column is nullable, so no `server_default` is required.

- [ ] **Step 6: Apply the migration and verify it round-trips**

```bash
venv\Scripts\alembic.exe upgrade head
venv\Scripts\alembic.exe heads
venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v
```

Expected: upgrade succeeds, `heads` prints exactly one head (`0065`), both tests PASS.

Then prove `downgrade` works on a populated copy rather than the live DB:

```bash
venv\Scripts\python.exe -c "import shutil;shutil.copy('data/gssg.db','data/gssg.pending-test.db')"
```

Point `alembic` at the copy per this repo's env config, run `downgrade -1` then `upgrade head`, confirm no error, then delete the copy. If the alembic env does not accept a DB override, note that in the commit message and verify the downgrade on a fresh empty DB instead — do **not** downgrade the live `data/gssg.db`.

- [ ] **Step 7: Expose it on BOTH read schemas**

In `backend/app/schemas/employee.py`, in `EmployeeRead`, add immediately after the `end_date: date | None` line (line 126):

```python
    # Where a scheduled departure is headed, while `status` is still 'Active'.
    # None = no pending departure. Read-only: EmployeeUpdate deliberately has no
    # counterpart, because cancelling rides the existing
    # `{status: 'Active', end_date: null}` patch (see update_employee).
    pending_status: EmployeeStatus | None = None
```

Then — **this is easy to miss** — the list endpoint returns `EmployeeListResponse.items: list[EmployeeListItem]` (line 172-173), a deliberately minimal projection that carries **neither `end_date` nor `pending_status`**. Both the Task 10 widget and the Task 9 search-row badge read from that endpoint, so both fields must be added to `EmployeeListItem` (line 154-169) or those surfaces have nothing to render:

```python
    # Scheduled departure — the widget and the search-row badge both need the
    # target and the date, so this minimal projection carries both.
    end_date: date | None = None
    pending_status: EmployeeStatus | None = None
```

Do **not** add either field to `EmployeeCreate` or `EmployeeUpdate`.

- [ ] **Step 7b: Prove the list projection carries them**

Add to `backend/tests/test_employee_pending_departure.py`:

```python
def test_list_item_projection_exposes_the_pending_fields(db_session):
    """The widget and search badge read the LIST endpoint, not the detail one."""
    from app.schemas.employee import EmployeeListItem

    row = Employee(
        id="G9103",
        name_en="Pending Projection",
        status="Active",
        end_date=date(2026, 8, 15),
        pending_status="Resigned",
    )
    db_session.add(row)
    db_session.commit()
    item = EmployeeListItem.model_validate(row)
    assert item.pending_status == "Resigned"
    assert item.end_date == date(2026, 8, 15)
```

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v` — expected PASS after Step 7.

- [ ] **Step 8: Run the gates and commit**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py backend/tests/test_employee_completeness.py -v
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: all PASS. `employee_completeness.py` does not read `end_date` or `pending_status`, so completeness scores must be unchanged — that test passing confirms it.

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0065_employee_pending_status.py backend/app/schemas/employee.py backend/tests/test_employee_pending_departure.py
git commit -m "feat(employees): pending_status column for scheduled departures

Records the status a future-dated departure will flip to, while status stays
Active through the notice period. Read-only on the API; nullable, so no
server_default. Migration 0065."
```

---

### Task 4: Schedule-vs-immediate rule in `update_employee`

One rule, in the service rather than in `StatusDialog`, so both the quick status dialog and the full `EmployeeForm` get it and there is a single place to be correct: **a departure dated in the future schedules; today or past applies immediately.**

**Files:**
- Modify: `backend/app/services/employee_service.py:103-128` (`update_employee`)
- Test: `backend/tests/test_employee_pending_departure.py` (append)

**Interfaces:**
- Consumes: `Employee.pending_status` (Task 3); `EMPLOYEE_STATUS_ACTIVE` and `validate_status_end_date` from `app.schemas.employee`.
- Produces: `update_employee` behaviour relied on by the Task 10 Cancel button.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_employee_pending_departure.py`:

```python
from datetime import timedelta

from app.schemas.employee import EmployeeUpdate
from app.services import employee_service


def _make(db_session, employee_id: str, **kw) -> Employee:
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", status="Active", **kw)
    db_session.add(row)
    db_session.commit()
    return row


def test_future_dated_resignation_is_scheduled_not_applied(db_session):
    _make(db_session, "G9110")
    future = date.today() + timedelta(days=16)
    out = employee_service.update_employee(
        db_session, "G9110", EmployeeUpdate(status="Resigned", end_date=future)
    )
    assert out.status == "Active", "still working through the notice period"
    assert out.pending_status == "Resigned"
    assert out.end_date == future


def test_future_dated_termination_is_scheduled_too(db_session):
    _make(db_session, "G9111")
    future = date.today() + timedelta(days=3)
    out = employee_service.update_employee(
        db_session, "G9111", EmployeeUpdate(status="Terminated", end_date=future)
    )
    assert out.status == "Active"
    assert out.pending_status == "Terminated"


def test_today_dated_departure_applies_immediately(db_session):
    """Someone who walked off site today still flips now — existing behaviour."""
    _make(db_session, "G9112")
    out = employee_service.update_employee(
        db_session, "G9112", EmployeeUpdate(status="Terminated", end_date=date.today())
    )
    assert out.status == "Terminated"
    assert out.pending_status is None


def test_past_dated_departure_applies_immediately(db_session):
    _make(db_session, "G9113")
    past = date.today() - timedelta(days=5)
    out = employee_service.update_employee(
        db_session, "G9113", EmployeeUpdate(status="Resigned", end_date=past)
    )
    assert out.status == "Resigned"
    assert out.pending_status is None


def test_reactivating_cancels_a_pending_departure(db_session):
    """This is the Cancel path — the widget sends exactly this patch."""
    _make(
        db_session,
        "G9114",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    out = employee_service.update_employee(
        db_session, "G9114", EmployeeUpdate(status="Active", end_date=None)
    )
    assert out.status == "Active"
    assert out.pending_status is None
    assert out.end_date is None


def test_clearing_only_the_end_date_cancels_too(db_session):
    _make(
        db_session,
        "G9115",
        end_date=date.today() + timedelta(days=10),
        pending_status="Terminated",
    )
    out = employee_service.update_employee(db_session, "G9115", EmployeeUpdate(end_date=None))
    assert out.pending_status is None


def test_unrelated_patch_preserves_the_pending_departure(db_session):
    """Editing a department must not silently cancel a scheduled departure."""
    future = date.today() + timedelta(days=10)
    _make(db_session, "G9116", end_date=future, pending_status="Resigned")
    out = employee_service.update_employee(
        db_session, "G9116", EmployeeUpdate(department="Operations")
    )
    assert out.pending_status == "Resigned"
    assert out.end_date == future


def test_moving_the_date_reschedules_without_losing_the_target(db_session):
    _make(
        db_session,
        "G9117",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    later = date.today() + timedelta(days=20)
    out = employee_service.update_employee(db_session, "G9117", EmployeeUpdate(end_date=later))
    assert out.pending_status == "Resigned"
    assert out.end_date == later


def test_non_active_without_end_date_still_rejected(db_session):
    """The existing invariant must survive: no end date, no departure."""
    from app.api.errors import ValidationFailedError
    import pytest

    _make(db_session, "G9118")
    with pytest.raises(ValidationFailedError):
        employee_service.update_employee(db_session, "G9118", EmployeeUpdate(status="Resigned"))
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v`
Expected: the four scheduling/cancel tests FAIL (`out.status == "Resigned"`, `pending_status is None`). The immediate-apply and invariant tests should already PASS — they are regression guards on current behaviour.

- [ ] **Step 3: Implement the rule**

In `backend/app/services/employee_service.py`, add to the imports:

```python
from datetime import date
```

and extend the existing `from app.schemas.employee import (...)` block with `EMPLOYEE_STATUS_ACTIVE`.

Replace the body of `update_employee` between the `passport_no` block and the `validate_status_end_date` try block (currently lines 111-113) with:

```python
    # Merge the patch over the current row to evaluate the invariant.
    merged_status = data.get("status", row.status)
    merged_end = data.get("end_date", row.end_date)

    # Scheduled departure. A departure dated in the FUTURE keeps the employee
    # Active through their notice period — they are still working — and records
    # where they are headed in `pending_status`; the daily flip job applies it
    # on the day. Today-or-past applies immediately, which is the pre-existing
    # behaviour and the path for someone who walked off site today.
    #
    # This lives in the service, not in StatusDialog, so the full EmployeeForm
    # gets the same rule and there is one place to be correct.
    if (
        merged_status != EMPLOYEE_STATUS_ACTIVE
        and merged_end is not None
        and merged_end > date.today()
    ):
        data["pending_status"] = merged_status
        data["status"] = EMPLOYEE_STATUS_ACTIVE
        merged_status = EMPLOYEE_STATUS_ACTIVE
    elif data.get("status") == EMPLOYEE_STATUS_ACTIVE or (
        "end_date" in data and data["end_date"] is None
    ):
        # Reactivating, or clearing the end date, cancels a pending departure.
        # This is the Cancel path: the dashboard widget sends
        # {status: 'Active', end_date: null}, which needs no new endpoint.
        data["pending_status"] = None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v`
Expected: all PASS.

- [ ] **Step 5: Run the gates and commit**

```bash
venv\Scripts\python.exe -m pytest backend/tests -k employee -v
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: all PASS.

```bash
git add backend/app/services/employee_service.py backend/tests/test_employee_pending_departure.py
git commit -m "feat(employees): future-dated departures schedule instead of applying

A departure dated in the future keeps the employee Active through the notice
period and records the target in pending_status; today-or-past still applies
immediately. Reactivating or clearing the end date cancels, so the Cancel path
needs no new endpoint. Rule lives in the service so EmployeeForm and
StatusDialog both get it."
```

---

### Task 5: The letter records the pending departure

**Files:**
- Modify: `backend/app/services/document_service.py` — a new module-level helper plus one call just before the terminal `db.commit()` at line 1707
- Test: `backend/tests/test_document_resignation_pending.py` (create)

**Interfaces:**
- Consumes: `Employee.pending_status` (Task 3); `excel_date_to_datetime` (`core/dateutils.py`); `EMPLOYEE_STATUS_ACTIVE`, `EMPLOYEE_STATUS_RESIGNED` from `app.schemas.employee`.
- Produces: `_record_pending_resignation(db, employee, fields, *, today=None) -> None`, unit-testable without generating a document.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_document_resignation_pending.py`:

```python
"""A Resignation Letter records where the employee is headed.

Future date → pending (Active through the notice period). Today-or-past →
applied now. Never overwrites someone who has already departed.
"""

from datetime import date, timedelta

import pytest

from app.db.models import Employee
from app.services.document_service import _record_pending_resignation


def _emp(db_session, employee_id: str, **kw) -> Employee:
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", status="Active", **kw)
    db_session.add(row)
    db_session.commit()
    return row


def test_future_resignation_date_schedules(db_session):
    emp = _emp(db_session, "G9200")
    future = date.today() + timedelta(days=16)
    _record_pending_resignation(db_session, emp, {"resignation_date": future.isoformat()})
    assert emp.status == "Active"
    assert emp.pending_status == "Resigned"
    assert emp.end_date == future


def test_today_resignation_date_applies_now(db_session):
    emp = _emp(db_session, "G9201")
    _record_pending_resignation(
        db_session, emp, {"resignation_date": date.today().isoformat()}
    )
    assert emp.status == "Resigned"
    assert emp.pending_status is None
    assert emp.end_date == date.today()


def test_past_resignation_date_applies_now(db_session):
    emp = _emp(db_session, "G9202")
    past = date.today() - timedelta(days=2)
    _record_pending_resignation(db_session, emp, {"resignation_date": past.isoformat()})
    assert emp.status == "Resigned"
    assert emp.end_date == past


def test_dd_mm_yyyy_is_accepted(db_session):
    emp = _emp(db_session, "G9203")
    future = date.today() + timedelta(days=5)
    _record_pending_resignation(
        db_session, emp, {"resignation_date": future.strftime("%d/%m/%Y")}
    )
    assert emp.pending_status == "Resigned"
    assert emp.end_date == future


def test_missing_date_is_a_no_op(db_session):
    """No date, nothing to schedule — the paper still files normally."""
    emp = _emp(db_session, "G9204")
    _record_pending_resignation(db_session, emp, {})
    assert emp.status == "Active"
    assert emp.pending_status is None
    assert emp.end_date is None


def test_unparseable_date_is_a_no_op(db_session):
    emp = _emp(db_session, "G9205")
    _record_pending_resignation(db_session, emp, {"resignation_date": "not a date"})
    assert emp.pending_status is None
    assert emp.end_date is None


@pytest.mark.parametrize("existing", ["Resigned", "Terminated"])
def test_already_departed_employee_is_never_touched(db_session, existing):
    """A second letter for someone already gone must not rewrite their record."""
    original_end = date(2026, 1, 31)
    emp = _emp(db_session, f"G921{existing[0]}", status=existing, end_date=original_end)
    _record_pending_resignation(
        db_session,
        emp,
        {"resignation_date": (date.today() + timedelta(days=10)).isoformat()},
    )
    assert emp.status == existing
    assert emp.end_date == original_end
    assert emp.pending_status is None


def test_none_employee_is_a_no_op(db_session):
    """Letters can be generated without a linked employee row."""
    _record_pending_resignation(db_session, None, {"resignation_date": "2026-08-15"})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_resignation_pending.py -v`
Expected: FAIL — `ImportError: cannot import name '_record_pending_resignation'`.

- [ ] **Step 3: Write the helper**

In `backend/app/services/document_service.py`, add near the other module-level helpers (after `companion_pdf_paths`, around line 260). The file already imports `date`-related names and `Employee`; add `from app.core.dateutils import excel_date_to_datetime` and the two status constants from `app.schemas.employee` if not already imported.

```python
def _record_pending_resignation(
    db: Session,
    employee: Employee | None,
    fields: dict[str, Any],
    *,
    today: date | None = None,
) -> None:
    """Record where a Resignation Letter's subject is headed.

    A resignation dated in the FUTURE keeps the employee Active through their
    notice period — they are still on duty — and stores the target in
    ``pending_status`` for the daily flip job. Dated today or earlier, it is
    applied immediately.

    No-ops when there is no linked employee, no parseable ``resignation_date``,
    or the employee has already departed: a second letter must never rewrite the
    record of someone already Resigned or Terminated.

    The caller invokes this inside ``generate_document``'s transaction, just
    before the terminal commit, so the employee change is atomic with the
    Document insert.
    """
    if employee is None or employee.status != EMPLOYEE_STATUS_ACTIVE:
        return
    parsed = excel_date_to_datetime(fields.get("resignation_date"))
    if parsed is None:
        return
    effective = parsed.date()
    employee.end_date = effective
    if effective > (today or date.today()):
        employee.pending_status = EMPLOYEE_STATUS_RESIGNED
    else:
        employee.status = EMPLOYEE_STATUS_RESIGNED
        employee.pending_status = None
```

- [ ] **Step 4: Call it from the generation path**

In `generate_document`, immediately **before** the terminal `db.commit()` (line 1707, under the `# 15. Commit` comment), insert:

```python
    # A committed Resignation Letter records where the employee is headed —
    # inside this transaction, so it is atomic with the Document insert. Preview
    # (commit=False) must not touch the employee record.
    if commit and template_id == "Resignation Letter":
        _record_pending_resignation(db, employee, fields)
```

Gate on `commit` so the preview path leaves the employee alone, and on `template_id` so the auto-generated companion (`"Resignation Declaration"`, a separate `Document` row sharing the submission) does not run it a second time.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_document_resignation_pending.py -v`
Expected: all 9 PASS.

- [ ] **Step 6: Run the document suites and gates**

```bash
venv\Scripts\python.exe -m pytest backend/tests -k "document or template" -v
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/document_service.py backend/tests/test_document_resignation_pending.py
git commit -m "feat(resignation): a committed letter records the pending departure

Future date schedules (employee stays Active through the notice period); today
or earlier applies now. No-ops on preview, on the companion Declaration, and on
anyone already Resigned or Terminated. Runs inside the generation transaction."
```

---

### Task 6: The daily flip job

**Files:**
- Modify: `backend/app/services/employee_service.py` — add `apply_due_departures`
- Modify: `backend/app/services/scheduler_service.py` — job constant, wrapper, registration
- Test: `backend/tests/test_employee_pending_departure.py` (append), `backend/tests/test_scheduler_departure_flip.py` (create)

**Interfaces:**
- Consumes: `Employee.pending_status` (Task 3); `push_service.send_to_user(db, user_id, messages, url)` and `admin_notify.active_admins(db)` — `messages` is `dict[str, tuple[str, str]]` keyed by language, each value `(title, body)` (`services/admin_notify.py:17-27`).
- Produces: `employee_service.apply_due_departures(db, *, today: date | None = None) -> list[Employee]` — returns the rows it flipped. `scheduler_service._run_pending_departure_flip() -> None`.

The real logic lives in the service (testable against a DB session); the scheduler function is a thin wrapper, matching `_run_leave_ending_reminder` → `notify_dispatch.send_ending_reminders`.

- [ ] **Step 1: Write the failing service tests**

Append to `backend/tests/test_employee_pending_departure.py`:

```python
def test_flip_applies_a_due_departure(db_session):
    due = date.today()
    _make(db_session, "G9300", end_date=due, pending_status="Resigned")
    flipped = employee_service.apply_due_departures(db_session)
    assert [e.id for e in flipped] == ["G9300"]
    row = db_session.get(Employee, "G9300")
    assert row.status == "Resigned"
    assert row.pending_status is None
    assert row.end_date == due, "end_date is already correct — never rewritten"


def test_flip_applies_an_overdue_departure(db_session):
    """A missed run (deploy, restart, box off) is caught up on the next run."""
    _make(db_session, "G9301", end_date=date.today() - timedelta(days=3), pending_status="Terminated")
    employee_service.apply_due_departures(db_session)
    assert db_session.get(Employee, "G9301").status == "Terminated"


def test_flip_leaves_a_future_departure_alone(db_session):
    _make(db_session, "G9302", end_date=date.today() + timedelta(days=1), pending_status="Resigned")
    assert employee_service.apply_due_departures(db_session) == []
    row = db_session.get(Employee, "G9302")
    assert row.status == "Active"
    assert row.pending_status == "Resigned"


def test_flip_is_idempotent(db_session):
    _make(db_session, "G9303", end_date=date.today(), pending_status="Resigned")
    assert len(employee_service.apply_due_departures(db_session)) == 1
    assert employee_service.apply_due_departures(db_session) == [], "second run same day"


def test_flip_ignores_rows_without_a_pending_status(db_session):
    """The 280 live Active employees and the 21 already-departed must not move."""
    _make(db_session, "G9304")
    _make(db_session, "G9305", status="Resigned", end_date=date(2026, 1, 31))
    assert employee_service.apply_due_departures(db_session) == []
    assert db_session.get(Employee, "G9304").status == "Active"


def test_flip_ignores_a_junk_pending_status(db_session):
    """pending_status is free text on SQLite; junk must never reach `status`."""
    _make(db_session, "G9306", end_date=date.today(), pending_status="Banana")
    assert employee_service.apply_due_departures(db_session) == []
    assert db_session.get(Employee, "G9306").status == "Active"


def test_flip_ignores_a_pending_row_with_no_end_date(db_session):
    _make(db_session, "G9307", pending_status="Resigned")
    assert employee_service.apply_due_departures(db_session) == []


def test_flip_honours_an_injected_today(db_session):
    future = date.today() + timedelta(days=5)
    _make(db_session, "G9308", end_date=future, pending_status="Resigned")
    flipped = employee_service.apply_due_departures(db_session, today=future)
    assert [e.id for e in flipped] == ["G9308"]
```

- [ ] **Step 2: Run them to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v`
Expected: FAIL — `AttributeError: module 'app.services.employee_service' has no attribute 'apply_due_departures'`.

- [ ] **Step 3: Implement `apply_due_departures`**

Add to `backend/app/services/employee_service.py`, and extend the `from app.schemas.employee import (...)` block with `EMPLOYEE_STATUS_RESIGNED` and `EMPLOYEE_STATUS_TERMINATED`:

```python
# Only these may be promoted out of `pending_status` into `status`.
_PENDING_TARGETS: Final[frozenset[str]] = frozenset(
    {EMPLOYEE_STATUS_RESIGNED, EMPLOYEE_STATUS_TERMINATED}
)


def apply_due_departures(db: Session, *, today: date | None = None) -> list[Employee]:
    """Flip every scheduled departure that has come due. Returns the rows moved.

    A pending departure is `status == 'Active'` with a `pending_status` and an
    `end_date`. On or after that date the employee becomes what
    `pending_status` says and the pending marker is cleared. `end_date` is
    already correct, so it is never rewritten.

    Idempotent: clearing `pending_status` means a second run the same day moves
    nothing. A missed run (deploy, restart) is caught up on the next one,
    because the filter is `<= today` rather than `== today`.

    `pending_status` is free text — SQLite has no enum — so the filter is
    restricted to the two legal targets. A hand-edited or imported junk value is
    left in place rather than promoted into `status`.
    """
    cutoff = today or date.today()
    rows = list(
        db.scalars(
            select(Employee).where(
                Employee.status == EMPLOYEE_STATUS_ACTIVE,
                Employee.pending_status.in_(tuple(_PENDING_TARGETS)),
                Employee.end_date.is_not(None),
                Employee.end_date <= cutoff,
            )
        )
    )
    for row in rows:
        row.status = row.pending_status or EMPLOYEE_STATUS_ACTIVE
        row.pending_status = None
    if rows:
        db.commit()
    return rows
```

Add `Final` to the `typing` import and `apply_due_departures` to `__all__`.

- [ ] **Step 4: Run the service tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v`
Expected: all PASS.

- [ ] **Step 5: Write the failing scheduler test**

Create `backend/tests/test_scheduler_departure_flip.py`:

```python
"""The daily scheduled-departure flip worker.

Mirrors test_scheduler_leave_ending.py: the job is a thin wrapper, so these
tests assert delegation and error containment, not the flip logic itself
(covered in test_employee_pending_departure.py).
"""

import contextlib
from types import SimpleNamespace

from app.services import scheduler_service as sched


def _fake_session(monkeypatch):
    dummy = SimpleNamespace()

    @contextlib.contextmanager
    def _fake_session_local():
        yield dummy

    monkeypatch.setattr(sched, "SessionLocal", _fake_session_local)
    return dummy


def test_flip_job_calls_the_service(monkeypatch):
    _fake_session(monkeypatch)
    calls = {"n": 0}

    def fake_apply(db, **kw):
        calls["n"] += 1
        return []

    monkeypatch.setattr(sched.employee_service, "apply_due_departures", fake_apply)
    sched._run_pending_departure_flip()
    assert calls["n"] == 1


def test_flip_job_notifies_admins_for_each_flip(monkeypatch):
    _fake_session(monkeypatch)
    moved = [
        SimpleNamespace(id="G9400", name_en="A", name_ar=None, status="Resigned"),
        SimpleNamespace(id="G9401", name_en="B", name_ar=None, status="Terminated"),
    ]
    monkeypatch.setattr(
        sched.employee_service, "apply_due_departures", lambda db, **kw: moved
    )
    monkeypatch.setattr(
        sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)]
    )
    sent: list[tuple[int, dict, str]] = []
    monkeypatch.setattr(
        sched.push_service,
        "send_to_user",
        lambda db, uid, messages, url: sent.append((uid, messages, url)),
    )

    sched._run_pending_departure_flip()

    assert len(sent) == 2
    for _uid, messages, url in sent:
        assert set(messages) == {"en", "ar"}, "bilingual parity"
        assert url.startswith("/employees/")
    # Arabic body must be Arabic, not an English leak.
    ar_bodies = [m["ar"][1] for _u, m, _url in sent]
    assert any("مستقيل" in b for b in ar_bodies)
    assert any("مفصول" in b for b in ar_bodies)


def test_flip_job_swallows_service_errors(monkeypatch):
    _fake_session(monkeypatch)

    def boom(db, **kw):
        raise RuntimeError("db locked")

    monkeypatch.setattr(sched.employee_service, "apply_due_departures", boom)
    sched._run_pending_departure_flip()  # must not raise


def test_flip_job_swallows_notification_errors(monkeypatch):
    """A push failure must not roll back or hide a completed flip."""
    _fake_session(monkeypatch)
    monkeypatch.setattr(
        sched.employee_service,
        "apply_due_departures",
        lambda db, **kw: [SimpleNamespace(id="G9402", name_en="C", name_ar=None, status="Resigned")],
    )
    monkeypatch.setattr(
        sched.admin_notify, "active_admins", lambda db: [SimpleNamespace(id=1)]
    )

    def boom(db, uid, messages, url):
        raise RuntimeError("push gateway down")

    monkeypatch.setattr(sched.push_service, "send_to_user", boom)
    sched._run_pending_departure_flip()  # must not raise
```

- [ ] **Step 6: Run it to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_departure_flip.py -v`
Expected: FAIL — `AttributeError: ... has no attribute '_run_pending_departure_flip'`.

- [ ] **Step 7: Add the job**

In `backend/app/services/scheduler_service.py`:

Add `admin_notify` and `employee_service` to the existing `from app.services import (...)` block (alphabetical order: `admin_notify` first, `employee_service` after `email_service`).

Add the job-id constant beside `_LEAVE_ENDING_JOB_ID`:

```python
_DEPARTURE_FLIP_JOB_ID = "pending-departure-flip"
```

Add the wrapper after `_run_leave_ending_reminder` (line 332):

```python
def _run_pending_departure_flip() -> None:
    """Daily 09:05 Asia/Dubai — apply scheduled departures that have come due.

    An employee whose resignation or termination was dated in the future stayed
    Active through their notice period; today they become what
    ``pending_status`` says. Admins get one in-app notification per flip.

    Employees are never messaged by this job.
    """
    with SessionLocal() as session:
        try:
            moved = employee_service.apply_due_departures(session)
        except Exception:
            log.exception("scheduler: pending-departure flip failed")
            return
        if not moved:
            return
        log.info("scheduler: %d scheduled departure(s) applied", len(moved))
        try:
            admins = admin_notify.active_admins(session)
        except Exception:
            log.exception("scheduler: could not list admins for departure notice")
            return
        for emp in moved:
            name_ar = getattr(emp, "name_ar", None) or emp.name_en
            status_ar = "مستقيل" if emp.status == "Resigned" else "مفصول"
            status_en = "Resigned" if emp.status == "Resigned" else "Terminated"
            messages = {
                "en": (
                    "GSSG Manager",
                    f"Departure applied\n{emp.name_en} ({emp.id}) is now {status_en}",
                ),
                "ar": (
                    "GSSG Manager",
                    f"تم تطبيق المغادرة\n{name_ar} ({emp.id}) الآن {status_ar}",
                ),
            }
            url = f"/employees/{emp.id}"
            for admin in admins:
                try:
                    push_service.send_to_user(session, admin.id, messages, url)
                except Exception:
                    log.exception(
                        "scheduler: departure notice failed for admin %s", admin.id
                    )
```

The flip is already committed by `apply_due_departures`, so a push failure cannot undo it — hence the per-admin `try`.

Register it inside `start()`, after the leave-ending block (line 426):

```python
            _scheduler.add_job(
                _run_pending_departure_flip,
                trigger=CronTrigger(hour=9, minute=5, timezone="Asia/Dubai"),
                id=_DEPARTURE_FLIP_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: pending-departure flip daily at 09:05 Asia/Dubai")
```

09:05 rather than 09:00 keeps it off the same tick as the leave-ending reminder. Add `"_run_pending_departure_flip"` to `__all__`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_departure_flip.py backend/tests/test_employee_pending_departure.py -v
venv\Scripts\python.exe -m pytest backend/tests -k scheduler -v
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/employee_service.py backend/app/services/scheduler_service.py backend/tests/test_employee_pending_departure.py backend/tests/test_scheduler_departure_flip.py
git commit -m "feat(employees): daily job applies scheduled departures

apply_due_departures flips Active employees whose pending_status is due,
idempotently and catching up missed runs. Junk pending_status values are never
promoted. Admins get one bilingual in-app notice per flip; employees are not
messaged."
```

---

### Task 7: `pending` filter on the employees list

Feeds the Task 10 widget without a new endpoint.

**Files:**
- Modify: `backend/app/services/employee_service.py:34-74` (`list_employees`)
- Modify: `backend/app/api/v1/employees.py:80-92` (`list_employees` route)
- Modify: `frontend/src/lib/api.ts:1018-1024` (`ListEmployeesParams`)
- Test: `backend/tests/test_employee_pending_departure.py` (append)

**Interfaces:**
- Produces: `GET /employees?pending=true` returning only pending-departure rows, ordered by `end_date` ascending (soonest first). Task 10 consumes it as `api.listEmployees({ pending: true })`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_employee_pending_departure.py`:

```python
def test_pending_filter_returns_only_scheduled_departures(db_session):
    _make(db_session, "G9500")  # plain Active
    _make(db_session, "G9501", status="Resigned", end_date=date(2026, 1, 31))  # departed
    _make(
        db_session,
        "G9502",
        end_date=date.today() + timedelta(days=10),
        pending_status="Resigned",
    )
    rows, total = employee_service.list_employees(db_session, pending=True)
    assert [r.id for r in rows] == ["G9502"]
    assert total == 1


def test_pending_filter_orders_soonest_first(db_session):
    _make(db_session, "G9510", end_date=date.today() + timedelta(days=30), pending_status="Resigned")
    _make(db_session, "G9511", end_date=date.today() + timedelta(days=2), pending_status="Terminated")
    _make(db_session, "G9512", end_date=date.today() + timedelta(days=9), pending_status="Resigned")
    rows, _ = employee_service.list_employees(db_session, pending=True)
    assert [r.id for r in rows] == ["G9511", "G9512", "G9510"]


def test_pending_false_does_not_filter(db_session):
    """Omitting the flag must not change the existing list behaviour."""
    _make(db_session, "G9520")
    rows, total = employee_service.list_employees(db_session)
    assert total >= 1
    assert any(r.id == "G9520" for r in rows)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -k pending_filter -v`
Expected: FAIL — `TypeError: list_employees() got an unexpected keyword argument 'pending'`.

- [ ] **Step 3: Add the filter**

In `backend/app/services/employee_service.py`, add the parameter to `list_employees` after `duty_unit`:

```python
    pending: bool = False,
```

Add the clause after the `duty_unit` block (line 68), and make the ordering pending-aware:

```python
    if pending:
        # Scheduled departure: still Active, but headed somewhere on end_date.
        clause = and_(
            Employee.status == EMPLOYEE_STATUS_ACTIVE,
            Employee.pending_status.is_not(None),
            Employee.end_date.is_not(None),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)

    # Soonest departure first when listing pending; otherwise by name.
    order = Employee.end_date if pending else Employee.name_en
    stmt = stmt.order_by(order).limit(limit).offset(offset)
```

Delete the old `stmt = stmt.order_by(Employee.name_en).limit(limit).offset(offset)` line so the ordering is set once. Add `and_` to the existing `from sqlalchemy import ...` line.

Update the docstring:

```python
    """Filtered + paginated list. Returns ``(rows, total_count)``.

    ``pending=True`` narrows to scheduled departures — Active employees with a
    ``pending_status`` and an ``end_date`` — ordered soonest-first, which is what
    the dashboard's Pending Departures widget reads.
    """
```

- [ ] **Step 4: Expose it on the route**

In `backend/app/api/v1/employees.py`, add to the `list_employees` signature after `duty_unit`:

```python
    pending: bool = False,
```

and pass `pending=pending` in the `employee_service.list_employees(...)` call.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
venv\Scripts\python.exe -m pytest backend/tests/test_employee_pending_departure.py -v
venv\Scripts\python.exe -m pytest backend/tests -k employee -v
```

Expected: all PASS. The existing list tests confirm the default ordering is unchanged.

- [ ] **Step 6: Add the frontend param type**

In `frontend/src/lib/api.ts`, extend `ListEmployeesParams` (line 1018):

```ts
export interface ListEmployeesParams {
  q?: string
  status?: EmployeeStatus
  department?: string
  /** Only scheduled departures — Active employees with a pending_status. */
  pending?: boolean
  limit?: number
  offset?: number
}
```

- [ ] **Step 7: Run the gates and commit**

```bash
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all PASS.

```bash
git add backend/app/services/employee_service.py backend/app/api/v1/employees.py frontend/src/lib/api.ts backend/tests/test_employee_pending_departure.py
git commit -m "feat(employees): pending filter on the list endpoint

GET /employees?pending=true returns scheduled departures soonest-first, so the
dashboard widget needs no new endpoint."
```

---

### Task 8: Regenerate the API contract

`EmployeeRead` (Task 3) and the list route (Task 7) changed. `mng build`/`deploy` use the **committed** `api.types.ts` and do not regenerate, so skipping this silently drifts the frontend.

**Files:**
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (both generated)

**Interfaces:**
- Produces: `EmployeeRead.pending_status` and the `pending` query param in the generated TS types. Tasks 9-10 consume them.

- [ ] **Step 1: Regenerate**

Use the `/sync-api-types` skill. It dumps the OpenAPI document from the FastAPI app and runs the generator.

If running the steps by hand:

```bash
venv\Scripts\python.exe -c "import json;from app.main import create_app;print(json.dumps(create_app().openapi(),indent=2,ensure_ascii=False))" > backend/openapi.json
pnpm -C frontend gen:api
```

- [ ] **Step 2: Verify the new members landed**

```bash
grep -n "pending_status" frontend/src/lib/api.types.ts
grep -n "pending" backend/openapi.json | head
```

Expected: `pending_status?: ("Active" | "Resigned" | "Terminated") | null` (or equivalent) appears in the `EmployeeRead` schema, and the employees list operation gains a `pending` query parameter.

- [ ] **Step 3: Typecheck**

```bash
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: PASS.

- [ ] **Step 4: Commit both together**

```bash
git add backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "chore(api): resync generated types for pending_status + pending filter"
```

Never hand-edit either file, and never resolve a merge conflict in `api.types.ts` with `checkout --ours` — regenerate instead.

---

### Task 9: Pending departure badge

**Files:**
- Create: `frontend/src/components/employees/PendingDepartureBadge.tsx`
- Create: `frontend/src/components/employees/PendingDepartureBadge.test.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Modify: the employee detail header that renders `StatusPill`, and the search-result row that renders it

**Interfaces:**
- Consumes: `EmployeeRead.pending_status` (Task 8); `Badge` from `@/components/ui/badge`; the existing `employees.status.*` i18n keys.
- Produces: `<PendingDepartureBadge pendingStatus={...} endDate={...} />`, rendering `null` when there is no pending departure.

**Wording constraint.** The badge composes the **existing canonical** status translation with a date wrapper. Do not write new Arabic status words: `Resigned` is `مستقيل` and `Terminated` is `مفصول` in `employees.status.*`. Two new keys only.

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/locales/en.json`, inside the `employees` object, add:

```json
    "pendingDeparture": "{{status}} — effective {{date}}",
    "pendingDepartureTitle": "Scheduled departure on {{date}}",
```

In `frontend/src/locales/ar.json`, inside `employees`:

```json
    "pendingDeparture": "{{status}} — اعتباراً من {{date}}",
    "pendingDepartureTitle": "مغادرة مجدولة بتاريخ {{date}}",
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/components/employees/PendingDepartureBadge.test.tsx`:

```tsx
/**
 * The badge reuses the canonical status translations rather than inventing
 * wording — the Arabic assertions below are the guard against an English leak.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'

import i18n from '@/lib/i18n'
import { PendingDepartureBadge } from './PendingDepartureBadge'

function renderBadge(props: Parameters<typeof PendingDepartureBadge>[0], lng = 'en') {
  void i18n.changeLanguage(lng)
  return render(
    <I18nextProvider i18n={i18n}>
      <PendingDepartureBadge {...props} />
    </I18nextProvider>,
  )
}

describe('PendingDepartureBadge', () => {
  it('renders nothing without a pending status', () => {
    const { container } = renderBadge({ pendingStatus: null, endDate: '2026-08-15' })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without an end date', () => {
    const { container } = renderBadge({ pendingStatus: 'Resigned', endDate: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the English status and date', () => {
    renderBadge({ pendingStatus: 'Resigned', endDate: '2026-08-15' })
    expect(screen.getByText(/Resigned/)).toBeInTheDocument()
    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument()
  })

  it('shows the canonical Arabic status for Resigned', () => {
    renderBadge({ pendingStatus: 'Resigned', endDate: '2026-08-15' }, 'ar')
    expect(screen.getByText(/مستقيل/)).toBeInTheDocument()
    expect(screen.queryByText(/Resigned/)).not.toBeInTheDocument()
  })

  it('shows the canonical Arabic status for Terminated', () => {
    renderBadge({ pendingStatus: 'Terminated', endDate: '2026-08-15' }, 'ar')
    expect(screen.getByText(/مفصول/)).toBeInTheDocument()
    expect(screen.queryByText(/Terminated/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/employees/PendingDepartureBadge.test.tsx`
Expected: FAIL — cannot resolve `./PendingDepartureBadge`.

- [ ] **Step 4: Write the component**

Create `frontend/src/components/employees/PendingDepartureBadge.tsx`:

```tsx
/**
 * Scheduled-departure chip — "Resigned — effective 15/08/2026".
 *
 * Shown beside StatusPill while the employee is still Active but has a
 * departure booked for `endDate`. Composes the canonical
 * `employees.status.*` translation with a date wrapper so the Arabic wording
 * stays in one place (مستقيل / مفصول), never duplicated here.
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import type { EmployeeStatus } from '@/lib/api'

interface Props {
  pendingStatus: EmployeeStatus | null | undefined
  endDate: string | null | undefined
}

/** ISO (`YYYY-MM-DD`) → `DD/MM/YYYY`, the format every GSSG paper uses. */
function formatDmy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}

export function PendingDepartureBadge({
  pendingStatus,
  endDate,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!pendingStatus || !endDate) return null
  const date = formatDmy(endDate)
  return (
    <Badge tone="warning" title={t('employees.pendingDepartureTitle', { date })}>
      {t('employees.pendingDeparture', {
        status: t(`employees.status.${pendingStatus}`),
        date,
      })}
    </Badge>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/components/employees/PendingDepartureBadge.test.tsx`
Expected: 5 PASS. If `Badge` rejects the `title` prop, wrap it in a `<span title=...>` rather than widening `Badge`'s props.

- [ ] **Step 6: Mount it on both surfaces**

Find every render of `StatusPill`:

```bash
grep -rn "StatusPill" frontend/src --include=*.tsx
```

In the employee detail header and in the search-result row, render the badge immediately after `<StatusPill …>`, passing `employee.pending_status` and `employee.end_date`. Use `ms-2` for the gap — never `ml-2`.

- [ ] **Step 7: Verify parity, then commit**

```bash
venv\Scripts\python.exe -c "import json;a=json.load(open('frontend/src/locales/ar.json',encoding='utf-8'));e=json.load(open('frontend/src/locales/en.json',encoding='utf-8'));ka=set(a['employees']);ke=set(e['employees']);print('EN only:',ke-ka);print('AR only:',ka-ke)"
pnpm -C frontend exec vitest run src/components/employees
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: the parity check prints two empty sets (bar the documented `_zero`/`_two`/`_few`/`_many` plural variants Arabic carries), and the rest PASS.

```bash
git add frontend/src/components/employees/PendingDepartureBadge.tsx frontend/src/components/employees/PendingDepartureBadge.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git add -u frontend/src
git commit -m "feat(employees): pending-departure badge on the profile and search rows

Reuses the canonical employees.status.* wording (مستقيل / مفصول) rather than
introducing new Arabic strings."
```

---

### Task 10: Pending Departures dashboard widget

**Files:**
- Create: `frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.tsx`
- Create: `frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.test.tsx`
- Modify: `backend/app/schemas/settings.py:23-36` (`DASHBOARD_WIDGET_IDS`) and the `DashboardWidgetId` Literal at `:58`
- Modify: `frontend/src/lib/dashboardLayout.ts:26-39` (`WIDGET_IDS`) and `:48-63` (`WIDGET_SIZE`)
- Modify: `frontend/src/pages/dashboard/DashboardPage.tsx` (widget switch, ~line 390)
- Modify: `frontend/src/locales/{en,ar}.json` (`dashboard.widgetLabels` + a `pendingDepartures` block)
- Test: `frontend/src/lib/dashboardLayout.test.ts` (update if it asserts a widget count)

**Interfaces:**
- Consumes: `api.listEmployees({ pending: true })` (Tasks 7-8); `api.updateEmployee(id, { status: 'Active', end_date: null })` for Cancel (Task 4); `PendingDepartureBadge` is **not** reused here — the widget shows its own row layout.
- Produces: widget id `pending_departures`, registered on both sides.

The widget id must be added to the **backend** tuple and Literal as well as the frontend mirror, or the API rejects a layout containing it (`schemas/settings.py:9-11` documents this).

- [ ] **Step 1: Register the id on the backend**

In `backend/app/schemas/settings.py`, add `"pending_departures"` as the last entry of `DASHBOARD_WIDGET_IDS` and of the `DashboardWidgetId` Literal, and add it to the `# New widgets:` comment list at line 17-18.

- [ ] **Step 2: Register the id on the frontend**

In `frontend/src/lib/dashboardLayout.ts`:
- Add `'pending_departures',` as the last entry of `WIDGET_IDS`, and update the doc comment `/** All 12 canonical widget ids ... */` to say 13.
- Add `pending_departures: 'panel',` to `WIDGET_SIZE`.

`DEFAULT_LAYOUT` needs no change: any id that is not `pending`/`workspace`/`waiting_approvals`/`violations`/`drafts`/`ledger` defaults to `under_workspace` and `visible: false`, so nobody's dashboard suddenly grows — the operator opts in via Customize. `resolveLayout` appends it hidden for existing saved layouts, which is the intended behaviour.

- [ ] **Step 3: Run the layout tests**

Run: `pnpm -C frontend exec vitest run src/lib/dashboardLayout.test.ts`

If a test asserts a widget count (e.g. `expect(WIDGET_IDS).toHaveLength(12)`), update it to 13. If a test asserts `DEFAULT_LAYOUT` length, update it too. Expected after that: PASS.

- [ ] **Step 4: Add the i18n keys**

`frontend/src/locales/en.json` — in `dashboard.widgetLabels`:

```json
      "pending_departures": "Pending Departures",
```

and a new block inside the root object, beside the other feature blocks:

```json
  "pendingDepartures": {
    "empty": "No scheduled departures",
    "daysLeft_one": "{{count}} day left",
    "daysLeft_other": "{{count}} days left",
    "dueToday": "Last day today",
    "overdue": "Past due",
    "cancel": "Cancel",
    "cancelled": "Scheduled departure cancelled",
    "viewAll": "View all employees"
  },
```

`frontend/src/locales/ar.json` — in `dashboard.widgetLabels`:

```json
      "pending_departures": "المغادرات المجدولة",
```

and, with the full Arabic plural set (`ar.json` already uses `_zero`/`_one`/`_two`/`_few`/`_many`/`_other` elsewhere):

```json
  "pendingDepartures": {
    "empty": "لا توجد مغادرات مجدولة",
    "daysLeft_zero": "لم يبقَ أي يوم",
    "daysLeft_one": "بقي يوم واحد",
    "daysLeft_two": "بقي يومان",
    "daysLeft_few": "بقي {{count}} أيام",
    "daysLeft_many": "بقي {{count}} يوماً",
    "daysLeft_other": "بقي {{count}} يوم",
    "dueToday": "آخر يوم عمل اليوم",
    "overdue": "تجاوز الموعد",
    "cancel": "إلغاء",
    "cancelled": "تم إلغاء المغادرة المجدولة",
    "viewAll": "عرض جميع الموظفين"
  },
```

- [ ] **Step 5: Write the failing test**

Create `frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.test.tsx`:

```tsx
/**
 * Widget behaviour: lists scheduled departures, and Cancel sends the reset
 * PATCH that update_employee interprets as "cancel the pending departure".
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { PendingDeparturesWidget } from './PendingDeparturesWidget'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listEmployees: vi.fn(),
      updateEmployee: vi.fn(),
    },
  }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))

const { api } = await import('@/lib/api')

function renderWidget(lng = 'en') {
  void i18n.changeLanguage(lng)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <PendingDeparturesWidget />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const ROW = {
  id: 'G9600',
  name_en: 'Ahmed Ali',
  name_ar: 'أحمد علي',
  status: 'Active',
  pending_status: 'Resigned',
  end_date: '2026-08-15',
}

beforeEach(() => {
  vi.mocked(api.listEmployees).mockReset()
  vi.mocked(api.updateEmployee).mockReset()
})

describe('PendingDeparturesWidget', () => {
  it('lists a scheduled departure', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [ROW], total: 1 } as never)
    renderWidget()
    expect(await screen.findByText('Ahmed Ali')).toBeInTheDocument()
    expect(screen.getByText('G9600')).toBeInTheDocument()
  })

  it('shows the empty state when nothing is scheduled', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
    renderWidget()
    expect(await screen.findByText('No scheduled departures')).toBeInTheDocument()
  })

  it('shows Arabic copy under lng=ar', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
    renderWidget('ar')
    expect(await screen.findByText('لا توجد مغادرات مجدولة')).toBeInTheDocument()
  })

  it('Cancel sends the reset patch', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [ROW], total: 1 } as never)
    vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
    renderWidget()
    await screen.findByText('Ahmed Ali')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(api.updateEmployee).toHaveBeenCalledWith('G9600', {
        status: 'Active',
        end_date: null,
      }),
    )
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/dashboard/widgets/PendingDeparturesWidget.test.tsx`
Expected: FAIL — cannot resolve `./PendingDeparturesWidget`.

- [ ] **Step 7: Write the widget**

Create `frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.tsx`, following the structure of `ExpiringSoonWidget.tsx` (self-gating on `employees.view`, header with a count chip, skeleton/error/empty states, top-5 rows, footer link):

```tsx
/**
 * PendingDeparturesWidget — employees with a scheduled resignation or
 * termination: still Active, but leaving on `end_date`.
 *
 * Cancel sends `{status: 'Active', end_date: null}`, which update_employee
 * treats as cancelling the pending departure — the letter can be refused via
 * the paper's مشروحات مدير المشروع block, so this is a first-class action.
 *
 * Self-gating: renders nothing when the user lacks `employees.view`.
 * Query key: ['employees', 'pending']
 */

import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarClock, UserMinus } from 'lucide-react'

import { api, apiErrorMessage } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { pickEmployeeName } from '@/lib/employeeName'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

/** Whole days from today to `iso`, negative when already past. */
function daysUntil(iso: string, now: Date = new Date()): number {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return 0
  const target = Date.UTC(y, m - 1, d)
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86_400_000)
}

export function PendingDeparturesWidget(): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { has } = useCapabilities()

  const query = useQuery({
    queryKey: ['employees', 'pending'],
    queryFn: () => api.listEmployees({ pending: true, limit: 50 }),
    staleTime: 60_000,
  })

  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.updateEmployee(id, { status: 'Active', end_date: null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      toast.success(t('pendingDepartures.cancelled'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (!has('employees.view')) return null

  const all = query.data?.items ?? []
  const rows = all.slice(0, 5)
  const total = query.data?.total ?? 0
  const isEmpty = query.isSuccess && total === 0

  return (
    <section className="mb-6 rounded-2xl border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
        <h3 className="text-[0.86em] font-semibold text-foreground">
          {t('dashboard.widgetLabels.pending_departures')}
        </h3>
        {(query.isLoading || total > 0) && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-mono text-[0.7em] font-semibold text-warning">
            {query.isLoading ? '…' : total}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 px-3 py-2">
        {query.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-2 py-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))
        ) : query.isError ? (
          <EmptyState
            icon={CalendarClock}
            message={t('common.loadError')}
            actionLabel={t('common.retry')}
            onAction={() => void query.refetch()}
            className="py-8"
          />
        ) : isEmpty ? (
          <EmptyState icon={CalendarClock} message={t('pendingDepartures.empty')} className="py-8" />
        ) : (
          rows.map((emp) => {
            const days = emp.end_date ? daysUntil(emp.end_date) : 0
            const when =
              days < 0
                ? t('pendingDepartures.overdue')
                : days === 0
                  ? t('pendingDepartures.dueToday')
                  : t('pendingDepartures.daysLeft', { count: days })
            return (
              <div
                key={emp.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-tinted"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/employees/${encodeURIComponent(emp.id)}`)}
                  className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                >
                  <span className="block truncate text-[0.86em] font-medium text-foreground">
                    {pickEmployeeName(emp, i18n.language)}
                  </span>
                  <span className="font-mono text-[0.72em] text-muted-foreground">{emp.id}</span>
                </button>

                <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 text-[0.68em] font-semibold text-foreground">
                  {emp.pending_status ? t(`employees.status.${emp.pending_status}`) : ''}
                </span>

                <div className="flex shrink-0 items-center gap-1 text-warning">
                  <UserMinus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                  <span className="text-[0.72em] font-medium">{when}</span>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0 text-[0.72em]"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(emp.id)}
                >
                  {t('pendingDepartures.cancel')}
                </Button>
              </div>
            )
          })
        )}
      </div>

      {!isEmpty && !query.isLoading && (
        <div className="border-t border-hairline px-5 py-2.5">
          <Link
            to="/employees"
            className="text-[0.82em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
          >
            {t('pendingDepartures.viewAll')}
          </Link>
        </div>
      )}
    </section>
  )
}
```

The response shape is `EmployeeListResponse = { items: EmployeeListItem[], total: number, limit: number, offset: number }` (`backend/app/schemas/employee.py:172-176`), and `EmployeeListItem` carries `end_date` + `pending_status` as of Task 3 Step 7. Do not cast with `as any`.

- [ ] **Step 8: Render it on the dashboard**

In `frontend/src/pages/dashboard/DashboardPage.tsx`, add the import beside the other widget imports (line 55):

```ts
import { PendingDeparturesWidget } from '@/pages/dashboard/widgets/PendingDeparturesWidget'
```

and a case in the widget switch, beside `case 'expiring_soon':` (line 390):

```tsx
      case 'pending_departures':
        return <PendingDeparturesWidget />
```

- [ ] **Step 9: Run the tests**

```bash
pnpm -C frontend exec vitest run src/pages/dashboard src/lib/dashboardLayout.test.ts
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
venv\Scripts\python.exe -m pytest backend/tests -k dashboard -v
venv\Scripts\mypy.exe
```

Expected: all PASS. `test_dashboard_layout_read.py` may assert the known widget-id set — update it to include `pending_departures`.

- [ ] **Step 10: Resync the contract (the widget Literal changed) and commit**

```bash
venv\Scripts\python.exe -c "import json;from app.main import create_app;print(json.dumps(create_app().openapi(),indent=2,ensure_ascii=False))" > backend/openapi.json
pnpm -C frontend gen:api
pnpm -C frontend exec tsc -b --noEmit
```

```bash
git add frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.tsx frontend/src/pages/dashboard/widgets/PendingDeparturesWidget.test.tsx frontend/src/pages/dashboard/DashboardPage.tsx frontend/src/lib/dashboardLayout.ts backend/app/schemas/settings.py frontend/src/locales/en.json frontend/src/locales/ar.json backend/openapi.json frontend/src/lib/api.types.ts
git add -u frontend/src backend
git commit -m "feat(dashboard): Pending Departures widget with Cancel

Lists scheduled departures soonest-first; Cancel sends the reset patch. Hidden
by default in DEFAULT_LAYOUT so no existing dashboard changes until the
operator opts in via Customize."
```

---

### Task 11: Reviewers and full gates

**Files:** none modified unless a reviewer reports a real defect.

- [ ] **Step 1: Run the bilingual reviewers**

Both are mandatory per `CLAUDE.md` — this feature touched locale files, a badge, a widget, and notification copy.

Dispatch the `i18n-rtl-reviewer` agent on the full branch diff, and the `notification-template-reviewer` agent on `scheduler_service._run_pending_departure_flip` plus the new locale keys.

Fix anything they find that is a real defect. If you disagree with a finding, verify it against the code before dismissing it — do not implement a suggestion you cannot confirm.

- [ ] **Step 2: Run the Alembic reviewer**

Dispatch the `alembic-migration-reviewer` agent on `0065_employee_pending_status.py`.

- [ ] **Step 3: Full backend suite**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
venv\Scripts\alembic.exe heads
```

Expected: all green; `heads` shows exactly one head (`0065`).

- [ ] **Step 4: Full frontend suite**

```bash
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
```

Expected: all green.

- [ ] **Step 5: Confirm no stray template churn**

```bash
git status --short
```

Expected: a clean tree. If any `backend/templates/*.docx` shows as modified, revert it — the live service re-saves those during operation and the churn can break Jinja tokens.

- [ ] **Step 6: Report**

State the actual numbers (backend tests passed, frontend tests passed, reviewer findings and their resolution). Do not claim success without the output in hand.

**Deployment is the user's call** — do not run `mng deploy` or push to `origin/main` without being asked. Note in the report that the branch is ready, that `mng update` will need `alembic upgrade head` to apply `0065`, and that the widget is hidden by default until an operator enables it in Customize.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| `resignation_date` field, `type: date`, required, bilingual label | 1 |
| Adapter splits `resignation_date`, `today` untouched, fallback for old records | 1 |
| Prefill to today | 2 |
| `pending_status` column, nullable, migration, single head | 3 |
| `EmployeeRead.pending_status`; nothing on Create/Update | 3 |
| Letter creation writes the pending departure, atomic, guarded | 5 |
| Future → pending; today/past → immediate (both writers) | 4, 5 |
| `update_employee` rule in the service so EmployeeForm gets it | 4 |
| Cancel via `{status:'Active', end_date:null}`, no new endpoint | 4, 10 |
| Daily flip job, idempotent, catch-up, junk-value guard | 6 |
| Admin-only in-app notification, employees never messaged | 6 |
| `pending` filter on the existing list endpoint | 7 |
| API types resync | 8, 10 |
| Profile + search badge, canonical AR wording | 9 |
| Dashboard widget with Cancel | 10 |
| i18n parity, Arabic assertions, logical CSS | 1, 9, 10, 11 |
| Both bilingual reviewers + Alembic reviewer | 11 |
| Timezone risk (date comparison) | 6 (`today` injectable, `date.today()` per codebase convention) |

No spec requirement is unassigned.

**Type consistency**

- `_record_pending_resignation(db, employee, fields, *, today=None) -> None` — defined Task 5, called Task 5 only.
- `apply_due_departures(db, *, today=None) -> list[Employee]` — defined Task 6, consumed by `_run_pending_departure_flip` (Task 6) and its tests.
- `list_employees(..., pending: bool = False)` — defined Task 7, consumed by the route (7) and the widget (10).
- `Employee.pending_status: str | None` (model, Task 3) vs `EmployeeRead.pending_status: EmployeeStatus | None` (schema, Task 3) — intentionally different: the DB column is free text because SQLite has no enum, and the read schema narrows it. The flip job's `_PENDING_TARGETS` filter is what keeps the two consistent.
- `seedResignationDate(current: unknown, todayIso: string) -> string | null` and `todayIso(now?: Date) -> string` — defined Task 2, consumed Task 2.
- `PendingDepartureBadge({ pendingStatus, endDate })` — defined Task 9, mounted Task 9.
- `PendingDeparturesWidget()` — defined Task 10, mounted Task 10.

**Verified during planning, not assumed:**
- `EmployeeListResponse` is `{ items: EmployeeListItem[], total, limit, offset }`, and `EmployeeListItem` is a *minimal* projection that did **not** carry `end_date` or `pending_status`. Task 3 Step 7 adds both, with Step 7b as the guard. Without this, the widget and the search-row badge would render blank — the single most likely way this feature ships half-broken.
- `ARABIC_WEEKDAYS[date(2026, 7, 30).weekday()]` is `الخميس`, so the Task 1 declaration assertion is correct.
- Live data confirms the repurposed state is unused: 0 rows with `status='Active' AND end_date IS NOT NULL`, 0 non-Active rows with a null `end_date`, 0 future `end_date` values, across 280 Active / 12 Terminated / 9 Resigned.

**Flagged for execution:** Task 1 Step 6, Task 10 Step 3, and Task 10 Step 9 each note that an existing test may assert an exact field list, widget count, or widget-id set, and must be updated rather than worked around.
