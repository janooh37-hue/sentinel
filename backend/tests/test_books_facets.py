"""GET /books/facets — per-service counts + per-service approval-state counts.

Global over every non-deleted book: never a page window. This is what fixes the
rail's silent truncation at 500 rows.
"""

from __future__ import annotations

import secrets
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.core.form_kind import OTHER_SERVICE_ID
from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookVersion, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import book_service, perm_service

#: (ref, subject, template_id, versioned, approval_state)
#: F-8..F-11 mirror the four OTHER_SERVICE_ID branches in
#: test_books_service_filter.FIXTURES (A-4/A-5/A-6/B-7) — the branches where
#: the resolver rule is easiest to get wrong. Without them, the agreement
#: test below would never exercise a companion template, an unknown
#: template, a versioned book with a NULL newest template_id, or an
#: unversioned book with a NULL subject.
ROWS = [
    ("F-1", "x", "Leave Application Form", True, "pending"),
    ("F-2", "x", "Leave Application Form", True, "approved"),
    ("F-3", "x", "Leave Application Form", True, "none"),
    ("F-4", "x", "Report", True, "approved"),
    ("F-5", "Resignation Form - X", None, False, "none"),
    ("F-6", "تصاريح الامنية", None, False, "none"),
    ("F-8", "whatever", "Leave Undertaking", True, "none"),  # companion template -> other
    ("F-9", "whatever", "Ghost Form", True, "none"),  # unknown template -> other
    ("F-10", "whatever", None, True, "none"),  # versioned, newest template_id NULL -> other
    ("F-11", None, None, False, "none"),  # unversioned, NULL subject -> other
]


def _seed(db: Session) -> None:
    db.add(BookCategory(id="GS", prefix="GS"))
    db.flush()
    for ref, subject, template_id, versioned, state in ROWS:
        book = Book(
            ref_number=ref,
            category_id="GS",
            subject=subject,
            direction="outgoing",
            approval_state=state,
        )
        db.add(book)
        db.flush()
        if versioned:
            db.add(BookVersion(book_id=book.id, version_no=1, template_id=template_id))
    # A deleted book must not be counted anywhere.
    db.add(
        Book(
            ref_number="F-7",
            category_id="GS",
            subject="x",
            direction="outgoing",
            approval_state="approved",
            deleted_at=datetime(2026, 7, 1, tzinfo=UTC),
        )
    )
    db.commit()


@pytest.fixture()
def api(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Iterator[TestClient]:
    """Seeded TestClient (mirrors test_book_template_routes_m4.py:29-45)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'facets.db'}",
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


def test_counts_are_per_service(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    by_id = {s.service_id: s for s in services}
    assert by_id["Leave Application Form"].count == 3
    assert by_id["Report"].count == 1
    assert by_id["Resignation Letter"].count == 1
    assert by_id[OTHER_SERVICE_ID].count == 5


def test_states_are_per_service(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    by_id = {s.service_id: s for s in services}
    assert by_id["Leave Application Form"].states == {"pending": 1, "approved": 1, "none": 1}


def test_totals_agree_and_exclude_deleted(db_session: Session) -> None:
    _seed(db_session)
    all_records, services = book_service.service_facets(db_session)
    assert all_records.count == 10  # F-7 is deleted
    assert sum(s.count for s in services) == all_records.count
    assert sum(all_records.states.values()) == all_records.count


def test_empty_services_are_omitted(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    assert all(s.count > 0 for s in services)
    assert "Warning Form" not in {s.service_id for s in services}


def test_order_is_template_order_with_other_last(db_session: Session) -> None:
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    assert services[-1].service_id == OTHER_SERVICE_ID
    ids = [s.service_id for s in services]
    assert ids.index("Leave Application Form") < ids.index("Report")


def test_route_shape(api: TestClient) -> None:
    res = api.get("/api/v1/books/facets")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"total", "states", "services"}
    assert body["total"] == len(ROWS)
    for item in body["services"]:
        assert set(item) == {"id", "count", "states"}
    assert body["services"][-1]["id"] == OTHER_SERVICE_ID


def test_facets_agree_with_the_service_filter(db_session: Session) -> None:
    """Whatever facets counts, the Task 3 filter must return that many rows."""
    _seed(db_session)
    _all, services = book_service.service_facets(db_session)
    for facet in services:
        _rows, total, _ = book_service.list_books(
            db_session, service_id=facet.service_id, limit=500
        )
        assert total == facet.count, f"{facet.service_id}: {total} != {facet.count}"
