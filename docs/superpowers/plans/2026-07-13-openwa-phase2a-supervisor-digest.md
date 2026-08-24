# OpenWA Phase 2a+2b — Supervisor Routing + Annual-Leave Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route notifications to duty-unit supervisors resolved by designation, and send those supervisors a bilingual monthly digest of their unit's employees on annual leave — both riding the Phase 1 OpenWA router (`notify_dispatch`).

**Architecture:** A new `duty_supervisors` table maps each free-text `duty_unit` to one or more `recipient_duty_post` designations. At send time we resolve the *current* holders of those designations (active employees with a valid mobile) — supervisors are never pinned people. A new reusable `notify_dispatch.send_direct()` primitive sends arbitrary bilingual text to any employee through the existing WhatsApp-first / SMS-fallback policy. A `digest_service` builds the per-unit annual-leave list, renders it bilingually per recipient, and fans out through `send_direct`. The APScheduler gains a monthly cron job (1st of month, 08:00 Asia/Dubai). All new admin surfaces gate on `settings.edit`.

**Tech Stack:** FastAPI (Python 3.12), SQLAlchemy (SQLite), Alembic (hand-numbered `NNNN_slug` revisions), APScheduler `BackgroundScheduler`, React 19 + Vite/TS, React Query, Radix + Tailwind 4, Zod. Generated frontend types (`api.types.ts`) via `pnpm gen:api`.

## Global Constraints

- **Single linear Alembic head.** Next revision is `0052_...`; `down_revision = "0051"`. Wrap alters in `op.batch_alter_table`; omit named FKs to existing tables; give NOT-NULL-on-populated columns a `server_default`. Additive only.
- **Every backend schema/route change requires a type resync:** dump `backend/openapi.json`, run `pnpm -C frontend gen:api`, typecheck; commit `openapi.json` + `api.types.ts` together (the `/sync-api-types` skill).
- **Bilingual parity is mandatory.** Every user-facing string needs matching `en.json` + `ar.json` keys. Use logical CSS (`ms-`/`me-`, `text-start`/`text-end`, `dir`). After touching any bilingual surface run the `i18n-rtl-reviewer` and `notification-template-reviewer` agents.
- **Strict gates are real and must pass:** `venv\Scripts\ruff.exe check .` + `format --check .` on touched files, `venv\Scripts\mypy.exe` (no NEW errors vs the 47-error baseline), `venv\Scripts\python.exe -m pytest` (`filterwarnings=error`), `pnpm -C frontend test`, `pnpm -C frontend exec tsc -b --noEmit`.
- **This checkout is live production.** Everything ships dormant behind the existing `openwa_enabled` / `sms_enabled` flags (no channel enabled ⇒ digest/mapping are inert). Commit AND push to `origin/main` only after the whole branch passes review.
- **Run all Python through the venv:** `venv\Scripts\python.exe`, `venv\Scripts\ruff.exe`, `venv\Scripts\mypy.exe`, `venv\Scripts\alembic.exe`.

## Verified codebase facts (do not re-derive)

- `Employee` (`backend/app/db/models.py:57`): `id: str`, `status: str` (default `"Active"`), `duty_unit: str | None`, `duty_post: str | None`, `contact: str | None`, `msg_language: str` (default `"ar"`), `name_ar`, `name_en`. `duty_unit`/`duty_post` are **free-text**, not FK tables.
- `Leave` (`backend/app/db/models.py:319`): `leave_type: str` (free-text), `start_date: date`, `end_date: date`, `status: str`, `employee_id: str`, `deleted_at: datetime | None`.
- `OutboundMessage` (`backend/app/db/models.py:439`): columns `employee_id, event_type(≤32), event_ref(≤64), language(2), phone, channel, status, delivery_state, fell_back, fallback_reason, attempts, next_retry_at, provider_msg_id, error, body, sent_by, created_at`.
- `notify_dispatch` (`backend/app/services/notify_dispatch.py`): `send_for_event(db, event_type, record_id, *, sent_by)`; internal `_try_whatsapp(db, *, base)`, `_send_sms(db, *, base, fell_back, reason)`, `_log_row(db, **kw)`, `_any_channel_enabled(cfg)`, `NotifyDisabledError`. `normalize_phone(contact, default_cc=...)` → `str | None`.
- `notify_format` (`backend/app/services/notify_format.py`): `employee_name(emp, lang)`, `fmt_date(d)`, `AR_MONTHS`/`EN_MONTHS` (Jan at index 0), `type_label(value, lang)`.
- `leave_lifecycle` (`backend/app/core/leave_lifecycle.py`): `canonical_status(status)` → English half, `"Generated"`→`"Approved"`; `_ANNUAL = frozenset({"annual leave", "annual"})`; `_english_part(value)`.
- Scheduler (`backend/app/services/scheduler_service.py`): jobs added in `start()`; only `IntervalTrigger` imported today; `_disabled_in_environment()` returns True under pytest.
- Permission gate: `require_capability("settings.edit")` from `backend/app/api/deps.py` used as a `Depends`.
- Duty Locations page: `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx`; unit list derives from `frontend/src/lib/dutyUnits.ts` `unitOptions(emps)` (6 Arabic seed units + extras). No backend duty-unit CRUD exists.
- Latest migration: `backend/app/db/migrations/versions/0051_backfill_outbound_messages.py`.

---

## PART 2a — Duty-unit supervisor routing

### Task 1: `DutySupervisor` model + migration 0052 (create + seed)

**Files:**
- Modify: `backend/app/db/models.py` (add class after `OutboundMessage`, near line 476)
- Create: `backend/app/db/migrations/versions/0052_duty_supervisors.py`
- Test: `backend/tests/test_duty_supervisors_model.py`

**Interfaces:**
- Produces: `DutySupervisor` ORM model, table `duty_supervisors` with columns `id: int`, `duty_unit: str`, `recipient_duty_post: str`, `created_at: datetime`; unique index on `(duty_unit, recipient_duty_post)`. Seeded with 7 verified rows.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_duty_supervisors_model.py
from datetime import date

from sqlalchemy import select

from app.db.models import DutySupervisor


def test_duty_supervisor_row_roundtrips(db_session):
    row = DutySupervisor(duty_unit="السرية الأولى", recipient_duty_post="مسؤول سرية")
    db_session.add(row)
    db_session.commit()
    got = db_session.scalar(select(DutySupervisor).where(DutySupervisor.duty_unit == "السرية الأولى"))
    assert got is not None
    assert got.recipient_duty_post == "مسؤول سرية"
    assert got.created_at is not None
    assert isinstance(got.created_at.date(), date)
```

Note: `db_session` is the existing pytest fixture in `backend/tests/conftest.py` (in-memory SQLite with all tables created). Confirm its name before running; if it is `session`/`db`, match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisors_model.py -v`
Expected: FAIL with `ImportError: cannot import name 'DutySupervisor'`.

- [ ] **Step 3: Add the model**

```python
# backend/app/db/models.py — add after the OutboundMessage class (~line 476)
class DutySupervisor(Base):
    """Maps a (free-text) duty_unit to a recipient designation (duty_post).

    Supervisors are resolved at send time from these designations, never
    pinned to a specific person — moving staff around the roster never breaks
    routing. A unit may have several rows (several recipient designations).
    """

    __tablename__ = "duty_supervisors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    duty_unit: Mapped[str] = mapped_column(String(128))
    recipient_duty_post: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    __table_args__ = (
        Index("ux_duty_supervisors_unit_post", "duty_unit", "recipient_duty_post", unique=True),
    )
```

- [ ] **Step 4: Create migration 0052**

```python
# backend/app/db/migrations/versions/0052_duty_supervisors.py
"""create duty_supervisors + seed verified designation mapping

Revision ID: 0052
Revises: 0051
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

# Verified against live data 2026-07-13 (see the Phase 2 spec, §2a seed mapping).
_SEED: list[tuple[str, str]] = [
    ("السرية الأولى", "مسؤول سرية"),
    ("السرية الثانية", "مسؤول سرية"),
    ("السرية الثالثة", "مسؤول سرية"),
    ("السرية الرابعة", "مسؤول سرية"),
    ("السرية الخامسة", "مسؤول سرية"),
    ("الدوام الرسمي", "مدير فرع الخدمات العامة"),
    ("الدوام الرسمي", "مدير مشروع"),
]


def upgrade() -> None:
    op.create_table(
        "duty_supervisors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("duty_unit", sa.String(length=128), nullable=False),
        sa.Column("recipient_duty_post", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ux_duty_supervisors_unit_post",
        "duty_supervisors",
        ["duty_unit", "recipient_duty_post"],
        unique=True,
    )
    dsv = sa.table(
        "duty_supervisors",
        sa.column("duty_unit", sa.String),
        sa.column("recipient_duty_post", sa.String),
    )
    op.bulk_insert(dsv, [{"duty_unit": u, "recipient_duty_post": p} for u, p in _SEED])


def downgrade() -> None:
    op.drop_index("ux_duty_supervisors_unit_post", table_name="duty_supervisors")
    op.drop_table("duty_supervisors")
```

- [ ] **Step 5: Run model test + a migration round-trip check**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisors_model.py -v`
Expected: PASS.
Run: `venv\Scripts\alembic.exe upgrade head && venv\Scripts\alembic.exe downgrade -1 && venv\Scripts\alembic.exe upgrade head`
Expected: no errors; single head. (Use a throwaway/dev DB, never the live prod DB.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/db/migrations/versions/0052_duty_supervisors.py backend/tests/test_duty_supervisors_model.py
git commit -m "feat(notify): duty_supervisors table + seed designation mapping"
```

---

### Task 2: `duty_supervisor_service` — CRUD + supervisor resolution

**Files:**
- Create: `backend/app/services/duty_supervisor_service.py`
- Test: `backend/tests/test_duty_supervisor_service.py`

**Interfaces:**
- Consumes: `DutySupervisor`, `Employee`, `normalize_phone`, `get_settings`.
- Produces:
  - `list_mappings(db) -> list[DutySupervisor]`
  - `add_mapping(db, duty_unit: str, recipient_duty_post: str) -> DutySupervisor` (idempotent on the unique pair)
  - `remove_mapping(db, mapping_id: int) -> bool`
  - `resolve_supervisors(db, duty_unit: str) -> list[Employee]` — active employees in that unit whose `duty_post` is a configured designation AND whose `contact` normalizes to a mobile.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_duty_supervisor_service.py
from app.db.models import DutySupervisor, Employee
from app.services import duty_supervisor_service as svc


def _emp(db, **kw):
    base = dict(id=kw.pop("id"), name_ar="ع", name_en="X", status="Active",
                duty_unit=None, duty_post=None, contact=None, msg_language="ar")
    base.update(kw)
    e = Employee(**base)
    db.add(e)
    db.commit()
    return e


def test_add_mapping_is_idempotent(db_session):
    a = svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    b = svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    assert a.id == b.id
    assert len(svc.list_mappings(db_session)) == 1


def test_remove_mapping(db_session):
    m = svc.add_mapping(db_session, "الدوام الرسمي", "مدير مشروع")
    assert svc.remove_mapping(db_session, m.id) is True
    assert svc.remove_mapping(db_session, m.id) is False
    assert svc.list_mappings(db_session) == []


def test_resolve_supervisors_by_designation(db_session):
    svc.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    match = _emp(db_session, id="G1", duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact="0501234567")
    _emp(db_session, id="G2", duty_unit="السرية الأولى", duty_post="جندي", contact="0502223333")  # wrong post
    _emp(db_session, id="G3", duty_unit="السرية الثانية", duty_post="مسؤول سرية", contact="0504445555")  # wrong unit
    _emp(db_session, id="G4", duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact=None)  # no phone
    _emp(db_session, id="G5", duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact="0506667777", status="منتهي الخدمات")  # inactive
    got = svc.resolve_supervisors(db_session, "السرية الأولى")
    assert [e.id for e in got] == ["G1"]
    assert got[0].id == match.id


def test_resolve_supervisors_no_mapping_returns_empty(db_session):
    _emp(db_session, id="G9", duty_unit="دعم 1", duty_post="مسؤول سرية", contact="0501112222")
    assert svc.resolve_supervisors(db_session, "دعم 1") == []
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisor_service.py -v`
Expected: FAIL (`ModuleNotFoundError: app.services.duty_supervisor_service`).

- [ ] **Step 3: Implement the service**

```python
# backend/app/services/duty_supervisor_service.py
"""CRUD for duty-unit supervisor designations + resolution to current holders.

A duty unit is mapped to one or more ``recipient_duty_post`` designations; the
actual recipients are resolved at send time from active employees holding those
designations (with a valid mobile), so roster moves never break routing.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.phone import normalize_phone
from app.db.models import DutySupervisor, Employee


def list_mappings(db: Session) -> list[DutySupervisor]:
    return list(
        db.scalars(
            select(DutySupervisor).order_by(
                DutySupervisor.duty_unit, DutySupervisor.recipient_duty_post
            )
        )
    )


def add_mapping(db: Session, duty_unit: str, recipient_duty_post: str) -> DutySupervisor:
    """Create the (unit, designation) mapping, or return the existing row."""
    duty_unit = duty_unit.strip()
    recipient_duty_post = recipient_duty_post.strip()
    existing = db.scalar(
        select(DutySupervisor).where(
            DutySupervisor.duty_unit == duty_unit,
            DutySupervisor.recipient_duty_post == recipient_duty_post,
        )
    )
    if existing is not None:
        return existing
    row = DutySupervisor(duty_unit=duty_unit, recipient_duty_post=recipient_duty_post)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def remove_mapping(db: Session, mapping_id: int) -> bool:
    row = db.get(DutySupervisor, mapping_id)
    if row is None:
        return False
    db.delete(row)
    db.commit()
    return True


def resolve_supervisors(db: Session, duty_unit: str) -> list[Employee]:
    """Active employees in ``duty_unit`` whose duty_post is a configured
    designation AND whose contact normalizes to a mobile. Empty if unmapped."""
    posts = list(
        db.scalars(
            select(DutySupervisor.recipient_duty_post).where(
                DutySupervisor.duty_unit == duty_unit
            )
        )
    )
    if not posts:
        return []
    cc = get_settings().sms_country_code
    candidates = list(
        db.scalars(
            select(Employee).where(
                Employee.duty_unit == duty_unit,
                Employee.duty_post.in_(posts),
                Employee.status == "Active",
            )
        )
    )
    return [e for e in candidates if normalize_phone(e.contact, default_cc=cc)]
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisor_service.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/duty_supervisor_service.py backend/tests/test_duty_supervisor_service.py
git commit -m "feat(notify): duty-supervisor CRUD + designation resolution service"
```

---

### Task 3: `duty_supervisors` API router + schemas + type resync

**Files:**
- Create: `backend/app/schemas/duty_supervisor.py`
- Create: `backend/app/api/v1/duty_supervisors.py`
- Modify: `backend/app/main.py` (mount the router — match existing `include_router` lines)
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (resync)
- Test: `backend/tests/test_duty_supervisors_api.py`

**Interfaces:**
- Consumes: `duty_supervisor_service`, `require_capability("settings.edit")`, `get_db`.
- Produces routes (prefix `/duty-supervisors`):
  - `GET /` → `list[DutySupervisorRead]`
  - `POST /` (`DutySupervisorCreate{duty_unit, recipient_duty_post}`) → `DutySupervisorRead` (201)
  - `DELETE /{mapping_id}` → 204

- [ ] **Step 1: Write the failing API tests**

```python
# backend/tests/test_duty_supervisors_api.py
# Follow the auth/client fixture pattern already used in backend/tests/test_managers_api.py
# (admin client with settings.edit). Reuse that module's helper names.


def test_create_list_delete_mapping(admin_client):
    r = admin_client.post(
        "/api/v1/duty-supervisors/",
        json={"duty_unit": "السرية الأولى", "recipient_duty_post": "مسؤول سرية"},
    )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]

    r = admin_client.get("/api/v1/duty-supervisors/")
    assert r.status_code == 200
    assert any(m["id"] == mid for m in r.json())

    r = admin_client.delete(f"/api/v1/duty-supervisors/{mid}")
    assert r.status_code == 204
    assert all(m["id"] != mid for m in admin_client.get("/api/v1/duty-supervisors/").json())


def test_create_requires_settings_edit(client):
    # `client` = unauthenticated / non-admin per the shared fixture
    r = client.post(
        "/api/v1/duty-supervisors/",
        json={"duty_unit": "x", "recipient_duty_post": "y"},
    )
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisors_api.py -v`
Expected: FAIL (404 — route not mounted).

- [ ] **Step 3: Schemas**

```python
# backend/app/schemas/duty_supervisor.py
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class DutySupervisorCreate(BaseModel):
    duty_unit: str = Field(min_length=1, max_length=128)
    recipient_duty_post: str = Field(min_length=1, max_length=128)


class DutySupervisorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    duty_unit: str
    recipient_duty_post: str
    created_at: datetime
```

- [ ] **Step 4: Router**

```python
# backend/app/api/v1/duty_supervisors.py
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_capability
from app.db.models import User
from app.schemas.duty_supervisor import DutySupervisorCreate, DutySupervisorRead
from app.services import duty_supervisor_service as svc

router = APIRouter(prefix="/duty-supervisors", tags=["duty-supervisors"])


@router.get("/", response_model=list[DutySupervisorRead])
def list_mappings(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> list[DutySupervisorRead]:
    return [DutySupervisorRead.model_validate(m) for m in svc.list_mappings(db)]


@router.post("/", response_model=DutySupervisorRead, status_code=status.HTTP_201_CREATED)
def create_mapping(
    payload: DutySupervisorCreate,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DutySupervisorRead:
    row = svc.add_mapping(db, payload.duty_unit, payload.recipient_duty_post)
    return DutySupervisorRead.model_validate(row)


@router.delete("/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mapping(
    mapping_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> Response:
    svc.remove_mapping(db, mapping_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Mount the router**

In `backend/app/main.py`, next to the other `app.include_router(...)` calls, add:

```python
from app.api.v1 import duty_supervisors as duty_supervisors_router
...
app.include_router(duty_supervisors_router.router, prefix="/api/v1")
```

Match the exact import + include style already used for neighboring routers (e.g. the managers router).

- [ ] **Step 6: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_duty_supervisors_api.py -v`
Expected: PASS.

- [ ] **Step 7: Resync generated types**

Run (the `/sync-api-types` skill, or manually):
```bash
venv\Scripts\python.exe -m app.tools.dump_openapi > backend/openapi.json   # use the repo's actual dump command
pnpm -C frontend gen:api
pnpm -C frontend exec tsc -b --noEmit
```
Confirm `DutySupervisorRead` / `DutySupervisorCreate` appear in `frontend/src/lib/api.types.ts`. (If the dump command differs, use the one documented in the `/sync-api-types` skill.)

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas/duty_supervisor.py backend/app/api/v1/duty_supervisors.py backend/app/main.py backend/tests/test_duty_supervisors_api.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(notify): duty-supervisors CRUD API + type resync"
```

---

### Task 4: Frontend — supervisor-designation editor on the Duty Locations page

**Files:**
- Create: `frontend/src/pages/dutyLocations/SupervisorDesignations.tsx`
- Modify: `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx` (render the editor for the active unit)
- Modify: `frontend/src/lib/api.ts` (add `listDutySupervisors`, `addDutySupervisor`, `deleteDutySupervisor` client calls — match existing call style)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/dutyLocations/SupervisorDesignations.test.tsx`

**Interfaces:**
- Consumes: the `/duty-supervisors` API (Task 3), `postsForUnit()` from `frontend/src/lib/dutyUnits.ts` (existing) for the designation combobox options.
- Produces: `<SupervisorDesignations unit={string} posts={string[]} />` — lists the unit's designations with a remove control, and an add row (post combobox + add button).

- [ ] **Step 1: Add i18n keys (both files, full parity)**

```jsonc
// en.json — add under a new "dutySupervisors" object
"dutySupervisors": {
  "title": "Notify supervisors",
  "subtitle": "Designations that receive alerts for this unit",
  "designation": "Designation",
  "add": "Add",
  "remove": "Remove",
  "empty": "No supervisor designations for this unit yet.",
  "addError": "Could not add the designation. Please try again."
}
```
```jsonc
// ar.json — identical keys, Arabic values
"dutySupervisors": {
  "title": "إشعار المشرفين",
  "subtitle": "المسميات التي تتلقى تنبيهات هذه الوحدة",
  "designation": "المسمى الوظيفي",
  "add": "إضافة",
  "remove": "إزالة",
  "empty": "لا توجد مسميات مشرفين لهذه الوحدة بعد.",
  "addError": "تعذّرت إضافة المسمى. حاول مرة أخرى."
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// frontend/src/pages/dutyLocations/SupervisorDesignations.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SupervisorDesignations } from "./SupervisorDesignations";
// Wrap with the app's QueryClientProvider + i18n test harness used by neighboring tests.

vi.mock("../../lib/api", () => ({
  listDutySupervisors: vi.fn().mockResolvedValue([
    { id: 1, duty_unit: "السرية الأولى", recipient_duty_post: "مسؤول سرية", created_at: "2026-07-13T00:00:00" },
  ]),
  addDutySupervisor: vi.fn(),
  deleteDutySupervisor: vi.fn(),
}));

describe("SupervisorDesignations", () => {
  it("lists the unit's configured designations", async () => {
    renderWithProviders(<SupervisorDesignations unit="السرية الأولى" posts={["مسؤول سرية", "جندي"]} />);
    expect(await screen.findByText("مسؤول سرية")).toBeInTheDocument();
  });
});
```
(Use the repo's existing `renderWithProviders`/test util — copy the import from a sibling test such as `ManagersSection.test.tsx`.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/dutyLocations/SupervisorDesignations.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the component + api client calls**

Add to `frontend/src/lib/api.ts` (match the existing typed-fetch helper style and `paths` generics):
```ts
export const listDutySupervisors = () =>
  apiGet<DutySupervisorRead[]>("/api/v1/duty-supervisors/");
export const addDutySupervisor = (body: DutySupervisorCreate) =>
  apiPost<DutySupervisorRead>("/api/v1/duty-supervisors/", body);
export const deleteDutySupervisor = (id: number) =>
  apiDelete(`/api/v1/duty-supervisors/${id}`);
```
(Use the actual helper names/import for generated types already present in `api.ts`.)

Create `SupervisorDesignations.tsx`: a React Query list filtered to `unit`, each designation as a chip/row with a Remove button (`useMutation` → `deleteDutySupervisor` → invalidate); an add row with a `<datalist>`-backed post input (options = `posts`) and an Add button (`useMutation` → `addDutySupervisor`). Bilingual via `useTranslation("dutySupervisors")`; logical CSS (`ms-`/`me-`, `text-start`); `dir="auto"` on the free-text designation. Show the `empty` string when none. On add error show `addError`.

- [ ] **Step 5: Wire into the page**

In `DutyLocationsPage.tsx`, in the active-unit detail section (near the roster, ~line 178–217), render `<SupervisorDesignations unit={activeUnit} posts={postsForUnit(activeUnit)} />` (skip when the pseudo-unit "Unassigned" is active).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm -C frontend exec vitest run src/pages/dutyLocations/SupervisorDesignations.test.tsx`
Expected: PASS.
Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: clean.

- [ ] **Step 7: Bilingual review + commit**

Run the `i18n-rtl-reviewer` agent on the diff; fix findings.
```bash
git add frontend/src/pages/dutyLocations/SupervisorDesignations.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/dutyLocations/SupervisorDesignations.test.tsx
git commit -m "feat(notify): supervisor-designation editor on Duty Locations page"
```

---

## PART 2b — Annual-leave digest

### Task 5: `notify_dispatch.send_direct()` reusable primitive

**Files:**
- Modify: `backend/app/services/notify_dispatch.py`
- Test: `backend/tests/test_notify_dispatch_send_direct.py`

**Interfaces:**
- Produces: `send_direct(db, *, employee: Employee, body: str, language: str, event_type: str, event_ref: str, sent_by: int | None) -> OutboundMessage`. Routes through the same WhatsApp-first / SMS policy as `send_for_event`; writes one `OutboundMessage`. Raises `NotifyDisabledError` if no channel is enabled.
- Refactor: extract `_route(db, *, base, cfg) -> OutboundMessage` (the phone-check + channel decision tail of `send_for_event`) and have both `send_for_event` and `send_direct` call it. **Behavior of `send_for_event` must not change** (existing tests stay green).

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_notify_dispatch_send_direct.py
from types import SimpleNamespace

import pytest

from app.db.models import Employee, OutboundMessage
from app.services import notify_dispatch as nd


def _emp(db):
    e = Employee(id="G100", name_ar="س", name_en="Sup", status="Active",
                 contact="0501234567", msg_language="ar", duty_unit="u", duty_post="p")
    db.add(e)
    db.commit()
    return e


def test_send_direct_no_channel_raises(db_session, monkeypatch):
    monkeypatch.setattr(nd, "get_settings", lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=False, sms_country_code="971"))
    with pytest.raises(nd.NotifyDisabledError):
        nd.send_direct(db_session, employee=_emp(db_session), body="hi", language="ar",
                       event_type="leave_digest", event_ref="leave_digest:2026-07:u", sent_by=None)


def test_send_direct_sms_path_logs_row(db_session, monkeypatch):
    monkeypatch.setattr(nd, "get_settings", lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=True, sms_country_code="971"))
    monkeypatch.setattr(nd.sms_client, "send", lambda phone, body: SimpleNamespace(ok=True, message_id="m1", error=None))
    row = nd.send_direct(db_session, employee=_emp(db_session), body="digest body", language="ar",
                         event_type="leave_digest", event_ref="leave_digest:2026-07:u", sent_by=7)
    assert isinstance(row, OutboundMessage)
    assert row.channel == "sms"
    assert row.status == "sent"
    assert row.body == "digest body"
    assert row.event_type == "leave_digest"
    assert row.sent_by == 7


def test_send_direct_no_phone_fails_gracefully(db_session, monkeypatch):
    monkeypatch.setattr(nd, "get_settings", lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=True, sms_country_code="971"))
    e = _emp(db_session)
    e.contact = None
    db_session.commit()
    row = nd.send_direct(db_session, employee=e, body="x", language="ar",
                         event_type="leave_digest", event_ref="leave_digest:2026-07:u", sent_by=None)
    assert row.status == "failed"
    assert row.channel is None
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch_send_direct.py -v`
Expected: FAIL (`AttributeError: module ... has no attribute 'send_direct'`).

- [ ] **Step 3: Refactor + add primitive**

In `notify_dispatch.py`, extract the tail of `send_for_event` into `_route`, then add `send_direct`:

```python
def _route(db: Session, *, base: dict[str, object], cfg: object) -> OutboundMessage:
    """Phone-check + channel decision shared by send_for_event and send_direct."""
    if not base.get("phone"):
        return _log_row(
            db, **base, channel=None, status="failed",
            error="No valid phone number for this employee",
        )
    if getattr(cfg, "openwa_enabled", False):
        return _try_whatsapp(db, base=base)
    return _send_sms(db, base=base, fell_back=False, reason=None)


def send_direct(
    db: Session,
    *,
    employee: Employee,
    body: str,
    language: str,
    event_type: str,
    event_ref: str,
    sent_by: int | None,
) -> OutboundMessage:
    """Send arbitrary bilingual text to one employee through the router.

    Used by broadcasts/digests where the recipient is not the subject of an HR
    record and the text is pre-rendered. Same WhatsApp-first / SMS policy.
    """
    cfg = get_settings()
    if not _any_channel_enabled(cfg):
        raise NotifyDisabledError("No notification channel is enabled")
    phone = normalize_phone(employee.contact, default_cc=cfg.sms_country_code)
    base: dict[str, object] = dict(
        employee_id=employee.id,
        event_type=event_type,
        event_ref=event_ref,
        language=language,
        phone=phone or "",
        body=body,
        sent_by=sent_by,
    )
    return _route(db, base=base, cfg=cfg)
```

Then rewrite the tail of `send_for_event` (lines ~211–221) to reuse `_route`:
```python
    # ... after building `base` from _resolve(...) and setting phone into base ...
    return _route(db, base=base, cfg=cfg)
```
Keep `send_for_event`'s existing `base` construction and the `phone or ""` assignment; just delegate the phone-None + channel branch to `_route`. Do not alter `_try_whatsapp` / `_send_sms`.

- [ ] **Step 4: Run new + existing dispatch tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_notify_dispatch_send_direct.py backend/tests/ -k "dispatch or notify" -v`
Expected: new tests PASS; all pre-existing `notify_dispatch` tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notify_dispatch.py backend/tests/test_notify_dispatch_send_direct.py
git commit -m "feat(notify): send_direct primitive (shared router send for digests/broadcasts)"
```

---

### Task 6: Annual-overlap leave query + `is_annual` helper

**Files:**
- Modify: `backend/app/core/leave_lifecycle.py` (add public `is_annual`)
- Modify: `backend/app/services/leave_service.py` (add `list_annual_overlapping`)
- Test: `backend/tests/test_leave_annual_overlap.py`

**Interfaces:**
- Produces:
  - `leave_lifecycle.is_annual(leave_type: str) -> bool` — True when the English lead is in `_ANNUAL`.
  - `leave_service.list_annual_overlapping(db, *, month_start: date, month_end: date, duty_unit: str | None = None) -> list[Leave]` — Approved (canonical), non-deleted annual leaves whose `[start_date, end_date]` overlaps `[month_start, month_end]`; optionally scoped to a duty unit via the employee join. Ordered by employee then start_date.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_leave_annual_overlap.py
from datetime import date

from app.core import leave_lifecycle
from app.db.models import Employee, Leave
from app.services import leave_service


def test_is_annual():
    assert leave_lifecycle.is_annual("annual leave") is True
    assert leave_lifecycle.is_annual("Annual Leave - الإجازة السنوية") is True
    assert leave_lifecycle.is_annual("sick leave") is False


def _emp(db, id_, unit):
    db.add(Employee(id=id_, name_ar="ع", name_en="X", status="Active",
                    duty_unit=unit, duty_post="p", contact="0501112222", msg_language="ar"))
    db.commit()


def _leave(db, id_, emp, start, end, status="Approved", lt="annual leave"):
    db.add(Leave(id=id_, employee_id=emp, leave_type=lt, start_date=start, end_date=end, status=status, days=1))
    db.commit()


def test_list_annual_overlapping_matches_only_overlaps(db_session):
    _emp(db_session, "G1", "السرية الأولى")
    ms, me = date(2026, 7, 1), date(2026, 7, 31)
    _leave(db_session, 1, "G1", date(2026, 6, 28), date(2026, 7, 3))   # overlaps start
    _leave(db_session, 2, "G1", date(2026, 7, 20), date(2026, 8, 5))   # overlaps end
    _leave(db_session, 3, "G1", date(2026, 5, 1), date(2026, 5, 10))   # before → excluded
    _leave(db_session, 4, "G1", date(2026, 7, 10), date(2026, 7, 12), status="Rejected")  # excluded
    _leave(db_session, 5, "G1", date(2026, 7, 10), date(2026, 7, 12), lt="sick leave")    # not annual
    got = leave_service.list_annual_overlapping(db_session, month_start=ms, month_end=me)
    assert sorted(l.id for l in got) == [1, 2]


def test_list_annual_overlapping_scoped_by_unit(db_session):
    _emp(db_session, "G1", "السرية الأولى")
    _emp(db_session, "G2", "السرية الثانية")
    ms, me = date(2026, 7, 1), date(2026, 7, 31)
    _leave(db_session, 1, "G1", date(2026, 7, 5), date(2026, 7, 9))
    _leave(db_session, 2, "G2", date(2026, 7, 5), date(2026, 7, 9))
    got = leave_service.list_annual_overlapping(db_session, month_start=ms, month_end=me, duty_unit="السرية الأولى")
    assert [l.id for l in got] == [1]
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_annual_overlap.py -v`
Expected: FAIL (`is_annual` / `list_annual_overlapping` missing).

- [ ] **Step 3: Implement**

In `leave_lifecycle.py` (near `is_returnable`):
```python
def is_annual(leave_type: str) -> bool:
    """True for Annual Leave (the digest's scope). Robust to bilingual labels."""
    return _english_part(leave_type).lower() in _ANNUAL
```

In `leave_service.py` (import `date`, `select`, `Employee`, `Leave`, `leave_lifecycle` as needed):
```python
def list_annual_overlapping(
    db: Session,
    *,
    month_start: date,
    month_end: date,
    duty_unit: str | None = None,
) -> list[Leave]:
    """Approved, non-deleted annual leaves overlapping [month_start, month_end].

    Overlap = start_date <= month_end AND end_date >= month_start. Annual-type
    and canonical-Approved filtering happen in Python (both are stored as
    inconsistent bilingual free-text, so an ORM equality filter is unsafe)."""
    stmt = select(Leave).where(
        Leave.deleted_at.is_(None),
        Leave.start_date <= month_end,
        Leave.end_date >= month_start,
    )
    if duty_unit is not None:
        stmt = stmt.join(Employee, Employee.id == Leave.employee_id).where(
            Employee.duty_unit == duty_unit
        )
    stmt = stmt.order_by(Leave.employee_id, Leave.start_date)
    rows = list(db.scalars(stmt))
    return [
        lv for lv in rows
        if leave_lifecycle.is_annual(lv.leave_type)
        and leave_lifecycle.canonical_status(lv.status) == "Approved"
    ]
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_leave_annual_overlap.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/leave_lifecycle.py backend/app/services/leave_service.py backend/tests/test_leave_annual_overlap.py
git commit -m "feat(leave): is_annual helper + annual-overlap query for digest"
```

---

### Task 7: `digest_service` — bilingual render + per-unit build

**Files:**
- Create: `backend/app/services/digest_service.py`
- Test: `backend/tests/test_digest_service_render.py`

**Interfaces:**
- Consumes: `notify_format` (`employee_name`, `fmt_date`, `AR_MONTHS`/`EN_MONTHS`), `leave_service.list_annual_overlapping`, `Employee`, `Leave`.
- Produces:
  - `month_bounds(d: date) -> tuple[date, date]` — first and last day of `d`'s month.
  - `render_leave_digest(unit: str, month: date, employees_leaves: list[tuple[Employee, Leave]], lang: str) -> str` — bilingual heading (unit + month name/year) + one line per `name — dd/mm/yyyy → dd/mm/yyyy`.
  - `build_unit_digest(db, duty_unit: str, month: date) -> list[tuple[Employee, Leave]]` — the (employee, leave) pairs for that unit's annual leaves overlapping `month`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_digest_service_render.py
from datetime import date

from app.db.models import Employee, Leave
from app.services import digest_service as ds


def _pair(id_, name_ar, name_en, s, e):
    emp = Employee(id=id_, name_ar=name_ar, name_en=name_en, status="Active",
                   contact="0501112222", msg_language="ar", duty_unit="u", duty_post="p")
    lv = Leave(id=1, employee_id=id_, leave_type="annual leave", start_date=s, end_date=e, status="Approved", days=1)
    return emp, lv


def test_month_bounds():
    assert ds.month_bounds(date(2026, 7, 15)) == (date(2026, 7, 1), date(2026, 7, 31))
    assert ds.month_bounds(date(2026, 2, 10)) == (date(2026, 2, 1), date(2026, 2, 28))


def test_render_arabic_lists_names_and_dates():
    pairs = [_pair("G1", "أحمد", "Ahmed", date(2026, 7, 5), date(2026, 7, 9))]
    out = ds.render_leave_digest("السرية الأولى", date(2026, 7, 1), pairs, "ar")
    assert "يوليو" in out
    assert "2026" in out
    assert "أحمد" in out
    assert "05/07/2026" in out and "09/07/2026" in out
    assert "السرية الأولى" in out


def test_render_english_uses_english_name_and_month():
    pairs = [_pair("G1", "أحمد", "Ahmed", date(2026, 7, 5), date(2026, 7, 9))]
    out = ds.render_leave_digest("Alpha", date(2026, 7, 1), pairs, "en")
    assert "July" in out and "Ahmed" in out
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digest_service_render.py -v`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement (render + build)**

```python
# backend/app/services/digest_service.py
"""Build + render the annual-leave digest for duty-unit supervisors.

A small, extensible bilingual list layer: future digests (returning-to-duty,
pending-approvals) reuse render helpers + the supervisor router without
touching resolution.
"""

from __future__ import annotations

import calendar
from datetime import date

from sqlalchemy.orm import Session

from app.db.models import Employee, Leave
from app.services import leave_service, notify_format as nf


def month_bounds(d: date) -> tuple[date, date]:
    last = calendar.monthrange(d.year, d.month)[1]
    return date(d.year, d.month, 1), date(d.year, d.month, last)


def _month_name(d: date, lang: str) -> str:
    table = nf.AR_MONTHS if lang == "ar" else nf.EN_MONTHS
    return f"{table[d.month - 1]} {d.year}"


def render_leave_digest(
    unit: str,
    month: date,
    employees_leaves: list[tuple[Employee, Leave]],
    lang: str,
) -> str:
    """One bilingual message: heading (unit + month) then a line per person."""
    if lang == "ar":
        heading = f"الإجازات السنوية لوحدة «{unit}» لشهر {_month_name(month, 'ar')}:"
    else:
        heading = f"Annual leave for unit \"{unit}\" — {_month_name(month, 'en')}:"
    lines = [heading]
    for emp, lv in employees_leaves:
        name = nf.employee_name(emp, lang)
        span = f"{nf.fmt_date(lv.start_date)} → {nf.fmt_date(lv.end_date)}"
        lines.append(f"• {name} — {span}")
    return "\n".join(lines)


def build_unit_digest(db: Session, duty_unit: str, month: date) -> list[tuple[Employee, Leave]]:
    ms, me = month_bounds(month)
    leaves = leave_service.list_annual_overlapping(
        db, month_start=ms, month_end=me, duty_unit=duty_unit
    )
    pairs: list[tuple[Employee, Leave]] = []
    for lv in leaves:
        emp = db.get(Employee, lv.employee_id)
        if emp is not None:
            pairs.append((emp, lv))
    return pairs
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digest_service_render.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/digest_service.py backend/tests/test_digest_service_render.py
git commit -m "feat(notify): digest_service render + per-unit annual-leave build"
```

---

### Task 8: `digest_service` — send per unit + all units (with skip logging)

**Files:**
- Modify: `backend/app/services/digest_service.py`
- Test: `backend/tests/test_digest_service_send.py`

**Interfaces:**
- Consumes: `duty_supervisor_service.resolve_supervisors`, `notify_dispatch.send_direct`, `build_unit_digest`, `render_leave_digest`.
- Produces (dataclasses + functions):
  - `@dataclass DigestSkip{ duty_unit: str, reason: str }` (reasons: `"no_supervisor"`, `"no_leaves"`).
  - `@dataclass DigestRunResult{ sent: int, messages: list[int], skips: list[DigestSkip] }`.
  - `send_unit_digest(db, duty_unit, *, month, sent_by) -> DigestRunResult` — resolve supervisors; skip (logged) if none or no qualifying leaves; else render per recipient `msg_language` and send via `send_direct`; event_type `"leave_digest"`, event_ref `f"leave_digest:{month:%Y-%m}:{duty_unit}"[:64]`.
  - `send_all_digests(db, *, month, sent_by) -> DigestRunResult` — union of every mapped `duty_unit`; aggregates results/skips.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_digest_service_send.py
from datetime import date
from types import SimpleNamespace

from app.db.models import Employee, Leave
from app.services import digest_service as ds
from app.services import duty_supervisor_service as dsv


def _emp(db, id_, unit, post, contact="0501112222"):
    db.add(Employee(id=id_, name_ar="ع", name_en="X", status="Active",
                    duty_unit=unit, duty_post=post, contact=contact, msg_language="ar"))
    db.commit()


def _leave(db, id_, emp, s, e):
    db.add(Leave(id=id_, employee_id=emp, leave_type="annual leave", start_date=s, end_date=e, status="Approved", days=1))
    db.commit()


def _stub_send(monkeypatch):
    calls = []
    def fake(db, *, employee, body, language, event_type, event_ref, sent_by):
        calls.append(SimpleNamespace(employee=employee, body=body, event_ref=event_ref))
        return SimpleNamespace(id=len(calls))
    monkeypatch.setattr(ds.notify_dispatch, "send_direct", fake)
    return calls


def test_send_unit_digest_sends_to_each_supervisor(db_session, monkeypatch):
    calls = _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "SUP", "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "EMP", "السرية الأولى", "جندي")
    _leave(db_session, 1, "EMP", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_unit_digest(db_session, "السرية الأولى", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 1
    assert len(calls) == 1
    assert calls[0].employee.id == "SUP"
    assert "leave_digest:2026-07:" in calls[0].event_ref


def test_send_unit_digest_skips_when_no_supervisor(db_session, monkeypatch):
    _stub_send(monkeypatch)
    _emp(db_session, "EMP", "دعم 1", "جندي")
    _leave(db_session, 1, "EMP", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_unit_digest(db_session, "دعم 1", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 0
    assert [s.reason for s in res.skips] == ["no_supervisor"]


def test_send_unit_digest_skips_when_no_leaves(db_session, monkeypatch):
    _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "SUP", "السرية الأولى", "مسؤول سرية")
    res = ds.send_unit_digest(db_session, "السرية الأولى", month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 0
    assert [s.reason for s in res.skips] == ["no_leaves"]


def test_send_all_digests_covers_every_mapped_unit(db_session, monkeypatch):
    calls = _stub_send(monkeypatch)
    dsv.add_mapping(db_session, "السرية الأولى", "مسؤول سرية")
    dsv.add_mapping(db_session, "السرية الثانية", "مسؤول سرية")
    _emp(db_session, "S1", "السرية الأولى", "مسؤول سرية")
    _emp(db_session, "S2", "السرية الثانية", "مسؤول سرية")
    _emp(db_session, "E1", "السرية الأولى", "جندي")
    _leave(db_session, 1, "E1", date(2026, 7, 5), date(2026, 7, 9))
    res = ds.send_all_digests(db_session, month=date(2026, 7, 1), sent_by=None)
    assert res.sent == 1
    assert any(s.reason == "no_leaves" and s.duty_unit == "السرية الثانية" for s in res.skips)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digest_service_send.py -v`
Expected: FAIL (`send_unit_digest` missing).

- [ ] **Step 3: Implement send + all**

Add imports and code to `digest_service.py`:
```python
from dataclasses import dataclass, field

from sqlalchemy import select

from app.db.models import DutySupervisor
from app.services import duty_supervisor_service, notify_dispatch


@dataclass
class DigestSkip:
    duty_unit: str
    reason: str  # "no_supervisor" | "no_leaves"


@dataclass
class DigestRunResult:
    sent: int = 0
    messages: list[int] = field(default_factory=list)
    skips: list[DigestSkip] = field(default_factory=list)


def send_unit_digest(
    db: Session, duty_unit: str, *, month: date, sent_by: int | None
) -> DigestRunResult:
    res = DigestRunResult()
    supervisors = duty_supervisor_service.resolve_supervisors(db, duty_unit)
    if not supervisors:
        res.skips.append(DigestSkip(duty_unit, "no_supervisor"))
        return res
    pairs = build_unit_digest(db, duty_unit, month)
    if not pairs:
        res.skips.append(DigestSkip(duty_unit, "no_leaves"))
        return res
    ref = f"leave_digest:{month:%Y-%m}:{duty_unit}"[:64]
    for sup in supervisors:
        lang = "ar" if (sup.msg_language or "ar") == "ar" else "en"
        body = render_leave_digest(duty_unit, month, pairs, lang)
        msg = notify_dispatch.send_direct(
            db, employee=sup, body=body, language=lang,
            event_type="leave_digest", event_ref=ref, sent_by=sent_by,
        )
        res.sent += 1
        res.messages.append(msg.id)
    return res


def send_all_digests(db: Session, *, month: date, sent_by: int | None) -> DigestRunResult:
    units = list(db.scalars(select(DutySupervisor.duty_unit).distinct()))
    agg = DigestRunResult()
    for unit in units:
        r = send_unit_digest(db, unit, month=month, sent_by=sent_by)
        agg.sent += r.sent
        agg.messages.extend(r.messages)
        agg.skips.extend(r.skips)
    return agg
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digest_service_send.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/digest_service.py backend/tests/test_digest_service_send.py
git commit -m "feat(notify): digest send per unit + all-units with skip logging"
```

---

### Task 9: Scheduler — monthly digest cron job (1st of month, 08:00 Asia/Dubai)

**Files:**
- Modify: `backend/app/services/scheduler_service.py`
- Test: `backend/tests/test_scheduler_digest.py`

**Interfaces:**
- Consumes: `digest_service.send_all_digests`, `SessionLocal` (the same DB-session helper the other scheduler workers use — match the existing pattern in this file).
- Produces:
  - module constant `_DIGEST_JOB_ID = "monthly_leave_digest"`.
  - `_run_monthly_digest() -> None` — opens a session, calls `send_all_digests(db, month=date.today(), sent_by=None)`, logs the result; no-ops (returns) when neither channel is enabled. Never raises out (wrap in try/except + `log.exception`, mirroring the other workers).
  - a `CronTrigger(day=1, hour=8, minute=0, timezone="Asia/Dubai")` job registered in `start()`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_scheduler_digest.py
from types import SimpleNamespace

from app.services import scheduler_service as sched


def test_run_monthly_digest_noops_without_channel(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(sched, "get_settings", lambda: SimpleNamespace(openwa_enabled=False, sms_enabled=False))

    def fake_all(*a, **k):
        called["n"] += 1
        return SimpleNamespace(sent=0, messages=[], skips=[])

    monkeypatch.setattr(sched.digest_service, "send_all_digests", fake_all)
    sched._run_monthly_digest()
    assert called["n"] == 0  # skipped before opening a session


def test_run_monthly_digest_calls_send_all_when_enabled(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(sched, "get_settings", lambda: SimpleNamespace(openwa_enabled=True, sms_enabled=False))
    monkeypatch.setattr(sched, "_session_scope", _fake_session_scope)  # match this file's session helper name

    def fake_all(db, *, month, sent_by):
        called["n"] += 1
        return SimpleNamespace(sent=2, messages=[1, 2], skips=[])

    monkeypatch.setattr(sched.digest_service, "send_all_digests", fake_all)
    sched._run_monthly_digest()
    assert called["n"] == 1
```
(`_fake_session_scope` = a contextmanager yielding a dummy `SimpleNamespace()`; adapt to whatever session helper the other `_run_*` workers use — read the top of `scheduler_service.py` first and mirror it exactly.)

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_digest.py -v`
Expected: FAIL (`_run_monthly_digest` missing).

- [ ] **Step 3: Implement**

At the top of `scheduler_service.py` add `from apscheduler.triggers.cron import CronTrigger`, `from datetime import date`, `from app.services import digest_service`, and constants:
```python
_DIGEST_JOB_ID = "monthly_leave_digest"
```
Add the worker (mirror the session-handling + try/except of the neighboring `_run_*` functions):
```python
def _run_monthly_digest() -> None:
    """Send the annual-leave digest to every mapped unit's supervisors."""
    cfg = get_settings()
    if not (cfg.openwa_enabled or cfg.sms_enabled):
        return
    try:
        with _session_scope() as db:  # match the file's actual session helper
            result = digest_service.send_all_digests(db, month=date.today(), sent_by=None)
        log.info(
            "scheduler: monthly leave digest sent=%d skips=%d", result.sent, len(result.skips)
        )
    except Exception:
        log.exception("scheduler: monthly leave digest failed")
```
Register in `start()` alongside the other `add_job` calls:
```python
            _scheduler.add_job(
                _run_monthly_digest,
                trigger=CronTrigger(day=1, hour=8, minute=0, timezone="Asia/Dubai"),
                id=_DIGEST_JOB_ID,
                replace_existing=True,
            )
            log.info("scheduler: monthly leave digest on the 1st at 08:00 Asia/Dubai")
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scheduler_digest.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scheduler_service.py backend/tests/test_scheduler_digest.py
git commit -m "feat(notify): monthly leave-digest cron (1st 08:00 Asia/Dubai)"
```

---

### Task 10: Digest API — preview + send routes + type resync

**Files:**
- Create: `backend/app/schemas/digest.py`
- Create: `backend/app/api/v1/digests.py`
- Modify: `backend/app/main.py` (mount)
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts`
- Test: `backend/tests/test_digests_api.py`

**Interfaces:**
- Consumes: `digest_service`, `require_capability("settings.edit")`, `get_db`.
- Produces routes (prefix `/digests`):
  - `GET /leave/preview?duty_unit=<u>` → `DigestPreview{ duty_unit, month, count, sample_ar, sample_en }` (rendered from `build_unit_digest`; does not send).
  - `POST /leave/send` (`DigestSendRequest{ duty_unit: str | None }`) → `DigestSendResult{ sent, skips: list[{duty_unit, reason}] }`. `duty_unit=None` ⇒ all units.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_digests_api.py
from datetime import date

from app.db.models import Employee, Leave
from app.services import duty_supervisor_service as dsv


def _seed(db):
    dsv.add_mapping(db, "السرية الأولى", "مسؤول سرية")
    db.add(Employee(id="SUP", name_ar="س", name_en="Sup", status="Active",
                    duty_unit="السرية الأولى", duty_post="مسؤول سرية", contact="0501112222", msg_language="ar"))
    db.add(Employee(id="EMP", name_ar="ع", name_en="Emp", status="Active",
                    duty_unit="السرية الأولى", duty_post="جندي", contact="0503334444", msg_language="ar"))
    today = date.today()
    db.add(Leave(id=1, employee_id="EMP", leave_type="annual leave",
                 start_date=today.replace(day=1), end_date=today.replace(day=1), status="Approved", days=1))
    db.commit()


def test_preview_reports_count(admin_client, db_session):
    _seed(db_session)
    r = admin_client.get("/api/v1/digests/leave/preview", params={"duty_unit": "السرية الأولى"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 1
    assert "السرية الأولى" in body["sample_ar"]


def test_send_all_returns_result(admin_client, db_session, monkeypatch):
    # Enable a channel + stub the transport so no real send happens.
    from app.services import notify_dispatch
    monkeypatch.setattr(notify_dispatch, "get_settings", lambda: __import__("types").SimpleNamespace(
        openwa_enabled=False, sms_enabled=True, sms_country_code="971"))
    monkeypatch.setattr(notify_dispatch.sms_client, "send",
                        lambda p, b: __import__("types").SimpleNamespace(ok=True, message_id="m", error=None))
    _seed(db_session)
    r = admin_client.post("/api/v1/digests/leave/send", json={"duty_unit": "السرية الأولى"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1


def test_send_requires_settings_edit(client):
    r = client.post("/api/v1/digests/leave/send", json={"duty_unit": None})
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digests_api.py -v`
Expected: FAIL (404).

- [ ] **Step 3: Schemas**

```python
# backend/app/schemas/digest.py
from __future__ import annotations

from pydantic import BaseModel


class DigestPreview(BaseModel):
    duty_unit: str
    month: str  # "YYYY-MM"
    count: int
    sample_ar: str
    sample_en: str


class DigestSendRequest(BaseModel):
    duty_unit: str | None = None


class DigestSkipOut(BaseModel):
    duty_unit: str
    reason: str


class DigestSendResult(BaseModel):
    sent: int
    skips: list[DigestSkipOut]
```

- [ ] **Step 4: Router**

```python
# backend/app/api/v1/digests.py
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_capability
from app.db.models import User
from app.schemas.digest import (
    DigestPreview,
    DigestSendRequest,
    DigestSendResult,
    DigestSkipOut,
)
from app.services import digest_service as ds

router = APIRouter(prefix="/digests", tags=["digests"])


@router.get("/leave/preview", response_model=DigestPreview)
def preview_leave_digest(
    duty_unit: str,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DigestPreview:
    month = date.today()
    pairs = ds.build_unit_digest(db, duty_unit, month)
    return DigestPreview(
        duty_unit=duty_unit,
        month=f"{month:%Y-%m}",
        count=len(pairs),
        sample_ar=ds.render_leave_digest(duty_unit, month, pairs, "ar"),
        sample_en=ds.render_leave_digest(duty_unit, month, pairs, "en"),
    )


@router.post("/leave/send", response_model=DigestSendResult)
def send_leave_digest(
    payload: DigestSendRequest,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("settings.edit"))],
) -> DigestSendResult:
    month = date.today()
    if payload.duty_unit:
        res = ds.send_unit_digest(db, payload.duty_unit, month=month, sent_by=_user.id)
    else:
        res = ds.send_all_digests(db, month=month, sent_by=_user.id)
    return DigestSendResult(
        sent=res.sent,
        skips=[DigestSkipOut(duty_unit=s.duty_unit, reason=s.reason) for s in res.skips],
    )
```
Mount in `main.py` as with Task 3.

- [ ] **Step 5: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_digests_api.py -v`
Expected: PASS.

- [ ] **Step 6: Resync types + commit**

```bash
# resync (as Task 3 Step 7)
git add backend/app/schemas/digest.py backend/app/api/v1/digests.py backend/app/main.py backend/tests/test_digests_api.py backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(notify): leave-digest preview + send API + type resync"
```

---

### Task 11: Frontend — digest preview + send on the Duty Locations page

**Files:**
- Create: `frontend/src/pages/dutyLocations/LeaveDigestPanel.tsx`
- Modify: `frontend/src/pages/dutyLocations/DutyLocationsPage.tsx` (render for the active unit, near `SupervisorDesignations`)
- Modify: `frontend/src/lib/api.ts` (`previewLeaveDigest`, `sendLeaveDigest`)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/pages/dutyLocations/LeaveDigestPanel.test.tsx`

**Interfaces:**
- Consumes: the `/digests` API (Task 10).
- Produces: `<LeaveDigestPanel unit={string} />` — a "Preview" button (fetches `previewLeaveDigest`, shows count + the recipient-language sample in a read-only box) and a "Send now" button (`sendLeaveDigest({duty_unit})`, shows `sent`/skips result). Bilingual; disabled + hint when no channel enabled is out of scope (server enforces).

- [ ] **Step 1: Add i18n keys (both files, full parity)**

```jsonc
// en.json → "leaveDigest"
"leaveDigest": {
  "title": "Annual-leave digest",
  "subtitle": "Send this unit's supervisors a list of who's on annual leave this month",
  "preview": "Preview",
  "sendNow": "Send now",
  "count": "{{count}} on annual leave this month",
  "sent": "Sent to {{count}} supervisor(s)",
  "skipped": "Skipped: {{reason}}",
  "noSupervisor": "no supervisor configured",
  "noLeaves": "no annual leave this month"
}
```
```jsonc
// ar.json → "leaveDigest"
"leaveDigest": {
  "title": "ملخص الإجازات السنوية",
  "subtitle": "أرسل لمشرفي هذه الوحدة قائمة بمن هم في إجازة سنوية هذا الشهر",
  "preview": "معاينة",
  "sendNow": "إرسال الآن",
  "count": "{{count}} في إجازة سنوية هذا الشهر",
  "sent": "أُرسل إلى {{count}} مشرف",
  "skipped": "تم التخطي: {{reason}}",
  "noSupervisor": "لا يوجد مشرف مُعرّف",
  "noLeaves": "لا توجد إجازات سنوية هذا الشهر"
}
```

- [ ] **Step 2: Write the failing test**

```tsx
// frontend/src/pages/dutyLocations/LeaveDigestPanel.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LeaveDigestPanel } from "./LeaveDigestPanel";

vi.mock("../../lib/api", () => ({
  previewLeaveDigest: vi.fn().mockResolvedValue({
    duty_unit: "السرية الأولى", month: "2026-07", count: 2,
    sample_ar: "الإجازات السنوية…", sample_en: "Annual leave…",
  }),
  sendLeaveDigest: vi.fn().mockResolvedValue({ sent: 1, skips: [] }),
}));

describe("LeaveDigestPanel", () => {
  it("shows the count after preview", async () => {
    renderWithProviders(<LeaveDigestPanel unit="السرية الأولى" />);
    await userEvent.click(screen.getByRole("button", { name: /معاينة|Preview/ }));
    expect(await screen.findByText(/2/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -C frontend exec vitest run src/pages/dutyLocations/LeaveDigestPanel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement panel + api client**

Add to `api.ts`:
```ts
export const previewLeaveDigest = (dutyUnit: string) =>
  apiGet<DigestPreview>(`/api/v1/digests/leave/preview?duty_unit=${encodeURIComponent(dutyUnit)}`);
export const sendLeaveDigest = (dutyUnit: string | null) =>
  apiPost<DigestSendResult>("/api/v1/digests/leave/send", { duty_unit: dutyUnit });
```
Create `LeaveDigestPanel.tsx`: title/subtitle from `useTranslation("leaveDigest")`; a Preview button (`useMutation`/lazy `useQuery` → `previewLeaveDigest(unit)`) rendering `count` + a read-only `<pre dir="auto">` of the recipient sample; a "Send now" button (`useMutation` → `sendLeaveDigest(unit)`) rendering the `sent` count and any skips (map `reason` → `noSupervisor`/`noLeaves` labels). Logical CSS; `dir="auto"` on the rendered Arabic/English sample box.

- [ ] **Step 5: Wire into the page + typecheck**

Render `<LeaveDigestPanel unit={activeUnit} />` under `SupervisorDesignations` in `DutyLocationsPage.tsx` (skip for the "Unassigned" pseudo-unit).
Run: `pnpm -C frontend exec tsc -b --noEmit` → clean.

- [ ] **Step 6: Run tests**

Run: `pnpm -C frontend exec vitest run src/pages/dutyLocations/LeaveDigestPanel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Bilingual review + commit**

Run `i18n-rtl-reviewer` + `notification-template-reviewer` on the diff; fix findings.
```bash
git add frontend/src/pages/dutyLocations/LeaveDigestPanel.tsx frontend/src/pages/dutyLocations/DutyLocationsPage.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json frontend/src/pages/dutyLocations/LeaveDigestPanel.test.tsx
git commit -m "feat(notify): leave-digest preview + send panel on Duty Locations page"
```

---

### Task 12: Finalization — full gates + reviews + branch wrap-up

**Files:** none (verification + review only).

- [ ] **Step 1: Full backend gates**

Run: `venv\Scripts\python.exe -m pytest`
Expected: all green (existing 345 + the ~20 new tests).
Run: `venv\Scripts\mypy.exe`
Expected: **no NEW errors** beyond the 47-error baseline (compare counts; investigate any delta in the new files).
Run: `venv\Scripts\ruff.exe check backend/app/services/duty_supervisor_service.py backend/app/services/digest_service.py backend/app/api/v1/duty_supervisors.py backend/app/api/v1/digests.py backend/app/schemas/duty_supervisor.py backend/app/schemas/digest.py` and `venv\Scripts\ruff.exe format --check` on the same set.
Expected: clean.

- [ ] **Step 2: Full frontend gates**

Run: `pnpm -C frontend exec tsc -b --noEmit` → clean.
Run: `pnpm -C frontend test` → all green.
Run: `pnpm -C frontend run lint` → clean on touched files.

- [ ] **Step 3: Reviewer agents**

Dispatch: `alembic-migration-reviewer` (migration 0052), `i18n-rtl-reviewer` + `notification-template-reviewer` (all bilingual + digest copy). Address findings.

- [ ] **Step 4: Whole-branch code review**

Use `superpowers:requesting-code-review` on the full branch diff; address blocking findings.

- [ ] **Step 5: Merge + push (per finishing-a-development-branch)**

Merge the worktree branch into `main`, regenerate `api.types.ts` on merge if needed (never `checkout --ours` on `api.types.ts`), run the full suite once more on `main`, then **push to `origin/main`** (this checkout is live). Digest/mapping stay dormant until a channel is enabled.

---

## Self-Review (against the Phase 2 spec §2a/§2b)

- **§2a `duty_supervisors` table** → Task 1. **Designation resolution at send** → Task 2 `resolve_supervisors`. **Seed mapping** → Task 1 migration `_SEED` (7 rows, verbatim from spec). **Managed on Duty Locations page** → Task 4.
- **§2b digest content (per unit, name + dates, bilingual, recipient `msg_language`)** → Tasks 7 (render) + 8 (per-recipient lang). **Triggers: on-demand + monthly auto (1st)** → Task 10 (send) + Task 9 (cron, 08:00 Asia/Dubai per the locked decision). **Skips logged, never silent** (`no_supervisor`, `no_leaves`, no-valid-mobile) → Task 2 filters out no-mobile supervisors (so a unit with only unreachable supervisors yields `no_supervisor`); Task 8 logs `no_supervisor`/`no_leaves`. **Extensible digest layer** → Task 7 render helpers documented as reusable.
- **Rides the Phase 1 router (inherits delivery/fallback)** → Task 5 `send_direct` routes through `_try_whatsapp`/`_send_sms`; each digest message is an `OutboundMessage` row polled by the existing delivery poller.
- **Type consistency:** `resolve_supervisors` (Task 2) → used by `send_unit_digest` (Task 8); `send_direct` signature (Task 5) matches the call in Task 8 and the stub in its test; `build_unit_digest`/`render_leave_digest` (Task 7) consumed by Task 8 + Task 10. `DigestRunResult.sent/skips` (Task 8) consumed by Task 10 `DigestSendResult`.
- **Deferred to Plan B (2c broadcast):** `broadcasts` table, `broadcast_id` on `outbound_messages`, `messages.broadcast` capability, audience selectors, throttled fan-out, dashboard — NOT in this plan.

**Note on `broadcast_id`:** Plan B (2c) will add a `broadcast_id` column to `outbound_messages` and a `broadcast_id` kwarg to `send_direct`. This plan intentionally omits both to keep 2a/2b shippable on their own.
