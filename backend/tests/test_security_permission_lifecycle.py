"""Temporary grants must not outlive the approved employee-read exception."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import hash_token
from app.db.models import AuthSession, Employee, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import perm_service
from tests.conftest import make_user


def _client(db: Session, user_id: int) -> TestClient:
    token = f"permission-lifecycle-{user_id}"
    db.add(
        AuthSession(
            user_id=user_id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(days=1),
        )
    )
    db.commit()
    factory = sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False)
    app = create_app()

    def request_db():
        with factory() as session:
            yield session

    app.dependency_overrides[get_db] = request_db
    client = TestClient(app)
    client.cookies.set("gssg_session", token)
    return client


def _precondition(client: TestClient, url: str) -> dict[str, str]:
    response = client.get(url)
    assert response.status_code == 200, response.text
    return {"If-Match": response.headers["ETag"]}


@pytest.mark.parametrize("writer", ["request", "single", "bulk"])
def test_employee_read_deny_returns_at_expiry_before_and_after_sweep(
    api_db: Session, writer: str
) -> None:
    admin = make_user(api_db, role="admin", email="admin@lifecycle.test")
    operator = make_user(api_db, email="operator@lifecycle.test")
    employee = Employee(id="LIFECYCLE", name_en="Synthetic Employee")
    api_db.add(employee)
    api_db.commit()
    admin_client, operator_client = _client(api_db, admin.id), _client(api_db, operator.id)
    override_url = f"/api/v1/auth/users/{operator.id}/permissions"
    detail_url = f"/api/v1/employees/{employee.id}"
    denied = {"capability": "employees.view", "effect": "deny"}
    assert (
        admin_client.put(
            override_url, headers=_precondition(admin_client, override_url), json=denied
        ).status_code
        == 200
    )
    assert operator_client.get(detail_url).status_code == 403
    api_db.expire_all()
    row = api_db.get(UserPermission, (operator.id, "employees.view"))
    assert row is not None and row.effect == "deny" and row.expires_at is None
    assert admin_client.get(detail_url).status_code == 200

    grant = {
        "capability": "employees.view",
        "effect": "grant",
        "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
    }
    if writer == "request":
        requested = operator_client.post(
            "/api/v1/permissions/requests", json={"capability": "employees.view"}
        )
        assert requested.status_code == 201, requested.text
        issued = admin_client.post(
            f"/api/v1/permissions/requests/{requested.json()['id']}/decide",
            json={"decision": "once", "window": "2h"},
        )
    elif writer == "bulk":
        issued = admin_client.put(
            override_url + "/bulk",
            headers=_precondition(admin_client, override_url),
            json={"items": [grant]},
        )
    else:
        issued = admin_client.put(
            override_url, headers=_precondition(admin_client, override_url), json=grant
        )
    assert issued.status_code == 200, issued.text
    assert operator_client.get(detail_url).status_code == 200
    api_db.expire_all()
    row = api_db.get(UserPermission, (operator.id, "employees.view"))
    assert row is not None and row.effect == "grant" and row.expires_at is not None
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    api_db.commit()
    expired_at = row.expires_at

    assert operator_client.get(detail_url).status_code == 403
    api_db.expire_all()
    assert row.effect == "grant" and row.expires_at == expired_at
    assert employee.name_en == "Synthetic Employee"
    assert admin_client.get(detail_url).status_code == 200
    assert perm_service.sweep_expired_grants(api_db) == 1
    api_db.expire_all()
    row = api_db.get(UserPermission, (operator.id, "employees.view"))
    assert row is not None and row.effect == "deny" and row.expires_at is None
    assert operator_client.get(detail_url).status_code == 403
    assert admin_client.get(detail_url).status_code == 200


@pytest.mark.parametrize(
    "initial_role,current_role", [("operator", "manager"), ("manager", "operator")]
)
@pytest.mark.parametrize("writer", ["single", "bulk"])
def test_expiry_uses_current_role_not_grant_time_role(
    api_db: Session, initial_role: str, current_role: str, writer: str
) -> None:
    admin = make_user(api_db, role="admin", email="role-admin@lifecycle.test")
    target = make_user(api_db, role=initial_role, email="role-target@lifecycle.test")
    admin_client, target_client = _client(api_db, admin.id), _client(api_db, target.id)
    url = f"/api/v1/auth/users/{target.id}/permissions"
    # leaves.edit is a manager default but an additional operator grant.
    assert (
        admin_client.put(
            url,
            headers=_precondition(admin_client, url),
            json={"capability": "leaves.edit", "effect": "deny"},
        ).status_code
        == 200
    )
    grant = {
        "capability": "leaves.edit",
        "effect": "grant",
        "expires_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
    }
    issued = (
        admin_client.put(
            url + "/bulk", headers=_precondition(admin_client, url), json={"items": [grant]}
        )
        if writer == "bulk"
        else admin_client.put(url, headers=_precondition(admin_client, url), json=grant)
    )
    assert issued.status_code == 200, issued.text
    assert "leaves.edit" in target_client.get("/api/v1/auth/me/capabilities").json()
    changed = admin_client.patch(
        f"/api/v1/auth/users/{target.id}/role", json={"role": current_role}
    )
    assert changed.status_code == 200, changed.text
    api_db.expire_all()
    row = api_db.get(UserPermission, (target.id, "leaves.edit"))
    assert row is not None
    row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    api_db.commit()
    expired_at = row.expires_at
    assert "leaves.edit" not in target_client.get("/api/v1/auth/me/capabilities").json()
    api_db.expire_all()
    assert row.effect == "grant" and row.expires_at == expired_at
    assert "leaves.edit" in admin_client.get("/api/v1/auth/me/capabilities").json()
    assert perm_service.sweep_expired_grants(api_db) == 1
    api_db.expire_all()
    row = api_db.get(UserPermission, (target.id, "leaves.edit"))
    if current_role == "manager":
        assert row is not None and row.effect == "deny" and row.expires_at is None
    else:
        assert row is None
    assert "leaves.edit" not in target_client.get("/api/v1/auth/me/capabilities").json()
    assert "leaves.edit" in admin_client.get("/api/v1/auth/me/capabilities").json()
