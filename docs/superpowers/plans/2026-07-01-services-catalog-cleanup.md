# Services Catalog Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove companion forms (Leave Undertaking, Resignation Declaration) from every standalone entry point while keeping their auto-generation with the primary, and strip the redundant "نموذج" prefix from Arabic service names.

**Architecture:** The Services gallery is data-driven from the backend `list_templates()`, so hiding companions is a backend filter (no gallery-component change). Quick-actions are mirrored in three registries (frontend x2 + backend Literal) that are edited together. Arabic names live in the read-only `backend/templates/_fields.json` plus the `ADMIN_TYPES` label tuple. The backend stored-layout read path is made tolerant of already-persisted ids that we are removing.

**Tech Stack:** Python 3 / FastAPI / Pydantic v2 / SQLAlchemy (backend, pytest); React / TypeScript / Vite / Vitest (frontend).

## Global Constraints

- This checkout is the **live production server**. Every change must be committed AND pushed to `origin/main` at the end, or a server pull overwrites it. (Push happens once at the very end, after all tasks pass — not per task.)
- Arabic strings are RTL; preserve them exactly as written in this plan (copy-paste, do not retype).
- English display names are **untouched** — they keep "Form".
- The three quick-action registries must stay in sync: `frontend/src/lib/dashboardLayout.ts::QUICK_ACTION_IDS`, `frontend/src/lib/quickActions.ts::QUICK_ACTION_META`, and `backend/app/schemas/settings.py` (`DASHBOARD_QUICK_ACTION_IDS` tuple + `DashboardQuickActionId` Literal).
- Companion template ids (canonical, English keys): `"Leave Undertaking"` and `"Resignation Declaration"`.
- Backend tests: `cd backend && python -m pytest`. Frontend tests: `cd frontend && pnpm test`.

---

### Task 1: Backend — hide companions from the Services catalog

**Files:**
- Modify: `backend/app/core/constants.py` (add `COMPANION_TEMPLATE_IDS` near `COMPANION_FORM_PAIRS`, ~line 160)
- Modify: `backend/app/services/template_service.py` (`list_templates`, lines 108-115)
- Test: `backend/tests/test_templates_catalog.py` (create)

**Interfaces:**
- Produces: `constants.COMPANION_TEMPLATE_IDS: frozenset[str]` = `{"Leave Undertaking", "Resignation Declaration"}`
- Consumes: `template_service.list_templates() -> TemplateListResponse`, `template_service.get_template_fields(id) -> TemplateDetailResponse`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_templates_catalog.py`:

```python
"""Services catalog: companions are hidden from the gallery list but remain
internally accessible (they still auto-generate with their primary)."""
from __future__ import annotations

from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
from app.services import template_service


def test_companions_excluded_from_listing():
    ids = {m.id for m in template_service.list_templates().items}
    assert "Leave Undertaking" not in ids
    assert "Resignation Declaration" not in ids


def test_non_companions_all_listed():
    ids = {m.id for m in template_service.list_templates().items}
    expected = set(TEMPLATE_FILES) - set(COMPANION_TEMPLATE_IDS)
    assert ids == expected


def test_companion_schema_still_accessible():
    # Guards that companions remain generatable internally — we only hide them
    # from the *listing*, we do not remove the template.
    detail = template_service.get_template_fields("Leave Undertaking")
    assert detail.meta.id == "Leave Undertaking"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_templates_catalog.py -v`
Expected: FAIL — `ImportError: cannot import name 'COMPANION_TEMPLATE_IDS'` (and, once that exists, the exclusion assertions fail).

- [ ] **Step 3: Add the companion-id set to constants**

In `backend/app/core/constants.py`, immediately after the `COMPANION_FORM_PAIRS` block (after line 160), add:

```python
# --- Companion template ids (never shown as standalone services) -----------
# These forms auto-generate alongside their primary (see
# document_service._COMPANION_RULES). They must never appear as their own
# gallery tile or quick-action, so `list_templates()` filters them out.
COMPANION_TEMPLATE_IDS: Final[frozenset[str]] = frozenset(
    {"Leave Undertaking", "Resignation Declaration"}
)
```

- [ ] **Step 4: Filter companions in `list_templates()`**

In `backend/app/services/template_service.py`, update the import and the loop.

Change the constants import (line 17) from:

```python
from app.core.constants import TEMPLATE_FILES
```
to:
```python
from app.core.constants import COMPANION_TEMPLATE_IDS, TEMPLATE_FILES
```

Then in `list_templates` (lines 108-115), skip companions:

```python
def list_templates() -> TemplateListResponse:
    """Return metadata for every non-companion registered template.

    Companion forms (COMPANION_TEMPLATE_IDS) are excluded — they only exist as
    a companion of their primary, never as a standalone service.
    """
    meta_map = load_fields_meta()
    items: list[TemplateMeta] = []
    for template_id in TEMPLATE_FILES:
        if template_id in COMPANION_TEMPLATE_IDS:
            continue
        entry = meta_map.get(template_id, {})
        items.append(_build_meta(template_id, entry))
    return TemplateListResponse(items=items)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_templates_catalog.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/constants.py backend/app/services/template_service.py backend/tests/test_templates_catalog.py
git commit -m "feat(services): hide companion forms from the Services catalog listing"
```

---

### Task 2: Backend — strip "نموذج" from Arabic service names

**Files:**
- Modify: `backend/templates/_fields.json` (10 `name_ar` values)
- Modify: `backend/app/core/constants.py` (`ADMIN_TYPES`, lines 207-213)
- Test: `backend/tests/test_templates_catalog.py` (append)

**Interfaces:**
- Consumes: `template_service.list_templates()` (from Task 1); `constants.ADMIN_TYPES`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_templates_catalog.py`:

```python
def test_arabic_names_have_no_form_prefix():
    for meta in template_service.list_templates().items:
        assert not meta.name_ar.startswith("نموذج"), meta.id


def test_acknowledgment_arabic_name_is_material_receipt():
    names = {m.id: m.name_ar for m in template_service.list_templates().items}
    assert names["Acknowledgment Form"] == "استلام المواد"


def test_admin_types_labels_have_no_form_prefix():
    from app.core.constants import ADMIN_TYPES

    joined = "\n".join(ADMIN_TYPES)
    assert "نموذج استلام" not in joined
    assert "نموذج طلب مواد" not in joined
    assert "Acknowledgment Form - استلام المواد" in ADMIN_TYPES
    assert "Material Request Form - طلب مواد" in ADMIN_TYPES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_templates_catalog.py -k "arabic or acknowledgment or admin_types" -v`
Expected: FAIL — names still start with "نموذج".

- [ ] **Step 3: Edit `_fields.json` name_ar values**

In `backend/templates/_fields.json`, replace each `name_ar` exactly (match on the full line including trailing comma). Ten edits:

| Find | Replace |
|---|---|
| `"name_ar": "نموذج طلب إجازة",` | `"name_ar": "طلب إجازة",` |
| `"name_ar": "نموذج مخالفة",` | `"name_ar": "مخالفة",` |
| `"name_ar": "نموذج استئناف العمل",` | `"name_ar": "استئناف العمل",` |
| `"name_ar": "نموذج طلب تحويل راتب",` | `"name_ar": "طلب تحويل راتب",` |
| `"name_ar": "نموذج خصم راتب",` | `"name_ar": "خصم راتب",` |
| `"name_ar": "نموذج إخلاء طرف",` | `"name_ar": "إخلاء طرف",` |
| `"name_ar": "نموذج طلب موارد بشرية",` | `"name_ar": "طلب موارد بشرية",` |
| `"name_ar": "نموذج استلام",` | `"name_ar": "استلام المواد",` |
| `"name_ar": "نموذج طلب مواد",` | `"name_ar": "طلب مواد",` |
| `"name_ar": "نموذج إنذار",` | `"name_ar": "إنذار",` |

Note: `نموذج استلام` → `استلام المواد` (the special case — NOT just `استلام`).

- [ ] **Step 4: Edit `ADMIN_TYPES` in constants.py**

In `backend/app/core/constants.py`, `ADMIN_TYPES` (lines 207-213), change the first two entries:

```python
ADMIN_TYPES: Final[tuple[str, ...]] = (
    "Acknowledgment Form - استلام المواد",
    "Material Request Form - طلب مواد",
    "Leave Permit Form - تصريح خروج",
    "Administrative Leave Form - طلب إجازة إدارية",
    "General Book - كتاب عام",
)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_templates_catalog.py -v`
Expected: PASS (all tests in the file, incl. Task 1's).

- [ ] **Step 6: Commit**

```bash
git add backend/templates/_fields.json backend/app/core/constants.py backend/tests/test_templates_catalog.py
git commit -m "feat(services): strip نموذج prefix from Arabic names; استلام → استلام المواد"
```

---

### Task 3: Backend — remove companions from quick-action ids and tolerate stale stored layouts

**Files:**
- Modify: `backend/app/schemas/settings.py` (`DASHBOARD_QUICK_ACTION_IDS` tuple lines 37-58; `DashboardQuickActionId` Literal lines 74-95)
- Modify: `backend/app/services/settings_service.py` (`_get_dashboard_layout`, lines 107-119)
- Test: `backend/tests/test_dashboard_layout_read.py` (create)

**Interfaces:**
- Consumes: `settings_service.get_settings(db)`, the `db_session` fixture from `conftest.py`, `app.db.models.AppSetting`
- Produces: tolerant `_get_dashboard_layout` that drops quick-action entries whose id is not in `DASHBOARD_QUICK_ACTION_IDS`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_dashboard_layout_read.py`:

```python
"""A dashboard layout persisted before a quick-action id was removed must still
load — the read path drops now-unknown ids instead of raising."""
from __future__ import annotations

import json

from app.db.models import AppSetting
from app.services import settings_service


def _store_layout(db, layout: dict) -> None:
    db.add(
        AppSetting(
            key="settings.dashboard_layout",
            value=json.dumps(None),
            dashboard_layout=layout,
        )
    )
    db.commit()


def test_stale_quick_action_id_is_dropped(db_session):
    _store_layout(
        db_session,
        {
            "widgets": [],
            "quick_actions": [
                {"id": "Leave Undertaking", "visible": True, "order": 0},
                {"id": "Leave Application Form", "visible": True, "order": 1},
            ],
        },
    )
    settings = settings_service.get_settings(db_session)
    ids = [qa.id for qa in settings.dashboard_layout.quick_actions]
    assert "Leave Undertaking" not in ids
    assert "Leave Application Form" in ids


def test_quick_action_id_literal_excludes_companions():
    from app.schemas.settings import DASHBOARD_QUICK_ACTION_IDS

    assert "Leave Undertaking" not in DASHBOARD_QUICK_ACTION_IDS
    assert "Resignation Declaration" not in DASHBOARD_QUICK_ACTION_IDS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_dashboard_layout_read.py -v`
Expected: FAIL — `test_stale_quick_action_id_is_dropped` raises a Pydantic `ValidationError` (unknown Literal value) inside `get_settings`; `test_quick_action_id_literal_excludes_companions` fails because the ids are still present.

- [ ] **Step 3: Remove companions from the settings ids (tuple + Literal)**

In `backend/app/schemas/settings.py`, delete the two companion lines from BOTH `DASHBOARD_QUICK_ACTION_IDS` (the tuple, lines 37-58) and `DashboardQuickActionId` (the Literal, lines 74-95). In each block delete:

```python
    "Resignation Declaration",
```
and
```python
    "Leave Undertaking",
```

Leave `"Resignation Letter"` (the primary) in place — only the two companions are removed. After the edit each block lists 18 ids.

- [ ] **Step 4: Make the layout read path tolerant**

In `backend/app/services/settings_service.py`, update the import line 20 from:

```python
from app.schemas.settings import AppSettingsRead, AppSettingsUpdate, DashboardLayout
```
to:
```python
from app.schemas.settings import (
    DASHBOARD_QUICK_ACTION_IDS,
    AppSettingsRead,
    AppSettingsUpdate,
    DashboardLayout,
)

_VALID_QUICK_ACTION_IDS = frozenset(DASHBOARD_QUICK_ACTION_IDS)
```

Then replace the body of `_get_dashboard_layout` (lines 107-119) so it strips unknown quick-action ids before validation:

```python
def _get_dashboard_layout(db: Session) -> DashboardLayout | None:
    """Read the dashboard layout from the JSON column on the singleton row.

    Returns ``None`` when either the row doesn't exist or the column is NULL —
    in both cases the frontend falls back to its built-in defaults.

    Quick-action ids that are no longer known (e.g. a template removed from the
    quick-launcher) are dropped rather than failing validation, so a layout
    saved before the removal still loads.
    """
    row = db.execute(
        select(AppSetting).where(AppSetting.key == _DASHBOARD_LAYOUT_KEY)
    ).scalar_one_or_none()
    if row is None or row.dashboard_layout is None:
        return None
    raw = row.dashboard_layout
    if isinstance(raw, dict) and isinstance(raw.get("quick_actions"), list):
        raw = {
            **raw,
            "quick_actions": [
                qa
                for qa in raw["quick_actions"]
                if isinstance(qa, dict) and qa.get("id") in _VALID_QUICK_ACTION_IDS
            ],
        }
    return DashboardLayout.model_validate(raw)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_dashboard_layout_read.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/settings.py backend/app/services/settings_service.py backend/tests/test_dashboard_layout_read.py
git commit -m "fix(dashboard): drop companion quick-actions; tolerate stale stored ids on read"
```

---

### Task 4: Frontend — remove companion quick-actions from the registries and i18n

**Files:**
- Modify: `frontend/src/lib/dashboardLayout.ts` (`QUICK_ACTION_IDS`, lines 89 & 91)
- Modify: `frontend/src/lib/quickActions.ts` (`QUICK_ACTION_META`, lines 148-153 & 160-165)
- Modify: `frontend/src/locales/ar.json` (delete keys at lines 1904, 1906, 1926, 1928)
- Modify: `frontend/src/locales/en.json` (delete keys at lines 1813, 1815, 1835, 1837)
- Test: `frontend/src/lib/dashboardLayout.test.ts` (create)

**Interfaces:**
- Consumes: `resolveLayout(saved) -> DashboardLayout`, `QUICK_ACTION_IDS` (from `dashboardLayout.ts`)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/dashboardLayout.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import type { DashboardLayout } from './api'
import { QUICK_ACTION_IDS, resolveLayout } from './dashboardLayout'

describe('companion quick-actions are gone', () => {
  it('QUICK_ACTION_IDS excludes companion forms', () => {
    expect(QUICK_ACTION_IDS).not.toContain('Leave Undertaking')
    expect(QUICK_ACTION_IDS).not.toContain('Resignation Declaration')
  })

  it('resolveLayout drops a stale companion quick-action from a saved layout', () => {
    const saved = {
      widgets: [],
      quick_actions: [
        { id: 'Leave Undertaking', visible: true, order: 0 },
        { id: 'Leave Application Form', visible: true, order: 1 },
      ],
    } as unknown as DashboardLayout

    const resolved = resolveLayout(saved)
    const ids = resolved.quick_actions.map((q) => q.id)
    expect(ids).not.toContain('Leave Undertaking')
    expect(ids).toContain('Leave Application Form')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm test src/lib/dashboardLayout.test.ts`
Expected: FAIL — `QUICK_ACTION_IDS` still contains the companion ids.

- [ ] **Step 3: Remove companions from `QUICK_ACTION_IDS`**

In `frontend/src/lib/dashboardLayout.ts`, delete these two lines from the `QUICK_ACTION_IDS` array (lines 89 and 91):

```typescript
  'Resignation Declaration',
```
and
```typescript
  'Leave Undertaking',
```

Keep `'Resignation Letter'` (line 90).

- [ ] **Step 4: Remove companions from `QUICK_ACTION_META`**

In `frontend/src/lib/quickActions.ts`, delete the two entire entries (lines 148-153 and 160-165):

```typescript
  'Resignation Declaration': {
    emoji: '📝',
    href: formHref('Resignation Declaration'),
    intent: 'new',
    slug: slugifyQuickActionId('Resignation Declaration'),
  },
```
and
```typescript
  'Leave Undertaking': {
    emoji: '🤝',
    href: formHref('Leave Undertaking'),
    intent: 'new',
    slug: slugifyQuickActionId('Leave Undertaking'),
  },
```

Keep the `'Resignation Letter'` entry between them.

- [ ] **Step 5: Delete the orphaned i18n keys**

In `frontend/src/locales/ar.json`, delete these four lines:

```json
      "resignation_declaration": "إفادة استقالة",
```
```json
      "leave_undertaking": "تعهد إجازة",
```
```json
      "resignation_declaration": "تقديم إفادة استقالة.",
```
```json
      "leave_undertaking": "تسجيل تعهد إجازة.",
```

In `frontend/src/locales/en.json`, delete these four lines:

```json
      "resignation_declaration": "Resignation Decl.",
```
```json
      "leave_undertaking": "Leave Undertaking",
```
```json
      "resignation_declaration": "File a resignation declaration.",
```
```json
      "leave_undertaking": "Record a leave undertaking.",
```

Ensure the JSON stays valid (no trailing comma left dangling on the line before a `}`; if a deleted line was the last entry in its object, remove the comma from the new last line).

- [ ] **Step 6: Run test + typecheck to verify**

Run: `cd frontend && pnpm test src/lib/dashboardLayout.test.ts`
Expected: PASS (2 passed).

Run: `cd frontend && pnpm build`
Expected: `tsc -b` passes with no type errors (confirms no dangling references to the removed `QuickActionId` union members and both JSON files parse).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/dashboardLayout.ts frontend/src/lib/quickActions.ts frontend/src/locales/ar.json frontend/src/locales/en.json frontend/src/lib/dashboardLayout.test.ts
git commit -m "feat(dashboard): remove companion forms from quick-action registry + i18n"
```

---

### Task 5: Full verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && python -m pytest`
Expected: all pass (no regressions in existing document/settings tests).

- [ ] **Step 2: Run the full frontend suite + build**

Run: `cd frontend && pnpm test && pnpm build`
Expected: all tests pass; production build succeeds.

- [ ] **Step 3: Push to origin/main**

This checkout is the live server — the work is not durable until pushed.

```bash
git push origin main
```

Expected: push succeeds; `git status` shows `Your branch is up to date with 'origin/main'`.

---

## Notes for the implementer

- **Do not** touch `document_service._COMPANION_RULES` — companion auto-generation must remain. Task 1's `test_companion_schema_still_accessible` guards that companions are still internally usable.
- The Arabic strings in this plan are authoritative — copy-paste them; do not retype (retyping risks mangling combining characters / letter forms).
- After Task 3, the previously-unused `DASHBOARD_QUICK_ACTION_IDS` tuple becomes the runtime allowlist for the tolerant read — keep it and the `DashboardQuickActionId` Literal identical in membership.
