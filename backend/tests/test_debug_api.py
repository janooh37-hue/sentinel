"""Debug console: admin gate, issue grouping, browser-error capture, prompt."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.api.v1 import debug
from app.db import session as session_mod
from app.db.models import Base, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    eng = create_engine(
        f"sqlite:///{tmp_path / 'debug.db'}", connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    yield db
    db.close()
    eng.dispose()


@pytest.fixture()
def logfile(monkeypatch, tmp_path):
    path = tmp_path / "gssg.log"
    monkeypatch.setattr(
        debug, "_log_path", lambda source: path if source == "app" else tmp_path / "none.log"
    )
    return path


def _client(db: Session, role: str) -> TestClient:
    user = User(email=f"{role}@x.ae", password_hash="x", role=role, status="active")
    db.add(user)
    db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _write(path, *records):
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")


def test_non_admin_is_forbidden(api_db):
    assert _client(api_db, "manager").get("/api/v1/debug/issues").status_code == 403


def test_issues_group_by_shape_and_rank_errors_first(api_db, logfile):
    _write(
        logfile,
        {"ts": "t1", "level": "WARNING", "logger": "mail", "msg": "retry 1 for 'a@x.ae'"},
        {"ts": "t2", "level": "WARNING", "logger": "mail", "msg": "retry 7 for 'b@y.ae'"},
        {"ts": "t3", "level": "INFO", "logger": "mail", "msg": "sent"},
        {
            "ts": "t4",
            "level": "ERROR",
            "logger": "pdf",
            "msg": "boom",
            "exc": "Traceback\nValueError: x",
        },
    )
    groups = _client(api_db, "admin").get("/api/v1/debug/issues").json()
    assert [(g["logger"], g["count"]) for g in groups] == [("pdf", 1), ("mail", 2)]
    assert groups[1]["first_seen"] == "t1" and groups[1]["last_seen"] == "t2"


def test_client_error_lands_in_issues_and_prompt(api_db, logfile):
    admin = _client(api_db, "admin")
    seen: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = seen.append  # type: ignore[method-assign]
    logging.getLogger("client").addHandler(handler)
    try:
        assert (
            admin.post("/api/v1/debug/client-error", json={"message": "x is undefined"}).status_code
            == 204
        )
    finally:
        logging.getLogger("client").removeHandler(handler)
    rec = seen[-1]
    _write(logfile, {"ts": "t", "level": "WARNING", "logger": rec.name, "msg": rec.getMessage()})
    issue = admin.get("/api/v1/debug/issues").json()[0]
    prompt = admin.post(
        "/api/v1/debug/prompt", json={"issue_id": issue["id"], "note": "only on mobile"}
    ).json()
    assert "x is undefined" in prompt["prompt"] and "only on mobile" in prompt["prompt"]


def test_overview_reports_checks(api_db, logfile):
    body = _client(api_db, "admin").get("/api/v1/debug/overview").json()
    assert {c["id"] for c in body["checks"]} >= {
        "db",
        "migrations",
        "scheduler",
        "word",
        "disk",
        "errors",
    }


def test_diagnose_runs_in_background_and_reports_failure(api_db, logfile, monkeypatch):
    import sys
    import time

    # A CLI that exits non-zero: the job must end "failed" with the reason, not hang.
    monkeypatch.setattr(debug, "_engines", lambda: {"codex": sys.executable})
    admin = _client(api_db, "admin")
    job = admin.post("/api/v1/debug/diagnose", json={}).json()
    assert job["status"] == "running"
    for _ in range(100):
        job = admin.get(f"/api/v1/debug/diagnose/{job['id']}").json()
        if job["status"] != "running":
            break
        time.sleep(0.1)
    assert job["status"] == "failed" and "exited with code" in job["error"]


def test_diagnose_without_engine_is_409(api_db, monkeypatch):
    monkeypatch.setattr(debug, "_engines", dict)
    assert _client(api_db, "admin").post("/api/v1/debug/diagnose", json={}).status_code == 409
