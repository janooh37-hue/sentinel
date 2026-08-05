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
        cat = BookCategory(id="GS", name_en="Cat", name_ar="فئة", prefix="GS")
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
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=1,
            status=state,
            trigger="initial",
            created_by_user_id=owner_id,
        )
    )
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


@pytest.fixture()
def other_user(db: Session, owner: User) -> User:
    """The second user `owner` already seeded — the real row, not `owner.id + 1`."""
    return db.query(User).filter(User.email == "other@x.ae").one()


def test_23h_old_is_not_stale_but_25h_is(db, owner):
    _seed(db, ref="GS-0001", hours_ago=23, owner_id=owner.id)
    _seed(db, ref="GS-0002", hours_ago=25, owner_id=owner.id)
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=owner.id)]
    assert refs == ["GS-0002"]


def test_only_the_creator_sees_it(db, owner, other_user):
    _seed(db, ref="GS-0003", hours_ago=48, owner_id=other_user.id)
    assert book_service.list_awaiting_scan(db, user_id=owner.id) == []
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=None)]
    assert refs == ["GS-0003"]


def test_ownership_follows_the_current_version_not_the_first(db, owner, other_user):
    """The load-bearing rule: ownership is whoever created the CURRENT
    (highest-numbered) version, not whoever created the book's first one.

    Every other fixture in this file seeds exactly one version, so an
    implementation that read `versions[0]` instead of `_current_version`
    (the last one) would pass all of them while attributing every
    re-generated book to its original author forever.
    """
    book = _seed(db, ref="GS-0009", hours_ago=48, owner_id=owner.id)
    db.add(
        BookVersion(
            book_id=book.id,
            version_no=2,
            status="awaiting_scan",
            trigger="regenerate",
            created_by_user_id=other_user.id,
        )
    )
    db.commit()

    assert book_service.list_awaiting_scan(db, user_id=owner.id) == []
    refs = [b.ref_number for b in book_service.list_awaiting_scan(db, user_id=other_user.id)]
    assert refs == ["GS-0009"]


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
