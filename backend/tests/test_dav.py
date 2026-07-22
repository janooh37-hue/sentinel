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


@pytest.mark.parametrize("state", ["finished", "discarded"])
@pytest.mark.parametrize("method", ["PUT", "LOCK"])
def test_dav_rejects_bad_or_closed_token(
    client: TestClient, api_db: Session, tmp_path, state: str, method: str
):
    assert client.get("/dav/nope/x.docx").status_code == 404
    p = tmp_path / "l.docx"
    p.write_bytes(b"PK")
    _make_session(api_db, working_path=str(p), token="tok9", state=state)

    response = client.request(method, "/dav/tok9/l.docx", content=b"X")

    assert response.status_code == 404
    assert p.read_bytes() == b"PK"


def test_dav_missing_working_file_404(client: TestClient, api_db: Session, tmp_path):
    """Missing working_path should return 404 on GET, HEAD, and PROPFIND."""
    nonexistent = str(tmp_path / "missing.docx")
    _make_session(api_db, working_path=nonexistent, token="tok_missing")

    # GET on missing file → 404
    r = client.get("/dav/tok_missing/missing.docx")
    assert r.status_code == 404

    # HEAD on missing file → 404
    r = client.head("/dav/tok_missing/missing.docx")
    assert r.status_code == 404

    # PROPFIND on missing file → 404
    r = client.request("PROPFIND", "/dav/tok_missing/missing.docx")
    assert r.status_code == 404


def test_dav_empty_put_rejected(client: TestClient, api_db: Session, tmp_path):
    """Empty PUT body should return 400 and not truncate the file."""
    p = tmp_path / "data.docx"
    p.write_bytes(b"PK-original")
    _make_session(api_db, working_path=str(p), token="tok_empty")

    # PUT with empty body → 400
    r = client.put("/dav/tok_empty/data.docx", content=b"")
    assert r.status_code == 400

    # File should remain unchanged
    assert p.read_bytes() == b"PK-original"


# ---------------------------------------------------------------------------
# New tests: collection OPTIONS, collection PROPFIND, RFC-complete LOCK/PROPFIND
# ---------------------------------------------------------------------------


def test_dav_collection_options_advertises_dav(client: TestClient):
    """OPTIONS on the collection path (trailing slash, no filename) must return DAV headers.

    This is the root-cause regression test: the old /dav/{token}/{filename} route
    returned 404 for /dav/{token}/ because filename was empty and the converter
    didn't match.  The new :path converter fixes that.
    """
    # No session needed — OPTIONS skips token validation.
    r = client.options("/dav/any-token/")
    assert r.status_code == 200
    assert r.headers["dav"] == "1,2"
    assert r.headers["ms-author-via"] == "DAV"


def test_dav_collection_propfind(client: TestClient, api_db: Session, tmp_path):
    """PROPFIND on the collection path returns 207 with a <D:collection/> resourcetype."""
    p = tmp_path / "doc.docx"
    p.write_bytes(b"PK")
    _make_session(api_db, working_path=str(p), token="tok_col")

    r = client.request("PROPFIND", "/dav/tok_col/")
    assert r.status_code == 207
    assert b"<D:collection/>" in r.content


def test_dav_lock_body_is_rfc_complete(client: TestClient, api_db: Session, tmp_path):
    """LOCK response body must be a full RFC-4918 activelock and header must carry the token."""
    p = tmp_path / "doc.docx"
    p.write_bytes(b"PK")
    _make_session(api_db, working_path=str(p), token="tok_lock")

    r = client.request("LOCK", "/dav/tok_lock/doc.docx", content=b"<lockinfo/>")
    assert r.status_code == 200
    assert b"opaquelocktoken:tok_lock" in r.content
    assert b"<D:write/>" in r.content
    assert b"<D:exclusive/>" in r.content
    assert "opaquelocktoken" in r.headers["lock-token"]


def test_dav_file_propfind_has_supportedlock(client: TestClient, api_db: Session, tmp_path):
    """File PROPFIND must include <D:supportedlock> so Word knows it can lock."""
    p = tmp_path / "doc.docx"
    p.write_bytes(b"PK")
    _make_session(api_db, working_path=str(p), token="tok_pf")

    r = client.request("PROPFIND", "/dav/tok_pf/doc.docx")
    assert r.status_code == 207
    assert b"<D:supportedlock>" in r.content


def test_dav_diagnostic_event_is_structured_and_redacted(
    client: TestClient, api_db: Session, tmp_path, caplog
):
    p = tmp_path / "secret-name.docx"
    p.write_bytes(b"PK")
    sess = _make_session(api_db, working_path=str(p), token="secret-token")
    body = b'<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>'

    with caplog.at_level("INFO", logger="app.api.dav"):
        response = client.request(
            "PROPFIND",
            "/dav/secret-token/secret-name.docx",
            content=body,
            headers={"Depth": "0", "If": "secret-if-value", "Lock-Token": "secret-lock"},
        )

    assert response.status_code == 207
    record = next(record for record in caplog.records if record.msg == "webdav_request")
    assert record.dav_session_id == sess.id
    assert record.dav_method == "PROPFIND"
    assert record.dav_path_shape == "file"
    assert record.dav_status == 207
    assert record.dav_depth == "0"
    assert record.dav_propfind_properties == ["getetag"]
    assert record.dav_body_length == len(body)
    assert record.dav_if_present is True
    assert record.dav_lock_token_present is True
    assert record.dav_response_content_type_present is True
    assert "secret-token" not in record.getMessage()
    assert "secret-name" not in record.getMessage()
    assert "secret-if-value" not in record.getMessage()
    assert "secret-lock" not in record.getMessage()
