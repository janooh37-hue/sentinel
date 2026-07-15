"""Announcements API tests — groups + multipart send."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import announce_service, openwa_client, perm_service

# ---------------------------------------------------------------------------
# Fixtures — mirrors test_duty_supervisors_api.py pattern
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "announcements.db"
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


def _user(db: Session, role: str = "admin", email: str = "a@x.ae") -> User:
    u = User(email=email, password_hash="x", role=role, status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def admin_client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="admin", email="admin_ann@x.ae"))


@pytest.fixture()
def client(api_db) -> TestClient:
    return _client(api_db, _user(api_db, role="manager", email="mgr_ann@x.ae"))


# ---------------------------------------------------------------------------
# API tests
# ---------------------------------------------------------------------------


def test_list_groups(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "groups_available",
        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )
    r = admin_client.get("/api/v1/announcements/groups")
    assert r.status_code == 200
    assert r.json() == [{"id": "1@g.us", "name": "Alpha"}]


def test_send_text(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "groups_available",
        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )
    monkeypatch.setattr(
        announce_service,
        "send_announcement",
        lambda db, *, groups, text, attachment, book_id, sent_by, mentions=None: SimpleNamespace(
            announcement_id=1,
            sent=1,
            failed=0,
            results=[SimpleNamespace(group_id="1@g.us", group_name="Alpha", ok=True, error=None)],
        ),
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"group_ids": ["1@g.us"], "text": "hi"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["sent"] == 1


def test_send_requires_text_or_attachment(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "groups_available",
        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"group_ids": ["1@g.us"], "text": ""},
    )
    assert r.status_code == 422


def test_send_requires_capability(client):
    r = client.post(
        "/api/v1/announcements/send",
        data={"group_ids": ["1@g.us"], "text": "hi"},
    )
    assert r.status_code in (401, 403)


def test_send_route_forwards_mentions(
    admin_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, object] = {}

    def fake_send(db: object, **kw: object) -> announce_service.AnnouncementResult:
        seen.update(kw)
        return announce_service.AnnouncementResult(announcement_id=1, sent=1, failed=0, results=[])

    monkeypatch.setattr(announce_service, "send_announcement", fake_send)
    monkeypatch.setattr(
        announce_service,
        "groups_available",
        lambda db: [openwa_client.Group(id="g1@g.us", name="G One")],
    )
    resp = admin_client.post(
        "/api/v1/announcements/send",
        data={
            "group_ids": ["g1@g.us"],
            "text": "hi @971509059931",
            "mentions": ["971509059931", "0501234567"],
        },
    )
    assert resp.status_code == 200
    assert seen["mentions"] == ["971509059931", "0501234567"]


def test_send_requires_some_recipient(admin_client):
    r = admin_client.post("/api/v1/announcements/send", data={"text": "hi"})
    assert r.status_code == 422


def test_send_direct_only(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "send_direct_announcement",
        lambda db, *, employee_ids, text, attachment, sent_by: [
            announce_service.DirectSendResult("G1", "John", ok=True),
            announce_service.DirectSendResult("G2", "Ali", ok=False, error="no valid phone number"),
        ],
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"text": "hi", "employee_ids": ["G1", "G2"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["announcement_id"] is None
    assert body["sent"] == 1 and body["failed"] == 1
    assert body["results"] == []
    assert body["direct_results"][0] == {
        "employee_id": "G1",
        "employee_name": "John",
        "ok": True,
        "fell_back": False,
        "error": None,
    }


def test_send_groups_and_direct_counts_combine(admin_client, monkeypatch):
    monkeypatch.setattr(
        announce_service,
        "groups_available",
        lambda db: [SimpleNamespace(id="1@g.us", name="Alpha")],
    )
    monkeypatch.setattr(
        announce_service,
        "send_announcement",
        lambda db, *, groups, text, attachment, book_id, sent_by, mentions=None: SimpleNamespace(
            announcement_id=7,
            sent=1,
            failed=0,
            results=[SimpleNamespace(group_id="1@g.us", group_name="Alpha", ok=True, error=None)],
        ),
    )
    monkeypatch.setattr(
        announce_service,
        "send_direct_announcement",
        lambda db, *, employee_ids, text, attachment, sent_by: [
            announce_service.DirectSendResult("G1", "John", ok=True),
        ],
    )
    r = admin_client.post(
        "/api/v1/announcements/send",
        data={"text": "hi", "group_ids": ["1@g.us"], "employee_ids": ["G1"]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["announcement_id"] == 7
    assert body["sent"] == 2 and body["failed"] == 0
