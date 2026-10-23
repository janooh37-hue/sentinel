from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, User
from app.db.session import get_db
from app.main import create_app

API = "/api/v1/departments"


@pytest.fixture()
def client(api_db: Session):
    user = User(email="admin@departments.test", password_hash="x", role="admin", status="active")
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as result:
        yield result


def department(client, name="Operations", parent_id=None):
    response = client.post(
        API, json={"name_en": name, "name_ar": f"قسم {name}", "parent_id": parent_id}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_department_tree_rejects_cycles_and_duplicate_sibling_names(client):
    root = department(client)
    child = department(client, "Child", root["id"])
    cycle = client.patch(f"{API}/{root['id']}", json={"parent_id": child["id"]})
    assert cycle.status_code == 422
    assert cycle.json()["error"]["code"] == "DEPARTMENT_CYCLE"
    duplicate = client.post(API, json={"name_en": root["name_en"], "name_ar": "مختلف"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "DEPARTMENT_NAME_TAKEN"
    assert client.delete(f"{API}/{root['id']}").json()["error"]["code"] == "DEPARTMENT_IN_USE"
    assert department(client, root["name_en"], child["id"])["parent_id"] == child["id"]


def test_memberships_require_one_primary_and_keep_head_roles(client, api_db):
    first, second = department(client), department(client, "Other")
    user = User(email="member@test.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    url = f"{API}/memberships/{user.id}"
    memberships = [
        {"department_id": first["id"], "role": "head", "is_primary": True},
        {"department_id": second["id"], "role": "deputy", "is_primary": False},
    ]
    response = client.put(url, json={"memberships": memberships})
    assert response.status_code == 200, response.text
    assert [row["role"] for row in response.json()] == ["head", "deputy"]
    for primary in (True, False):
        for row in memberships:
            row["is_primary"] = primary
        invalid = client.put(url, json={"memberships": memberships})
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "DEPARTMENT_PRIMARY_REQUIRED"
    assert client.get(f"{API}/{first['id']}/members").json()[0]["role"] == "head"
    assert client.delete(f"{API}/{first['id']}").status_code == 409
    assert client.put(url, json={"memberships": []}).json() == []


def test_plain_users_can_list_departments_but_not_manage(client, api_db):
    department(client)
    admin = api_db.query(User).filter_by(role="admin").one()
    admin.role = "operator"
    api_db.commit()
    assert client.get(API).status_code == 200
    assert client.post(API, json={"name_en": "Denied", "name_ar": "مرفوض"}).status_code == 403


def test_employee_assignment_grouping_and_service_validation(client, api_db):
    target = department(client)
    api_db.add_all(
        [
            Employee(id="G1", name_en="One", duty_unit="Unit", department="Legacy"),
            Employee(id="G2", name_en="Two", duty_unit="Unit", department="Legacy"),
            Employee(id="G3", name_en="Departed", status="Resigned"),
        ]
    )
    api_db.commit()
    assert client.get(f"{API}/unassigned-employees").json() == [
        {
            "duty_unit": "Unit",
            "legacy_department": "Legacy",
            "employee_ids": ["G1", "G2"],
            "count": 2,
        }
    ]
    response = client.post(
        f"{API}/assign-employees",
        json={"employee_ids": ["G1", "G2"], "department_id": target["id"]},
    )
    assert response.json() == {"updated": 2}
    assert client.get(f"{API}/unassigned-employees").json() == []
    assert client.delete(f"{API}/{target['id']}").status_code == 409
    invalid = client.put(f"{API}/{target['id']}/services", json={"service_ids": ["invented"]})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "DEPARTMENT_SERVICE_UNKNOWN"
    options = client.get(f"{API}/service-options").json()
    assert any(row["id"] == "Employment Application Form" for row in options)
    response = client.put(
        f"{API}/{target['id']}/services",
        json={"service_ids": ["General Book", "Employment Application Form"]},
    )
    assert response.status_code == 200
    assert set(response.json()["service_ids"]) == {"General Book", "Employment Application Form"}


@pytest.mark.parametrize("explicit", [False, True])
def test_create_and_approve_default_memberships(client, api_db, explicit):
    source, chosen = department(client), department(client, "Chosen")
    employee = Employee(id="GDEFAULT", name_en="Default", department_id=source["id"])
    api_db.add(employee)
    api_db.commit()
    body = {"email": "created@test.ae", "employee_id": employee.id, "role": "operator"}
    if explicit:
        body["department_id"] = chosen["id"]
    created = client.post("/api/v1/auth/users", json=body)
    assert created.status_code == 201, created.text
    expected = chosen["id"] if explicit else source["id"]
    assert created.json()["user"]["departments"][0]["department_id"] == expected
    pending = User(email="pending@test.ae", password_hash="x", role="operator", status="pending")
    api_db.add(pending)
    api_db.commit()
    body.pop("email")
    approved = client.post(f"/api/v1/auth/users/{pending.id}/approve", json=body)
    assert approved.status_code == 200, approved.text
    assert approved.json()["departments"][0]["department_id"] == expected


def test_admin_link_defaults_membership_only_when_empty(client, api_db):
    source, existing = department(client), department(client, "Existing")
    employee = Employee(id="GLINK", name_en="Linked", department_id=source["id"])
    user = User(email="linked@test.ae", password_hash="x", role="operator", status="active")
    api_db.add_all([employee, user])
    api_db.commit()
    linked = client.patch(f"/api/v1/auth/users/{user.id}/link", json={"employee_id": employee.id})
    assert linked.status_code == 200, linked.text
    assert linked.json()["departments"][0]["department_id"] == source["id"]
    client.put(
        f"{API}/memberships/{user.id}",
        json={
            "memberships": [{"department_id": existing["id"], "role": "deputy", "is_primary": True}]
        },
    )
    linked = client.patch(f"/api/v1/auth/users/{user.id}/link", json={"employee_id": employee.id})
    assert linked.json()["departments"][0]["department_id"] == existing["id"]


def test_employee_department_validation_and_plain_filter(client):
    first, second = department(client), department(client, "Second")
    invalid = client.post(
        "/api/v1/employees", json={"id": "GINVALID", "name_en": "Invalid", "department_id": 99999}
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "DEPARTMENT_NOT_FOUND"
    for index, target in enumerate((first, second)):
        created = client.post(
            "/api/v1/employees",
            json={
                "id": f"GFILTER{index}",
                "name_en": f"Employee {index}",
                "department_id": target["id"],
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["department_name_en"] == target["name_en"]
    assert client.get("/api/v1/employees").json()["total"] == 2
    filtered = client.get("/api/v1/employees", params={"department_id": first["id"]}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["department_id"] == first["id"]
    client.patch(f"{API}/{first['id']}", json={"active": False})
    invalid = client.patch("/api/v1/employees/GFILTER1", json={"department_id": first["id"]})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "DEPARTMENT_NOT_FOUND"


def test_department_migration_is_reversible_on_populated_database(tmp_path, monkeypatch):
    from pathlib import Path

    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, inspect, text

    root = Path(__file__).resolve().parents[2]
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "backend/app/db/migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{(tmp_path / 'migration.db').as_posix()}")
    command.upgrade(config, "0109_book_folder_shares")
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO employees (id,name_en,department,created_at,updated_at) VALUES ('GKEEP','Keep','Legacy',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)"
            )
        )
    command.upgrade(config, "0110_departments")
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO departments (name_en,name_ar) VALUES ('Operations','العمليات')")
        )
        connection.execute(text("UPDATE employees SET department_id=1 WHERE id='GKEEP'"))
        assert {"departments", "department_members", "department_services"} <= set(
            inspect(connection).get_table_names()
        )
    command.downgrade(config, "0109_book_folder_shares")
    with engine.connect() as connection:
        assert "departments" not in inspect(connection).get_table_names()
        assert "department_id" not in {
            column["name"] for column in inspect(connection).get_columns("employees")
        }
        assert (
            connection.execute(
                text("SELECT department FROM employees WHERE id='GKEEP'")
            ).scalar_one()
            == "Legacy"
        )
    command.upgrade(config, "0110_departments")
    engine.dispose()


def test_invalid_membership_and_account_assignment_are_atomic(client, api_db):
    target = department(client)
    user = User(email="atomic@test.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    url = f"{API}/memberships/{user.id}"
    membership = {"department_id": target["id"], "role": "member", "is_primary": True}
    assert client.put(url, json={"memberships": [membership]}).status_code == 200
    duplicate = client.put(
        url, json={"memberships": [membership, {**membership, "is_primary": False}]}
    )
    assert duplicate.status_code == 422
    unknown = client.put(url, json={"memberships": [{**membership, "department_id": 99999}]})
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "DEPARTMENT_NOT_FOUND"
    invalid = client.post(
        "/api/v1/auth/users",
        json={"email": "bad-department@test.ae", "role": "operator", "department_id": 99999},
    )
    assert invalid.status_code == 422
    assert not api_db.query(User).filter_by(email="bad-department@test.ae").count()
    assert len(client.get(f"{API}/{target['id']}/members").json()) == 1


def test_department_can_be_deleted_after_clearing_assignment(client):
    target = department(client)
    assert (
        client.put(
            f"{API}/{target['id']}/services", json={"service_ids": ["General Book"]}
        ).status_code
        == 200
    )
    assert client.delete(f"{API}/{target['id']}").status_code == 204
    assert client.get(API).json() == []


@pytest.mark.parametrize("same_department", [False, True])
def test_approval_reconciles_existing_memberships(client, api_db, same_department):
    existing = department(client)
    chosen = existing if same_department else department(client, "Chosen")
    user = User(email="preassigned@test.ae", password_hash="x", role="operator", status="pending")
    api_db.add(user)
    api_db.commit()
    assert (
        client.put(
            f"{API}/memberships/{user.id}",
            json={
                "memberships": [
                    {"department_id": existing["id"], "role": "head", "is_primary": True}
                ]
            },
        ).status_code
        == 200
    )
    approved = client.post(
        f"/api/v1/auth/users/{user.id}/approve",
        json={"role": "operator", "employee_id": None, "department_id": chosen["id"]},
    )
    assert approved.status_code == 200, approved.text
    memberships = approved.json()["departments"]
    assert len(memberships) == (1 if same_department else 2)
    primary = [member for member in memberships if member["is_primary"]]
    assert len(primary) == 1
    assert primary[0]["department_id"] == chosen["id"]
    assert primary[0]["role"] == "member"


def test_scoping_switch_preflight_audit_and_cache_invalidation(client, api_db):
    from sqlalchemy import select

    from app.db.models import AuditLog, Department, DepartmentMember, DepartmentService
    from app.services.department_scope_service import resolve_department_scope

    empty, staffed = department(client), department(client, "Staffed")
    user = User(
        email="unassigned@test.ae",
        display_name="Unassigned",
        password_hash="x",
        role="manager",
        status="active",
    )
    head = User(email="head@test.ae", password_hash="x", role="manager", status="active")
    inactive = User(email="inactive@test.ae", password_hash="x", role="operator", status="disabled")
    api_db.add_all([user, head, inactive])
    api_db.flush()
    api_db.add(
        DepartmentMember(
            user_id=head.id, department_id=staffed["id"], role="deputy", is_primary=True
        )
    )
    api_db.add(DepartmentService(department_id=staffed["id"], service_id="General Book"))
    api_db.add(Department(name_en="Inactive", name_ar="غير نشط", active=False))
    api_db.commit()
    assert resolve_department_scope(api_db, user).organization
    preflight = client.get(f"{API}/scoping")
    assert preflight.status_code == 200, preflight.text
    assert preflight.json() == {
        "enabled": False,
        "users_without_department": [
            {"user_id": user.id, "display_name": "Unassigned", "email": user.email}
        ],
        "departments_without_head": [
            {"id": empty["id"], "name_en": empty["name_en"], "name_ar": empty["name_ar"]}
        ],
        "departments_without_services": [
            {"id": empty["id"], "name_en": empty["name_en"], "name_ar": empty["name_ar"]}
        ],
    }
    assert client.put(f"{API}/scoping", json={"enabled": True}).json()["enabled"] is True
    assert resolve_department_scope(api_db, user).kind == "self"
    assert client.put(f"{API}/scoping", json={"enabled": False}).json()["enabled"] is False
    assert resolve_department_scope(api_db, user).organization
    audits = list(
        api_db.scalars(
            select(AuditLog)
            .where(AuditLog.action.like("department_scoping.%"))
            .order_by(AuditLog.id)
        )
    )
    assert [row.action for row in audits] == [
        "department_scoping.enabled",
        "department_scoping.disabled",
    ]
    import json

    assert [json.loads(row.payload)["after"] for row in audits] == [True, False]


def test_scoping_switch_requires_department_management(client, api_db):
    admin = api_db.query(User).filter_by(role="admin").one()
    admin.role = "operator"
    api_db.commit()
    assert client.get(f"{API}/scoping").status_code == 403
    assert client.put(f"{API}/scoping", json={"enabled": True}).status_code == 403
