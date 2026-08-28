from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import models
from app.db.models import User
from app.db.session import get_db
from app.main import create_app
from app.schemas import dashboard as dashboard_schemas
from app.schemas import settings as settings_schemas
from app.services import dashboard_service, perm_service, settings_service

LAYOUT = {
    "widgets": [
        {
            "id": "pending",
            "visible": True,
            "order": 0,
            "zone": "top",
        }
    ],
    "quick_actions": [
        {
            "id": "General Book",
            "visible": True,
            "order": 0,
        }
    ],
    "canvas_width": "wide",
}


def _user(db: Session, email: str) -> User:
    user = User(
        email=email,
        password_hash="x",
        role="operator",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _client(db: Session, user: User) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def test_fresh_user_gets_no_dashboard_layout(api_db: Session) -> None:
    user = _user(api_db, "fresh-layout@x.ae")

    response = _client(api_db, user).get("/api/v1/dashboard/layout")

    assert response.status_code == 200
    assert response.json() is None


def test_dashboard_layout_put_get_round_trip_without_settings_edit(api_db: Session) -> None:
    user = _user(api_db, "layout-owner@x.ae")
    assert perm_service.has_capability(api_db, user, "settings.edit") is False
    client = _client(api_db, user)

    put_response = client.put("/api/v1/dashboard/layout", json=LAYOUT)
    get_response = client.get("/api/v1/dashboard/layout")

    assert put_response.status_code == 200
    assert put_response.json() == LAYOUT
    assert get_response.status_code == 200
    assert get_response.json() == LAYOUT


def test_dashboard_layout_is_scoped_to_current_user(api_db: Session) -> None:
    user_a = _user(api_db, "layout-a@x.ae")
    user_b = _user(api_db, "layout-b@x.ae")

    assert _client(api_db, user_a).put("/api/v1/dashboard/layout", json=LAYOUT).status_code == 200

    response_b = _client(api_db, user_b).get("/api/v1/dashboard/layout")
    assert response_b.status_code == 200
    assert response_b.json() is None


def test_invalid_stored_dashboard_layout_is_treated_as_absent(db_session: Session) -> None:
    row_model = getattr(models, "UserDashboardLayout", None)
    assert row_model is not None, "per-user dashboard model is missing"
    user = _user(db_session, "invalid-layout@x.ae")
    db_session.add(row_model(user_id=user.id, layout={"canvas_width": "enormous"}))
    db_session.commit()

    assert dashboard_service.get_user_layout(db_session, user.id) is None


def test_dashboard_schema_is_separate_from_app_settings(db_session: Session) -> None:
    assert hasattr(dashboard_schemas, "DashboardLayout")
    assert hasattr(dashboard_schemas, "DASHBOARD_WIDGET_IDS")
    assert not hasattr(settings_schemas, "DashboardLayout")
    assert "dashboard_layout" not in settings_schemas.AppSettingsRead.model_fields
    assert "dashboard_layout" not in settings_schemas.AppSettingsUpdate.model_fields
    assert "dashboard_layout" not in settings_service.get_settings(db_session).model_dump()
