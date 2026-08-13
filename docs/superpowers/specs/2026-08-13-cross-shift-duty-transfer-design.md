# Cross-shift duty transfer — design

**Date:** 2026-08-13
**Area:** `backend/app/schemas/duty.py`, `backend/app/services/duty_service.py`, `backend/app/api/v1/duty.py`, `frontend/src/pages/dutyLocations/*`, `frontend/src/pages/employees/TransferEmployeeDialog.tsx`
**Builds on:** `2026-06-29-duty-transfer-official-letter-design.md`, `2026-06-29-duty-transfer-refinements-design.md` (both shipped)
**Mockup:** `docs/cross-shift-duty-transfer-mockup.html`

Terminology: the operator says *shift*; the data model says **duty unit** (`Employee.duty_unit`,
e.g. `السرية الأولى`). They are the same thing. This document uses *unit* for code and UI
strings, *shift* only when quoting the operator's framing.

## Problem

Two limits stop the Duty Locations service from expressing a real transfer round.

1. **Selection dies on navigation.** `DutyLocationsPage.selectUnit()` wipes the selection every
   time the operator clicks another unit in the rail — `setSelected(new Set()) // selection is
   scoped to a unit`. One transfer form can therefore only ever carry employees from one unit.
   The office moves people out of several units in one round.
2. **One destination per form.** `DutyTransferRequest` carries a single `to_unit`/`to_post` for
   the whole batch, so a swap (A: الأولى → الثانية while B: الثانية → الأولى) cannot be written as
   one letter. It has to be split into two books, which is not how the office files it.

The official copy already assumes the opposite. The letter intro (`duty_service._INTRO`) reads
*"تم نقل المذكورين بالجدول المرفق **إلى الجهات المبينة بجانب أسمائهم**"* and the cover email
(`basketEmail.transferEmailBody`) repeats it: the destinations are declared to be *per name*.
The table already has an `إلى` column per row. The single-destination request is the mismatch,
not the paperwork.

## Goal

One transfer letter may gather employees from any number of source units and send each one to
its own destination unit/post. The operator builds that selection by walking the rail, reviews
it in one place, and sets destinations row by row.

## Non-goals

- No effective date or reason: the letter says `إعتباراً من تاريخه`, unchanged.
- No change to the General Book pipeline, ref allocation (`12/1`), approval chain, or the cover
  email builder — all of them are already destination-agnostic.
- No DB migration. `employees.duty_unit` / `duty_post` are untouched.
- Selection is not persisted across reloads or across a route change (operator's call).
- The employee-profile transfer dialog keeps its single-destination form.

## Contract

`POST /api/v1/duty/transfer`. Clean cutover — `employee_ids`, `to_unit`, `to_post` are removed
with no compatibility shim, and every caller moves in the same change.

```python
# backend/app/schemas/duty.py
class DutyTransferMove(BaseModel):
    employee_id: str = Field(min_length=1, max_length=16)   # Employee.id is String(16)
    to_unit: str = Field(min_length=1, max_length=128)
    to_post: str | None = Field(default=None, max_length=128)


class DutyTransferRequest(BaseModel):
    # Bound the list so one transfer can't generate a runaway DOCX / DB write (API-02).
    moves: list[DutyTransferMove] = Field(min_length=1, max_length=500)
    recipient_id: int | None = None
    manager_id: int | None = None
    cc: list[str] | None = None
```

`DutyTransferResult` is unchanged (`book_id`, `ref`, `document_id`, `moved`).

## Backend

**`duty_service._build_body_html(rows: list[tuple[Employee, str, str | None]]) -> str`** —
each tuple is `(employee, to_unit, to_post)`. `من` still reads the employee's *current*
unit/post, so the caller must build the body before staging mutations; `إلى` is now
`_location_label(to_unit, to_post)` for that row. Intro, spacers, red header, closing lines,
column order, and `_SUBJECT` are untouched.

**`duty_service.transfer(db, *, moves: list[DutyTransferMove], recipient_id=None,
manager_id=None, cc=None, current_user=None)`** — taking the sub-model matches existing
service precedent (`book_service.create_book(db, payload)`,
`employee_service.update_employee(db, id, payload)`). Resolution order:

1. Empty `moves` → 422 `DUTY_NO_EMPLOYEES` (Pydantic guards the HTTP path; the check keeps
   direct service calls honest).
2. Per move: `to_unit = to_unit.strip()`; blank → 422 `DUTY_NO_UNIT`.
   `to_post = to_post.strip() or None`.
3. A repeated `employee_id` → 422 `DUTY_DUPLICATE_EMPLOYEE` (new). Two destinations for one
   person is ambiguous, and the old silent de-dup would now pick a destination for the
   operator. The UI cannot produce a duplicate — selection is a `Set`.
4. Unknown id → 422 `DUTY_EMPLOYEE_NOT_FOUND` (unchanged, still carries `id=`).

Request order is preserved as table row order. When **every** resolved employee is currently
unassigned (`not (duty_unit or "").strip()`) the existing no-book path still applies: each
employee is written to its own destination, `db.commit()`, and the result carries
`book_id=None`. Otherwise the body is built, the per-row mutations are staged on the same
session, and `document_service.generate_document(..., commit=True)` lands moves and book rows
in one commit — exactly as today.

`api/v1/duty.py` forwards `payload.moves`; the `documents.generate` capability gate is unchanged.

## Frontend — cross-unit selection

`DutyLocationsPage.selectUnit()` becomes `setActiveKey(key)` only. Nothing else about the
selection model changes: it is already a page-level `Set<string>` of employee ids resolved
against the full 500-row roster (`selectedEmployees`), so ticks survive a rail switch, the
search filter, and the post grouping the moment the reset is gone. Selection still clears on a
successful transfer and lives in memory only.

**`pages/dutyLocations/SelectionTray.tsx` (new)** takes over the sticky bar that the page
currently renders inline, so the page file stops growing:

```ts
interface SelectionTrayProps {
  employees: readonly EmployeeListItem[]   // the resolved selection, any number of units
  onRemove: (id: string) => void
  onClear: () => void
  onTransfer: () => void
}
```

- Collapsed: `bg-primary` bar, count + unit count (`5 محدد · وحدتان`), `Clear`, `Transfer
  selected →`. The count is a `button` toggling the panel, with `aria-expanded` and
  `aria-controls`.
- Expanded: a `bg-surface` panel above the bar, `max-h-[45vh]` scrollable, grouped by each
  employee's **current** unit via the existing `groupByUnit` helper (no new grouping code), the
  `UNASSIGNED` bucket labelled `dutyLocations.unassigned`. One row per employee:
  `G# · name · post · ✕`, `dir="auto"` on Arabic text, logical properties throughout.
- `Escape` collapses the panel. Removing the last employee empties the selection and the bar
  unmounts, so the panel needs no separate empty state.

## Frontend — per-row destinations

`TransferDialog` moves to a single-column layout inside `max-w-3xl`:

1. **Bulk row** — the existing `destUnit` / `destPost` comboboxes plus an **Apply to all**
   button that writes both values into every row. An explicit button, not a live-syncing
   default: live sync silently overwrites deliberate per-row edits, and the button still keeps
   the mass-move case at three interactions.
2. **Row list** — scrollable (`max-h-[40vh]`), one row per selected employee:
   `G# · name · current location  →  [unit ▾] [post ▾]`. Below `sm` the row stacks. Unit
   suggestions come from `unitOptions(allEmployees)`; each row's post suggestions come from
   `postsForUnit(allEmployees, row.unit)` for *that row's* chosen unit. Rows start empty — never
   prefilled from the current location, which would let a forgotten row submit a no-op move.
   Inputs carry per-row accessible names (`rowUnitAria` / `rowPostAria` with the employee name).
3. **Letter metadata** — recipient, signing manager, CC pickers, unchanged, plus the existing
   `loadTransferDefaults` / `saveTransferDefaults` behaviour.

Row state is `Record<employeeId, { unit: string; post: string }>`, seeded with **empty** strings
for every id in the `employees` prop. Editing a row's unit clears that row's post, because the
post suggestions belong to the previous unit. The state is local to the dialog, so cancelling and
reopening starts from blank destinations — same lifecycle as today's `toUnit`/`toPost`; the tray
still holds the people. Submit is disabled until every row has a non-blank unit; rows missing one
are marked and `dutyLocations.transfer.missingUnit` explains the block. `buildTransferRequest`
becomes:

```ts
buildTransferRequest(input: {
  moves: readonly { employeeId: string; toUnit: string; toPost: string }[]
  recipientId: number | null
  managerId: number | null
  cc: readonly string[]
}): DutyTransferRequest
```

trimming each `toUnit`, mapping a blank `toPost` to `null`, and keeping the `cc` empty→`null`
rule. `TransferEmployeeDialog` (employee profile) keeps its single unit/post form and sends a
one-move list through the same builder.

## i18n

New keys in both `en.json` and `ar.json`; Arabic entries use the
`_zero/_one/_two/_few/_many/_other` plural forms already used by `dutyLocations.selection.count`.

| Key | English | Arabic |
| --- | --- | --- |
| `dutyLocations.selection.units_*` | `1 unit` / `{{count}} units` | `وحدة واحدة` / `وحدتان` / `{{count}} وحدات` |
| `dutyLocations.selection.trayTitle` | `Selected employees` | `الموظفون المحددون` |
| `dutyLocations.selection.trayToggle` | `Show or hide the selected list` | `عرض أو إخفاء قائمة المحددين` |
| `dutyLocations.selection.remove` | `Remove {{name}} from the selection` | `إزالة {{name}} من التحديد` |
| `dutyLocations.transfer.bulkLabel` | `Same destination for everyone` | `وجهة واحدة للجميع` |
| `dutyLocations.transfer.applyToAll` | `Apply to all` | `تطبيق على الجميع` |
| `dutyLocations.transfer.rowFrom` | `From` | `من` |
| `dutyLocations.transfer.rowTo` | `To` | `إلى` |
| `dutyLocations.transfer.rowUnitAria` | `Destination unit for {{name}}` | `الوحدة الجديدة لـ {{name}}` |
| `dutyLocations.transfer.rowPostAria` | `Destination post for {{name}}` | `النقطة الجديدة لـ {{name}}` |
| `dutyLocations.transfer.missingUnit` | `Choose a destination unit for every employee.` | `اختر وحدة جديدة لكل موظف.` |

`dutyLocations.transfer.destUnit` / `destPost` are kept — they now label the bulk row and still
label the employee-profile dialog.

## Testing

**Backend** (`backend/tests/test_duty_transfer_body.py`, `test_duty_transfer_service.py` — both
exist, calls updated to the new signatures):

- Two employees with different destinations render different `إلى` cells, each beside the right
  `من` (the swap case).
- A mixed selection leaves each employee on its own `duty_unit`/`duty_post`.
- A duplicate `employee_id` raises `ValidationFailedError` (`DUTY_DUPLICATE_EMPLOYEE`) and
  writes nothing.
- All-unassigned selection with distinct destinations: no `generate_document` call,
  `book_id is None`, each employee placed individually.
- Existing coverage retained: blank unit, unknown id, mixed selection takes the book path,
  recipient/manager/CC forwarding, spacers around the table.

**Frontend:**

- `DutyLocationsPage` (new test): tick an employee in unit A, click unit B in the rail, the bar
  still reports the selection and ticking in B raises the count; the tray lists both under
  their current-unit headings; `✕` drops one.
- `TransferDialog` (new test file): *Apply to all* fills every row; a per-row edit afterwards
  survives; submit stays disabled while any row lacks a unit; the posted payload carries one
  move per employee with distinct destinations.
- `transferRequest.test.ts`: new shape, trimming, blank post → `null`, empty cc → `null`.
- `TransferEmployeeDialog.test.tsx`: payload is `{ moves: [{ employee_id, to_unit }] }`; the
  unchecked-checkbox path still PATCHes.

## Verification

Implementation runs in a git worktree, not this live checkout (AGENTS.md). Narrow checks only:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_duty_transfer_body.py backend/tests/test_duty_transfer_service.py -v
venv\Scripts\ruff.exe check backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py
venv\Scripts\ruff.exe format --check backend/app/schemas/duty.py backend/app/services/duty_service.py backend/app/api/v1/duty.py
venv\Scripts\mypy.exe
pnpm -C frontend exec vitest run src/pages/dutyLocations src/pages/employees/TransferEmployeeDialog.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

Then the `sync-api-types` skill to regenerate `backend/openapi.json` + `frontend/src/lib/api.types.ts`,
and the `i18n-rtl-reviewer` for the new strings and the reflowed dialog in both directions.
Smoke test is a **UI dry run**: drive the real page in a browser — select across units, expand
the tray, remove a row, open the dialog, apply-to-all, override one row, confirm the submit gate
— then cancel. No book is minted and no employee is moved. The letter and move paths are proven
by the pytest cases. `notification-template-reviewer` and `alembic-migration-reviewer` do not
apply: no message formatting and no schema change.

## Files

**Backend:** `app/schemas/duty.py`, `app/services/duty_service.py`, `app/api/v1/duty.py`,
`openapi.json`, `tests/test_duty_transfer_body.py`, `tests/test_duty_transfer_service.py`.

**Frontend:** `lib/api.ts`, `lib/api.types.ts` (generated),
`pages/dutyLocations/{DutyLocationsPage,TransferDialog,transferRequest}.*`,
`pages/dutyLocations/SelectionTray.tsx` (new), `pages/dutyLocations/TransferDialog.test.tsx` (new),
`pages/dutyLocations/DutyLocationsPage.crossShift.test.tsx` (new),
`pages/employees/TransferEmployeeDialog.{tsx,test.tsx}`, `locales/{en,ar}.json`.
