"""Report authored in Word — session persistence, create, finish."""

from __future__ import annotations

from app.db.models import Book, BookCategory, BookEditSession


def _seed_gs(db) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.flush()


def _seed_book(db) -> Book:
    _seed_gs(db)
    book = Book(category_id="GS", ref_number="GS/1/2026")
    db.add(book)
    db.flush()
    return book


def test_edit_session_carries_signer_and_sign(db_session):
    book = _seed_book(db_session)
    s = BookEditSession(
        book_id=book.id,
        user_id=1,
        token="t",
        working_path="w",
        state="active",
        signer_employee_id="G3019",
        sign_on_finish=True,
    )
    db_session.add(s)
    db_session.commit()
    db_session.refresh(s)
    assert s.signer_employee_id == "G3019"
    assert s.sign_on_finish is True
