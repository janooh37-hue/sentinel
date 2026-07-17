"""TDD tests for finish_word_session / discard_word_session (Task 7).

RED first — run before implementing the functions.
"""

from __future__ import annotations

import secrets
from pathlib import Path

import pytest

from app.db.models import Book, BookCategory, BookEditSession, BookVersion, Document, User

# ---------------------------------------------------------------------------
# Helpers
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


def _make_book_with_session(
    db, user, tmp_path, *, write_file: bool = True
) -> tuple[Book, BookEditSession]:
    """Create a Book + active BookEditSession via create_word_book, without a real template.

    Bypasses the template render by directly inserting rows.
    """
    from app.db.repos import refs_repo

    _seed_gs(db)
    ref = refs_repo.allocate_ref_with_retry(db, "GS")
    book = Book(
        category_id="GS",
        ref_number=ref,
        subject="test book",
        approval_state="none",
        submitted_by_user_id=user.id,
    )
    db.add(book)
    db.flush()

    working_dir = tmp_path / "data" / "editing" / f"book-{book.id}"
    working_dir.mkdir(parents=True, exist_ok=True)
    working_path = working_dir / f"{ref.replace('/', '-')}.docx"
    if write_file:
        working_path.write_bytes(b"PK fake docx bytes")

    token = secrets.token_urlsafe(32)
    session = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=token,
        working_path=str(working_path),
        state="active",
    )
    db.add(session)
    db.commit()
    db.refresh(book)
    db.refresh(session)
    return book, session


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_finish_without_put_raises_409(db_session, tmp_path, monkeypatch):
    """finish when last_put_at is None → 409 NO_SAVES_YET, no version created."""
    from app.api.errors import AppError
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    # monkeypatch the PDF converter so no real Word runs
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: None,
    )

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)

    # session.last_put_at is None (not yet touched by Word)
    assert session.last_put_at is None

    with pytest.raises(AppError) as exc_info:
        word_book_service.finish_word_session(db_session, user=user, book_id=book.id)

    assert exc_info.value.code == "NO_SAVES_YET"
    assert exc_info.value.http_status == 409
    # No version created
    assert db_session.query(BookVersion).filter_by(book_id=book.id).count() == 0


def test_finish_after_put_creates_version_and_document(db_session, tmp_path, monkeypatch):
    """Finish after a simulated PUT → version_no=1, trigger=initial, Document row, session finished, docx moved."""
    from datetime import UTC, datetime

    from app.services import word_book_service

    _dummy_pdf = tmp_path / "dummy.pdf"
    _dummy_pdf.write_bytes(b"%PDF fake")
    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: _dummy_pdf,
    )

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)

    # Simulate Word having saved once
    session.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    db_session.commit()

    result = word_book_service.finish_word_session(db_session, user=user, book_id=book.id)

    assert result.id == book.id

    # Session is finished
    db_session.refresh(session)
    assert session.state == "finished"

    # Exactly one BookVersion
    versions = db_session.query(BookVersion).filter_by(book_id=book.id).all()
    assert len(versions) == 1
    v = versions[0]
    assert v.version_no == 1
    assert v.trigger == "initial"
    assert v.status == "none"
    assert v.created_by_user_id == user.id

    # Document row exists
    doc = db_session.get(Document, v.document_id)
    assert doc is not None
    assert doc.ref_number == book.ref_number
    # docx_path moved out of data/editing
    assert "editing" not in doc.docx_path.replace("\\", "/")
    assert doc.docx_path.endswith(".docx")
    # pdf_path is set (dummy was returned)
    assert doc.pdf_path is not None

    # working_path file no longer at original location
    assert not Path(session.working_path).exists()

    # Book approval_state stays none
    assert result.approval_state == "none"


def test_finish_second_session_gives_version_2_revision(db_session, tmp_path, monkeypatch):
    """After an existing version, finishing another session → version_no=2, trigger=revision."""
    from datetime import UTC, datetime

    from app.services import word_book_service

    _dummy_pdf = tmp_path / "dummy.pdf"
    _dummy_pdf.write_bytes(b"%PDF fake")
    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: _dummy_pdf,
    )

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)

    # Seed an existing version (simulates prior finish)
    existing_doc = Document(
        template_id="General Book",
        ref_number=book.ref_number,
        docx_path="output/General_Book/old.docx",
        submission_id=secrets.token_hex(16),
        role="primary",
    )
    db_session.add(existing_doc)
    db_session.flush()
    v1 = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id="General Book",
        document_id=existing_doc.id,
        created_by_user_id=user.id,
    )
    db_session.add(v1)

    # Finish the first session
    session.state = "finished"
    db_session.commit()

    # Create a fresh active session (simulates Task 11 re-open, inserted directly)
    working_dir2 = tmp_path / "data" / "editing" / f"book-{book.id}-v2"
    working_dir2.mkdir(parents=True, exist_ok=True)
    working_path2 = working_dir2 / "revision.docx"
    working_path2.write_bytes(b"PK fake docx v2")
    session2 = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        working_path=str(working_path2),
        state="active",
        last_put_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session.add(session2)
    db_session.commit()
    db_session.refresh(book)

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


def test_finish_with_pdf_none_does_not_fail(db_session, tmp_path, monkeypatch):
    """convert_docx_to_pdf returning None → version still created, Document.pdf_path is None."""
    from datetime import UTC, datetime

    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: None,
    )

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)
    session.last_put_at = datetime.now(UTC).replace(tzinfo=None)
    db_session.commit()

    result = word_book_service.finish_word_session(db_session, user=user, book_id=book.id)
    assert result is not None

    v = db_session.query(BookVersion).filter_by(book_id=book.id).one()
    doc = db_session.get(Document, v.document_id)
    assert doc.pdf_path is None


def test_discard_draft_voids_book(db_session, tmp_path, monkeypatch):
    """Discard a book with zero versions → session discarded, voided_at set, working file gone."""
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)
    working_path = Path(session.working_path)
    assert working_path.exists()

    result = word_book_service.discard_word_session(db_session, user=user, book_id=book.id)

    db_session.refresh(session)
    assert session.state == "discarded"
    assert result.voided_at is not None
    assert not working_path.exists()
    assert db_session.query(BookVersion).filter_by(book_id=book.id).count() == 0


def test_discard_with_existing_versions_does_not_void(db_session, tmp_path, monkeypatch):
    """Discard when versions exist → voided_at stays None (reverts to last version)."""
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)

    # Seed an existing version
    existing_doc = Document(
        template_id="General Book",
        ref_number=book.ref_number,
        docx_path="output/General_Book/old.docx",
        submission_id=secrets.token_hex(16),
        role="primary",
    )
    db_session.add(existing_doc)
    db_session.flush()
    v1 = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id="General Book",
        document_id=existing_doc.id,
        created_by_user_id=user.id,
    )
    db_session.add(v1)
    session.state = "finished"
    db_session.commit()

    # Re-open: insert a second active session

    working_dir2 = tmp_path / "data" / "editing" / f"book-{book.id}-v2"
    working_dir2.mkdir(parents=True, exist_ok=True)
    working_path2 = working_dir2 / "revision.docx"
    working_path2.write_bytes(b"PK fake v2")
    session2 = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        working_path=str(working_path2),
        state="active",
    )
    db_session.add(session2)
    db_session.commit()
    db_session.refresh(book)

    result = word_book_service.discard_word_session(db_session, user=user, book_id=book.id)

    assert result.voided_at is None


def test_finish_no_active_session_raises_409(db_session, tmp_path, monkeypatch):
    """Finish when there's no active session → 409 NO_ACTIVE_SESSION."""
    from app.api.errors import AppError
    from app.services import word_book_service

    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))

    user = _user(db_session)
    book, session = _make_book_with_session(db_session, user, tmp_path)
    session.state = "finished"
    db_session.commit()

    with pytest.raises(AppError) as exc_info:
        word_book_service.finish_word_session(db_session, user=user, book_id=book.id)

    assert exc_info.value.code == "NO_ACTIVE_SESSION"
    assert exc_info.value.http_status == 409


def test_finish_classified_book_slashed_ref_no_nested_dirs(db_session, tmp_path, monkeypatch):
    """Classified book with a slashed ref (e.g. 1/5/GSSG/1) must not create nested dirs.

    Before the fix, finish_word_session passed ref_number verbatim to
    _build_docx_filename, whose space-strip left the '/' intact, turning the
    filename into a nested path that shutil.move raised FileNotFoundError on.
    """
    from datetime import UTC, datetime

    from app.db.models import BookCategory
    from app.services import word_book_service

    _dummy_pdf = tmp_path / "dummy.pdf"
    _dummy_pdf.write_bytes(b"%PDF fake")
    monkeypatch.setattr(word_book_service, "get_settings", lambda: _settings(tmp_path))
    monkeypatch.setattr(
        "app.services.word_book_service.convert_docx_to_pdf",
        lambda p: _dummy_pdf,
    )

    # Seed the "C" classified category
    if db_session.get(BookCategory, "C") is None:
        db_session.add(BookCategory(id="C", prefix="C"))
        db_session.commit()

    user = _user(db_session)

    # Build a classified Book with a slashed ref directly (mirrors production format)
    slashed_ref = "1/5/GSSG/1"
    book = Book(
        category_id="C",
        ref_number=slashed_ref,
        subject="classified test book",
        approval_state="none",
        submitted_by_user_id=user.id,
        classification_code="5/1",
    )
    db_session.add(book)
    db_session.flush()

    # Create the working file with the slug name (same as create_word_book does)
    working_dir = tmp_path / "data" / "editing" / f"book-{book.id}"
    working_dir.mkdir(parents=True, exist_ok=True)
    working_path = working_dir / f"{slashed_ref.replace('/', '-')}.docx"
    working_path.write_bytes(b"PK fake classified docx")

    session = BookEditSession(
        book_id=book.id,
        user_id=user.id,
        token=secrets.token_urlsafe(32),
        working_path=str(working_path),
        state="active",
        last_put_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(book)

    # Must not raise FileNotFoundError (the regression)
    result = word_book_service.finish_word_session(db_session, user=user, book_id=book.id)
    assert result.id == book.id

    v = db_session.query(BookVersion).filter_by(book_id=book.id).one()
    doc = db_session.get(Document, v.document_id)
    assert doc is not None

    # The docx file was actually moved to output dir
    assert Path(doc.docx_path).exists()

    # No stray nested dirs: the parent of the output file is the single output dir
    output_parent = Path(doc.docx_path).parent
    assert output_parent.name not in ("5", "GSSG"), (
        f"Path has nested dirs from raw slash: {doc.docx_path}"
    )
    # The path must not contain the raw slashed ref as directory components
    assert "1/5/GSSG/1" not in doc.docx_path.replace("\\", "/")
