"""Per-account screen-lock timer API contract."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.main import create_app
from tests.conftest import make_user


def _client_for(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_updates_and_persists_signed_in_users_lock_timer(api_db: Session) -> None:
    user = make_user(api_db, email="timer-owner@test.ae")
    client = _client_for(api_db, user)

    response = client.patch(
        "/api/v1/auth/me/lock-timer",
        json={"idle_lock_seconds": 30},
    )

    assert response.status_code == 200
    assert response.json()["idle_lock_seconds"] == 30
    assert client.get("/api/v1/auth/me").json()["idle_lock_seconds"] == 30
    api_db.refresh(user)
    assert user.idle_lock_seconds == 30


def test_rejects_unsupported_lock_timer_without_changing_value(api_db: Session) -> None:
    user = make_user(api_db, email="timer-invalid@test.ae")
    client = _client_for(api_db, user)

    response = client.patch(
        "/api/v1/auth/me/lock-timer",
        json={"idle_lock_seconds": 45},
    )

    assert response.status_code == 422
    api_db.refresh(user)
    assert user.idle_lock_seconds == 1800


def test_new_users_default_to_thirty_minute_lock_timer(api_db: Session) -> None:
    user = make_user(api_db, email="timer-default@test.ae")
    client = _client_for(api_db, user)

    response = client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json()["idle_lock_seconds"] == 1800
