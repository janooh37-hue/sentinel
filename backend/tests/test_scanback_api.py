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
        f"sqlite:///{tmp_path / 't.db'}",
        future=True,
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
        cat = BookCategory(id="GS", name_en="Cat", name_ar="فئة", prefix="GS")
        db.add(cat)
        db.flush()
    b = Book(
        category_id=cat.id,
        ref_number=ref,
        subject=f"S {ref}",
        approval_state="awaiting_scan",
        created_at=datetime.now() - timedelta(hours=hours_ago),
    )
    db.add(b)
    db.flush()
    db.add(
        BookVersion(
            book_id=b.id,
            version_no=1,
            status="awaiting_scan",
            trigger="initial",
            created_by_user_id=owner_id,
        )
    )
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
