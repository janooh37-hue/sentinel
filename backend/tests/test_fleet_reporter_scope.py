"""Fleet reporter routing, fixed scope, account administration and migration."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.routing import APIRoute
from httpx import Response
from sqlalchemy import create_engine, inspect, select

from app.api.errors import AppError
from app.core.scoped_roles import INMATE_REPORTER_ALLOWED_ROUTES, SCOPED_SHARED_ROUTES
from app.db.models import AuditLog, Employee, RolePermission, User, UserPermission, VehicleFine
from app.db.session import attach_sqlite_pragmas
from app.main import create_app
from app.services import perm_service
from tests.fleet_support import FleetEnv, set_signer_rows

# Literal snapshot of origin/main's api/deps.py allowlist, not derived from the
# registry under test: moving to scoped roles must not alter the inmate surface.
ORIGINAL_INMATE_ROUTES = frozenset(
    {
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/verify-password"),
        ("PATCH", "/api/v1/auth/me/lock-timer"),
        ("PATCH", "/api/v1/auth/me/lock-layout"),
        ("GET", "/api/v1/auth/me/capabilities"),
        ("GET", "/api/v1/identity/me"),
        ("GET", "/api/v1/signatures/me"),
        ("POST", "/api/v1/auth/me/signature"),
        ("POST", "/api/v1/books/word-sessions"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/status"),
        ("GET", "/api/v1/books/{book_id}/word-sessions/preview"),
        ("POST", "/api/v1/books/{book_id}/word-sessions/finish"),
        ("DELETE", "/api/v1/books/{book_id}/word-sessions"),
        ("POST", "/api/v1/books/{book_id}/word-sessions"),
        ("GET", "/api/v1/employees/{employee_id}/photo"),
        ("GET", "/api/v1/templates"),
        ("GET", "/api/v1/templates/{template_id}/fields"),
        ("GET", "/api/v1/inmate-violations/nationalities"),
        ("GET", "/api/v1/book-categories"),
        ("GET", "/api/v1/books"),
        ("GET", "/api/v1/books/facets"),
        ("GET", "/api/v1/books/by-ref/{ref}"),
        ("GET", "/api/v1/books/{book_id}"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/fields"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/annotations"),
        ("GET", "/api/v1/books/{book_id}/versions/{version_id}/signed-document"),
        ("GET", "/api/v1/books/{book_id}/imported-document"),
        ("POST", "/api/v1/books/{book_id}/submit"),
        ("POST", "/api/v1/documents/generate"),
        ("GET", "/api/v1/jobs/{job_id}"),
        ("GET", "/api/v1/documents/{document_id}/download"),
    }
)


def _assert_error(response: Response, status: int, code: str) -> None:
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/employees",
        "/api/v1/auth/users",
        "/api/v1/dashboard/layout",
    ],
    ids=["employee-directory", "admin-users", "authenticated-only-dashboard"],
)
def test_fleet_reporter_routes_fail_closed(fleet_env: FleetEnv, path: str) -> None:
    response = fleet_env.client(fleet_env.reporter).get(path)
    _assert_error(response, 403, "SCOPED_ROLE_ROUTE_FORBIDDEN")


def test_fleet_reporter_cannot_delete_fine(fleet_env: FleetEnv) -> None:
    env = fleet_env
    fine_id = env.fines[0].id
    response = env.client(env.reporter).delete(f"/api/v1/vehicles/{env.vehicle.id}/fines/{fine_id}")
    _assert_error(response, 403, "SCOPED_ROLE_ROUTE_FORBIDDEN")
    env.db.expire_all()
    fine = env.db.get(VehicleFine, fine_id)
    assert fine is not None
    assert fine.vehicle_id == env.vehicle.id
    assert fine.amount_fils == 34900


@pytest.mark.parametrize("path", ["/api/v1/vehicles", "/api/v1/books"])
def test_fleet_reporter_can_read_capability_routes(fleet_env: FleetEnv, path: str) -> None:
    response = fleet_env.client(fleet_env.reporter).get(path)
    assert response.status_code == 200, response.text
    if path == "/api/v1/vehicles":
        assert fleet_env.vehicle.id in {item["id"] for item in response.json()}
    else:
        assert response.json()["items"] == []


def test_fleet_reporter_can_edit_vehicle(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.reporter).patch(
        f"/api/v1/vehicles/{env.vehicle.id}", json={"notes_en": "Fleet inspection recorded"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["notes_en"] == "Fleet inspection recorded"
    env.db.refresh(env.vehicle)
    assert env.vehicle.notes_en == "Fleet inspection recorded"


def test_operator_routes_are_not_scoped(fleet_env: FleetEnv) -> None:
    response = fleet_env.client(fleet_env.operator).get("/api/v1/employees")
    assert response.status_code == 200, response.text


def test_inmate_reporter_allowlist_is_unchanged() -> None:
    assert INMATE_REPORTER_ALLOWED_ROUTES == ORIGINAL_INMATE_ROUTES


def test_inmate_reporter_preserves_route_error_code(fleet_env: FleetEnv) -> None:
    env = fleet_env
    inmate = User(
        email="inmate@fleet.test",
        password_hash="x",
        role="inmate_reporter",
        status="active",
        employee_id="G7401",
    )
    env.db.add(inmate)
    env.db.commit()
    response = env.client(inmate).get("/api/v1/employees")
    _assert_error(response, 403, "INMATE_REPORTER_ROUTE_FORBIDDEN")


@pytest.mark.parametrize(
    "routes",
    [SCOPED_SHARED_ROUTES, INMATE_REPORTER_ALLOWED_ROUTES],
    ids=["shared", "inmate"],
)
def test_scoped_route_allowlists_reference_registered_routes(
    routes: frozenset[tuple[str, str]],
) -> None:
    app = create_app()
    registered = {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }
    assert routes - registered == set()


def test_fleet_reporter_ceiling_rejects_service_grant(fleet_env: FleetEnv) -> None:
    env = fleet_env
    with pytest.raises(AppError) as raised:
        perm_service.set_user_override(
            env.db, env.reporter.id, "vehicles.delete", "grant", actor=env.admin
        )
    assert raised.value.code == "SCOPED_ROLE_SCOPE_FIXED"
    assert raised.value.http_status == 403
    assert env.db.get(UserPermission, (env.reporter.id, "vehicles.delete")) is None


def test_fleet_reporter_ceiling_rejects_api_grant(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.admin).put(
        f"/api/v1/auth/users/{env.reporter.id}/permissions",
        json={"capability": "vehicles.delete", "effect": "grant"},
    )
    _assert_error(response, 403, "SCOPED_ROLE_SCOPE_FIXED")
    assert env.db.get(UserPermission, (env.reporter.id, "vehicles.delete")) is None


def test_fleet_reporter_ceiling_masks_stale_role_permissions(fleet_env: FleetEnv) -> None:
    env = fleet_env
    # Populate the instance memo first, then force a fresh resolution after the
    # stale database default is added; otherwise this could pass on cached caps.
    assert "vehicles.edit" in perm_service.effective_caps(env.db, env.reporter)
    env.db.add(RolePermission(role="fleet_reporter", capability="employees.view"))
    env.db.commit()
    env.reporter._effective_caps_cache = None
    caps = perm_service.effective_caps(env.db, env.reporter)
    assert "employees.view" not in caps
    assert "vehicles.edit" in caps
    response = env.client(env.reporter).get("/api/v1/employees")
    _assert_error(response, 403, "SCOPED_ROLE_ROUTE_FORBIDDEN")


def test_deny_override_narrows_fleet_reporter_routes(fleet_env: FleetEnv) -> None:
    env = fleet_env
    client = env.client(env.reporter)
    path = f"/api/v1/vehicles/{env.vehicle.id}"
    response = client.patch(path, json={"notes_en": "Before deny"})
    assert response.status_code == 200, response.text

    response = env.client(env.admin).put(
        f"/api/v1/auth/users/{env.reporter.id}/permissions",
        json={"capability": "vehicles.edit", "effect": "deny"},
    )
    assert response.status_code == 200, response.text
    assert "vehicles.edit" not in response.json()["effective"]
    response = client.patch(path, json={"notes_en": "Must not be saved"})
    _assert_error(response, 403, "SCOPED_ROLE_ROUTE_FORBIDDEN")
    env.db.refresh(env.vehicle)
    assert env.vehicle.notes_en == "Before deny"
    assert client.get("/api/v1/vehicles").status_code == 200


@pytest.mark.parametrize(
    ("user_attribute", "expected"), [("reporter", "fleet_reporter"), ("operator", None)]
)
def test_session_exposes_scoped_role(
    fleet_env: FleetEnv, user_attribute: str, expected: str | None
) -> None:
    response = fleet_env.client(getattr(fleet_env, user_attribute)).get("/api/v1/auth/me")
    assert response.status_code == 200, response.text
    assert response.json()["scoped_role"] == expected


def test_admin_sets_and_clears_line_manager_with_audit(fleet_env: FleetEnv) -> None:
    env = fleet_env
    client = env.client(env.admin)
    path = f"/api/v1/auth/users/{env.reporter.id}/line-manager"
    response = client.patch(path, json={"line_manager_user_id": env.branch.id})
    assert response.status_code == 200, response.text
    assert response.json()["line_manager_user_id"] == env.branch.id
    env.db.refresh(env.reporter)
    assert env.reporter.line_manager_user_id == env.branch.id
    audits = env.db.scalars(
        select(AuditLog).where(
            AuditLog.action == "set_line_manager",
            AuditLog.entity_type == "user",
            AuditLog.entity_id == str(env.reporter.id),
        )
    ).all()
    assert len(audits) == 1

    response = client.patch(path, json={"line_manager_user_id": None})
    assert response.status_code == 200, response.text
    assert response.json()["line_manager_user_id"] is None
    env.db.refresh(env.reporter)
    assert env.reporter.line_manager_user_id is None
    audits = env.db.scalars(
        select(AuditLog).where(
            AuditLog.action == "set_line_manager",
            AuditLog.entity_type == "user",
            AuditLog.entity_id == str(env.reporter.id),
        )
    ).all()
    assert len(audits) == 2


def test_line_manager_not_applicable_to_operator(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.admin).patch(
        f"/api/v1/auth/users/{env.operator.id}/line-manager",
        json={"line_manager_user_id": env.line.id},
    )
    _assert_error(response, 422, "LINE_MANAGER_NOT_APPLICABLE")
    env.db.refresh(env.operator)
    assert env.operator.line_manager_user_id is None


@pytest.mark.parametrize(
    "candidate", ["operator", "disabled", "self", "admin_without_signer_row", "two_signer_rows"]
)
def test_line_manager_must_be_another_active_approver(fleet_env: FleetEnv, candidate: str) -> None:
    env = fleet_env
    if candidate == "disabled":
        manager = env.branch
        manager.status = "disabled"
        env.db.commit()
    elif candidate == "admin_without_signer_row":
        manager = env.admin  # holds books.approve but signs as no Manager row
    elif candidate == "two_signer_rows":
        manager = env.branch
        set_signer_rows(env, manager, 2)
    else:
        manager = env.reporter if candidate == "self" else env.operator
    response = env.client(env.admin).patch(
        f"/api/v1/auth/users/{env.reporter.id}/line-manager",
        json={"line_manager_user_id": manager.id},
    )
    _assert_error(response, 422, "LINE_MANAGER_NOT_ELIGIBLE")
    env.db.refresh(env.reporter)
    assert env.reporter.line_manager_user_id == env.line.id


def test_non_admin_cannot_change_line_manager(fleet_env: FleetEnv) -> None:
    env = fleet_env
    response = env.client(env.line).patch(
        f"/api/v1/auth/users/{env.reporter.id}/line-manager",
        json={"line_manager_user_id": env.branch.id},
    )
    _assert_error(response, 403, "FORBIDDEN")
    env.db.refresh(env.reporter)
    assert env.reporter.line_manager_user_id == env.line.id


def test_admin_can_create_fleet_reporter_account(fleet_env: FleetEnv) -> None:
    env = fleet_env
    employee = Employee(id="G7501", name_en="New Fleet Reporter", name_ar="مبلغ الأسطول")
    env.db.add(employee)
    env.db.commit()
    response = env.client(env.admin).post(
        "/api/v1/auth/users",
        json={
            "email": "new-reporter@fleet.test",
            "employee_id": employee.id,
            "role": "fleet_reporter",
        },
    )
    assert response.status_code == 201, response.text
    user_data = response.json()["user"]
    assert user_data["role"] == "fleet_reporter"
    assert user_data["employee_id"] == employee.id
    assert user_data["line_manager_user_id"] is None
    created = env.db.get(User, user_data["id"])
    assert created is not None
    assert created.role == "fleet_reporter"
    assert created.employee_id == employee.id


def test_line_manager_migration_roundtrip_and_foreign_key(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("0120_user_line_manager").down_revision == "0119_employee_former_ids"
    database = tmp_path / "line_manager.db"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    command.upgrade(config, "0119_employee_former_ids")
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    attach_sqlite_pragmas(engine, wal=False)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO users (id, email, password_hash, role, status) VALUES "
                "(1, 'manager@fleet.test', 'x', 'manager', 'active'), "
                "(2, 'reporter@fleet.test', 'x', 'fleet_reporter', 'active')"
            )
        command.upgrade(config, "0120_user_line_manager")
        engine.dispose()
        with engine.begin() as connection:
            column = next(
                column
                for column in inspect(connection).get_columns("users")
                if column["name"] == "line_manager_user_id"
            )
            assert column["nullable"] is True
            assert connection.exec_driver_sql(
                "SELECT id, email, line_manager_user_id FROM users ORDER BY id"
            ).all() == [(1, "manager@fleet.test", None), (2, "reporter@fleet.test", None)]
            connection.exec_driver_sql("PRAGMA foreign_keys = ON")
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
            connection.exec_driver_sql("UPDATE users SET line_manager_user_id = 1 WHERE id = 2")
            assert (
                connection.exec_driver_sql(
                    "SELECT line_manager_user_id FROM users WHERE id = 2"
                ).scalar_one()
                == 1
            )
            connection.exec_driver_sql("DELETE FROM users WHERE id = 1")
            assert (
                connection.exec_driver_sql(
                    "SELECT line_manager_user_id FROM users WHERE id = 2"
                ).scalar_one()
                is None
            )
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        command.downgrade(config, "0119_employee_former_ids")
        engine.dispose()
        with engine.connect() as connection:
            assert "line_manager_user_id" not in {
                column["name"] for column in inspect(connection).get_columns("users")
            }
            assert connection.exec_driver_sql("SELECT id, email FROM users").all() == [
                (2, "reporter@fleet.test")
            ]
        command.upgrade(config, "0120_user_line_manager")
        engine.dispose()
        with engine.connect() as connection:
            assert "line_manager_user_id" in {
                column["name"] for column in inspect(connection).get_columns("users")
            }
            assert connection.exec_driver_sql(
                "SELECT id, line_manager_user_id FROM users"
            ).all() == [(2, None)]
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    finally:
        engine.dispose()
