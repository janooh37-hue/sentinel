# Cross-shift Duty Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One transfer letter can gather employees from any number of source duty units and send each one to its own destination unit/post.

**Architecture:** `POST /api/v1/duty/transfer` swaps its flat `employee_ids` + single `to_unit`/`to_post` for a `moves: [{employee_id, to_unit, to_post}]` list; the letter body builder takes `(employee, to_unit, to_post)` per row so `من` stays the employee's current location while `إلى` becomes per-row. On the roster page the selection stops resetting when the operator switches units in the rail, and a new `SelectionTray` renders the sticky bar plus an expandable review panel grouped by current unit. The transfer dialog grows a bulk "apply to all" destination row above per-employee destination inputs.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy 2 (Python 3.12), React 18 + TypeScript + TanStack Query v5 + react-hook-form + i18next, pytest, Vitest + Testing Library.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-13-cross-shift-duty-transfer-design.md`. Mockup of the approved behaviour: `docs/cross-shift-duty-transfer-mockup.html`.
- **Worktree:** work happens in `C:\Users\Admin\sentinel\.claude\worktrees\cross-shift-duty-transfer` on branch `feature/cross-shift-duty-transfer`. Per-task commits go to that branch, NOT `main`. The repo root checkout is the live production server — never commit there.
- **Python is the repo-root venv:** `C:\Users\Admin\sentinel\venv\Scripts\python.exe`. Run backend tests with cwd = `<worktree>\backend`.
- **Frontend commands** run from `<worktree>\frontend` via pnpm (`pnpm exec vitest run <path>`, `pnpm exec tsc -b --noEmit`).
- **Clean cutover:** `employee_ids`, `to_unit`, `to_post` disappear from the request contract. No compatibility shim, no deprecated alias, every caller migrated.
- **No DB migration.** `employees.duty_unit` / `duty_post` are untouched.
- **Arabic and English are peers.** Every new UI string lands in BOTH `frontend/src/locales/en.json` and `ar.json`; Arabic count-bearing strings use the `_zero/_one/_two/_few/_many/_other` plural family already used by `dutyLocations.selection.count`. Use logical CSS properties (`ms-*`, `me-*`, `ps-*`, `pe-*`, `border-s-*`) — never `ml-*`/`mr-*`.
- **Exact Arabic letter copy is frozen:** intro `_INTRO`, closings `_CLOSING_1` / `_CLOSING_2`, subject `النقل`, columns `["الرقم الوظيفي", "المسمى الوظيفي", "الاسم", "من", "إلى"]`, red header `#C00000`, spacer `<p>&nbsp;</p>`. Never edit these strings.
- **Location label format** is `unit - post`, or just `unit`, or `غير محدد` — produced by `duty_service._location_label`.
- No effective date and no reason anywhere: the letter says `إعتباراً من تاريخه`.

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/schemas/duty.py` | Request/result contract. Gains `DutyTransferMove`; `DutyTransferRequest.moves` replaces the three flat fields. |
| `backend/app/services/duty_service.py` | Per-row body builder + move resolution, validation, no-book branch, General Book call. |
| `backend/app/api/v1/duty.py` | Forwards `payload.moves`. |
| `backend/openapi.json` | Generated schema, committed. |
| `frontend/src/lib/api.ts` | Hand-mirrored `DutyTransferMove` / `DutyTransferRequest`. |
| `frontend/src/lib/api.types.ts` | Generated from `openapi.json`, committed. |
| `frontend/src/pages/dutyLocations/transferRequest.ts` | Pure request builder — trimming and empty-to-null normalisation. |
| `frontend/src/pages/dutyLocations/SelectionTray.tsx` | **New.** Sticky selection bar + expandable review panel grouped by current unit. |
| `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx` | Owns the selection set; stops clearing it on rail navigation; renders the tray. |
| `frontend/src/pages/dutyLocations/TransferDialog.tsx` | Bulk destination row + per-employee destination inputs + submit gate. |
| `frontend/src/pages/employees/TransferEmployeeDialog.tsx` | Single-employee profile dialog; sends a one-move list. |
| `frontend/src/locales/{en,ar}.json` | New selection + transfer strings. |

---

### Task 1: Backend contract, letter body, and move resolution

**Files:**
- Modify: `backend/app/schemas/duty.py` (whole file)
- Modify: `backend/app/services/duty_service.py` (module docstring, `_build_body_html`, `transfer`)
- Modify: `backend/app/api/v1/duty.py:30-38`
- Modify: `backend/openapi.json` (generated)
- Test: `backend/tests/test_duty_transfer_body.py` (exists — rewrite both tests, add one)
- Test: `backend/tests/test_duty_transfer_service.py` (exists — update three tests, add two)

**Interfaces:**
- Produces: `DutyTransferMove(employee_id: str, to_unit: str, to_post: str | None)` and `DutyTransferRequest(moves: list[DutyTransferMove], recipient_id: int | None, manager_id: int | None, cc: list[str] | None)`.
- Produces: `_build_body_html(rows: list[tuple[Employee, str, str | None]]) -> str` — positional single argument, no keyword args.
- Produces: `transfer(db, *, moves: list[DutyTransferMove], recipient_id=None, manager_id=None, cc=None, current_user=None) -> DutyTransferResult`.
- Produces: new error code `DUTY_DUPLICATE_EMPLOYEE`; keeps `DUTY_NO_EMPLOYEES`, `DUTY_NO_UNIT`, `DUTY_EMPLOYEE_NOT_FOUND`.
- `DutyTransferResult` is unchanged.

- [ ] **Step 1: Replace the request schema**

`backend/app/schemas/duty.py` — full new contents:

```python
"""Duty-transfer request/result schemas.

``POST /api/v1/duty/transfer`` moves one or more employees, EACH to its own
destination unit/post, and mints a General Book transfer letter (formal intro +
5-col red table + closing) as the audit record. One letter therefore covers a
whole transfer round: several source units, and a different destination per
employee (a swap). Contract is frozen — see the design doc.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class DutyTransferMove(BaseModel):
    """One employee's destination. ``to_post`` is optional (unit-only moves)."""

    employee_id: str = Field(min_length=1, max_length=16)  # Employee.id is String(16)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)


class DutyTransferRequest(BaseModel):
    # Bound the move list and free-text fields so one transfer can't generate a
    # runaway DOCX / DB write (API-02).
    moves: list[DutyTransferMove] = Field(min_length=1, max_length=500)
    # Official-letter metadata — fed into the General Book pipeline.
    recipient_id: int | None = None      # addressee (recipient_name)
    manager_id: int | None = None        # signing manager
    cc: list[str] | None = Field(default=None, max_length=50)  # printed CC names


class DutyTransferResult(BaseModel):
    book_id: int | None = None
    ref: str | None = None
    document_id: int | None = None
    moved: list[str]
```

- [ ] **Step 2: Rewrite the body tests**

`backend/tests/test_duty_transfer_body.py` — full new contents. Note the builder now takes ONE positional list of `(employee, to_unit, to_post)` tuples:

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
    html = _build_body_html([
        (_emp(), "السرية الثانية", "ليوان"),
        (_emp(id="G4017", name_ar="محمد سعيد", duty_unit="السرية الثانية", duty_post="تفتيش"),
         "السرية الثانية", "ليوان"),
    ])
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


def test_body_has_blank_line_around_table():
    html = _build_body_html([(_emp(), "السرية الثانية", "ليوان")])
    assert "<p>&nbsp;</p><table" in html      # blank line before the table
    assert "</table><p>&nbsp;</p>" in html    # blank line after the table


def test_each_row_carries_its_own_destination():
    """A swap: two employees exchange places in ONE letter."""
    a = _emp(id="G3309", name_ar="ماجد", duty_unit="السرية الأولى", duty_post="البوابة الرئيسية")
    b = _emp(id="G4030", name_ar="سيف", duty_unit="السرية الثانية", duty_post="التفتيش")
    html = _build_body_html([
        (a, "السرية الثانية", "التفتيش"),
        (b, "السرية الأولى", "البوابة الرئيسية"),
    ])
    rows = html.split("<tr>")
    # rows[0] is the pre-table markup, rows[1] the header row.
    assert "السرية الأولى - البوابة الرئيسية" in rows[2]  # من for G3309
    assert "السرية الثانية - التفتيش" in rows[2]          # إلى for G3309
    assert "السرية الثانية - التفتيش" in rows[3]          # من for G4030
    assert "السرية الأولى - البوابة الرئيسية" in rows[3]  # إلى for G4030
```

- [ ] **Step 3: Run the body tests to verify they fail**

Run (cwd `<worktree>\backend`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_body.py -v`
Expected: FAIL — the current `_build_body_html` requires `to_unit`/`to_post` keyword args, so passing a list of tuples raises `TypeError`.

- [ ] **Step 4: Implement the per-row body builder**

In `backend/app/services/duty_service.py`, replace `_build_body_html` (currently lines 71-95):

```python
def _build_body_html(rows: list[tuple[Employee, str, str | None]]) -> str:
    """Formal intro + a red-header from→to ``<table>`` + the two closing lines.

    Each row is ``(employee, to_unit, to_post)``. The ``من`` column reads the
    employee's CURRENT unit/post, so callers must build the body BEFORE staging
    the move; ``إلى`` is that row's OWN destination, which is what lets one
    letter cover several source units and even a swap. No effective date or
    reason is rendered — the letter uses ``إعتباراً من تاريخه`` verbatim (see
    the spec).
    """
    head = "".join(f'<th style="{_TH}">{html.escape(c)}</th>' for c in _COLS)
    out = [f"<tr>{head}</tr>"]
    for emp, to_unit, to_post in rows:
        cells = [
            html.escape(emp.id),
            html.escape((emp.position_ar or "").strip()),
            html.escape(_employee_display_name(emp)),
            html.escape(_location_label(emp.duty_unit, emp.duty_post)),
            html.escape(_location_label(to_unit, to_post)),
        ]
        out.append("<tr>" + "".join(f'<td style="{_TD}">{c}</td>' for c in cells) + "</tr>")
    table = '<table dir="rtl" style="border-collapse:collapse">' + "".join(out) + "</table>"

    intro = f"<p>{html.escape(_INTRO)}</p>"
    closing = f"<p>{html.escape(_CLOSING_1)}</p><p>{html.escape(_CLOSING_2)}</p>"
    return intro + _SPACER + table + _SPACER + closing
```

- [ ] **Step 5: Run the body tests to verify they pass**

Run: `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_body.py -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Update and extend the service tests**

`backend/tests/test_duty_transfer_service.py` — replace the three `duty_service.transfer(...)` call sites with `moves=[...]` and append two new tests. Add the import at the top: `from app.api.errors import ValidationFailedError` and `from app.schemas.duty import DutyTransferMove`, plus `import pytest`.

In `test_transfer_forwards_letter_metadata_and_moves`, the call becomes:

```python
    result = duty_service.transfer(
        db_session,
        moves=[DutyTransferMove(employee_id="G3309", to_unit="السرية الثانية", to_post="ليوان")],
        recipient_id=3,
        manager_id=5,
        cc=["مدراء الأفرع"],
    )
```

In `test_transfer_all_unassigned_skips_book`:

```python
    result = duty_service.transfer(
        db_session,
        moves=[
            DutyTransferMove(employee_id="G100", to_unit="السرية الأولى", to_post="ليوان"),
            DutyTransferMove(employee_id="G200", to_unit="السرية الثانية", to_post=None),
        ],
    )

    assert called["n"] == 0
    assert result.book_id is None and result.ref is None and result.document_id is None
    assert result.moved == ["G100", "G200"]
    # Each unassigned employee lands on ITS OWN destination.
    a = db_session.get(Employee, "G100")
    assert a.duty_unit == "السرية الأولى" and a.duty_post == "ليوان"
    b = db_session.get(Employee, "G200")
    assert b.duty_unit == "السرية الثانية" and b.duty_post is None
```

In `test_transfer_mixed_assignment_mints_book`:

```python
    result = duty_service.transfer(
        db_session,
        moves=[
            DutyTransferMove(employee_id="G100", to_unit="السرية الأولى", to_post=None),
            DutyTransferMove(employee_id="G300", to_unit="السرية الرابعة", to_post="ليوان"),
        ],
    )

    assert "fields" in captured  # book path taken (≥1 already placed)
    assert result.book_id == 11
    assert result.ref == "R-11"
    assert result.document_id == 22
```

Append:

```python
def test_transfer_moves_each_employee_to_its_own_destination(db_session, monkeypatch):
    """A swap in one letter: two employees exchange units."""
    db_session.add(
        Employee(id="G500", name_en="a", name_ar="أ", duty_unit="السرية الأولى", duty_post="ليوان")
    )
    db_session.add(
        Employee(id="G600", name_en="b", name_ar="ب", duty_unit="السرية الثانية", duty_post="تفتيش")
    )
    db_session.commit()

    captured = {}

    def fake_generate(
        db, *, employee_id, template_id, fields, current_user, commit, classification_code
    ):
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=1, ref_number="R-1", document_id=2)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    duty_service.transfer(
        db_session,
        moves=[
            DutyTransferMove(employee_id="G500", to_unit="السرية الثانية", to_post="تفتيش"),
            DutyTransferMove(employee_id="G600", to_unit="السرية الأولى", to_post="ليوان"),
        ],
    )

    # Both destinations appear in the single letter body.
    body = captured["fields"]["body"]
    assert "السرية الأولى - ليوان" in body
    assert "السرية الثانية - تفتيش" in body
    # And each employee actually landed on its own destination.
    assert db_session.get(Employee, "G500").duty_unit == "السرية الثانية"
    assert db_session.get(Employee, "G500").duty_post == "تفتيش"
    assert db_session.get(Employee, "G600").duty_unit == "السرية الأولى"
    assert db_session.get(Employee, "G600").duty_post == "ليوان"


def test_transfer_rejects_a_duplicate_employee(db_session, monkeypatch):
    """Two destinations for one person is ambiguous — refuse, don't guess."""
    _seed(db_session, id="G700")

    def fake_generate(*a, **k):
        raise AssertionError("generate_document must NOT be called for an invalid request")

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    with pytest.raises(ValidationFailedError) as err:
        duty_service.transfer(
            db_session,
            moves=[
                DutyTransferMove(employee_id="G700", to_unit="السرية الأولى", to_post=None),
                DutyTransferMove(employee_id="G700", to_unit="السرية الثانية", to_post=None),
            ],
        )

    assert err.value.code == "DUTY_DUPLICATE_EMPLOYEE"
    # Nothing moved.
    assert db_session.get(Employee, "G700").duty_unit == "السرية الخامسة"
```

- [ ] **Step 7: Run the service tests to verify they fail**

Run: `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_service.py -v`
Expected: FAIL — `transfer()` still takes `employee_ids`/`to_unit`/`to_post`, so every call raises `TypeError`.

If `err.value.code` turns out not to be the attribute name on `ValidationFailedError`, read `backend/app/api/errors.py` and assert on the actual attribute rather than inventing one.

- [ ] **Step 8: Implement `transfer()`**

In `backend/app/services/duty_service.py`:

Add the schema import next to the existing one:

```python
from app.schemas.duty import DutyTransferMove, DutyTransferResult
```

Replace the whole `transfer` function (currently lines 98-186) with:

```python
def transfer(
    db: Session,
    *,
    moves: list[DutyTransferMove],
    recipient_id: int | None = None,
    manager_id: int | None = None,
    cc: list[str] | None = None,
    current_user: User | None = None,
) -> DutyTransferResult:
    """Move each employee to its own ``to_unit``/``to_post`` and mint the letter.

    Raises ``ValidationFailedError`` (422) on an empty move list, a blank
    ``to_unit``, a repeated employee, or an unknown employee id.
    """
    if not moves:
        raise ValidationFailedError("DUTY_NO_EMPLOYEES", "At least one employee is required")

    # Resolve every move in request order (which is the letter's row order):
    # normalise the destination, refuse a repeated employee (two destinations for
    # one person is ambiguous — the operator, not us, decides), and load the row
    # so an unknown id fails before anything is written.
    rows: list[tuple[Employee, str, str | None]] = []
    seen: set[str] = set()
    for move in moves:
        to_unit = (move.to_unit or "").strip()
        if not to_unit:
            raise ValidationFailedError("DUTY_NO_UNIT", "Destination unit is required")
        to_post = move.to_post.strip() if move.to_post and move.to_post.strip() else None
        if move.employee_id in seen:
            raise ValidationFailedError(
                "DUTY_DUPLICATE_EMPLOYEE",
                f"Employee {move.employee_id!r} appears more than once",
                id=move.employee_id,
            )
        seen.add(move.employee_id)
        emp = db.get(Employee, move.employee_id)
        if emp is None:
            raise ValidationFailedError(
                "DUTY_EMPLOYEE_NOT_FOUND",
                f"Employee {move.employee_id!r} does not exist",
                id=move.employee_id,
            )
        rows.append((emp, to_unit, to_post))

    # No-book path: when EVERY selected employee is currently unassigned, this is
    # initial placement, not a transfer needing a formal letter — just move them.
    if all(not (emp.duty_unit or "").strip() for emp, _, _ in rows):
        for emp, to_unit, to_post in rows:
            emp.duty_unit = to_unit
            emp.duty_post = to_post
        db.commit()
        return DutyTransferResult(moved=[emp.id for emp, _, _ in rows])

    # Otherwise mint the transfer letter. Build the body from CURRENT (FROM)
    # locations BEFORE mutating.
    body_html = _build_body_html(rows)

    # Stage the moves on this session; generate_document's single commit
    # persists them together with the doc/Book rows.
    for emp, to_unit, to_post in rows:
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
        employee_id=None,  # admin form — no bound employee
        template_id="General Book",
        fields=fields,
        current_user=current_user,
        commit=True,
        # Transfer letters file under شؤون القوة (Force affairs) in the
        # government classification index; every General Book ref now comes
        # from the classified register.
        classification_code="12/1",
    )

    return DutyTransferResult(
        book_id=result.book_id,
        ref=result.ref_number,
        document_id=result.document_id,
        moved=[emp.id for emp, _, _ in rows],
    )
```

Update the module docstring's first paragraph (lines 1-13) so it describes the new shape — replace `moves one or more employees to a destination duty unit/post` with `moves one or more employees, each to its own destination duty unit/post,` and add after the `Subject constant` sentence: `One letter covers a whole transfer round: employees may come from different units and each row carries its own destination, which is exactly what the letter's fixed intro promises (إلى الجهات المبينة بجانب أسمائهم).`

- [ ] **Step 9: Forward the new payload from the endpoint**

In `backend/app/api/v1/duty.py`, replace the `duty_service.transfer(...)` call body (lines 30-38):

```python
    return duty_service.transfer(
        db,
        moves=payload.moves,
        recipient_id=payload.recipient_id,
        manager_id=payload.manager_id,
        cc=payload.cc,
        current_user=user,
    )
```

Also update the module docstring line 3-4: `move employee(s) to a destination unit/post` → `move employee(s), each to its own destination unit/post,`.

- [ ] **Step 10: Run both backend test files to verify they pass**

Run: `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_body.py tests/test_duty_transfer_service.py -v`
Expected: PASS (3 + 5 tests).

- [ ] **Step 11: Lint, typecheck, and regenerate the schema**

From the worktree root:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py backend/tests/test_duty_transfer_body.py backend/tests/test_duty_transfer_service.py
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe format --check backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py
C:\Users\Admin\sentinel\venv\Scripts\mypy.exe
C:\Users\Admin\sentinel\venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
```

Expected: ruff clean, mypy clean, and `Wrote ...\backend\openapi.json (N paths)`.

- [ ] **Step 12: Commit**

```bash
git add backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py backend/openapi.json backend/tests/test_duty_transfer_body.py backend/tests/test_duty_transfer_service.py
git commit -m "feat(duty): per-employee destinations on the transfer contract"
```

---

### Task 2: Frontend contract mirror and request builder

**Files:**
- Modify: `frontend/src/lib/api.ts:202-211`
- Modify: `frontend/src/lib/api.types.ts` (generated)
- Modify: `frontend/src/pages/dutyLocations/transferRequest.ts` (whole file)
- Test: `frontend/src/pages/dutyLocations/transferRequest.test.ts` (exists — rewrite)

**Interfaces:**
- Consumes: Task 1's `DutyTransferRequest` JSON shape.
- Produces: `DutyTransferMove { employee_id: string; to_unit: string; to_post: string | null }` and `DutyTransferRequest { moves: DutyTransferMove[]; recipient_id: number | null; manager_id: number | null; cc: string[] | null }` exported from `@/lib/api`.
- Produces: `TransferMoveInput { employeeId: string; toUnit: string; toPost: string }` and `buildTransferRequest({ moves, recipientId, managerId, cc })`, both exported from `./transferRequest`. Tasks 4 and 5 consume these.

- [ ] **Step 1: Rewrite the builder test**

`frontend/src/pages/dutyLocations/transferRequest.test.ts` — full new contents:

```ts
// frontend/src/pages/dutyLocations/transferRequest.test.ts
import { describe, expect, it } from 'vitest'
import { buildTransferRequest } from './transferRequest'

describe('buildTransferRequest', () => {
  it('keeps one destination per employee and normalizes empties', () => {
    expect(
      buildTransferRequest({
        moves: [
          { employeeId: 'G1', toUnit: '  السرية الثانية  ', toPost: '  ' },
          { employeeId: 'G2', toUnit: 'السرية الأولى', toPost: ' ليوان ' },
        ],
        recipientId: 3,
        managerId: null,
        cc: ['مدراء الأفرع'],
      }),
    ).toEqual({
      moves: [
        { employee_id: 'G1', to_unit: 'السرية الثانية', to_post: null },
        { employee_id: 'G2', to_unit: 'السرية الأولى', to_post: 'ليوان' },
      ],
      recipient_id: 3,
      manager_id: null,
      cc: ['مدراء الأفرع'],
    })
  })

  it('sends null cc when the list is empty', () => {
    const req = buildTransferRequest({
      moves: [{ employeeId: 'G1', toUnit: 'X', toPost: 'Y' }],
      recipientId: null, managerId: null, cc: [],
    })
    expect(req.cc).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run (cwd `<worktree>\frontend`): `pnpm exec vitest run src/pages/dutyLocations/transferRequest.test.ts`
Expected: FAIL — the builder still expects `employeeIds`/`toUnit`/`toPost` at the top level and emits `employee_ids`.

- [ ] **Step 3: Update the API types**

In `frontend/src/lib/api.ts`, replace lines 202-211 (the comment plus `DutyTransferRequest`):

```ts
// Duty Locations & Internal Transfers — frozen API contract (backend in
// parallel; hand-mirrored until `gen:api`). One transfer letter carries one
// move per employee, so a round can span source units and even swap two people.
export interface DutyTransferMove {
  employee_id: string
  to_unit: string
  to_post: string | null
}

export interface DutyTransferRequest {
  moves: DutyTransferMove[]
  recipient_id: number | null
  manager_id: number | null
  cc: string[] | null
}
```

Leave `DutyTransferResult` (lines 213-218) untouched.

- [ ] **Step 4: Rewrite the builder**

`frontend/src/pages/dutyLocations/transferRequest.ts` — full new contents:

```ts
/**
 * Pure builder for the `/duty/transfer` request body, kept in its own module so
 * the TransferDialog component file only exports a component (react-refresh).
 */
import type { DutyTransferRequest } from '@/lib/api'

/** One row of the transfer dialog: who moves, and where to. */
export interface TransferMoveInput {
  employeeId: string
  toUnit: string
  toPost: string
}

export function buildTransferRequest(input: {
  moves: readonly TransferMoveInput[]
  recipientId: number | null
  managerId: number | null
  cc: readonly string[]
}): DutyTransferRequest {
  return {
    moves: input.moves.map((m) => ({
      employee_id: m.employeeId,
      to_unit: m.toUnit.trim(),
      to_post: m.toPost.trim() || null,
    })),
    recipient_id: input.recipientId,
    manager_id: input.managerId,
    cc: input.cc.length > 0 ? [...input.cc] : null,
  }
}
```

- [ ] **Step 5: Run the builder test to verify it passes**

Run: `pnpm exec vitest run src/pages/dutyLocations/transferRequest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Regenerate the generated types**

Run (cwd `<worktree>\frontend`): `pnpm run gen:api`
Expected: `frontend/src/lib/api.types.ts` now contains `DutyTransferMove` and a `DutyTransferRequest` with a `moves` array. `pnpm exec tsc -b --noEmit` will still fail here — the two dialogs are updated in Tasks 4 and 5. That is expected; do not "fix" them in this task.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.types.ts frontend/src/pages/dutyLocations/transferRequest.ts frontend/src/pages/dutyLocations/transferRequest.test.ts
git commit -m "feat(duty): mirror the per-move transfer contract in the frontend"
```

---

### Task 3: Cross-unit selection and the review tray

**Files:**
- Create: `frontend/src/pages/dutyLocations/SelectionTray.tsx`
- Modify: `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx` (`selectUnit`, the inline sticky bar, imports)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (`dutyLocations.selection.*`)
- Test: `frontend/src/pages/dutyLocations/DutyLocationsPage.crossUnit.test.tsx` (create)

**Interfaces:**
- Produces: `SelectionTray({ employees, onRemove, onClear, onTransfer })` from `./SelectionTray`, where `employees: readonly EmployeeListItem[]` is the resolved selection across all units.
- Consumes: `groupByUnit`, `UNASSIGNED` from `@/lib/dutyUnits`; `pickEmployeeName` from `@/lib/employeeName`; `cn` from `@/lib/utils`.
- Does NOT touch the request contract or `TransferDialog`.

- [ ] **Step 1: Write the failing page test**

`frontend/src/pages/dutyLocations/DutyLocationsPage.crossUnit.test.tsx`:

```tsx
/**
 * The selection is a transfer basket, not a per-unit filter: it must survive
 * walking the unit rail, and the tray must let the operator review and drop
 * people who are no longer on screen.
 *
 * Uses the real English bundle (like DutyLocationsPage.completion.test.tsx), so
 * every row's accessible name is unique — no index juggling.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { DutyLocationsPage } from './DutyLocationsPage'

vi.mock('@/lib/api', () => ({ api: { listEmployees: vi.fn() } }))
vi.mock('./AssignPopover', () => ({ AssignPopover: () => null }))
vi.mock('./SupervisorDesignations', () => ({ SupervisorDesignations: () => null }))
vi.mock('./LeaveDigestPanel', () => ({ LeaveDigestPanel: () => null }))
vi.mock('./TransferDialog', () => ({ TransferDialog: () => null }))

const ROSTER = [
  { id: 'G3309', name_en: 'Mohammed Saeed', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'البوابة الرئيسية' },
  { id: 'G3318', name_en: 'Omar Abdulrahman', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'برج المراقبة' },
  { id: 'G4030', name_en: 'Saif Mubarak', name_ar: null, duty_unit: 'السرية الثانية', duty_post: 'التفتيش' },
]

beforeEach(() => {
  vi.mocked(api.listEmployees).mockResolvedValue({ items: ROSTER, total: ROSTER.length } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/duty-locations']}>
        <DutyLocationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('selection survives switching units and the tray drops an off-screen pick', async () => {
  const user = userEvent.setup()
  renderPage()

  // Two picks in السرية الأولى (the first populated unit, shown by default).
  await user.click(await screen.findByLabelText('Select Mohammed Saeed'))
  await user.click(screen.getByLabelText('Select Omar Abdulrahman'))
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()

  // Walk the rail — the basket must NOT be cleared.
  await user.click(screen.getByRole('button', { name: /السرية الثانية/ }))
  await screen.findByLabelText('Select Saif Mubarak')
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()

  // Add one from this unit: 3 people across 2 units.
  await user.click(screen.getByLabelText('Select Saif Mubarak'))
  const counter = screen.getByRole('button', { name: /3 selected/ })
  expect(counter).toHaveAccessibleName(/2 units/)

  // Review the whole basket, grouped by current unit.
  await user.click(counter)
  const panel = screen.getByTestId('duty-selection-panel')
  expect(within(panel).getByText('G3309')).toBeInTheDocument()
  expect(within(panel).getByText('G4030')).toBeInTheDocument()
  expect(within(panel).getByText('السرية الأولى')).toBeInTheDocument()
  expect(within(panel).getByText('السرية الثانية')).toBeInTheDocument()

  // Drop someone from the unit we are NOT standing in.
  await user.click(
    within(panel).getByRole('button', { name: 'Remove Mohammed Saeed from the selection' }),
  )
  await waitFor(() =>
    expect(within(screen.getByTestId('duty-selection-panel')).queryByText('G3309')).toBeNull(),
  )
  expect(screen.getByRole('button', { name: /2 selected/ })).toBeInTheDocument()
})
```

Notes: `RosterTable` labels each row checkbox `Select {{name}}` and the tray labels each remove button `Remove {{name}} from the selection`, so with the real English bundle every query is unambiguous. `UnitRail` is NOT mocked here — the test needs real rail buttons to click. `TransferDialog` is mocked to `null` because this test never opens it.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/pages/dutyLocations/DutyLocationsPage.crossUnit.test.tsx`
Expected: FAIL — switching units clears the selection, and there is no `duty-selection-panel`.

- [ ] **Step 3: Add the i18n strings**

In `frontend/src/locales/en.json`, inside `dutyLocations.selection`, add after `"clear"`:

```json
      "units_one": "1 unit",
      "units_other": "{{count}} units",
      "trayTitle": "Selected employees",
      "trayToggle": "Show or hide the selected list",
      "remove": "Remove {{name}} from the selection",
```

In `frontend/src/locales/ar.json`, inside `dutyLocations.selection`, add after `"clear"`:

```json
      "units_one": "وحدة واحدة",
      "units_two": "وحدتان",
      "units_few": "{{count}} وحدات",
      "units_many": "{{count}} وحدة",
      "units_other": "{{count}} وحدة",
      "trayTitle": "الموظفون المحددون",
      "trayToggle": "عرض أو إخفاء قائمة المحددين",
      "remove": "إزالة {{name}} من التحديد",
```

- [ ] **Step 4: Create the tray**

`frontend/src/pages/dutyLocations/SelectionTray.tsx`:

```tsx
/**
 * SelectionTray — the sticky bar for the roster selection plus an expandable
 * review panel.
 *
 * The selection is a transfer basket that spans duty units: the operator ticks
 * people in one unit, walks the rail, and keeps ticking. Earlier picks are then
 * off-screen, so the panel lists everyone currently selected — grouped by their
 * CURRENT unit — and lets them be dropped without navigating back.
 *
 * Selection state is owned by DutyLocationsPage; this component renders it and
 * reports intent.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronUp, X } from 'lucide-react'

import type { EmployeeListItem } from '@/lib/api'
import { UNASSIGNED, groupByUnit } from '@/lib/dutyUnits'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

export interface SelectionTrayProps {
  /** The resolved selection — may span any number of duty units. */
  employees: readonly EmployeeListItem[]
  onRemove: (id: string) => void
  onClear: () => void
  onTransfer: () => void
}

export function SelectionTray({
  employees,
  onRemove,
  onClear,
  onTransfer,
}: SelectionTrayProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  // Esc collapses the panel. It never clears the basket — that's what Clear is
  // for, and losing a cross-unit selection to a stray keypress would hurt.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Seed-first unit order, Unassigned last — the same grouping the roster uses.
  const grouped = groupByUnit(employees)

  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      {open && (
        <div
          id="duty-selection-panel"
          data-testid="duty-selection-panel"
          className="max-h-[45vh] overflow-y-auto border-t border-border bg-surface shadow-lg"
        >
          <div className="sticky top-0 border-b border-hairline bg-surface px-4 py-2.5 text-[0.78em] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-6">
            {t('dutyLocations.selection.trayTitle')}
          </div>
          {[...grouped.entries()].map(([unit, posts]) => (
            <div key={unit} className="py-1">
              <div
                className="px-4 pb-0.5 pt-2 text-[0.8em] font-bold text-primary sm:px-6"
                dir="auto"
              >
                {unit === UNASSIGNED ? t('dutyLocations.unassigned') : unit}
              </div>
              {[...posts.values()].flat().map((e) => {
                const name = pickEmployeeName(e, i18n.language)
                return (
                  <div
                    key={e.id}
                    className="flex items-center gap-2.5 px-4 py-1.5 text-[0.88em] hover:bg-surface-tinted sm:px-6"
                  >
                    <span className="font-mono font-semibold text-primary">{e.id}</span>
                    <span dir="auto">{name}</span>
                    {e.duty_post && (
                      <span className="text-[0.85em] text-faint" dir="auto">
                        {e.duty_post}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(e.id)}
                      aria-label={t('dutyLocations.selection.remove', { name })}
                      className="ms-auto rounded-md p-1 text-faint hover:bg-accent-soft hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-primary/40 bg-primary px-4 py-3 text-primary-foreground shadow-lg sm:px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="duty-selection-panel"
          title={t('dutyLocations.selection.trayToggle')}
          className="inline-flex items-center gap-2 rounded-md border border-white/40 px-3 py-1.5 font-semibold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <ChevronUp
            className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
          {t('dutyLocations.selection.count', { count: employees.length })}
          <span className="text-[0.82em] font-normal opacity-90">
            · {t('dutyLocations.selection.units', { count: grouped.size })}
          </span>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-md border border-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          {t('dutyLocations.selection.clear')}
        </button>
        <button
          type="button"
          onClick={onTransfer}
          className="ms-auto rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-primary hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {t('dutyLocations.selection.transfer')}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the page**

In `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx`:

1. Add the import next to the other page-local imports (after the `TransferDialog` import): `import { SelectionTray } from './SelectionTray'`.
2. Remove the now-unused `X` from the `lucide-react` import, leaving `import { Search } from 'lucide-react'`.
3. Replace the `selectUnit` function (lines 144-147) with:

```tsx
  // The selection is a transfer basket, NOT a view filter: it deliberately
  // survives rail navigation so one letter can gather people from several units.
  function selectUnit(key: string): void {
    setActiveKey(key)
  }
```

4. Update the selection comment on line 51 to `// Selection (employee ids) — a transfer basket that spans units.`
5. Replace the whole sticky-bar block (lines 249-274, from the `{/* Sticky selection bar */}` comment through its closing `)}`) with:

```tsx
      {/* Sticky selection bar + cross-unit review tray */}
      {selected.size > 0 && (
        <SelectionTray
          employees={selectedEmployees}
          onRemove={(id) => toggle(id, false)}
          onClear={() => setSelected(new Set())}
          onTransfer={() => setTransferOpen(true)}
        />
      )}
```

- [ ] **Step 6: Run the page test to verify it passes**

Run: `pnpm exec vitest run src/pages/dutyLocations/DutyLocationsPage.crossUnit.test.tsx src/pages/dutyLocations/DutyLocationsPage.completion.test.tsx`
Expected: PASS — the new test plus the existing completion test (which mocks `TransferDialog` and must be unaffected).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/dutyLocations/SelectionTray.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.crossUnit.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(duty): keep the roster selection across units with a review tray"
```

---

### Task 4: Per-employee destinations in the transfer dialog

**Files:**
- Modify: `frontend/src/pages/dutyLocations/TransferDialog.tsx` (whole component)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (`dutyLocations.transfer.*`)
- Test: `frontend/src/pages/dutyLocations/TransferDialog.test.tsx` (create)

**Interfaces:**
- Consumes: `buildTransferRequest({ moves, recipientId, managerId, cc })` and `TransferMoveInput` from `./transferRequest` (Task 2).
- Keeps `TransferDialogProps` exactly as it is today (`open`, `employees`, `allEmployees`, `onOpenChange`, `onTransferred`) — the page is not changed by this task.

- [ ] **Step 1: Add the i18n strings**

In `frontend/src/locales/en.json`, inside `dutyLocations.transfer`, add after `"destPost"`:

```json
      "bulkLabel": "Same destination for everyone",
      "applyToAll": "Apply to all",
      "rowFrom": "From",
      "rowUnitAria": "Destination unit for {{name}}",
      "rowPostAria": "Destination post for {{name}}",
      "missingUnit": "Choose a destination unit for every employee.",
```

In `frontend/src/locales/ar.json`, inside `dutyLocations.transfer`, add after `"destPost"`:

```json
      "bulkLabel": "وجهة واحدة للجميع",
      "applyToAll": "تطبيق على الجميع",
      "rowFrom": "من",
      "rowUnitAria": "الوحدة الجديدة لـ {{name}}",
      "rowPostAria": "النقطة الجديدة لـ {{name}}",
      "missingUnit": "اختر وحدة جديدة لكل موظف.",
```

- [ ] **Step 2: Write the failing dialog test**

`frontend/src/pages/dutyLocations/TransferDialog.test.tsx`:

```tsx
/**
 * TransferDialog destination tests: the operator sets a destination per
 * employee, "apply to all" is a shortcut for the common mass move, and a row
 * without a unit blocks the whole letter.
 *
 * Uses the real English bundle so each row's inputs are labelled
 * "Destination unit for <name>" — unambiguous without index juggling. Note
 * getByLabelText does an exact match, so the bulk row's plain
 * "Destination unit" never collides with a row's longer label.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { TransferDialog } from './TransferDialog'

vi.mock('@/lib/api', () => ({
  api: { transferDuty: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./transferDefaults', () => ({
  loadTransferDefaults: () => ({ recipientId: null, managerId: null, cc: [] }),
  saveTransferDefaults: vi.fn(),
}))
vi.mock('@/components/application/fields/RecipientPickerField', () => ({ RecipientPickerField: () => null }))
vi.mock('@/components/application/fields/ManagerPickerField', () => ({ ManagerPickerField: () => null }))
vi.mock('@/components/application/fields/MultiRecipientPickerField', () => ({ MultiRecipientPickerField: () => null }))

const A = { id: 'G3309', name_en: 'Mohammed Saeed', name_ar: null, duty_unit: 'السرية الأولى', duty_post: 'البوابة الرئيسية' }
const B = { id: 'G4030', name_en: 'Saif Mubarak', name_ar: null, duty_unit: 'السرية الثانية', duty_post: 'التفتيش' }

beforeEach(() => {
  vi.mocked(api.transferDuty).mockResolvedValue({
    moved: ['G3309', 'G4030'], book_id: 7, ref: 'GB-1', document_id: 9,
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <TransferDialog
        open
        employees={[A, B] as never}
        allEmployees={[A, B] as never}
        onOpenChange={() => {}}
        onTransferred={() => {}}
      />
    </QueryClientProvider>,
  )
}

const generateBtn = () => screen.getByRole('button', { name: /Generate General Book letter/ })

test('a row without a destination unit blocks the letter', async () => {
  const user = userEvent.setup()
  renderDialog()
  expect(generateBtn()).toBeDisabled()
  expect(
    screen.getByText('Choose a destination unit for every employee.'),
  ).toBeInTheDocument()

  // Fill only the first row — still blocked by the second.
  await user.type(screen.getByLabelText('Destination unit for Mohammed Saeed'), 'السرية الرابعة')
  expect(generateBtn()).toBeDisabled()
})

test('apply to all fills every row and a per-row edit overrides it', async () => {
  const user = userEvent.setup()
  renderDialog()

  await user.type(screen.getByLabelText('Destination unit'), 'السرية الرابعة')
  await user.type(screen.getByLabelText('Destination post'), 'البوابة الرئيسية')
  await user.click(screen.getByRole('button', { name: 'Apply to all' }))

  const rowA = screen.getByLabelText('Destination unit for Mohammed Saeed') as HTMLInputElement
  const rowB = screen.getByLabelText('Destination unit for Saif Mubarak') as HTMLInputElement
  expect(rowA.value).toBe('السرية الرابعة')
  expect(rowB.value).toBe('السرية الرابعة')
  expect(generateBtn()).toBeEnabled()

  // Override the second row — a swap into the first employee's old unit.
  await user.clear(rowB)
  await user.type(rowB, 'السرية الأولى')
  await user.type(screen.getByLabelText('Destination post for Saif Mubarak'), 'برج المراقبة')

  await user.click(generateBtn())
  await waitFor(() => expect(api.transferDuty).toHaveBeenCalled())
  expect(vi.mocked(api.transferDuty).mock.calls[0][0]).toEqual({
    moves: [
      { employee_id: 'G3309', to_unit: 'السرية الرابعة', to_post: 'البوابة الرئيسية' },
      { employee_id: 'G4030', to_unit: 'السرية الأولى', to_post: 'برج المراقبة' },
    ],
    recipient_id: null,
    manager_id: null,
    cc: null,
  })
})

test('changing a row unit clears that row post', async () => {
  const user = userEvent.setup()
  renderDialog()
  const rowA = screen.getByLabelText('Destination unit for Mohammed Saeed')
  await user.type(rowA, 'السرية الرابعة')
  await user.type(screen.getByLabelText('Destination post for Mohammed Saeed'), 'البوابة الرئيسية')
  await user.clear(rowA)
  await user.type(rowA, 'السرية الثالثة')
  expect(
    (screen.getByLabelText('Destination post for Mohammed Saeed') as HTMLInputElement).value,
  ).toBe('')
})
```

Note: `user.clear()` fires a change with an empty value, which the row's unit handler treats like any other edit — it clears the post too, which is exactly what the third test asserts. The dialog is mounted directly (no `MemoryRouter`) because it never navigates: the "view record" route lives on the page's `SavedRecordActions`.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec vitest run src/pages/dutyLocations/TransferDialog.test.tsx`
Expected: FAIL — there is a single destination form, no `applyToAll` button, and no per-row inputs.

- [ ] **Step 4: Rewrite the dialog**

`frontend/src/pages/dutyLocations/TransferDialog.tsx` — replace the file's docstring, imports, and component with:

```tsx
/**
 * TransferDialog — move the selected employees to their own destination
 * unit/post and generate ONE General Book transfer letter.
 *
 * The selection can span duty units, and every employee gets their own
 * destination: that is what the letter's fixed intro already promises ("إلى
 * الجهات المبينة بجانب أسمائهم") and it is what makes a swap expressible. A
 * bulk row fills every destination at once for the common mass move; the
 * per-row inputs override it. On confirm it POSTs `/duty/transfer`; on success
 * it toasts a short confirmation and reports the complete transfer result
 * before closing.
 */

import { useId, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type DutyTransferResult, type EmployeeListItem } from '@/lib/api'
import { unitOptions, postsForUnit } from '@/lib/dutyUnits'
import { buildTransferRequest } from './transferRequest'
import { loadTransferDefaults, saveTransferDefaults } from './transferDefaults'
import { RecipientPickerField } from '@/components/application/fields/RecipientPickerField'
import { ManagerPickerField } from '@/components/application/fields/ManagerPickerField'
import { MultiRecipientPickerField } from '@/components/application/fields/MultiRecipientPickerField'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pickEmployeeName } from '@/lib/employeeName'

// ─── component ───────────────────────────────────────────────────────────────

/** One employee's destination while the operator is still editing it. */
interface Destination {
  unit: string
  post: string
}

const EMPTY: Destination = { unit: '', post: '' }
const FIELD =
  'h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export interface TransferDialogProps {
  open: boolean
  /** The employees being moved (the current selection, possibly cross-unit). */
  employees: readonly EmployeeListItem[]
  /** All roster employees — used to derive destination suggestions. */
  allEmployees: readonly EmployeeListItem[]
  onOpenChange: (open: boolean) => void
  /** Called after a successful transfer with its complete result. */
  onTransferred: (result: DutyTransferResult) => void
}

export function TransferDialog({
  open,
  employees,
  allEmployees,
  onOpenChange,
  onTransferred,
}: TransferDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const unitListId = useId()
  const postListId = useId()

  // The bulk row is a shortcut, not a source of truth: it only writes into the
  // rows when "apply to all" is pressed, so a later per-row edit is never
  // silently overwritten.
  const [bulk, setBulk] = useState<Destination>(EMPTY)
  const [dest, setDest] = useState<Record<string, Destination>>({})

  const units = unitOptions(allEmployees)
  const bulkPosts = postsForUnit(allEmployees, bulk.unit.trim())

  function setRow(id: string, patch: Partial<Destination>): void {
    setDest((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY), ...patch } }))
  }

  const moves = employees.map((e) => {
    const d = dest[e.id] ?? EMPTY
    return { employeeId: e.id, toUnit: d.unit, toPost: d.post }
  })
  const missing = moves.filter((m) => !m.toUnit.trim()).length

  const [initial] = useState(loadTransferDefaults)
  const methods = useForm<{ recipient_id: number | null; manager_id: number | null; cc: string[] }>({
    defaultValues: { recipient_id: initial.recipientId, manager_id: initial.managerId, cc: initial.cc },
  })

  const mutation = useMutation({
    mutationFn: () => {
      const v = methods.getValues()
      return api.transferDuty(
        buildTransferRequest({
          moves,
          recipientId: v.recipient_id,
          managerId: v.manager_id,
          cc: v.cc,
        }),
      )
    },
    onSuccess: (result) => {
      const v = methods.getValues()
      saveTransferDefaults({ recipientId: v.recipient_id, managerId: v.manager_id, cc: v.cc })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      if (result.book_id == null) {
        toast.success(t('dutyLocations.transfer.movedNoBook', { count: result.moved.length }))
      } else {
        toast.success(t('dutyLocations.transfer.success', { ref: result.ref }))
      }
      onTransferred(result)
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const canSubmit = employees.length > 0 && missing === 0 && !mutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('dutyLocations.transfer.title')}</DialogTitle>
          <DialogDescription>
            {t('dutyLocations.transfer.subtitle', { count: employees.length })}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
            {/* Bulk destination — the mass-move shortcut */}
            <div className="rounded-lg border border-border bg-surface-raised p-3">
              <span className="mb-2 block text-xs font-semibold text-muted-foreground">
                {t('dutyLocations.transfer.bulkLabel')}
              </span>
              <div className="grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  list={unitListId}
                  value={bulk.unit}
                  dir="auto"
                  autoComplete="off"
                  aria-label={t('dutyLocations.transfer.destUnit')}
                  placeholder={t('dutyLocations.field.unitPlaceholder')}
                  onChange={(e) => setBulk({ unit: e.target.value, post: '' })}
                  className={FIELD}
                />
                <input
                  list={`${postListId}-bulk`}
                  value={bulk.post}
                  dir="auto"
                  autoComplete="off"
                  aria-label={t('dutyLocations.transfer.destPost')}
                  placeholder={t('dutyLocations.field.postPlaceholder')}
                  onChange={(e) => setBulk((b) => ({ ...b, post: e.target.value }))}
                  className={FIELD}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!bulk.unit.trim()}
                  onClick={() =>
                    setDest(Object.fromEntries(employees.map((e) => [e.id, { ...bulk }])))
                  }
                >
                  {t('dutyLocations.transfer.applyToAll')}
                </Button>
              </div>
              <datalist id={`${postListId}-bulk`}>
                {bulkPosts.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>

            {/* One destination per employee */}
            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-hairline">
              {employees.map((e) => {
                const d = dest[e.id] ?? EMPTY
                const name = pickEmployeeName(e, i18n.language)
                return (
                  <div
                    key={e.id}
                    className={cn(
                      'grid items-center gap-2.5 border-t border-hairline px-3 py-2.5 first:border-t-0',
                      'sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]',
                      !d.unit.trim() && 'bg-warning-soft',
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono font-semibold text-primary">{e.id}</span>
                      <span dir="auto">{name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground" dir="auto">
                      {t('dutyLocations.transfer.rowFrom')}:{' '}
                      {e.duty_unit
                        ? `${e.duty_unit}${e.duty_post ? ` - ${e.duty_post}` : ''}`
                        : t('dutyLocations.unassigned')}
                    </div>
                    <input
                      list={unitListId}
                      value={d.unit}
                      dir="auto"
                      autoComplete="off"
                      aria-label={t('dutyLocations.transfer.rowUnitAria', { name })}
                      placeholder={t('dutyLocations.transfer.destUnit')}
                      onChange={(ev) => setRow(e.id, { unit: ev.target.value, post: '' })}
                      className={FIELD}
                    />
                    <input
                      list={`${postListId}-${e.id}`}
                      value={d.post}
                      dir="auto"
                      autoComplete="off"
                      aria-label={t('dutyLocations.transfer.rowPostAria', { name })}
                      placeholder={t('dutyLocations.transfer.destPost')}
                      onChange={(ev) => setRow(e.id, { post: ev.target.value })}
                      className={FIELD}
                    />
                    <datalist id={`${postListId}-${e.id}`}>
                      {postsForUnit(allEmployees, d.unit.trim()).map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                )
              })}
            </div>

            {/* Letter metadata */}
            <div className="grid gap-3 md:grid-cols-2">
              <RecipientPickerField name="recipient_id" label_en="To (Recipient)" label_ar="إلى (المستلم)" required={false} />
              <ManagerPickerField name="manager_id" label_en="Signing Manager" label_ar="المدير الموقع" required={false} />
              <div className="md:col-span-2">
                <MultiRecipientPickerField name="cc" label_en="CC (optional)" label_ar="نسخة إلى (اختياري)" required={false} />
              </div>
            </div>

            <datalist id={unitListId}>
              {units.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
        </FormProvider>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          {missing > 0 && (
            <span className="me-auto text-xs text-warning">
              {t('dutyLocations.transfer.missingUnit')}
            </span>
          )}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="commit"
            size="commit"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {t('dutyLocations.transfer.generate')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
```

- [ ] **Step 5: Run the dialog test to verify it passes**

Run: `pnpm exec vitest run src/pages/dutyLocations/TransferDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/dutyLocations/TransferDialog.tsx frontend/src/pages/dutyLocations/TransferDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(duty): set a destination per employee in the transfer dialog"
```

---

### Task 5: Employee-profile dialog sends a one-move list

**Files:**
- Modify: `frontend/src/pages/employees/TransferEmployeeDialog.tsx:74-83`
- Test: `frontend/src/pages/employees/TransferEmployeeDialog.test.tsx:61-64`

**Interfaces:**
- Consumes: `buildTransferRequest({ moves, recipientId, managerId, cc })` from `@/pages/dutyLocations/transferRequest` (Task 2).
- No visual change: this dialog still has ONE destination unit/post, and the "issue transfer letter" checkbox still chooses between `POST /duty/transfer` and a plain `PATCH`.

- [ ] **Step 1: Update the test expectation**

In `frontend/src/pages/employees/TransferEmployeeDialog.test.tsx`, replace the payload assertion (lines 61-64):

```ts
  expect(vi.mocked(api.transferDuty).mock.calls[0][0]).toMatchObject({
    moves: [{ employee_id: 'G100', to_unit: 'السرية الثانية' }],
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run src/pages/employees/TransferEmployeeDialog.test.tsx`
Expected: FAIL — the payload still has `employee_ids` / `to_unit` at the top level.

- [ ] **Step 3: Send one move**

In `frontend/src/pages/employees/TransferEmployeeDialog.tsx`, replace the `buildTransferRequest` call (lines 75-82):

```tsx
        buildTransferRequest({
          moves: [{ employeeId: employee.id, toUnit: unit, toPost: post }],
          recipientId: v.recipient_id,
          managerId: v.manager_id,
          cc: v.cc,
        }),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm exec vitest run src/pages/employees/TransferEmployeeDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/employees/TransferEmployeeDialog.tsx frontend/src/pages/employees/TransferEmployeeDialog.test.tsx
git commit -m "feat(duty): send a one-move transfer from the employee profile"
```

---

### Task 6: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Backend checks**

From the worktree root:

```powershell
C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest backend/tests/test_duty_transfer_body.py backend/tests/test_duty_transfer_service.py -v
C:\Users\Admin\sentinel\venv\Scripts\ruff.exe check backend
C:\Users\Admin\sentinel\venv\Scripts\mypy.exe
```

Expected: all pass.

- [ ] **Step 2: Frontend checks**

From `<worktree>\frontend`:

```powershell
pnpm exec vitest run src/pages/dutyLocations src/pages/employees/TransferEmployeeDialog.test.tsx
pnpm exec tsc -b --noEmit
pnpm run lint
```

Expected: all pass. `tsc` must now be clean — every `DutyTransferRequest` caller has moved.

- [ ] **Step 3: UI dry run (no submit)**

Serve the app from the worktree (`pnpm -C frontend dev` or the built bundle) and, in a browser: tick employees in one unit, click another unit in the rail and confirm the count survives, tick more, expand the tray, drop an off-screen pick, open the transfer dialog, use *Apply to all*, override one row into a swap, confirm the generate button ungates only when every row has a unit — then **cancel**. No book is minted and no employee is moved. Repeat in Arabic and English to check both directions.

- [ ] **Step 4: Required review**

Run the `i18n-rtl-reviewer` over the new strings and the reflowed dialog/tray. `notification-template-reviewer` and `alembic-migration-reviewer` do not apply — no message formatting and no schema change.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(duty): review follow-ups for cross-unit transfers"
```
