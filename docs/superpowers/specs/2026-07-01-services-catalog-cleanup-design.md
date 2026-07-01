# Services Catalog Cleanup — Design

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## Problem

Two issues on the Services catalog (the document-generation surface in
`frontend/src/pages/application/ApplicationPage.tsx`, fed by the backend
`list_templates()`):

1. **Companion forms show as standalone services.** `Leave Undertaking`
   (تعهد إجازة) and `Resignation Declaration` (إقرار استقالة) are *companion*
   documents — they auto-generate alongside their primary form. Yet they also
   appear as their own gallery tiles and dashboard quick-actions, letting an
   operator create them detached from the primary they belong to. That is wrong:
   they should only ever exist as a companion of the primary page they attach to.

2. **Arabic service names carry a redundant "نموذج" ("form") prefix.** The tile
   names read "نموذج طلب إجازة", "نموذج مخالفة", etc. The prefix is noise; the
   name should be the service itself.

## Goals

- Companion forms are removed from every **standalone entry point** (gallery
  tiles, dashboard quick-actions, deep-links). Their **auto-generation with the
  primary is unchanged.**
- Arabic service names drop the leading "نموذج ". One special case:
  `نموذج استلام` (Acknowledgment Form) becomes `استلام المواد`, not just `استلام`.
- English names are untouched (they keep "Form").

## Non-goals

- No change to how/when companions are generated (`_COMPANION_RULES` stays).
- No change to English display names.
- No DOCX template edits.

## Background (current behavior)

- **Template registry:** `backend/app/core/constants.py::TEMPLATE_FILES` lists all
  templates. `backend/templates/_fields.json` holds each template's `name_en` /
  `name_ar` / fields. `_fields.json` is read-only in this repo (only
  `document_service.load_fields_meta()` reads it — no generator overwrites it), so
  editing `name_ar` there is authoritative.
- **Gallery** is fully data-driven: it renders whatever `api.listTemplates()`
  returns (`ApplicationPage.tsx`). No hard-coded tile list.
- **Companion generation:** `document_service._COMPANION_RULES` maps primary →
  companion: `Resignation Letter → Resignation Declaration` (always),
  `Leave Application Form → Leave Undertaking` (only when leave_type starts with
  "Annual"). The companion doc is emitted in the same generation call as the
  primary.
- **Quick-actions** are mirrored in three places that must stay in sync:
  - `frontend/src/lib/dashboardLayout.ts::QUICK_ACTION_IDS`
  - `frontend/src/lib/quickActions.ts::QUICK_ACTION_META` (+ i18n label/desc keys)
  - `backend/app/schemas/settings.py::DASHBOARD_QUICK_ACTION_IDS` tuple and
    `DashboardQuickActionId` Literal
- **Deep-links:** `?form=<slug>` is resolved by `resolveTemplateIdFromSlug`
  against the fetched templates list. Removing a template from `list_templates()`
  makes its deep-link stop resolving (falls back to gallery) — no extra guard
  needed.

## Design

### Part A — Companions are companion-only

**Source of truth.** Add to `constants.py`:

```python
COMPANION_TEMPLATE_IDS: Final[frozenset[str]] = frozenset(
    {"Leave Undertaking", "Resignation Declaration"}
)
```

An explicit set (rather than deriving from `_COMPANION_RULES`, whose values are
conditional callables that can't be cleanly enumerated).

**Backend `list_templates()`** (`template_service.py`): skip any
`template_id in COMPANION_TEMPLATE_IDS`. `get_template_fields(id)` is left
working for companions — internal generation still needs their field schema; only
the *listing* excludes them. Result: gallery tiles disappear (frontend needs no
gallery change) and deep-links stop resolving.

**Quick-actions.** Remove `"Resignation Declaration"` and `"Leave Undertaking"`
from:
- `dashboardLayout.ts::QUICK_ACTION_IDS`
- `quickActions.ts::QUICK_ACTION_META`
- `settings.py::DASHBOARD_QUICK_ACTION_IDS` and `DashboardQuickActionId` Literal
- i18n keys `quickAction.label.{resignation_declaration,leave_undertaking}` and
  the matching `.desc.*` in `ar.json` and `en.json`

**Stored-layout safety.** A dashboard layout persisted before this change may
still reference the two removed ids. Two read paths must tolerate that:
- Frontend `resolveLayout` → `mergeQuickActions` already drops ids not in
  `QUICK_ACTION_ID_SET`. Covered; add a regression test.
- Backend: confirm the settings read path does not hard-fail Pydantic validation
  on an unknown `DashboardQuickActionId` in stored JSON. If it validates strictly
  on read, add tolerant filtering (drop unknown quick-action ids) so an existing
  saved layout still loads. This is the one behavioral risk to verify with a test.

### Part B — Arabic name simplification

Edit `name_ar` in `backend/templates/_fields.json`:

| template_id | new name_ar |
|---|---|
| Leave Application Form | طلب إجازة |
| Violation Form | مخالفة |
| Duty Resumption Form | استئناف العمل |
| Salary Transfer Request | طلب تحويل راتب |
| Salary Deduction Form | خصم راتب |
| Employee Clearance Form | إخلاء طرف |
| HR Request Form | طلب موارد بشرية |
| Acknowledgment Form | استلام المواد *(special — not "استلام")* |
| Material Request Form | طلب مواد |
| Warning Form | إنذار |

Templates already prefix-free (Passport Request, Resignation Letter/Declaration,
General Book, Leave Permit, Administrative Leave, Passport Release, Leave
Undertaking) are unchanged.

Update `constants.py::ADMIN_TYPES` for app-wide consistency:
- `"Acknowledgment Form - نموذج استلام"` → `"Acknowledgment Form - استلام المواد"`
- `"Material Request Form - نموذج طلب مواد"` → `"Material Request Form - طلب مواد"`

## Testing (TDD)

Backend:
- `list_templates()` excludes both companion ids and still includes every
  non-companion in `TEMPLATE_FILES`.
- Every listed template's `name_ar` has no leading "نموذج"; Acknowledgment Form's
  `name_ar` == "استلام المواد".
- A stored dashboard layout containing a removed quick-action id
  (`"Leave Undertaking"`) loads without raising.
- Regression: an Annual `Leave Application Form` generation still emits the
  `Leave Undertaking` companion (guards the behavior we intentionally keep).

Frontend:
- `resolveLayout` drops a stale companion quick-action id from a saved layout.
- Type-level: `QUICK_ACTION_IDS` no longer contains the companion ids.

## Risks

- **Sync drift** across the three quick-action registries (frontend x2 + backend).
  Mitigated by editing all three in the same change and a test asserting the
  backend Literal matches the frontend list length/content is out of scope, but
  the removal must touch all three.
- **Strict backend validation on stored layout read** could 500 for operators
  whose saved dashboard still references a removed id. Explicitly tested and, if
  present, made tolerant.
