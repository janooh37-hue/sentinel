# Employee status & duty location management from the employee page

**Date:** 2026-07-03
**Status:** Approved

## Problem

There is no way to change an employee's status (Active / Resigned / Terminated) from the
frontend — the backend supports it, but no UI reaches it for an existing employee. Likewise,
the employee's duty location (`duty_unit` / `duty_post`) is visible and changeable only on the
Duty Locations page, not on the employee's own profile, where it is critical to see and change it.

Everything needed already exists in the backend; this is a frontend-only feature:

- `PATCH /api/v1/employees/{id}` (capability `employees.edit`) accepts `status`, `end_date`,
  `duty_unit`, `duty_post`. The service layer enforces: `end_date` required when status ≠ Active
  (`EMPLOYEE_INVALID_STATUS_END_DATE`).
- Canonical statuses: `Active`, `Resigned`, `Terminated`
  (`backend/app/schemas/employee.py` — `EMPLOYEE_STATUSES`).
- `POST /api/v1/duty/transfer` moves employees to a new duty unit/post AND generates the
  official Arabic transfer letter + General Book record + cover email in one transaction
  (`backend/app/services/duty_service.py::transfer`).
- `EmployeeForm` (frontend) already has the status dropdown + conditional end-date field with
  Zod validation, but is only reachable from create/intake flows.
- `EmployeeRead` already returns `duty_unit` / `duty_post`; `ProfileTab` just doesn't render them.

## Design

Three UI pieces, no backend changes.

### 1. Full edit — "Edit" button on the employee detail page

- An **Edit** button in the employee header (`EmployeeHero` / detail page header area),
  visible only when the current user has the `employees.edit` capability (same gate the API
  enforces; use the existing frontend capability check pattern).
- Opens the existing `EmployeeForm` in a dialog in **edit mode**, pre-filled from the loaded
  employee.
- Submit → `PATCH /employees/{id}` with the changed fields → invalidate/refetch the employee
  detail query → close.
- `duty_unit` / `duty_post` are deliberately **not** added to `EmployeeForm`: duty moves go
  through the dedicated Transfer control (piece 3) so they cannot happen silently.

### 2. Quick status shortcut in the hero

- The status pill in `EmployeeHero` becomes an edit affordance (pencil icon on hover for
  desktop, tappable on mobile), gated by `employees.edit`.
- Opens a compact dialog:
  - Status select — the three canonical statuses, labels via existing `employees.status.*` keys.
  - End-date picker — appears and is required when status ≠ Active (reuse the existing
    `endDateRequired` validation message/rule from `EmployeeForm`'s schema).
- Submit → `PATCH /employees/{id}` with `{ status, end_date }` → refetch → close.

### 3. Duty location on the Profile tab

- Two new rows in the `ProfileTab` info grid: **Duty unit** and **Duty post**
  (values from `employee.duty_unit` / `employee.duty_post`, em dash when unassigned).
- A **Transfer** button next to them (gated by the same capability the Duty Locations page
  uses for transfers).
- The Transfer dialog contains:
  - Unit picker + post picker, reusing the option sources of the Duty Locations page
    (`UnitRail` seed units + existing posts from the roster / `AssignPopover` pattern).
  - A checkbox **"Issue transfer letter"** — **checked by default**:
    - **Checked** → `POST /duty/transfer` with this one employee → official transfer letter,
      General Book record, cover email (identical to a transfer from the Duty Locations page).
    - **Unchecked** → direct `PATCH /employees/{id}` of `{ duty_unit, duty_post }` — no letter.
- After either path: refetch employee detail.
- Note: for a currently-unassigned employee the transfer endpoint already skips the letter
  (initial-placement path); the checkbox may remain visible — the backend behaves correctly
  either way.

## Cross-cutting

- **i18n:** every new string added to both `frontend/src/locales/en.json` and `ar.json`
  with key parity; run the `i18n-rtl-reviewer` agent on the diff. RTL layout must hold in
  the new dialogs.
- **Mobile:** all three dialogs must be usable on phone-width screens (app is a PWA used
  on mobile). Ensure ≥16px inputs (iOS zoom rule already applied elsewhere).
- **Errors:** surface backend `EMPLOYEE_INVALID_STATUS_END_DATE` and transfer errors via the
  existing toast/error pattern; client-side Zod validation mirrors the invariant so the error
  path is rare.
- **Testing:** frontend component tests following the existing pattern (form validation:
  end-date required when not Active; transfer dialog: endpoint choice follows the checkbox).
  No backend changes → no backend tests needed.
- **Workflow:** implement on a feature branch off `main`; user merges and deploys
  (`main` is the live checkout — never commit directly to it).

## Out of scope

- Any backend/schema/migration changes.
- Bulk status changes or bulk transfers from the employee list.
- Adding duty fields to the create form / intake flow.
- Changing how the Duty Locations page works.
