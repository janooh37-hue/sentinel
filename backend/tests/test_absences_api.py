"""Employee-record absence endpoints: range add, list, delete, capability gates.

Mirrors the violations pattern: employee-scoped routes in the employees router,
recorded with ``leaves.view`` / ``leaves.edit`` because an absence is recorded
the same way a sick leave is — a fact on the employee's record.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api.deps import get_current_user
from app.db import session as session_mod
from app.db.models import Absence, Base, Employee, User
from app.db.session import attach_sqlite_pragmas, get_db
from app.main import create_app
from app.services import perm_service


@pytest.fixture()
def api_db(monkeypatch, tmp_path) -> Session:
    db_file = tmp_path / "absences.db"
    eng = create_engine(
        f"sqlite:///{db_file}", future=True, connect_args={"check_same_thread": False}
    )
    attach_sqlite_pragmas(eng, wal=False)
    Base.metadata.create_all(eng)
    TestSession = sessionmaker(bind=eng, autoflush=False, expire_on_commit=False, future=True)
    monkeypatch.setattr(session_mod, "engine", eng)
    monkeypatch.setattr(session_mod, "SessionLocal", TestSession)
    db = TestSession()
    perm_service.seed_role_defaults(db)
    db.add(Employee(id="G1001", name_en="TEST GUARD", name_ar="حارس", doj=date(2020, 1, 1)))
    db.commit()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def db_session(api_db) -> Session:
    return api_db


def _client_for(api_db: Session, role: str, email: str) -> TestClient:
    user = User(email=email, password_hash="x", role=role, status="active")
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app, raise_server_exceptions=True)
    client.user_id = user.id  # type: ignore[attr-defined]
    return client


@pytest.fixture()
def client(api_db) -> TestClient:
    """A manager: ``leaves.view`` + ``leaves.edit``."""
    return _client_for(api_db, "manager", "mgr@x.ae")


@pytest.fixture()
def viewer_client(api_db) -> TestClient:
    """An operator: ``leaves.view`` only — can see absences, cannot mark them."""
    return _client_for(api_db, "operator", "ops@x.ae")


def test_post_creates_one_row_per_day(client, db_session):
    response = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-11", "note": "no call"},
    )
    assert response.status_code == 201
    body = response.json()
    assert [row["date"] for row in body["created"]] == ["2026-07-09", "2026-07-10", "2026-07-11"]
    assert body["skipped_off_roster"] == []
    assert all(row["note"] == "no call" for row in body["created"])
    assert db_session.query(Absence).count() == 3


def test_post_stamps_the_acting_user(client, db_session):
    client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-09"},
    )
    row = db_session.query(Absence).one()
    assert row.created_by == client.user_id


def test_post_skips_and_reports_off_roster_days(client, api_db):
    emp = api_db.get(Employee, "G1001")
    emp.doj = date(2026, 7, 10)
    api_db.commit()

    response = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-08", "end_date": "2026-07-11"},
    )

    assert response.status_code == 201
    body = response.json()
    assert [row["date"] for row in body["created"]] == ["2026-07-10", "2026-07-11"]
    assert body["skipped_off_roster"] == ["2026-07-08", "2026-07-09"]


def test_post_is_idempotent_per_day(client, db_session):
    payload = {"start_date": "2026-07-09", "end_date": "2026-07-10"}
    first = client.post("/api/v1/employees/G1001/absences", json=payload)
    second = client.post("/api/v1/employees/G1001/absences", json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["created"] == []
    assert db_session.query(Absence).count() == 2


def test_post_rejects_an_inverted_range(client):
    response = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-11", "end_date": "2026-07-09"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ABSENCE_RANGE_INVERTED"


def test_post_unknown_employee_is_a_service_404(client):
    response = client.post(
        "/api/v1/employees/G9999/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-09"},
    )
    assert response.status_code == 404
    # The service's code, not Starlette's HTTP_404: a bare status assertion
    # passes against a route that does not exist at all.
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


def test_get_lists_newest_first(client):
    client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-10"},
    )
    client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-06-01", "end_date": "2026-06-01"},
    )

    response = client.get("/api/v1/employees/G1001/absences")

    assert response.status_code == 200
    assert [row["date"] for row in response.json()] == ["2026-07-10", "2026-07-09", "2026-06-01"]


def test_get_unknown_employee_is_a_service_404(client):
    response = client.get("/api/v1/employees/G9999/absences")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


def test_delete_unmarks_the_day(client, db_session):
    created = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-09"},
    ).json()["created"]

    response = client.request("DELETE", f"/api/v1/employees/G1001/absences/{created[0]['id']}")

    assert response.status_code == 204
    assert db_session.query(Absence).count() == 0


def test_delete_twice_is_a_service_404(client):
    created = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-09"},
    ).json()["created"]
    client.request("DELETE", f"/api/v1/employees/G1001/absences/{created[0]['id']}")

    response = client.request("DELETE", f"/api/v1/employees/G1001/absences/{created[0]['id']}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "ABSENCE_NOT_FOUND"


def test_viewer_can_read_but_not_write(viewer_client, client):
    created = client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-09", "end_date": "2026-07-09"},
    ).json()["created"]

    assert viewer_client.get("/api/v1/employees/G1001/absences").status_code == 200

    denied_post = viewer_client.post(
        "/api/v1/employees/G1001/absences",
        json={"start_date": "2026-07-12", "end_date": "2026-07-12"},
    )
    assert denied_post.status_code == 403
    assert denied_post.json()["error"]["details"]["capability"] == "leaves.edit"

    denied_delete = viewer_client.request(
        "DELETE", f"/api/v1/employees/G1001/absences/{created[0]['id']}"
    )
    assert denied_delete.status_code == 403
    assert denied_delete.json()["error"]["details"]["capability"] == "leaves.edit"
