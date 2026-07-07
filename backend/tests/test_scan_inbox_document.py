"""Scan Inbox: candidates/fields exposure + the document-serve endpoint."""

import pytest

from app.api.errors import NotFoundError
from app.api.v1.scan_inbox import list_scan_inbox
from app.db.models import ScanInbox, User


def _user(db, email="op@x.ae") -> User:
    u = User(email=email, password_hash="x", role="operator", status="active")
    db.add(u)
    db.flush()
    return u


def test_list_exposes_fields_and_candidates(db_session):
    user = _user(db_session)
    cands = [{"employee_id": "G1", "name_en": "Ahmed Ali", "name_ar": None, "score": 0.62}]
    db_session.add(
        ScanInbox(
            source="email",
            file_path="/s/x.pdf",
            filename="x.pdf",
            state="unrouted",
            owner_user_id=user.id,
            fields={"name_en": "Ahmed Ali"},
            candidates=cands,
        )
    )
    db_session.flush()
    res = list_scan_inbox(db=db_session, user=user, state="unrouted")
    item = res.items[0]
    assert item.fields == {"name_en": "Ahmed Ali"}
    assert item.candidates[0].employee_id == "G1"
    assert item.candidates[0].score == 0.62


def test_get_scan_document_serves_inline(db_session, tmp_path, monkeypatch):
    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "owner@x.ae")
    f = tmp_path / "scan.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    monkeypatch.setattr(svc, "abs_file_path", lambda item: f)
    row = ScanInbox(
        source="email",
        file_path="/s/x.pdf",
        filename="scan.pdf",
        state="unrouted",
        owner_user_id=user.id,
    )
    db_session.add(row)
    db_session.flush()

    resp = api_mod.get_scan_document(item_id=row.id, db=db_session, user=user)
    assert resp.media_type == "application/pdf"
    assert resp.headers["content-disposition"].startswith("inline")


def test_get_scan_document_foreign_item_404(db_session, tmp_path, monkeypatch):
    from app.api.v1 import scan_inbox as api_mod

    owner = _user(db_session, "owner2@x.ae")
    other = _user(db_session, "other@x.ae")
    row = ScanInbox(
        source="email",
        file_path="/s/x.pdf",
        filename="scan.pdf",
        state="unrouted",
        owner_user_id=owner.id,
    )
    db_session.add(row)
    db_session.flush()

    with pytest.raises(NotFoundError):
        api_mod.get_scan_document(item_id=row.id, db=db_session, user=other)


def test_get_scan_document_missing_file_404(db_session, tmp_path, monkeypatch):
    from fastapi import HTTPException

    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "owner3@x.ae")
    monkeypatch.setattr(svc, "abs_file_path", lambda item: tmp_path / "does-not-exist.pdf")
    row = ScanInbox(
        source="email",
        file_path="/s/x.pdf",
        filename="scan.pdf",
        state="unrouted",
        owner_user_id=user.id,
    )
    db_session.add(row)
    db_session.flush()

    with pytest.raises(HTTPException) as ei:
        api_mod.get_scan_document(item_id=row.id, db=db_session, user=user)
    assert ei.value.status_code == 404


def test_get_scan_document_unsafe_type_forces_download(db_session, tmp_path, monkeypatch):
    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "owner4@x.ae")
    f = tmp_path / "evil.html"
    f.write_bytes(b"<script>alert(1)</script>")
    monkeypatch.setattr(svc, "abs_file_path", lambda item: f)
    row = ScanInbox(
        source="email",
        file_path="/s/evil.html",
        filename="evil.html",
        state="unrouted",
        owner_user_id=user.id,
    )
    db_session.add(row)
    db_session.flush()

    resp = api_mod.get_scan_document(item_id=row.id, db=db_session, user=user)
    assert resp.media_type == "application/octet-stream"
    assert resp.headers["content-disposition"].startswith("attachment")
    assert resp.headers["x-content-type-options"] == "nosniff"


def test_get_scan_document_base64_returns_text_plain(db_session, tmp_path, monkeypatch):
    import base64

    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "b64@x.ae")
    f = tmp_path / "scan.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    monkeypatch.setattr(svc, "abs_file_path", lambda item: f)
    row = ScanInbox(
        source="email",
        file_path="/s/x.pdf",
        filename="scan.pdf",
        state="unrouted",
        owner_user_id=user.id,
    )
    db_session.add(row)
    db_session.flush()

    resp = api_mod.get_scan_document(item_id=row.id, db=db_session, user=user, encoding="base64")
    assert resp.media_type == "text/plain"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert base64.b64decode(resp.body) == b"%PDF-1.4 hello"
