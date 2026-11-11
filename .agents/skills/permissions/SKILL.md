---
name: "permissions"
description: "The one way to gate features by capability. Use when adding a feature, route, tab, button, or setting that only some users may use; when adding or changing a capability or role preset; or when changing who can see which records."
---

# /permissions — one way to gate a feature

Every feature answers one question per user: may they use it? The answer is a
capability, and the UI renders the feature only when the answer is yes. A
surface the user can see but not use is a defect, never a fallback: it is noise
in a product whose principles are *workflow before flourish* and *restraint
over decoration* (`PRODUCT.md`).

## The model

| Concern | Single source of truth |
| --- | --- |
| Capability catalog: id, domain, bilingual label and description, `sensitive`, `requestable` | `backend/app/core/permissions.py::CAPABILITIES` |
| Role presets | `ROLE_DEFAULTS` in the same file; startup seeding adds missing rows to `role_permissions` and never deletes |
| Effective set: role defaults + dynamic families − denies + grants; admin gets everything | `backend/app/services/perm_service.py::effective_caps` |
| Dynamic families: granted by default, deny-only, one toggle per item | `books.service.<service>` (create), `books.servicerecords.<service>` (see records), `books.category.<code>` (see records in one of the 15 record categories) |
| Record visibility: every axis must allow the record (AND), then confidentiality | `book_service.user_visibility_clause` (SQL) and `assert_record_type_visible` (Python mirror); change both together |
| Backend gate | `Depends(require_capability(id))`; `perm_service.has_capability` only when the required id depends on runtime state |
| Frontend gate | `useCapabilities().has(id)` in a component; `<RequireCapability cap>` on a route; `<CapabilityGate cap>` as a JSX wrapper |

Records: the 15 record categories (`backend/app/core/classifications.py`) are
the only category axis. Every record maps to exactly one through
`backend/app/core/record_categories.py`: classification code first, then its
service, then its old filing category. A stray record, stored in a legacy
category its service never files into, also answers to the `other` records
gate (`record_services`); one stored in a retired category (`1`/`2`/`12`,
imported ids) also answers to that category's mapped record category
(`record_gate_categories`).
Admins control visibility per service and per category; both stay. A new
service gets an entry in `SERVICE_RECORD_CATEGORY` (a test enforces that the
map is total).

## Visibility rule

- **Hidden** is the default. Without the capability, the tab, panel, section,
  menu entry, button, field, or quick action is not rendered: not disabled,
  not read-only, not locked behind a "request access" badge.
- **Read-only view** only when the user holds a separate view capability for
  the same data and reading it is useful on its own (the time sheet with
  `timesheet.view`, an employee's violations). Render it as text or a table,
  never as disabled or `readOnly` inputs, and hide every edit control.
  Configuration (templates, settings, reminders) has no read-only view.
- **Disabled** expresses state, not permission: Save waits for valid input,
  Revise needs the current version. A `disabled` or `readOnly` value computed
  from `has(...)` is a defect.
- **Deny card**: `RequireCapability` answers a typed or shared URL into a page
  the user cannot open, and is where they request access. A URL parameter
  pointing at a hidden tab or overlay falls back to the default view.

## Steps: adding a gated feature

1. **Choose the capability.** Reuse an existing atomic id when the action is
   the same risk decision; read the catalog first. Add a new id only for a new
   risk decision: `domain.action` (`view`, `create`, `edit`, `delete`,
   `manage`, `send`…), real Arabic and English label and description, and an
   explicit `sensitive` / `requestable` choice. One id is one decision, never
   a bundle. Done when the id exists once in `CAPABILITIES` or you named the
   existing id you reuse.
2. **Decide the presets.** Add the id to `_OPERATOR_CAPS`, `_MANAGER_EXTRA`, or
   neither (admin-only by default). Changing an existing preset, splitting an
   id, or moving records between categories needs a migration that preserves
   every user's access exactly (precedents: `0078_split_bundled_capabilities`,
   `0117_merge_legacy_record_categories`). Done when every role's access is
   stated.
3. **Enforce on the backend.** Every route that reads or writes the feature
   carries its gate; writes also authorize the target object, not just the
   route. Management-only data is read with the management capability. Done
   when `python backend/scripts/audit_capability_gates.py` shows no new
   authenticated-only route you did not intend.
4. **Gate every surface** by the visibility rule: desktop and mobile, tab
   lists, menus, settings panels, dashboard quick actions, deep links. Reach
   the capability through `useCapabilities().has` (or the gate components);
   when an id is used in more than one file, export one constant beside the
   feature's API module (e.g. `TEMPLATES_CAP` in `lib/messageTemplates.ts`).
   Domain helpers may combine `has()` results (`canSendForApproval`) but take
   `has` or its booleans as input. Done when no surface of the feature renders
   for a user without the id.
5. **Prove it.** Backend: the route answers 403 for a user denied the id and
   succeeds with it. Frontend: the surface is absent without the id, including
   when opened from its URL. `backend/tests/test_capability_references.py`
   fails on any checked capability id missing from the catalog.
6. **Record it.** If the enforcement shape changed (a new tier, a new runtime
   check), update `docs/permissions-enforcement.md`.

## Guardrails

- Authorize by capability, not role: `isAdmin`, `isManager`, and
  `role === …` decide identity, not permission. The fixed-scope
  `inmate_reporter` shell is the one role-driven surface.
- Capability checks use the hook and components above; new code adds no
  parallel hook, wrapper, or predicate.
- A new dynamic family, a new record-visibility axis, or a new role needs the
  user's approval first.
- Grants on `sensitive` ids come from the role only; per-user overrides cannot
  grant them.
