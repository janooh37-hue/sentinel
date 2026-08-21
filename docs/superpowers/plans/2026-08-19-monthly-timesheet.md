# Monthly Time Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the two monthly Excel deliverables for site JD 908 — the HR attendance sheet and the client statistics sheet — from the database, in the exact format already in circulation, plus a two-month single-employee sheet for resignation and termination handovers.

**Architecture:** A pure rule module (already landed) resolves an employee-month to 31 codes. A service assembles the roster, applies the statistics posts-vs-headcount split, reports the roster movement in and out of the month, and freezes the grid on first download. A renderer fills a sanitized `.xlsx` template with `openpyxl`, which round-trips the logo. The React page is an app shell whose only scroll region is the grid: fixed head, toolbar, ribbon and notice line above it, and a fixed dock of four panels below it.

**Design lock:** the UI is locked to direction **A3 · Locked Shell**, specified in `docs/superpowers/specs/2026-08-19-monthly-timesheet-ui-design.md` §16 and demonstrated in `docs/timesheet-mockup-a3-shell.html`. That spec is binding for tokens, the button and fill inventory, the cell pattern, copy, and RTL behaviour; read §§3–11, §14 (measured traps) and §§15–16 (the two revisions) before Task 7. The mockups run from disk with no build step — open the file, do not re-derive the design from this plan.

**Tech Stack:** FastAPI, SQLAlchemy 2.x, SQLite, Alembic, openpyxl 3.1.5, React 19 + Vite + TypeScript, React Query, Vitest 4 + Testing Library, pytest.

## Global Constraints

- Run Python through `venv\Scripts\` and frontend commands through pnpm.
- This checkout is the live production checkout. Do **not** switch branches here — create a worktree via the `superpowers:using-git-worktrees` skill before Task 1.
- Never commit a Word/Excel resave of anything under `backend/templates/` other than the one file Task 1 creates.
- **`backend/openapi.json` is a TRACKED file — commit it.** *(Corrected 2026-08-20, mid-execution. The original constraint claimed it was gitignored at `.gitignore:99-100` and that `git add` would error and abort. That was wrong on every count, verified: `git ls-files` reports it tracked, `git check-ignore` reports it unignored, and `.gitignore:99-100` is about `docs/how-we-work/`. Acting on the original text left the committed spec one revision behind the committed `api.types.ts`.)* `sync-api-types` step 4 is correct as written: regenerate it and commit it alongside `frontend/src/lib/api.types.ts`, so the spec and the generated types never disagree.
- The `sync-api-types` skill lives at `.agents/skills/sync-api-types/SKILL.md`. The `.claude/` copy some older plans reference is local-only and gitignored.
- Pre-existing failures on this host, **not caused by this work and not to be fixed here** (re-measured 2026-08-20):
  - pytest: `test_config_openwa.py::test_openwa_settings_default_dormant` (`assert True is False` on `openwa_enabled`) and `test_migration_record_included_papers.py::test_record_included_papers_migration_upgrades_and_downgrades` (`KeyError: 'docx_path'` inside `batch_alter_table` on the `0067 -> 0068` upgrade). **`test_dav.py::test_dav_diagnostic_event_is_structured_and_redacted` PASSES in isolation** — earlier plans listed it as failing; if it fails in a full-suite run it is order-dependent and still not yours.
  - `ruff check .`: 22 errors across 8 files — `backend/app/core/crypto.py` (1), `backend/app/services/admin_notify.py` (1), `backend/app/services/email_service.py` (2), `backend/app/services/scheduler_service.py` (7), `backend/app/services/sms_templates.py` (8), `backend/tests/test_admin_notify.py` (1), `backend/tests/test_passport_printed.py` (1), `backend/tests/test_permit_book_generation.py` (1). Mix: 16 RUF001 (ambiguous Arabic characters), 4 SIM105, 1 SIM103, 1 F841, 1 W292. Your files must add none.
  - `mypy`: 30 errors across 11 files, none in timesheet code.
- Arabic and English are peers. Use logical CSS properties (`margin-inline-start`, not `margin-left`). Run the `i18n-rtl-reviewer` after Task 9.
- Exactly one Alembic head. Migration `0070_timesheet` is already applied. Task 3 adds `0074_timesheet_stat_fillers` and `0075_timesheet_start_acks`, in that order, after main's `0071`-`0073`. **(Corrected 2026-08-21, post-merge review. Main took `0071`-`0073` while this branch was in flight, and production is stamped `0073`; renumbering avoids duplicate migration file numbers.)**
- `CODE_SICK` is `"SL "` **with a trailing space**. The workbook totals sick days with `COUNTIF(F:AJ,$AO$5)` where `AO5` holds `"SL "`. Dropping the space silently zeroes the client's sick column.
- Derived codes are only: `P`, `AL`, `SL `, `AB`, `TR`, `NG`, `-`. Never emit `OFF`, `R`, `S` or `T`. **`X` is an eighth code the rule engine never derives** — it exists only as a manual override (the red block: a roster day outside the billing window) and it survives the statistics transform beside `NG` and `-`.
- **The template gains one legend entry and one footer row for `X`** (Task 1). That is a client-visible change to paper already in circulation: the operator must confirm HQ HR accepts it before the first send. Nothing else about the template moves.
- Day 31 is blank in 30-day months; days 29–31 blank in February 2026. The grid always renders 31 day columns and blanks the days the month does not have.
- A leaver is absent from every later month's roster, on both deliverables. A joiner's days before his date of joining are `NG`. Both are roster edges and outrank leave, absence and the manual red block.
- Services raise `AppError` subclasses from `app.api.errors` (`NotFoundError` 404, `ConflictError` 409, `ValidationFailedError` 422), never bare `ValueError`. The envelope is `{"error": {"code", "message", "details"}}`. **All three subclasses take `(code: str, message: str, **details: Any)`** (`errors.py:59, :66, :73`) — `details` are keyword arguments, not a dict: `ConflictError("TIMESHEET_CLOSED", "Month is closed.", year=2026, month=7)`. Passing `details={...}` nests it as `details={"details": {...}}`. Only the base `AppError` takes a keyword-only `details=<dict>`.
- Reference workbooks live at `E:\Al Watbha Shares\المالية\احصائية 2026\`. Read them; never write to that share. **Never open `data/gssg.db` read-write from a test.**
- No component may carry a code colour: cells render `data-code="AL"` and CSS resolves the fill from the token pair. Adding a hex to a `.tsx` is a review rejection.
- Specs: `docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md` (data, engine, workbooks) and `docs/superpowers/specs/2026-08-19-monthly-timesheet-ui-design.md` (the locked UI).

---

## Already Landed (commits `c47d163`, `HEAD`) — do not redo

- `backend/app/core/timesheet_codes.py` — the pure rule engine.
- `backend/app/core/leave_lifecycle.py` — `_english_part` promoted to public `english_part`; it handles both `"X - عربي"` and the dash-less `"Duty Resumption مباشرة عمل"`, and `timesheet_codes.leave_code` uses it.
- `backend/app/db/models.py` — `TimesheetDesignation`, `Absence`, `TimesheetPeriod`, `TimesheetOverride`, `TimesheetSnapshotRow`, `Employee.designation_id`.
- `backend/app/db/migrations/versions/0070_timesheet.py` — applied; seeds 16 designations.
- `backend/scripts/import_timesheet_history_2026.py` — applied; the plan is re-derived from the workbooks on each run, so a second run against the same data plans no writes (no test proves this). Its `--verify` mode **prints** the cell diff and asserts nothing; the baseline lives in the design spec (`2026-08-19-monthly-timesheet-design.md:21, :446, :449`): July 0 differing cells of 8,525; June 49 of 8,460 (≥99.4%), the 49 spanning six employees, all departure-date errors in the hand file. Nothing in the repo regression-guards those numbers — Task 6 is what adds that guard.
- `backend/tests/test_timesheet_codes.py` — 28 passing tests.
- `openpyxl>=3.1,<4.0` in `requirements.txt`.

Public API you will consume:

```python
from app.core.timesheet_codes import (
    CODE_ABSENT, CODE_ANNUAL, CODE_NATIONAL, CODE_NEW, CODE_OFF_ROSTER,
    CODE_PRESENT, CODE_SICK, EMITTED_CODES,
    LeaveSpan,   # @dataclass(frozen=True, slots=True): leave_type, start, end, status="Approved"
    in_roster,   # (*, doj, end_date, month_start, month_end) -> bool   all four required, keyword-only
    is_void,     # (status: str) -> bool   prefix match on ("Cancelled", "Rejected"), so bilingual works
    leave_code,  # (leave_type: str) -> str | None   "Unknown" -> CODE_ANNUAL
    month_codes,
)
```

`month_codes` in full — the argument types are the ones that bite (`timesheet_codes.py:130-139`):

```python
def month_codes(
    year: int,
    month: int,
    *,
    doj: date | None = None,
    end_date: date | None = None,
    leaves: Iterable[LeaveSpan] = (),
    absences: Collection[date] = (),      # date objects, NOT day integers; filtered by year+month internally
    overrides: Mapping[int, str] | None = None,  # keyed by 1-based day of month, applied last, unconditionally
) -> list[str | None]: ...             # always length 31; None past the month end
```

The module has **no `__all__`** and also exposes `LEAVE_TYPE_CODES` and `VOID_LEAVE_STATUSES`. **`EMITTED_CODES` is a `tuple[str, ...]`**, not a set — `EMITTED_CODES | {"X"}` raises `TypeError`; write `{*EMITTED_CODES, "X"}`.

## Repo facts you will need (all verified — do not re-derive)

- **There is no shared `client` fixture.** `backend/tests/conftest.py` defines four fixtures — `_block_live_whatsapp_gateway` (autouse, `:18`), `db_session` (`:35`), `count_queries` (`:57`), `admin_user` (`:94`) — plus the plain helper function `make_user` (`:86`, importable, **not** a fixture). It is the only conftest in the repo. Every API test module builds its own client; `backend/tests/test_digests_api.py:25-74` is the cleanest template.
- **`db_session` builds schema with `Base.metadata.create_all`, never Alembic** (`conftest.py:40`). Migration seeds are invisible to tests. `perm_service.seed_role_defaults(db)` is called from the fixture for exactly this reason (`conftest.py:46`) — the designation catalog needs the same treatment (Task 3).
- `attach_sqlite_pragmas(eng, *, wal: bool = True)` (`session.py:29`) — `wal` is **keyword-only**. With `wal=False` it registers only `PRAGMA foreign_keys=ON`, which is safe against a read-only database (Task 6 relies on that).
- Capability guards are signature dependencies: `_user: Annotated[User, Depends(require_capability("leaves.view"))]` (`backend/app/api/v1/leaves.py:61`, inside the `list_leaves` signature at `:58-71`). Routers own their prefix: `APIRouter(prefix="/leaves", tags=["leaves"])` (`leaves.py:39`). Registration: `app.include_router(leaves_v1.router, prefix="/api/v1", dependencies=auth_gate)` (`backend/app/main.py:181`, with `auth_gate = [Depends(get_current_user)]` at `:167`).
- **Admin needs no role-preset edit** — `CAPABILITY_IDS` is derived from `CAPABILITIES` (`permissions.py:162`) and `ALL_CAPABILITIES = CAPABILITY_IDS` (`:165`); `ROLE_DEFAULTS` maps admin to it (`:206-210`). Only `_OPERATOR_CAPS` (`:173-188`) and `_MANAGER_CAPS` (`:191-203`) change, and both list capabilities as **bare `"domain.action"` strings** inside a `frozenset(...)`, not `Capability` references.
- `Capability` is a NamedTuple with field order `id, domain, label, description` (`permissions.py:19-25`). Both the one-line style (`:58`) and the argument-per-line style (`:34-39`) exist in the file; ruff formats by line length.
- Sick and annual `Leave` rows are **built** by `document_service._make_leave_row` (`backend/app/services/document_service.py:505`; it constructs the row at `:564` and returns it **unsaved**) and **persisted** by `generate_document` step 12 at `:1743-1768` — note the dedup branch at `:1754-1763` reuses an existing row and never calls `db.add`. The transaction commits at `:1875`. `leave_service.create_leave` (`leave_service.py:360`) **rejects everything except National Service** at `:363-368`.
- `frontend/src/components/shell/navItems.ts:29` is the single nav registry: `{ to: '/permits', key: 'nav.permits', Icon: ShieldCheck, cap: 'permits.view' }`.
- `frontend/src/lib/api.ts` is the single typed client every page calls through (2,022 lines, one exported `api` object).
- **There is no file download in this frontend.** `fetchPermitDocumentBlob` (`api.ts:1044-1045`) is an *inline-preview* helper: it delegates to the private `fetchPermitBlob` (`api.ts:908-918`), which appends `?encoding=base64` and returns a `Blob`; the caller then does `URL.createObjectURL` + `window.open(url, '_blank', 'noopener')` + a delayed revoke (`pages/permits/PermitDetailDialog.tsx:259-263`). Nothing in `frontend/src` reads `content-disposition`, and there is no `a.download` anywhere. The only real download precedent is a plain URL handed to an `href` (`api.documentDownloadUrl` `api.ts:1936-1937`, `api.vaultDownloadUrl` `:1138-1139`). A true "save as .xlsx" path is **new code** for this plan.
- **`frontend/src/test/utils.tsx` does not exist and `renderWithProviders` is not defined anywhere.** `frontend/src/test/` contains exactly one file, `setup.ts`. Every test file declares its own wrapper. Page tests: `<MemoryRouter><QueryClientProvider client={qc}>{ui}</QueryClientProvider></MemoryRouter>` (`pages/employees/EmployeeActivitySection.test.tsx:109-114`). Component/panel tests that do not navigate: `QueryClientProvider` only (`pages/employees/EmployeeActivityLookup.test.tsx:35-37`).
- Page tests stub the client module, they do not hit a server: `vi.mock('@/lib/api', () => ({ api: { ... } }))`, plus `vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))` when the component toasts (`pages/employees/EmployeeDetailPage.test.tsx:20-21`). 31 test files follow this shape.
- Locale files are `en.json`/`ar.json` with **nested** namespaces; `t('leaves.title')`. Neither file has a `timesheet` key yet — a clean insert. Only `en` is loaded for component tests (`frontend/src/test/setup.ts:116-121`); AR parity is enforced by a dedicated `*.i18n.test.ts` (see `frontend/src/locales/permits.i18n.test.ts`). `setup.ts` also polyfills `matchMedia` as **no-match** (`:94-112`), so any `useIsMobile` in the shell reports desktop under test.
- jest-dom matchers are global (`setup.ts:1`). One frontend test file: `pnpm -C frontend exec vitest run src/path/to/file.test.tsx` (`CLAUDE.md:32`).
- `frontend/src/index.css` is Tailwind v4 CSS-first (`@import "tailwindcss"` at `:1`) with **no `@layer` anywhere**. `:root` is `:83-174`, `[data-theme="dark"]` is `:176-248`. Bare attribute selectors already sit unlayered (`:290-297`), so the plan's `[data-code='…']` rules need no `@layer` wrapper and will outrank Tailwind utilities.
- `@tanstack/react-virtual` `^3.13.24` is **already a dependency** (`frontend/package.json:38`) — no install needed if the grid ever needs it.
- `backend/scripts/audit_capability_gates.py` is a **report that always exits 0** (`main()` at `:136`, its only `return 0` at `:209`) — read its stdout, it can never fail a gate.
- Templates resolve through `get_settings().templates_dir`, not `__file__` — `backend/app/config.py:27-38` (via `_bundle_root()` at `:16-24`, which returns `sys._MEIPASS` at `:23`) returns `_MEIPASS/templates/` under PyInstaller. The field is `config.py:57`; `get_settings()` is lru-cached at `:107` and the dir is env-overridable as `GSSG_TEMPLATES_DIR`.

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/core/constants.py` (modify) | `NATIONALITY_EN`, `nationality_en()`, `ARABIC_MONTHS`, `DESIGNATION_SEED` |
| `backend/scripts/build_timesheet_template.py` (create) | One-off: sanitize the June workbook into the template |
| `backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx` (create) | The template: header + hidden `_parts` sheet |
| `backend/app/core/timesheet_xlsx.py` (create) | Template → filled workbook bytes. No DB. |
| `backend/app/services/timesheet_service.py` (create) | Seed, roster, grid, statistics split, close/reopen, snapshots |
| `backend/app/db/migrations/versions/0074_timesheet_stat_fillers.py` (create) | Block-2 filler assignments |
| `backend/app/db/migrations/versions/0075_timesheet_start_acks.py` (create) | Starting-point acknowledgements for mid-month joiners |
| `backend/app/db/models.py` (modify) | `TimesheetStatFiller`, `TimesheetStartAck`, both in `__all__` |
| `backend/app/schemas/timesheet.py` (create) | Pydantic request/response models |
| `backend/app/api/v1/timesheet.py` (create) | Routes |
| `backend/app/core/permissions.py` (modify) | `timesheet.view`, `timesheet.edit` |
| `backend/app/main.py` (modify) | Register the router; call `seed_designations` at startup |
| `backend/app/services/document_service.py` (modify) | Absence-supersede hook |
| `frontend/src/index.css` (modify) | The eight `--code-*-fill` / `--code-*-ink` token pairs, light and dark |
| `frontend/src/pages/timesheet/codes.ts` (create) | The code table (`code`, `slug`, `key`, i18n keys) and slug helpers. No colours — CSS owns those |
| `frontend/src/pages/timesheet/useTimesheet.ts` (create) | React Query reads, optimistic cell mutation, close/reopen, blob downloads |
| `frontend/src/pages/timesheet/TimesheetPage.tsx` (create) | The shell: fixed head / toolbar / ribbon / notice, one scrolling grid, fixed dock. Owns page state (month, sheet, variant, brush, selection, open panel) |
| `frontend/src/pages/timesheet/TimesheetToolbar.tsx` (create) | Month stepper, roster and deliverable segments, sheet zoom, the always-visible employee search field |
| `frontend/src/pages/timesheet/TimesheetNotice.tsx` (create) | One line of counts — blocking, warnings, joined, leaving, removed — each opening the checks panel |
| `frontend/src/pages/timesheet/CodeRibbon.tsx` (create) | The legend that is also the brush (`aria-pressed`, keyboard letters) |
| `frontend/src/pages/timesheet/TimesheetGrid.tsx` (create) | 31 columns, frozen identity block, cell-as-button, drag-to-fill, row badges. No totals columns |
| `frontend/src/pages/timesheet/CodePicker.tsx` (create) | The per-cell `role="menu"` and the `AB` note field |
| `frontend/src/pages/timesheet/RowTally.tsx` (create) | Per-employee code counts on hover and focus — the on-screen replacement for `AK..AP` |
| `frontend/src/pages/timesheet/TimesheetDock.tsx` (create) | The fixed dock: four groups, `aria-expanded`, and the panel host that opens upward |
| `frontend/src/pages/timesheet/panels/PostsPanel.tsx` (create) | Post count, implied-post readout, the two-block rule |
| `frontend/src/pages/timesheet/panels/CodesPanel.tsx` (create) | Whole-workbook tally with share bars |
| `frontend/src/pages/timesheet/panels/ChecksPanel.tsx` (create) | Blocking, warnings, and roster movement with `Confirm starting point` / `Show row` |
| `frontend/src/pages/timesheet/panels/EmployeePanel.tsx` (create) | G-number picker (search, results, preview) + two-month extract + red-block helper |
| `frontend/src/pages/timesheet/panels/ReleasePanel.tsx` (create) | Filenames, freeze sentence, downloads, seal, two-step reopen |
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
- Produces: the template file. `Sheet1` holds rows 1–5 only (header, logo anchored at `A1`), column widths, row heights, print setup and sheet view — **no cells at all below row 5**, and no conditional formats or data validations. A hidden sheet `_parts` holds one styled specimen data row at row 1 and the **19-row** footer block at rows 3–21.

Two source facts that shape the build script, both measured on the June workbook:

- The source's only worksheet is **already named `Sheet1`** (dims `A1:AP305`), so the rename in step 3 is a no-op — assert it instead of assigning it.
- The source's `freeze_panes` is **`'A77'`**, a mid-roster artifact. Left alone it would freeze 71 phantom rows in every workbook the client receives. Step 3 sets `F6`, which is also what the rendered sheets want; keep that line. `print_area` is the empty string `''` — leave it.
- Columns `G`, `AO` and `AP` have **no explicit `column_dimensions` entry** (`.width` is `None`). Any code that walks A..AP reading `.width` must tolerate a missing key.

Why a hidden `_parts` sheet: `openpyxl` does not shift merges, conditional formats or validations when rows are inserted or deleted, so anything parked on `Sheet1` leaves stray formatting behind. Copying `cell._style` from a separate sheet is one attribute assignment per cell and reproduces the original exactly (verified).

June's footer is **18 rows**, `L+1` through `L+18` where `L` is the last data row: legend, signatures, `SUM` row, three blanks, `S.no` header, ten code rows, `Total Days`. In the June source with `L = 287` that is rows 288–305, confirmed by its **seven** footer merges: `A288:AP288`, `A289:M289`, `N289:AC289`, `AD289:AP289`, `A294:B294`, `A295:B304`, `A305:D305`. (`L+3`, the `SUM` row, is empty in `A`/`C`/`D`/`E` — it lives entirely in `AK..AP`.)

The ten code rows at 295–304 carry, verbatim, `(C, D)`: `('Sick Leave', 'SL ')`, `('Annual Leave', 'AL')`, `('Abcent  ', 'AB')`, `('National Service', 'TR')`, `('New Gard', 'NG')`, `('Termination', '-')`, `('Resignation', 'R')`, `('Suspention', 'S ')`, `('P', 'P')`, `('OFF', 'OFF')`. The typos and trailing spaces are the paper's, not a transcription error — reproduce them.

**The built template's footer is 19 rows**, because the design lock adds the manual red block `X` (UI spec **§15, backend consequence 1**, which states in so many words that the footer row count moves from 18 to 19; carried forward by §16.6 item 4): one more code row, inserted after `OFF` and before `Total Days`, plus `, X- Not billed` appended to the legend line. In `_parts` terms the code rows are 10–20 and `Total Days` moves from row 20 to row 21. This is the one client-visible change to the paper; everything else is reproduced byte for byte.

> **The design spec is stale here.** `docs/superpowers/specs/2026-08-19-monthly-timesheet-design.md:78-82` still documents the 18-row footer (`L+18` = `Total Days`, `E` = `SUM(E{L+8}:E{L+17})`) and `:104-106` still says the renderer emits only seven codes. Both predate UI spec §15. As part of Task 1, update `design.md:82` to `L+19` with `E` = `SUM(E{L+8}:E{L+18})`, insert the `X` / `Not billed` row at `L+18`, and amend `:104-106` to name `X` as the eighth, override-only code. Leaving two specs disagreeing about the paper is how the next person ships an 18-row footer.

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
    assert workbook.sheetnames == ["Sheet1", "_parts"]
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


def test_parts_sheet_is_hidden_and_carries_the_19_row_footer(workbook):
    parts = workbook["_parts"]
    assert parts.sheet_state == "hidden"
    assert parts["A1"].font.name == "Arial"  # specimen data row
    assert "Legend:" in str(parts["A3"].value)
    assert str(parts["A4"].value).startswith("Prepard By")
    assert parts["A9"].value == "S.no"
    assert parts["A21"].value == "Total Days"


def test_the_red_block_has_a_legend_entry_and_a_footer_row(workbook):
    """A code the client cannot look up is worse than no code at all."""
    parts = workbook["_parts"]
    assert "X- Not billed" in str(parts["A3"].value)
    assert parts["C20"].value == "Not billed"
    assert parts["D20"].value == "X"
    # the new row borrows the OFF row's styling, so the block still reads as one table
    assert parts["C20"].border.top.style == parts["C19"].border.top.style
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
    assert sheet.title == "Sheet1", sheet.title  # already named this in the source

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

    # Rebuilt from scratch by the renderer over the real extent. June carries FOUR
    # conditionalFormatting blocks of nine `cellIs equal` rules each (36 rules, 36
    # dxfs) over a heavily fragmented sqref -- "D299 F6:AI28 F29:AJ29 ... F225:AI287"
    # plus the strays AJ88, AJ248, AJ257 -- and THREE list validations whose
    # formula1 is "$D$295:$D$304", a reference to the footer code rows this strip
    # deletes. Copying any of it forward ships dangling references.
    sheet.conditional_formatting = ConditionalFormattingList()
    sheet.data_validations = DataValidationList()

    # The 19th footer row: the manual red block X, inserted after OFF (parts row
    # 19) and before Total Days, which moves from row 20 to 21. Copy downward
    # first or the Total Days values are overwritten.
    for column in range(1, 43):
        parts.cell(21, column)._style = parts.cell(20, column)._style
        parts.cell(21, column).value = parts.cell(20, column).value
        parts.cell(20, column)._style = parts.cell(19, column)._style
        parts.cell(20, column).value = None
    parts.row_dimensions[21].height = parts.row_dimensions[20].height
    parts["C20"].value = "Not billed"
    parts["D20"].value = "X"
    parts["A3"].value = f"{parts['A3'].value}, X- Not billed"

    sheet["D4"].value = "For the Month of :"
    sheet.freeze_panes = "F6"  # June's source is "A77", a mid-roster artifact

    DEST.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(DEST)
    print(f"[template] wrote {DEST} ({DEST.stat().st_size} bytes)")

    check = load_workbook(DEST)
    assert len(check["Sheet1"]._images) == 1, "logo lost"
    assert check["Sheet1"].max_row == 5, f"stray rows: max_row={check['Sheet1'].max_row}"
    assert check["_parts"]["A21"].value == "Total Days", "footer is not 19 rows"
    assert check["_parts"]["D20"].value == "X", "red block row missing"
    print("[template] logo, strip and 19-row footer verified")
```

- [ ] **Step 4: Build the template and run the test**

Run: `venv\Scripts\python.exe -X utf8 backend/scripts/build_timesheet_template.py`
Then: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_template.py -v`
Expected: PASS, 8 tests.

If a footer assertion fails, print `[(r, parts.cell(r, 1).value, parts.cell(r, 4).value) for r in range(3, 22)]`. `A3` must be the legend, `A9` must be `S.no`, `D20` must be `X`, and `A21` must be `Total Days`. If `A3` is not the legend, `LAST_DATA_ROW` is wrong — find June's last row with an ID in column B. If `A3` is right but the code rows are not at 10–19 before the insert, June's footer is not 18 rows and `design.md:78-82` needs updating first.

All of `FIRST_DATA_ROW = 6`, `LAST_DATA_ROW = 287`, `FOOTER_ROWS = 18`, the six header strings and both column widths were re-measured against the June workbook on 2026-08-20 and are correct. `B288..B305` are all empty, so the "last row with an ID in column B" scan lands on 287 cleanly, and `A287 == 282` corroborates (rows 6..287 = 282 data rows).

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
- Create: `backend/app/db/migrations/versions/0074_timesheet_stat_fillers.py`
- Create: `backend/app/db/migrations/versions/0075_timesheet_start_acks.py`
- Modify: `backend/app/db/models.py` (add `TimesheetStatFiller` and `TimesheetStartAck`, both in `__all__`)
- Modify: `backend/app/main.py` (call `seed_designations` in the startup reconcile block, `main.py:124-135` — the new call goes inside the `with SessionLocal() as _db:` body at `:134`, immediately after `correspondence_service.seed_defaults(_db)`)
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
    stat_filler: str | None        # block 2's assigned code, None in block 1
    joined_day: int | None         # doj falls inside this month -> NG head
    left_day: int | None           # end_date falls inside this month -> `-` tail
    start_confirmed: bool          # operator acknowledged the NG head
    notes: dict[int, str]          # day -> absence note, for the cell tooltip

@dataclass(frozen=True, slots=True)
class Issue:
    employee_id: str
    kind: str
    #  blocking: "no_designation" | "no_nationality"
    #  warning:  "unknown_leave" | "overlapping_leave" | "departed_but_active"
    #            | "no_doj" | "duplicate_name"
    detail: str

@dataclass(frozen=True, slots=True)
class Removed:
    """Someone who finished LAST month and is therefore not on this roster.

    Reported so the page can say who dropped off and why: this is the rule the
    client's invoice depends on, and it is invisible by construction.
    """

    employee_id: str
    name_en: str
    end_date: date
    last_day: int              # day of the month he finished
    month: int                 # the month he finished in
    year: int                  # ...and its year, so a Dec -> Jan step still reads right

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
    removed: list[Removed]     # departures that took effect before this month
    closed_at: datetime | None
    closed_by: str | None      # the display name behind TimesheetPeriod.closed_by, for the seal

def seed_designations(db: Session) -> None: ...
def build_month(db: Session, year: int, month: int, *, sheet: str = "main") -> MonthGrid: ...
def set_cell(db: Session, year: int, month: int, employee_id: str, day: int,
             code: str | None, *, note: str | None = None, user_id: int | None = None) -> None: ...
def set_post_count(db: Session, year: int, month: int, post_count: int) -> None: ...
def set_filler(db: Session, year: int, month: int, employee_id: str, code: str) -> None: ...
def close_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def reopen_month(db: Session, year: int, month: int, *, user_id: int | None = None) -> None: ...
def delete_absences_covered_by(db: Session, employee_id: str, start: date, end: date) -> int: ...
def acknowledge_start(db: Session, year: int, month: int, employee_id: str) -> None: ...
def list_designations(db: Session) -> list[TimesheetDesignation]: ...
def reorder_designations(db: Session, ids: list[int]) -> None: ...
```

Rules, all measured from the workbooks:

1. `seed_designations` upserts `DESIGNATION_SEED` by `name_en`, idempotently — adds missing rows, never deletes. Called at startup and from every test fixture.
2. Roster: `in_roster(...)` plus `designation.sheet == sheet`. Employees with no designation are still listed (last, `rank_order=None`) **and** raise a `no_designation` blocking issue.
3. `post_count` defaults to **249** when the month has no `TimesheetPeriod` row. `build_month` must **not** create one — the golden test runs against the live database.
4. Sort: `rank_order` ascending, then the integer part of the employee ID (`G4053` → 4053; a non-numeric ID sorts last).
5. `stat_codes` for block 1 (`row_no <= post_count`): every cell becomes `P` except `NG` and `-`.
6. `stat_codes` for block 2: every cell becomes the row's filler code except `NG`, `-` and real `AB`. The filler is `timesheet_stat_fillers` for this month if set; else **the most recent earlier month that has one for that employee** (`WHERE (year, month) < (y, m) ORDER BY year DESC, month DESC LIMIT 1`); else `AL`. Looking back exactly one month would drop the choice the first time the operator skips a month, which contradicts "the operator sets the shape once and it carries forward" (Deferred, last bullet).
7. `set_cell` with `AB` writes an `Absence` row; any other code writes a `TimesheetOverride`; `None` deletes whichever exists. Rejects a `day` the month does not have (February has no 29th in 2026) with `ValidationFailedError`, and a closed month with `ConflictError("TIMESHEET_CLOSED", ...)` — a 409 in the standard envelope, which is how every other service here refuses.
8. `close_month` snapshots **both** sheets: it iterates `sheet in ("main", "drivers")`, writes one `TimesheetSnapshotRow` per row of each, and stamps `closed_at`/`closed_by` on the single `TimesheetPeriod`. Without this the drivers download after a close renders an empty workbook.

   **`TimesheetSnapshotRow` stores only twelve of the seventeen `GridRow` fields** (`models.py:1646-1669`): `employee_id`, `row_no`, `name_en`, `nationality_en`, `designation_en`, `designation_ar`, `rank_order`, `sheet`, `codes`, `stat_codes`, `stat_block`. There is **no column** for `stat_filler`, `joined_day`, `left_day`, `start_confirmed` or `notes`. So "returns the snapshot verbatim" is impossible as stated. When `closed_at` is set, `build_month` takes the **frozen** part from the snapshot — identity, `codes`, `stat_codes`, `stat_block` — and recomputes the other five live, from sources that are either immutable history or deliberately still mutable:

   | Field | After close | Why |
   | --- | --- | --- |
   | `joined_day` / `left_day` | recomputed from `Employee.doj` / `end_date` | historical fact; cannot drift for a past month |
   | `notes` | recomputed from `Absence.note` | display-only, never affects a code |
   | `stat_filler` | read from `timesheet_stat_fillers` | display-only; `stat_codes` are already frozen |
   | `start_confirmed` | read from `timesheet_start_acks` | **must** be live — Task 5 allows `start-ack` on a closed month, so freezing it would strand the flag forever |

   Do **not** add columns for these. Duplicating `start_confirmed` into the snapshot is what would break the closed-month acknowledgement.
9. Warnings, one `Issue` each, non-blocking: `unknown_leave` for a live leave whose `leave_type` English half is `Unknown` overlapping the month; `overlapping_leave` for two live same-type leave rows whose ranges intersect; `departed_but_active` for `end_date` in the past while `status == 'Active'`; `no_doj` for a roster member with `doj IS NULL`; `duplicate_name` for two roster members sharing `name_en`.
10. `reorder_designations` writes negative temporary ranks, flushes, then writes `1..N` — `rank_order` is uniquely constrained, so a direct rewrite collides. It rejects a list that is not a permutation of every designation id with `ValidationFailedError("DESIGNATION_ORDER_INCOMPLETE", ...)`.
11. **`X` is accepted by `set_cell` and derived by nothing.** It writes a `TimesheetOverride` like any non-`AB` code. `EMITTED_CODES` in `timesheet_codes` is unchanged — the engine still never produces it — so `set_cell` validates against `{*EMITTED_CODES, "X"}` and rejects anything else with `ValidationFailedError("TIMESHEET_BAD_CODE", ...)`. **`EMITTED_CODES` is a `tuple`**, so `EMITTED_CODES | {"X"}` raises `TypeError: unsupported operand type(s) for |: 'tuple' and 'set'` — unpack it.
12. **`X` survives the statistics transform**, beside `NG` and `-`, in both blocks. Rule 5 becomes: block 1 becomes `P` except `NG`, `-` and `X`; rule 6: block 2 becomes the filler except `NG`, `-`, real `AB` and `X`. A red-blocked day is a day outside the billing window; forcing it to `P` would put it back on the client's invoice, which is the entire reason the code exists. The `_statistics_codes` sketch in Step 4 must carry `"X"` in **both** `keep` sets.
13. **`joined_day` / `left_day`** are the roster edges, reported rather than inferred by the caller: `joined_day = doj.day` when `doj` falls inside the month, else `None`; `left_day = end_date.day` when `end_date` falls inside the month, else `None`. They are read off the same dates `in_roster` already uses, so they cannot disagree with the `NG` / `-` cells.
14. **`removed`** lists employees whose `end_date` fell in the *previous* month and whose designation routes to the requested `sheet` — i.e. everyone who was on last month's workbook and is deliberately absent from this one. One query over `Employee` on the previous month's range; empty for a month with no departures before it. An employee with **no** designation routes to no sheet and so is never reported as removed; that is the same rule as rule 2 and is accepted.
15. **`acknowledge_start`** inserts into `timesheet_start_acks` (`year`, `month`, `employee_id`, `acked_at`, `acked_by`), idempotently. It is an operator acknowledgement of a starting point, **not** a correction: it must never create an override row, never change a code, and never be required before a download. `GridRow.start_confirmed` reflects it.
16. **`notes`** carries the `Absence.note` for each absent day so the grid can show it on the cell without a second request.

- [ ] **Step 1: Write the migration**

Conventions, measured across the 67 files in `versions/`: revision ids are **not** uniformly `NNNN_slug` — bare numeric runs `0001`–`0040` and `0052`–`0068`, slugged runs `0041`–`0051` plus `0068_record_included_papers` and `0070_timesheet`, and three files have a revision id that differs from their filename stem (notably `0069_merge`). Follow the newest form: **filename stem == revision id**, as in `0070_timesheet.py`. Import order is isort's, not `script.py.mako`'s: `from __future__ import annotations` / blank / `from collections.abc import Sequence` / blank / `import sqlalchemy as sa` / `from alembic import op` — which is what the blocks below use. New tables use plain `op.create_table` with `sa.UniqueConstraint` / `sa.CheckConstraint` inline plus a separate `op.create_index`; only changes to an **existing** table need `op.batch_alter_table` (`env.py:57` and `:80` already set `render_as_batch=True`). There is no shared migration helper module — do not import one.

The revisions shipped as `0074`/`0075` because `main` took `0071`-`0073` while this branch was in flight.

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

- [ ] **Step 1b: Write the second migration**

```python
# backend/app/db/migrations/versions/0072_timesheet_start_acks.py
"""timesheet starting-point acknowledgements

Revision ID: 0072_timesheet_start_acks
Revises: 0071_timesheet_stat_fillers
Create Date: 2026-08-20 00:00:00.000000

A mid-month joiner's days before his date of joining are NG. The operator is
shown that as a flag and acknowledges it once; this table is that
acknowledgement. It is deliberately NOT an override — the codes are derived and
stay derived, so a wrong date of joining is fixed on the employee record, not
papered over here.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072_timesheet_start_acks"
down_revision: str | Sequence[str] | None = "0071_timesheet_stat_fillers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "timesheet_start_acks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.String(16), nullable=False),
        sa.Column("acked_at", sa.DateTime(), nullable=False),
        sa.Column("acked_by", sa.Integer(), nullable=True),
        sa.UniqueConstraint("year", "month", "employee_id", name="uq_timesheet_start_ack"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_timesheet_start_ack_month"),
    )


def downgrade() -> None:
    op.drop_table("timesheet_start_acks")
```

Add the matching `TimesheetStartAck` model beside `TimesheetStatFiller`, same columns and constraints, and `"TimesheetStartAck"` in `__all__`.

Then confirm the head is single:

Run: `venv\Scripts\alembic.exe heads`
Expected: exactly one head, `0075_timesheet_start_acks`. **(Corrected 2026-08-21, post-merge review: main took `0071`-`0073` while this branch was in flight, so renumbering avoids duplicate file numbers.)**

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


def _guard(db, employee_id, *, doj=date(2024, 1, 1), end_date=None, rank=15):
    """One roster member on the main sheet, with the dates that make the edges.

    ``id`` is the Employee primary key (``models.py:60``) — there is no
    ``employee_id`` attribute on Employee. ``nationality`` must be one of the
    fifteen Arabic values ``NATIONALITY_EN`` maps, or every test using this
    helper picks up a spurious ``no_nationality`` blocking issue.
    """
    designation = db.query(TimesheetDesignation).filter_by(rank_order=rank).one()
    db.add(
        Employee(
            id=employee_id,
            name_en=f"GUARD {employee_id}",
            name_ar="حارس",
            nationality="الإمارات",
            doj=doj,
            end_date=end_date,
            status="Resigned" if end_date else "Active",
            designation_id=designation.id,
        )
    )
    db.flush()


def test_a_joiner_is_ng_until_his_starting_point(db_session):
    _guard(db_session, "G8001", doj=date(2026, 7, 12))
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G8001")
    assert row.codes[:11] == [CODE_NEW] * 11
    assert row.codes[11] == CODE_PRESENT
    assert row.joined_day == 12
    assert row.start_confirmed is False


def test_acknowledging_a_starting_point_changes_no_code(db_session):
    _guard(db_session, "G8002", doj=date(2026, 7, 12))
    before = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G8002")
    svc.acknowledge_start(db_session, 2026, 7, "G8002")
    svc.acknowledge_start(db_session, 2026, 7, "G8002")  # idempotent
    after = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G8002")
    assert after.start_confirmed is True
    assert after.codes == before.codes


def test_a_leaver_is_off_the_next_month_and_reported_as_removed(db_session):
    """The rule the client's invoice depends on, in both directions."""
    _guard(db_session, "G8003", end_date=date(2026, 7, 17))
    july = svc.build_month(db_session, 2026, 7)
    row = next(r for r in july.rows if r.employee_id == "G8003")
    assert row.left_day == 17
    assert row.codes[17:] == [CODE_OFF_ROSTER] * 14
    assert [r.employee_id for r in july.removed] == []

    august = svc.build_month(db_session, 2026, 8)
    assert "G8003" not in [r.employee_id for r in august.rows]
    removed = next(r for r in august.removed if r.employee_id == "G8003")
    assert (removed.last_day, removed.month) == (17, 7)


def test_the_red_block_is_accepted_manually_and_survives_the_statistics(db_session):
    _guard(db_session, "G8004")
    svc.set_post_count(db_session, 2026, 7, 249)  # G8004 lands in block 1
    for day in range(1, 23):
        svc.set_cell(db_session, 2026, 7, "G8004", day, "X")
    row = next(r for r in svc.build_month(db_session, 2026, 7).rows if r.employee_id == "G8004")
    assert row.codes[:22] == ["X"] * 22
    # block 1 forces P — but never over a day that is outside the billing window
    assert row.stat_codes[:22] == ["X"] * 22
    assert row.stat_codes[22] == CODE_PRESENT


def test_an_unknown_code_is_rejected(db_session):
    _guard(db_session, "G8005")
    with pytest.raises(ValidationFailedError):
        svc.set_cell(db_session, 2026, 7, "G8005", 3, "R")
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
    """Block 1 shows a manned post; block 2 is parked off the presence total.

    ``X`` is kept in BOTH blocks (rule 12): a red-blocked day is outside the
    billing window, and forcing it to ``P`` puts it back on the client's invoice.
    """
    keep = {CODE_NEW, CODE_OFF_ROSTER, "X"}
    if block == 2:
        keep = keep | {CODE_ABSENT}
    replacement = CODE_PRESENT if block == 1 else filler
    return [None if c is None else (c if c in keep else replacement) for c in codes]
```

Load leaves, absences, overrides and fillers for the month in four queries, not per employee — the main sheet is 275 rows and a per-row query would be 1,100 round trips.

Add `timesheet_service.seed_designations(_db)` to the startup reconcile block in `backend/app/main.py`, inside the `with SessionLocal() as _db:` body at `:134`, immediately after `correspondence_service.seed_defaults(_db)`. Note that block is wrapped in a bare `except Exception: log.warning(...)` (`main.py:134-135`), so a failing seed is swallowed at startup rather than raised — do not rely on it to surface a broken catalog.

- [ ] **Step 5: Run the tests and the migration round-trip**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_service.py -v`
Then: `venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe heads`
Expected: 25 tests PASS; exactly one head, `0075_timesheet_start_acks`. **(Corrected 2026-08-21, post-merge review: main took `0071`-`0073` while this branch was in flight, so renumbering avoids duplicate file numbers.)**

One live-data note for whoever runs `build_month` against `data/gssg.db`: exactly one of the 304 employees has `designation_id IS NULL`, and he joined 2026-08-03. July is therefore clean, but **August will report one `no_designation` blocking issue** until that record is given a designation. That is the rule working, not a bug.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/timesheet_service.py backend/app/db/models.py backend/app/db/migrations/versions/0074_timesheet_stat_fillers.py backend/app/db/migrations/versions/0075_timesheet_start_acks.py backend/app/main.py backend/tests/test_timesheet_service.py
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

def render_single_span(grids: Sequence[MonthGrid], employee_id: str) -> bytes: ...
    # one workbook, one sheet per grid in the order given, named by the uppercase
    # English month abbreviation ("JUN", "JUL"). Task 5's `months=2` export needs
    # this; `render_single` cannot produce a second sheet.

def filename_for(grid: MonthGrid, *, variant: str = "attendance") -> str: ...
def filename_for_single(grid: MonthGrid, employee_id: str) -> str: ...
```

Render steps, in order:

0. `TEMPLATE = get_settings().templates_dir / "GSSG-HR_Monthly_Time_Sheet.xlsx"`, resolved **at call time** — a module-level `__file__` path breaks the PyInstaller layout (`backend/app/config.py:27`).
1. `load_workbook(TEMPLATE)`; take `Sheet1` and `_parts`; `del workbook["_parts"]` last.
2. `Sheet1["D4"] = f"For the Month of :{MON}-{year}"` with the uppercase three-letter English abbreviation (`JUL`).
3. For each output row `r` from 6: copy `_parts` row 1 styles into row `r`, set `row_dimensions[r].height` from `_parts.row_dimensions[1].height` (Task 1 captured it from the source; it is `27.95`, but read it rather than hardcoding so the two cannot drift), write `A`=row_no, `B`=employee_id, `C`=name_en, `D`=nationality_en, `E`=designation, the day cells, then the six per-row formulas verbatim:
   `AK` `=COUNTIF(F{r}:AJ{r},"P")`, `AL` `=COUNTIF(F{r}:AJ{r},"OFF")`, `AM` `=COUNTIF(F{r}:AJ{r},"AB")`, `AN` `=COUNTIF(F{r}:AK{r},"AL")` (spans `AK` in the original), `AO` `=COUNTIF(F{r}:AJ{r},$AO$5)`, `AP` `=COUNTIF(F{r}:AJ{r},"TR")`.
4. Statistics variant: emit block 1, then **two empty rows**, then block 2, while column `A` keeps counting continuously. The two-row gap is emitted whenever block 2 is non-empty, **including when block 1 is empty** (`post_count = 0`), which is what `test_statistics_splits_blocks_with_two_blank_rows` pins.
5. Footer at `L+1` where `L` is the last data row: copy the 19 `_parts` rows, re-merge (`A:AP` legend; `A:M`, `N:AC`, `AD:AP` signatures; `A:B` on the `S.no` row; `A:B` spanning the **eleven** code rows; `A:D` on `Total Days`), then write the formulas:
   - `L+3`, columns `AK`..`AP`: `=SUM({col}6:{col}{L})`
   - `L+8`..`L+18`, column `E`: Sick `=AO{L+3}`, Annual `=AN{L+3}`, Abcent `=AM{L+3}`, National Service `=AP{L+3}`, P `=AK{L+3}`, OFF `=AL{L+3}`; New Gard, `-`, R, S and **`X`** are `=COUNTIF(F6:AJ{L},"<code>")`
   - `L+19`, column `E`: `=SUM(E{L+8}:E{L+18})`

   **Four of these deliberately diverge from the June source, which is buggy.** June has OFF as `=COUNTIF(F7:AJ288,"OFF")` (off by one row at both ends), and `-`, `R`, `S` as `=COUNTIF(F6:AJ287,D300)` / `=COUNTIF(F6:AJ263,D301)` / `=COUNTIF(F6:AJ263,D302)` — a cell reference instead of a literal, and R/S stop 24 rows short of the roster. The renderer normalises all four. Say so in the module docstring: the OFF, R and S totals in a generated workbook will not match a hand file's for the same month, and that is the generated one being right.
6. Build the conditional-format rules and the code data-validation from scratch over `F6:AJ{L}` — the template carries none. Fills from UI spec §3.2 plus §15: `AL` `#BDD7EE`, `SL ` `#C6E0B4`, `AB` `#FFC7CE` with font `#9C0006`, `TR` `#CC99FF`, `NG` `#FF9900`, and **`X` `#990033` with a white font** (the design lock's red block; `#990033` is verified to be the fill `D300` already uses for `Termination`, so nothing new enters the paper's palette). Two openpyxl traps here, both measured on the source:
   - The source stores CF fills on **`bgColor` with `patternType=None`**. A `PatternFill(start_color=..., fill_type="solid")` sets `fgColor` and produces different XML. Use `DifferentialStyle(fill=PatternFill(bgColor=...))`.
   - The source's sick-leave rule tests the literal `"SL"` **without** the trailing space, even though `AO5` and `CODE_SICK` are `"SL "` **with** it — a latent bug in the paper. The rebuilt rule must use `"SL "`, or it never fires on a generated sheet.

   Validation: the source's three list validations use `formula1='$D$295:$D$304'`, a reference into the footer code rows. The renderer replaces that with a literal list, which openpyxl needs quoted: `DataValidation(type="list", formula1='"P,AL,SL ,AB,TR,NG,-,X"', allow_blank=True)`. State the change; it is intentional.
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
    """One data row: L=6. Legend 7, signatures 8, sums 9, three blanks 10-12,
    S.no 13, the ELEVEN code rows 14-24, Total Days 25. The eleventh code row is
    the red block X, which is why Total Days is 25 and not June's 24."""
    sheet = _sheet(timesheet_xlsx.render(svc.build_month(db_session, 2026, 7)))
    assert "Legend:" in str(sheet["A7"].value)
    assert "X- Not billed" in str(sheet["A7"].value)
    assert str(sheet["A8"].value).startswith("Prepard By")
    assert sheet["AK9"].value == "=SUM(AK6:AK6)"
    assert sheet["A13"].value == "S.no"
    assert sheet["E14"].value == "=AO9"          # Sick Leave row
    assert sheet["D24"].value == "X"             # the red block, above Total Days
    assert sheet["A25"].value == "Total Days"
    assert sheet["E25"].value == "=SUM(E14:E24)"


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


def test_a_two_month_extract_carries_a_sheet_per_month(db_session, guard):
    """The resignation and termination handover: month of departure + the one before."""
    grids = [svc.build_month(db_session, 2026, 6), svc.build_month(db_session, 2026, 7)]
    workbook = load_workbook(io.BytesIO(timesheet_xlsx.render_single_span(grids, "G1001")))
    assert workbook.sheetnames == ["JUN", "JUL"]
    assert workbook["JUN"]["B6"].value == "G1001"
    assert workbook["JUL"]["D4"].value == "For the Month of :JUL-2026"
```

`sheet["B7"].value is None` in the block-split test because `B7` sits inside the `A7:AP7` legend merge on the attendance variant and is a genuinely empty cell on the statistics variant — both give `None`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: FAIL — `ModuleNotFoundError: app.core.timesheet_xlsx`.

- [ ] **Step 3: Implement the renderer**

Copy styles with `target._style = source._style` — never build `Font`/`Fill` objects by hand, or the output drifts from the paper. The one place you *must* build style objects is the conditional formatting, which the template deliberately does not carry; see the `bgColor` trap in render step 6. `render_single_span` loads the template once per grid and renames each `Sheet1` to the month abbreviation before merging the sheets into one workbook — copying a worksheet between two `Workbook` objects does not carry images or styles in openpyxl, so build each sheet in its own load and assemble by writing, not by `copy_worksheet`.

- [ ] **Step 4: Run the tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_xlsx.py -v`
Expected: PASS, 11 tests.

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
| `POST` | `/timesheet/{year}/{month}/start-ack` | `timesheet.edit` |
| `GET` | `/timesheet/{year}/{month}/export` | `timesheet.edit` |
| `GET` | `/timesheet/employee/{employee_id}/{year}/{month}/export` | `timesheet.view` |

**Why the month export is `timesheet.edit` and not `timesheet.view`.** Downloading it freezes the month (Architecture, and `test_export_returns_an_xlsx_...` asserts it). A `GET` that mutates state must not be reachable with a read-only capability: a `timesheet.view` holder could otherwise seal a month that only a `timesheet.edit` holder can reopen. The per-employee export stays `timesheet.view` because it freezes nothing.

> **Decision the operator must confirm.** With `timesheet.view` in `_OPERATOR_CAPS` and `timesheet.edit` in `_MANAGER_CAPS` only, an operator can read the grid but cannot correct a cell, set the post count, or download. Every "the operator does X" sentence in this plan and in the UI spec describes a `timesheet.edit` action. If the operator is meant to run this page, put **both** capabilities in `_OPERATOR_CAPS`. The alternative — keeping the split and moving the freeze out of the `GET` into the existing `POST .../close`, called by the release panel just before the download — is a larger change and drops the freeze-on-first-download guarantee. Pick one before Task 5 step 3; do not leave it implicit.

Declare the two static `designations` routes **before** the `{year}/{month}` routes, or the catch-all shadows them.

Two shapes the design lock adds:

1. **`POST /timesheet/{year}/{month}/start-ack`**, body `{"employee_id": "G7176"}`, `204` on success. Calls `timesheet_service.acknowledge_start`. Idempotent, and **allowed on a closed month** — acknowledging a starting point changes no cell, so refusing it after close would strand the flag forever. `404` if the employee is not on that month's roster.
2. **`GET /timesheet/employee/{employee_id}/{year}/{month}/export?months=1|2`**, default `1`. With `months=2` the response is a single `.xlsx` carrying **two sheets**, the named month and the one before it, in that order — HR asked for the month of departure and the month before it, so the two-month form is what the resignation and termination handover uses. Build it by calling `build_month` twice and handing both grids to `timesheet_xlsx.render_single_span([earlier, later], employee_id)`; `render_single` cannot produce a second sheet. Sheet names are the English month abbreviations (`JUN`, `JUL`); the download filename stays on the agreed pattern with the later month: `filename_for_single(later_grid, employee_id)` → `كشف حضور <name> <شهر>.xlsx`. Reject `months` outside `{1, 2}` with `ValidationFailedError("TIMESHEET_BAD_SPAN", ...)`. Neither variant freezes the month.

The grid response (`GET /timesheet/{year}/{month}`) carries every field of `MonthGrid` from Task 3 — including `removed` and `closed_by`, and per row `stat_filler`, `joined_day`, `left_day`, `start_confirmed` and `notes`. The frontend reads all of them; a Pydantic model that drops one silently disables a feature the page is built around. Note `GridRow.notes` is `dict[int, str]` in Python and serialises with **string** keys in JSON, so the frontend indexes it as `row.notes[String(day)]`.

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

Add `timesheet.view` to `_OPERATOR_CAPS` (`permissions.py:173-188`) and `timesheet.edit` to `_MANAGER_CAPS` (`:191-203`) — or both to `_OPERATOR_CAPS`, per the decision note above. Both presets are `frozenset`s of **bare `"domain.action"` strings**, not `Capability` references. **Do not touch admin** — `CAPABILITY_IDS` is derived from `CAPABILITIES` (`:162`) and `ALL_CAPABILITIES = CAPABILITY_IDS` (`:165`).

- [ ] **Step 1: Write the failing tests**

Copy the fixture block from `backend/tests/test_digests_api.py:25-74`. `db_session` **must** be a local fixture returning `api_db`, or the client and the seeded rows land in different databases.

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


def test_generating_a_sick_leave_clears_the_absence(client, db_session, tmp_path, monkeypatch):
    """Drives the real creation path — a hand-inserted Leave would not exercise the hook.

    `generate_document` renders a real DOCX and, unstubbed, drives Word COM through
    `_pdf_executor.convert_docx_to_pdf` (a 120 s process-pool wait). The two-line
    isolation below is what every existing generation test uses; see
    `backend/tests/test_document_generation_included_papers.py:33-63`.
    """
    from app.config import Settings
    from app.db.models import Absence, BookCategory
    from app.services import document_service

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    db_session.add(BookCategory(id="HR", prefix="HR"))  # FK on Book.category_id
    db_session.commit()

    _guard(db_session)
    client.put(
        "/api/v1/timesheet/2026/7/cell", json={"employee_id": "G1001", "day": 9, "code": "AB"}
    )
    assert db_session.query(Absence).count() == 1
    result = document_service.generate_document(
        db_session,                      # the only positional parameter
        employee_id="G1001",
        template_id="Leave Application Form",
        fields={
            "leave_type": "Sick Leave",
            "start_date": "2026-07-09",
            "end_date": "2026-07-09",
            "total_days": 1,
        },
        commit=True,
    )
    assert result.leave_id is not None
    assert db_session.query(Absence).count() == 0
    assert client.get("/api/v1/timesheet/2026/7").json()["rows"][0]["codes"][8] == "SL "
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_timesheet_api.py -v`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement schemas, routes, capabilities and the hook**

Export uses `fastapi.responses.Response` with the xlsx media type and `content-disposition: attachment; filename*=UTF-8''<percent-encoded>`. Starlette encodes headers as latin-1, so a bare `filename="كشف حضور…"` raises `UnicodeEncodeError` mid-response.

Wire `delete_absences_covered_by` into the path that actually creates sick and annual rows. `document_service._make_leave_row` (`backend/app/services/document_service.py:505`) only **builds** the row — it returns an unsaved object. The persistence happens in `generate_document` step 12 at `:1743-1768`, and the transaction commits at `:1875`. `leave_service.create_leave` is a dead end here: it rejects anything that is not National Service (`leave_service.py:363-368`).

Call the hook **after `leave_id` is resolved at `:1768` and before `db.commit()` at `:1875`**, passing `leave_row.start_date` / `leave_row.end_date`. Two things to get right:

- **Do not hook only the insert branch.** `:1754-1763` is a dedup branch: when `_find_duplicate_leave` matches, it reuses the existing row and never calls `db.add`. A hook inside the `else:` would silently skip the supersede on a re-generated certificate, which is exactly when an operator regenerates paperwork.
- **Gate on `timesheet_codes.leave_code(leave_row.leave_type) in (CODE_SICK, CODE_ANNUAL)`, not an exact string compare.** Generation writes the bare English `"Sick Leave"` / `"Annual Leave"` (`backend/templates/_fields.json:26-34`), but the same table holds `"Sick Leave - الإجازة المرضية"`, `"Annual Leave - إجازة سنوية"`, `"Annual"` and `"Sick"` from the v3 import, and `leave_code` already collapses all of them through `leave_lifecycle.english_part`. Reusing it keeps the hook and the grid on one rule.

`generate_document`'s real signature is `(db, *, employee_id, template_id, fields, manager_id=None, submitter_id=None, embed_signature=None, commit=True, current_user=None, revise_of_book_id=None, attachments=None, return_for_leave_id=None, classification_code=None) -> GenerationResult` (`document_service.py:1038-1055`) — `db` is the only positional argument. `GenerationResult.leave_id` is the new row's id.

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

Three preconditions, all verified on this host on 2026-08-20 — do not re-derive them:

- The read-only URL form works on Windows. `create_engine(f"sqlite:///file:{LIVE_DB.as_posix()}?mode=ro&uri=true", connect_args={"uri": True})` connects, reads, and refuses a write with `sqlite3.OperationalError: attempt to write a readonly database`. (`connect_args={"uri": True}` is redundant with `uri=true` in the query string but harmless — it works either way.)
- `attach_sqlite_pragmas(engine, wal=False)` is safe here: with `wal=False` it registers only `PRAGMA foreign_keys=ON` (`session.py:39-45`), no `journal_mode` write.
- The share **is** reachable and the reference workbooks are intact: `6-Jun/كشف حضور شهر يونيو.xlsx` (1 image, 282 data rows), `7-Jul/كشف حضور شهر يوليو.xlsx` (**0 images** — the lost logo, 275 data rows), `7-Jul/كشف حضور شهر يوليو للسائقين.xlsx` (2 driver rows, `G5566` and `G5567`). The `275` and `2` this test asserts are counted off those files.

Run this test **after** Task 3's `alembic upgrade head`: `build_month` reads `timesheet_stat_fillers` and `timesheet_start_acks`, and the live DB is at `0070_timesheet` until `0071`/`0072` are applied.

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

### Task 7: The shell — route, tokens, chrome, and the one scroll region

**Files:**
- Modify: `frontend/src/index.css` (the eight code token pairs, light and dark)
- Create: `frontend/src/pages/timesheet/codes.ts`
- Create: `frontend/src/pages/timesheet/useTimesheet.ts`
- Create: `frontend/src/pages/timesheet/TimesheetPage.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetToolbar.tsx`
- Create: `frontend/src/pages/timesheet/TimesheetNotice.tsx`
- Create: `frontend/src/pages/timesheet/CodeRibbon.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/shell/navItems.ts` (add `{ to: '/timesheet', key: 'nav.timesheet', Icon: CalendarClock, cap: 'timesheet.view' }`)
- Modify: `frontend/src/App.tsx` (copy the `/permits` pattern in **two** places: the lazy const at `App.tsx:47-49` and the `<RequireCapability cap="…">`-wrapped route at `App.tsx:226-233`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/timesheet/TimesheetPage.test.tsx`
- Test: `frontend/src/locales/timesheet.i18n.test.ts` (copy the shape of `permits.i18n.test.ts`)

**Interfaces:**
- Consumes: the generated types in `frontend/src/lib/api.types.ts` from Task 5.
- Produces, and Tasks 8 and 9 rely on these exact names:

```ts
// codes.ts — the code table. No colours here: CSS owns them (Global Constraints).
export type Code = 'P' | 'AL' | 'SL ' | 'AB' | 'TR' | 'NG' | '-' | 'X'
export type CodeSlug = 'P' | 'AL' | 'SL' | 'AB' | 'TR' | 'NG' | '-' | 'X'

export interface CodeSpec {
  code: Code
  slug: CodeSlug
  key: string          // the keyboard letter: p a s b t n - x
  labelKey: string     // i18n key under the `timesheet.codes` namespace
}

export const CODES: readonly CodeSpec[]
export const slugOf: (code: string | null) => CodeSlug | ''
export const isCode: (value: string) => value is Code

// useTimesheet.ts
export interface TimesheetParams { year: number; month: number; sheet: 'main' | 'drivers' }
export function useTimesheetGrid(params: TimesheetParams)          // React Query read
export function useSetCell(params: TimesheetParams)                // optimistic, rolls back
export function usePatchPeriod(params: TimesheetParams)            // post_count + fillers
export function useCloseMonth(params: TimesheetParams)
export function useReopenMonth(params: TimesheetParams)
export function useAcknowledgeStart(params: TimesheetParams)
/** Both workbooks for a month. */
export function useTimesheetDownload(): {
  download: (args: { year: number; month: number; sheet: 'main' | 'drivers'; variant: 'attendance' | 'statistics' }) => Promise<void>
  pending: boolean
}

/** One employee's sheet. `months: 2` = the month named plus the one before it. */
export function useEmployeeSheetDownload(): {
  download: (args: { employeeId: string; year: number; month: number; months: 1 | 2 }) => Promise<void>
  pending: boolean
}

// TimesheetPage.tsx — owns page state and passes it down
export interface TimesheetUiState {
  variant: 'attendance' | 'statistics'
  brush: Code | null
  selected: string | null            // employee_id for the extract
  panel: 'checks' | 'posts' | 'codes' | 'employee' | 'release' | null
  query: string                      // the employee search
  density: 'compact' | 'default' | 'roomy'
}
```

The shell, which is the point of this task:

```
TopNav (existing chrome)
┌ .ts-shell  — flex column, block-size: 100%, overflow: hidden ─────────┐
│ head       title · month datum · search field · status chip           │
│ toolbar    ‹ month › · All staff|Drivers · Attendance|Statistics · S M L │
│ ribbon     the eight codes · hint · corrections · undo                │
│ notice     N to fix · N to review · N new · N leaving · N removed     │
│ ┌ .ts-grid — flex: 1; min-block-size: 0 ─────────────────────────────┐│
│ │ THE ONLY SCROLL REGION ON THE PAGE                                 ││
│ └────────────────────────────────────────────────────────────────────┘│
│ dock       fixed, 54px  (Task 9)                                      │
└───────────────────────────────────────────────────────────────────────┘
```

Locked rules for this task, from UI spec §16.1 and §3:

1. The page container is `flex min-block-size-0 flex-col overflow-hidden` and the grid wrapper is `flex-1 min-block-size-0 overflow-auto`. **Reaching the dock must never require scrolling the page** — that is the whole reason for this shape, and `TimesheetPage.test.tsx` asserts the contract.
2. `--cell: clamp(26px, calc((100vw - 600px) / 31), 46px)` on `:root`, with `--row` and `--cell-font` per density. Declare it on `:root`, **not** `html` — `:root` is a pseudo-class and wins on specificity whatever the source order (spec §14).
3. The **seven** code token pairs of UI spec §3.2 go in `index.css` beside the existing tokens, light and dark, exactly as tabulated there, plus an **eighth pair for `X`** whose light values come from UI spec §15 change 6 (`#990033` fill, white ink) — §3.2 is titled "the seven code fills" and predates the red block, so it does not list `X`. The token segment is the **slug**, not the code: `SL ` (trailing space) slugs to `SL`, `-` slugs to `OFFROSTER`. The trailing space is load-bearing in the workbook (`$AO$5` COUNTIF) and must survive in `codes.ts`, never in a CSS identifier. No component may name a code colour.
4. Every string lives under one nested `timesheet` namespace in both locale files, with the copy table in UI spec §11 as the source. **Except the nav label**: `navItems.ts` entries use `key: 'nav.<x>'`, so `nav.timesheet` goes in the existing `nav` block (`en.json:67`, `ar.json:67`) and must appear in `timesheet.i18n.test.ts`'s `KEYS` array alongside the `timesheet.*` keys. `timesheet.i18n.test.ts` enforces parity.
5. Logical properties only. Numbers interpolated into Arabic sentences are wrapped so bidi cannot reorder them (`dir="ltr"` + `unicode-bidi: isolate`; spec §14).
6. **Loading and empty are designed states, not spinners** (UI spec §9). While the grid loads, render skeleton rows at the real metrics — the identity block and the 31 columns are already known, so the grid must not resize when data lands. When the roster is empty, render `EmptyState` with the reason (`No one was employed at JD 908 in this month`) and the month stepper, not a shrug.
7. **The mutation is optimistic and rolls back.** `useSetCell` writes into the cached grid immediately, restores the previous code on error, and shows the server's message. A failed correction that leaves the wrong code on screen is the one failure mode this page cannot have.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/pages/timesheet/TimesheetPage.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { TimesheetPage } from './TimesheetPage'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => ({
  api: {
    getTimesheet: vi.fn().mockResolvedValue({
      year: 2026, month: 7, days_in_month: 31, sheet: 'main', post_count: 249,
      rows: [], blocking: [], warnings: [], removed: [], closed_at: null, closed_by: null,
    }),
  },
  apiErrorMessage: (e: unknown) => String(e),
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TimesheetPage />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('TimesheetPage shell', () => {
  it('scrolls the grid and nothing else', async () => {
    renderPage()
    const page = await screen.findByTestId('timesheet-shell')
    const grid = await screen.findByTestId('timesheet-scroll')
    expect(page.className).toContain('overflow-hidden')
    expect(grid.className).toContain('overflow-auto')
    expect(grid.className).toContain('flex-1')
  })

  it('keeps the dock outside the scroll region', async () => {
    renderPage()
    const grid = await screen.findByTestId('timesheet-scroll')
    expect(grid).not.toContainElement(await screen.findByTestId('timesheet-dock'))
  })

  it('names the month and the site in the head', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: /monthly time sheet/i })).toBeInTheDocument()
    expect(screen.getByText(/JD 908/)).toBeInTheDocument()
  })
})
```

**There is no `renderWithProviders` and no `frontend/src/test/utils.tsx` in this repo** — `frontend/src/test/` contains only `setup.ts`. Every test file declares its own wrapper, as above; the page form is `MemoryRouter` + `QueryClientProvider` (`pages/employees/EmployeeActivitySection.test.tsx:109-114`) and the router-free form for panels is `QueryClientProvider` alone (`pages/employees/EmployeeActivityLookup.test.tsx:35-37`). i18next needs no provider: `setup.ts:116-121` initialises it globally with English. Do **not** create a shared helper for this feature; follow the house pattern.

The same applies to every other test file in Tasks 7–9: replace each `import { renderWithProviders } from '@/test/utils'` with a local `renderPage`/`renderPanel` helper, and stub the client with `vi.mock('@/lib/api', …)` rather than letting a query hit the network.

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetPage.test.tsx`
Expected: FAIL — cannot resolve `./TimesheetPage`.

- [ ] **Step 3: Add the tokens**

In `frontend/src/index.css`, inside the existing `:root` block (`:83-174`), after the `--wa-*` tokens at `:165-173`:

```css
  /* Monthly time sheet — the workbook's own conditional-format fills. Light is
     the paper hex so screen and print agree; dark mixes the hue into the
     surface, because #FFC7CE at full strength on #131826 is a flashbang.
     Semantic — never hardcode these hex in components. */
  --code-P-fill: transparent;         --code-P-ink: var(--text);
  --code-AL-fill: #bdd7ee;            --code-AL-ink: #10243a;
  --code-SL-fill: #c6e0b4;            --code-SL-ink: #17300f;
  --code-AB-fill: #ffc7ce;            --code-AB-ink: #9c0006;
  --code-TR-fill: #cc99ff;            --code-TR-ink: #2e0b52;
  --code-NG-fill: #ff9900;            --code-NG-ink: #3a2200;
  --code-OFFROSTER-fill: transparent; --code-OFFROSTER-ink: var(--text-faint);
  --code-X-fill: #990033;             --code-X-ink: #ffffff;
```

and in the `[data-theme="dark"]` block (`:176-248`):

```css
  --code-AL-fill: color-mix(in oklab, #bdd7ee 24%, var(--surface));  --code-AL-ink: #bdd7ee;
  --code-SL-fill: color-mix(in oklab, #c6e0b4 24%, var(--surface));  --code-SL-ink: #c6e0b4;
  --code-AB-fill: color-mix(in oklab, #ffc7ce 26%, var(--surface));  --code-AB-ink: #ff9aa6;
  --code-TR-fill: color-mix(in oklab, #cc99ff 26%, var(--surface));  --code-TR-ink: #d9b3ff;
  --code-NG-fill: color-mix(in oklab, #ff9900 34%, var(--surface));  --code-NG-ink: #ffbb55;
  --code-X-fill: color-mix(in oklab, #990033 66%, var(--surface));   --code-X-ink: #ffd7de;
```

The name order is `--code-<SLUG>-fill` / `--code-<SLUG>-ink`, which is what UI spec §3.2's table header declares (`--code-*-fill`). Every light value above and every dark value for `AL`, `SL`, `AB`, `TR`, `NG` is quoted verbatim from that table. **The dark `X` pair is not in either spec** — §3.2 predates the red block and §15 gives only the print/light value (`#990033` + white ink). The two dark values here are derived by the same mix-into-surface rule §3.2 uses for the other six; they are a plan decision, not a spec quotation, and the `i18n-rtl-reviewer` pass in Task 11 should look at them in dark mode specifically.

Then the `[data-code]` selectors, once, in the same file. `index.css` has no `@layer` anywhere and existing bare attribute selectors already sit unlayered (`:290-297`), so these need no wrapper and will outrank Tailwind utilities on the same element — which is what we want:

```css
[data-code='P'] { background: var(--code-P-fill); color: var(--code-P-ink); }
[data-code='AL'] { background: var(--code-AL-fill); color: var(--code-AL-ink); }
[data-code='SL'] { background: var(--code-SL-fill); color: var(--code-SL-ink); }
[data-code='AB'] { background: var(--code-AB-fill); color: var(--code-AB-ink); font-weight: 600; }
[data-code='TR'] { background: var(--code-TR-fill); color: var(--code-TR-ink); }
[data-code='NG'] { background: var(--code-NG-fill); color: var(--code-NG-ink); font-weight: 600; }
[data-code='-'] { background: var(--code-OFFROSTER-fill); color: var(--code-OFFROSTER-ink); }
[data-code='X'] { background: var(--code-X-fill); color: var(--code-X-ink); font-weight: 600; }
[data-code=''] { background: transparent; color: transparent; }
```

- [ ] **Step 4: Write `codes.ts`, the API client additions, and the hooks**

`codes.ts` is the single source for the code table:

```ts
export const CODES: readonly CodeSpec[] = [
  { code: 'P', slug: 'P', key: 'p', labelKey: 'timesheet.codes.present' },
  { code: 'AL', slug: 'AL', key: 'a', labelKey: 'timesheet.codes.annual' },
  { code: 'SL ', slug: 'SL', key: 's', labelKey: 'timesheet.codes.sick' },
  { code: 'AB', slug: 'AB', key: 'b', labelKey: 'timesheet.codes.absence' },
  { code: 'TR', slug: 'TR', key: 't', labelKey: 'timesheet.codes.national' },
  { code: 'NG', slug: 'NG', key: 'n', labelKey: 'timesheet.codes.newGuard' },
  { code: '-', slug: '-', key: '-', labelKey: 'timesheet.codes.offRoster' },
  { code: 'X', slug: 'X', key: 'x', labelKey: 'timesheet.codes.notBilled' },
]

/** `'SL '` keeps its trailing space on the wire; the DOM uses the slug. */
export const slugOf = (code: string | null): CodeSlug | '' =>
  code === null ? '' : ((code.trim() || '-') as CodeSlug)
```

In `frontend/src/lib/api.ts` add the typed calls. **The two workbook downloads have no precedent to copy — this repo has no file download.** `fetchPermitDocumentBlob` (`api.ts:1044-1045`) is an *inline-preview* helper: it delegates to the private `fetchPermitBlob` (`api.ts:908-918`), which appends `?encoding=base64` and returns a `Blob` that the caller opens in a tab with `URL.createObjectURL` + `window.open` (`pages/permits/PermitDetailDialog.tsx:259-263`). An `.xlsx` must land as a file, not open in a tab. Add one new helper that fetches the export URL directly (same-origin, so the response headers are readable), returns `{ blob, filename }` by parsing `filename*=UTF-8''<pct>` off `content-disposition` with `decodeURIComponent`, and falls back to a client-derived name when the header is missing. `useTimesheet.ts` then does the anchor-click save (`a.download = filename`, click, revoke) — the one place in the frontend that does.

In `useTimesheet.ts` use React Query. Follow `frontend/src/pages/leaves/report/useLeaveReport.ts` for the **read** side (module-level `queryFn`, a stable `EMPTY_*` fallback, `useMemo` for every derivation, one flat returned object — and copy its documented object-identity warning, because the grid object has the same hazard). Note `useLeaveReport` is read-only: it contains no `useMutation`, so it is not a precedent for the mutations. For those follow `frontend/src/pages/employees/EmployeeDetailPage.tsx:123-139` (`useMutation` + `qc.invalidateQueries` + `toast.success` / `toast.error`). `useSetCell` is optimistic — write the cell into the cached grid in `onMutate`, roll the previous value back from `context` on error, surface the server message in a toast. **No existing hook in this repo does optimistic rollback**, so that part is new code with no template; write it carefully and test the rollback path.

`timesheet.i18n.test.ts` copies `frontend/src/locales/permits.i18n.test.ts` (127 lines) exactly: import the real `@/lib/i18n` plus both JSON files, a `type Rec` + dot-path `get()` helper (`:6-9`), a flat `KEYS` array of fully-dotted key strings (`:11-90`), then a `describe` (`:92`) with a count floor, a per-key loop generating an existence check and a no-English-leak check (`expect(ar).not.toBe(en)`, `:97-107`), and a `changeLanguage('ar')` pluralization test in `try/finally` (`:110-125`). **The allowlist skip in the leak check must cover the code letters** — `P`, `AL`, `SL `, `AB`, `TR`, `NG`, `-` and `X` are identical in both languages by design and would otherwise fail `ar !== en`. Include `nav.timesheet` in `KEYS`.

- [ ] **Step 5: Build the shell, the toolbar, the notice line and the ribbon**

`TimesheetPage` renders `data-testid="timesheet-shell"` on the flex column and `data-testid="timesheet-scroll"` on the grid wrapper. The toolbar carries the month stepper (§2.7c icon-buttons), the two segmented controls and the sheet zoom (the segmented pattern in UI spec §6), and the always-visible employee search field that sets `query` and opens the `employee` panel. The notice line renders one chip per count — blocking, warnings, joined, leaving, removed — each a button that opens the checks panel. `CodeRibbon` renders the eight codes with `aria-pressed` and a `<kbd>` per keyboard letter.

- [ ] **Step 6: Run the tests and typecheck**

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetPage.test.tsx
pnpm -C frontend exec vitest run src/locales/timesheet.i18n.test.ts
pnpm -C frontend exec tsc -b --noEmit
```

Expected: 3 shell tests PASS, i18n parity PASS, no type errors. Run them one at a time — combined frontend checks can exhaust memory on this host.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/index.css frontend/src/pages/timesheet frontend/src/lib/api.ts frontend/src/components/shell/navItems.ts frontend/src/App.tsx frontend/src/locales
git commit -m "feat(timesheet): page shell, code tokens, toolbar and notice line"
```

---

### Task 8: The grid — cells, picker, drag-to-fill, row counts

**Files:**
- Create: `frontend/src/pages/timesheet/TimesheetGrid.tsx`
- Create: `frontend/src/pages/timesheet/CodePicker.tsx`
- Create: `frontend/src/pages/timesheet/RowTally.tsx`
- Test: `frontend/src/pages/timesheet/TimesheetGrid.test.tsx`

**Interfaces:**
- Consumes: `CODES`, `slugOf` (Task 7), the grid response from Task 5.
- Produces:

```ts
export interface TimesheetGridProps {
  rows: TimesheetRow[]
  daysInMonth: number
  variant: 'attendance' | 'statistics'
  closed: boolean
  brush: Code | null
  selected: string | null
  onSetCell: (employeeId: string, day: number, code: Code | null, note?: string) => void
  onFill: (cells: { employeeId: string; day: number }[], code: Code) => void
  onSelect: (employeeId: string | null) => void
}
```

Locked rules, from UI spec §7, §16.2 and §15:

1. **31 day columns in every month.** A day the month does not have renders an empty `aria-hidden` cell with `tabIndex={-1}`, and its header carries `data-out="1"`. The grid must not reflow when the month changes.
2. **No `AK..AP` totals columns.** They still print in the workbook; on screen their replacement is `RowTally`.
3. **Cell-as-button**, per UI spec §7: `3px` radius, `data-code={slug}`, inset focus ring (an outset ring is clipped by the neighbours), no hover lift, `aria-label` of the form `"G7057 day 14 — annual leave"`, and an edited cell marked structurally (1px inset ring plus a corner dot) as well as by fill.
4. **Table geometry:** `table-layout: fixed` with every width declared on the header row, `inline-size: max-content`, and the identity cells clipped with an ellipsis (`title` carries the full value). A wrapping name breaks the vertical scan and is a review rejection.
5. **Drag to fill:** `pointerdown` on a cell starts a rectangle, `pointermove` previews it with a ring and a live count, `pointerup` commits **once** through `onFill`. Committing per move repaints the grid and tears the cell out from under the pointer. `Escape` cancels; the trailing click is swallowed so it cannot also open the picker. With a brush armed the fill uses it; with nothing armed it uses the code of the anchor cell.
5b. **Shift-click is the same fill without the sweep** (UI spec §8): with a brush armed, shift-clicking paints the inclusive run from the last painted day on that employee. It routes through the same `onFill`, and it is what an operator uses for a 20-day range where dragging across the sheet is awkward.
6. **Row counts on hover and focus:** `RowTally` shows all eight counts for the row under the pointer, follows the row through the scroll that focusing a cell causes, and never appears mid-drag.
7. **Statistics is read-only:** block the activation in a capture-phase handler and say why in one line. `pointer-events: none` is not enough — it does not stop `Enter` (spec §14).
8. **Roster badges:** a joiner carries `new` (or `from <day>` once acknowledged), a leaver carries `to <day>`, each with the reason in `title`.

- [ ] **Step 1: Write the failing tests**

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
  stat_filler: null,
  joined_day: null,
  left_day: null,
  start_confirmed: false,
  notes: {},
}

const props = {
  rows: [row],
  daysInMonth: 31,
  variant: 'attendance' as const,
  closed: false,
  brush: null,
  selected: null,
  onSetCell: vi.fn(),
  onFill: vi.fn(),
  onSelect: vi.fn(),
}

describe('TimesheetGrid', () => {
  it('renders 31 day columns and blanks the days a 30-day month lacks', () => {
    const { rerender } = render(<TimesheetGrid {...props} />)
    expect(screen.getAllByRole('columnheader', { name: /^31/ })).toHaveLength(1)
    rerender(<TimesheetGrid {...props} daysInMonth={30} rows={[{ ...row, codes: [...Array(30).fill('P'), null] }]} />)
    expect(screen.getAllByRole('columnheader', { name: /^31/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /G1001 day 30/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /G1001 day 31/i })).not.toBeInTheDocument()
  })

  it('does not render the printed totals columns', () => {
    render(<TimesheetGrid {...props} />)
    expect(screen.queryByRole('columnheader', { name: /total day/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^off$/i })).not.toBeInTheDocument()
  })

  it('reports a plain code immediately', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /annual leave/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AL')
  })

  it('collects an optional note when marking absence', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /absence/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'no show')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSetCell).toHaveBeenCalledWith('G1001', 3, 'AB', 'no show')
  })

  it('paints the focused cell from the keyboard with the code letter', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} onSetCell={onSetCell} />)
    screen.getByRole('button', { name: /G1001 day 5/i }).focus()
    await userEvent.keyboard('x')
    expect(onSetCell).toHaveBeenCalledWith('G1001', 5, 'X')
  })

  it('returns focus to the cell when the picker is dismissed', async () => {
    render(<TimesheetGrid {...props} />)
    const cell = screen.getByRole('button', { name: /G1001 day 7/i })
    await userEvent.click(cell)
    await userEvent.keyboard('{Escape}')
    expect(cell).toHaveFocus()
  })

  it('shows that row\'s code counts on hover', async () => {
    render(<TimesheetGrid {...props} />)
    await userEvent.hover(screen.getByRole('button', { name: /G1001 day 2/i }))
    const tally = await screen.findByRole('status')
    expect(tally).toHaveTextContent('G1001')
    expect(tally).toHaveTextContent('31')
  })

  it('offers no editing once the month is closed', async () => {
    render(<TimesheetGrid {...props} closed />)
    await userEvent.click(screen.getByRole('button', { name: /G1001 day 3/i }))
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('refuses edits in the statistics variant', async () => {
    const onSetCell = vi.fn()
    render(<TimesheetGrid {...props} variant="statistics" onSetCell={onSetCell} />)
    const cell = screen.getByRole('button', { name: /G1001 day 3/i })
    cell.focus()
    await userEvent.keyboard('a')
    await userEvent.click(cell)
    expect(onSetCell).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('badges a joiner and a leaver with the reason', () => {
    render(
      <TimesheetGrid
        {...props}
        rows={[
          { ...row, employee_id: 'G2001', joined_day: 12 },
          { ...row, employee_id: 'G2002', row_no: 2, left_day: 17 },
        ]}
      />,
    )
    expect(screen.getByTitle(/started on day 12/i)).toBeInTheDocument()
    expect(screen.getByTitle(/last worked day 17/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx`
Expected: FAIL — cannot resolve `./TimesheetGrid`.

- [ ] **Step 3: Build the grid, the picker and the row tally**

The shared `Table` primitive wraps in `w-full overflow-x-auto` (`frontend/src/components/ui/table.tsx:12`) and is the wrong shape here — this grid owns its own `<table>` inside the shell's single scroll region. Nothing in this repo scrolls 31 data columns yet; start plain and only reach for `@tanstack/react-virtual` if 275 rows measurably drag.

Drag-to-fill lives in `TimesheetGrid` as three handlers plus one piece of state (`{ anchor, code, cells }`), and the preview is a `data-preview="1"` attribute — no React state per cell, or a 806-cell grid re-renders on every pointer move.

- [ ] **Step 4: Run the tests and typecheck**

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetGrid.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Expected: 10 grid tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/timesheet
git commit -m "feat(timesheet): 31-column grid with drag-to-fill, code picker and row counts"
```

---

### Task 9: The dock — posts, codes, checks, employee extract, release

**Files:**
- Create: `frontend/src/pages/timesheet/TimesheetDock.tsx`
- Create: `frontend/src/pages/timesheet/panels/PostsPanel.tsx`
- Create: `frontend/src/pages/timesheet/panels/CodesPanel.tsx`
- Create: `frontend/src/pages/timesheet/panels/ChecksPanel.tsx`
- Create: `frontend/src/pages/timesheet/panels/EmployeePanel.tsx`
- Create: `frontend/src/pages/timesheet/panels/ReleasePanel.tsx`
- Test: `frontend/src/pages/timesheet/panels/EmployeePanel.test.tsx`
- Test: `frontend/src/pages/timesheet/panels/ChecksPanel.test.tsx`
- Test: `frontend/src/pages/timesheet/TimesheetDock.test.tsx`

**Interfaces:**
- Consumes: the grid response and the mutations from Task 7, `CODES` and `slugOf`.
- Produces:

```ts
export interface TimesheetDockProps {
  grid: TimesheetGridResponse            // the whole GET payload, including `removed`
  ui: TimesheetUiState                   // from Task 7
  onOpenPanel: (panel: TimesheetUiState['panel']) => void
  onSelect: (employeeId: string | null) => void
  onQuery: (query: string) => void
  onAcknowledge: (employeeId: string) => void
  onSetPostCount: (postCount: number) => void
  onDownload: (variant: 'attendance' | 'statistics') => void
  onEmployeeDownload: (args: { employeeId: string; year: number; month: number; months: 1 | 2 }) => void
  /** The red-block helper: one call carrying every day to block, edges excluded. */
  onFillRedBlock: (employeeId: string, days: number[]) => void
  onClose: () => void
  onReopen: () => void
}
```

Each panel takes only what it renders — `ChecksPanel` gets `{ blocking, warnings, joined, leaving, removed, year, month, onAcknowledge, onSelect }`, `EmployeePanel` gets `{ rows, year, month, closed, selected, query, onQuery, onSelect, onEmployeeDownload, onFillRedBlock }`. No panel receives the whole dock props object.

Two shape facts, because the payload does not match those prop names one-for-one:

- **`blocking` and `warnings` are top-level on the GET payload**, not nested under a `preflight` object, and each item is Task 3's `Issue`: `{ employee_id, kind, detail }`. There is no `level`, no `code`, no `message_en` / `message_ar`. `kind` is the stable machine string (`no_designation`, `unknown_leave`, …) that the panel translates itself — `t(\`timesheet.issues.${issue.kind}\`)` — with `detail` as the specifics. That keeps every string in the locale files, which is rule 4 of Task 7.
- **`joined` and `leaving` are not fields on the payload.** `TimesheetPage` derives them from `rows`: `joined = rows.filter(r => r.joined_day !== null).map(r => ({ employee_id, name_en, day: r.joined_day, confirmed: r.start_confirmed }))`, and `leaving` the same off `left_day`. Only `removed` comes from the server, because it is the one group that is *absent* from `rows` by construction.

Locked rules, from UI spec §16.2–§16.5:

1. The dock is fixed furniture, 54px, four groups, each a button with `aria-expanded`. It reads at a glance without opening anything: contracted posts and the implied count, all eight code counts, the selected employee, and the two download buttons.
2. A panel opens **upward over the grid**, `position: absolute`, `max-block-size: 46vh` — never pushing the grid, never reflowing it. `Escape` closes; the trigger toggles.
3. **The employee picker** (§16.3): search matches `7141`, `g7141`, `G7141`, a name, or a designation in either language. Two panes — results on the reading-start side, a preview on the other with all eight counts, the roster badge, and the actions. `ArrowUp`/`ArrowDown` move, `Enter` selects, selecting scrolls the row into the centre of the grid.
4. **The two-month extract** states both months by name, prints both filenames, and calls the export with `months: 2`. This is the resignation and termination handover HR asked for.
5. **The red-block helper**: `Bill starts on day N` → block `1..N-1` for the selected employee in the month on screen, **skipping roster edges** (`NG`, `-`) because those outrank a block. One `onFillRedBlock` call, not N calls.
6. **Checks panel** shows blocking, then warnings, then roster movement: joined with `Confirm starting point`, leaving, and removed with the reason. Downloads stay disabled while `blocking` is non-empty and the month is open, with the reason beside the disabled button.
7. **Release panel**: both filenames, the freeze sentence, the seal after close, and reopen behind a two-step inline confirm carrying the audit line. No modal.
8. **Add employee is not owned here.** The panel's add action opens the existing employee create flow; this page detects a date of joining inside the month, flags the starting point, and links to the record.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/pages/timesheet/panels/EmployeePanel.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EmployeePanel } from './EmployeePanel'

// No shared helper exists; panels do not navigate, so QueryClientProvider alone.
// See pages/employees/EmployeeActivityLookup.test.tsx:35-37.
function renderPanel(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// `nationality_en` is what `constants.nationality_en()` returns, so it can only be
// one of the fifteen mapped English labels — U.A.E, Oman, Nepal, Sudan, Jordan,
// Yemen, Comoros, Mauritania, Egypt, Syria, Morocco, Algeria. There is no
// Bangladeshi or Indian employee at JD 908; using those here would model a row
// the backend can never produce.
const rows = [
  { employee_id: 'G7141', name_en: 'MD RASEL HOWLADER', designation_en: 'Security Guard', designation_ar: 'حارس امن', nationality_en: 'Oman', row_no: 19, codes: [...Array(17).fill('P'), ...Array(14).fill('-')], stat_codes: [], stat_block: 1, stat_filler: null, rank_order: 15, joined_day: null, left_day: 17, start_confirmed: false, notes: {} },
  { employee_id: 'G7057', name_en: 'RAJESH KUMAR SINGH', designation_en: 'assistant security supervisor', designation_ar: 'مساعد مشرف', nationality_en: 'U.A.E', row_no: 7, codes: Array(31).fill('P'), stat_codes: [], stat_block: 1, stat_filler: null, rank_order: 8, joined_day: null, left_day: null, start_confirmed: false, notes: {} },
]

const props = {
  rows,
  year: 2026,
  month: 7,
  closed: false,
  selected: null,
  query: '',
  onQuery: vi.fn(),
  onSelect: vi.fn(),
  onEmployeeDownload: vi.fn(),
  onFillRedBlock: vi.fn(),
}

describe('EmployeePanel', () => {
  it('finds an employee by bare G-number digits', async () => {
    renderPanel(<EmployeePanel {...props} query="7141" />)
    expect(await screen.findByRole('option', { name: /MD RASEL HOWLADER/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /RAJESH/ })).not.toBeInTheDocument()
  })

  it('finds the same employee with the G prefix, either case', async () => {
    const { rerender } = renderPanel(<EmployeePanel {...props} query="g7141" />)
    expect(await screen.findByRole('option', { name: /HOWLADER/ })).toBeInTheDocument()
    rerender(<EmployeePanel {...props} query="G7141" />)
    expect(await screen.findByRole('option', { name: /HOWLADER/ })).toBeInTheDocument()
  })

  it('finds an employee by name', async () => {
    renderPanel(<EmployeePanel {...props} query="rajesh" />)
    expect(await screen.findByRole('option', { name: /RAJESH KUMAR SINGH/ })).toBeInTheDocument()
  })

  it('previews the roster status and the code counts', async () => {
    renderPanel(<EmployeePanel {...props} selected="G7141" />)
    // UI spec §15 fixes this wording as "last worked day 17"; the grid's row badge
    // in Task 8 asserts the same string. One phrasing, not two.
    expect(await screen.findByText(/last worked day 17/i)).toBeInTheDocument()
    expect(screen.getByTestId('preview-count-P')).toHaveTextContent('17')
    expect(screen.getByTestId('preview-count--')).toHaveTextContent('14')
  })

  it('names both months and exports two workbooks', async () => {
    const onEmployeeDownload = vi.fn()
    renderPanel(
      <EmployeePanel {...props} selected="G7141" onEmployeeDownload={onEmployeeDownload} />,
    )
    expect(await screen.findByText(/June and July 2026/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /2 months/i }))
    expect(onEmployeeDownload).toHaveBeenCalledWith({ employeeId: 'G7141', year: 2026, month: 7, months: 2 })
  })

  it('red blocks the days before the billing start and leaves roster edges alone', async () => {
    const onFillRedBlock = vi.fn()
    renderPanel(<EmployeePanel {...props} selected="G7141" onFillRedBlock={onFillRedBlock} />)
    await userEvent.clear(screen.getByLabelText(/bill starts on day/i))
    await userEvent.type(screen.getByLabelText(/bill starts on day/i), '23')
    await userEvent.click(screen.getByRole('button', { name: /red block/i }))
    // days 1..17 are P and get blocked; 18..22 are `-` and must not be touched
    expect(onFillRedBlock).toHaveBeenCalledWith('G7141', [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ])
  })
})
```

`/June and July 2026/` is **new copy**: UI spec §15 change 5 says only "The card states both months", and §11's copy table has no row for it. Add one — `timesheet.employee.spanMonths` with an English and an Arabic value — before writing the component, or the `i18n-rtl-reviewer` in Task 11 will bounce it. Every other string these tests assert is quoted from the spec.

```tsx
// frontend/src/pages/timesheet/panels/ChecksPanel.test.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChecksPanel } from './ChecksPanel'

function renderPanel(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const props = {
  // Task 3's `Issue`, exactly: employee_id, kind, detail. The panel localises
  // `kind` itself via t(`timesheet.issues.${kind}`); the server sends no prose.
  blocking: [{ employee_id: 'G7099', kind: 'no_designation', detail: 'G7099 NAWAF AL BALUSHI' }],
  warnings: [],
  // `joined` and `leaving` are derived by TimesheetPage from `rows`, not sent.
  joined: [{ employee_id: 'G7176', name_en: 'FAISAL AKRAM JAVED', day: 10, confirmed: false }],
  leaving: [{ employee_id: 'G7141', name_en: 'MD RASEL HOWLADER', day: 17 }],
  // `removed` is Task 3's `Removed`, including `year`.
  removed: [{ employee_id: 'G7169', name_en: 'SURESH BABU PILLAI', last_day: 17, month: 6, year: 2026, end_date: '2026-06-17' }],
  month: 7,
  year: 2026,
  onAcknowledge: vi.fn(),
  onSelect: vi.fn(),
}

describe('ChecksPanel', () => {
  it('states the starting point of a mid-month joiner and acknowledges it', async () => {
    const onAcknowledge = vi.fn()
    renderPanel(<ChecksPanel {...props} onAcknowledge={onAcknowledge} />)
    // UI spec §16.4's sentence template is "Started on day {N} of {Month} —
    // days 1–{N-1} are NG until you say otherwise". This fixture joins on day 10.
    expect(await screen.findByText(/days 1–9 are NG/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /confirm starting point/i }))
    expect(onAcknowledge).toHaveBeenCalledWith('G7176')
  })

  it('says who left and that he is off the next sheet', async () => {
    renderPanel(<ChecksPanel {...props} />)
    expect(await screen.findByText(/off next month's sheet/i)).toBeInTheDocument()
  })

  it('says who was removed and why', async () => {
    renderPanel(<ChecksPanel {...props} />)
    expect(await screen.findByText(/SURESH BABU PILLAI/)).toBeInTheDocument()
    expect(screen.getByText(/not on this month's attendance sheet or statistics/i)).toBeInTheDocument()
  })
})
```

```tsx
// frontend/src/pages/timesheet/TimesheetDock.test.tsx — the gate and the panels
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TimesheetDock } from './TimesheetDock'

function renderPanel(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('TimesheetDock', () => {
  it('disables both downloads while a blocking check is open and says why', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 2 })} />)
    expect(await screen.findByRole('button', { name: /attendance/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /client statistics/i })).toBeDisabled()
    // UI spec §11's binding English string is "Fix before download" (:386).
    expect(screen.getByText(/fix before download/i)).toBeInTheDocument()
  })

  it('enables the downloads when the checks are clear', async () => {
    renderPanel(<TimesheetDock {...dockProps({ blocking: 0 })} />)
    expect(await screen.findByRole('button', { name: /attendance/i })).toBeEnabled()
  })

  it('asks the page to open a panel, and marks the trigger expanded when it is', async () => {
    const base = dockProps({ blocking: 0 })
    const onOpenPanel = vi.fn()
    const { rerender } = renderPanel(
      <TimesheetDock {...base} onOpenPanel={onOpenPanel} />,
    )
    const trigger = await screen.findByRole('button', { name: /codes/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(onOpenPanel).toHaveBeenCalledWith('codes')

    rerender(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} onOpenPanel={onOpenPanel} />)
    expect(screen.getByRole('button', { name: /codes/i })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: /cells by code/i })).toBeInTheDocument()
  })

  it('closes the open panel on Escape', async () => {
    const base = dockProps({ blocking: 0 })
    const onOpenPanel = vi.fn()
    renderPanel(
      <TimesheetDock {...base} ui={{ ...base.ui, panel: 'codes' }} onOpenPanel={onOpenPanel} />,
    )
    await userEvent.keyboard('{Escape}')
    expect(onOpenPanel).toHaveBeenCalledWith(null)
  })

  it('needs two steps to reopen a closed month', async () => {
    const onReopen = vi.fn()
    const base = dockProps({ blocking: 0, closed: true, onReopen })
    renderPanel(<TimesheetDock {...base} ui={{ ...base.ui, panel: 'release' }} />)
    await userEvent.click(await screen.findByRole('button', { name: /reopen month/i }))
    expect(onReopen).not.toHaveBeenCalled()
    expect(screen.getByText(/supersede/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^reopen$/i }))
    expect(onReopen).toHaveBeenCalled()
  })
})
```

The helper the dock test uses, at the top of that file — a complete payload, so a
missing field is a type error rather than a silent `undefined` in a panel. It is
the `MonthGrid` shape from Task 3 exactly: `blocking` and `warnings` sit at the
top level (there is no `preflight` wrapper), each item is `{ employee_id, kind,
detail }`, and "closed" is `closed_at !== null` — there is no boolean `closed`
field on the wire:

```tsx
function dockProps({
  blocking = 0,
  closed = false,
  onReopen = vi.fn(),
}: { blocking?: number; closed?: boolean; onReopen?: () => void }) {
  return {
    grid: {
      year: 2026,
      month: 7,
      days_in_month: 31,
      sheet: 'main' as const,
      closed_at: closed ? '2026-08-01T06:00:00' : null,
      closed_by: closed ? 'A. Al Mansoori' : null,
      post_count: 249,
      rows: [],
      blocking: Array.from({ length: blocking }, (_, i) => ({
        employee_id: `G70${i}`,
        kind: 'no_designation',
        detail: `G70${i} NO DESIGNATION`,
      })),
      warnings: [],
      removed: [],
    },
    ui: {
      variant: 'attendance' as const,
      brush: null,
      selected: null,
      panel: null,
      query: '',
      density: 'default' as const,
    },
    onOpenPanel: vi.fn(),
    onSelect: vi.fn(),
    onQuery: vi.fn(),
    onAcknowledge: vi.fn(),
    onSetPostCount: vi.fn(),
    onDownload: vi.fn(),
    onEmployeeDownload: vi.fn(),
    onFillRedBlock: vi.fn(),
    onClose: vi.fn(),
    onReopen,
  }
}
```

The dock owns `panel` only through `ui.panel` and `onOpenPanel`, so the toggle test drives it the way `TimesheetPage` does: re-render with the new `ui`. If a test needs the panel open, pass `ui: { ...base.ui, panel: 'codes' }`.

- [ ] **Step 2: Run them to make sure they fail**

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet/panels/EmployeePanel.test.tsx
pnpm -C frontend exec vitest run src/pages/timesheet/panels/ChecksPanel.test.tsx
pnpm -C frontend exec vitest run src/pages/timesheet/TimesheetDock.test.tsx
```

Expected: FAIL — the components do not exist.

- [ ] **Step 3: Build the dock and the five panels**

Copy nothing from the mockup's inline styles: every surface is a token and every button is a pattern from UI spec §6. `EmployeePanel` owns only search and preview state; the selected employee lives in `TimesheetPage`, because the grid highlights it too.

- [ ] **Step 4: Run the tests and typecheck**

```powershell
pnpm -C frontend exec vitest run src/pages/timesheet
pnpm -C frontend exec tsc -b --noEmit
```

Expected: 27 timesheet tests PASS — 3 shell (Task 7), 10 grid (Task 8), 6 employee panel, 3 checks panel, 5 dock — and no type errors.

- [ ] **Step 5: Sync types and commit**

Use the `sync-api-types` skill (`.agents/skills/sync-api-types/SKILL.md`), then commit — **never** `git add backend/openapi.json`, it is gitignored and the add aborts the whole invocation.

```bash
git add frontend/src/pages/timesheet frontend/src/lib/api.types.ts frontend/src/locales
git commit -m "feat(timesheet): dock panels, G-number picker and the two-month employee extract"
```

---

### Task 10: Employee record download and the designation catalog UI

**Files:**
- Modify: `frontend/src/pages/employees/EmployeeIdCard.tsx` (the actual action surface) and `frontend/src/pages/employees/EmployeeDetailPage.tsx` (the call site)
- Create: `frontend/src/pages/settings/DesignationCatalog.tsx`
- Modify: `frontend/src/pages/settings/SettingsPage.tsx`
- Modify: `frontend/src/lib/api.ts` (designations list + reorder; the employee download already landed in Task 7)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

The backend for both already exists — Task 3 built `list_designations`/`reorder_designations`, Task 5 exposed the routes, and Task 5's `test_designations_list_and_reorder` covers them. This task is UI only.

- [ ] **Step 1: Add the employee download, two months for a departure**

A **"Time sheet"** action on the employee record calling `/api/v1/timesheet/employee/{id}/{year}/{month}/export`, beside the existing per-employee document actions. It passes `months=2` when the employee has an `end_date` (a resignation or termination: HR wants the month of departure and the month before it) and `months=1` otherwise, and the label says which — `Time sheet · 2 months` or `Time sheet · <month>`. Reuse `useEmployeeSheetDownload` from Task 7 rather than adding a second blob path.

**`EmployeeDetailPage` has no action surface of its own, and no desktop/mobile split** — no `isMobile`, no `DropdownMenu`, no `md:hidden`/`hidden md:` pair anywhere in the file. The actions are props handed to one child. Three concrete edits: extend the props interface at `frontend/src/pages/employees/EmployeeIdCard.tsx:40-45` with `onTimesheet`, add the button to the single row at `EmployeeIdCard.tsx:203-223` beside `onGenerate` / `onAddLeave` / `onEdit`, and wire the handler at the call site `EmployeeDetailPage.tsx:247-262`. The card is one responsive flex row inside a sidebar that stacks below `md` (`EmployeeDetailPage.tsx:244-246`), so a single addition covers both viewports — verify at both widths. (`AGENTS.md:44` says record actions *often* have desktop and mobile surfaces; on this page they do not.)

- [ ] **Step 2: Build the designation catalog panel**

A Settings panel listing the 16 designations in rank order with drag-to-reorder, calling `PUT /timesheet/designations/order` with the full id list on drop. Show `name_en`, `name_ar` and the `main`/`drivers` badge.

`SettingsPage.tsx` registers a panel in **four** places, and gates by capability with a spread ternary, not a wrapper component: (1) add `'designations'` to the `SettingsPanelId` union at `:684-696`; (2) add the metadata entry to `panels: Record<SettingsPanelId, SettingsPanelItem>` at `:736-795`; (3) add it to the right category at `:797-837` as `...(has('timesheet.edit') ? [panels.designations] : [])` — the idiom at `:805-808`; (4) add the `case 'designations':` arm to `renderSelectedPanel` at `:862`. `has` comes from `useCapabilities()` (`:715`). Use the spread form, **not** `<CapabilityGate>` — that component is reserved for inline elements here (`:573-586`), and the empty-category filter at `:837` plus the hidden-panel fallback at `:839-842` only work with the spread.

- [ ] **Step 3: Typecheck and smoke it**

```powershell
pnpm -C frontend exec tsc -b --noEmit
```

Then open an employee record and Settings in the running app; confirm a departed employee's download returns a two-sheet workbook, an active employee's returns one, and that a drag persists after reload.

- [ ] **Step 4: Sync types and commit**

Use the `sync-api-types` skill, then commit every touched file (never `backend/openapi.json`) with `feat(timesheet): per-employee sheet and designation rank ordering`.

---

### Task 11: Verification and reviews

**Files:** none created.

- [ ] **Step 1: Full backend suite**

Run: `venv\Scripts\python.exe -m pytest -q`
Expected: only the pre-existing failures named in Global Constraints — two confirmed (`test_config_openwa`, `test_migration_record_included_papers`), plus `test_dav` only if it turns out to be order-dependent, since it passes in isolation.

- [ ] **Step 2: Lint and types**

```powershell
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
```

Expected: ruff reports only the 22 pre-existing errors in the 8 files named in Global Constraints, and none in timesheet files; `ruff format --check` clean; mypy reports only the 30 pre-existing errors.

- [ ] **Step 3: One Alembic head**

Run: `venv\Scripts\alembic.exe heads`
Expected: exactly one head, `0075_timesheet_start_acks`. **(Corrected 2026-08-21, post-merge review: main took `0071`-`0073` while this branch was in flight, so renumbering avoids duplicate file numbers.)**

- [ ] **Step 4: Frontend checks, one at a time**

```powershell
pnpm -C frontend test
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run build
```

- [ ] **Step 5: Smoke test the real thing**

Start the app, open `/timesheet`, pick July 2026, and confirm:

1. **275 rows** on the main sheet, **2** on drivers, leave cells tinted with the workbook's own colours.
2. **The page does not scroll.** Only the grid does, and the dock stays in view at 1920, 1440 and 1280 wide. This is the locked shell's whole promise — if the page scrolls, the task is not done.
3. **Statistics view:** the implied post count sits a little **below** the configured 249 — it is `P days ÷ days in month` and roster edges (`NG`, `-`, `X`) subtract, so June's reference figure is 7,351 ÷ 30 = 245.0. A reading *above* 249 is the drift the readout exists to expose.
4. **Drag to fill:** arm `AL`, sweep four rows by six days, release — 24 cells change in one gesture and one toast; `Escape` mid-drag changes nothing.
5. **Row counts:** hover a row and a focused cell; the counts match that row and the box follows the row through the scroll.
6. **Search:** `7141`, `g7141` and a partial name all find the same employee; `Enter` scrolls his row into view.
7. **A joiner:** find an employee whose `doj` is inside the month — his days before it are `NG`, the notice line counts him, and `Confirm starting point` changes no cell.
8. **A leaver:** step to the month after a departure — he is gone from both the attendance and the statistics roster, and the notice line says who was removed and why.
9. **The red block:** select a departing employee, set the billing start to 23, red block the earlier days, and confirm the blocked days stay `X` in the statistics view instead of turning into `P`.
10. **Freeze:** download the attendance sheet, confirm the month closes, the grid offers no edit affordance, and the two-step reopen restores it.

Then download both workbooks and open them in Excel. Check the logo is present, the header reads `For the Month of :JUL-2026`, the footer totals compute, the **19-row footer** carries `Not billed / X` above `Total Days`, the legend line ends with `X- Not billed`, no stray formatting sits below the footer, and the statistics sheet shows Arabic designations with the two-row gap before block 2. Download a departed employee's sheet and confirm it carries **two months**. Diff the downloaded attendance sheet against `E:\Al Watbha Shares\المالية\احصائية 2026\7-Jul\كشف حضور شهر يوليو.xlsx`. Expected differences, and only these: (a) the added legend entry and the `X` footer row; (b) **the logo** — July's hand file has zero images, ours has one, which is the bug the template exists to fix; (c) **the OFF, Resignation and Suspention footer totals**, because the renderer normalises June/July's off-by-one and cell-reference `COUNTIF` formulas (Task 4 render step 5). Anything else is a regression.

- [ ] **Step 6: Required reviews**

Run the `i18n-rtl-reviewer` on the new frontend surfaces — both directions, light and dark, at all three sheet zooms, and specifically at the dark `X` fill, whose values this plan derived rather than quoted from the spec. Run the `alembic-migration-reviewer` for `0071` and `0072`. Run the `requesting-code-review` skill on the frontend tasks, and point the reviewer at UI spec §14: the **ten** traps listed there are the ones this surface actually hit.

- [ ] **Step 7: Confirm the one client-visible change**

The template now carries an extra legend entry and an extra footer row for the red block. Show the operator a generated workbook and get HQ HR's acceptance **before** the first real send. If they refuse, the fallback is to keep the fill and drop the legend row — say so, do not silently ship an unexplained colour on an official document.

- [ ] **Step 8: Commit and hand back**

Commit any review fixes. Report the smoke-test result and the golden-test numbers. Do **not** deploy; the user decides when `mng deploy` runs.

---

## Deferred, by decision

- Mid-month "23" supplements (days 23–31 only). Discontinued after May; June and July have none.
- Multi-site support. Every 2026 file, including the `23` variants, is `JD 908` / `P0331_JD_PRN_908EXT`.
- PDF export. Excel COM works on this host but the chosen output is an xlsx download.
- Writing to the `E:` share.
- Changing `position` / `position_ar`, the leave lifecycle, or leave balances.
- Automatically reproducing the *initial* June/July block-2 filler shape. Fillers default to `AL`, the operator sets the shape once, and it then carries forward month to month.
- **Direction C's month canvas** (UI spec §12). The drift it was built to catch is already caught by the per-day headcount row and the implied-post readout, and at 275 rows the canvas needs virtualization. Revisit it if the roster ever spans multiple sites — comparing sites is what it is genuinely better at.
- **Creating an employee from the time sheet.** This page detects a date of joining inside the month, flags the starting point and links to the record; the create flow stays on the Employees page (UI spec §16.4). The mockup's inline *Add employee* is a demonstration of the trigger, not a specification.
- **Virtualizing the grid.** 806 buttons render fine; 8,525 (275 × 31) is the live figure and may not. Measure before reaching for `@tanstack/react-virtual`, and if it is needed, it is a task of its own — the drag-to-fill rectangle and the sticky identity columns both interact with it.
- **Undo beyond the last change.** One `Undo last change` per correction stack, not a history panel.
