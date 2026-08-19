# Monthly Time Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the two monthly Excel deliverables for site JD 908 — the HR attendance sheet and the client statistics sheet — from the database, in the exact format already in circulation, plus a single-employee sheet for HR handovers.

**Architecture:** A pure rule module (already landed) resolves an employee-month to 31 codes. A service assembles the roster, applies the statistics posts-vs-headcount split, and freezes the grid on first download. A renderer fills a sanitized `.xlsx` template with `openpyxl`, which round-trips the logo. A React page shows the grid, takes cell corrections, and downloads the files.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, SQLite, Alembic, openpyxl 3.1.5, React 19 + Vite + TypeScript, React Query, Vitest 4 + Testing Library, pytest.

## Global Constraints

- Run Python through `venv\Scripts\` and frontend commands through pnpm.
- This checkout is the live production checkout. Do **not** switch branches here — create a worktree via the `superpowers:using-git-worktrees` skill before Task 1.
- Never commit a Word/Excel resave of anything under `backend/templates/` other than the one file Task 1 creates.
- **`backend/openapi.json` is gitignored** (`.gitignore:99-100`). `git add` on an ignored path errors and aborts the whole invocation — never put it in a `git add` line, even though `sync-api-types` step 4 says to commit it.
- The `sync-api-types` skill lives at `.agents/skills/sync-api-types/SKILL.md`. The `.claude/` copy some older plans reference is local-only and gitignored.
- Pre-existing failures on this host, **not caused by this work and not to be fixed here**:
  - pytest: `test_config_openwa.py::test_openwa_settings_default_dormant`, `test_dav.py::test_dav_diagnostic_event_is_structured_and_redacted`, `test_migration_record_included_papers.py::test_record_included_papers_migration_upgrades_and_downgrades`.
  - `ruff check .`: 22 errors across 8 files — `app/core/crypto.py`, `app/services/admin_notify.py`, `app/services/email_service.py`, `app/services/scheduler_service.py`, `app/services/sms_templates.py`, `tests/test_admin_notify.py`, `tests/test_passport_printed.py`, `tests/test_permit_book_generation.py`. Your files must add none.
  - `mypy`: 30 errors across 11 files, none in timesheet code.
- Arabic and English are peers. Use logical CSS properties (`margin-inline-start`, not `margin-left`). Run the `i18n-rtl-reviewer` after Task 8.
- Exactly one Alembic head. Migration `0070_timesheet` is already applied. Task 3 adds `0071_timesheet_stat_fillers`; no other migration.
- `CODE_SICK` is `"SL "` **with a trailing space**. The workbook totals sick days with `COUNTIF(F:AJ,$AO$5)` where `AO5` holds `"SL "`. Dropping the space silently zeroes the client's sick column.
- Emitted codes are only: `P`, `AL`, `SL `, `AB`, `TR`, `NG`, `-`. Never emit `OFF`, `R`, `S` or `T`.
- Day 31 is blank in 30-day months; days 29–31 blank in February 2026.
- Services raise `AppError` subclasses from `app.api.errors` (`NotFoundError` 404, `ConflictError` 409, `ValidationFailedError` 422), never bare `ValueError`. The envelope is `{"error": {"code", "message", "details"}}`.
- Reference workbooks live at `E:\Al Watbha Shares\المالية\احصائية 2026\`. Read them; never write to that share. **Never open `data/gssg.db` read-write from a test.**
- Spec: `docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md`.

---

## Already Landed (commits `c47d163`, `HEAD`) — do not redo

- `backend/app/core/timesheet_codes.py` — the pure rule engine.
- `backend/app/core/leave_lifecycle.py` — `_english_part` promoted to public `english_part`; it handles both `"X - عربي"` and the dash-less `"Duty Resumption مباشرة عمل"`, and `timesheet_codes.leave_code` uses it.
- `backend/app/db/models.py` — `TimesheetDesignation`, `Absence`, `TimesheetPeriod`, `TimesheetOverride`, `TimesheetSnapshotRow`, `Employee.designation_id`.
- `backend/app/db/migrations/versions/0070_timesheet.py` — applied; seeds 16 designations.
- `backend/scripts/import_timesheet_history_2026.py` — applied and idempotent; July reproduces 0/8,525, June 49/8,460.
- `backend/tests/test_timesheet_codes.py` — 28 passing tests.
- `openpyxl>=3.1,<4.0` in `requirements.txt`.

Public API you will consume:

```python
from app.core.timesheet_codes import (
    CODE_ABSENT, CODE_ANNUAL, CODE_NATIONAL, CODE_NEW, CODE_OFF_ROSTER,
    CODE_PRESENT, CODE_SICK, EMITTED_CODES,
    LeaveSpan,   # frozen dataclass: leave_type, start, end, status="Approved"
    in_roster,   # (*, doj, end_date, month_start, month_end) -> bool
    is_void,     # (status: str) -> bool
    leave_code,  # (leave_type: str) -> str | None
    month_codes, # (year, month, *, doj, end_date, leaves, absences, overrides) -> list[str | None]
)
```

## Repo facts you will need (all verified — do not re-derive)

- **There is no shared `client` fixture.** `backend/tests/conftest.py` has only `_block_live_whatsapp_gateway` (autouse), `db_session`, `count_queries`, `make_user`, `admin_user`. Every API test module builds its own; `backend/tests/test_digests_api.py:26-75` is the cleanest template.
- **`db_session` builds schema with `Base.metadata.create_all`, never Alembic.** Migration seeds are invisible to tests. `perm_service.seed_role_defaults(db)` is called from the fixture for exactly this reason (`conftest.py:44`) — the designation catalog needs the same treatment (Task 3).
- Capability guards are signature dependencies: `_user: Annotated[User, Depends(require_capability("leaves.view"))]` (`backend/app/api/v1/leaves.py:58-68`). Routers own their prefix: `APIRouter(prefix="/leaves", tags=["leaves"])` (`leaves.py:39`). Registration: `app.include_router(leaves_v1.router, prefix="/api/v1", dependencies=auth_gate)` (`backend/app/main.py:181`).
- **Admin needs no role-preset edit** — `ALL_CAPABILITIES` is derived from `CAPABILITIES` (`permissions.py:159-163`). Only `_OPERATOR_CAPS` (`:173`) and `_MANAGER_CAPS` (`:191`) change.
- `Capability` is a NamedTuple with field order `id, domain, label, description` (`permissions.py:19-25`).
- Sick and annual `Leave` rows are created by `document_service._make_leave_row` (`backend/app/services/document_service.py:564`). `leave_service.create_leave` (`leave_service.py:360`) **rejects everything except National Service** at `:363-368`.
- `frontend/src/components/shell/navItems.ts:29` is the single nav registry: `{ to: '/permits', key: 'nav.permits', Icon: ShieldCheck, cap: 'permits.view' }`.
- `frontend/src/lib/api.ts` is the single typed client every page calls through.
- Locale files are `en.json`/`ar.json` with **nested** namespaces; `t('leaves.title')`. Only `en` is loaded for component tests (`frontend/src/test/setup.ts:116-121`); AR parity is enforced by a dedicated `*.i18n.test.ts` (see `frontend/src/locales/permits.i18n.test.ts`).
- jest-dom matchers are global (`setup.ts:1`). One frontend test file: `pnpm -C frontend exec vitest run src/path/to/file.test.tsx` (`CLAUDE.md:32`).
- `backend/scripts/audit_capability_gates.py` is a **report that always exits 0** — read its stdout, it can never fail a gate.
- Templates resolve through `get_settings().templates_dir`, not `__file__` — `backend/app/config.py:27-38` returns `_MEIPASS/templates/` under PyInstaller.

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/core/constants.py` (modify) | `NATIONALITY_EN`, `nationality_en()`, `ARABIC_MONTHS`, `DESIGNATION_SEED` |
| `backend/scripts/build_timesheet_template.py` (create) | One-off: sanitize the June workbook into the template |
| `backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx` (create) | The template: header + hidden `_parts` sheet |
| `backend/app/core/timesheet_xlsx.py` (create) | Template → filled workbook bytes. No DB. |
| `backend/app/services/timesheet_service.py` (create) | Seed, roster, grid, statistics split, close/reopen, snapshots |
| `backend/app/db/migrations/versions/0071_timesheet_stat_fillers.py` (create) | Block-2 filler assignments |
| `backend/app/schemas/timesheet.py` (create) | Pydantic request/response models |
| `backend/app/api/v1/timesheet.py` (create) | Routes |
| `backend/app/core/permissions.py` (modify) | `timesheet.view`, `timesheet.edit` |
| `backend/app/main.py` (modify) | Register the router; call `seed_designations` at startup |
| `backend/app/services/document_service.py` (modify) | Absence-supersede hook |
| `frontend/src/pages/timesheet/TimesheetPage.tsx` (create) | Month picker, preflight, downloads |
| `frontend/src/pages/timesheet/TimesheetGrid.tsx` (create) | The 31-column grid + code picker |
| `frontend/src/pages/timesheet/useTimesheet.ts` (create) | React Query hooks |
| `frontend/src/lib/api.ts` (modify) | Typed endpoints |
| `frontend/src/components/shell/navItems.ts` (modify) | Nav entry |
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
- Produces: the template file. `Sheet1` holds rows 1–5 only (header, logo anchored at `A1`), column widths, row heights, print setup and sheet view — **no cells at all below row 5**, and no conditional formats or data validations. A hidden sheet `_parts` holds one styled specimen data row at row 1 and the **18-row** footer block at rows 3–20.

Why a hidden `_parts` sheet: `openpyxl` does not shift merges, conditional formats or validations when rows are inserted or deleted, so anything parked on `Sheet1` leaves stray formatting behind. Copying `cell._style` from a separate sheet is one attribute assignment per cell and reproduces the original exactly (verified).

The footer is **18 rows**, `L+1` through `L+18` where `L` is the last data row: legend, signatures, `SUM` row, three blanks, `S.no` header, ten code rows, `Total Days`. In the June source with `L = 287` that is rows 288–305, confirmed by its merges `A288:AP288`, `A294:B294`, `A295:B304`, `A305:D305`.

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


def test_logo_survives(workbook):
    """The July attendance file on the share lost its logo to an outside tool."""
    assert workbook["Sheet1"].title == "Sheet1"
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


def test_nothing_survives_below_the_header(workbook):
    """Clearing values would leave June's fills and borders on ~300 empty rows."""
    sheet = workbook["Sheet1"]
    assert sheet.max_row == 5
    assert not [r for r in sheet.merged_cells.ranges if r.min_row > 5]


def test_the_template_carries_no_conditional_formats_or_validations(workbook):
    """The renderer builds both from scratch over the real extent."""
    sheet = workbook["Sheet1"]
    assert list(sheet.conditional_formatting) == []
    assert sheet.data_validations.dataValidation == []


def test_parts_sheet_is_hidden_and_carries_the_18_row_footer(workbook):
    parts = workbook["_parts"]
    assert parts.sheet_state == "hidden"
    assert parts["A1"].font.name == "Arial"  # specimen data row
    assert "Legend:" in str(parts["A3"].value)
    assert str(parts["A4"].value).startswith("Prepard By")
    assert parts["A9"].value == "S.no"
    assert parts["A20"].value == "Total Days"
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_template.py -v`
Expected: FAIL — the template file does not exist.

- [ ] **Step 3: Write the build script**

Note the ordering: **unmerge before clearing**, and **pop cells rather than blank them**. Every non-anchor cell of a merge is a `MergedCell` whose `.value` is read-only, so clearing first raises `AttributeError: 'MergedCell' object attribute 'value' is read-only`; and clearing a value leaves the style index behind, which openpyxl serialises — the shipped template would carry ~300 bordered, filled empty rows into every workbook the client receives.

```python
# backend/scripts/build_timesheet_template.py
"""Sanitize the June 2026 attendance workbook into the reusable template.

June is the source because it still has the company logo — the July attendance
file on the share lost its image to an outside tool. One-off; re-run only if the
client changes the paper.

    python backend/scripts/build_timesheet_template.py
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import load_workbook
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.worksheet.datavalidation import DataValidationList

SOURCE = Path(
    r"E:\Al Watbha Shares\المالية\احصائية 2026\6-Jun\كشف حضور شهر يونيو.xlsx"
)
DEST = Path(__file__).resolve().parents[1] / "templates" / "GSSG-HR_Monthly_Time_Sheet.xlsx"

FIRST_DATA_ROW = 6
LAST_DATA_ROW = 287  # June's last employee row; its footer starts at 288
FOOTER_ROWS = 18  # legend .. Total Days
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def main() -> None:
    workbook = load_workbook(SOURCE)
    sheet = workbook.worksheets[0]
    sheet.title = "Sheet1"  # the tests and the renderer address it by name

    parts = workbook.create_sheet("_parts")
    parts.sheet_state = "hidden"

    # _parts row 1: the styled specimen data row, values stripped.
    for column in range(1, 43):
        parts.cell(1, column)._style = sheet.cell(FIRST_DATA_ROW, column)._style
    parts.row_dimensions[1].height = sheet.row_dimensions[FIRST_DATA_ROW].height

    # _parts rows 3..20: the footer block, styles and static text intact.
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

    # Strip Sheet1 back to the header. Unmerge FIRST — a MergedCell's .value is
    # read-only — then pop the cells so no style index survives.
    for merged in [str(r) for r in sheet.merged_cells.ranges]:
        if int(merged.split(":")[0].lstrip(LETTERS)) >= FIRST_DATA_ROW:
            sheet.unmerge_cells(merged)
    for row in range(FIRST_DATA_ROW, sheet.max_row + 1):
        sheet.row_dimensions.pop(row, None)
        for column in range(1, 43):
            sheet._cells.pop((row, column), None)

    # The renderer builds these over the real extent; June's F6:AJ287 ranges would
    # otherwise ship a dropdown and four rules spanning 282 phantom rows.
    sheet.conditional_formatting = ConditionalFormattingList()
    sheet.data_validations = DataValidationList()

    sheet["D4"].value = "For the Month of :"
    sheet.freeze_panes = "F6"

    DEST.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(DEST)
    print(f"[template] wrote {DEST} ({DEST.stat().st_size} bytes)")

    check = load_workbook(DEST)
    assert len(check["Sheet1"]._images) == 1, "logo lost"
    assert check["Sheet1"].max_row == 5, f"stray rows: max_row={check['Sheet1'].max_row}"
    assert check["_parts"]["A20"].value == "Total Days", "footer is not 18 rows"
    print("[template] logo, strip and 18-row footer verified")
```

- [ ] **Step 4: Build the template and run the test**

Run: `venv\Scripts\python.exe -X utf8 backend/scripts/build_timesheet_template.py`
Then: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_template.py -v`
Expected: PASS, 7 tests.

If the footer assertion fails, print `[(r, parts.cell(r, 1).value) for r in range(3, 21)]`. `A3` must be the legend and `A20` must be `Total Days`. If `A3` is not the legend, `LAST_DATA_ROW` is wrong — find June's last row with an ID in column B. If `A3` is right but `A20` is not, the June footer is not 18 rows and the spec's footer table needs updating first.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/build_timesheet_template.py backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx backend/tests/test_timesheet_template.py
git commit -m "feat(timesheet): sanitized xlsx template built from the June workbook"
```

---

### Task 2: Nationality, month names, designation seed

**Files:**
- Modify: `backend/app/core/constants.py`
- Test: `backend/tests/test_timesheet_constants.py`

**Interfaces:**
- Produces: `NATIONALITY_EN: Mapping[str, str]`, `nationality_en(value: str | None) -> str | None`, `ARABIC_MONTHS: tuple[str, ...]` (12 entries, index 0 = January), `DESIGNATION_SEED: tuple[tuple[int, str, str, str], ...]` (rank, name_en, name_ar, sheet).

`DESIGNATION_SEED` moves here because the test suite never runs Alembic, so the catalog needs an app-side source of truth for `seed_designations` (Task 3). Migration `0070` keeps its own frozen copy — do not edit it.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_constants.py
"""Column D prints English nationalities; the DB stores Arabic, with variants."""

import pytest

from app.core.constants import ARABIC_MONTHS, DESIGNATION_SEED, nationality_en


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


def test_designation_seed_is_the_16_ranks_in_order():
    assert len(DESIGNATION_SEED) == 16
    assert [row[0] for row in DESIGNATION_SEED] == list(range(1, 17))
    assert DESIGNATION_SEED[0][1:] == (
        "Prisons Director",
        "مدير عام الحراسات الأمنية",
        "main",
    )
    assert DESIGNATION_SEED[-1][1:] == ("Driver", "سائق", "drivers")
    assert {row[3] for row in DESIGNATION_SEED} == {"main", "drivers"}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_constants.py -v`
Expected: FAIL with `ImportError: cannot import name 'nationality_en'`.

- [ ] **Step 3: Add the maps to `constants.py`**

`constants.py` already imports `Mapping`, `MappingProxyType` and `Final`. Append:

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

#: The printable time-sheet designations: (rank_order, name_en, name_ar, sheet).
#: Ranks 1-8 are the order the client already accepted; 9-15 group the guard tier
#: by post. Reference data, so ``timesheet_service.seed_designations`` can upsert
#: it at startup and in tests — the suite builds schema from ``metadata.create_all``
#: and never runs the migration that first inserted these rows.
DESIGNATION_SEED: Final[tuple[tuple[int, str, str, str], ...]] = (
    (1, "Prisons Director", "مدير عام الحراسات الأمنية", "main"),
    (2, "Ass. Director", "نائب عام مدير الحراسات الأمنية", "main"),
    (3, "Project Manager", "مديرمركز الإصلاح والتأهيل", "main"),
    (4, "Branche Manager", "مدير فرع", "main"),
    (5, "Duty In charge", "مناوب عام", "main"),
    (6, "Security Supervisor", "مشرف", "main"),
    (7, "Armory Officer", "مسؤول قطعة سلاح", "main"),
    (8, "assistant security supervisor", "مساعد مشرف", "main"),
    (9, "Armory Keeper", "خازن سلاح", "main"),
    (10, "Control room Security Guard", "حارس امن عرفة العمليات", "main"),
    (11, "Clinic Security Guard", "حارس امن حرس العيادة", "main"),
    (12, "Habilitation Security Guard", "حارس امن حرس التأهيل", "main"),
    (13, "Escort Security Guard", "حارس امن تنويم مستشفيات", "main"),
    (14, "Messengers", "حارس امن الارساليات", "main"),
    (15, "Security Guard", "حارس امن", "main"),
    (16, "Driver", "سائق", "drivers"),
)
```

- [ ] **Step 4: Run the test**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_constants.py -v`
Expected: PASS, 19 tests. Keep the `# noqa: RUF001` — ruff flags the Arabic damma as an ambiguous character.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/constants.py backend/tests/test_timesheet_constants.py
git commit -m "feat(timesheet): nationality, month and designation reference data"
```

---

### Task 3: The grid service

**Files:**
- Create: `backend/app/services/timesheet_service.py`
- Create: `backend/app/db/migrations/versions/0071_timesheet_stat_fillers.py`
- Modify: `backend/app/db/models.py` (add `TimesheetStatFiller`, export it)
- Modify: `backend/app/main.py` (call `seed_designations` in the startup reconcile block at `main.py:127-135`)
- Test: `backend/tests/test_timesheet_service.py`

**Interfaces:**
- Consumes: `app.core.timesheet_codes`, `app.core.constants` (`nationality_en`, `DESIGNATION_SEED`), `app.api.errors.ConflictError`, and the models.
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

def seed_designations(db: Session) -> None: ...
def build_month(db: Session, year: int, month: int, *, sheet: str = "main") -> MonthGrid: ...
def set_cell(db: Session, year: int, month: int, employee_id: str, day: int,
             code: str | None, *, note: str | None = None, user_id: int | None = None) -> None: ...
def set_post_count(db: Session, year: int, month: int, post_count: int) -> None: ...
def set_filler(db: Session, year: int, month: int, employee_id: str, code: str) -> None: ...
def close_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def reopen_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def delete_absences_covered_by(db: Session, employee_id: str, start: date, end: date) -> int: ...
def list_designations(db: Session) -> list[TimesheetDesignation]: ...
def reorder_designations(db: Session, ids: list[int]) -> None: ...
```

Rules, all measured from the workbooks:

1. `seed_designations` upserts `DESIGNATION_SEED` by `name_en`, idempotently — adds missing rows, never deletes. Called at startup and from every test fixture.
2. Roster: `in_roster(...)` plus `designation.sheet == sheet`. Employees with no designation are still listed (last, `rank_order=None`) **and** raise a `no_designation` blocking issue.
3. `post_count` defaults to **249** when the month has no `TimesheetPeriod` row. `build_month` must **not** create one — the golden test runs against the live database.
4. Sort: `rank_order` ascending, then the integer part of the employee ID (`G4053` → 4053; a non-numeric ID sorts last).
5. `stat_codes` for block 1 (`row_no <= post_count`): every cell becomes `P` except `NG` and `-`.
6. `stat_codes` for block 2: every cell becomes the row's filler code except `NG`, `-` and real `AB`. The filler is `timesheet_stat_fillers` for this month if set; else the same employee's filler from the previous month; else `AL`.
7. `set_cell` with `AB` writes an `Absence` row; any other code writes a `TimesheetOverride`; `None` deletes whichever exists. Rejects a `day` the month does not have (February has no 29th in 2026) with `ValidationFailedError`, and a closed month with `ConflictError("TIMESHEET_CLOSED", ...)` — a 409 in the standard envelope, which is how every other service here refuses.
8. `close_month` snapshots **both** sheets: it iterates `sheet in ("main", "drivers")`, writes one `TimesheetSnapshotRow` per row of each, and stamps `closed_at` on the single `TimesheetPeriod`. `build_month` returns the snapshot rows for the requested `sheet` verbatim when `closed_at` is set. Without this the drivers download after a close renders an empty workbook.
9. Warnings, one `Issue` each, non-blocking: `unknown_leave` for a live leave whose `leave_type` English half is `Unknown` overlapping the month; `overlapping_leave` for two live same-type leave rows whose ranges intersect; `departed_but_active` for `end_date` in the past while `status == 'Active'`; `no_doj` for a roster member with `doj IS NULL`; `duplicate_name` for two roster members sharing `name_en`.
10. `reorder_designations` writes negative temporary ranks, flushes, then writes `1..N` — `rank_order` is uniquely constrained, so a direct rewrite collides. It rejects a list that is not a permutation of every designation id with `ValidationFailedError("DESIGNATION_ORDER_INCOMPLETE", ...)`.

- [ ] **Step 1: Write the migration**

```python
# backend/app/db/migrations/versions/0071_timesheet_stat_fillers.py
"""timesheet stat fillers

Revision ID: 0071_timesheet_stat_fillers
Revises: 0070_timesheet
Create Date: 2026-08-19 00:00:00.000000

Per-month block-2 code assignments for the client statistics sheet. Block 2 is
the surplus headcount above the contracted post count; the operator chooses what
code each surplus row shows, and the choice carries forward month to month.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0071_timesheet_stat_fillers"
down_revision: str | Sequence[str] | None = "0070_timesheet"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "timesheet_stat_fillers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("code", sa.String(4), nullable=False),
        sa.UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_stat_filler"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_stat_filler_month"),
    )


def downgrade() -> None:
    op.drop_table("timesheet_stat_fillers")
```

Add the matching model to `backend/app/db/models.py` beside `TimesheetSnapshotRow`, with the same column types, both constraints, and `"TimesheetStatFiller"` in `__all__`. The test suite builds schema from `Base.metadata`, so a mismatch means tests and production disagree.

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_timesheet_service.py
"""Roster, ordering, and the statistics posts-vs-headcount split.

The numbers come from July 2026: 275 on the main sheet, 2 drivers, 249 posts.
"""

from datetime import date

import pytest

from app.api.errors import ConflictError, ValidationFailedError
from app.core.timesheet_codes import CODE_ANNUAL, CODE_NEW, CODE_OFF_ROSTER, CODE_PRESENT, CODE_SICK
from app.db.models import Absence, Employee, Leave, TimesheetDesignation
from app.services import timesheet_service as svc


@pytest.fixture(autouse=True)
def _designations(db_session):
    """metadata.create_all skips migration 0070, which is what seeds the catalog."""
    svc.seed_designations(db_session)


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


def test_seeding_is_idempotent(db_session):
    svc.seed_designations(db_session)
    assert db_session.query(TimesheetDesignation).count() == 16


def test_supervisor_sorts_above_guards_and_ids_break_ties(db_session, guards):
    grid = svc.build_month(db_session, 2026, 7)
    assert [r.employee_id for r in grid.rows] == ["G0999", "G1001", "G1002"]
    assert [r.row_no for r in grid.rows] == [1, 2, 3]


def test_drivers_are_a_separate_sheet(db_session, guards):
    assert [r.employee_id for r in svc.build_month(db_session, 2026, 7, sheet="drivers").rows] == [
        "G2000"
    ]


def test_post_count_defaults_to_249_without_creating_a_period(db_session, guards):
    from app.db.models import TimesheetPeriod

    grid = svc.build_month(db_session, 2026, 7)
    assert grid.post_count == 249
    assert db_session.query(TimesheetPeriod).count() == 0


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


def test_a_filler_choice_overrides_the_default(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 2)
    svc.set_filler(db_session, 2026, 7, "G1002", CODE_SICK)
    grid = svc.build_month(db_session, 2026, 7)
    assert grid.rows[2].stat_codes[:31] == [CODE_SICK] * 31


def test_a_filler_choice_carries_into_the_next_month(db_session, guards):
    svc.set_post_count(db_session, 2026, 7, 2)
    svc.set_filler(db_session, 2026, 7, "G1002", CODE_SICK)
    svc.set_post_count(db_session, 2026, 8, 2)
    grid = svc.build_month(db_session, 2026, 8)
    assert grid.rows[2].stat_codes[0] == CODE_SICK


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


def test_a_day_the_month_does_not_have_is_rejected(db_session, guards):
    with pytest.raises(ValidationFailedError):
        svc.set_cell(db_session, 2026, 2, "G1001", 29, "AB")


def test_a_sick_certificate_supersedes_the_absence(db_session, guards):
    svc.set_cell(db_session, 2026, 7, "G1001", 14, "AB")
    removed = svc.delete_absences_covered_by(
        db_session, "G1001", date(2026, 7, 14), date(2026, 7, 14)
    )
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
    assert {i.kind for i in svc.build_month(db_session, 2026, 7).blocking} == {"no_nationality"}


def test_warnings_are_reported_without_blocking(db_session, guards):
    db_session.get(Employee, "G1001").name_en = "Name G1002"  # duplicate_name
    employee = db_session.get(Employee, "G0999")
    employee.end_date = date(2026, 6, 1)  # departed_but_active
    employee.status = "Active"
    db_session.add(
        Leave(
            employee_id="G1002",
            leave_type="Unknown",
            start_date=date(2026, 7, 3),
            end_date=date(2026, 7, 4),
            days=2,
            status="Approved",
        )
    )
    db_session.commit()
    grid = svc.build_month(db_session, 2026, 7)
    assert {"duplicate_name", "departed_but_active", "unknown_leave"} <= {
        i.kind for i in grid.warnings
    }
    assert grid.blocking == []


def test_closing_freezes_both_sheets(db_session, guards):
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
    drivers = svc.build_month(db_session, 2026, 7, sheet="drivers")
    assert [r.employee_id for r in drivers.rows] == ["G2000"]


def test_a_closed_month_refuses_edits(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    with pytest.raises(ConflictError, match="closed"):
        svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")


def test_reopening_restores_live_recomputation(db_session, guards):
    svc.close_month(db_session, 2026, 7)
    svc.reopen_month(db_session, 2026, 7)
    svc.set_cell(db_session, 2026, 7, "G1001", 3, "AB")
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G1001")
    assert row.codes[2] == "AB"


def test_reorder_rewrites_ranks_and_rejects_a_partial_list(db_session):
    ids = [d.id for d in svc.list_designations(db_session)]
    svc.reorder_designations(db_session, [ids[1], ids[0], *ids[2:]])
    assert [d.rank_order for d in svc.list_designations(db_session)] == list(range(1, 17))
    assert svc.list_designations(db_session)[0].name_en == "Ass. Director"
    with pytest.raises(ValidationFailedError):
        svc.reorder_designations(db_session, ids[:5])
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -v`
Expected: FAIL — `ModuleNotFoundError: app.services.timesheet_service`.

- [ ] **Step 4: Implement the service**

Two helpers that are easy to get wrong:

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

Load leaves, absences, overrides and fillers for the month in four queries, not per employee — the main sheet is 275 rows and a per-row query would be 1,100 round trips.

Add `timesheet_service.seed_designations(db)` to the startup reconcile block in `backend/app/main.py:127-135`, beside `perm_service.seed_role_defaults`.

- [ ] **Step 5: Run the tests and the migration round-trip**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -v`
Then: `venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe heads`
Expected: 20 tests PASS; exactly one head, `0071_timesheet_stat_fillers`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/timesheet_service.py backend/app/db/models.py backend/app/db/migrations/versions/0071_timesheet_stat_fillers.py backend/app/main.py backend/tests/test_timesheet_service.py
git commit -m "feat(timesheet): grid service with the statistics posts split"
```

---

### Task 4: The renderer

**Files:**
- Create: `backend/app/core/timesheet_xlsx.py`
- Test: `backend/tests/test_timesheet_xlsx.py`

**Interfaces:**
- Consumes: `MonthGrid`/`GridRow` from Task 3, the template from Task 1, `ARABIC_MONTHS` from Task 2.
- Produces:

```python
def render(grid: MonthGrid, *, variant: str = "attendance") -> bytes: ...
    # "attendance" -> column E = designation_en, GridRow.codes
    # "statistics" -> column E = designation_ar, GridRow.stat_codes, two blocks

def render_single(grid: MonthGrid, employee_id: str) -> bytes: ...
def filename_for(grid: MonthGrid, *, variant: str = "attendance") -> str: ...
def filename_for_single(grid: MonthGrid, employee_id: str) -> str: ...
```

Render steps, in order:

0. `TEMPLATE = get_settings().templates_dir / "GSSG-HR_Monthly_Time_Sheet.xlsx"`, resolved **at call time** — a module-level `__file__` path breaks the PyInstaller layout (`backend/app/config.py:27`).
1. `load_workbook(TEMPLATE)`; take `Sheet1` and `_parts`; `del workbook["_parts"]` last.
2. `Sheet1["D4"] = f"For the Month of :{MON}-{year}"` with the uppercase three-letter English abbreviation (`JUL`).
3. For each output row `r` from 6: copy `_parts` row 1 styles into row `r`, set `row_dimensions[r].height = 27.95`, write `A`=row_no, `B`=employee_id, `C`=name_en, `D`=nationality_en, `E`=designation, the day cells, then the six per-row formulas verbatim:
   `AK` `=COUNTIF(F{r}:AJ{r},"P")`, `AL` `=COUNTIF(F{r}:AJ{r},"OFF")`, `AM` `=COUNTIF(F{r}:AJ{r},"AB")`, `AN` `=COUNTIF(F{r}:AK{r},"AL")` (spans `AK` in the original), `AO` `=COUNTIF(F{r}:AJ{r},$AO$5)`, `AP` `=COUNTIF(F{r}:AJ{r},"TR")`.
4. Statistics variant: emit block 1, then **two empty rows**, then block 2, while column `A` keeps counting continuously.
5. Footer at `L+1` where `L` is the last data row: copy the 18 `_parts` rows, re-merge (`A:AP` legend; `A:M`, `N:AC`, `AD:AP` signatures; `A:B` on the `S.no` row; `A:B` spanning the ten code rows; `A:D` on `Total Days`), then write the formulas:
   - `L+3`, columns `AK`..`AP`: `=SUM({col}6:{col}{L})`
   - `L+8`..`L+17`, column `E`: Sick `=AO{L+3}`, Annual `=AN{L+3}`, Abcent `=AM{L+3}`, National Service `=AP{L+3}`, P `=AK{L+3}`, OFF `=AL{L+3}`; New Gard, `-`, R and S are `=COUNTIF(F6:AJ{L},"<code>")`
   - `L+18`, column `E`: `=SUM(E{L+8}:E{L+17})`
6. Build the four conditional-format rules and the code data-validation from scratch over `F6:AJ{L}` — the template carries none. Fills from the spec's Codes table: `AL` `#BDD7EE`, `SL ` `#C6E0B4`, `AB` `#FFC7CE` with font `#9C0006`, `TR` `#CC99FF`, `NG` `#FF9900`. Validation list: `P,AL,SL ,AB,TR,NG,-`.
7. Save to `io.BytesIO`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_timesheet_xlsx.py
"""The rendered workbook must match the paper already in circulation."""

import io
from datetime import date

import pytest
from openpyxl import load_workbook

from app.core import timesheet_xlsx
from app.db.models import Employee, TimesheetDesignation
from app.services import timesheet_service as svc


@pytest.fixture(autouse=True)
def _designations(db_session):
    svc.seed_designations(db_session)


@pytest.fixture()
def guard(db_session):
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


def _sheet(payload: bytes):
    return load_workbook(io.BytesIO(payload)).worksheets[0]


def test_attendance_sheet_keeps_the_logo_and_header(db_session, guard):
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 7)))
    assert len(sheet._images) == 1
    assert sheet["D4"].value == "For the Month of :JUL-2026"
    assert sheet["Q2"].value == " Site Name :   JD 908"


def test_a_data_row_carries_values_and_the_countif_formulas(db_session, guard):
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 7)))
    assert [sheet.cell(6, c).value for c in (1, 2, 3, 4, 5)] == [
        1, "G1001", "TEST GUARD", "U.A.E", "Security Guard"
    ]
    assert sheet["F6"].value == "P"
    assert sheet["AK6"].value == '=COUNTIF(F6:AJ6,"P")'
    assert sheet["AN6"].value == '=COUNTIF(F6:AK6,"AL")'   # spans AK in the original
    assert sheet["AO6"].value == "=COUNTIF(F6:AJ6,$AO$5)"  # $AO$5 holds "SL "


def test_the_footer_follows_the_last_data_row(db_session, guard):
    """One data row: L=6, so legend 7, signatures 8, sums 9, Total Days 24."""
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 7)))
    assert "Legend:" in str(sheet["A7"].value)
    assert str(sheet["A8"].value).startswith("Prepard By")
    assert sheet["AK9"].value == "=SUM(AK6:AK6)"
    assert sheet["A13"].value == "S.no"
    assert sheet["E14"].value == "=AO9"          # Sick Leave row
    assert sheet["A24"].value == "Total Days"
    assert sheet["E24"].value == "=SUM(E14:E23)"


def test_a_thirty_day_month_leaves_day_31_empty(db_session, guard):
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 6)))
    assert sheet["AI6"].value == "P"
    assert sheet["AJ6"].value is None


def test_conditional_formats_span_only_the_real_extent(db_session, guard):
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 7)))
    ranges = {str(cf.sqref) for cf in sheet.conditional_formatting}
    assert ranges == {"F6:AJ6"}


def test_statistics_uses_arabic_designations(db_session, guard):
    grid = svc.build_month(db_session, 2026, 7)
    sheet = _sheet(timesheet_xlsx.render(grid, variant="statistics"))
    assert sheet["E6"].value == "حارس امن"


def test_statistics_splits_blocks_with_two_blank_rows(db_session, guard):
    svc.set_post_count(db_session, 2026, 7, 0)  # everyone is surplus
    grid = svc.build_month(db_session, 2026, 7)
    sheet = _sheet(timesheet_xlsx.render(grid, variant="statistics"))
    assert sheet["B6"].value is None and sheet["B7"].value is None
    assert sheet["B8"].value == "G1001"
    assert sheet["A8"].value == 1  # numbering continues across the gap


def test_filenames_are_the_arabic_names_in_use(db_session, guard):
    grid = svc.build_month(db_session, 2026, 7)
    assert timesheet_xlsx.filename_for(grid) == "كشف حضور شهر يوليو.xlsx"
    assert timesheet_xlsx.filename_for(grid, variant="statistics") == "الاحصائية شهر يوليو.xlsx"
    assert timesheet_xlsx.filename_for_single(grid, "G1001") == "كشف حضور TEST GUARD يوليو.xlsx"


def test_drivers_filename_has_its_own_suffix(db_session, guard):
    grid = svc.build_month(db_session, 2026, 7, sheet="drivers")
    assert timesheet_xlsx.filename_for(grid) == "كشف حضور شهر يوليو للسائقين.xlsx"


def test_a_single_employee_sheet_has_one_row(db_session, guard):
    grid = svc.build_month(db_session, 2026, 7)
    sheet = _sheet(timesheet_xlsx.render_single(grid, "G1001"))
    assert sheet["B6"].value == "G1001"
    assert "Legend:" in str(sheet["A7"].value)
```

`sheet["B7"].value is None` in the block-split test because `B7` sits inside the `A7:AP7` legend merge on the attendance variant and is a genuinely empty cell on the statistics variant — both give `None`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.timesheet_xlsx`.

- [ ] **Step 3: Implement the renderer**

Copy styles with `target._style = source._style` — never build `Font`/`Fill` objects by hand, or the output drifts from the paper.

- [ ] **Step 4: Run the tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: PASS, 10 tests.

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
- Modify: `backend/app/services/document_service.py`
- Test: `backend/tests/test_timesheet_api.py`

**Interfaces:**
- Consumes: `timesheet_service`, `timesheet_xlsx`.
- Produces:

| Method | Path | Capability |
| --- | --- | --- |
| `GET` | `/timesheet/designations` | `timesheet.view` |
| `PUT` | `/timesheet/designations/order` | `timesheet.edit` |
| `GET` | `/timesheet/{year}/{month}` | `timesheet.view` |
| `PUT` | `/timesheet/{year}/{month}/cell` | `timesheet.edit` |
| `PATCH` | `/timesheet/{year}/{month}` | `timesheet.edit` |
| `POST` | `/timesheet/{year}/{month}/close` | `timesheet.edit` |
| `POST` | `/timesheet/{year}/{month}/reopen` | `timesheet.edit` |
| `GET` | `/timesheet/{year}/{month}/export` | `timesheet.view` |
| `GET` | `/timesheet/employee/{employee_id}/{year}/{month}/export` | `timesheet.view` |

Declare the two static `designations` routes **before** the `{year}/{month}` routes, or the catch-all shadows them.

Capabilities, added to the `CAPABILITIES` tuple in `permissions.py` next to the `leaves.*` entries:

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

Add `timesheet.view` to `_OPERATOR_CAPS` and `timesheet.edit` to `_MANAGER_CAPS`. **Do not touch admin** — `ALL_CAPABILITIES` is derived from `CAPABILITIES`.

- [ ] **Step 1: Write the failing tests**

Copy the fixture block from `backend/tests/test_digests_api.py:26-75`. `db_session` **must** be a local fixture returning `api_db`, or the client and the seeded rows land in different databases.

```python
# backend/tests/test_timesheet_api.py
"""Routes, capability gates, and the freeze-on-download contract."""

from __future__ import annotations

from datetime import date
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Employee, TimesheetDesignation, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service
from app.services import timesheet_service as svc


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "timesheet.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True, connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    svc.seed_designations(db)  # metadata.create_all skips the migration seed
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def db_session(api_db) -> Session:
    """Shadow the conftest fixture so the client and the seeds share one DB."""
    return api_db


@pytest.fixture()
def client(api_db) -> TestClient:
    user = User(email="mgr@x.ae", password_hash="x", role="manager", status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _guard(db: Session) -> None:
    designation = db.query(TimesheetDesignation).filter_by(name_en="Security Guard").one()
    db.add(
        Employee(
            id="G1001",
            name_en="TEST GUARD",
            nationality="الإمارات",
            doj=date(2020, 1, 1),
            designation_id=designation.id,
        )
    )
    db.commit()


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


def test_export_returns_an_xlsx_with_an_rfc5987_arabic_filename(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/2026/7/export?variant=attendance")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml"
    )
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''" in disposition  # a bare filename= raises on latin-1
    assert quote("كشف حضور") in disposition
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
    db_session.add(
        Employee(id="G9999", name_en="Nobody", nationality="الإمارات", doj=date(2020, 1, 1))
    )
    db_session.commit()
    response = client.get("/api/v1/timesheet/2026/7/export")
    assert response.status_code == 422
    assert "no_designation" in response.text


def test_single_employee_export(client, db_session):
    _guard(db_session)
    response = client.get("/api/v1/timesheet/employee/G1001/2026/7/export")
    assert response.status_code == 200
    assert "filename*=UTF-8''" in response.headers["content-disposition"]


def test_patch_sets_the_post_count_and_a_filler(client, db_session):
    _guard(db_session)
    response = client.patch(
        "/api/v1/timesheet/2026/7",
        json={"post_count": 0, "fillers": [{"employee_id": "G1001", "code": "SL "}]},
    )
    assert response.status_code == 200
    row = client.get("/api/v1/timesheet/2026/7").json()["rows"][0]
    assert row["stat_block"] == 2
    assert row["stat_codes"][0] == "SL "


def test_designations_list_and_reorder(client):
    body = client.get("/api/v1/timesheet/designations").json()
    assert len(body) == 16
    assert [d["rank_order"] for d in body] == list(range(1, 17))
    assert body[0]["name_en"] == "Prisons Director"
    assert body[-1]["sheet"] == "drivers"
    ids = [d["id"] for d in body]
    assert (
        client.put(
            "/api/v1/timesheet/designations/order", json={"ids": [ids[1], ids[0], *ids[2:]]}
        ).status_code
        == 200
    )
    assert client.get("/api/v1/timesheet/designations").json()[0]["name_en"] == "Ass. Director"
    assert (
        client.put("/api/v1/timesheet/designations/order", json={"ids": ids[:5]}).status_code == 422
    )


def test_generating_a_sick_leave_clears_the_absence(client, db_session):
    """Drives the real creation path — a hand-inserted Leave would not exercise the hook."""
    from app.db.models import Absence
    from app.services import document_service

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert db_session.query(Absence).count() == 1
    document_service.generate_document(  # match the real signature when writing this
        db_session,
        template_id="Leave Application Form",
        employee_id="G1001",
        fields={
            "leave_type": "Sick Leave",
            "start_date": "2026-07-09",
            "end_date": "2026-07-09",
            "total_days": 1,
        },
    )
    assert db_session.query(Absence).count() == 0
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "SL "
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -v`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement schemas, routes, capabilities and the hook**

Export uses `fastapi.responses.Response` with the xlsx media type and `content-disposition: attachment; filename*=UTF-8''<percent-encoded>`. Starlette encodes headers as latin-1, so a bare `filename="كشف حضور…"` raises `UnicodeEncodeError` mid-response.

Wire `delete_absences_covered_by` into the path that actually creates sick and annual rows: `document_service._make_leave_row` builds them (`backend/app/services/document_service.py:564`), while `leave_service.create_leave` rejects everything but National Service (`leave_service.py:363`). Call it at the commit site downstream of `_make_leave_row`, for `Sick Leave` and `Annual Leave` only, passing the row's `start_date` and `end_date`.

Read `document_service` around line 564 first and adapt the test's `generate_document(...)` call to the real function name and signature.

- [ ] **Step 4: Run the tests and the capability report**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -v`
Then: `venv\Scripts\python.exe backend/scripts/audit_capability_gates.py`
Expected: 10 tests PASS. The audit always exits 0 — read its stdout and confirm every `timesheet` route is listed as dependency-gated.

- [ ] **Step 5: Regenerate the API contract and commit**

Use the `sync-api-types` skill (`.agents/skills/sync-api-types/SKILL.md`), then:

```bash
git add backend/app/schemas/timesheet.py backend/app/api/v1/timesheet.py backend/app/core/permissions.py backend/app/main.py backend/app/services/document_service.py frontend/src/lib/api.types.ts backend/tests/test_timesheet_api.py
git commit -m "feat(timesheet): API, capabilities, and absence supersede on leave generation"
```

`backend/openapi.json` is gitignored — it is regenerated by the build and must not appear in that `git add`.

---

### Task 6: Golden reproduction test

**Files:**
- Create: `backend/tests/test_timesheet_golden.py`

This is the acceptance gate for the whole feature. It is skipped when the share or the live DB is unavailable, so CI elsewhere stays green, and it opens the production database **read-only**.

- [ ] **Step 1: Write the test**

```python
# backend/tests/test_timesheet_golden.py
"""Reproduce the hand-kept July 2026 sheet cell for cell.

Skipped unless the finance share and the live DB are both reachable — this is a
site-specific acceptance gate, not a portable unit test. The import script
established the baseline: July 0 differing cells of 8,525; June 49 of 8,460,
where the 49 span six employees and are all departure-date errors in the hand
file rather than engine errors.
"""

from __future__ import annotations

import calendar
from collections import Counter
from pathlib import Path

import pytest
from openpyxl import load_workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.session import attach_sqlite_pragmas
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
    # Read-only: this is the production database.
    engine = create_engine(
        f"sqlite:///file:{LIVE_DB.as_posix()}?mode=ro&uri=true",
        future=True,
        connect_args={"uri": True},
    )
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

    # Only the two drivers may be absent from the main sheet's generated roster.
    missing = sorted(set(expected) - set(generated))
    assert len(missing) <= 2, f"2026-{month:02d}: {len(missing)} sheet rows not generated: {missing}"

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


@pytest.mark.parametrize(("month", "block1", "block2"), [(6, 249, 33), (7, 249, 26)])
def test_statistics_blocks_match_the_hand_kept_split(live_session, month, block1, block2):
    counts = Counter(r.stat_block for r in svc.build_month(live_session, 2026, month).rows)
    assert (counts[1], counts[2]) == (block1, block2)


def test_the_live_data_has_no_blocking_issues(live_session):
    """G5678 joined 2026-08-03 with no designation — he must not block July."""
    assert svc.build_month(live_session, 2026, 7).blocking == []
```

- [ ] **Step 2: Run it**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_golden.py -v`
Expected: PASS. If July shows any differing cell, do **not** raise `ALLOWED_DIFFS` — print the offending `(employee_id, day, mine, theirs)` triples and fix the rule or the data. July at zero is the whole point of the import.

June's block counts assume the roster the hand sheet carried; if `test_statistics_blocks_match_the_hand_kept_split` fails for June by exactly one row, that is the G4810/G5704 omission the import already documented — record it in the docstring rather than changing the split rule.

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
- Modify: `frontend/src/lib/api.ts` (grid read, cell PUT, month PATCH, close/reopen POST, two blob downloads — follow the `fetchPermitDocumentBlob` pattern)
- Modify: `frontend/src/components/shell/navItems.ts` (add `{ to: '/timesheet', key: 'nav.timesheet', Icon: CalendarClock, cap: 'timesheet.view' }`)
- Modify: `frontend/src/App.tsx` (lazy const + guarded route, copying the `/permits` pattern at `App.tsx:226-233`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (`nav.timesheet` + a nested `timesheet` namespace)
- Test: `frontend/src/pages/timesheet/TimesheetGrid.test.tsx`
- Test: `frontend/src/locales/timesheet.i18n.test.ts` (copy the shape of `permits.i18n.test.ts`)

**Interfaces:**
- Consumes: the generated types in `frontend/src/lib/api.types.ts` from Task 5.
- Produces: `TimesheetGrid` with props `{ rows, daysInMonth, closed, onSetCell }` where
  `onSetCell: (employeeId: string, day: number, code: string | null, note?: string) => void`.

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

  it('reports a plain code immediately', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed={false} onSetCell={onSetCell} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'AL' }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AL')
  })

  it('collects an optional note when marking absence', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed={false} onSetCell={onSetCell} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'AB' }))
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'no show')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AB', 'no show')
  })

  it('does not offer editing once the month is closed', async () => {
    render(<TimesheetGrid rows={[row]} daysInMonth={31} closed onSetCell={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    expect(screen.queryByRole('menuitem', { name: 'AB' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx`
Expected: FAIL — cannot resolve `./TimesheetGrid`.

- [ ] **Step 3: Build the grid, the hooks and the page**

`TimesheetPage.tsx` carries: month picker, main/drivers toggle, attendance/statistics toggle, the preflight banner (blocking issues disable the downloads, warnings are shown but do not), the post-count field with the implied-post-count readout, both download buttons, and the closed-month lock with a reopen action for `timesheet.edit`.

The shared `Table` primitive already wraps in `w-full overflow-x-auto` (`frontend/src/components/ui/table.tsx:12`) — nothing in this repo scrolls 31 data columns yet, so start from that and only reach for `@tanstack/react-virtual` if 275 rows measurably drag.

Use React Query for reads and mutations, following `frontend/src/pages/leaves/report/useLeaveReport.ts`. Strings go in both locale files, nested under one `timesheet` namespace. Logical CSS properties throughout.

- [ ] **Step 4: Run the tests and typecheck**

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx
pnpm -C frontend exec vitest run src/locales/timesheet.i18n.test.ts
pnpm -C frontend exec tsc -b --noEmit
```

Expected: 5 grid tests PASS, i18n parity PASS, no type errors. Run these one at a time — combined frontend checks can exhaust memory on this host.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/timesheet frontend/src/lib/api.ts frontend/src/components/shell/navItems.ts frontend/src/App.tsx frontend/src/locales
git commit -m "feat(timesheet): month grid page with cell corrections and downloads"
```

---

### Task 8: Employee sheet button and the designation catalog UI

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx`
- Create: `frontend/src/pages/settings/DesignationCatalog.tsx`
- Modify: `frontend/src/pages/settings/SettingsPage.tsx`
- Modify: `frontend/src/lib/api.ts` (designations list + reorder + single-employee download)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

The backend for both already exists — Task 3 built `list_designations`/`reorder_designations`, Task 5 exposed the routes, and Task 5's `test_designations_list_and_reorder` covers them. This task is UI only.

- [ ] **Step 1: Add the employee download**

A "Time sheet this month" action on the employee record hitting `/api/v1/timesheet/employee/{id}/{year}/{month}/export`, beside the existing per-employee document actions. Provide **both the desktop and the mobile surfaces** — record actions in this app always have both (`AGENTS.md:44`).

- [ ] **Step 2: Build the designation catalog panel**

A Settings panel listing the 16 designations in rank order with drag-to-reorder, calling `PUT /timesheet/designations/order` with the full id list on drop. Show `name_en`, `name_ar` and the `main`/`drivers` badge. Guard the panel behind `timesheet.edit`.

- [ ] **Step 3: Typecheck and smoke it**

```powershell
pnpm -C frontend exec tsc -b --noEmit
```

Then open an employee record and Settings in the running app; confirm the download returns a one-row workbook and that a drag persists after reload.

- [ ] **Step 4: Sync types and commit**

Use the `sync-api-types` skill, then commit every touched file (never `backend/openapi.json`) with `feat(timesheet): per-employee sheet and designation rank ordering`.

---

### Task 9: Verification and reviews

**Files:** none created.

- [ ] **Step 1: Full backend suite**

Run: `venv\Scripts\python.exe -m pytest -q`
Expected: only the three pre-existing failures named in Global Constraints.

- [ ] **Step 2: Lint and types**

```powershell
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: ruff reports only the 22 pre-existing errors in the 8 files named in Global Constraints, and none in timesheet files; `ruff format --check` clean; mypy reports only the 30 pre-existing errors.

- [ ] **Step 3: Frontend checks, one at a time**

```powershell
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

- [ ] **Step 4: Smoke test the real thing**

Start the app, open `/timesheet`, pick July 2026, and confirm: 275 rows on the main sheet, 2 on drivers, the leave cells tinted, and the implied post count a little **below** the configured 249 on the statistics view — it is `P days ÷ days in month` and roster edges (`NG`, `-`) subtract, so June's reference figure is 7,351 ÷ 30 = 245.0. A reading *above* 249 is the drift the readout exists to expose.

Download both files and open them in Excel. Check the logo is present, the header reads `For the Month of :JUL-2026`, the footer totals compute, no stray formatting sits below the footer, and the statistics sheet shows Arabic designations with the two-row gap before block 2. Diff the downloaded attendance sheet against `E:\Al Watbha Shares\المالية\احصائية 2026\7-Jul\كشف حضور شهر يوليو.xlsx`.

- [ ] **Step 5: Required reviews**

Run the `i18n-rtl-reviewer` on the new frontend surfaces. Both directions must be verified. Run the `alembic-migration-reviewer` for migration `0071`.

- [ ] **Step 6: Commit and hand back**

Commit any review fixes. Report the smoke-test result and the golden-test numbers. Do **not** deploy; the user decides when `mng deploy` runs.

---

## Deferred, by decision

- Mid-month "23" supplements (days 23–31 only). Discontinued after May; June and July have none.
- Multi-site support. Every 2026 file, including the `23` variants, is `JD 908` / `P0331_JD_PRN_908EXT`.
- PDF export. Excel COM works on this host but the chosen output is an xlsx download.
- Writing to the `E:` share.
- Changing `position` / `position_ar`, the leave lifecycle, or leave balances.
- Automatically reproducing the *initial* June/July block-2 filler shape. Fillers default to `AL`, the operator sets the shape once, and it then carries forward month to month.
