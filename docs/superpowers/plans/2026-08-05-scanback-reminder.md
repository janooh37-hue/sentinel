# Scan-back reminder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop signed papers from dying on operators' PCs — find records stuck at `awaiting_scan` past 24h, push their owner once, and give them three places to upload from (a daily gate, an all-day dock, and a `/scan-back` page).

**Architecture:** One backend query (`book_service.list_awaiting_scan`) feeds everything. It plugs into the two notification seams that already exist — `relevant_counts` (bell, over SSE) and `actionable_items` (Web Push, over the 5-minute notifier) — plus one new route `GET /books/awaiting-scan`. Three frontend surfaces all call the same existing upload, `api.addBookAttachment(id, file, true)`. No new table, no migration, no new scheduler job.

**Tech Stack:** FastAPI + SQLAlchemy 2 (SQLite), Pydantic v2, APScheduler; React 19 + TypeScript, React Query, Radix, Tailwind 4, i18next; pytest + vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-scanback-reminder-design.md`
**Mockup:** `docs/scanback-reminder-flow.html` (layout + copy; its *counts* predate the 24h decision — never hardcode a count).

## Global Constraints

- **Live-production checkout.** Work on a feature branch in a worktree (`superpowers:using-git-worktrees`); merge to `main` when done. Do not commit straight to `main`.
- **Capability gate: `books.manage`.** Every personal surface (bell, push, gate, dock, `/scan-back` Mine tab) is gated on it, because `POST /books/{id}/attachments` requires it (`api/v1/books.py:842`). Two live operators hold `documents.generate` without it — nagging them yields a 403 drop target.
- **`Book.created_at` is naive LOCAL time**, stamped by `document_service` with `datetime.now()`. Compare against `datetime.now()`. Using `datetime.now(UTC)` reintroduces the +4h bug fixed in `f111177`.
- **Bilingual:** every new string in BOTH `frontend/src/locales/en.json` and `ar.json`. Arabic count strings need all six plural forms (`_zero`, `_one`, `_two`, `_few`, `_many`, `_other`) — see `nav.bell.awaitingApproval*` for the existing pattern.
- **Logical CSS only** (`ms-`/`me-`, `text-start`, `inset-inline-end`, `rtl:rotate-180`). The dock and gate are position-anchored and will land on the wrong side in Arabic otherwise.
- **Type resync:** after Task 2, dump openapi and run `pnpm gen:api`; commit `backend/openapi.json` + `frontend/src/lib/api.types.ts` together. `mng build` uses the committed types and does NOT regenerate.
- **Gates:** `venv\Scripts\python.exe -m pytest` green; `venv\Scripts\ruff.exe check .` and `ruff format --check .` clean; `venv\Scripts\mypy.exe` clean (strict); `pnpm -C frontend exec tsc -b --noEmit` clean; `pnpm -C frontend run lint` no NEW errors; `pnpm -C frontend test` green. pytest runs with `filterwarnings=error`.
- **Never hardcode a record count** in copy — every count is interpolated.

---

### Task 1: `list_awaiting_scan` — the one query everything reads

**Files:**
- Modify: `backend/app/services/book_service.py` (add after `list_awaiting`, ~line 963)
- Test: `backend/tests/test_scanback_query.py` (create)

**Interfaces:**
- Produces: `book_service.SCANBACK_STALE_HOURS: int` (= 24) and
  `book_service.list_awaiting_scan(db: Session, *, user_id: int | None, stale_hours: int = SCANBACK_STALE_HOURS) -> list[Book]`.
  `user_id=None` returns every user's rows (the Everyone scope). Ordered oldest-first.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scanback_query.py`:

```python
"""TDD: books stranded at awaiting_scan past the stale line.

The stale cutoff must use LOCAL naive time — `Book.created_at` is stamped by
document_service with `datetime.now()`, not UTC (see f111177). A UTC cutoff
would shift every comparison by 4h on this box.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas
from app.services import book_service


@pytest.fixture()
def db(tmp_path) -> Session:
    eng = create_engine(f"sqlite:///{tmp_path / 't.db'}", future=True)
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    s = TS()
    try:
        yield s
    finally:
        s.close()


def _seed(db: Session, *, ref: str, hours_ago: float, owner_id: int, state="awaiting_scan") -> Book:
    cat = db.query(BookCategory).first()
    if cat is None:
        cat = BookCategory(name_en="Cat", name_ar="فئة", code="GS")
        db.add(cat)
        db.flush()
    book = Book(
        category_id=cat.id,
        ref_number=ref,
        subject=f"Subject {ref}",
        approval_state=state,
        created_at=datetime.now() - timedelta(hours=hours_ago),
    )
    db.add(book)
    db.flush()
    db.add(BookVersion(book_id=book.id, version_no=1, status=state,
                       trigger="initial", created_by_user_id=owner_id))
    db.commit()
    return book


@pytest.fixture()
def owner(db: Session) -> User:
    u = User(email="owner@x.ae", password_hash="x", display_name="Owner", role="operator")
    db.add(u)
    other = User(email="other@x.ae", password_hash="x", display_name="Other", role="operator")
    db.add(other)
    db.commit()
    return u


def test_23h_old_is_not_stale_but_25h_is(db, owner):
    _seed(db, ref="GS-0001", hours_ago=23, owner_id=owner.id)
    _seed(db, ref="GS-0002", hours_ago=25, owner_id=owner.id)
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=owner.id)]
    assert refs == ["GS-0002"]


def test_only_the_creator_sees_it(db, owner):
    other_id = owner.id + 1
    _seed(db, ref="GS-0003", hours_ago=48, owner_id=other_id)
    assert book_service.list_awaiting_scan(db, user_id=owner.id) == []
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=None)]
    assert refs == ["GS-0003"]


def test_other_states_and_deleted_are_excluded(db, owner):
    _seed(db, ref="GS-0004", hours_ago=48, owner_id=owner.id, state="approved")
    gone = _seed(db, ref="GS-0005", hours_ago=48, owner_id=owner.id)
    gone.deleted_at = datetime.now()
    db.commit()
    assert book_service.list_awaiting_scan(db, user_id=owner.id) == []


def test_cutoff_is_local_not_utc(db, owner):
    """A 25h-old record stamped in LOCAL time must be stale.

    On a UTC+4 box a `datetime.now(UTC)` cutoff would be 4h behind, so a record
    between 24h and 28h old would wrongly read as fresh. Seeding at 25h makes
    that failure mode explicit.
    """
    _seed(db, ref="GS-0006", hours_ago=25, owner_id=owner.id)
    assert len(book_service.list_awaiting_scan(db, user_id=owner.id)) == 1


def test_oldest_first(db, owner):
    _seed(db, ref="GS-0007", hours_ago=30, owner_id=owner.id)
    _seed(db, ref="GS-0008", hours_ago=200, owner_id=owner.id)
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=owner.id)]
    assert refs == ["GS-0008", "GS-0007"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_query.py -v`
Expected: FAIL — `AttributeError: module 'app.services.book_service' has no attribute 'list_awaiting_scan'`

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/book_service.py`, immediately after `list_awaiting` (ends ~line 963), add:

```python
# Hours a record may sit at `awaiting_scan` before it starts nagging its owner.
# Normal turnaround is same-day, so 24h means "genuinely forgotten", not "in
# transit". Raise this if papers legitimately sit with a manager overnight.
SCANBACK_STALE_HOURS = 24


def list_awaiting_scan(
    db: Session, *, user_id: int | None, stale_hours: int = SCANBACK_STALE_HOURS
) -> list[Book]:
    """Books stranded at ``awaiting_scan`` past the stale line, oldest first.

    ``user_id=None`` returns every user's rows (the Everyone scope); otherwise
    only books whose CURRENT version was created by ``user_id`` — that is the
    person holding the paper. ``submitted_by_user_id`` is NULL on this path and
    must not be used.

    The cutoff is LOCAL naive time on purpose: ``Book.created_at`` is stamped by
    ``document_service`` with ``datetime.now()``, unlike ``Document.created_at``.
    Comparing against ``datetime.now(UTC)`` reintroduces the +4h bug (f111177).
    """
    cutoff = datetime.now() - timedelta(hours=stale_hours)
    stmt = (
        select(Book)
        .options(selectinload(Book.versions))
        .where(Book.deleted_at.is_(None))
        .where(Book.approval_state == "awaiting_scan")
        .where(Book.created_at < cutoff)
        .order_by(Book.created_at)
    )
    out: list[Book] = []
    for book in db.execute(stmt).scalars().all():
        if user_id is None:
            out.append(book)
            continue
        version = _current_version(book)
        if version is not None and version.created_by_user_id == user_id:
            out.append(book)
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_query.py -v`
Expected: 5 passed

Then: `venv\Scripts\ruff.exe check backend/app/services/book_service.py && venv\Scripts\mypy.exe`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_service.py backend/tests/test_scanback_query.py
git commit -m "feat(books): find records stranded at awaiting_scan past 24h"
```

---

### Task 2: Backend contract — route, bell count, type resync

**Files:**
- Modify: `backend/app/api/v1/books.py` (new route, declared BEFORE `/{book_id}`)
- Modify: `backend/app/schemas/notifications.py`
- Modify: `backend/app/services/notification_service.py:168-204` (`relevant_counts`)
- Modify: `backend/openapi.json`, `frontend/src/lib/api.types.ts` (regenerated)
- Test: `backend/tests/test_scanback_api.py` (create)

**Interfaces:**
- Consumes: `book_service.list_awaiting_scan` from Task 1.
- Produces: `GET /api/v1/books/awaiting-scan?scope=mine|all` → `list[BookRead]`, `books.manage`-gated; `NotificationCounts.scanback: int`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scanback_api.py`:

```python
"""TDD: the /books/awaiting-scan route and the scanback bell count.

Both are gated on books.manage — the same capability POST /attachments needs.
A user who can generate a document but not file its signed copy must get a
count of 0 and an empty list, not a nag whose drop target 403s.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import notification_service, perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()
    eng = create_engine(
        f"sqlite:///{tmp_path / 't.db'}", future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TS = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TS)
    db = TS()
    perm_service.seed_role_defaults(db)
    try:
        yield db
    finally:
        db.close()
        get_settings.cache_clear()


def _user(db: Session, *, email: str, role: str) -> User:
    u = User(email=email, password_hash="x", display_name=email, role=role)
    db.add(u)
    db.commit()
    return u


def _stranded(db: Session, *, ref: str, owner_id: int, hours_ago: float = 48) -> Book:
    cat = db.query(BookCategory).first()
    if cat is None:
        cat = BookCategory(name_en="Cat", name_ar="فئة", code="GS")
        db.add(cat)
        db.flush()
    b = Book(category_id=cat.id, ref_number=ref, subject=f"S {ref}",
             approval_state="awaiting_scan",
             created_at=datetime.now() - timedelta(hours=hours_ago))
    db.add(b)
    db.flush()
    db.add(BookVersion(book_id=b.id, version_no=1, status="awaiting_scan",
                       trigger="initial", created_by_user_id=owner_id))
    db.commit()
    return b


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_route_returns_my_stranded_records(api_db):
    mgr = _user(api_db, email="m@x.ae", role="manager")
    _stranded(api_db, ref="GS-0001", owner_id=mgr.id)
    r = _client(api_db, mgr).get("/api/v1/books/awaiting-scan")
    assert r.status_code == 200
    assert [b["ref_number"] for b in r.json()] == ["GS-0001"]


def test_scope_all_shows_other_peoples(api_db):
    mgr = _user(api_db, email="m@x.ae", role="manager")
    other = _user(api_db, email="o@x.ae", role="manager")
    _stranded(api_db, ref="GS-0002", owner_id=other.id)
    c = _client(api_db, mgr)
    assert c.get("/api/v1/books/awaiting-scan").json() == []
    assert [b["ref_number"] for b in c.get("/api/v1/books/awaiting-scan?scope=all").json()] == [
        "GS-0002"
    ]


def test_route_is_books_manage_gated(api_db):
    """An operator (books.view + documents.scan by role, no books.manage) is refused."""
    op = _user(api_db, email="op@x.ae", role="operator")
    r = _client(api_db, op).get("/api/v1/books/awaiting-scan")
    assert r.status_code == 403


def test_awaiting_scan_is_not_swallowed_by_the_int_path_param(api_db):
    """The literal segment must be declared before /{book_id} or it 422s."""
    mgr = _user(api_db, email="m@x.ae", role="manager")
    assert _client(api_db, mgr).get("/api/v1/books/awaiting-scan").status_code == 200


def test_count_is_zero_without_books_manage(api_db):
    op = _user(api_db, email="op@x.ae", role="operator")
    _stranded(api_db, ref="GS-0003", owner_id=op.id)
    counts = notification_service.relevant_counts(api_db, op, precomputed_leaves=0)
    assert counts.scanback == 0


def test_count_reflects_my_stranded_records(api_db):
    mgr = _user(api_db, email="m@x.ae", role="manager")
    _stranded(api_db, ref="GS-0004", owner_id=mgr.id)
    _stranded(api_db, ref="GS-0005", owner_id=mgr.id, hours_ago=2)  # fresh, not counted
    counts = notification_service.relevant_counts(api_db, mgr, precomputed_leaves=0)
    assert counts.scanback == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_api.py -v`
Expected: FAIL — 404 on the route, and `AttributeError: 'NotificationCounts' object has no attribute 'scanback'`

- [ ] **Step 3a: Add the schema field**

In `backend/app/schemas/notifications.py`, add to `NotificationCounts`:

```python
    scanback: int = 0  # my records stranded at awaiting_scan past 24h (books.manage-gated)
```

- [ ] **Step 3b: Fill it in `relevant_counts`**

In `backend/app/services/notification_service.py`, inside `relevant_counts`, after the `approvals` block (~line 194) add:

```python
    # Stranded scan-backs — gated on books.manage for the same reason `approvals`
    # is gated on books.approve: never show a count for an action the user cannot
    # take. POST /books/{id}/attachments requires books.manage, and two live
    # operators hold documents.generate without it.
    if perm_service.has_capability(db, user, "books.manage"):
        scanback = len(book_service.list_awaiting_scan(db, user_id=user.id))
    else:
        scanback = 0
```

and add `scanback=scanback` to the `NotificationCounts(...)` return. Update the docstring's bullet list with:

```
    - scanback:  my books stuck at `awaiting_scan` past 24h (books.manage-gated).
```

- [ ] **Step 3c: Add the route**

In `backend/app/api/v1/books.py`, immediately after the `/awaiting` route (ends ~line 490, before any `/{book_id}` route), add:

```python
@router.get("/awaiting-scan", response_model=list[BookRead])
def list_awaiting_scan(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("books.manage"))],
    scope: Annotated[str, Query(pattern="^(mine|all)$")] = "mine",
) -> list[BookRead]:
    """Records stranded at ``awaiting_scan`` past 24h, oldest first.

    ``scope=mine`` (default) is the caller's own; ``scope=all`` is everyone's,
    so an admin can clear records stranded by a user who lacks books.manage.

    Declared before ``/{book_id}`` so the literal ``awaiting-scan`` segment isn't
    swallowed by the int path param — same reason as ``/awaiting`` above.
    Authority is ``books.manage``: the same capability filing the scan requires.
    """
    rows = book_service.list_awaiting_scan(db, user_id=None if scope == "all" else user.id)
    return [BookRead.model_validate(r) for r in rows]
```

Verify `Query` is already imported from `fastapi` at the top of the file; add it to the import if not.

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_api.py -v`
Expected: 6 passed

Run the full backend suite — the new `NotificationCounts` field must not break existing assertions:
`venv\Scripts\python.exe -m pytest backend/tests/test_notify_api.py -v`
Expected: PASS (the field defaults to 0)

- [ ] **Step 5: Resync the generated contract**

```bash
venv/Scripts/python.exe -c "import json;from app.main import create_app;print(json.dumps(create_app().openapi(),indent=2))" > backend/openapi.json
pnpm -C frontend run gen:api
pnpm -C frontend exec tsc -b --noEmit
```

Confirm `frontend/src/lib/api.types.ts` now contains `scanback` on the notification-counts schema and an `/books/awaiting-scan` path. If the dump command differs from the repo's `/sync-api-types` skill, follow the skill instead.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/books.py backend/app/schemas/notifications.py \
  backend/app/services/notification_service.py backend/tests/test_scanback_api.py \
  backend/openapi.json frontend/src/lib/api.types.ts
git commit -m "feat(api): expose stranded scan-backs as a route and a bell count"
```

---

### Task 3: Push — one notification per person, not per record

**Files:**
- Modify: `backend/app/services/notification_service.py:93-135` (`actionable_items`)
- Modify: `backend/app/services/scheduler_service.py` (`_KIND_META` ~line 181, new `_scanback_push`, `_build_push` ~line 286)
- Test: `backend/tests/test_scanback_push.py` (create)

**Interfaces:**
- Consumes: `book_service.list_awaiting_scan` (Task 1).
- Produces: `ActionableItem(kind="scanback", ref=f"book:{id}", url=f"/books/{id}")`; `scheduler_service._scanback_push(new_items: list, section_url: str) -> tuple[dict, str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scanback_push.py`:

```python
"""TDD: the scan-back Web Push body.

Two things this locks down:
1. `_build_push` must DISPATCH on "scanback". Its fallthrough is `_doc_push`,
   which renders "Signature needed · NAT-0612" — plausible, wrong, and it ships
   green because nothing raises.
2. N stranded records produce ONE push, not N. `_notify_user` groups by kind
   before sending, so the existing 25-record backlog is a single notification.
"""

from __future__ import annotations

from app.services.notification_service import ActionableItem
from app.services import scheduler_service


def _item(ref: str, subject: str | None = None) -> ActionableItem:
    return ActionableItem("scanback", f"book:{ref}", f"/books/{ref}", ref, subject=subject)


def test_single_record_names_the_ref_and_deep_links_to_it():
    messages, url = scheduler_service._build_push(
        "scanback", [_item("NAT-0612", "Violation Form")], "/scan-back"
    )
    en_title, en_body = messages["en"]
    assert "NAT-0612" in en_body
    assert "Violation Form" in en_body
    assert url == "/books/NAT-0612"


def test_single_record_body_is_not_the_approval_copy():
    """Guards the _doc_push fallthrough: 'Signature needed' is the wrong verb."""
    messages, _ = scheduler_service._build_push("scanback", [_item("NAT-0612")], "/scan-back")
    assert "Signature needed" not in messages["en"][1]
    assert "بانتظار توقيعك" not in messages["ar"][1]


def test_many_records_collapse_to_one_counted_body():
    items = [_item(f"NAT-{i:04d}") for i in range(25)]
    messages, url = scheduler_service._build_push("scanback", items, "/scan-back")
    assert "25" in messages["en"][1]
    assert url == "/scan-back"


def test_arabic_body_is_arabic():
    messages, _ = scheduler_service._build_push("scanback", [_item("NAT-0612")], "/scan-back")
    ar_body = messages["ar"][1]
    assert "النسخة" in ar_body
    assert "Signed copy not filed" not in ar_body


def test_kind_meta_points_at_the_scan_back_page():
    assert scheduler_service._KIND_META["scanback"] == "/scan-back"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_push.py -v`
Expected: FAIL — `KeyError: 'scanback'` on `_KIND_META`, and the body assertions fail because `_build_push` falls through to `_doc_push`.

- [ ] **Step 3a: Emit the items**

In `backend/app/services/notification_service.py`, inside `actionable_items`, after the approval-chain loop (~line 109) add:

```python
    # Stranded scan-backs — same books.manage gate as the bell count: a push is
    # only worth sending to someone who can actually file the scan.
    if perm_service.has_capability(db, user, "books.manage"):
        for book in book_service.list_awaiting_scan(db, user_id=user.id):
            items.append(
                ActionableItem(
                    "scanback",
                    f"book:{book.id}",
                    f"/books/{book.id}",
                    book.ref_number or f"#{book.id}",
                    subject=book.subject,
                )
            )
```

Update the `ActionableItem.kind` comment in the dataclass to
`# 'approval' (sign) | 'review' | 'scan' | 'email' | 'scanback'`.

- [ ] **Step 3b: Add the push copy and the dispatch branch**

In `backend/app/services/scheduler_service.py`, add `"scanback": "/scan-back",` to `_KIND_META`, then add this function next to `_scan_push`:

```python
def _scanback_push(new_items: list, section_url: str) -> tuple[dict, str]:
    """Scan-back push — a printed paper was signed but never scanned into the app.

    Deliberately NOT routed through `_doc_push`: that copy says "Signature
    needed", which is the opposite ask. Here the signature already exists on
    paper; what's missing is the upload.
    """
    n = len(new_items)
    if n == 1:
        it = new_items[0]
        subj = f" — {it.subject}" if it.subject else ""
        return (
            _localized(
                f"Signed copy not filed · {it.label}{subj}\nScan it into the record",
                f"لم تُرفع النسخة الموقّعة · {it.label}{subj}\nامسحها وأرفقها بالسجل",
            ),
            it.url,
        )
    return (
        _localized(
            f"{n} records waiting for their signed copy",
            f"{n} سجلات بانتظار نسختها الموقّعة",
        ),
        section_url,
    )
```

In `_build_push`, add the branch BEFORE the `_doc_push` fallthrough:

```python
    if kind == "scanback":
        return _scanback_push(new_items, section_url)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_scanback_push.py backend/tests/test_scheduler_notify.py -v`
Expected: all passed

Run: `venv\Scripts\ruff.exe check . && venv\Scripts\mypy.exe`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/notification_service.py backend/app/services/scheduler_service.py \
  backend/tests/test_scanback_push.py
git commit -m "feat(notify): push stranded scan-backs to whoever printed them"
```

---

### Task 4: Locale keys — all of them, both files, at once

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`
- Test: `frontend/src/locales/scanback.i18n.test.ts` (create)

**Interfaces:**
- Produces: the `scanBack.*` namespace and `nav.scanBack` / `nav.bell.scanBack*`, consumed by Tasks 6–9.

Doing every key up front keeps four UI tasks from each half-adding keys and drifting.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/locales/scanback.i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

type Rec = Record<string, unknown>
const get = (o: Rec, path: string): string =>
  path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o) as string

const KEYS = [
  'nav.scanBack',
  'nav.bell.scanBackTitle',
  'scanBack.title', 'scanBack.blurb', 'scanBack.empty',
  'scanBack.scope.mine', 'scanBack.scope.all',
  'scanBack.sort.oldest', 'scanBack.sort.newest',
  'scanBack.group.overMonth', 'scanBack.group.weeks', 'scanBack.group.recent',
  'scanBack.drop', 'scanBack.filed', 'scanBack.uploadError',
  'scanBack.gate.blurb', 'scanBack.gate.upload', 'scanBack.gate.later', 'scanBack.gate.close',
  'scanBack.dock.header', 'scanBack.dock.expand', 'scanBack.dock.collapse',
]

// Counted strings: EN needs _one/_other, AR needs all six CLDR forms.
const COUNTED = ['nav.bell.scanBack', 'scanBack.age', 'scanBack.gate.title',
                 'scanBack.viewAll', 'scanBack.dock.pill']
const AR_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other']

describe('scan-back i18n parity', () => {
  for (const k of KEYS) {
    it(`${k} exists in both`, () => {
      expect(get(en as unknown as Rec, k)).toBeTruthy()
      expect(get(ar as unknown as Rec, k)).toBeTruthy()
    })
    it(`${k} ar differs from en (no English leak)`, () => {
      expect(get(ar as unknown as Rec, k)).not.toBe(get(en as unknown as Rec, k))
    })
  }

  for (const k of COUNTED) {
    it(`${k} has en _one/_other`, () => {
      expect(get(en as unknown as Rec, `${k}_one`)).toBeTruthy()
      expect(get(en as unknown as Rec, `${k}_other`)).toBeTruthy()
    })
    it(`${k} has all six ar plural forms`, () => {
      for (const f of AR_FORMS) {
        expect(get(ar as unknown as Rec, `${k}_${f}`)).toBeTruthy()
      }
    })
    it(`${k} ar interpolates {{count}}`, () => {
      expect(get(ar as unknown as Rec, `${k}_other`)).toContain('{{count}}')
    })
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/locales/scanback.i18n.test.ts`
Expected: FAIL — every key missing

- [ ] **Step 3a: Add the English keys**

In `frontend/src/locales/en.json`, add `"scanBack"` at the top level (alphabetical among siblings):

```json
"scanBack": {
  "title": "Scan-back",
  "blurb": "Printed, signed, but the scan was never filed. Upload one and the record closes itself.",
  "empty": "Nothing waiting — every signed copy is filed.",
  "age_one": "{{count}} day",
  "age_other": "{{count}} days",
  "viewAll_one": "View all {{count}}",
  "viewAll_other": "View all {{count}}",
  "drop": "Drop the scan here, or click to browse",
  "filed": "Filed — {{ref}} is closed",
  "uploadError": "Could not file that scan",
  "scope": { "mine": "Mine", "all": "Everyone" },
  "sort": { "oldest": "Oldest first", "newest": "Newest first" },
  "group": {
    "overMonth": "Over a month",
    "weeks": "Two to four weeks",
    "recent": "This month"
  },
  "gate": {
    "title_one": "{{count}} record is waiting for its signed copy",
    "title_other": "{{count}} records are waiting for their signed copy",
    "blurb": "You printed these but the scan never made it back. The three oldest:",
    "upload": "Upload",
    "later": "Not now",
    "close": "Dismiss until tomorrow"
  },
  "dock": {
    "pill_one": "{{count}} to scan back",
    "pill_other": "{{count}} to scan back",
    "header": "Waiting for their signed copy",
    "expand": "Show stranded records",
    "collapse": "Hide stranded records"
  }
}
```

Add to the existing `nav` object: `"scanBack": "Scan-back"`, and inside `nav.bell`:

```json
"scanBackTitle": "Signed copy not filed",
"scanBack_one": "{{count}} record needs its signed copy",
"scanBack_other": "{{count}} records need their signed copy"
```

- [ ] **Step 3b: Add the Arabic keys**

In `frontend/src/locales/ar.json`, mirror the structure. Every counted key needs all six CLDR forms — copy the shape of the existing `nav.bell.awaitingApproval_*`:

```json
"scanBack": {
  "title": "النسخ الموقّعة",
  "blurb": "طُبعت ووُقّعت، لكن النسخة الممسوحة لم تُرفع. ارفعها ليُغلق السجل تلقائياً.",
  "empty": "لا يوجد شيء بالانتظار — كل النسخ الموقّعة مرفوعة.",
  "age_zero": "{{count}} يوم",
  "age_one": "يوم واحد",
  "age_two": "يومان",
  "age_few": "{{count}} أيام",
  "age_many": "{{count}} يوماً",
  "age_other": "{{count}} يوم",
  "viewAll_zero": "عرض الكل ({{count}})",
  "viewAll_one": "عرض الكل ({{count}})",
  "viewAll_two": "عرض الكل ({{count}})",
  "viewAll_few": "عرض الكل ({{count}})",
  "viewAll_many": "عرض الكل ({{count}})",
  "viewAll_other": "عرض الكل ({{count}})",
  "drop": "أفلت الملف هنا أو انقر للاختيار",
  "filed": "تم الرفع — أُغلق السجل {{ref}}",
  "uploadError": "تعذّر رفع النسخة الممسوحة",
  "scope": { "mine": "سجلاتي", "all": "الجميع" },
  "sort": { "oldest": "الأقدم أولاً", "newest": "الأحدث أولاً" },
  "group": {
    "overMonth": "أكثر من شهر",
    "weeks": "من أسبوعين إلى شهر",
    "recent": "هذا الشهر"
  },
  "gate": {
    "title_zero": "{{count}} سجل بانتظار نسخته الموقّعة",
    "title_one": "سجل واحد بانتظار نسخته الموقّعة",
    "title_two": "سجلان بانتظار نسختهما الموقّعة",
    "title_few": "{{count}} سجلات بانتظار نسختها الموقّعة",
    "title_many": "{{count}} سجلاً بانتظار نسختها الموقّعة",
    "title_other": "{{count}} سجل بانتظار نسخته الموقّعة",
    "blurb": "تمت طباعتها ولم تُرفَع نسختها الممسوحة. أقدم ثلاثة:",
    "upload": "رفع",
    "later": "ليس الآن",
    "close": "تأجيل حتى الغد"
  },
  "dock": {
    "pill_zero": "{{count}} بانتظار المسح",
    "pill_one": "سجل واحد بانتظار المسح",
    "pill_two": "سجلان بانتظار المسح",
    "pill_few": "{{count}} بانتظار المسح",
    "pill_many": "{{count}} بانتظار المسح",
    "pill_other": "{{count}} بانتظار المسح",
    "header": "بانتظار النسخة الموقّعة",
    "expand": "إظهار السجلات المعلّقة",
    "collapse": "إخفاء السجلات المعلّقة"
  }
}
```

Add to `nav`: `"scanBack": "النسخ الموقّعة"`, and inside `nav.bell`:

```json
"scanBackTitle": "لم تُرفع النسخة الموقّعة",
"scanBack_zero": "{{count}} سجل بحاجة إلى نسخته الموقّعة",
"scanBack_one": "سجل واحد بحاجة إلى نسخته الموقّعة",
"scanBack_two": "سجلان بحاجة إلى نسختهما الموقّعة",
"scanBack_few": "{{count}} سجلات بحاجة إلى نسختها الموقّعة",
"scanBack_many": "{{count}} سجلاً بحاجة إلى نسختها الموقّعة",
"scanBack_other": "{{count}} سجل بحاجة إلى نسخته الموقّعة"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/locales/scanback.i18n.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ar.json \
  frontend/src/locales/scanback.i18n.test.ts
git commit -m "i18n: scan-back strings in en + ar with full Arabic plurals"
```

---

### Task 5: Frontend data layer — one hook every surface shares

**Files:**
- Modify: `frontend/src/lib/api.ts` (next to `listAwaitingBooks`, ~line 1531)
- Create: `frontend/src/pages/scanBack/useScanBack.ts`
- Test: `frontend/src/pages/scanBack/useScanBack.test.tsx` (create)

**Interfaces:**
- Consumes: `GET /books/awaiting-scan` (Task 2), `api.addBookAttachment` (existing).
- Produces:
  - `api.listAwaitingScanBooks(scope?: 'mine' | 'all'): Promise<BookRead[]>`
  - `useScanBack(scope?): { books: BookRead[]; isLoading: boolean; count: number; enabled: boolean }`
  - `useFileSignedCopy(): { file(bookId: number, ref: string, f: File): Promise<void>; busy: boolean }`
  - `ageDays(iso: string): number` and `ageGroup(days): 'overMonth' | 'weeks' | 'recent'`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/scanBack/useScanBack.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { ageDays, ageGroup } from './useScanBack'

describe('ageDays', () => {
  it('reads a naive local timestamp without shifting it', () => {
    // Book.created_at arrives as naive LOCAL time. Appending 'Z' (or letting
    // Date parse it as UTC) would shift it 4h on this box and mis-bucket a
    // record sitting near a group boundary.
    const d = new Date()
    d.setDate(d.getDate() - 10)
    const naive = d.toISOString().slice(0, 19).replace('T', ' ')
    expect(ageDays(naive)).toBe(10)
  })

  it('is 0 for a record created moments ago', () => {
    const naive = new Date().toISOString().slice(0, 19).replace('T', ' ')
    expect(ageDays(naive)).toBe(0)
  })
})

describe('ageGroup', () => {
  it('buckets by the spec boundaries', () => {
    expect(ageGroup(40)).toBe('overMonth')
    expect(ageGroup(30)).toBe('overMonth')
    expect(ageGroup(29)).toBe('weeks')
    expect(ageGroup(14)).toBe('weeks')
    expect(ageGroup(13)).toBe('recent')
    expect(ageGroup(2)).toBe('recent')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/useScanBack.test.tsx`
Expected: FAIL — cannot resolve `./useScanBack`

- [ ] **Step 3a: Add the api helper**

In `frontend/src/lib/api.ts`, next to `listAwaitingBooks` (~line 1531):

```ts
  /** GET /books/awaiting-scan — records stranded at `awaiting_scan` past 24h.
   * `scope='all'` returns everyone's (both scopes need books.manage). */
  listAwaitingScanBooks: (scope: 'mine' | 'all' = 'mine') =>
    request<BookRead[]>('GET', `/books/awaiting-scan?scope=${scope}`),
```

- [ ] **Step 3b: Write the hook**

Create `frontend/src/pages/scanBack/useScanBack.ts`:

```ts
/**
 * Shared data layer for every scan-back surface (page, dock, gate).
 *
 * One query key so filing from any surface refreshes all of them. Gated on
 * `books.manage` — the capability POST /books/{id}/attachments requires. A user
 * without it would get rows whose upload 403s, so they get nothing instead;
 * their stranded records surface under the Everyone scope for an admin.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'

export type AgeGroup = 'overMonth' | 'weeks' | 'recent'

/**
 * Whole days since `iso`, which is a NAIVE LOCAL timestamp from the backend
 * (`Book.created_at` is stamped with `datetime.now()`, not UTC). Normalising
 * the separator keeps Safari from returning NaN on "YYYY-MM-DD HH:MM:SS", and
 * we deliberately do NOT append 'Z' — that would re-introduce the 4h shift.
 */
export function ageDays(iso: string): number {
  const ms = Date.now() - new Date(iso.replace(' ', 'T')).getTime()
  return Math.floor(ms / 86_400_000)
}

export function ageGroup(days: number): AgeGroup {
  if (days >= 30) return 'overMonth'
  if (days >= 14) return 'weeks'
  return 'recent'
}

export function useScanBack(scope: 'mine' | 'all' = 'mine'): {
  books: BookRead[]
  isLoading: boolean
  count: number
  enabled: boolean
} {
  const { has } = useCapabilities()
  const enabled = has('books.manage')
  const query = useQuery({
    queryKey: ['books', 'awaiting-scan', scope],
    queryFn: () => api.listAwaitingScanBooks(scope),
    staleTime: 30_000,
    enabled,
  })
  const books = query.data ?? []
  return { books, isLoading: query.isLoading, count: books.length, enabled }
}

export function useFileSignedCopy(): {
  file: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
} {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  // as_signed=true is the scan-back flip: the backend approves the record.
  // Same call `useAddScan.fileSignedCopy` makes — no OCR ref matching, because
  // the operator picked this record deliberately and OCR cannot be trusted to
  // re-read a stamped ref off a gov-form scan (GS-0333 -> "65-3").
  const mutation = useMutation({
    // `ref` is unused by the call itself — it rides along so onSuccess can name
    // the record in the toast without a second lookup.
    mutationFn: ({ bookId, f }: { bookId: number; ref: string; f: File }) =>
      api.addBookAttachment(bookId, f, true),
    onSuccess: (_data: unknown, vars: { bookId: number; ref: string; f: File }) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      toast.success(t('scanBack.filed', { ref: vars.ref }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return {
    busy,
    file: async (bookId, ref, f) => {
      setBusy(true)
      try {
        await mutation.mutateAsync({ bookId, ref, f })
      } finally {
        setBusy(false)
      }
    },
  }
}
```

Note: `['books', 'awaiting-scan', scope]` is a prefix-match child of `['books']`, so the single `invalidateQueries({ queryKey: ['books'] })` above refreshes both scopes and the Books page at once.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/useScanBack.test.tsx`
Expected: 4 passed

Run: `pnpm -C frontend exec tsc -b --noEmit`
Expected: clean

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/scanBack/useScanBack.ts \
  frontend/src/pages/scanBack/useScanBack.test.tsx
git commit -m "feat(scan-back): shared query + file-signed-copy hook"
```

---

### Task 6: E — the `/scan-back` page

**Files:**
- Create: `frontend/src/pages/scanBack/ScanBackPage.tsx`
- Create: `frontend/src/pages/scanBack/ScanBackRow.tsx`
- Modify: `frontend/src/App.tsx` (lazy import + route, ~line 211)
- Modify: `frontend/src/components/shell/navItems.ts`
- Test: `frontend/src/pages/scanBack/ScanBackPage.test.tsx` (create)

**Interfaces:**
- Consumes: `useScanBack`, `useFileSignedCopy`, `ageDays`, `ageGroup` (Task 5); `scanBack.*` keys (Task 4).
- Produces: route `/scan-back`; `ScanBackRow({ book, onFile, busy })`.

Build this BEFORE the dock and gate — both link to `/scan-back`, so building them first points "View all" at a 404.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/scanBack/ScanBackPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackPage } from './ScanBackPage'

const books = [
  { id: 1, ref_number: 'GS-0410', subject: 'Acknowledgment Form',
    created_at: daysAgo(40), approval_state: 'awaiting_scan' },
  { id: 2, ref_number: 'NAT-0642', subject: 'Warning Form',
    created_at: daysAgo(8), approval_state: 'awaiting_scan' },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (c: string) => c === 'books.manage',
                            capabilities: new Set(['books.manage']), isLoading: false }),
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { listAwaitingScanBooks: vi.fn(async () => books), addBookAttachment: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScanBackPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScanBackPage', () => {
  beforeEach(async () => { await i18n.changeLanguage('en') })

  it('lists stranded records grouped by age', async () => {
    renderPage()
    expect(await screen.findByText('GS-0410')).toBeInTheDocument()
    expect(screen.getByText('NAT-0642')).toBeInTheDocument()
    expect(screen.getByText(/Over a month/i)).toBeInTheDocument()
    expect(screen.getByText(/This month/i)).toBeInTheDocument()
  })

  it('renders the Arabic heading under lng=ar', async () => {
    // An English-only assertion cannot catch an AR leak when the EN label
    // equals the key — that is how the leave-type leak shipped green (c0db9fb).
    await i18n.changeLanguage('ar')
    renderPage()
    expect(await screen.findByText('النسخ الموقّعة')).toBeInTheDocument()
    expect(screen.getByText('أكثر من شهر')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/ScanBackPage.test.tsx`
Expected: FAIL — cannot resolve `./ScanBackPage`

- [ ] **Step 3a: Write the row**

Create `frontend/src/pages/scanBack/ScanBackRow.tsx`:

```tsx
/** One stranded record: ref, subject, age, and a drop target that files it. */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ageDays } from './useScanBack'

export function ScanBackRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const days = ageDays(book.created_at)
  const ref = book.ref_number ?? `#${book.id}`

  const take = (f: File | undefined): void => {
    if (f && !busy) void onFile(book.id, ref, f)
  }

  return (
    <article
      className={cn(
        'mb-2 flex items-center gap-3 rounded-xl border border-hairline bg-surface px-4 py-3',
        days >= 30 && 'border-s-[3px] border-s-accent',
      )}
    >
      <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-1 font-mono text-[0.72em] font-semibold">
        {ref}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.82em] font-semibold text-foreground">{book.subject}</p>
        <p className="text-[0.74em] text-muted-foreground">{t('scanBack.age', { count: days })}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-raised px-3 py-2 text-[0.74em] text-muted-foreground transition-colors',
          'hover:border-info hover:bg-info-soft hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
          over && 'border-info bg-info-soft text-info',
        )}
      >
        <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {t('scanBack.drop')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }}
      />
    </article>
  )
}
```

- [ ] **Step 3b: Write the page**

Create `frontend/src/pages/scanBack/ScanBackPage.tsx`:

```tsx
/**
 * /scan-back — every record whose signed copy never came back.
 *
 * Grouped by age so a 40-day item cannot hide behind a 5-day one. Reached from
 * the sidebar, the daily gate, and the dock.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Printer } from 'lucide-react'
import { cn } from '@/lib/utils'

import { ScanBackRow } from './ScanBackRow'
import { ageDays, ageGroup, useFileSignedCopy, useScanBack, type AgeGroup } from './useScanBack'

const GROUPS: readonly AgeGroup[] = ['overMonth', 'weeks', 'recent']

export function ScanBackPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [newestFirst, setNewestFirst] = useState(false)
  const { books, isLoading } = useScanBack(scope)
  const { file, busy } = useFileSignedCopy()

  const sorted = [...books].sort((a, b) =>
    newestFirst
      ? ageDays(a.created_at) - ageDays(b.created_at)
      : ageDays(b.created_at) - ageDays(a.created_at),
  )
  const inGroup = (g: AgeGroup): BookRead[] =>
    sorted.filter((b) => ageGroup(ageDays(b.created_at)) === g)

  const chip = (on: boolean): string =>
    cn(
      'rounded-full border px-3 py-1 text-[0.74em] transition-colors',
      on
        ? 'border-primary bg-primary font-semibold text-primary-foreground'
        : 'border-border bg-surface text-muted-foreground hover:border-border-strong',
    )

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-b border-border bg-surface px-6 py-5">
        <h1 className="flex items-center gap-3 text-[1.15em] font-bold tracking-tight">
          {t('scanBack.title')}
          {books.length > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-1 font-mono text-[0.62em] font-bold text-accent">
              {books.length}
            </span>
          )}
        </h1>
        <p className="mt-1 text-[0.82em] text-muted-foreground">{t('scanBack.blurb')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={chip(scope === 'mine')} onClick={() => setScope('mine')}>
            {t('scanBack.scope.mine')}
          </button>
          {has('books.manage') && (
            <button type="button" className={chip(scope === 'all')} onClick={() => setScope('all')}>
              {t('scanBack.scope.all')}
            </button>
          )}
          <button
            type="button"
            className={chip(false)}
            onClick={() => setNewestFirst((v) => !v)}
          >
            {newestFirst ? t('scanBack.sort.newest') : t('scanBack.sort.oldest')}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : books.length === 0 ? (
          <EmptyState icon={Printer} message={t('scanBack.empty')} />
        ) : (
          GROUPS.map((g) => {
            const rows = inGroup(g)
            if (rows.length === 0) return null
            return (
              <section key={g}>
                <h2 className="mb-2 mt-4 font-mono text-[0.68em] font-bold uppercase tracking-widest text-faint first:mt-0">
                  {t(`scanBack.group.${g}`)} · {rows.length}
                </h2>
                {rows.map((b) => (
                  <ScanBackRow key={b.id} book={b} onFile={file} busy={busy} />
                ))}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

export default ScanBackPage
```

- [ ] **Step 3c: Register the route and nav item**

In `frontend/src/App.tsx`, add a lazy import alongside the other page imports:

```ts
const ScanBackPage = lazy(() => import('./pages/scanBack/ScanBackPage'))
```

and a route after `/books/:id` (line ~211):

```tsx
              <Route path="/scan-back" element={<ScanBackPage />} />
```

In `frontend/src/components/shell/navItems.ts`, add `Printer` to the lucide import and this entry after `/books`:

```ts
  { to: '/scan-back', key: 'nav.scanBack', Icon: Printer, cap: 'books.manage' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/`
Expected: all passed

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: clean / no NEW errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/scanBack/ frontend/src/App.tsx \
  frontend/src/components/shell/navItems.ts
git commit -m "feat(scan-back): /scan-back page grouped by age"
```

---

### Task 7: Bell popover row

**Files:**
- Modify: `frontend/src/components/shell/NavBellPopover.tsx` (new section after the awaiting-approval block, ~line 251)
- Test: `frontend/src/components/shell/NavBellPopover.scanback.test.tsx` (create)

**Interfaces:**
- Consumes: `useScanBack` (Task 5), `nav.bell.scanBack*` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shell/NavBellPopover.scanback.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { NavBellPopover } from './NavBellPopover'

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useNavigate: () => navigate,
}))
vi.mock('@/pages/scanBack/useScanBack', () => ({
  useScanBack: () => ({ books: [{ id: 7 }, { id: 8 }], isLoading: false, count: 2, enabled: true }),
}))

function renderBell(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><NavBellPopover /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('bell — scan-back row', () => {
  beforeEach(async () => { navigate.mockClear(); await i18n.changeLanguage('en') })

  it('shows the row and navigates to /scan-back', async () => {
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: /notification/i }))
    const row = await screen.findByText('Signed copy not filed')
    await userEvent.click(row)
    expect(navigate).toHaveBeenCalledWith('/scan-back')
  })

  it('renders Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderBell()
    await userEvent.click(screen.getByRole('button', { name: /notification|الإشعارات/i }))
    expect(await screen.findByText('لم تُرفع النسخة الموقّعة')).toBeInTheDocument()
  })
})
```

If the bell trigger's accessible name differs, read `NavBell.tsx` / `NavBellPopover.tsx` and use the real one rather than loosening the matcher.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/components/shell/NavBellPopover.scanback.test.tsx`
Expected: FAIL — "Signed copy not filed" not found

- [ ] **Step 3: Add the section**

In `NavBellPopover.tsx`, add `Printer` to the lucide-react import, add near the other hooks:

```ts
  const { count: scanBackCount } = useScanBack()
```

with `import { useScanBack } from '@/pages/scanBack/useScanBack'`, then insert this block immediately after the awaiting-approval section (~line 251), matching its markup exactly:

```tsx
          {/* Signed copy never filed — books.manage-gated inside useScanBack */}
          {scanBackCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/scan-back')
              }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-warning-soft text-warning">
                <AvatarFallback className="bg-transparent">
                  <Printer className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('nav.bell.scanBackTitle')}
                </span>
                <span className="text-[0.78em] text-muted-foreground">
                  {t('nav.bell.scanBack', { count: scanBackCount })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/components/shell/`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shell/NavBellPopover.tsx \
  frontend/src/components/shell/NavBellPopover.scanback.test.tsx
git commit -m "feat(scan-back): bell row linking to /scan-back"
```

---

### Task 8: D — the bottom dock

**Files:**
- Create: `frontend/src/pages/scanBack/ScanBackDock.tsx`
- Modify: `frontend/src/App.tsx` (mount inside `Shell`, after `{isMobile && <BottomTabBar />}`, ~line 273)
- Test: `frontend/src/pages/scanBack/ScanBackDock.test.tsx` (create)

**Interfaces:**
- Consumes: `useScanBack`, `useFileSignedCopy` (Task 5); `ScanBackRow` is NOT reused (the dock rows are narrower — it renders its own compact row).
- Produces: `<ScanBackDock />`, self-gating (renders `null` at count 0 or on `/scan-back`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/scanBack/ScanBackDock.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackDock } from './ScanBackDock'

const state = { count: 2, books: [
  { id: 1, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
  { id: 2, ref_number: 'NAT-0642', subject: 'Warning', created_at: '2026-07-28 12:00:00' },
] }
vi.mock('./useScanBack', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useScanBack: () => ({ ...state, isLoading: false, enabled: true }),
  useFileSignedCopy: () => ({ file: vi.fn(), busy: false }),
}))

const renderDock = (path = '/books'): void => {
  render(<MemoryRouter initialEntries={[path]}><ScanBackDock /></MemoryRouter>)
}

describe('ScanBackDock', () => {
  beforeEach(async () => { localStorage.clear(); await i18n.changeLanguage('en') })

  it('starts collapsed and expands on click', async () => {
    renderDock()
    expect(screen.queryByText('GS-0410')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /to scan back/i }))
    expect(screen.getByText('GS-0410')).toBeInTheDocument()
  })

  it('remembers the expanded state', async () => {
    renderDock()
    await userEvent.click(screen.getByRole('button', { name: /to scan back/i }))
    expect(localStorage.getItem('scanback-dock-open')).toBe('1')
  })

  it('renders nothing at zero', () => {
    state.count = 0
    renderDock()
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
    state.count = 2
  })

  it('renders nothing on the scan-back page itself', () => {
    renderDock('/scan-back')
    expect(screen.queryByRole('button', { name: /to scan back/i })).not.toBeInTheDocument()
  })

  it('labels the pill in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderDock()
    expect(screen.getByRole('button', { name: /بانتظار المسح/ })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/ScanBackDock.test.tsx`
Expected: FAIL — cannot resolve `./ScanBackDock`

- [ ] **Step 3a: Write the dock**

Create `frontend/src/pages/scanBack/ScanBackDock.tsx`:

```tsx
/**
 * The all-day ambient reminder: a pill anchored bottom-end that expands into
 * the six oldest stranded records, each a drop target.
 *
 * Positioned with `inset-inline-end` so it flips in Arabic, and lifted above
 * BottomTabBar (`fixed inset-x-0 bottom-0 z-40`) on mobile — it must sit above
 * the tab bar, not on top of it.
 */
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Printer, Upload } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ageDays, useFileSignedCopy, useScanBack } from './useScanBack'

const OPEN_KEY = 'scanback-dock-open'
const MAX_ROWS = 6

function DockRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = book.ref_number ?? `#${book.id}`
  return (
    <div className="border-b border-hairline px-3 py-2 last:border-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.68em] font-semibold">
          {ref}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.74em]">{book.subject}</span>
        <span className="shrink-0 font-mono text-[0.66em] font-bold text-muted-foreground">
          {t('scanBack.age', { count: ageDays(book.created_at) })}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f && !busy) void onFile(book.id, ref, f)
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-raised px-2.5 py-1.5 text-[0.71em] text-muted-foreground transition-colors hover:border-info hover:bg-info-soft hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <Upload className="h-3 w-3" strokeWidth={2} aria-hidden />
        {t('scanBack.drop')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && !busy) void onFile(book.id, ref, f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function ScanBackDock(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { books, count } = useScanBack()
  const { file, busy } = useFileSignedCopy()
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')

  // Nothing to nag about, or the user is already on the page that IS the dock.
  if (count === 0 || pathname === '/scan-back') return null

  const toggle = (): void => {
    setOpen((v) => {
      localStorage.setItem(OPEN_KEY, v ? '0' : '1')
      return !v
    })
  }

  return (
    <div
      data-print-hide
      className={cn(
        // `end-4` is the logical utility (inset-inline-end) — it flips in RTL.
        // Never `right-4`. Precedent: BookDetailDrawer.tsx:340, IdentityDocCard.tsx:97.
        'fixed z-30 flex flex-col items-end gap-2 end-4',
        // Clear BottomTabBar (3.5rem) on mobile; sit near the edge on desktop.
        'bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-5',
        'rtl:items-start',
      )}
    >
      {open && (
        <div className="w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <Printer className="h-3.5 w-3.5 text-warning" strokeWidth={2} aria-hidden />
            <span className="flex-1 text-[0.76em] font-semibold">{t('scanBack.dock.header')}</span>
            <button
              type="button"
              onClick={() => navigate('/scan-back')}
              className="rounded px-1.5 py-0.5 text-[0.72em] font-semibold text-info hover:bg-info-soft"
            >
              {t('scanBack.viewAll', { count })}
            </button>
          </div>
          <div className="max-h-60 overflow-auto">
            {books.slice(0, MAX_ROWS).map((b) => (
              <DockRow key={b.id} book={b} onFile={file} busy={busy} />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? t('scanBack.dock.collapse') : t('scanBack.dock.expand')}
        className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[0.78em] font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" aria-hidden />
        {t('scanBack.dock.pill', { count })}
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              : <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  )
}
```

- [ ] **Step 3b: Mount it**

In `frontend/src/App.tsx`, inside `Shell`'s returned fragment, after `{isMobile && <BottomTabBar />}` and its closing `</div>`:

```tsx
      <ScanBackDock />
```

with `import { ScanBackDock } from './pages/scanBack/ScanBackDock'` (a direct import, not lazy — it is tiny and must be able to render on first paint).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/`
Expected: all passed

Run: `pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint`
Expected: clean / no NEW errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/scanBack/ScanBackDock.tsx \
  frontend/src/pages/scanBack/ScanBackDock.test.tsx frontend/src/App.tsx
git commit -m "feat(scan-back): collapsible bottom dock with per-record drop targets"
```

---

### Task 9: A — the once-a-day gate

**Files:**
- Create: `frontend/src/pages/scanBack/ScanBackGate.tsx`
- Modify: `frontend/src/App.tsx` (mount next to `<ScanBackDock />`)
- Test: `frontend/src/pages/scanBack/ScanBackGate.test.tsx` (create)

**Interfaces:**
- Consumes: `useScanBack`, `useFileSignedCopy` (Task 5); `scanBack.gate.*` (Task 4).
- Produces: `<ScanBackGate />`, self-gating on the per-user per-day dismissal key.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/scanBack/ScanBackGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackGate, dismissKeyFor } from './ScanBackGate'

const state = {
  count: 4,
  books: [
    { id: 1, ref_number: 'GS-0410', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
    { id: 2, ref_number: 'GS-0411', subject: 'Ack', created_at: '2026-06-25 12:00:00' },
    { id: 3, ref_number: 'NAT-0424', subject: 'Warning', created_at: '2026-06-29 12:00:00' },
    { id: 4, ref_number: 'NAT-0642', subject: 'Warning', created_at: '2026-07-28 12:00:00' },
  ],
}
vi.mock('./useScanBack', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useScanBack: () => ({ ...state, isLoading: false, enabled: true }),
  useFileSignedCopy: () => ({ file: vi.fn(), busy: false }),
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 42 }, status: 'authed' }) }))

const renderGate = (): void => {
  render(<MemoryRouter><ScanBackGate /></MemoryRouter>)
}

describe('ScanBackGate', () => {
  beforeEach(async () => { localStorage.clear(); await i18n.changeLanguage('en') })

  it('shows the count and only the three oldest rows', () => {
    renderGate()
    expect(screen.getByText(/4 records are waiting/i)).toBeInTheDocument()
    expect(screen.getByText('GS-0410')).toBeInTheDocument()
    expect(screen.getByText('NAT-0424')).toBeInTheDocument()
    expect(screen.queryByText('NAT-0642')).not.toBeInTheDocument()
  })

  it('dismissal writes a per-user per-day key and hides it', async () => {
    renderGate()
    await userEvent.click(screen.getByRole('button', { name: /not now/i }))
    expect(localStorage.getItem(dismissKeyFor(42))).toBe(new Date().toISOString().slice(0, 10))
    expect(screen.queryByText(/records are waiting/i)).not.toBeInTheDocument()
  })

  it('stays hidden when already dismissed today', () => {
    localStorage.setItem(dismissKeyFor(42), new Date().toISOString().slice(0, 10))
    renderGate()
    expect(screen.queryByText(/records are waiting/i)).not.toBeInTheDocument()
  })

  it('returns the next day', () => {
    localStorage.setItem(dismissKeyFor(42), '2020-01-01')
    renderGate()
    expect(screen.getByText(/records are waiting/i)).toBeInTheDocument()
  })

  it("does not silence a different user's gate", () => {
    localStorage.setItem(dismissKeyFor(99), new Date().toISOString().slice(0, 10))
    renderGate()
    expect(screen.getByText(/records are waiting/i)).toBeInTheDocument()
  })

  it('renders Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    renderGate()
    expect(screen.getByText(/بانتظار نسختها الموقّعة/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/ScanBackGate.test.tsx`
Expected: FAIL — cannot resolve `./ScanBackGate`

- [ ] **Step 3a: Write the gate**

Create `frontend/src/pages/scanBack/ScanBackGate.tsx`:

```tsx
/**
 * The once-a-day interrupt. Shows the THREE oldest stranded records, never all
 * of them — a wall of rows reads as unfixable, three reads as a task.
 *
 * Dismissal is per-user per-day in localStorage: per-user so a shared browser
 * doesn't silence the next person, per-day so it comes back tomorrow. No table,
 * no migration.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Printer, X } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { ageDays, useFileSignedCopy, useScanBack } from './useScanBack'

const SHOWN = 3

export const dismissKeyFor = (userId: number | string): string =>
  `scanback-gate-dismissed:${userId}`

const today = (): string => new Date().toISOString().slice(0, 10)

function GateRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = book.ref_number ?? `#${book.id}`
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-raised">
      <span className="shrink-0 rounded bg-surface-tinted px-1.5 py-1 font-mono text-[0.7em] font-semibold">
        {ref}
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.78em]">{book.subject}</span>
      <span className="shrink-0 font-mono text-[0.68em] font-bold text-accent">
        {t('scanBack.age', { count: ageDays(book.created_at) })}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[0.72em] font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        {t('scanBack.gate.upload')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && !busy) void onFile(book.id, ref, f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export function ScanBackGate(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { books, count } = useScanBack()
  const { file, busy } = useFileSignedCopy()
  const key = dismissKeyFor(user?.id ?? 'anon')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === today())

  if (dismissed || count === 0) return null

  const dismiss = (): void => {
    localStorage.setItem(key, today())
    setDismissed(true)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanback-gate-title"
      className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="relative border-b border-hairline px-5 py-5">
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('scanBack.gate.close')}
            className="absolute top-3 end-3 rounded-lg bg-surface-tinted p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
            <Printer className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </div>
          <h2 id="scanback-gate-title" className="text-[1em] font-bold tracking-tight">
            {t('scanBack.gate.title', { count })}
          </h2>
          <p className="mt-1 text-[0.79em] text-muted-foreground">{t('scanBack.gate.blurb')}</p>
        </div>

        <div className="px-3 py-2">
          {books.slice(0, SHOWN).map((b) => (
            <GateRow key={b.id} book={b} onFile={file} busy={busy} />
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-hairline bg-surface-raised px-4 py-3">
          <button
            type="button"
            onClick={() => { navigate('/scan-back'); setDismissed(true) }}
            className="rounded-lg bg-accent px-4 py-2 text-[0.78em] font-semibold text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('scanBack.viewAll', { count })}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-3 py-2 text-[0.78em] text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('scanBack.gate.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Note: "View all" closes the gate via `setDismissed(true)` WITHOUT writing the
localStorage key — the user acted, so the gate should still return tomorrow.

`useAuth()` comes from `frontend/src/lib/authContext.ts` (a `.ts`, not `.tsx`)
and returns `user: SessionUser | null` where `SessionUser.id` is a `number`
(`api.ts:387-388`) — no cast needed.

- [ ] **Step 3b: Mount it**

In `frontend/src/App.tsx`, next to `<ScanBackDock />`:

```tsx
      <ScanBackGate />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C frontend exec vitest run src/pages/scanBack/`
Expected: all passed

Run the full frontend suite plus gates:
```bash
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```
Expected: green / clean / no NEW errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/scanBack/ScanBackGate.tsx \
  frontend/src/pages/scanBack/ScanBackGate.test.tsx frontend/src/App.tsx
git commit -m "feat(scan-back): once-a-day dismissible gate"
```

---

## Final verification

- [ ] **Full gates, both stacks**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
```

- [ ] **Reviewer agents** (bilingual surfaces were touched):
  `i18n-rtl-reviewer` and `notification-template-reviewer`.

- [ ] **Manual smoke on the live data.** 25 records currently qualify. Sign in as
  a `books.manage` holder and confirm: the gate appears once, "Not now" hides it
  and it stays hidden on reload, the dock shows the count, `/scan-back` groups
  4 / 6+ / rest by age, and filing one drops the count in the dock, the bell and
  the sidebar together.

- [ ] **Confirm no template churn.** `git status backend/templates/` must be
  clean — the live service re-saves `.docx` files during operation and that churn
  must never ride along in a commit.

- [ ] **Merge to `main` and push to `origin/main`.** This checkout is the live
  production build; an unpushed fix is overwritten by the next `mng update`.

## Follow-ups (NOT in this plan)

- **Grant `books.manage` to Ibrahim Younes and Mohamed Al Maskari.** Both hold
  `documents.generate` without it, so they can strand a record they cannot clear.
  5 of 7 operators already have the override; these two look simply missed. This
  is a Settings action, not code.
- **Fix scan-to-email on the MFP.** It is the actual cure — the app used to
  ingest scans automatically through the mailbox poll → OCR triage → Scan Inbox
  path, and this whole feature exists because that pipe broke.
- **Weekend awareness.** With a 24h threshold a paper printed Thursday nags on
  Friday. If that proves noisy, raise `SCANBACK_STALE_HOURS` — one line.
