# Time Sheet Roster Editor Design

**Date:** 2026-08-22  
**Status:** Approved  
**Route:** `/employees/timesheet`

## Problem

The monthly Time Sheet currently derives each employee's printable designation from `employees.designation_id`. That makes a document-specific roster field part of the employee record and prevents an operator from arranging the Time Sheet directly.

The Time Sheet entry is also a separate strip below the Employee tabs, the page opens on the last completed month, checks open from the bottom, and code totals are visible only in the bottom dock. These choices make a monthly roster task slower and leave useful inline-end space unused on wide displays.

## Goals

1. Make **Time Sheet** the final Employee section tab, immediately after **Duty Locations**.
2. Render each tab in the active interface language only. English must not show Arabic companion labels such as `Attendance الحضور` or `Organization الهيكل التنظيمي`; Arabic mode renders the Arabic translations.
3. Open the Time Sheet page on the current calendar month.
4. Store Time Sheet designations and employee-to-designation assignments outside the employee profile.
5. Let an authorized operator enter roster edit mode and move employees between Time Sheet designations by drag and drop, with a keyboard-accessible designation picker.
6. Keep designation vacancies and unassigned employees visible through designation group headings and counts; do not change the organization tree.
7. Use the inline-end space for a hideable Time Sheet glance panel with **Cells by code** and **Checks** views.
8. Let code totals filter the roster, jump to the first matching employee, and navigate previous/next matches cyclically.
9. Preserve the existing bottom dock and upward-opening panel geometry. Any open bottom panel hides the side glance; closing it restores the prior side state.
10. Preserve the existing attendance-cell editing, statistics, downloads, checks, month closing, density, search, and workbook behavior unless this design explicitly changes it.

## Non-goals

- No organization-tree work or fixes.
- No change to an employee's HR position, duty post, supervisor, status, or profile fields.
- No new top-navigation item.
- No drag-and-drop dependency.
- No change to Time Sheet code meanings or workbook conditional-format colors.
- No redesign of the existing bottom dock or its upward panel host.
- No retroactive mutation of sealed Time Sheet snapshots.

## Information architecture

### Employee tabs

The Employee section order is:

1. Directory
2. Attendance
3. Organization
4. Duty Locations
5. Time Sheet

`Time Sheet` links to `/employees/timesheet`, is gated by `timesheet.view`, and is the active tab on that route. The separate `TimesheetEntry` strip on the Employee directory is removed.

Tab labels use one translation key each. English mode renders only English. Arabic mode renders only Arabic and follows the existing RTL tab order and logical spacing.

### Current-month entry

`TimesheetPage` initializes its page month from the current local calendar month. The existing `lastCompletedMonth()` helper remains unchanged for employee-card extracts, where “last completed month” is still the correct contract.

Changing month, workbook sheet, or attendance/statistics variant clears an active code filter. A sealed month remains readable and downloadable under the existing capability rules.

## Data model

### Designation catalog

`timesheet_designations` remains the bilingual printable catalog. Add a nullable, unique `system_key` for seeded rows. User-created rows have `system_key = NULL`.

Built-in seed rows are matched by `system_key`, not by editable labels or rank. Startup seeding inserts missing built-ins but never overwrites operator-edited English names, Arabic names, active state, sheet, or rank.

Operators with `timesheet.edit` can:

- create a designation with English name, Arabic name, and workbook sheet;
- rename an existing designation in both languages;
- retain the existing explicit rank-order editor.

Designation sheet is chosen at creation and is not changed by the rename flow. No delete or retire interaction is added; the existing `active` field continues to exclude inactive rows from new assignments while historical references remain intact.

### Effective-dated roster assignments

Create `timesheet_roster_assignments` with:

- `id` integer primary key;
- `employee_id` referencing `employees.id`;
- nullable `designation_id` referencing `timesheet_designations.id`;
- `effective_from` as the first day of a month;
- `assigned_at` timestamp;
- nullable `assigned_by` user id;
- a unique constraint on `(employee_id, effective_from)`.

A null `designation_id` is an explicit unassignment and overrides an older assignment. For a requested month, resolve the latest assignment whose `effective_from` is on or before that month's first day. The result carries forward until another assignment is written.

This is a Time Sheet relationship: `Employee` no longer has `designation_id`, and employee create/update/profile APIs do not expose it. The assignment table still references the employee id for integrity; it does not become an employee-profile field.

Migration backfill copies each existing non-null `employees.designation_id` into an assignment effective `2026-01-01`, then drops the employee column using `batch_alter_table`. Sealed snapshots remain authoritative for sealed months.

### Grid response

Add nullable `designation_id` to live `TimesheetRow` responses. Open-month rows receive the resolved catalog id. Sealed legacy rows may return null because roster editing is unavailable on sealed months and the snapshot's printed names and rank remain authoritative.

The roster engine resolves workbook sheet, printed designation names, and rank from the effective assignment rather than `Employee.designation_id`. Unassigned employees remain on the main roster and continue to raise the existing blocking check.

## API

All write routes require `timesheet.edit`; all read routes retain `timesheet.view`.

### Catalog

- `GET /timesheet/designations` — existing ordered catalog.
- `POST /timesheet/designations` — create `{ name_en, name_ar, sheet }`.
- `PATCH /timesheet/designations/{designation_id}` — rename `{ name_en, name_ar }`.
- `PUT /timesheet/designations/order` — existing full-order update.

Catalog writes return the updated designation row. Duplicate normalized names, invalid sheets, inactive targets, and missing ids use the existing structured API error envelope.

### Roster assignment

`PUT /timesheet/{year}/{month}/roster` accepts:

```json
{
  "assignments": [
    { "employee_id": "G7160", "designation_id": 5 },
    { "employee_id": "G7099", "designation_id": null }
  ]
}
```

The write is atomic. It rejects:

- invalid month/year;
- a sealed month;
- duplicate employee ids in one request;
- unknown employees;
- unknown or inactive designations.

Success returns `204 No Content`; the client invalidates the selected month and designation catalog queries. A failed batch changes nothing.

## Roster edit interaction

### Entering edit mode

An **Edit roster** button appears only when the operator has `timesheet.edit` and the selected month is open. Entering edit mode:

- switches to the attendance variant if statistics is active;
- clears the armed attendance brush and any code filter;
- protects attendance cells from editing until roster mode ends;
- shows a compact banner stating that changes affect the Time Sheet only;
- exposes row drag grips, designation drop bands, **Add designation**, **Save roster**, and **Cancel**.

### Draft and save

Moves are staged in a local assignment draft. The original React Query result remains the rollback baseline.

Dropping an employee on a designation:

1. updates the draft assignment;
2. moves the row under the target designation;
3. recomputes visible row numbers and designation counts;
4. animates the row from its previous rectangle to its new rectangle using the existing calm motion curve;
5. does not call the server.

**Save roster** sends changed assignments as one batch. On success, edit mode closes and the month refetches. On failure, edit mode and the draft remain visible and the server error is shown once. **Cancel** discards the draft without a request.

Only designations belonging to the displayed workbook sheet are drop targets. Moving an employee to the Drivers workbook is done while the Drivers sheet is selected.

### Keyboard and reduced motion

Each drag grip is a real button. Enter or Space opens a designation picker containing the same valid targets as drag and drop. Escape closes the picker or cancels the current drag. Focus returns to the grip after assignment.

Pointer drop uses a FLIP transform animation. `prefers-reduced-motion: reduce` applies the final layout immediately. Drop validity is communicated by text and outline, not color alone.

## Side glance

The sheet body becomes a two-column layout on wide displays:

- the existing grid scroll region;
- a 210px inline-end Time Sheet glance.

The glance has two tabs:

1. **Cells by code**
2. **Checks**, with the blocking count badge

It can collapse to a 36px rail and reopen without losing the active glance tab. At narrow widths it starts collapsed. Logical inline positioning mirrors the panel in RTL.

When any existing bottom-dock panel is open, the glance column collapses to zero and becomes non-interactive. Closing the dock panel restores the prior expanded/collapsed state and active glance tab.

## Cells by code and filter navigation

### Counts and colors

Compute code data once per month response and variant:

- cell count per code;
- ordered employee ids containing at least one cell with that code.

The side glance and bottom Codes panel consume the same computed index. Code badges render the existing `data-code` attribute so `P`, `AL`, `SL`, `AB`, `TR`, `NG`, `-`, and `X` use the exact existing light/dark conditional-format tokens. No duplicate hard-coded palette is introduced.

Codes with zero matching employees are visible but disabled.

### Filtering

Clicking a code in either the side glance or bottom Codes panel:

1. closes the bottom panel if necessary;
2. restores the side glance on **Cells by code**;
3. filters employee rows to employees containing the selected code;
4. keeps designation headings only when they contain a visible match;
5. leaves full-sheet footer/headcount calculations unchanged;
6. outlines matching cells with the existing focus/primary token;
7. scrolls to the first matching employee;
8. opens the filter navigation bar inside the sheet card.

The filter bar shows:

- code glyph and meaning;
- matching employee count;
- matching cell count;
- current employee id and name;
- `N of M` position;
- Previous, Next, and Clear controls.

Next after the last match wraps to the first. Previous from the first wraps to the last. Month, sheet, variant, roster-edit entry, and Clear remove the filter.

## Checks in the side glance

The top expanding checks tray is not used. Clicking the existing **Fix before download** or warning notice expands the side glance and selects **Checks**.

Each issue displays its level, employee id, translated kind, and server detail. When the employee exists in the displayed roster:

- clicking the employee id/name or **Show row** clears a code filter, scrolls to the row, selects it, and applies a short structural highlight;
- **View profile** is a separate link to `/employees/{id}`.

When an issue names someone who has no row in this workbook, **Show row** is omitted and **View profile** remains available. Joined/leaving rows keep their confirmation and row actions. Removed employees remain informational because no current row exists.

The Checks view scrolls within the glance. It does not cover the grid or change bottom-dock geometry.

## State and performance

`TimesheetPage` owns:

- roster edit draft;
- active glance tab and collapsed state;
- active code and cyclic match index;
- existing selected employee and dock panel state.

A pure code-index helper performs one `rows × days_in_month` pass per query result and variant. The side glance, bottom panel, filter bar, and grid reuse that result. Filtering changes rendered employee lines only; calculations that describe the full workbook continue to use the complete row collection.

Existing memoized grid rows must not receive fresh per-row callbacks on search or filter keystrokes. New callbacks are stable with `useCallback`, and derived sets/maps use `useMemo`.

## Accessibility and bilingual requirements

- WCAG AA remains the contract.
- All new controls are keyboard reachable with visible project focus rings.
- Side placement, collapse controls, arrows, and filter navigation use logical properties and mirror in RTL.
- English Employee tabs contain no Arabic companion spans. Arabic Employee tabs use only Arabic translations.
- Mixed Latin employee ids remain bidi-isolated.
- State never relies on color alone; code glyph, meaning, counts, position text, and outlines remain visible.
- Side and bottom surfaces use the same semantic code tokens in light and dark themes.
- Motion honors reduced-motion preferences.

## Failure and empty states

- A designation-catalog load failure leaves roster editing unavailable but does not block attendance editing.
- A batch-save failure preserves the draft and edit mode.
- A stale designation response triggers a catalog and month refetch after showing the structured error.
- An empty roster retains the existing empty-month state; the glance shows zero counts and disabled code buttons.
- If a filtered employee disappears after refetch, clamp to the next valid match; clear the filter when no matches remain.
- A check without a corresponding row never offers a misleading row-jump action.

## Verification contract

### Backend

- Migration upgrade/downgrade on SQLite, exact one Alembic head, and copied assignment counts.
- Effective assignment resolution before, at, and after a change month.
- Sealed snapshots unchanged after later roster moves or designation renames.
- Atomic assignment batch validation and capability enforcement.
- Catalog create/rename/order behavior and non-destructive startup seeding.
- Workbook grouping and employee extract sheet selection use Time Sheet assignments.

### Frontend

- Employee tab order, capability gates, active state, and language-pure labels.
- Current-month Time Sheet default without changing employee-card extract defaults.
- Roster draft move, save, cancel, keyboard picker, and reduced-motion path.
- One-pass code counts and ordered unique employee matches.
- Side and bottom code controls invoke the same filter.
- Previous/Next wrap in both directions and Clear restores every row/group.
- Checks switch the side tab; row jump and profile link remain separate.
- Any bottom panel hides and restores the side glance.

### Browser review

Verify the real page at the same desktop resolution in:

- English LTR, light and dark;
- Arabic RTL, light and dark;
- expanded and collapsed glance;
- open bottom panel;
- active code filter at first, middle, last, and wrapped positions;
- roster drag and keyboard assignment;
- reduced motion.

The organization tree is not part of this verification.
