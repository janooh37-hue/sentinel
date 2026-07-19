"""Live preview of an active Word session's working docx."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from docx import Document as DocxFile
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.db.models import Book, BookCategory, BookEditSession
from app.services import word_book_service


@pytest.fixture
def active_session(db_session: Session, tmp_path: Path) -> tuple[Book, Path]:
    if db_session.get(BookCategory, "GS") is None:
        db_session.add(BookCategory(id="GS", prefix="GS"))
        db_session.flush()
    book = Book(category_id="GS", ref_number="1/11/GSSG/7", subject="معاينة")
    db_session.add(book)
    db_session.flush()
    working = tmp_path / "editing" / f"book-{book.id}" / "1-11-GSSG-7.docx"
    working.parent.mkdir(parents=True)
    d = DocxFile()
    d.add_paragraph("معاينة حية")
    d.save(str(working))
    sess = BookEditSession(
        book_id=book.id,
        user_id=1,
        token="tok-preview",
        working_path=str(working),
        state="active",
        last_put_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session.add(sess)
    db_session.commit()
    return book, working


def test_preview_renders_and_caches(
    db_session: Session,
    active_session: tuple[Book, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    book, working = active_session
    calls: list[Path] = []

    def fake_convert(src: Path) -> Path:
        calls.append(src)
        out = src.with_suffix(".pdf")
        out.write_bytes(b"%PDF-1.4 fake")
        return out

    monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", fake_convert)
    p1 = word_book_service.render_session_preview(db_session, book_id=book.id)
    assert p1.name == "preview-src.pdf" and p1.read_bytes().startswith(b"%PDF")
    # Second call with unchanged working file: served from cache, no re-convert.
    p2 = word_book_service.render_session_preview(db_session, book_id=book.id)
    assert p2 == p1 and len(calls) == 1


def test_preview_requires_a_save(db_session: Session, active_session: tuple[Book, Path]) -> None:
    book, _ = active_session
    sess = db_session.query(BookEditSession).filter_by(book_id=book.id).one()
    sess.last_put_at = None
    db_session.commit()
    with pytest.raises(AppError) as ei:
        word_book_service.render_session_preview(db_session, book_id=book.id)
    assert ei.value.code == "NO_SAVES_YET"


def test_preview_route_supports_base64(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pdf.js canvas fetches ?encoding=base64 (text/plain) — the route must honor it."""
    import base64

    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.api.deps import get_current_user
    from app.db import session as session_mod
    from app.db.models import Base, User
    from app.db.session import attach_sqlite_pragmas, get_db
    from app.main import create_app
    from app.services import perm_service

    # File-backed DB: TestClient dispatches on a worker thread, so the shared
    # in-memory fixture engine can't be reused here (same pattern as
    # test_book_attachment_manage.api_db).
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
    try:
        perm_service.seed_role_defaults(db)
        db.add(BookCategory(id="GS", prefix="GS"))
        book = Book(category_id="GS", ref_number="1/11/GSSG/8", subject="معاينة")
        db.add(book)
        db.flush()
        working = tmp_path / "editing" / f"book-{book.id}" / "1-11-GSSG-8.docx"
        working.parent.mkdir(parents=True)
        DocxFile().save(str(working))
        db.add(
            BookEditSession(
                book_id=book.id,
                user_id=1,
                token="tok-route",
                working_path=str(working),
                state="active",
                last_put_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        user = User(email="mgr@x.ae", password_hash="x", role="admin", status="active")
        db.add(user)
        db.commit()

        def fake_convert(src: Path) -> Path:
            out = src.with_suffix(".pdf")
            out.write_bytes(b"%PDF-1.4 route")
            return out

        monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", fake_convert)

        app = create_app()
        app.dependency_overrides[get_db] = lambda: db
        app.dependency_overrides[get_current_user] = lambda: user
        client = TestClient(app, raise_server_exceptions=True)

        res = client.get(f"/api/v1/books/{book.id}/word-sessions/preview?encoding=base64")
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/plain")
        assert base64.b64decode(res.text).startswith(b"%PDF")
    finally:
        db.close()
        get_settings.cache_clear()


def test_preview_unavailable_when_conversion_fails(
    db_session: Session,
    active_session: tuple[Book, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    book, _ = active_session
    monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", lambda p: None)
    with pytest.raises(AppError) as ei:
        word_book_service.render_session_preview(db_session, book_id=book.id)
    assert ei.value.code == "PREVIEW_UNAVAILABLE"
