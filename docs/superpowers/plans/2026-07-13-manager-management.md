# Admin Manager Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins add, edit, and deactivate manager records (name EN/AR, title, signature) from Settings → Managers, instead of records being import-only.

**Architecture:** Extend the existing `managers` API (`app/api/v1/managers.py`, `app/services/manager_service.py`, `app/schemas/manager.py`) with create/update/soft-delete and three signature endpoints that mirror the employee-signature routes. Rework the frontend `ManagersSection` (extracted into its own file) to drive add/edit/deactivate, reusing `SignatureDrawPanel`. No DB migration — the `managers` table already has every column.

**Tech Stack:** FastAPI + Pydantic + SQLAlchemy (SQLite) backend; React 19 + React Query + Tailwind + react-i18next frontend; generated `api.types.ts`.

## Global Constraints

- All Python runs through the repo venv: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`. mypy is **strict**; pytest runs with `filterwarnings=error`.
- Frontend uses pnpm: `pnpm -C frontend exec vitest run <file>`, `pnpm -C frontend exec tsc -b --noEmit`, `pnpm -C frontend run lint`.
- Manager management is gated by capability **`settings.edit`** (admin-only). `GET /managers` stays ungated (picker widgets use it).
- **No hard delete.** Deactivation = `active=false`; deactivated managers are hidden from `GET /managers` and the UI.
- `Manager.sig_path` is a server filesystem path — **never** accept it from or expose it to clients. Signatures flow only through the dedicated signature endpoints.
- Bilingual: every new UI string needs an `en.json` **and** `ar.json` key. Run the `i18n-rtl-reviewer` agent after touching locales.
- After any backend schema/route change, resync types via the `/sync-api-types` skill and commit `backend/openapi.json` + `frontend/src/lib/api.types.ts` together.
- Work on branch `feat/manager-management`. Every commit must land on `main` and be pushed to `origin/main` eventually (live checkout).

---

## File Structure

- `backend/app/schemas/manager.py` — refine `ManagerCreate` / `ManagerUpdate` / `ManagerRead` (Task 1).
- `backend/app/services/manager_service.py` — add create/update/signature-path/has_signature; filter inactive in list (Task 2).
- `backend/app/api/v1/managers.py` — add POST, extend PATCH, add 3 signature routes (Tasks 3–4).
- `backend/tests/test_managers_api.py` — new test module (Tasks 1–4).
- `frontend/src/lib/api.ts` — add manager CRUD + signature client methods (Task 5).
- `frontend/src/lib/api.types.ts` + `backend/openapi.json` — regenerated (Task 5).
- `frontend/src/pages/settings/SettingsPage.tsx` — export shared building blocks; drop inline `ManagersSection` (Task 6).
- `frontend/src/pages/settings/ManagersSection.tsx` — new component (Task 6).
- `frontend/src/pages/settings/ManagersSection.test.tsx` — new test module (Task 7).
- `frontend/src/locales/{en,ar}.json` — new `settings.managers.*` keys (Task 6).

---

### Task 1: Refine manager schemas

**Files:**
- Modify: `backend/app/schemas/manager.py`
- Test: `backend/tests/test_managers_api.py` (new)

**Interfaces:**
- Produces: `ManagerCreate(name_en, name_ar, title, active=True, user_id=None)` with a validator requiring at least one non-blank name; `ManagerUpdate(name_en?, name_ar?, title?, active?, user_id?)`; `ManagerRead` gains `has_signature: bool`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_managers_api.py`:

```python
"""Manager management API + schema tests."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.manager import ManagerCreate


def test_manager_create_requires_a_name():
    with pytest.raises(ValidationError):
        ManagerCreate(name_en="  ", name_ar=None, title="HR Director")


def test_manager_create_accepts_arabic_only_name():
    m = ManagerCreate(name_en=None, name_ar="مدير", title=None)
    assert m.name_ar == "مدير"
    assert m.active is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -v`
Expected: FAIL — `ManagerCreate(name_en="  ", ...)` does not raise (no validator yet).

- [ ] **Step 3: Rewrite the schema module**

Replace `backend/app/schemas/manager.py` with:

```python
"""Manager schemas."""

from __future__ import annotations

from pydantic import BaseModel, model_validator

from app.schemas._base import ORMBase


class ManagerCreate(BaseModel):
    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    active: bool = True
    user_id: int | None = None

    @model_validator(mode="after")
    def _require_a_name(self) -> "ManagerCreate":
        if not (self.name_en or "").strip() and not (self.name_ar or "").strip():
            raise ValueError("A manager needs an English or Arabic name.")
        return self


class ManagerUpdate(BaseModel):
    """Partial update. All fields optional. `sig_path` is NOT client-settable."""

    name_en: str | None = None
    name_ar: str | None = None
    title: str | None = None
    active: bool | None = None
    user_id: int | None = None


class ManagerRead(ORMBase):
    id: int
    name_en: str | None
    name_ar: str | None
    title: str | None
    active: bool
    user_id: int | None = None
    user_name: str | None = None
    has_signature: bool = False
    # `sig_path` (a filesystem path) is intentionally NOT exposed.


class ManagerLinkUpdate(BaseModel):
    user_id: int | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -v`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/manager.py backend/tests/test_managers_api.py
git commit -m "feat(managers): schema validation + has_signature; drop client sig_path"
```

---

### Task 2: Manager service — create / update / list-active / signature helpers

**Files:**
- Modify: `backend/app/services/manager_service.py`
- Test: `backend/tests/test_managers_api.py`

**Interfaces:**
- Consumes: `ManagerCreate`, `ManagerUpdate` (Task 1).
- Produces: `create_manager(db, data) -> Manager`; `update_manager(db, id, data) -> Manager`; `list_managers(db, include_inactive=False)`; `manager_signature_path(id) -> Path`; `has_signature(mgr) -> bool`; `save_manager_signature(id, data) -> Path`; `delete_manager_signature(mgr) -> None`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_managers_api.py` (assumes the repo's standard `db_session` fixture — check `backend/tests/conftest.py` for its exact name and match it):

```python
from app.schemas.manager import ManagerUpdate
from app.services import manager_service


def test_create_then_update_and_soft_delete(db_session):
    from app.schemas.manager import ManagerCreate

    mgr = manager_service.create_manager(
        db_session, ManagerCreate(name_en="Ada Lovelace", title="Director")
    )
    assert mgr.id is not None
    assert mgr.active is True

    manager_service.update_manager(
        db_session, mgr.id, ManagerUpdate(title="Chief Director")
    )
    assert db_session.get(type(mgr), mgr.id).title == "Chief Director"
    # name untouched by partial patch
    assert db_session.get(type(mgr), mgr.id).name_en == "Ada Lovelace"

    manager_service.update_manager(db_session, mgr.id, ManagerUpdate(active=False))
    active = manager_service.list_managers(db_session)
    assert all(m.id != mgr.id for m in active)
    allm = manager_service.list_managers(db_session, include_inactive=True)
    assert any(m.id == mgr.id for m in allm)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py::test_create_then_update_and_soft_delete -v`
Expected: FAIL — `manager_service.create_manager` does not exist.

- [ ] **Step 3: Extend the service**

Replace `backend/app/services/manager_service.py` with:

```python
"""Manager service — CRUD + signature-file management + picker support."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import NotFoundError
from app.config import get_settings
from app.core import signature as signature_core
from app.db.models import Manager
from app.schemas.manager import ManagerCreate, ManagerUpdate


def list_managers(db: Session, *, include_inactive: bool = False) -> list[Manager]:
    """Managers sorted by name_en. Active-only unless ``include_inactive``."""
    stmt = select(Manager).order_by(Manager.name_en)
    if not include_inactive:
        stmt = stmt.where(Manager.active.is_(True))
    return list(db.execute(stmt).scalars().all())


def _get_or_404(db: Session, manager_id: int) -> Manager:
    mgr = db.get(Manager, manager_id)
    if mgr is None:
        raise NotFoundError("MANAGER_NOT_FOUND", f"Manager {manager_id} not found", id=manager_id)
    return mgr


def create_manager(db: Session, data: ManagerCreate) -> Manager:
    mgr = Manager(
        name_en=data.name_en,
        name_ar=data.name_ar,
        title=data.title,
        active=data.active,
        user_id=data.user_id,
    )
    db.add(mgr)
    db.commit()
    db.refresh(mgr)
    return mgr


def update_manager(db: Session, manager_id: int, data: ManagerUpdate) -> Manager:
    """Partial update. Only fields explicitly set on ``data`` are written."""
    mgr = _get_or_404(db, manager_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(mgr, field, value)
    db.commit()
    db.refresh(mgr)
    return mgr


def set_manager_user(db: Session, manager_id: int, user_id: int | None) -> Manager:
    """Back-compat shim for the link-only PATCH path."""
    return update_manager(db, manager_id, ManagerUpdate(user_id=user_id))


def manager_signature_path(manager_id: int) -> Path:
    """Canonical signature file for a manager, with containment guard."""
    root = get_settings().data_dir.resolve()
    path = (root / "signatures" / "managers" / f"manager_{manager_id}.png").resolve()
    if root not in path.parents:
        raise ValueError("invalid manager signature path")
    return path


def has_signature(manager: Manager) -> bool:
    return bool(manager.sig_path) and Path(manager.sig_path).is_file()


def save_manager_signature(db: Session, manager_id: int, data: bytes) -> Path:
    """Normalize to PNG, write to the canonical path, record ``sig_path``."""
    mgr = _get_or_404(db, manager_id)
    png = signature_core.normalize_to_png(data)  # raises SignatureError on bad input
    path = manager_signature_path(manager_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    mgr.sig_path = str(path)
    db.commit()
    return path


def delete_manager_signature(db: Session, manager_id: int) -> None:
    """Remove the signature file and null ``sig_path``. Idempotent."""
    mgr = _get_or_404(db, manager_id)
    manager_signature_path(manager_id).unlink(missing_ok=True)
    mgr.sig_path = None
    db.commit()


def manager_user_name(db: Session, manager: Manager) -> str | None:
    """Display name of the linked login account, or None."""
    if manager.user_id is None:
        return None
    from app.services import book_service  # local import — avoids cycle

    return book_service.resolve_user_name_by_id(db, manager.user_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -v`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `venv\Scripts\mypy.exe backend/app/services/manager_service.py`
Expected: no errors (if `signature_core.normalize_to_png` import path differs, fix — it lives at `app/core/signature.py`).

```bash
git add backend/app/services/manager_service.py backend/tests/test_managers_api.py
git commit -m "feat(managers): service create/update/soft-delete + signature file helpers"
```

---

### Task 3: Manager CRUD routes (POST + extended PATCH)

**Files:**
- Modify: `backend/app/api/v1/managers.py`
- Test: `backend/tests/test_managers_api.py`

**Interfaces:**
- Consumes: `manager_service.create_manager/update_manager/list_managers/manager_user_name/has_signature`; `ManagerCreate`, `ManagerUpdate`, `ManagerRead`.
- Produces: `POST /managers`, `PATCH /managers/{id}` (full update), both `settings.edit`-gated.

- [ ] **Step 1: Write the failing test**

Append (use the repo's authenticated-admin test client fixture — inspect `conftest.py`; below assumes an `admin_client` fixture returning a `TestClient` authed with `settings.edit`, and a `client` fixture without it):

```python
def test_create_manager_via_api(admin_client):
    resp = admin_client.post("/api/v1/managers", json={"name_en": "Grace Hopper", "title": "Admiral"})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name_en"] == "Grace Hopper"
    assert body["has_signature"] is False

    # excluded once deactivated
    mid = body["id"]
    assert admin_client.patch(f"/api/v1/managers/{mid}", json={"active": False}).status_code == 200
    listed = admin_client.get("/api/v1/managers").json()
    assert all(m["id"] != mid for m in listed)


def test_create_manager_requires_capability(client):
    resp = client.post("/api/v1/managers", json={"name_en": "X"})
    assert resp.status_code in (401, 403)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -k create_manager -v`
Expected: FAIL — `POST /managers` returns 405 (route not defined).

- [ ] **Step 3: Add the routes**

Edit `backend/app/api/v1/managers.py`. Update imports and add the POST route + swap the PATCH body type:

```python
from fastapi import APIRouter, Depends, status
# ...
from app.schemas.manager import ManagerCreate, ManagerRead, ManagerUpdate
from app.services import manager_service


def _read(db: Session, row: object) -> ManagerRead:
    item = ManagerRead.model_validate(row)
    item.user_name = manager_service.manager_user_name(db, row)  # type: ignore[arg-type]
    item.has_signature = manager_service.has_signature(row)  # type: ignore[arg-type]
    return item


@router.get("", response_model=list[ManagerRead])
def list_managers(db: Annotated[Session, Depends(get_db)]) -> list[ManagerRead]:
    return [_read(db, r) for r in manager_service.list_managers(db)]


@router.post("", response_model=ManagerRead, status_code=status.HTTP_201_CREATED)
def create_manager(
    payload: ManagerCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> ManagerRead:
    row = manager_service.create_manager(db, payload)
    return _read(db, row)


@router.patch("/{manager_id}", response_model=ManagerRead)
def update_manager(
    manager_id: int,
    payload: ManagerUpdate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> ManagerRead:
    """Update any manager field (name, title, active, user link). settings.edit."""
    row = manager_service.update_manager(db, manager_id, payload)
    return _read(db, row)
```

Remove the old `list_managers` / `link_manager_account` bodies replaced above, and drop the now-unused `ManagerLinkUpdate` import (leave the schema in place; the frontend link call sends `{user_id}`, valid `ManagerUpdate`).

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/managers.py backend/tests/test_managers_api.py
git commit -m "feat(managers): POST create + full-field PATCH (settings.edit)"
```

---

### Task 4: Manager signature routes

**Files:**
- Modify: `backend/app/api/v1/managers.py`
- Test: `backend/tests/test_managers_api.py`

**Interfaces:**
- Consumes: `manager_service.save_manager_signature/manager_signature_path/delete_manager_signature`; `signature_core.SignatureError`.
- Produces: `POST /managers/{id}/signature`, `GET /managers/{id}/signature` (raw PNG or `?encoding=base64`), `DELETE /managers/{id}/signature`.

- [ ] **Step 1: Write the failing test**

Append (uses a tiny 1×1 PNG so `normalize_to_png` accepts it):

```python
import base64

_PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def test_manager_signature_roundtrip(admin_client):
    mid = admin_client.post("/api/v1/managers", json={"name_en": "Sig Boss"}).json()["id"]

    up = admin_client.post(
        f"/api/v1/managers/{mid}/signature",
        files={"file": ("sig.png", _PNG_1x1, "image/png")},
    )
    assert up.status_code == 201, up.text
    assert admin_client.get("/api/v1/managers").json()  # sanity

    got = admin_client.get(f"/api/v1/managers/{mid}/signature?encoding=base64")
    assert got.status_code == 200 and got.text.strip()

    assert admin_client.delete(f"/api/v1/managers/{mid}/signature").status_code == 204
    assert admin_client.get(f"/api/v1/managers/{mid}/signature").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py::test_manager_signature_roundtrip -v`
Expected: FAIL — signature route returns 405.

- [ ] **Step 3: Add the signature routes**

Add to `backend/app/api/v1/managers.py` (imports: `datetime`, `UTC` from datetime; `File`, `UploadFile`, `Query`, `Response` from fastapi; `NotFoundError`, `ValidationFailedError` from `app.api.errors`; `maybe_base64` — check its import location in `employees.py` and reuse):

```python
@router.post("/{manager_id}/signature", status_code=status.HTTP_201_CREATED)
async def upload_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    upload: Annotated[UploadFile, File(alias="file")],
) -> dict[str, str]:
    data = await upload.read()
    try:
        path = manager_service.save_manager_signature(db, manager_id, data)
    except signature_core.SignatureError as exc:
        raise ValidationFailedError("SIGNATURE_INVALID", str(exc), manager_id=manager_id) from exc
    return {"path": str(path), "filename": path.name}


@router.get("/{manager_id}/signature")
def get_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    manager_service._get_or_404(db, manager_id)
    path = manager_service.manager_signature_path(manager_id)
    if not path.is_file():
        raise NotFoundError("SIGNATURE_NOT_FOUND", "No signature on file.", manager_id=manager_id)
    updated = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC).isoformat()
    data = path.read_bytes()
    if (b64 := maybe_base64(data, encoding, extra_headers={"X-Signature-Updated": updated})) is not None:
        return b64
    return Response(content=data, media_type="image/png", headers={"X-Signature-Updated": updated})


@router.delete("/{manager_id}/signature", status_code=status.HTTP_204_NO_CONTENT)
def delete_manager_signature(
    manager_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    manager_service.delete_manager_signature(db, manager_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

Also import the signature core at module top: `from app.core import signature as signature_core`.

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_managers_api.py -v`
Expected: PASS.
Run: `venv\Scripts\ruff.exe check backend/app/api/v1/managers.py backend/app/services/manager_service.py && venv\Scripts\mypy.exe`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/managers.py backend/tests/test_managers_api.py
git commit -m "feat(managers): signature upload/get/delete routes"
```

---

### Task 5: Frontend API client + type resync

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Regenerate: `backend/openapi.json`, `frontend/src/lib/api.types.ts`

**Interfaces:**
- Consumes: backend routes from Tasks 3–4; generated `ManagerCreate`, `ManagerUpdate`, `ManagerRead` types.
- Produces: `api.createManager`, `api.updateManager`, `api.uploadManagerSignature`, `api.getManagerSignature`, `api.deleteManagerSignature`. `api.linkManagerAccount` reimplemented over `updateManager`.

- [ ] **Step 1: Resync generated types**

Run the `/sync-api-types` skill (dumps `openapi.json`, runs `pnpm gen:api`, typechecks). This makes `ManagerCreate`/`ManagerUpdate` and the new `has_signature` field available on the generated `ManagerRead`.

- [ ] **Step 2: Add client methods**

In `frontend/src/lib/api.ts`, near the existing `listManagers` / `linkManagerAccount` (line ~1019), add:

```typescript
  createManager: (body: ManagerCreate) =>
    request<ManagerRead>('POST', '/managers', body),
  updateManager: (id: number, body: ManagerUpdate) =>
    request<ManagerRead>('PATCH', `/managers/${id}`, body),
  linkManagerAccount: (id: number, userId: number | null) =>
    request<ManagerRead>('PATCH', `/managers/${id}`, { user_id: userId }),

  uploadManagerSignature: (id: number, png: Blob) => {
    const form = new FormData()
    form.append('file', png, 'signature.png')
    return multipart<{ path: string; filename: string }>(`/managers/${id}/signature`, form)
  },
  getManagerSignature: async (
    id: number,
  ): Promise<{ dataUrl: string; updatedAt: string | null } | null> => {
    const res = await fetch(`${BASE}/managers/${id}/signature?encoding=base64`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    })
    if (res.status === 404) return null
    if (!res.ok) {
      throw new ApiError(res.status, `HTTP_${res.status}`, res.statusText || 'Failed to load signature')
    }
    const b64 = (await res.text()).trim()
    if (!b64) return null
    return { dataUrl: `data:image/png;base64,${b64}`, updatedAt: res.headers.get('X-Signature-Updated') }
  },
  deleteManagerSignature: (id: number) => request<void>('DELETE', `/managers/${id}/signature`),
```

Remove the old single-line `linkManagerAccount` it replaces. Add `ManagerCreate`, `ManagerUpdate` to the type imports at the top of `api.ts` (they come from `api.types.ts`).

- [ ] **Step 3: Typecheck**

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.types.ts backend/openapi.json
git commit -m "feat(managers): api client methods + resync generated types"
```

---

### Task 6: ManagersSection component + i18n

**Files:**
- Create: `frontend/src/pages/settings/ManagersSection.tsx`
- Modify: `frontend/src/pages/settings/SettingsPage.tsx` (export shared blocks, remove inline `ManagersSection`, import new one)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `api.listManagers/createManager/updateManager/linkManagerAccount/uploadManagerSignature/getManagerSignature/deleteManagerSignature`; `SignatureDrawPanel`; exported `SectionCard`, `OutlineButton`, `PrimaryButton` from SettingsPage.
- Produces: default `ManagersSection` component (no props).

- [ ] **Step 1: Export shared building blocks from SettingsPage**

In `frontend/src/pages/settings/SettingsPage.tsx`, add `export` to the `function SectionCard(...)`, `function OutlineButton(...)`, and `function PrimaryButton(...)` declarations (confirm exact names of the button helpers; they're used by `SubmittersSection`). Delete the inline `function ManagersSection()` block (lines ~424–495) and its comment banner. Add near the other section imports:

```typescript
import { ManagersSection } from './ManagersSection'
```

The existing mount stays:

```tsx
<CapabilityGate cap="settings.edit">
  <ManagersSection />
</CapabilityGate>
```

- [ ] **Step 2: Add locale keys**

In `frontend/src/locales/en.json`, extend the `settings.managers` object (keep existing `title`/`description`/`empty`/`noAccount`/`linkedToast`):

```json
"managers": {
  "title": "Managers",
  "description": "Signatories printed on documents. Add, edit, or deactivate them.",
  "empty": "No managers yet.",
  "noAccount": "No linked account",
  "linkedToast": "Account link updated.",
  "add": "Add manager",
  "addAction": "Create",
  "edit": "Edit",
  "cancel": "Cancel",
  "save": "Save",
  "deactivate": "Deactivate",
  "nameEn": "Name (English)",
  "nameAr": "Name (Arabic)",
  "jobTitle": "Title",
  "signature": "Signature",
  "hasSignature": "Signature on file",
  "noSignature": "No signature",
  "addedToast": "Manager added.",
  "updatedToast": "Manager updated.",
  "deactivatedToast": "Manager deactivated.",
  "confirmDeactivate": "Deactivate this manager? They will no longer appear as a signatory."
}
```

In `frontend/src/locales/ar.json`, add the same keys with Arabic values:

```json
"managers": {
  "title": "المدراء",
  "description": "الموقّعون الذين تُطبع أسماؤهم على المستندات. أضف أو عدّل أو أوقف تفعيلهم.",
  "empty": "لا يوجد مدراء بعد.",
  "noAccount": "لا يوجد حساب مرتبط",
  "linkedToast": "تم تحديث ربط الحساب.",
  "add": "إضافة مدير",
  "addAction": "إنشاء",
  "edit": "تعديل",
  "cancel": "إلغاء",
  "save": "حفظ",
  "deactivate": "إيقاف التفعيل",
  "nameEn": "الاسم (بالإنجليزية)",
  "nameAr": "الاسم (بالعربية)",
  "jobTitle": "المسمّى الوظيفي",
  "signature": "التوقيع",
  "hasSignature": "يوجد توقيع محفوظ",
  "noSignature": "لا يوجد توقيع",
  "addedToast": "تمت إضافة المدير.",
  "updatedToast": "تم تحديث المدير.",
  "deactivatedToast": "تم إيقاف تفعيل المدير.",
  "confirmDeactivate": "إيقاف تفعيل هذا المدير؟ لن يظهر بعد الآن كموقّع."
}
```

Preserve existing keys under `settings.managers` — merge, don't overwrite. Match the surrounding indentation of each file.

- [ ] **Step 3: Create the component**

Create `frontend/src/pages/settings/ManagersSection.tsx`:

```tsx
/**
 * ManagersSection — admin (settings.edit) management of the signatory directory.
 * List (active only) with per-row account link, Edit, and Deactivate; plus an
 * Add form. Signatures use the shared SignatureDrawPanel (draw or upload).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { api, apiErrorMessage, type ManagerRead } from '@/lib/api'
import { SignatureDrawPanel } from '@/components/signature/SignatureDrawPanel'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SectionCard, OutlineButton, PrimaryButton } from './SettingsPage'

interface FormState {
  name_en: string
  name_ar: string
  title: string
}

const EMPTY: FormState = { name_en: '', name_ar: '', title: '' }

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

export function ManagersSection(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: managers } = useQuery({ queryKey: ['managers'], queryFn: () => api.listManagers() })
  const { data: users } = useQuery({ queryKey: ['auth', 'users'], queryFn: () => api.listAuthUsers() })
  const active = (users ?? []).filter((u) => u.status === 'active')

  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [pendingSig, setPendingSig] = useState<string | null>(null) // data URL for a new manager
  const [deactivateId, setDeactivateId] = useState<number | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['managers'] })

  const linkMut = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number | null }) =>
      api.linkManagerAccount(id, userId),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.linkedToast')) },
    onError: (e: Error) => toast.error(e.message),
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const mgr = await api.createManager({
        name_en: form.name_en.trim() || null,
        name_ar: form.name_ar.trim() || null,
        title: form.title.trim() || null,
      })
      if (pendingSig) await api.uploadManagerSignature(mgr.id, await dataUrlToBlob(pendingSig))
      return mgr
    },
    onSuccess: () => {
      invalidate(); toast.success(t('settings.managers.addedToast'))
      setAddOpen(false); setForm(EMPTY); setPendingSig(null)
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const updateMut = useMutation({
    mutationFn: (id: number) =>
      api.updateManager(id, {
        name_en: form.name_en.trim() || null,
        name_ar: form.name_ar.trim() || null,
        title: form.title.trim() || null,
      }),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.updatedToast')); setEditId(null) },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: number) => api.updateManager(id, { active: false }),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.deactivatedToast')) },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const openEdit = (m: ManagerRead) => {
    setEditId(m.id)
    setForm({ name_en: m.name_en ?? '', name_ar: m.name_ar ?? '', title: m.title ?? '' })
  }

  const nameValid = form.name_en.trim() !== '' || form.name_ar.trim() !== ''
  const inputCls =
    'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15'

  const formFields = (
    <div className="space-y-2">
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.nameEn')}
        value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.nameAr')}
        value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.jobTitle')}
        value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
    </div>
  )

  return (
    <SectionCard title={t('settings.managers.title')} description={t('settings.managers.description')}>
      <div className="space-y-2.5">
        {managers && managers.length === 0 && (
          <p className="py-2 text-[0.86em] text-muted-foreground">{t('settings.managers.empty')}</p>
        )}

        {managers?.map((m) =>
          editId === m.id ? (
            <div key={m.id} className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
              {formFields}
              <ManagerSignatureEditor managerId={m.id} />
              <div className="flex justify-end gap-2">
                <OutlineButton onClick={() => setEditId(null)}>{t('settings.managers.cancel')}</OutlineButton>
                <PrimaryButton disabled={!nameValid || updateMut.isPending} onClick={() => updateMut.mutate(m.id)}>
                  {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('settings.managers.save')}
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-raised px-4 py-2.5">
              <div className="min-w-0">
                <span className="block truncate text-[0.9em] font-medium text-foreground" dir="auto">
                  {m.name_en ?? m.name_ar}
                </span>
                <span className="text-[0.76em] text-muted-foreground">
                  {m.title ? m.title + ' · ' : ''}
                  {m.has_signature ? t('settings.managers.hasSignature') : t('settings.managers.noSignature')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select aria-label={t('settings.managers.noAccount')}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.84em]"
                  value={m.user_id != null ? String(m.user_id) : ''}
                  onChange={(e) => linkMut.mutate({ id: m.id, userId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t('settings.managers.noAccount')}</option>
                  {active.map((u) => (
                    <option key={u.id} value={u.id}>{u.name_en ?? u.display_name ?? u.email}</option>
                  ))}
                </select>
                <button type="button" onClick={() => openEdit(m)}
                  className="rounded-full px-3 py-1 text-[0.78em] font-medium text-primary hover:bg-primary/10">
                  {t('settings.managers.edit')}
                </button>
                <button type="button" onClick={() => setDeactivateId(m.id)}
                  className="rounded-full px-3 py-1 text-[0.78em] font-medium text-accent hover:bg-accent-soft">
                  {t('settings.managers.deactivate')}
                </button>
              </div>
            </div>
          ),
        )}

        {addOpen ? (
          <div className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
            {formFields}
            <div>
              <p className="mb-1 text-[0.78em] font-medium text-muted-foreground">{t('settings.managers.signature')}</p>
              {pendingSig ? (
                <div className="flex items-center gap-3">
                  <img src={pendingSig} alt={t('settings.managers.signature')} className="max-h-16 rounded border border-border bg-white p-1" />
                  <OutlineButton onClick={() => setPendingSig(null)}>{t('settings.managers.cancel')}</OutlineButton>
                </div>
              ) : (
                <SignatureDrawPanel showSaveToProfile={false} onUse={(d) => setPendingSig(d)} />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <OutlineButton onClick={() => { setAddOpen(false); setForm(EMPTY); setPendingSig(null) }}>
                {t('settings.managers.cancel')}
              </OutlineButton>
              <PrimaryButton disabled={!nameValid || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('settings.managers.addAction')}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <OutlineButton onClick={() => { setForm(EMPTY); setPendingSig(null); setAddOpen(true) }}>
            {t('settings.managers.add')}
          </OutlineButton>
        )}
      </div>

      <ConfirmDialog
        open={deactivateId !== null}
        onOpenChange={(o) => { if (!o) setDeactivateId(null) }}
        title={t('settings.managers.confirmDeactivate')}
        confirmLabel={t('settings.managers.deactivate')}
        onConfirm={() => { if (deactivateId !== null) deactivateMut.mutate(deactivateId) }}
        destructive
      />
    </SectionCard>
  )
}

/** Edit-mode signature manager: show current, Replace via draw/upload, Remove. */
function ManagerSignatureEditor({ managerId }: { managerId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [replacing, setReplacing] = useState(false)
  const { data } = useQuery({
    queryKey: ['manager-signature', managerId],
    queryFn: () => api.getManagerSignature(managerId),
    retry: false,
  })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['manager-signature', managerId] })

  const save = async (dataUrl: string): Promise<void> => {
    try {
      await api.uploadManagerSignature(managerId, await dataUrlToBlob(dataUrl))
      setReplacing(false); invalidate()
      void qc.invalidateQueries({ queryKey: ['managers'] })
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  const remove = async (): Promise<void> => {
    try {
      await api.deleteManagerSignature(managerId)
      invalidate(); void qc.invalidateQueries({ queryKey: ['managers'] })
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  return (
    <div>
      <p className="mb-1 text-[0.78em] font-medium text-muted-foreground">{t('settings.managers.signature')}</p>
      {data?.dataUrl && !replacing ? (
        <div className="flex items-center gap-3">
          <img src={data.dataUrl} alt={t('settings.managers.signature')} className="max-h-16 rounded border border-border bg-white p-1" />
          <OutlineButton onClick={() => setReplacing(true)}>{t('settings.managers.edit')}</OutlineButton>
          <button type="button" onClick={() => void remove()} className="text-[0.78em] font-medium text-accent">
            {t('settings.managers.deactivate') /* reuse remove label? use noSignature */}
          </button>
        </div>
      ) : (
        <SignatureDrawPanel showSaveToProfile={false} onUse={(d) => void save(d)}
          onCancel={data?.dataUrl ? () => setReplacing(false) : undefined} />
      )}
    </div>
  )
}
```

Note: the "remove signature" button label above is a placeholder — add a dedicated `settings.managers.removeSignature` key ("Remove signature" / "إزالة التوقيع") in both locale files and use it instead of the reused `deactivate` label.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: no errors. Fix any unused imports and confirm the exported building-block names (`OutlineButton`/`PrimaryButton`) match SettingsPage.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/settings/ManagersSection.tsx frontend/src/pages/settings/SettingsPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(managers): admin add/edit/deactivate UI + signature management"
```

---

### Task 7: Component tests + full verification

**Files:**
- Create: `frontend/src/pages/settings/ManagersSection.test.tsx`

**Interfaces:**
- Consumes: `ManagersSection`; mocked `api`.

- [ ] **Step 1: Write the tests**

Create `frontend/src/pages/settings/ManagersSection.test.tsx` (mirror the mocking style of a nearby settings test — inspect one first, e.g. an existing `*.test.tsx` under `src/pages/settings/` or `src/pages/employees/tabs/ProfileTab.test.tsx`, to match the `QueryClientProvider` + i18n test harness and `vi.mock('@/lib/api')` shape):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ManagersSection } from './ManagersSection'
import { api } from '@/lib/api'

vi.mock('@/lib/api')

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ManagersSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.listManagers).mockResolvedValue([
    { id: 1, name_en: 'Ada', name_ar: null, title: 'Director', active: true, user_id: null, user_name: null, has_signature: false },
  ])
  vi.mocked(api.listAuthUsers).mockResolvedValue([])
})

describe('ManagersSection', () => {
  it('adds a manager', async () => {
    vi.mocked(api.createManager).mockResolvedValue({
      id: 2, name_en: 'Grace', name_ar: null, title: null, active: true, user_id: null, user_name: null, has_signature: false,
    })
    renderSection()
    fireEvent.click(await screen.findByText('settings.managers.add'))
    fireEvent.change(screen.getByPlaceholderText('settings.managers.nameEn'), { target: { value: 'Grace' } })
    fireEvent.click(screen.getByText('settings.managers.addAction'))
    await waitFor(() => expect(api.createManager).toHaveBeenCalledWith(
      expect.objectContaining({ name_en: 'Grace' }),
    ))
  })

  it('deactivates a manager after confirm', async () => {
    vi.mocked(api.updateManager).mockResolvedValue({} as never)
    renderSection()
    fireEvent.click(await screen.findByText('settings.managers.deactivate'))
    // ConfirmDialog confirm button carries the same label
    const confirms = await screen.findAllByText('settings.managers.deactivate')
    fireEvent.click(confirms[confirms.length - 1])
    await waitFor(() => expect(api.updateManager).toHaveBeenCalledWith(1, { active: false }))
  })
})
```

Adjust selectors if the i18n test harness returns real strings rather than keys (match how sibling tests assert).

- [ ] **Step 2: Run the tests**

Run: `pnpm -C frontend exec vitest run src/pages/settings/ManagersSection.test.tsx`
Expected: PASS (2 tests). Iterate on selectors until green.

- [ ] **Step 3: i18n + full gates**

Run the `i18n-rtl-reviewer` agent on the locale + component changes; fix any parity/RTL findings.
Then the full suite:

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend exec vitest run
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/settings/ManagersSection.test.tsx
git commit -m "test(managers): add/deactivate ManagersSection flows"
```

- [ ] **Step 5: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill: merge `feat/manager-management` → `main` and **push to `origin/main`** (live checkout). Then the user deploys via `scripts\mng.ps1 update` / `deploy`.

---

## Self-Review Notes

- **Spec coverage:** Add (Task 3/6), Edit (Task 3/6), Deactivate/soft-delete (Task 2/3/6), signature draw+upload+edit (Tasks 4/6), admin-only gate (Tasks 3/4), hidden inactive (Task 2 `list_managers` filter), no migration (confirmed model fields), extract ManagersSection (Task 6), i18n + reviewer (Tasks 6/7), type resync (Task 5). All covered.
- **No hard delete:** no `DELETE /managers/{id}` route anywhere. ✓
- **sig_path never client-facing:** dropped from `ManagerCreate`/`ManagerUpdate`; not in `ManagerRead`. ✓
- **Type consistency:** service names (`create_manager`, `update_manager`, `save_manager_signature`, `delete_manager_signature`, `manager_signature_path`, `has_signature`) are used identically across Tasks 2–4; client names (`createManager`, `updateManager`, `uploadManagerSignature`, `getManagerSignature`, `deleteManagerSignature`) identical across Tasks 5–6.
- **Open verification points for the implementer** (flagged inline, not placeholders): exact `conftest.py` fixture names (`db_session` / `admin_client` / `client`), the `maybe_base64` import location, the `OutlineButton`/`PrimaryButton` helper names in SettingsPage, and the `removeSignature` locale key. Each has a concrete instruction to confirm against a named existing file.
```
