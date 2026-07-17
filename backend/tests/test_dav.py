"""WebDAV endpoint tests — simulates Word's verb sequence."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db import session as session_mod
from app.db.models import Base, Book, BookCategory, BookEditSession
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "dav.db"
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
    yield db
    db.close()


@pytest.fixture()
def client(api_db: Session) -> TestClient:
    app = create_app()
    # Override get_db; DAV router has no auth, so no get_current_user override needed.
    app.dependency_overrides[get_db] = lambda: api_db
    return TestClient(app, raise_server_exceptions=True)


def _make_session(
    db: Session,
    *,
    working_path: str,
    token: str,
    state: str = "active",
) -> BookEditSession:
    """Seed a minimal Book + BookEditSession row."""
    cat = BookCategory(id="GEN", name_en="General", name_ar="عام", prefix="GEN")
    db.add(cat)
    db.flush()
    book = Book(category_id="GEN", ref_number="B-001")
    db.add(book)
    db.flush()
    sess = BookEditSession(
        book_id=book.id,
        user_id=1,
        token=token,
        working_path=working_path,
        state=state,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return sess


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_word_dav_roundtrip(client: TestClient, api_db: Session, tmp_path):
    p = tmp_path / "letter.docx"
    p.write_bytes(b"PK-original")
    _make_session(api_db, working_path=str(p), token="tok123")

    r = client.options("/dav/tok123/letter.docx")
    assert r.status_code == 200
    assert r.headers["dav"] == "1,2"
    assert r.headers["ms-author-via"] == "DAV"

    r = client.request("LOCK", "/dav/tok123/letter.docx", content=b"<lockinfo/>")
    assert r.status_code == 200 and "opaquelocktoken" in r.headers["lock-token"]

    r = client.get("/dav/tok123/letter.docx")
    assert r.status_code == 200 and r.content == b"PK-original"

    r = client.put("/dav/tok123/letter.docx", content=b"PK-edited")
    assert r.status_code == 204
    assert p.read_bytes() == b"PK-edited"

    r = client.request("PROPFIND", "/dav/tok123/letter.docx")
    assert r.status_code == 207 and b"getcontentlength" in r.content

    r = client.request("UNLOCK", "/dav/tok123/letter.docx")
    assert r.status_code == 204


def test_dav_rejects_bad_or_closed_token(client: TestClient, api_db: Session, tmp_path):
    assert client.get("/dav/nope/x.docx").status_code == 404
    p = tmp_path / "l.docx"
    p.write_bytes(b"PK")
    _make_session(api_db, working_path=str(p), token="tok9", state="finished")
    assert client.put("/dav/tok9/l.docx", content=b"X").status_code == 404
