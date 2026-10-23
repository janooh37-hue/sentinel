"""The signed-in identity carries the Arabic job title next to the English one.

The dashboard hero renders the linked employee's position in the UI language;
without ``position_ar`` an Arabic session would show the English title.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, User
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


def _client_for(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_session_and_identity_carry_both_position_languages(api_db: Session) -> None:
    api_db.add(
        Employee(
            id="G-7001",
            name_en="Hamdan Saeed Al Ali",
            name_ar="حمدان سعيد آل علي",
            position="HR Officer",
            position_ar="مسؤول موارد بشرية",
            department="Human Resources",
        )
    )
    user = make_user(api_db, email="hero-position@test.ae")
    user.employee_id = "G-7001"
    api_db.commit()
    client = _client_for(api_db, user)

    me = client.get("/api/v1/auth/me").json()
    identity = client.get("/api/v1/identity/me").json()

    for payload in (me, identity):
        assert payload["position"] == "HR Officer"
        assert payload["position_ar"] == "مسؤول موارد بشرية"


def test_unlinked_session_has_no_position(api_db: Session) -> None:
    user = make_user(api_db, email="hero-unlinked@test.ae")
    client = _client_for(api_db, user)

    me = client.get("/api/v1/auth/me").json()

    assert me["position"] is None
    assert me["position_ar"] is None
