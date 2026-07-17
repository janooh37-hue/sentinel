from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Book, BookCategory, BookEditSession


def _book(db, ref="1/5/GSSG/900"):
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
    b = Book(category_id="GS", ref_number=ref, subject="t", classification_code="5/1")
    db.add(b)
    db.commit()
    return b


def test_book_classification_and_voided_roundtrip(db_session):
    b = _book(db_session)
    assert b.classification_code == "5/1"
    assert b.voided_at is None
    b.voided_at = datetime.now(UTC)
    db_session.commit()
    assert db_session.get(Book, b.id).voided_at is not None


def test_only_one_active_session_per_book(db_session):
    b = _book(db_session)
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t1", working_path="x"))
    db_session.commit()
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t2", working_path="y"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    # a finished session frees the slot
    s = db_session.query(BookEditSession).filter_by(book_id=b.id).one()
    s.state = "finished"
    db_session.commit()
    db_session.add(BookEditSession(book_id=b.id, user_id=1, token="t3", working_path="z"))
    db_session.commit()
