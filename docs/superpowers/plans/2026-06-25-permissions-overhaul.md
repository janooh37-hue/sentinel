# Permissions Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let employees request permissions they lack (admin grants once/permanent/refuse) and give admins an explained, expiry-aware permission editor.

**Architecture:** A capability registry gains plain-language descriptions; per-user grants gain an optional `expires_at` (with a sweep that revokes expired ones); a new `permission_requests` entity carries employee asks to admins via the existing push system; the frontend shows blocked controls as lock-to-request affordances and an explained admin editor replaces the side panel.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (SQLite) + Alembic; React + TypeScript + React Query + react-router; pytest (backend, `backend/tests`) + vitest (frontend); `pywebpush` for notifications.

## Global Constraints

- Live production checkout: every change must be committed AND pushed to `origin/main` (a pull overwrites uncommitted work). Backend code changes require `mng restart`; frontend changes require `mng build`.
- Keep `mng.ps1` and any PowerShell ASCII-only.
- Migrations are applied manually from repo root: `./venv/Scripts/python.exe -m alembic upgrade head`. Live DB is at `0041_push_notify_state`; new migration is `0042`.
- Sensitive caps `users.manage`, `system.admin` are never grantable via override, never requestable (existing `_SENSITIVE_CAPS` guard in `perm_service.set_user_override`).
- Admins resolve to ALL capabilities (lockout protection) and are found via `select(User).where(User.role == ADMIN_ROLE, User.status == "active")` (`ADMIN_ROLE` from `app.core.roles`).
- i18n: every user-facing string added to BOTH `frontend/src/locales/en.json` and `ar.json`.
- Capability descriptions are authored in English in `core/permissions.py`; Arabic descriptions live in `ar.json` keyed by capability id.
- TDD: write the failing test first; backend tests under `backend/tests/`, frontend under `*.test.tsx` next to the component. Commit per task.

---

## Phase 0: Test harness

### Task 0: Backend pytest fixtures

**Files:**
- Create: `backend/tests/__init__.py` (empty)
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Produces: pytest fixture `db_session` → a `sqlalchemy.orm.Session` bound to a fresh in-memory SQLite DB with all tables created and role defaults seeded; helper `make_user(db, *, role="operator", status="active", email=...) -> User`.

- [ ] **Step 1: Write the fixture file**

```python
# backend/tests/conftest.py
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas
from app.services import perm_service


@pytest.fixture()
def db_session(monkeypatch) -> Session:
    # A single shared in-memory connection so the schema survives across calls.
    eng = create_engine("sqlite://", future=True)
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    # Point app code (services) at this engine/session factory.
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()


def make_user(db: Session, *, role="operator", status="active", email="u@x.ae") -> User:
    u = User(email=email, password_hash="x", role=role, status=status)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u
```

- [ ] **Step 2: Verify collection works**

Run: `./venv/Scripts/python.exe -m pytest backend/tests -q`
Expected: `no tests ran` (0 collected, no errors).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/__init__.py backend/tests/conftest.py
git commit -m "test: backend pytest fixtures (in-memory db_session)"
```

---

## Phase 1: Foundation (descriptions, expiry, sweep, 403 detail)

### Task 1: Capability descriptions

**Files:**
- Modify: `backend/app/core/permissions.py:19-55`
- Test: `backend/tests/test_permissions_catalog.py`

**Interfaces:**
- Produces: `Capability` NamedTuple gains `description: str` (5th field). All 22 `CAPABILITIES` entries get a description.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_permissions_catalog.py
from app.core.permissions import CAPABILITIES


def test_every_capability_has_a_nonempty_description():
    for cap in CAPABILITIES:
        assert cap.description and len(cap.description) > 10, cap.id
```

- [ ] **Step 2: Run it — fails**

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_permissions_catalog.py -q`
Expected: AttributeError (`Capability` has no `description`).

- [ ] **Step 3: Add the field + descriptions**

In `permissions.py`, change the NamedTuple:

```python
class Capability(NamedTuple):
    id: str
    domain: str
    label: str
    description: str
```

Replace each entry with a 4-arg form, e.g.:

```python
CAPABILITIES: Final[tuple[Capability, ...]] = (
    Capability("app.access", "app", "Access the app", "Sign in and see the dashboard, document fields, and read-only chrome."),
    Capability("employees.view", "employees", "View employees", "See the employee directory and individual employee records."),
    Capability("employees.edit", "employees", "Create / edit employees + vault", "Add and edit employees and manage their document vault."),
    Capability("leaves.view", "leaves", "View leaves", "See leave records and their status."),
    Capability("leaves.edit", "leaves", "Edit / delete leaves", "Create, edit, and delete leave records."),
    Capability("violations.view", "violations", "View violations", "See recorded violations."),
    Capability("violations.manage", "violations", "Create / edit / delete violations", "Record, edit, and remove violations."),
    Capability("documents.generate", "documents", "Generate documents", "Create official documents from templates."),
    Capability("documents.scan", "documents", "Scan documents with OCR", "Upload scans and run OCR to import documents."),
    Capability("books.view", "books", "View books", "Browse the records/books register."),
    Capability("books.manage", "books", "Create / edit / delete books", "Create records, edit them, submit for approval, and delete."),
    Capability("books.approve", "books", "Approve / reject books", "Approve, sign, or reject documents in the approval queue."),
    Capability("ledger.view", "ledger", "View ledger", "Read correspondence ledger entries."),
    Capability("ledger.edit", "ledger", "Edit ledger entries + drafts", "Create and edit ledger entries and email drafts."),
    Capability("ledger.send", "ledger", "Send email from the ledger", "Send email messages from the ledger as yourself."),
    Capability("email.manage", "email", "Manage your mailbox", "Link and sync your own mailbox."),
    Capability("settings.view", "settings", "View settings", "See application settings."),
    Capability("settings.edit", "settings", "Change settings", "Change application settings."),
    Capability("submitters.manage", "submitters", "Manage submitters", "Manage the list of document submitters."),
    Capability("editor_templates.manage", "editor_templates", "Manage editor templates", "Create and edit document editor templates."),
    Capability("users.manage", "users", "Manage users + permissions", "Manage user accounts and their permissions (admin-only)."),
    Capability("system.admin", "system", "Admin key + v3 migration", "Use the admin key and run system/migration tools (admin-only)."),
)
```

- [ ] **Step 4: Run it — passes**

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_permissions_catalog.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/permissions.py backend/tests/test_permissions_catalog.py
git commit -m "feat(perms): add descriptions to the capability catalog"
```

### Task 2: `user_permissions.expires_at` column + model

**Files:**
- Modify: `backend/app/db/models.py` (UserPermission class, ~864-881)
- Create: `backend/app/db/migrations/versions/0042_permission_requests.py`
- Test: `backend/tests/test_perm_expiry.py`

**Interfaces:**
- Produces: `UserPermission.expires_at: Mapped[datetime | None]`; migration `0042_permission_requests` (also creates `permission_requests`, see Task 6 — author both in this one migration file now).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_perm_expiry.py
from datetime import UTC, datetime, timedelta

from app.db.models import UserPermission
from app.services import perm_service
from tests.conftest import make_user


def test_expired_grant_is_ignored(db_session):
    u = make_user(db_session)
    past = datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=past))
    db_session.commit()
    assert "leaves.edit" not in perm_service.effective_caps(db_session, u)


def test_future_grant_is_honored(db_session):
    u = make_user(db_session)
    future = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=future))
    db_session.commit()
    assert "leaves.edit" in perm_service.effective_caps(db_session, u)
```

- [ ] **Step 2: Run it — fails**

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_perm_expiry.py -q`
Expected: TypeError (`expires_at` not a column) — collection/insert error.

- [ ] **Step 3: Add the column to the model**

In `models.py`, inside `UserPermission`, add after `effect`:

```python
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
```

- [ ] **Step 4: Update resolution to honor expiry** (perm_service.effective_caps)

Replace the override loop in `effective_caps`:

```python
    from datetime import UTC, datetime  # at top of file
    now = datetime.now(UTC).replace(tzinfo=None)
    for ov in overrides:
        if ov.effect == "grant":
            if ov.expires_at is not None and ov.expires_at <= now:
                continue  # expired temporary grant
            caps.add(ov.capability)
        elif ov.effect == "deny":
            caps.discard(ov.capability)
```

- [ ] **Step 5: Author migration 0042** (column + the requests table from Task 6)

```python
# backend/app/db/migrations/versions/0042_permission_requests.py
from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0042_permission_requests"
down_revision: str | Sequence[str] | None = "0041_push_notify_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_permissions", sa.Column("expires_at", sa.DateTime(), nullable=True))
    op.create_table(
        "permission_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("decision", sa.String(length=16), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_permission_requests_user_id", "permission_requests", ["user_id"])
    op.create_index("ix_permission_requests_status", "permission_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_permission_requests_status", table_name="permission_requests")
    op.drop_index("ix_permission_requests_user_id", table_name="permission_requests")
    op.drop_table("permission_requests")
    op.drop_column("user_permissions", "expires_at")
```

- [ ] **Step 6: Run tests — pass**

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_perm_expiry.py -q`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add backend/app/db/models.py backend/app/services/perm_service.py backend/app/db/migrations/versions/0042_permission_requests.py backend/tests/test_perm_expiry.py
git commit -m "feat(perms): time-limited grants (user_permissions.expires_at) + honor expiry"
```

### Task 3: `set_user_override` accepts `expires_at` + expiry sweep

**Files:**
- Modify: `backend/app/services/perm_service.py` (`set_user_override`, add `sweep_expired_grants`)
- Test: `backend/tests/test_perm_sweep.py`

**Interfaces:**
- Produces: `set_user_override(db, user_id, cap, effect, *, actor=None, expires_at: datetime | None = None)`; `sweep_expired_grants(db) -> int` (deletes expired grant rows, returns count).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_perm_sweep.py
from datetime import UTC, datetime, timedelta

from app.db.models import UserPermission
from app.services import perm_service
from tests.conftest import make_user


def test_set_override_with_expiry_persists(db_session):
    u = make_user(db_session)
    exp = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=2)
    perm_service.set_user_override(db_session, u.id, "leaves.edit", "grant", expires_at=exp)
    row = db_session.get(UserPermission, (u.id, "leaves.edit"))
    assert row.expires_at == exp


def test_sweep_deletes_only_expired_grants(db_session):
    u = make_user(db_session)
    now = datetime.now(UTC).replace(tzinfo=None)
    db_session.add(UserPermission(user_id=u.id, capability="leaves.edit", effect="grant", expires_at=now - timedelta(minutes=1)))
    db_session.add(UserPermission(user_id=u.id, capability="books.view", effect="grant", expires_at=now + timedelta(hours=1)))
    db_session.add(UserPermission(user_id=u.id, capability="violations.view", effect="grant", expires_at=None))
    db_session.add(UserPermission(user_id=u.id, capability="ledger.send", effect="deny", expires_at=now - timedelta(days=1)))
    db_session.commit()
    n = perm_service.sweep_expired_grants(db_session)
    assert n == 1
    remaining = {r.capability for r in db_session.query(UserPermission).all()}
    assert remaining == {"books.view", "violations.view", "ledger.send"}
```

- [ ] **Step 2: Run — fails** (`sweep_expired_grants` undefined; `expires_at` kw unexpected)

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_perm_sweep.py -q`

- [ ] **Step 3: Implement**

Add `expires_at` param to `set_user_override` and set it on insert/update:

```python
def set_user_override(db, user_id, capability, effect, *, actor=None, expires_at=None):
    ...  # existing validation unchanged
    existing = db.get(UserPermission, (user_id, capability))
    if effect is None:
        if existing is not None:
            db.delete(existing)
    elif existing is None:
        db.add(UserPermission(user_id=user_id, capability=capability, effect=effect, expires_at=expires_at))
    else:
        existing.effect = effect
        existing.expires_at = expires_at
    db.commit()
```

Add the sweep:

```python
from datetime import UTC, datetime
from sqlalchemy import delete

def sweep_expired_grants(db: Session) -> int:
    now = datetime.now(UTC).replace(tzinfo=None)
    res = db.execute(
        delete(UserPermission).where(
            UserPermission.effect == "grant",
            UserPermission.expires_at.is_not(None),
            UserPermission.expires_at <= now,
        )
    )
    db.commit()
    return int(getattr(res, "rowcount", 0) or 0)
```

Add `"sweep_expired_grants"` to `__all__`.

- [ ] **Step 4: Run — pass**

Run: `./venv/Scripts/python.exe -m pytest backend/tests/test_perm_sweep.py -q`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/perm_service.py backend/tests/test_perm_sweep.py
git commit -m "feat(perms): set_user_override expires_at + sweep_expired_grants"
```

### Task 4: Wire the sweep into the scheduler

**Files:**
- Modify: `backend/app/services/scheduler_service.py` (add a job calling `perm_service.sweep_expired_grants`)

**Interfaces:**
- Consumes: `perm_service.sweep_expired_grants`.

- [ ] **Step 1: Add a job body** near `_run_scan_drain`:

```python
from app.services import perm_service  # add to existing import line

def _run_grant_sweep() -> None:
    with SessionLocal() as session:
        try:
            n = perm_service.sweep_expired_grants(session)
            if n:
                log.info("scheduler: revoked %d expired permission grant(s)", n)
        except Exception:
            log.exception("scheduler: grant sweep failed")
```

- [ ] **Step 2: Register it** in `start()` alongside the other `add_job` calls, interval 1 minute, id `"grant-sweep"`. Follow the exact pattern of the existing push-notifier registration (`IntervalTrigger(minutes=1)`).

- [ ] **Step 3: Verify import + syntax**

Run: `./venv/Scripts/python.exe -c "import ast; ast.parse(open('backend/app/services/scheduler_service.py',encoding='utf-8').read()); print('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/scheduler_service.py
git commit -m "feat(perms): sweep expired grants every minute"
```

### Task 5: 403 envelope carries the capability

**Files:**
- Modify: `backend/app/api/deps.py:54-73` (`require_capability`)
- Test: `backend/tests/test_require_capability_envelope.py`

**Interfaces:**
- Produces: the `FORBIDDEN` `AppError` raised by `require_capability` includes `details={"capability": capability}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_require_capability_envelope.py
import pytest
from app.api.errors import AppError
from app.api.deps import require_capability
from app.services import perm_service
from tests.conftest import make_user


def test_missing_cap_error_includes_capability(db_session, monkeypatch):
    dep = require_capability("books.approve")
    user = make_user(db_session, role="operator")
    # Call the dependency's inner function directly with our session + user.
    with pytest.raises(AppError) as ei:
        dep.__wrapped__(user=user, db=db_session) if hasattr(dep, "__wrapped__") else dep(user, db_session)
    assert ei.value.details.get("capability") == "books.approve"
```

> Note: if `require_capability` returns a closure, adjust the call to invoke the closure with `(user, db)`. Read `deps.py:54-73` and call the actual inner dependency function with a user lacking the cap.

- [ ] **Step 2: Run — fails** (details has no `capability`).

- [ ] **Step 3: Add the detail** in `require_capability`'s raise:

```python
raise AppError(
    "FORBIDDEN",
    f"Missing capability: {capability}",
    http_status=403,
    details={"capability": capability},
)
```

- [ ] **Step 4: Run — pass.** **Step 5: Commit**

```bash
git add backend/app/api/deps.py backend/tests/test_require_capability_envelope.py
git commit -m "feat(perms): include missing capability in 403 details"
```

### Task 6: PermissionRequest model + expose descriptions in the catalog API

**Files:**
- Modify: `backend/app/db/models.py` (add `PermissionRequest`; table already in migration 0042)
- Modify: `backend/app/api/v1/auth.py` (`GET /auth/capabilities`, ~310-325 — add `description`)
- Test: `backend/tests/test_capabilities_api_description.py`

**Interfaces:**
- Produces: `PermissionRequest` ORM model (fields per spec table); `GET /auth/capabilities` entries include `description`.

- [ ] **Step 1: Add the model** in `models.py` (mirror existing style):

```python
class PermissionRequest(Base):
    __tablename__ = "permission_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    capability: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, server_default=func.current_timestamp())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        Index("ix_permission_requests_user_id", "user_id"),
        Index("ix_permission_requests_status", "status"),
    )
```

- [ ] **Step 2: Write the failing test** for the catalog description:

```python
# backend/tests/test_capabilities_api_description.py
from app.core.permissions import CAPABILITIES

def test_catalog_payload_builder_includes_description():
    # The route builds dicts from CAPABILITIES; assert the field is available.
    sample = {c.id: c.description for c in CAPABILITIES}
    assert sample["books.approve"]
```

- [ ] **Step 3: Add `description`** to each dict the `GET /auth/capabilities` route returns (read `auth.py:310-325` and include `"description": c.description`). Update its Pydantic response schema (find the `CapabilityCatalogItem`-style model) to add `description: str`.

- [ ] **Step 4: Run** `./venv/Scripts/python.exe -m pytest backend/tests -q` — all green.

- [ ] **Step 5: Apply migration + restart-less check** (foundation is backend-only so far):

```bash
./venv/Scripts/python.exe -m alembic upgrade head
```
Expected: upgrades to `0042_permission_requests`. Verify `permission_requests` table + `user_permissions.expires_at` exist (sqlite `pragma table_info`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/db/models.py backend/app/api/v1/auth.py backend/tests/test_capabilities_api_description.py
git commit -m "feat(perms): PermissionRequest model + descriptions in catalog API"
```

---

## Phase 2: Employee request flow

### Task 7: permission_request_service

**Files:**
- Create: `backend/app/services/permission_request_service.py`
- Test: `backend/tests/test_permission_request_service.py`

**Interfaces:**
- Produces:
  - `WINDOWS: dict[str, timedelta]` = `{"2h": 2h, "today": end-of-day, "week": 7d}` (compute `today` as end of current UTC day).
  - `create_request(db, user, capability) -> PermissionRequest` — validates cap exists + not sensitive + user lacks it + collapses to one pending row; returns the row.
  - `list_pending(db) -> list[PermissionRequest]`.
  - `decide(db, request_id, *, admin, decision, window=None, note=None) -> PermissionRequest` — `permanent`→grant(no expiry); `once`→grant(expiry from window); `refused`→mark refused. Sets decided_by/at.
  - `expires_from_window(window: str) -> datetime`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/test_permission_request_service.py
import pytest
from app.api.errors import AppError
from app.services import permission_request_service as prs, perm_service
from tests.conftest import make_user


def test_create_request_for_missing_cap(db_session):
    u = make_user(db_session, role="operator")
    r = prs.create_request(db_session, u, "books.approve")
    assert r.status == "pending" and r.capability == "books.approve"


def test_cannot_request_cap_already_held(db_session):
    u = make_user(db_session, role="operator")  # operators have books.view
    with pytest.raises(AppError):
        prs.create_request(db_session, u, "books.view")


def test_cannot_request_sensitive_cap(db_session):
    u = make_user(db_session, role="operator")
    with pytest.raises(AppError):
        prs.create_request(db_session, u, "users.manage")


def test_duplicate_request_collapses(db_session):
    u = make_user(db_session, role="operator")
    a = prs.create_request(db_session, u, "books.approve")
    b = prs.create_request(db_session, u, "books.approve")
    assert a.id == b.id


def test_decide_permanent_grants(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="permanent")
    assert "books.approve" in perm_service.effective_caps(db_session, u)
    assert r.status == "granted" and r.decision == "permanent"


def test_decide_once_sets_expiry(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="once", window="2h")
    from app.db.models import UserPermission
    row = db_session.get(UserPermission, (u.id, "books.approve"))
    assert row.expires_at is not None


def test_decide_refuse(db_session):
    u = make_user(db_session, role="operator")
    admin = make_user(db_session, role="admin", email="a@x.ae")
    r = prs.create_request(db_session, u, "books.approve")
    prs.decide(db_session, r.id, admin=admin, decision="refused", note="not now")
    assert r.status == "refused"
    assert "books.approve" not in perm_service.effective_caps(db_session, u)
```

- [ ] **Step 2: Run — fails** (module missing).

- [ ] **Step 3: Implement** `permission_request_service.py`:

```python
from __future__ import annotations
from datetime import UTC, datetime, time, timedelta
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.api.errors import AppError
from app.core.permissions import CAPABILITY_IDS
from app.db.models import PermissionRequest, User
from app.services import perm_service

_SENSITIVE = frozenset({"users.manage", "system.admin"})


def expires_from_window(window: str) -> datetime:
    now = datetime.now(UTC).replace(tzinfo=None)
    if window == "2h":
        return now + timedelta(hours=2)
    if window == "today":
        return datetime.combine(now.date(), time(23, 59, 59))
    if window == "week":
        return now + timedelta(days=7)
    raise AppError("INVALID_WINDOW", f"Unknown window {window!r}", http_status=400)


def create_request(db: Session, user: User, capability: str) -> PermissionRequest:
    if capability not in CAPABILITY_IDS:
        raise AppError("UNKNOWN_CAPABILITY", f"Unknown capability {capability!r}", http_status=400)
    if capability in _SENSITIVE:
        raise AppError("FORBIDDEN_REQUEST", "This permission can't be requested.", http_status=400)
    if perm_service.has_capability(db, user, capability):
        raise AppError("ALREADY_GRANTED", "You already have this permission.", http_status=400)
    existing = db.scalar(
        select(PermissionRequest).where(
            PermissionRequest.user_id == user.id,
            PermissionRequest.capability == capability,
            PermissionRequest.status == "pending",
        )
    )
    if existing is not None:
        existing.created_at = datetime.now(UTC).replace(tzinfo=None)
        db.commit()
        return existing
    row = PermissionRequest(user_id=user.id, capability=capability, status="pending")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_pending(db: Session) -> list[PermissionRequest]:
    return list(db.scalars(
        select(PermissionRequest).where(PermissionRequest.status == "pending").order_by(PermissionRequest.created_at.desc())
    ))


def decide(db, request_id, *, admin, decision, window=None, note=None) -> PermissionRequest:
    row = db.get(PermissionRequest, request_id)
    if row is None or row.status != "pending":
        raise AppError("REQUEST_NOT_PENDING", "Request not found or already decided.", http_status=404)
    target = db.get(User, row.user_id)
    if decision == "permanent":
        perm_service.set_user_override(db, target.id, row.capability, "grant", actor=admin)
        row.status, row.decision = "granted", "permanent"
    elif decision == "once":
        if not window:
            raise AppError("INVALID_WINDOW", "A window is required for a one-time grant.", http_status=400)
        perm_service.set_user_override(db, target.id, row.capability, "grant", actor=admin, expires_at=expires_from_window(window))
        row.status, row.decision = "granted", "once"
    elif decision == "refused":
        row.status, row.decision, row.note = "refused", "refused", note
    else:
        raise AppError("INVALID_DECISION", f"Unknown decision {decision!r}", http_status=400)
    row.decided_by_user_id = admin.id
    row.decided_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return row
```

- [ ] **Step 4: Run — pass.** **Step 5: Commit**

```bash
git add backend/app/services/permission_request_service.py backend/tests/test_permission_request_service.py
git commit -m "feat(perms): permission_request_service (create/list/decide)"
```

### Task 8: Notify admins on a new request

**Files:**
- Create: `backend/app/services/admin_notify.py` (helper `notify_admins_new_request`)
- Modify: `backend/app/services/permission_request_service.py` (call it in `create_request` for NEW rows only)
- Test: `backend/tests/test_admin_notify.py`

**Interfaces:**
- Produces: `admin_notify.active_admins(db) -> list[User]`; `admin_notify.notify_admins_new_request(db, requester, capability_label, request_id) -> None` (best-effort push to each admin).

- [ ] **Step 1: Write the failing test** (no push subscriptions → no error, returns admins):

```python
# backend/tests/test_admin_notify.py
from app.services import admin_notify
from tests.conftest import make_user


def test_active_admins_only(db_session):
    make_user(db_session, role="operator", email="o@x.ae")
    a1 = make_user(db_session, role="admin", email="a1@x.ae")
    make_user(db_session, role="admin", status="disabled", email="a2@x.ae")
    ids = {a.id for a in admin_notify.active_admins(db_session)}
    assert ids == {a1.id}


def test_notify_is_safe_without_subscriptions(db_session):
    a = make_user(db_session, role="admin", email="a@x.ae")
    admin_notify.notify_admins_new_request(db_session, make_user(db_session, email="r@x.ae"), "Approve books", 1)
    # no exception == pass
```

- [ ] **Step 2: Run — fails** (module missing).

- [ ] **Step 3: Implement** `admin_notify.py`:

```python
from __future__ import annotations
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.roles import ADMIN_ROLE
from app.db.models import User
from app.services import push_service

_ACCESS_URL = "/access?tab=permission-requests"  # confirm route in App.tsx


def active_admins(db: Session) -> list[User]:
    return list(db.scalars(select(User).where(User.role == ADMIN_ROLE, User.status == "active")))


def notify_admins_new_request(db, requester, capability_label, request_id) -> None:
    name = requester.display_name or requester.email
    messages = {
        "en": ("GSSG Manager", f"{name} requested '{capability_label}' access"),
        "ar": ("مدير GSSG", f"طلب {name} صلاحية '{capability_label}'"),
    }
    for admin in active_admins(db):
        try:
            push_service.send_to_user(db, admin.id, messages, _ACCESS_URL)
        except Exception:
            pass
```

- [ ] **Step 4: Hook into create_request** — only for a NEWLY created row (not the collapse branch), after `db.refresh(row)`:

```python
    from app.core.permissions import CAPABILITIES
    label = next((c.label for c in CAPABILITIES if c.id == capability), capability)
    from app.services import admin_notify
    admin_notify.notify_admins_new_request(db, user, label, row.id)
```

- [ ] **Step 5: Run — pass.** **Step 6: Commit**

```bash
git add backend/app/services/admin_notify.py backend/app/services/permission_request_service.py backend/tests/test_admin_notify.py
git commit -m "feat(perms): push admins when a permission request arrives"
```

### Task 9: API router for permission requests

**Files:**
- Create: `backend/app/api/v1/permissions.py`
- Create: `backend/app/schemas/permission_request.py`
- Modify: wherever routers are mounted (find the v1 router include in `app/api/v1/__init__.py` or `main.py`) — include the new router.
- Test: `backend/tests/test_permissions_api.py` (use FastAPI `TestClient` with dependency overrides for auth)

**Interfaces:**
- Produces routes (prefix `/permissions`):
  - `POST /permissions/requests` `{capability}` → 201 `PermissionRequestRead` (auth: any signed-in user).
  - `GET /permissions/requests` → `list[PermissionRequestRead]` (auth: `users.manage`).
  - `POST /permissions/requests/{id}/decide` `{decision, window?, note?}` → `PermissionRequestRead` (auth: `users.manage`).
- `PermissionRequestRead`: `{id, user_id, requester_name, capability, capability_label, status, decision, created_at}`.

- [ ] **Step 1: Write schemas** in `schemas/permission_request.py`:

```python
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel

class CreateRequestIn(BaseModel):
    capability: str

class DecideIn(BaseModel):
    decision: str            # 'once' | 'permanent' | 'refused'
    window: str | None = None  # '2h' | 'today' | 'week' (required for 'once')
    note: str | None = None

class PermissionRequestRead(BaseModel):
    id: int
    user_id: int
    requester_name: str
    capability: str
    capability_label: str
    status: str
    decision: str | None
    created_at: datetime
```

- [ ] **Step 2: Write the router** in `api/v1/permissions.py` (mirror `api/v1/push.py` style; use `get_current_user` and `require_capability("users.manage")` from `app.api.deps`). Build `PermissionRequestRead` resolving `requester_name` via `book_service.resolve_user_name_by_id` (or `auth_service`) and `capability_label` from `CAPABILITIES`.

- [ ] **Step 3: Mount the router** next to the existing `push` router include.

- [ ] **Step 4: Write the failing API test**

```python
# backend/tests/test_permissions_api.py
from fastapi.testclient import TestClient
from app.main import create_app
from app.api.deps import get_current_user
from app.db.session import get_db
from tests.conftest import make_user

def _client(db, user):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)

def test_employee_can_create_request(db_session):
    u = make_user(db_session, role="operator")
    c = _client(db_session, u)
    r = c.post("/api/v1/permissions/requests", json={"capability": "books.approve"})
    assert r.status_code == 201
    assert r.json()["capability"] == "books.approve"
```

> Confirm the API mount prefix (`/api/v1`) from `main.py`. Adjust the override for `require_capability("users.manage")` in admin-route tests by signing in an admin user (admins pass the gate).

- [ ] **Step 5: Run — pass.** **Step 6: Commit**

```bash
git add backend/app/api/v1/permissions.py backend/app/schemas/permission_request.py backend/app/api/v1/__init__.py backend/tests/test_permissions_api.py
git commit -m "feat(perms): permission-request API (create/list/decide)"
```

### Task 10: Frontend API client + request dialog + lock-mode gate

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `requestPermission`, `listPermissionRequests`, `decidePermissionRequest`)
- Create: `frontend/src/components/perms/PermissionRequestDialog.tsx`
- Modify: `frontend/src/components/shell/CapabilityGate.tsx` (lock mode)
- Modify: `frontend/src/components/shell/RequireCapability.tsx` (request-access screen)
- Modify: `frontend/src/locales/en.json`, `ar.json`
- Test: `frontend/src/components/perms/PermissionRequestDialog.test.tsx`

**Interfaces:**
- Consumes: `POST /permissions/requests` etc.
- Produces: `CapabilityGate` gains `requestable?: boolean` — when set and the cap is missing, render children wrapped in a lock affordance that opens `PermissionRequestDialog`.

- [ ] **Step 1: API client methods** in `api.ts`:

```ts
requestPermission: (capability: string) =>
  request<unknown>('POST', '/permissions/requests', { capability }),
listPermissionRequests: () =>
  request<PermissionRequestRead[]>('GET', '/permissions/requests'),
decidePermissionRequest: (id: number, body: { decision: string; window?: string; note?: string }) =>
  request<unknown>('POST', `/permissions/requests/${id}/decide`, body),
```
Add the `PermissionRequestRead` type.

- [ ] **Step 2: PermissionRequestDialog** — props `{ capability: string; label: string; description: string; open: boolean; onClose: () => void }`. Body: "You don't have permission to **{label}**. {description} Request access?" with **[Request]** (calls `api.requestPermission`, toast `perms.request.sent`) and **[Close]**. Use `ConfirmDialog`/`AlertDialog` primitives already in the codebase.

- [ ] **Step 3: CapabilityGate lock mode** — when `requestable` and `!has(cap)` and not loading: render

```tsx
<button type="button" className="relative inline-flex items-center gap-1 opacity-70"
  onClick={() => setDialogOpen(true)} aria-label={t('perms.locked', { label })}>
  <Lock className="h-3.5 w-3.5" /> {children}
  <PermissionRequestDialog capability={cap} ... open={dialogOpen} onClose={() => setDialogOpen(false)} />
</button>
```
Resolve `label`/`description` from `api.listCapabilities()` (cached). Sensitive caps (`users.manage`,`system.admin`) fall back to hidden (no lock).

- [ ] **Step 4: RequireCapability screen** — when `!has(cap)`, instead of `<Navigate>`, render a centered "No access to this page" card with a **Request access** button opening the dialog.

- [ ] **Step 5: i18n** — add `perms.locked`, `perms.request.title/body/send/close/pending` to en/ar.

- [ ] **Step 6: Write the vitest** for the dialog (renders label, Request calls api):

```tsx
// PermissionRequestDialog.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
// mock api.requestPermission, assert it's called on Request click
```

- [ ] **Step 7: Run** `cd frontend && npx vitest run src/components/perms` — pass; `npx tsc -b --noEmit` clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/perms frontend/src/components/shell/CapabilityGate.tsx frontend/src/components/shell/RequireCapability.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(perms): request dialog + lock-mode CapabilityGate + blocked-page screen"
```

### Task 11: Apply lock mode at key gated controls

**Files:**
- Modify: call sites that currently use `<CapabilityGate cap="...">` around primary actions (e.g. books approve, leaves edit, violations manage). Add `requestable` to the high-value ones.

- [ ] **Step 1:** Grep `CapabilityGate` usages: `rg "CapabilityGate" frontend/src`. For each primary action button (not nav-only chrome), add `requestable`. Leave purely cosmetic/duplicative gates hidden.
- [ ] **Step 2:** `npx tsc -b --noEmit` clean; spot-check a couple pages render the lock when the cap is absent (manual or a small vitest).
- [ ] **Step 3: Commit** `git commit -m "feat(perms): surface lock-to-request on key gated actions"`

---

## Phase 3: Admin requests tab

### Task 12: Permission requests tab on the Access page

**Files:**
- Modify: `frontend/src/pages/access/AccessRequestsPage.tsx` (add a "Permission requests" tab)
- Create: `frontend/src/components/access/PermissionRequestsTab.tsx`
- Modify: `frontend/src/locales/en.json`, `ar.json`

**Interfaces:**
- Consumes: `api.listPermissionRequests`, `api.decidePermissionRequest`.

- [ ] **Step 1:** Add a tab entry "Permission requests" (gated `users.manage`, like the page). Render `PermissionRequestsTab`.
- [ ] **Step 2:** `PermissionRequestsTab` — `useQuery(['permission-requests'], api.listPermissionRequests)`. Each row: requester name, capability **label + description**, "asked {relative time}", and actions: **Grant once** (a small menu: 2h / today / this week → `decide(id,{decision:'once',window})`), **Grant permanent** (`decide(id,{decision:'permanent'})`), **Refuse** (optional note → `decide(id,{decision:'refused',note})`). On success invalidate `['permission-requests']` and `['user-permissions']`.
- [ ] **Step 3:** i18n keys `access.permReq.*`.
- [ ] **Step 4:** `npx tsc -b --noEmit` + `npx eslint` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(perms): admin Permission requests tab with grant once/permanent/refuse"`

### Task 13: Admin bell item for pending requests (optional, reuse notifier)

**Files:**
- Modify: `backend/app/services/notification_service.py` (`actionable_items` — add admin-only `access_request` items)

- [ ] **Step 1:** In `actionable_items`, if the user is an admin, add one item per pending request (kind `access_request`, ref `access_request:{id}`, url `/access?tab=permission-requests`, label = requester+capability). This makes the scheduler push each new request once (durable ledger already handles dedup).
- [ ] **Step 2:** Add `access_request` to `_KIND_META` in `scheduler_service.py` with localized copy.
- [ ] **Step 3:** `pytest backend/tests -q` green; `ast.parse` ok.
- [ ] **Step 4: Commit** `git commit -m "feat(perms): pending permission requests as admin push items"`

---

## Phase 4: Explained permission editor

### Task 14: Redesign UserPermissionsSheet into the explained editor

**Files:**
- Modify: `frontend/src/components/access/UserPermissionsSheet.tsx` (or replace with `UserPermissionsEditor.tsx` rendered full-width)
- Modify: `backend/app/api/v1/auth.py` (`PUT /auth/users/{id}/permissions` — accept optional `expires_at`)
- Modify: `frontend/src/locales/en.json`, `ar.json`

**Interfaces:**
- Consumes: `api.listCapabilities()` (now with `description`), `api.getUserPermissions(id)`, `api.setUserPermission(id, cap, effect)` — extend to pass `expires_at?`.

- [ ] **Step 1 (backend):** Extend the `SetPermissionRequest` schema + route to accept `expires_at: datetime | None`, passed through to `perm_service.set_user_override(..., expires_at=...)`. Test in `backend/tests/test_set_permission_expiry_api.py`.
- [ ] **Step 2 (frontend):** Replace the cramped sheet body with a grouped layout: iterate capabilities **grouped by `domain`**; per domain a header; per capability a row showing **label + description** and the tri-state Default/Grant/Deny control; for a temporary grant show an "expires {when}" chip with a clear-early action. Admin target users keep disabled controls + "has all" note.
- [ ] **Step 3:** Localize Arabic descriptions via `t('perms.caps.<id>.desc')` with English from the catalog as `defaultValue`.
- [ ] **Step 4:** `npx tsc -b --noEmit` + `npx vitest run` (a render test asserting groups + a description appear) + `npx eslint` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(perms): explained, grouped, expiry-aware permission editor"`

---

## Phase 5: Ship

### Task 15: Migrate, build, deploy, verify

- [ ] **Step 1:** `./venv/Scripts/python.exe -m alembic upgrade head` (idempotent if already at 0042).
- [ ] **Step 2:** Full backend suite: `./venv/Scripts/python.exe -m pytest backend/tests -q` — all green.
- [ ] **Step 3:** `cd frontend && npx vitest run && npx tsc -b --noEmit && npx eslint .` — clean.
- [ ] **Step 4:** `git push origin main`.
- [ ] **Step 5:** `mng build` (frontend) then `mng restart` (backend) — user runs these (UAC). Confirm `mng status` healthy.
- [ ] **Step 6:** Manual smoke: as a non-admin, click a locked action → request dialog → send; as admin, see it in the Permission requests tab + push; grant once (2h) → non-admin can act → after expiry the sweep revokes; open the explained editor and confirm descriptions + grouping.

---

## Self-Review notes

- Spec coverage: descriptions (T1,T6), expires_at + resolution (T2), set_override+sweep (T3,T4), 403 detail (T5), request model/service/api (T6,T7,T9), notify admins (T8,T13), employee lock UI + dialog + blocked page (T10,T11), admin tab (T12), explained editor (T14). All spec sections mapped.
- Sensitive caps blocked at request (T7) and override (existing) — consistent.
- Type consistency: `decision ∈ {once,permanent,refused}`, `window ∈ {2h,today,week}` used identically in service (T7), API schema (T9), and admin tab (T12).
- Known follow-up to confirm during implementation: exact `/api/v1` mount prefix and the Access page route/query-param (`/access?tab=permission-requests`) — read `main.py` and `App.tsx` and adjust the two string literals accordingly.
