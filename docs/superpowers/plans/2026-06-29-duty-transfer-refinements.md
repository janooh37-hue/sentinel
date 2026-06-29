# Duty Transfer Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add breathing room around the transfer letter's table, make General Book table rows hug their text, and let a bulk move skip the book/email when every selected employee is unassigned.

**Architecture:** Three localized changes plus a frontend toast branch: (1) spacer paragraphs in the transfer body builder, (2) zero the cell-paragraph spacing in the shared DOCX table renderer, (3) an "all unassigned → no book" branch in `transfer()` with an optional-fields result, surfaced by a distinct dialog toast.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic, python-docx (`docx.shared.Pt`), React + react-hook-form + Vitest, `core/arabic_rtl.html_to_docx`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-29-duty-transfer-refinements-design.md`.
- **Live checkout / branch workflow:** execution runs on a fresh feature branch; per-task commits go to that branch (NOT `main`). Merge to `main` + deploy only after the final review. (memory: live-server-fixes-must-go-to-main, repo-roles-and-branch-workflow)
- **Spacer:** a blank line is `<p>&nbsp;</p>` (matches the office-letter blank-line convention).
- **"Unassigned":** an employee is unassigned iff `not (employee.duty_unit or "").strip()` — `duty_unit` only; `duty_post` is irrelevant.
- **No-book rule:** skip the book/email iff **every** selected employee is unassigned. Any one already-placed employee → mint the letter exactly as today.
- **Tight rows apply to all General Book tables** (every `html_to_docx` table), table cells only — narrative paragraphs keep their spacing.
- Backend tests: `backend/tests/test_*.py`, run from `backend/` with `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest`. Fixtures `db_session` / `make_user` in `backend/tests/conftest.py`.
- Frontend tests: Vitest, colocated `*.test.ts`, run `npx vitest run <file>` from `frontend/`.

---

### Task 1: Blank line above and below the table

**Files:**
- Modify: `backend/app/services/duty_service.py` (`_build_body_html`)
- Test: `backend/tests/test_duty_transfer_body.py` (extend — file exists)

**Interfaces:**
- Consumes/Produces: `_build_body_html(employees, *, to_unit, to_post) -> str` (signature unchanged). Output gains a `<p>&nbsp;</p>` immediately before `<table` and immediately after `</table>`.

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_duty_transfer_body.py`)

```python
def test_body_has_blank_line_around_table():
    html = _build_body_html(
        [_emp()], to_unit="السرية الثانية", to_post="ليوان",
    )
    assert "<p>&nbsp;</p><table" in html      # blank line before the table
    assert "</table><p>&nbsp;</p>" in html    # blank line after the table
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_body.py::test_body_has_blank_line_around_table -v`
Expected: FAIL — no spacer paragraphs yet.

- [ ] **Step 3: Implement the spacer**

In `backend/app/services/duty_service.py`, add a module constant near the other body constants:

```python
_SPACER = "<p>&nbsp;</p>"
```

Change the final return of `_build_body_html` from:

```python
    return intro + table + closing
```

to:

```python
    return intro + _SPACER + table + _SPACER + closing
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_body.py -v`
Expected: PASS (all body tests, including the existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/duty_service.py backend/tests/test_duty_transfer_body.py
git commit -m "feat(duty): blank line above and below the transfer letter table"
```

---

### Task 2: Tighten General Book table rows

**Files:**
- Modify: `backend/app/core/arabic_rtl.py` (`_render_table`, the per-cell loop; ensure `Pt` import)
- Test: `backend/tests/test_arabic_rtl_table_spacing.py` (create)

**Interfaces:**
- Produces: every table cell paragraph rendered by `html_to_docx` has `paragraph_format.space_before == Pt(0)` and `space_after == Pt(0)`, and `line_spacing == 1.0` unless the cascaded cell style set a line height. Narrative (non-table) paragraphs are untouched.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_arabic_rtl_table_spacing.py
from docx import Document
from docx.shared import Pt
from app.core.arabic_rtl import html_to_docx


def test_table_cell_paragraphs_have_zero_spacing():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx("<p>before</p><table><tr><td>A</td><td>B</td></tr></table>", p)

    assert len(doc.tables) == 1
    cell_para = doc.tables[0].rows[0].cells[0].paragraphs[0]
    assert cell_para.paragraph_format.space_before == Pt(0)
    assert cell_para.paragraph_format.space_after == Pt(0)


def test_narrative_paragraph_spacing_untouched():
    doc = Document()
    p = doc.add_paragraph()
    html_to_docx("<p>before</p><table><tr><td>A</td></tr></table>", p)
    # The first block reuses the passed-in paragraph and must NOT be zeroed.
    assert p.paragraph_format.space_after is None
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_arabic_rtl_table_spacing.py -v`
Expected: FAIL on `test_table_cell_paragraphs_have_zero_spacing` — cell paragraphs currently inherit non-zero (None) spacing.

- [ ] **Step 3: Implement the tightening**

In `backend/app/core/arabic_rtl.py`, ensure `Pt` is importable at the top of `_render_table` (it's already imported locally elsewhere; add `from docx.shared import Pt` at the top of the `_render_table` function body, mirroring the existing local-import style).

In `_render_table`, the per-cell loop currently does (around the cell paragraph setup):

```python
            para = cell.paragraphs[0]
            for rr in para.runs:
                rr.text = ""
            _apply_block_fmt(para, cblk)
```

Immediately AFTER `_apply_block_fmt(para, cblk)`, add:

```python
            # Hug the text: zero the inherited paragraph spacing so rows don't
            # render taller than their content. An explicit cascaded line-height
            # (cblk.line_height) still wins; otherwise force single spacing.
            para.paragraph_format.space_before = Pt(0)
            para.paragraph_format.space_after = Pt(0)
            if not cblk.line_height:
                para.paragraph_format.line_spacing = 1.0
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_arabic_rtl_table_spacing.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Run the broader renderer-adjacent suite**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest -q`
Expected: all pass — confirm no existing test regressed from the cell-spacing change.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/arabic_rtl.py backend/tests/test_arabic_rtl_table_spacing.py
git commit -m "feat(docx): tight table rows — zero cell paragraph spacing in html_to_docx"
```

---

### Task 3: Auto no-book bulk move

**Files:**
- Modify: `backend/app/schemas/duty.py` (`DutyTransferResult`)
- Modify: `backend/app/services/duty_service.py` (`transfer`)
- Test: `backend/tests/test_duty_transfer_service.py` (extend — file exists)

**Interfaces:**
- Produces: `DutyTransferResult(book_id: int | None = None, ref: str | None = None, document_id: int | None = None, moved: list[str])`.
- Produces: `transfer(...)` returns a result with `book_id is None` (and `ref`/`document_id` None) when **every** selected employee is unassigned, having moved them and committed without calling `generate_document`. Mixed/placed selections behave exactly as today.

- [ ] **Step 1: Make the result fields optional**

In `backend/app/schemas/duty.py`, change `DutyTransferResult`:

```python
class DutyTransferResult(BaseModel):
    book_id: int | None = None
    ref: str | None = None
    document_id: int | None = None
    moved: list[str]
```

- [ ] **Step 2: Write the failing tests** (append to `backend/tests/test_duty_transfer_service.py`)

```python
def test_transfer_all_unassigned_skips_book(db_session, monkeypatch):
    # Two employees with NO current duty place.
    for eid in ("G100", "G200"):
        db_session.add(Employee(id=eid, name_en=eid, name_ar=eid, duty_unit=None, duty_post=None))
    db_session.commit()

    called = {"n": 0}

    def fake_generate(*a, **k):
        called["n"] += 1
        raise AssertionError("generate_document must NOT be called for an all-unassigned move")

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session, employee_ids=["G100", "G200"],
        to_unit="السرية الأولى", to_post="ليوان",
    )

    assert called["n"] == 0
    assert result.book_id is None and result.ref is None and result.document_id is None
    assert result.moved == ["G100", "G200"]
    moved = db_session.get(Employee, "G100")
    assert moved.duty_unit == "السرية الأولى" and moved.duty_post == "ليوان"


def test_transfer_mixed_assignment_mints_book(db_session, monkeypatch):
    db_session.add(Employee(id="G100", name_en="a", name_ar="a", duty_unit=None, duty_post=None))
    db_session.add(Employee(id="G300", name_en="b", name_ar="b", duty_unit="السرية الثالثة", duty_post="تفتيش"))
    db_session.commit()

    import types
    captured = {}

    def fake_generate(db, *, employee_id, template_id, fields, current_user, commit):
        captured["fields"] = fields
        return types.SimpleNamespace(book_id=11, ref_number="R-11", document_id=22)

    monkeypatch.setattr(duty_service.document_service, "generate_document", fake_generate)

    result = duty_service.transfer(
        db_session, employee_ids=["G100", "G300"],
        to_unit="السرية الأولى", to_post=None,
    )

    assert "fields" in captured            # book path taken (≥1 already placed)
    assert result.book_id == 11
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_service.py -v`
Expected: `test_transfer_all_unassigned_skips_book` FAILS (the current code always calls `generate_document`, tripping the `AssertionError`).

- [ ] **Step 4: Implement the no-book branch**

In `backend/app/services/duty_service.py` `transfer()`, replace everything from the `# Build the body from CURRENT (FROM) locations BEFORE mutating.` comment through the final `return DutyTransferResult(...)` with:

```python
    # No-book path: when EVERY selected employee is currently unassigned, this is
    # initial placement, not a transfer needing a formal letter — just move them.
    all_unassigned = all(not (e.duty_unit or "").strip() for e in employees)
    if all_unassigned:
        for emp in employees:
            emp.duty_unit = to_unit
            emp.duty_post = to_post
        db.commit()
        return DutyTransferResult(moved=[emp.id for emp in employees])

    # Otherwise mint the transfer letter. Build the body from CURRENT (FROM)
    # locations BEFORE mutating.
    body_html = _build_body_html(employees, to_unit=to_unit, to_post=to_post)

    # Stage the moves on this session; generate_document's single commit
    # persists them together with the doc/Book rows.
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
        employee_id=None,  # admin form — no bound employee
        template_id="General Book",
        fields=fields,
        current_user=current_user,
        commit=True,
    )

    return DutyTransferResult(
        book_id=result.book_id,
        ref=result.ref_number,
        document_id=result.document_id,
        moved=[emp.id for emp in employees],
    )
```

Also update the module docstring's first paragraph to note the no-book initial-placement path (one sentence — e.g. "When every selected employee is currently unassigned, the move is initial placement and no book/email is produced.").

- [ ] **Step 5: Run tests to verify they pass**

Run (from `backend/`): `C:\Users\Admin\sentinel\venv\Scripts\python.exe -m pytest tests/test_duty_transfer_service.py tests/test_duty_transfer_body.py -v`
Expected: PASS (new + existing).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/duty.py backend/app/services/duty_service.py backend/tests/test_duty_transfer_service.py
git commit -m "feat(duty): skip book/email when all moved employees are unassigned (initial placement)"
```

---

### Task 4: Frontend — nullable result + no-book toast

**Files:**
- Modify: `frontend/src/lib/api.ts` (`DutyTransferResult` interface)
- Modify: `frontend/src/pages/dutyLocations/TransferDialog.tsx` (`onSuccess`)
- Modify: `frontend/src/locales/ar.json`, `frontend/src/locales/en.json` (add `dutyLocations.transfer.movedNoBook`)

**Interfaces:**
- Consumes: the result from `api.transferDuty` now has `book_id: number | null`, `ref: string | null`, `document_id: number | null`.

- [ ] **Step 1: Make the TS result type nullable**

In `frontend/src/lib/api.ts`, update the `DutyTransferResult` interface (around line 156):

```ts
export interface DutyTransferResult {
  book_id: number | null
  ref: string | null
  document_id: number | null
  moved: string[]
}
```

- [ ] **Step 2: Branch the success toast**

In `frontend/src/pages/dutyLocations/TransferDialog.tsx`, replace the body of `onSuccess` (the `toast.success(...)` call) so the no-book result shows a plain toast with no "View record" action:

```tsx
    onSuccess: (result) => {
      const v = methods.getValues()
      saveTransferDefaults({ recipientId: v.recipient_id, managerId: v.manager_id, cc: v.cc })
      void qc.invalidateQueries({ queryKey: ['employees'] })
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
      onTransferred()
      onOpenChange(false)
    },
```

- [ ] **Step 3: Add the locale strings**

In `frontend/src/locales/en.json`, under the `dutyLocations.transfer` object, add:

```json
"movedNoBook": "Moved {{count}} employees",
```

In `frontend/src/locales/ar.json`, under the matching `dutyLocations.transfer` object, add:

```json
"movedNoBook": "تم نقل {{count}} موظف",
```

(Place each next to the existing `success`/`viewRecord` keys; keep JSON valid — mind the trailing commas.)

- [ ] **Step 4: Typecheck + lint + tests**

Run (from `frontend/`): `npx tsc -b --noEmit && npx eslint src/pages/dutyLocations src/lib/api.ts && npm run test`
Expected: clean + all existing tests green (no new frontend test — the change is type + wiring; covered by tsc and the manual check in Task 5).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/dutyLocations/TransferDialog.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(duty): no-book move shows a 'Moved N employees' toast (no view-record link)"
```

---

### Task 5: End-to-end manual verification

**Files:** none (manual, after deploy).

- [ ] **Step 1: Build + deploy** — from an elevated PowerShell: `cd C:\Users\Admin\sentinel; .\scripts\mng.ps1 deploy` (build + restart). Confirm `Health: ok`.

- [ ] **Step 2: Letter spacing + tight rows** — run a transfer where at least one selected employee already HAS a duty place (forces the book). Open the generated book: confirm one blank line above and below the table, and rows that hug the text (no excess height). Spot-check another General Book's table also has tighter rows.

- [ ] **Step 3: No-book move** — select only employees with NO current duty place, set a destination, generate. Confirm: a "Moved N employees" toast with no "View record" link, the employees now show the new duty place in the roster, and NO new General Book was created for it.

- [ ] **Step 4: Confirm** `git status` clean and the branch is pushed.

---

## Notes for the implementer

- `_apply_block_fmt` only sets `line_spacing` (never paragraph spacing), which is why cells inherit the document's default space-after — Task 2 zeroes it explicitly.
- The no-book path commits directly (`db.commit()`) because, unlike the book path, there's no `generate_document` call to own the commit.
- `recipient_id`/`manager_id`/`cc` are intentionally unused on the no-book path — the dialog still sends them; that's fine.
