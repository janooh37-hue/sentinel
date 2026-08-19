# Monthly Time Sheet & Client Statistics — design

Date: 2026-08-19
Status: approved (design), pending implementation plan

## Problem

The monthly attendance grid for site JD 908 is maintained by hand in Excel. Two
workbooks are produced per month and both are re-keyed from scratch:

- `كشف حضور شهر <شهر>.xlsx` — the attendance sheet sent to HQ HR.
- `الاحصائية شهر <شهر>.xlsx` — the statistics sheet sent to the client.

Every code on those grids except one already lives in this database. Annual
leave, sick leave and national service come from `leaves`; joining dates and
departures come from `employees.doj` / `employees.end_date`. Only **absence**
has no source.

Measured against the DB, the July 2026 attendance sheet already reproduces at
253 of 275 employees on annual + sick leave without any changes at all. With the
history fixes in this spec it reproduces at **8,525 of 8,525 cells** (see
"History import").

## Deliverables

1. **Attendance sheet** — all staff except drivers, English designations, real codes.
2. **Client statistics** — same roster, Arabic designations, two-block presence
   layout (see "The statistics two-block layout").
3. **Drivers attendance sheet** — the same template, drivers only.
4. **Single-employee sheet** — the same template with one data row, for the HR
   handover on termination or resignation.

## Measured facts about the existing workbooks

These are read off the June and July 2026 files and are binding on the renderer.

### Layout

| Region | Content |
| --- | --- |
| `A1:C4` | merged, holds a 481×217 px PNG logo |
| `D1:AH1` | `Global Security Service Group- MONTHLY  TIME SHEET`, Calibri 22 bold |
| `D2:P2` / `Q2:AH2` | `Client : JUDICIAL DEPARTMENT` / ` Site Name :   JD 908` |
| `D3:P3` / `Q3:AH3` | `Clent Code : P0331_JD_PRN_908EXT` / `GSSG-HR` |
| `D4:AH4` | `For the Month of :<MON>-<YYYY>` — the only header cell that varies |
| `AJ1:AK4` / `AL1:AP4` | `Date Of Issued` / `Issue No` / `\nRévision` labels, values left empty |
| row 5 | `# · ID · Name · Nat · Desigantion · 1..31 · Total day · Off · AB · AL · SL␣ · TR` |
| rows 6.. | one row per employee, columns `F..AJ` = days 1..31 |
| `AK..AP` | `COUNTIF` totals per row (see below) |

Header text is fixed; the issue/revision boxes stay empty. The misspellings
(`Desigantion`, `Clent Code`, `Prepard By`, `Verfied By`, `Abcent`, `Suspention`,
`New Gard`) are reproduced verbatim — these sheets are already in circulation.

Column widths: `A` 6.29, `B` 12.29, `C` 69.43, `D` 15.43, `E` 39.71, day columns
6.29, `AK` 12.29, `AL` 5.86, `AM` 5.14, `AN` 5.29. Row heights: row 1 29.25,
rows 2–4 27.0, rows 5+ 27.95. Sheet zoom 70. Paper A4 portrait, margins
0.7/0.7/0.75/0.75.

Per-row formulas, where `N` is the row:

```
AK  =COUNTIF(F{N}:AJ{N},"P")     AL  =COUNTIF(F{N}:AJ{N},"OFF")
AM  =COUNTIF(F{N}:AJ{N},"AB")    AN  =COUNTIF(F{N}:AK{N},"AL")
AO  =COUNTIF(F{N}:AJ{N},$AO$5)   AP  =COUNTIF(F{N}:AJ{N},"TR")
```

`AN` deliberately spans `F..AK`, and `AO` matches `$AO$5` whose value is `"SL "`
with a trailing space. Both quirks are preserved so the numbers match the
sheets already sent.

Footer, anchored to the last data row `L`:

| Row | Content |
| --- | --- |
| `L+1` | merged `A:AP` — `Legend: P- Working day, AB- Absence, AL- Vacation, SL-SickLeave , O - OFF - TR training ` |
| `L+2` | `A:M` `Prepard By`, `N:AC` `Verfied By `, `AD:AP` `Approved By ` |
| `L+3` | `AK..AP` = `SUM(<col>6:<col>{L})` |
| `L+4 .. L+6` | blank |
| `L+7` | `A:B` `S.no`, `C` `STATE`, `D` `CODE` |
| `L+8 .. L+17` | `A:B` merged `Total `; ten rows: Sick Leave/`SL `, Annual Leave/`AL`, Abcent/`AB`, National Service/`TR`, New Gard/`NG`, Termination/`-`, Resignation/`R`, Suspention/`S `, P/`P`, OFF/`OFF` |
| `L+18` | `A:D` merged `Total Days`, `E` = `SUM(E{L+8}:E{L+17})` |

`E` on the ten code rows points at the `L+3` totals (`=AO{L+3}` etc.) except
`NG`, `-`, `R` and `S`, which are `COUNTIF` over the whole grid.

### Codes

| Code | Meaning | Conditional-format fill | Font |
| --- | --- | --- | --- |
| `P` | present | none | default |
| `AL` | annual leave | `#BDD7EE` | default |
| `SL ` | sick leave | `#C6E0B4` | default |
| `AB` | absence | `#FFC7CE` | `#9C0006` |
| `TR` | national service | `#CC99FF` | default |
| `NS` | (legacy alias of TR) | `#CC99FF` | default |
| `NG` | not yet joined | `#FF9900` | default |
| `R` | resignation | `#333399` | white |
| `S ` | suspension | `#800000` | white |
| `T` | termination | `#990033` | white |
| `-` | off roster after departure | none | default |
| `OFF` | weekly off | none | default |

`OFF` is never used — these are 7-day posts. `R`, `S` and `T` are in the legend
but unused in 2026; departures are written as `-`. The renderer emits only
`P`, `AL`, `SL `, `AB`, `TR`, `NG` and `-`.

The day-31 column stays **empty** in 30-day months (verified: June has exactly
one blank per row, in `AJ`).

### The statistics two-block layout

| Month | Block 1 | Gap | Block 2 | Total |
| --- | --- | --- | --- | --- |
| Mar | 250 | 2 rows | 25 | 275 |
| Apr | 249 | 2 rows | 23 | 272 |
| May | 249 | 2 rows | 33 | 282 |
| Jun | 249 | 2 rows | 33 | 282 |
| Jul | 249 | 2 rows | 26 | 275 |

Block 1 is the first *N* rows in sort order, where *N* is the contracted post
count, and is forced to `P` — only `NG` and `-` survive. June proves it: 502
`AL`, 152 `SL`, 74 `TR` and 10 `AB` cells in the attendance sheet are all `P` in
the statistics. The rationale is contractual: the client is billed for a manned
post, and a guard on leave is covered by a replacement.

Block 2 is the surplus headcount, placed after two blank rows and given filler
codes so it does not inflate the client's presence total. The filler is not
fact — June's G4686 is `SL`×30 in the statistics and `P`×30 in the attendance
sheet. Observed shape in both months: a first group of `SL`, a bulk of `AL`, a
trailing group of `TR`, some rows left `P`. `NG`, `-` and genuine `AB` are
preserved inside block 2.

Column `A` numbers run continuously `1..N` straight across the gap.

June closes exactly: 249 posts × 30 days − 119 departure days = 7,351 `P`, which
is the whole statistics `P` tally. July overshoots by 59 `P` days because two
block-2 rows were left as `P` by hand. The app surfaces the implied post count
so that drift is visible before the file is sent (see "Statistics generation").

## Decisions

| Question | Decision |
| --- | --- |
| Absence source | Grid overrides plus real `Absence` records |
| Absence vs a later sick leave | leave wins, the absence row is deleted |
| Designation storage | dedicated fields, `position` / `position_ar` untouched |
| Row order | strict rank grouping, then employee ID; rank order reorderable in the app |
| Output | download from the app; no writes to the E: share |
| Template | one sanitized xlsx in the repo, filled per month |
| Roster | anyone employed ≥ 1 day in the month |
| Reprint fidelity | freeze on first download, explicit reopen |
| National service | from `National Service` leave records |
| Drivers | separate file, same template |
| Header block | fixed text; issue / revision boxes stay empty |
| Post count | a per-month value, confirmed before the statistics download |
| Block-2 filler | reproduce the June/July shape, editable per row |
| Block 1 | always `P` apart from `NG` / `-` |
| Single-employee sheet | same template, one data row |
| History | import into the DB after review (see "History import") |

## Data model

Migration `0070_timesheet` (SQLite, `batch_alter_table`, one head — current head
is `0069_merge`).

**`timesheet_designations`** — the designation catalog.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int pk | |
| `name_en` | `String(128)` | e.g. `Control room Security Guard` |
| `name_ar` | `String(128)` | e.g. `حارس امن عرفة العمليات` |
| `rank_order` | int, unique | 1 = highest; drives the sort |
| `sheet` | `String(16)` | `main` or `drivers` |
| `active` | bool | |

Seeded with the 16 designations recovered from the July pair (§ Appendix A).

**`employees.designation_id`** — nullable FK to `timesheet_designations`.
Backfilled for all 275 employees present in the July sheets. `position` and
`position_ar` keep their current meaning as the HR title.

**`absences`** — one row per absent day.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int pk | |
| `employee_id` | FK employees | |
| `date` | Date | unique with `employee_id` |
| `note` | Text, null | |
| `created_by` | int, null | user id |
| `created_at` | DateTime | |

**`timesheet_overrides`** — the escape hatch for a day the DB gets wrong.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int pk | |
| `year`, `month`, `day` | int | |
| `employee_id` | FK employees | unique with year/month/day |
| `code` | `String(4)` | one of the emitted codes |
| `note` | Text, null | |
| `created_by` | int, null | |

**`timesheet_periods`** — one row per month.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int pk | |
| `year`, `month` | int | unique together |
| `post_count` | int | contracted posts for the statistics split |
| `closed_at`, `closed_by` | DateTime / int, null | set on first download |
| `reopened_at`, `reopened_by` | DateTime / int, null | last reopen |

**`timesheet_snapshot_rows`** — the frozen grid, written at close.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int pk | |
| `period_id` | FK timesheet_periods | |
| `employee_id` | `String(16)` | not an FK — survives employee deletion |
| `row_no` | int | printed `#` |
| `name_en`, `nationality_en` | String | resolved at close |
| `designation_en`, `designation_ar`, `rank_order` | String / int | resolved at close |
| `sheet` | `String(16)` | `main` or `drivers` |
| `codes` | JSON | list of 31 code strings, `null` past month end |
| `stat_codes` | JSON | the statistics variant of the same row |
| `stat_block` | int | 1 or 2 |

Snapshotting the resolved names and designations is deliberate: renaming a
designation next year must not alter a sheet the client already holds.

## Day-code engine

`timesheet_service.build_month(year, month, sheet) -> MonthGrid`

Precedence, low to high: `P` → `AL` → `TR` → `SL` → `AB` → `NG` / `-` →
override. Roster edges outrank leave; a manual override outranks everything.

Leave sources, from `leaves` where `deleted_at IS NULL` and `status` does not
start with `Cancelled` or `Rejected`:

| Code | `leave_type` (English part) |
| --- | --- |
| `AL` | `Annual Leave` |
| `SL ` | `Sick Leave` |
| `TR` | `National Service` |

Treated as present, verified against the July sheet: `Administrative Leave`,
`Leave Permit`, `Duty Leave`, `Passport Release`, `Duty Resumption`, `Others`.

Leave days are resolved as a **per-day union, never a sum**. This is required,
not cosmetic: G3006 has three overlapping annual-leave rows that add up to 64
days inside a 31-day July, and the union yields the correct 26.

Roster edges:

- `NG` for every day before `doj`.
- `-` for every day after `end_date`, so the last working day *is* `end_date`.
  The hand files are inconsistent by ±1 (`-` starts on `end_date` for G3636 and
  G4532, the day after for G3105, G3804 and G4011). One rule replaces both.

Nationality is mapped Arabic → English for column `D` (`الإمارات`/`الامارات` →
`U.A.E`, `سلطنة عُمان`/`سلطنة عمان`/`عمان` → `Oman`, and so on for Nepal, Sudan,
Jordan, Yemen, Comoros, Mauritania, Egypt, Syria, Morocco). An unmapped
nationality blocks the download.

## Roster

Included when `doj <= month_end AND (end_date IS NULL OR end_date >= month_start)`,
filtered by `designation.sheet`. Employees departed during the month keep their
worked days and drop off automatically the following month, which is the
requirement behind the single-employee handover sheet.

Sort: `rank_order`, then the numeric part of the employee ID.

## Statistics generation

From the same `MonthGrid`:

1. Split at `period.post_count` in sort order.
2. Block 1: every cell becomes `P` except `NG` and `-`.
3. Block 2: every cell becomes its assigned filler code except `NG`, `-` and
   real `AB`. Filler defaults carry forward from the previous month for
   employees who were in block 2 then, and default to `AL` for new members.
   Editable per row before download.
4. Column `E` renders `designation_ar`; column `A` numbers continuously across
   the two blank rows.
5. The page shows total `P` days and the implied post count
   (`P days ÷ days in month`) so a drift like July's +59 is visible.

## Template and renderer

`backend/templates/GSSG-HR_Monthly_Time_Sheet.xlsx`, produced once by
sanitizing the June attendance sheet — the June and both statistics files still
carry the logo, the July attendance file lost it to an outside tool. The
template holds rows 1–5, one fully styled specimen data row, and the footer
block parked below.

`openpyxl` round-trip was verified on the June file: the logo, all 4
conditional-format ranges, 3 data validations, 22 merges, 12 column widths, the
freeze pane, the theme and every font survive `load_workbook` → `save`. No
Excel COM anywhere, so no interactive-user constraint on this path. `openpyxl`
is already installed but undeclared and must be added to `requirements.txt`.

Renderer steps: stamp `D4`; copy the specimen row's style index into rows
`6..5+N`; write values and per-row formulas; write the footer at `5+N+1`
with its merges; re-register the conditional formats and the code validation
over the real extent; blank the day-31 column in short months.

Filenames: `كشف حضور شهر <شهر>.xlsx`, `الاحصائية شهر <شهر>.xlsx`,
`كشف حضور شهر <شهر> للسائقين.xlsx`, and
`كشف حضور <الاسم> <شهر>.xlsx` for one employee. Arabic month names:
يناير، فبراير، مارس، أبريل، مايو، يونيو، يوليو، أغسطس، سبتمبر، أكتوبر، نوفمبر، ديسمبر.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/timesheet/{year}/{month}` | grid, totals, preflight, closed state; `?sheet=main\|drivers` |
| `PUT` | `/api/v1/timesheet/{year}/{month}/cell` | set or clear one cell |
| `PATCH` | `/api/v1/timesheet/{year}/{month}` | post count, block-2 filler assignments |
| `POST` | `/api/v1/timesheet/{year}/{month}/close` | freeze |
| `POST` | `/api/v1/timesheet/{year}/{month}/reopen` | unfreeze, audited |
| `GET` | `/api/v1/timesheet/{year}/{month}/export` | xlsx; `?variant=attendance\|statistics`, `?sheet=` |
| `GET` | `/api/v1/timesheet/employee/{id}/{year}/{month}/export` | one-row xlsx |

`PUT .../cell` with code `AB` creates an `absences` row; any other code creates
a `timesheet_overrides` row; clearing removes whichever exists. Creating a leave
that covers an absence day deletes that absence row, inside the existing
leave-create path.

New capabilities `timesheet.view` and `timesheet.edit` (edit covers cell
changes, post count, close and reopen). Operator gets view; manager and admin
get both.

## Frontend

Route `/timesheet`, lazy-loaded like every other page, guarded by
`timesheet.view`.

- Month picker, `main` / `drivers` toggle, attendance / statistics toggle.
- Preflight banner: blocking errors and warnings, each linking to the employee.
- The 31-column grid, virtualized, cells tinted with the workbook's own colours.
  Clicking a cell opens a code picker; `AB` prompts for an optional note.
- Statistics view: the two blocks with the gap drawn, the post-count field, and
  the implied-post-count readout.
- Download buttons; the first download closes the month and the grid locks with
  a reopen action for `timesheet.edit`.
- Employee record: a "Time sheet this month" download.
- Designation catalog in Settings, drag to reorder ranks.

Arabic and English are peers throughout; logical CSS properties only; the
`i18n-rtl-reviewer` runs after the UI lands.

## Preflight

Blocking:

- an employee in the roster with no `designation_id`
- a nationality with no English mapping

Warning:

- `leave_type = 'Unknown'` overlapping the month
- overlapping same-type leave rows (the union is already applied)
- `end_date` in the past while `status` is still `Active`
- an employee with no `doj`
- duplicate employee records with the same name

## History import

A reviewed one-off script, run before the feature is built, so the engine is
known to reproduce both reference months. It re-derives every proposal from the
sheets in `E:\Al Watbha Shares\المالية\احصائية 2026\` at run time, prints the
plan, and writes nothing until confirmed.

Derivation: load the eight 2026 attendance sheets (Jan–Aug), build a continuous
day → code series per employee, and take maximal runs per code. Runs are
therefore correctly bounded even when a leave crosses a month edge.

Planned writes:

| Change | Count |
| --- | --- |
| create `Annual Leave` records | 41 |
| create `Sick Leave` records | 27 |
| create `National Service` records | 10 |
| leave days created, total | 992 |
| create absence records | 8 runs / 27 days |
| correct existing leave rows | 3 |
| retype `Unknown` → `Annual Leave` | 6 |
| delete `Unknown` duplicates | 2 |
| employee record fixes | 2 |

The three corrections, each contradicted by the sheets:

| Employee | In the DB | Corrected to |
| --- | --- | --- |
| G3101 | two `Unknown` rows, `06-17..06-30` and `06-17..07-04` | one `Annual Leave` `06-19..06-30` |
| G3190 | `Sick Leave` `06-19..06-22` | `Sick Leave` `06-19..06-19` |
| G3209 | `Unknown` `07-01..07-30` | `Annual Leave` `07-01..07-26` |

The two employee fixes:

- **G4537** — `end_date` is `2025-09-01`, a year out; the June sheet shows him
  leaving on the 17th. Corrected to `2026-06-17`.
- **`5704` / `G5704`** — the same person twice (identical `name_en`, `name_ar`,
  `doj`, `nationality`; no leaves on either). `5704` carries the resignation,
  `G5704` carries the duty unit and is the ID the sheets use. Merge into
  `G5704` with `status = Resigned`, `end_date = 2026-08-09`; delete `5704`.
  Without this the August sheet lists him twice.

The two `Unknown` deletions are redundant: G3006 `07-06..07-17` is subsumed by a
typed annual leave `07-06..07-31`, and G3202 `07-13..08-07` is an exact
duplicate of a typed row.

## Acceptance

The gate is reproduction, not coverage.

1. **July 2026 attendance, 0 differing cells of 8,525.** Already achieved by the
   engine described here with the History-import writes applied in memory. Roster
   differs only by G5566 and G5567, the two drivers, which belong in the drivers file.
2. **June 2026 attendance, ≥ 99.4%.** 49 cells across 6 employees remain and all
   are departure-edge errors in the hand file: G3808 is listed as present for
   all 30 days despite resigning on 2026-04-02, G4053 for 13 days past his
   `end_date`, and G0984, G3699, G4532, G3636 are off by a day or two. The
   engine's single rule is correct in each case; these differences are expected
   and must not be "fixed" by weakening the rule.
3. **Formatting** — generated workbook compared to the reference for merges,
   column widths, row heights, fonts, fills, conditional formats, formulas and
   the presence of the logo.
4. **Statistics** — block sizes, the two-row gap, continuous `A` numbering, block
   1 all `P` apart from roster edges, and the implied post count landing on the
   configured value.
5. Unit tests for code precedence, the per-day union, roster edges, 28/30/31-day
   months, the rank sort, and absence deletion on leave create.

## Non-goals

- The mid-month "23" supplements (`كشف حضور شهر مارس23-.xlsx` and siblings, days
  23–31 only) are a discontinued practice; June and July have none. Not built.
- Multi-site support. Every 2026 file, including the `23` variants, is
  `JD 908` / `P0331_JD_PRN_908EXT`.
- PDF export. Excel COM works on this host but the chosen output is an xlsx
  download.
- Writing to the `E:` share.
- Changing `position` / `position_ar`, the leave lifecycle, or leave balances.

## Risks

- The August draft on the share (`8-Aug\كشف حضور شهر اغسطس_backup_...xlsx`) has
  also lost its logo. The first generated August file replaces it.
- `timesheet_snapshot_rows` grows by roughly 300 rows per month. Negligible.
- Reopening a closed month after the client has the file: the reopen is audited
  and the UI states that a re-download supersedes what was sent.

## Appendix A — designation catalog seed

| Rank | English | Arabic | Count in July | Sheet |
| --- | --- | --- | --- | --- |
| 1 | Prisons Director | مدير عام الحراسات الأمنية | 1 | main |
| 2 | Ass. Director | نائب عام مدير الحراسات الأمنية | 1 | main |
| 3 | Project Manager | مديرمركز الإصلاح والتأهيل | 1 | main |
| 4 | Branche Manager | مدير فرع | 4 | main |
| 5 | Duty In charge | مناوب عام | 4 | main |
| 6 | Security Supervisor | مشرف | 7 | main |
| 7 | Armory Officer | مسؤول قطعة سلاح | 4 | main |
| 8 | assistant security supervisor | مساعد مشرف | 20 | main |
| 9 | Armory Keeper | خازن سلاح | 4 | main |
| 10 | Control room Security Guard | حارس امن عرفة العمليات | 48 | main |
| 11 | Clinic Security Guard | حارس امن حرس العيادة | 8 | main |
| 12 | Habilitation Security Guard | حارس امن حرس التأهيل | 4 | main |
| 13 | Escort Security Guard | حارس امن تنويم مستشفيات | 10 | main |
| 14 | Messengers | حارس امن الارساليات | 40 | main |
| 15 | Security Guard | حارس امن | 119 | main |
| 16 | Driver | سائق | 2 | drivers |

Ranks 1–8 are lifted from the July statistics ordering. Ranks 9–15 are new —
July interleaves the guard tier by ID, so there was no existing order to copy.
The order is editable in the app.
