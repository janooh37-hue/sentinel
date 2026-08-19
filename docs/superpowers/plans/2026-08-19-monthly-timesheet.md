# Monthly Time Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the two monthly Excel deliverables for site JD 908 — the HR attendance sheet and the client statistics sheet — from the database, in the exact format already in circulation, plus a single-employee sheet for HR handovers.

**Architecture:** A pure rule module (already landed) resolves an employee-month to 31 codes. A service assembles the roster, applies the statistics posts-vs-headcount split, and freezes the grid on first download. A renderer fills a sanitized `.xlsx` template with `openpyxl`, which round-trips the logo, conditional formats and validations. A React page shows the grid, takes cell corrections, and downloads the files.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, SQLite, Alembic, openpyxl, React 18 + Vite + TypeScript, React Query, Vitest, pytest.

## Global Constraints

- Run Python through `venv\Scripts\` and frontend commands through pnpm.
- This checkout is the live production checkout. Do **not** switch branches here — create a worktree via the `superpowers:using-git-worktrees` skill before Task 1.
- Never commit a Word/Excel resave of anything under `backend/templates/` other than the one file Task 1 creates.
- `ruff check`, `ruff format --check` and `mypy` must pass. `mypy` covers `backend/app` and `backend/main.py`; `backend/scripts` is excluded but still linted.
- Three backend tests fail on this host **before** any of this work and must be ignored: `test_config_openwa.py::test_openwa_settings_default_dormant`, `test_dav.py::test_dav_diagnostic_event_is_structured_and_redacted`, `test_migration_record_included_papers.py::test_record_included_papers_migration_upgrades_and_downgrades`.
- Arabic and English are peers. Use logical CSS properties (`margin-inline-start`, not `margin-left`). Run the `i18n-rtl-reviewer` after Task 8.
- After route or Pydantic schema changes, use the `sync-api-types` skill and commit the generated `frontend/src/lib/api.types.ts`.
- Exactly one Alembic head. Migration `0070_timesheet` is already applied; do not add another migration unless a task says so.
- `CODE_SICK` is `"SL "` **with a trailing space**. The workbook totals sick days with `COUNTIF(F:AJ,$AO$5)` where `AO5` holds `"SL "`. Dropping the space silently zeroes the client's sick column.
- Emitted codes are only: `P`, `AL`, `SL `, `AB`, `TR`, `NG`, `-`. Never emit `OFF`, `R`, `S` or `T`.
- Day 31 is blank in 30-day months; days 29–31 blank in February 2026.
- Reference workbooks live at `E:\Al Watbha Shares\المالية\احصائية 2026\`. Read them; never write to that share.
- Spec: `docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md`.

---

## Already Landed (commit `c47d163`) — do not redo

- `backend/app/core/timesheet_codes.py` — the pure rule engine.
- `backend/app/db/models.py` — `TimesheetDesignation`, `Absence`, `TimesheetPeriod`, `TimesheetOverride`, `TimesheetSnapshotRow`, and `Employee.designation_id`.
- `backend/app/db/migrations/versions/0070_timesheet.py` — applied; seeds 16 designations.
- `backend/scripts/import_timesheet_history_2026.py` — applied; June/July reproduce at 99.42% / 100.00%.
- `backend/tests/test_timesheet_codes.py` — 24 passing tests.
- `openpyxl>=3.1,<4.0` in `requirements.txt`.

Existing public API you will consume:

```python
from app.core.timesheet_codes import (
    CODE_ABSENT, CODE_ANNUAL, CODE_NATIONAL, CODE_NEW, CODE_OFF_ROSTER,
    CODE_PRESENT, CODE_SICK, EMITTED_CODES,
    LeaveSpan,            # frozen dataclass: leave_type, start, end, status="Approved"
    in_roster,            # (*, doj, end_date, month_start, month_end) -> bool
    leave_code,           # (leave_type: str) -> str | None
    month_codes,          # (year, month, *, doj, end_date, leaves, absences, overrides) -> list[str | None]
)
```

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/core/constants.py` (modify) | `NATIONALITY_EN` Arabic→English map, `ARABIC_MONTHS` |
| `backend/scripts/build_timesheet_template.py` (create) | One-off: sanitize the June workbook into the template |
| `backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx` (create) | The template: header + hidden `_parts` sheet |
| `backend/app/core/timesheet_xlsx.py` (create) | Template → filled workbook bytes. No DB. |
| `backend/app/services/timesheet_service.py` (create) | Roster, grid, statistics split, close/reopen, snapshots |
| `backend/app/schemas/timesheet.py` (create) | Pydantic request/response models |
| `backend/app/api/v1/timesheet.py` (create) | Routes |
| `backend/app/core/permissions.py` (modify) | `timesheet.view`, `timesheet.edit` capabilities |
| `backend/app/main.py` (modify) | Register the router |
| `frontend/src/pages/timesheet/TimesheetPage.tsx` (create) | Month picker, grid, downloads |
| `frontend/src/pages/timesheet/TimesheetGrid.tsx` (create) | The 31-column grid + code picker |
| `frontend/src/pages/timesheet/useTimesheet.ts` (create) | React Query hooks |
| `frontend/src/App.tsx` (modify) | Route `/timesheet` |
| `frontend/src/locales/*.json` (modify) | Strings, both languages |

---

### Task 1: The sanitized template

**Files:**
- Create: `backend/scripts/build_timesheet_template.py`
- Create: `backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx` (build output, committed)
- Test: `backend/tests/test_timesheet_template.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the template file. `Sheet1` holds rows 1–5 (header, logo anchored at `A1`), column widths, row heights, print setup and sheet view. A hidden sheet `_parts` holds one styled specimen data row at row 1 and the 19-row footer block at rows 3–21.

Why a hidden `_parts` sheet rather than a parked block on `Sheet1`: `openpyxl` does not shift merges, conditional formats or validations when rows are inserted or deleted, so anything parked on `Sheet1` would leave stray formatting behind. Copying `cell._style` from a separate sheet is one attribute assignment per cell and reproduces the original exactly.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_template.py
"""The template is the format contract: if it drifts, every sheet drifts."""

from pathlib import Path

import pytest
from openpyxl import load_workbook

TEMPLATE = Path(__file__).parents[1] / "templates" / "GSSG-HR_Monthly_Time_Sheet.xlsx"


@pytest.fixture(scope="module")
def workbook():
    return load_workbook(TEMPLATE)


def test_template_exists(workbook):
    assert workbook.worksheets[0].title == "Sheet1"


def test_logo_survives(workbook):
    """The July attendance file on the share lost its logo to an outside tool."""
    assert len(workbook["Sheet1"]._images) == 1


def test_header_text_is_verbatim(workbook):
    sheet = workbook["Sheet1"]
    assert sheet["D1"].value == "Global Security Service Group- MONTHLY  TIME SHEET"
    assert sheet["Q2"].value == " Site Name :   JD 908"
    assert sheet["D3"].value == "Clent Code : P0331_JD_PRN_908EXT"
    assert sheet["E5"].value == "Desigantion"  # misspelled in the circulating sheets
    assert sheet["AO5"].value == "SL "  # trailing space drives the sick-leave COUNTIF


def test_day_headers_are_1_to_31(workbook):
    sheet = workbook["Sheet1"]
    assert [sheet.cell(5, 6 + i).value for i in range(31)] == list(range(1, 32))


def test_column_widths_match_the_reference(workbook):
    widths = workbook["Sheet1"].column_dimensions
    assert round(widths["C"].width, 2) == 69.43
    assert round(widths["E"].width, 2) == 39.71


def test_parts_sheet_is_hidden_and_carries_the_footer(workbook):
    parts = workbook["_parts"]
    assert parts.sheet_state == "hidden"
    assert parts["A1"].font.name == "Arial"  # specimen data row
    assert "Legend:" in str(parts["A3"].value)
    assert parts["A21"].value == "Total Days"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_template.py -v`
Expected: FAIL — the template file does not exist.

- [ ] **Step 3: Write the build script**

```python
# backend/scripts/build_timesheet_template.py
"""Sanitize the June 2026 attendance workbook into the reusable template.

June is the source because it still has the company logo — the July attendance
file on the share lost its image to an outside tool. One-off; re-run only if the
client changes the paper.

    python backend/scripts/build_timesheet_template.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

from openpyxl import load_workbook

SOURCE = Path(
    r"E:\Al Watbha Shares\المالية\احصائية 2026\6-Jun\كشف حضور شهر يونيو.xlsx"
)
DEST = Path(__file__).resolve().parents[1] / "templates" / "GSSG-HR_Monthly_Time_Sheet.xlsx"

FIRST_DATA_ROW = 6
LAST_DATA_ROW = 287  # June's last employee row
FOOTER_ROWS = 19  # legend .. Total Days


def main() -> None:
    workbook = load_workbook(SOURCE)
    sheet = workbook.worksheets[0]

    parts = workbook.create_sheet("_parts")
    parts.sheet_state = "hidden"

    # Row 1 of _parts: the styled specimen data row, values stripped.
    for column in range(1, 43):
        source_cell = sheet.cell(FIRST_DATA_ROW, column)
        target = parts.cell(1, column)
        target._style = source_cell._style
    parts.row_dimensions[1].height = sheet.row_dimensions[FIRST_DATA_ROW].height

    # Rows 3..21 of _parts: the footer block, styles and text intact.
    footer_start = LAST_DATA_ROW + 1
    for offset in range(FOOTER_ROWS):
        for column in range(1, 43):
            source_cell = sheet.cell(footer_start + offset, column)
            target = parts.cell(3 + offset, column)
            target._style = source_cell._style
            if isinstance(source_cell.value, str) and not source_cell.value.startswith("="):
                target.value = source_cell.value
        height = sheet.row_dimensions[footer_start + offset].height
        if height:
            parts.row_dimensions[3 + offset].height = height

    # Strip Sheet1 back to the header: clear every data and footer row.
    for row in range(FIRST_DATA_ROW, sheet.max_row + 1):
        for column in range(1, 43):
            sheet.cell(row, column).value = None
    for merged in [str(r) for r in sheet.merged_cells.ranges]:
        if int(merged.split(":")[0].lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) >= FIRST_DATA_ROW:
            sheet.unmerge_cells(merged)
    sheet["D4"].value = "For the Month of :"
    sheet.freeze_panes = "F6"

    DEST.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(DEST)
    print(f"[template] wrote {DEST} ({DEST.stat().st_size} bytes)")

    check = load_workbook(DEST)
    assert len(check["Sheet1"]._images) == 1, "logo lost"
    assert check["_parts"].sheet_state == "hidden"
    print("[template] logo and _parts verified")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Build the template and run the test**

Run: `venv\Scripts\python.exe -X utf8 backend/scripts/build_timesheet_template.py`
Then: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_template.py -v`
Expected: PASS, 7 tests. If `test_parts_sheet_is_hidden_and_carries_the_footer` fails on `A21`, print `[(r, parts.cell(r,1).value) for r in range(3,22)]` and adjust `LAST_DATA_ROW` — June's footer starts one row after its last employee.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/build_timesheet_template.py backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx backend/tests/test_timesheet_template.py
git commit -m "feat(timesheet): sanitized xlsx template built from the June workbook"
```

---

### Task 2: Nationality and month names

**Files:**
- Modify: `backend/app/core/constants.py`
- Test: `backend/tests/test_timesheet_constants.py`

**Interfaces:**
- Produces: `NATIONALITY_EN: Mapping[str, str]`, `nationality_en(value: str | None) -> str | None`, `ARABIC_MONTHS: tuple[str, ...]` (12 entries, index 0 = January).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_constants.py
"""Column D prints English nationalities; the DB stores Arabic, with variants."""

import pytest

from app.core.constants import ARABIC_MONTHS, nationality_en


@pytest.mark.parametrize(
    ("arabic", "english"),
    [
        ("الإمارات", "U.A.E"),
        ("الامارات", "U.A.E"),      # variant spelling, 79 employees
        ("سلطنة عُمان", "Oman"),
        ("سلطنة عمان", "Oman"),
        ("عمان", "Oman"),
        ("نيبال", "Nepal"),
        ("السودان", "Sudan"),
        ("الأردن", "Jordan"),
        ("اليمن", "Yemen"),
        ("جزر القمر", "Comoros"),
        ("موريتانيا", "Mauritania"),
        ("مصر", "Egypt"),
        ("سوريا", "Syria"),
        ("المغرب", "Morocco"),
        ("الجزائر", "Algeria"),
    ],
)
def test_every_nationality_in_the_database_maps(arabic, english):
    assert nationality_en(arabic) == english


def test_surrounding_whitespace_is_tolerated():
    assert nationality_en("  الإمارات  ") == "U.A.E"


def test_an_unmapped_nationality_returns_none_so_preflight_can_block():
    assert nationality_en("فرنسا") is None
    assert nationality_en(None) is None


def test_arabic_months_are_twelve_and_ordered():
    assert len(ARABIC_MONTHS) == 12
    assert ARABIC_MONTHS[0] == "يناير"
    assert ARABIC_MONTHS[6] == "يوليو"
    assert ARABIC_MONTHS[11] == "ديسمبر"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_constants.py -v`
Expected: FAIL with `ImportError: cannot import name 'nationality_en'`.

- [ ] **Step 3: Add the map to `constants.py`**

Append at the end of `backend/app/core/constants.py`:

```python
# --- Time-sheet display values ---------------------------------------------

#: Arabic nationality → the English label column D of the time sheet prints.
#: Variant spellings are all present in the live data (both `الإمارات` and
#: `الامارات`; three spellings of Oman) so they are all mapped rather than
#: normalised away.
NATIONALITY_EN: Final[Mapping[str, str]] = MappingProxyType(
    {
        "الإمارات": "U.A.E",
        "الامارات": "U.A.E",
        "سلطنة عُمان": "Oman",  # noqa: RUF001
        "سلطنة عمان": "Oman",
        "عمان": "Oman",
        "نيبال": "Nepal",
        "السودان": "Sudan",
        "الأردن": "Jordan",
        "اليمن": "Yemen",
        "جزر القمر": "Comoros",
        "موريتانيا": "Mauritania",
        "مصر": "Egypt",
        "سوريا": "Syria",
        "المغرب": "Morocco",
        "الجزائر": "Algeria",
    }
)


def nationality_en(value: str | None) -> str | None:
    """English nationality label, or ``None`` when unmapped (preflight blocks)."""

    if not value:
        return None
    return NATIONALITY_EN.get(value.strip())


#: Arabic month names for the generated filenames; index 0 is January.
ARABIC_MONTHS: Final[tuple[str, ...]] = (
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
)
```

- [ ] **Step 4: Run the test**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_constants.py -v`
Expected: PASS, 18 tests. If ruff flags `RUF001` on an Arabic string, keep the `# noqa: RUF001` comment shown above.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/constants.py backend/tests/test_timesheet_constants.py
git commit -m "feat(timesheet): nationality and Arabic month display maps"
```

---

### Task 3: The grid service

**Files:**
- Create: `backend/app/services/timesheet_service.py`
- Test: `backend/tests/test_timesheet_service.py`

**Interfaces:**
- Consumes: `app.core.timesheet_codes` (`month_codes`, `in_roster`), `app.core.constants.nationality_en`, models `Employee`, `Leave`, `Absence`, `TimesheetDesignation`, `TimesheetPeriod`, `TimesheetOverride`, `TimesheetSnapshotRow`.
- Produces exactly these names:

```python
@dataclass(frozen=True, slots=True)
class GridRow:
    employee_id: str
    row_no: int
    name_en: str
    nationality_en: str | None
    designation_en: str | None
    designation_ar: str | None
    rank_order: int | None
    codes: list[str | None]        # 31 entries, None past month end
    stat_codes: list[str | None]   # the client variant of the same row
    stat_block: int                # 1 = billable block, 2 = surplus

@dataclass(frozen=True, slots=True)
class Issue:
    employee_id: str
    kind: str
    #  blocking: "no_designation" | "no_nationality"
    #  warning:  "unknown_leave" | "overlapping_leave" | "departed_but_active"
    #            | "no_doj" | "duplicate_name"
    detail: str

@dataclass(frozen=True, slots=True)
class MonthGrid:
    year: int
    month: int
    days_in_month: int
    sheet: str                 # "main" | "drivers"
    post_count: int
    rows: list[GridRow]
    blocking: list[Issue]
    warnings: list[Issue]
    closed_at: datetime | None

def build_month(db: Session, year: int, month: int, *, sheet: str = "main") -> MonthGrid: ...
def set_cell(db: Session, year: int, month: int, employee_id: str, day: int,
             code: str | None, *, note: str | None = None, user_id: int | None = None) -> None: ...
def set_post_count(db: Session, year: int, month: int, post_count: int) -> None: ...
def close_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def reopen_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def delete_absences_covered_by(db: Session, employee_id: str, start: date, end: date) -> int: ...
```

Rules this task implements, all measured from the workbooks:

1. Roster: `in_roster(...)` plus `designation.sheet == sheet`. Employees with no designation are still listed (last, `rank_order=None`) **and** raise a `no_designation` blocking issue.
2. Sort: `rank_order` ascending, then the integer part of the employee ID (`G4053` → 4053; a non-numeric ID sorts last).
3. `stat_codes` for block 1 (`row_no <= post_count`): every cell becomes `P` except `NG` and `-`.
4. `stat_codes` for block 2: every cell becomes the row's filler code except `NG`, `-` and `AB`. Filler default: the code the same employee had in block 2 of the previous month if any, else `AL`.
5. `set_cell` with `AB` writes an `Absence` row; any other code writes a `TimesheetOverride`; `None` deletes whichever exists. Refuses with `ValueError` when the month is closed.
6. `close_month` writes one `TimesheetSnapshotRow` per row and stamps `closed_at`. `build_month` returns the snapshot verbatim when `closed_at` is set.
7. `delete_absences_covered_by` is called from the leave-create path (Task 5) — a certificate supersedes the absence.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_timesheet_service.py
"""Roster, ordering, and the statistics posts-vs-headcount split.

The numbers come from July 2026: 275 on the main sheet, 2 drivers, 249 posts.
"""

from datetime import date

import pytest

from app.core.timesheet_codes import CODE_ANNUAL, CODE_NEW, CODE_OFF_ROSTER, CODE_PRESENT
from app.db.models import Absence, Employee, Leave, TimesheetDesignation
from app.services import timesheet_service as svc


@pytest.fixture()
def guards(db_session):
    """Three guards and one driver, all joined long ago."""
    rows = {d.name_en: d for d in db_session.query(TimesheetDesignation).all()}
    for employee_id, designation in (
        ("G1001", "Security Guard"),
        ("G1002", "Security Guard"),
        ("G0999", "Security Supervisor"),
        ("G2000", "Driver"),
    ):
        db_session.add(
            Employee(
                id=employee_id,
                name_en=f"Name {employee_id}",
                nationality="الإمارات",
                doj=date(2020, 1, 1),
                designation_id=rows[designation].id,
            )
        )
    db_session.commit()


def test_supervisor_sorts_above_guards_and_ids_break_ties(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert [r.employee_id for r in grid.rows] == ["G0999", "G1001", "G1002"]
    assert [r.row_no for r in grid.rows] == [1, 2, 3]


def test_drivers_are_a_separate_sheet(db_session, guards):
    assert [r.employee_id for r in svc.build_month(db_session, 2026, 7, sheet="drivers").rows] == [
        "G2000"
    ]


def test_a_quiet_guard_is_present_all_month(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.rows[0].codes[:31] == [CODE_PRESENT] * 31
    assert grid.days_in_month == 31


def test_block_one_hides_leave_from_the_client(db_session, guards):
    """A guard on annual leave still shows P to the client: the post was covered."""
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Approved",
        )
    )
    db_session.commit()
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G1001")
    assert row.codes[4:9] == [CODE_ANNUAL] * 5
    assert row.stat_codes[4:9] == [CODE_PRESENT] * 5
    assert row.stat_block == 1


def test_surplus_headcount_falls_into_block_two(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 2)
    grid = svc.build_month(db_session, 2026, 7)
    assert [r.stat_block for r in grid.rows] == [1, 1, 2]
    assert grid.rows[2].stat_codes[:31] == [CODE_ANNUAL] * 31
    assert grid.rows[2].codes[:31] == [CODE_PRESENT] * 31  # the HR sheet stays truthful


def test_roster_edges_survive_into_the_client_sheet(db_session, guards):
    employee = db_session.get(Employee, "G1002")
    employee.doj = date(2026, 7, 3)
    employee.end_date = date(2026, 7, 20)
    db_session.commit()
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G1002")
    assert row.stat_codes[0] == CODE_NEW
    assert row.stat_codes[20] == CODE_OFF_ROSTER


def test_marking_absence_creates_a_record_on_the_employee(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB", note="no show")
    assert db_session.query(Absence).filter_by(employee_id="G1001").count() == 1
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G1001")
    assert row.codes[13] == "AB"


def test_a_sick_certificate_supersedes_the_absence(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB")
    removed = svc.delete_absences_covered_by(db_session, "G1001", date(2026, 7, 14), date(2026, 7, 14))
    assert removed == 1
    assert db_session.query(Absence).count() == 0


def test_an_employee_without_a_designation_blocks_the_download(db_session, guards):
    db_session.add(
        Employee(id="G9999", name_en="No Designation", nationality="الإمارات", doj=date(2020, 1, 1))
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert [i.kind for i in grid.blocking] == ["no_designation"]
    assert grid.rows[-1].employee_id == "G9999"


def test_an_unmapped_nationality_blocks_the_download(db_session, guards):
    db_session.get(Employee, "G1001").nationality = "فرنسا"
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert {i.kind for i in grid.blocking} == {"no_nationality"}


def test_closing_freezes_the_grid(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Annual Leave",
            start_date=date(2026, 7, 5),
            end_date=date(2026, 7, 9),
            days=5,
            status="Approved",
        )
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.closed_at is not None
    row = next(r for r in grid.rows if r.employee_id == "G1001")
    assert row.codes[4] == CODE_PRESENT  # the snapshot, not the new leave


def test_a_closed_month_refuses_edits(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    with pytest.raises(ValueError, match="closed"):
        svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")


def test_reopening_restores_live_recomputation(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    svc.reopen_month(db_session, 2026, 7)
    svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G1001")
    assert row.codes[2] == "AB"
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.timesheet_service`.
The `db_session` fixture already exists in `backend/tests/conftest.py`; read it before writing the service so the session handling matches.

- [ ] **Step 3: Implement the service**

Write `backend/app/services/timesheet_service.py` implementing exactly the interface above. Implementation notes that are easy to get wrong:

```python
def _id_sort_key(employee_id: str) -> tuple[int, str]:
    digits = employee_id.lstrip("Gg")
    return (int(digits), "") if digits.isdigit() else (10**9, employee_id)


def _statistics_codes(codes: list[str | None], *, block: int, filler: str) -> list[str | None]:
    """Block 1 shows a manned post; block 2 is parked off the presence total."""
    keep = {CODE_NEW, CODE_OFF_ROSTER} if block == 1 else {CODE_NEW, CODE_OFF_ROSTER, CODE_ABSENT}
    replacement = CODE_PRESENT if block == 1 else filler
    return [None if c is None else (c if c in keep else replacement) for c in codes]
```

Load leaves, absences and overrides for the month in three queries, not per employee — the main sheet is 275 rows and a per-row query would be 825 round trips.

- [ ] **Step 4: Run the tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -v`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/timesheet_service.py backend/tests/test_timesheet_service.py
git commit -m "feat(timesheet): grid service with the statistics posts split"
```

---

### Task 4: The renderer

**Files:**
- Create: `backend/app/core/timesheet_xlsx.py`
- Test: `backend/tests/test_timesheet_xlsx.py`

**Interfaces:**
- Consumes: `MonthGrid` and `GridRow` from Task 3, the template from Task 1, `ARABIC_MONTHS` from Task 2.
- Produces:

```python
def render(grid: MonthGrid, *, variant: str = "attendance") -> bytes: ...
    # variant: "attendance" (column E = designation_en, row codes) or
    #          "statistics"  (column E = designation_ar, stat_codes, two blocks)

def filename_for(grid: MonthGrid, *, variant: str = "attendance") -> str: ...
    # كشف حضور شهر يوليو.xlsx / الاحصائية شهر يوليو.xlsx /
    # كشف حضور شهر يوليو للسائقين.xlsx

def render_single(grid: MonthGrid, employee_id: str) -> bytes: ...
def filename_for_single(grid: MonthGrid, employee_id: str, name_en: str) -> str: ...
```

Render steps, in order:
1. `load_workbook(TEMPLATE)`; take `Sheet1` and `_parts`; `del workbook["_parts"]` last.
2. `Sheet1["D4"] = f"For the Month of :{month_abbr}-{year}"` where `month_abbr` is the uppercase three-letter English abbreviation (`JUL`).
3. For each output row `r` (starting at 6): copy `_parts` row 1 styles into row `r`, set `row_dimensions[r].height = 27.95`, write `A`=row_no, `B`=employee_id, `C`=name_en, `D`=nationality_en, `E`=designation, then the day cells, then the six `COUNTIF` formulas verbatim from the spec.
4. Statistics variant: emit block 1, then **two empty rows**, then block 2, while column `A` keeps counting continuously.
5. Footer at `last_row + 1`: copy the 19 `_parts` rows, re-merge (`A{n}:AP{n}` legend; `A:M`, `N:AC`, `AD:AP` signatures; `A:B` on the `S.no` row; `A:B` spanning the ten code rows; `A:D` on `Total Days`), and rewrite every formula against the real extents.
6. Re-register the conditional formats over `F6:AJ{last_row}` and the code data-validation list.
7. Save to `io.BytesIO`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_xlsx.py
"""The rendered workbook must match the paper already in circulation."""

import io
from datetime import date

from openpyxl import load_workbook

from app.core import timesheet_xlsx
from app.db.models import Employee, TimesheetDesignation
from app.services import timesheet_service as svc


def _grid(db_session):
    designation = (
        db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    )
    db_session.add(
        Employee(
            id="G1001",
            name_en="TEST GUARD",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            designation_id=designation.id,
        )
    )
    db_session.commit()
    return svc.build_month(db_session, 2026, 7)


def test_attendance_sheet_keeps_the_logo_and_header(db_session):
    sheet = load_workbook(io.BytesIO(timesheet_xlsx.render(_grid(db_session)))).worksheets[0]
    assert len(sheet._images) == 1
    assert sheet["D4"].value == "For the Month of :JUL-2026"
    assert sheet["Q2"].value == " Site Name :   JD 908"


def test_a_data_row_carries_values_and_the_countif_formulas(db_session):
    sheet = load_workbook(io.BytesIO(timesheet_xlsx.render(_grid(db_session)))).worksheets[0]
    assert [sheet.cell(6, c).value for c in (1, 2, 3, 4, 5)] == [
        1, "G1001", "TEST GUARD", "U.A.E", "Security Guard"
    ]
    assert sheet["F6"].value == "P"
    assert sheet["AK6"].value == '=COUNTIF(F6:AJ6,"P")'
    assert sheet["AN6"].value == '=COUNTIF(F6:AK6,"AL")'   # spans AK in the original
    assert sheet["AO6"].value == "=COUNTIF(F6:AJ6,$AO$5)"  # $AO$5 holds "SL "


def test_the_footer_follows_the_last_data_row(db_session):
    sheet = load_workbook(io.BytesIO(timesheet_xlsx.render(_grid(db_session)))).worksheets[0]
    assert "Legend:" in str(sheet["A7"].value)
    assert sheet["A8"].value == "Prepard By         "
    assert sheet["AK9"].value == "=SUM(AK6:AK6)"
    assert sheet["A24"].value == "Total Days"


def test_a_thirty_day_month_leaves_day_31_empty(db_session):
    _grid(db_session)  # seeds the guard; June has 30 days
    grid = svc.build_month(db_session, 2026, 6)
    sheet = load_workbook(io.BytesIO(timesheet_xlsx.render(grid))).worksheets[0]
    assert sheet["AI6"].value == "P"
    assert sheet["AJ6"].value is None


def test_statistics_uses_arabic_designations(db_session):
    grid = _grid(db_session)
    sheet = load_workbook(
        io.BytesIO(timesheet_xlsx.render(grid, variant="statistics"))
    ).worksheets[0]
    assert sheet["E6"].value == "حارس امن"


def test_statistics_splits_blocks_with_two_blank_rows(db_session):
    grid = _grid(db_session)
    svc.set_post_count(db_session, 2026, 7, 0)  # everyone is surplus
    grid = svc.build_month(db_session, 2026, 7)
    sheet = load_workbook(
        io.BytesIO(timesheet_xlsx.render(grid, variant="statistics"))
    ).worksheets[0]
    assert sheet["B6"].value is None and sheet["B7"].value is None
    assert sheet["B8"].value == "G1001"
    assert sheet["A8"].value == 1  # numbering continues across the gap


def test_filenames_are_the_arabic_names_in_use(db_session):
    grid = _grid(db_session)
    assert timesheet_xlsx.filename_for(grid) == "كشف حضور شهر يوليو.xlsx"
    assert timesheet_xlsx.filename_for(grid, variant="statistics") == "الاحصائية شهر يوليو.xlsx"


def test_a_single_employee_sheet_has_one_row(db_session):
    grid = _grid(db_session)
    sheet = load_workbook(io.BytesIO(timesheet_xlsx.render_single(grid, "G1001"))).worksheets[0]
    assert sheet["B6"].value == "G1001"
    assert sheet["B7"].value is None
    assert "Legend:" in str(sheet["A7"].value)
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.timesheet_xlsx`.

- [ ] **Step 3: Implement the renderer**

Write `backend/app/core/timesheet_xlsx.py`. Copy styles with `target._style = source._style` — never build `Font`/`Fill` objects by hand, or the output drifts from the paper.

- [ ] **Step 4: Run the tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: PASS, 8 tests. `test_the_footer_follows_the_last_data_row` pins the footer offsets — with one data row the legend lands on row 7, signatures 8, sums 9, `Total Days` 24.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/timesheet_xlsx.py backend/tests/test_timesheet_xlsx.py
git commit -m "feat(timesheet): xlsx renderer for both deliverables"
```

---

### Task 5: API, capabilities, and the absence supersede hook

**Files:**
- Create: `backend/app/schemas/timesheet.py`
- Create: `backend/app/api/v1/timesheet.py`
- Modify: `backend/app/core/permissions.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/leave_service.py` (call `delete_absences_covered_by` on create)
- Test: `backend/tests/test_timesheet_api.py`

**Interfaces:**
- Consumes: `timesheet_service` and `timesheet_xlsx`.
- Produces the routes in the spec. Read `backend/app/api/v1/leaves.py` first and copy its dependency wiring, capability guard and error style exactly.

Capabilities to add to the `CAPABILITIES` tuple in `permissions.py`, next to the existing `leaves.*` entries:

```python
    Capability(
        "timesheet.view",
        "timesheet",
        "View the time sheet",
        "See the monthly attendance grid and download the sheets.",
    ),
    Capability(
        "timesheet.edit",
        "timesheet",
        "Correct and close the time sheet",
        "Mark absence, correct cells, set the post count, and close or reopen a month.",
    ),
```

Grant `timesheet.view` to operator, both to manager and admin, in the same role-preset structures already in that file.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_timesheet_api.py
"""Routes, capability gates, and the freeze-on-download contract."""

from datetime import date

from app.db.models import Employee, TimesheetDesignation


def _guard(db_session):
    designation = db_session.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    db_session.add(
        Employee(
            id="G1001",
            name_en="TEST GUARD",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            designation_id=designation.id,
        )
    )
    db_session.commit()


def test_get_returns_the_grid(client, db_session):
    _guard(db_session)
    body = client.get("/api/v1/timesheet/2026/7").json()
    assert body["days_in_month"] == 31
    assert body["post_count"] == 249
    assert body["rows"][0]["employee_id"] == "G1001"
    assert body["rows"][0]["codes"][0] == "P"


def test_put_cell_marks_absence(client, db_session):
    _guard(db_session)
    response = client.put(
        "/api/v1/timesheet/2026/7/cell",
        json={"employee_id": "G1001", "day": 9, "code": "AB", "note": "no show"},
    )
    assert response.status_code == 200
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "AB"


def test_export_returns_an_xlsx_and_closes_the_month(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/2026/7/export?variant=attendance")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml"
    )
    assert client.get("/api/v1/timesheet/2026/7").json()["closed_at"] is not None


def test_a_closed_month_rejects_a_cell_edit(client, db_session):
    _guard(db_session)
    client.get("/api/v1/timesheet/2026/7/export")
    response = client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert response.status_code == 409


def test_reopen_unlocks_it(client, db_session):
    _guard(db_session)
    client.get("/api/v1/timesheet/2026/7/export")
    assert client.post("/api/v1/timesheet/2026/7/reopen").status_code == 200
    assert (
        client.put(
            "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
        ).status_code
        == 200
    )


def test_export_blocks_when_an_employee_has_no_designation(client, db_session):
    db_session.add(Employee(id="G9999", name_en="Nobody", nationality="الإمارات", doj=date(2020, 1, 1)))
    db_session.commit()
    response = client.get("/api/v1/timesheet/2026/7/export")
    assert response.status_code == 422
    assert "no_designation" in response.text


def test_single_employee_export(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/employee/G1001/2026/7/export")
    assert response.status_code == 200
    assert "attachment" in response.headers["content-disposition"]


def test_creating_a_sick_leave_clears_the_absence(client, db_session):
    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    from datetime import date as _date

    from app.db.models import Absence, Leave

    db_session.add(
        Leave(
            employee_id="G1001",
            leave_type="Sick Leave",
            start_date=_date(2026, 7, 9),
            end_date=_date(2026, 7, 9),
            days=1,
            status="Approved",
        )
    )
    db_session.commit()
    from app.services import timesheet_service as svc

    svc.delete_absences_covered_by(db_session, "G1001", _date(2026, 7, 9), _date(2026, 7, 9))
    assert db_session.query(Absence).count() == 0
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "SL "
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -v`
Expected: FAIL — 404 on every route. The `client` fixture is in `backend/tests/conftest.py`; check how it authenticates and which capabilities it grants.

- [ ] **Step 3: Implement schemas, routes, capabilities and the hook**

Export uses `fastapi.responses.Response` with the xlsx media type and an RFC 5987 `filename*=UTF-8''...` disposition — the filenames are Arabic and a bare `filename=` mangles them.

Wire `delete_absences_covered_by` into the leave-creation path in `leave_service.py`, for `Sick Leave` and `Annual Leave` only.

- [ ] **Step 4: Run the tests, then the capability audit**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -v`
Then: `venv\Scripts\python.exe backend/scripts/audit_capability_gates.py`
Expected: tests PASS; the audit reports no ungated route.

- [ ] **Step 5: Regenerate the API contract and commit**

Use the `sync-api-types` skill, then:

```bash
git add backend/app/schemas/timesheet.py backend/app/api/v1/timesheet.py backend/app/core/permissions.py backend/app/main.py backend/app/services/leave_service.py backend/openapi.json frontend/src/lib/api.types.ts backend/tests/test_timesheet_api.py
git commit -m "feat(timesheet): API, capabilities, and absence supersede on leave create"
```

---

### Task 6: Golden reproduction test

**Files:**
- Create: `backend/tests/test_timesheet_golden.py`

**Interfaces:**
- Consumes: everything above, plus the live DB and the workbooks on the share.

This is the acceptance gate for the whole feature. It is skipped when the share or the live DB is unavailable, so CI on another machine stays green.

- [ ] **Step 1: Write the test**

```python
# backend/tests/test_timesheet_golden.py
"""Reproduce the hand-kept July 2026 sheet cell for cell.

Skipped unless the finance share and the live DB are both reachable — this is a
site-specific acceptance gate, not a portable unit test. The import script
established the baseline: July 0 differing cells of 8,525, June 49 of 8,460
(all six of June's residuals are departure-date errors in the hand file).
"""

from __future__ import annotations

import calendar
from datetime import date
from pathlib import Path

import pytest
from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import _sqlite_url_for, attach_sqlite_pragmas
from app.services import timesheet_service as svc

SHARE = Path(r"E:\Al Watbha Shares\المالية\احصائية 2026")
LIVE_DB = Path(__file__).resolve().parents[2] / "data" / "gssg.db"
SHEETS = {
    6: SHARE / r"6-Jun\كشف حضور شهر يونيو.xlsx",
    7: SHARE / r"7-Jul\كشف حضور شهر يوليو.xlsx",
}
# June's hand file lists G3808 (resigned 2026-04-02) as present all month, G4053
# for 13 days past his end date, and four others are off by a day or two.
ALLOWED_DIFFS = {6: 49, 7: 0}

pytestmark = pytest.mark.skipif(
    not LIVE_DB.exists() or not SHEETS[7].exists(),
    reason="needs the live DB and the finance share",
)


@pytest.fixture(scope="module")
def live_session():
    engine = create_engine(_sqlite_url_for(str(LIVE_DB)), future=True)
    attach_sqlite_pragmas(engine, wal=False)
    session = sessionmaker(bind=engine, future=True, expire_on_commit=False)()
    yield session
    session.close()


def _sheet_codes(path: Path, days: int) -> dict[str, list[str]]:
    sheet = load_workbook(path, read_only=True).worksheets[0]
    out: dict[str, list[str]] = {}
    for row in sheet.iter_rows(min_row=6, max_col=5 + days, values_only=True):
        if row[1] is None or not str(row[1]).strip():
            break
        out[str(row[1]).strip()] = [
            "" if row[5 + i] is None else str(row[5 + i]).strip().upper() for i in range(days)
        ]
    return out


@pytest.mark.parametrize("month", [6, 7])
def test_generated_grid_matches_the_hand_kept_sheet(live_session, month):
    days = calendar.monthrange(2026, month)[1]
    expected = _sheet_codes(SHEETS[month], days)
    grid = svc.build_month(live_session, 2026, month)
    generated = {r.employee_id: r.codes for r in grid.rows}

    differing = 0
    for employee_id, codes in expected.items():
        if employee_id not in generated:
            continue
        for index in range(days):
            mine = (generated[employee_id][index] or "").strip().upper()
            if mine != codes[index]:
                differing += 1
    assert differing <= ALLOWED_DIFFS[month], f"2026-{month:02d}: {differing} differing cells"


def test_july_roster_is_the_275_on_the_sheet(live_session):
    grid = svc.build_month(live_session, 2026, 7)
    assert len(grid.rows) == 275
    assert len(svc.build_month(live_session, 2026, 7, sheet="drivers").rows) == 2


def test_the_live_data_has_no_blocking_issues(live_session):
    """G5678 joined 2026-08-03 with no designation — he must not block July."""
    grid = svc.build_month(live_session, 2026, 7)
    assert grid.blocking == []
```

- [ ] **Step 2: Run it**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_golden.py -v`
Expected: PASS. If July shows any differing cell, do **not** raise `ALLOWED_DIFFS` — print the offending `(employee_id, day, mine, theirs)` triples and fix the rule or the data. July at zero is the whole point of the import.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_timesheet_golden.py
git commit -m "test(timesheet): golden reproduction of the June and July sheets"
```

---

### Task 7: Frontend page

**Files:**
- Create: `frontend/src/pages/timesheet/TimesheetPage.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetGrid.tsx`
- Create: `frontend/src/pages/timesheet/useTimesheet.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/timesheet/TimesheetGrid.test.tsx`

**Interfaces:**
- Consumes: the generated types in `frontend/src/lib/api.types.ts` from Task 5.
- Produces: route `/timesheet`, guarded with `<RequireCapability cap="timesheet.view">` following the existing `/permits` pattern in `App.tsx`.

Cell colours must match the workbook exactly, or the screen and the paper disagree:

```ts
export const CODE_COLORS: Record<string, string> = {
  P: 'transparent',
  AL: '#BDD7EE',
  'SL ': '#C6E0B4',
  AB: '#FFC7CE',
  TR: '#CC99FF',
  NG: '#FF9900',
  '-': 'transparent',
}
```

- [ ] **Step 1: Write the failing component test**

```tsx
// frontend/src/pages/timesheet/TimesheetGrid.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TimesheetGrid } from './TimesheetGrid'

const row = {
  employee_id: 'G1001',
  row_no: 1,
  name_en: 'TEST GUARD',
  nationality_en: 'U.A.E',
  designation_en: 'Security Guard',
  designation_ar: 'حارس امن',
  rank_order: 15,
  codes: Array(31).fill('P'),
  stat_codes: Array(31).fill('P'),
  stat_block: 1,
}

describe('TimesheetGrid', () => {
  it('renders one column per day of the month', () => {
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed={false} onSetCell={vi.fn()} />)
    expect(screen.getByRole('columnheader', { name: '31' })).toBeInTheDocument()
  })

  it('renders only 30 day columns in June', () => {
    render(<TimesheetGrid rows={[row]} daysInMonth={30} closed={false} onSetCell={vi.fn()} />)
    expect(screen.queryByRole('columnheader', { name: '31' })).not.toBeInTheDocument()
  })

  it('reports the cell the user picks', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed={false} onSetCell={onSetCell} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'AB' }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AB')
  })

  it('does not offer editing once the month is closed', async () => {
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed onSetCell={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    expect(screen.queryByRole('menuitem', { name: 'AB' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm -C frontend test -- TimesheetGrid`
Expected: FAIL — cannot resolve `./TimesheetGrid`.

- [ ] **Step 3: Build the grid, the hooks and the page**

`TimesheetPage.tsx` carries: month picker, main/drivers toggle, attendance/statistics toggle, the preflight banner (blocking issues disable the download buttons), the post-count field with the implied-post-count readout (`total P days ÷ days in month`), both download buttons, and the closed-month lock with a reopen action for `timesheet.edit`.

Use React Query for reads and mutations, following `frontend/src/pages/leaves/`. Strings go in both locale files. Use logical CSS properties throughout.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm -C frontend test -- TimesheetGrid`
Then: `pnpm -C frontend exec tsc -b --noEmit`
Expected: 4 tests PASS, no type errors. Do not run the lint and test suites together — combined frontend checks can exhaust memory on this host.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/timesheet frontend/src/App.tsx frontend/src/locales
git commit -m "feat(timesheet): month grid page with cell corrections and downloads"
```

---

### Task 8: Employee sheet button and the designation catalog

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx`
- Create: `frontend/src/pages/settings/DesignationCatalog.tsx`
- Modify: `frontend/src/pages/settings/SettingsPage.tsx`
- Modify: `backend/app/api/v1/timesheet.py` (designation list + reorder routes)
- Modify: `backend/app/services/timesheet_service.py` (`list_designations`, `reorder_designations`)
- Test: `backend/tests/test_timesheet_designations_api.py`

**Interfaces:**
- Produces: `GET /api/v1/timesheet/designations`, `PUT /api/v1/timesheet/designations/order` taking `{"ids": [int, ...]}` and rewriting `rank_order` to the given sequence.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_designations_api.py
"""The client asked for the roster sorted by rank, so rank order is editable."""


def test_list_returns_the_seeded_catalog_in_rank_order(client):
    body = client.get("/api/v1/timesheet/designations").json()
    assert len(body) == 16
    assert [d["rank_order"] for d in body] == list(range(1, 17))
    assert body[0]["name_en"] == "Prisons Director"
    assert body[0]["name_ar"] == "مدير عام الحراسات الأمنية"
    assert body[-1]["sheet"] == "drivers"


def test_reorder_rewrites_ranks_in_the_given_sequence(client):
    ids = [d["id"] for d in client.get("/api/v1/timesheet/designations").json()]
    swapped = [ids[1], ids[0], *ids[2:]]
    assert client.put("/api/v1/timesheet/designations/order", json={"ids": swapped}).status_code == 200
    body = client.get("/api/v1/timesheet/designations").json()
    assert body[0]["name_en"] == "Ass. Director"
    assert [d["rank_order"] for d in body] == list(range(1, 17))


def test_reorder_rejects_a_partial_list(client):
    ids = [d["id"] for d in client.get("/api/v1/timesheet/designations").json()]
    assert client.put("/api/v1/timesheet/designations/order", json={"ids": ids[:5]}).status_code == 422
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_designations_api.py -v`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`rank_order` is uniquely constrained, so reorder must write to a temporary offset first (e.g. `rank_order = -index - 1`), flush, then write the final `1..N`. Writing `1..N` directly collides.

The employee page gets a "Time sheet this month" download hitting `/api/v1/timesheet/employee/{id}/{year}/{month}/export` — put it beside the existing per-employee document actions and provide both the desktop and mobile surfaces, as the record actions in this app always do.

- [ ] **Step 4: Run the tests and typecheck**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_designations_api.py -v`
Then: `pnpm -C frontend exec tsc -b --noEmit`
Expected: 3 tests PASS, no type errors.

- [ ] **Step 5: Sync types and commit**

Use the `sync-api-types` skill, then commit all touched files with message `feat(timesheet): per-employee sheet and designation rank ordering`.

---

### Task 9: Verification and reviews

**Files:** none created.

- [ ] **Step 1: Full backend suite**

Run: `venv\Scripts\python.exe -m pytest -q`
Expected: only the three pre-existing failures listed in Global Constraints.

- [ ] **Step 2: Lint and types**

```powershell
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: ruff clean; mypy reports no new errors (30 pre-existing across 11 other files).

- [ ] **Step 3: Frontend checks, one at a time**

```powershell
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

- [ ] **Step 4: Smoke test the real thing**

Start the app, open `/timesheet`, pick July 2026, and confirm: 275 rows on the main sheet, 2 on drivers, the leave cells tinted, the implied post count reading 249 on the statistics view. Download both files and open them in Excel. Check the logo is present, the header reads `For the Month of :JUL-2026`, the footer totals compute, and the statistics sheet shows Arabic designations with the two-row gap before block 2. Diff the downloaded attendance sheet against `E:\Al Watbha Shares\المالية\احصائية 2026\7-Jul\كشف حضور شهر يوليو.xlsx`.

- [ ] **Step 5: Required reviews**

Run the `i18n-rtl-reviewer` on the new frontend surfaces. Both directions must be verified.

- [ ] **Step 6: Commit and hand back**

Commit any review fixes. Report the smoke-test result and the golden-test numbers. Do **not** deploy; the user decides when `mng deploy` runs.

---

## Deferred, by decision

- Mid-month "23" supplements (days 23–31 only). Discontinued after May; June and July have none.
- Multi-site support. Every 2026 file, including the `23` variants, is `JD 908` / `P0331_JD_PRN_908EXT`.
- PDF export. Excel COM works on this host but the chosen output is an xlsx download.
- Writing to the `E:` share.
- Changing `position` / `position_ar`, the leave lifecycle, or leave balances.
