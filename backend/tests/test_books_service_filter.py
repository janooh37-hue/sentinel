"""GET /books?service_id= — server-side service filtering.

The SQL clause and the Python resolver are two expressions of one rule, so the
agreement test below is the guard that keeps them from drifting.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS, resolve_service
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service


def _add_book(
    db: Session, *, ref: str, subject: str | None, template_id: str | None, versioned: bool
) -> Book:
    """A book with (optionally) one version. `versioned=False` mimics a v3 import."""
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()
    book = Book(ref_number=ref, category_id="GS", subject=subject, direction="outgoing")
    db.add(book)
    db.flush()
    if versioned:
        db.add(BookVersion(book_id=book.id, version_no=1, template_id=template_id))
    db.flush()
    return book


#: (ref, subject, template_id, versioned, expected_service)
FIXTURES = [
    ("A-1", "Leave Application Form - X", "Leave Application Form", True, "Leave Application Form"),
    ("A-2", "whatever", "Report", True, "Report"),
    ("A-3", "whatever", "Warning Form", True, "Warning Form"),
    ("A-4", "whatever", "Leave Undertaking", True, OTHER_SERVICE_ID),  # companion
    ("A-5", "Leave Application Form - X", "Ghost Form", True, OTHER_SERVICE_ID),
    ("A-6", "Leave Application Form - X", None, True, OTHER_SERVICE_ID),
    ("B-1", "Leave Application Form - X", None, False, "Leave Application Form"),
    ("B-2", "Resignation Form - X", None, False, "Resignation Letter"),
    ("B-3", "كتاب عام", None, False, "General Book"),
    ("B-4", "تصاريح الامنية", None, False, OTHER_SERVICE_ID),
    ("B-5", "Passport Release Form - X", None, False, "Passport Release Form"),
    ("B-6", "Passport Release List - X", None, False, "Passport Release List"),
    ("B-7", None, None, False, OTHER_SERVICE_ID),
]


def _seed(db: Session) -> None:
    for ref, subject, template_id, versioned, _expected in FIXTURES:
        _add_book(db, ref=ref, subject=subject, template_id=template_id, versioned=versioned)
    db.commit()


@pytest.fixture()
def api(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[TestClient]:
    """Seeded TestClient with auth overridden (mirrors test_book_template_routes_m4)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'svc_filter.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    user = User(
        email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", role="admin", status="active"
    )
    db.add(user)
    db.commit()
    _seed(db)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield client
    db.close()


def test_filter_returns_only_that_service(db_session: Session) -> None:
    _seed(db_session)
    rows, total, _ = book_service.list_books(
        db_session, service_id="Leave Application Form", limit=500
    )
    assert {r.ref_number for r in rows} == {"A-1", "B-1"}
    assert total == 2


def test_other_collects_exactly_the_unresolved(db_session: Session) -> None:
    _seed(db_session)
    rows, _total, _ = book_service.list_books(db_session, service_id=OTHER_SERVICE_ID, limit=500)
    assert {r.ref_number for r in rows} == {"A-4", "A-5", "A-6", "B-4", "B-7"}


def test_sql_filter_agrees_with_the_python_resolver(db_session: Session) -> None:
    """The rule has two expressions (SQL + Python). They must partition the
    same set of records identically, for every service and for Other."""
    _seed(db_session)
    for service_id in [*SERVICE_IDS, OTHER_SERVICE_ID]:
        rows, _total, _ = book_service.list_books(db_session, service_id=service_id, limit=500)
        by_sql = {r.ref_number for r in rows}
        by_python = {
            ref
            for ref, subject, template_id, versioned, _expected in FIXTURES
            if resolve_service(subject, template_id, versioned=versioned) == service_id
        }
        assert by_sql == by_python, f"mismatch for {service_id!r}"


def test_every_fixture_lands_in_exactly_one_bucket(db_session: Session) -> None:
    _seed(db_session)
    seen: list[str] = []
    for service_id in [*SERVICE_IDS, OTHER_SERVICE_ID]:
        rows, _total, _ = book_service.list_books(db_session, service_id=service_id, limit=500)
        seen.extend(r.ref_number for r in rows)
    assert sorted(seen) == sorted(ref for ref, *_rest in FIXTURES)


def test_unknown_service_id_returns_nothing(db_session: Session) -> None:
    _seed(db_session)
    rows, total, _ = book_service.list_books(db_session, service_id="Ghost Form", limit=500)
    assert rows == []
    assert total == 0


def test_route_accepts_service_id(api: TestClient) -> None:
    """The API surface, not just the service function."""
    res = api.get("/api/v1/books", params={"service_id": "Report", "limit": 500})
    assert res.status_code == 200
    body = res.json()
    assert [item["ref_number"] for item in body["items"]] == ["A-2"]
    assert all(item["service_id"] == "Report" for item in body["items"])


def test_route_without_service_id_returns_everything(api: TestClient) -> None:
    res = api.get("/api/v1/books", params={"limit": 500})
    assert res.status_code == 200
    assert res.json()["total"] == len(FIXTURES)


def test_filter_composes_with_the_other_filters(db_session: Session) -> None:
    _seed(db_session)
    rows, _total, _ = book_service.list_books(
        db_session, service_id="Leave Application Form", direction="incoming", limit=500
    )
    assert rows == []
