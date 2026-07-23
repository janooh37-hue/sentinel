"""Report authored in Word — session persistence, create, finish."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookEditSession, Employee, User
from app.db.models import BookEditSession as _BES  # noqa: F401
from app.db.session import attach_sqlite_pragmas
from app.services import perm_service


# File-based SQLite with check_same_thread=False so TestClient (runs in a
# worker thread) can reuse the same connection created in the test thread.
@pytest.fixture()
def api_db(monkeypatch, tmp_path: Path) -> Session:
    db_file = tmp_path / "word_report_session.db"
    eng = create_engine(
        f"sqlite:///{db_file}",
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
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def db_session(api_db: Session) -> Session:
    return api_db


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


def _user(db, employee_id=None):
    u = User(email="op@test.ae", password_hash="x", status="active")
    u.employee_id = employee_id
    db.add(u)
    db.flush()
    db.refresh(u)
    return u


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


def test_wordbookcreate_accepts_report_fields():
    from app.schemas.book import WordBookCreate

    m = WordBookCreate(subject="s", signer_employee_id="G3019", sign=False, date="2026-07-23")
    assert m.signer_employee_id == "G3019"
    assert m.sign is False
    assert m.date == "2026-07-23"
    # General Book payload unaffected — the new fields default cleanly.
    gb = WordBookCreate(subject="s", classification_code="1")
    assert gb.signer_employee_id is None
    assert gb.sign is True
    assert gb.date is None


def test_create_report_word_book(db_session):
    from app.services import word_book_service

    _seed_gs(db_session)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    db_session.add(Employee(id="G3082", name_en="Operator", name_ar="مشغّل", position="Op"))
    op = _user(db_session, employee_id="G3082")
    db_session.commit()

    info = word_book_service.create_report_word_book(
        db_session,
        user=op,
        signer_employee_id="G1042",
        recipient_id=None,
        subject="تقرير",
        date="2026-07-23",
        sign=True,
    )
    assert info.ref_number.startswith("REPORT-")
    assert info.word_url.startswith("ms-word:ofe|u|")

    book = db_session.get(Book, info.book_id)
    assert book.classification_code is None
    assert book.approval_state == "approved"
    sess = db_session.query(BookEditSession).filter_by(book_id=book.id, state="active").one()
    assert sess.signer_employee_id == "G1042"
    assert sess.sign_on_finish is True
    assert Path(sess.working_path).is_file()  # working docx rendered


def test_create_word_session_dispatches_report(db_session):
    from fastapi.testclient import TestClient

    from app.api.deps import get_current_user, get_db  # mirror test_reports_api.py's imports
    from app.db.models import Employee, User
    from app.main import create_app

    u = User(email="op2@test.ae", password_hash="x", role="admin", status="active")
    db_session.add(u)
    db_session.add(Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head"))
    db_session.commit()
    db_session.refresh(u)

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: u
    client = TestClient(app, raise_server_exceptions=True)

    r = client.post(
        "/api/v1/books/word-sessions",
        json={
            "subject": "تقرير",
            "signer_employee_id": "G1042",
            "sign": True,
            "date": "2026-07-23",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["ref_number"].startswith("REPORT-")
