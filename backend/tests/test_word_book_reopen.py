"""TDD tests for reopen_word_session (Task 11).

RED first — run before implementing the function.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.db.models import Book, BookCategory, BookEditSession, BookVersion, Document, User

# ---------------------------------------------------------------------------
# Helpers (mirrors test_word_book_finish.py)
# ---------------------------------------------------------------------------


def _seed_gs(db):
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


def _user(db) -> User:
    u = User(email=f"{secrets.token_hex(4)}@test.ae", password_hash="x", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _settings(tmp_path):
    from app.config import Settings

    return Settings(data_dir=tmp_path / "data", templates_dir=tmp_path / "templates")


def _make_finished_book(
    db, user, tmp_path, *, docx_exists: bool = True
) -> tuple[Book, Document, BookVersion]:
    """Create a Book with one finished version and a Document with a real docx file."""
    from app.db.repos import refs_repo

    _seed_gs(db)
    ref = refs_repo.allocate_ref_with_retry(db, "GS")
    book = Book(
        category_id="GS",
        ref_number=ref,
        subject="reopen test book",
        approval_state="none",
        submitted_by_user_id=user.id,
    )
    db.add(book)
    db.flush()

    # Stable output docx (simulates what finish_word_session writes)
    out_dir = tmp_path / "output" / "General_Book"
    out_dir.mkdir(parents=True, exist_ok=True)
    docx_path = out_dir / f"{ref.replace('/', '-')}_v1.docx"
    if docx_exists:
        docx_path.write_bytes(b"PK fake finished docx v1")

    doc = Document(
        template_id="General Book",
        ref_number=ref,
        docx_path=str(docx_path),
        submission_id=secrets.token_hex(16),
        role="primary",
    )
    db.add(doc)
    db.flush()

    version = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id="General Book",
        document_id=doc.id,
        created_by_user_id=user.id,
    )
    db.add(version)

    # Mark the original session finished (so the book is properly finished)
    finished_session = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        working_path=str(tmp_path / "gone.docx"),
        state="finished",
    )
    db.add(finished_session)
    db.commit()
    db.refresh(book)
    db.refresh(doc)
    db.refresh(version)
    return book, doc, version


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_reopen_returns_word_session_info(db_session, tmp_path, monkeypatch):
    """Reopen a finished book → returns WordSessionInfo with correct shape."""
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, _doc, _v = _make_finished_book(db_session, user, tmp_path)

    info = word_book_service.reopen_word_session(db_session, user=user, book_id=book.id)

    assert info.book_id == book.id
    assert info.ref_number == book.ref_number
    assert info.token
    assert info.filename == book.ref_number.replace("/", "-") + ".docx"
    assert info.word_url.startswith("ms-word:ofe|u|")
    assert info.dav_url


def test_reopen_creates_active_session_and_working_file(db_session, tmp_path, monkeypatch):
    """Reopen → new active BookEditSession exists, working file is a copy of the source docx."""
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, doc, version = _make_finished_book(db_session, user, tmp_path)
    prior_session = db_session.query(BookEditSession).filter_by(book_id=book.id).one()
    prior_token = prior_session.token
    prior_docx = Path(doc.docx_path).read_bytes()

    info = word_book_service.reopen_word_session(db_session, user=user, book_id=book.id)

    # Active session exists
    session = (
        db_session.query(BookEditSession).filter_by(book_id=book.id, state="active").one_or_none()
    )
    assert session is not None
    assert session.token == info.token
    assert session.token != prior_token
    assert prior_session.state == "finished"

    # Working file exists and has the same content as the source
    working = Path(session.working_path)
    assert working.exists()
    assert working.read_bytes() == Path(doc.docx_path).read_bytes()

    # Source docx is still intact (it was copied, not moved)
    assert Path(doc.docx_path).exists()
    assert Path(doc.docx_path).read_bytes() == prior_docx
    assert db_session.query(BookVersion).filter_by(book_id=book.id).one() == version


def test_reopen_then_finish_gives_version_2_revision(db_session, tmp_path, monkeypatch):
    """Reopen a v1 book, finish → version_no=2, trigger=revision; v1 Document untouched."""
    from app.services import word_book_service

    _dummy_pdf = tmp_path / "dummy.pdf"
    _dummy_pdf.write_bytes(b"%PDF fake")
    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: _dummy_pdf,
    )

    user = _user(db_session)
    book, doc_v1, _v1 = _make_finished_book(db_session, user, tmp_path)

    # Reopen
    word_book_service.reopen_word_session(db_session, user=user, book_id=book.id)

    # Simulate Word PUT (set last_put_at)
    active = db_session.query(BookEditSession).filter_by(book_id=book.id, state="active").one()
    active.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    db_session.commit()

    # Finish
    word_book_service.finish_word_session(db_session, user=user, book_id=book.id)

    versions = (
        db_session.query(BookVersion)
        .filter_by(book_id=book.id)
        .order_by(BookVersion.version_no)
        .all()
    )
    assert len(versions) == 2
    assert versions[1].version_no == 2
    assert versions[1].trigger == "revision"

    # v1 Document untouched
    db_session.refresh(doc_v1)
    assert Path(doc_v1.docx_path).exists()
    assert doc_v1.docx_path == str(
        tmp_path / "output" / "General_Book" / f"{book.ref_number.replace('/', '-')}_v1.docx"
    )


def test_reopen_while_session_active_raises_409(db_session, tmp_path, monkeypatch):
    """Reopen when an active session already exists → 409 SESSION_ACTIVE."""
    from app.api.errors import AppError
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, _doc, _v = _make_finished_book(db_session, user, tmp_path)

    # Insert an active session manually (simulate mid-edit state)
    active = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        working_path=str(tmp_path / "active.docx"),
        state="active",
    )
    db_session.add(active)
    db_session.commit()

    with pytest.raises(AppError) as exc_info:
        word_book_service.reopen_word_session(db_session, user=user, book_id=book.id)

    assert exc_info.value.code == "SESSION_ACTIVE"
    assert exc_info.value.http_status == 409


def test_reopen_missing_docx_raises_409(db_session, tmp_path, monkeypatch):
    """Reopen when the latest version's docx file is gone → 409 NO_SOURCE_DOCX."""
    from app.api.errors import AppError
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    # docx_exists=False → the path is recorded but file doesn't exist on disk
    book, _doc, _v = _make_finished_book(db_session, user, tmp_path, docx_exists=False)

    with pytest.raises(AppError) as exc_info:
        word_book_service.reopen_word_session(db_session, user=user, book_id=book.id)

    assert exc_info.value.code == "NO_SOURCE_DOCX"
    assert exc_info.value.http_status == 409


def test_reopen_book_not_found_raises_404(db_session, tmp_path, monkeypatch):
    """Reopen a non-existent book → 404 BOOK_NOT_FOUND."""
    from app.api.errors import AppError
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)

    with pytest.raises(AppError) as exc_info:
        word_book_service.reopen_word_session(db_session, user=user, book_id=99999)

    assert exc_info.value.code == "BOOK_NOT_FOUND"
    assert exc_info.value.http_status == 404
