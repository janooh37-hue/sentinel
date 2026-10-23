from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    AuditLog,
    Book,
    BookCategory,
    BookDepartmentSend,
    BookFolder,
    BookFolderShare,
    Department,
    DepartmentException,
    DepartmentMember,
    DepartmentService,
    Employee,
    User,
)
from app.db.session import get_db
from app.main import create_app
from app.schemas.auth import AdminUserCreateRequest, ApproveRequest
from app.schemas.department import DepartmentCreate, DepartmentUpdate
from app.schemas.employee import EmployeeCreate, EmployeeUpdate
from app.services.department_scope_service import resolve_department_scope
from tests.department_fixtures import department, employee, grant

API = "/api/v1/departments"


def test_org_tree_inputs_and_removed_department_routes(client):
    for schema in (EmployeeCreate, EmployeeUpdate, AdminUserCreateRequest, ApproveRequest):
        assert "department_id" not in schema.model_fields
    assert "head_employee_id" in DepartmentCreate.model_fields
    assert DepartmentCreate.model_fields["head_employee_id"].is_required()
    assert "parent_id" not in DepartmentCreate.model_fields
    assert "parent_id" not in DepartmentUpdate.model_fields
    paths = {route.path for route in client.app.routes}
    assert f"{API}/{{department_id}}/people" in paths
    assert f"{API}/memberships/{{user_id}}" not in paths
    assert f"{API}/{{department_id}}/members" not in paths
    assert f"{API}/assign-employees" not in paths


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


def account(db, name, employee_id=None, **fields):
    user = User(
        email=f"{name}@departments.test",
        password_hash="x",
        role="operator",
        status=fields.pop("status", "active"),
        employee_id=employee_id,
        **fields,
    )
    db.add(user)
    db.commit()
    return user


def create_department(client, head, name="Operations"):
    response = client.post(
        API, json={"name_en": name, "name_ar": f"قسم {name}", "head_employee_id": head}
    )
    assert response.status_code == 201, response.text
    return response.json()


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


def test_create_department_derives_tree_and_reads_head_and_counts(client, api_db):
    employee(api_db, "ROOT", name_en="Root", name_ar="الرئيس")
    employee(api_db, "CHILD", "ROOT")
    employee(api_db, "STAFF", "CHILD")
    head = account(api_db, "head", "ROOT")
    root = create_department(client, "ROOT")
    child = create_department(client, "CHILD", "Nested")
    rows = {row["id"]: row for row in client.get(API).json()}
    assert rows[root["id"]] == {
        **root,
        "employee_count": 1,
    }
    assert root["head_employee_id"] == "ROOT"
    assert root["head_name_en"] == "Root"
    assert root["head_name_ar"] == "الرئيس"
    assert root["head_user_id"] == head.id
    assert root["parent_id"] is None
    assert root["deputies"] == root["viewers"] == root["service_ids"] == []
    assert root["exception_count"] == 0
    assert child["parent_id"] == root["id"]
    assert child["employee_count"] == 2
    assert child["head_user_id"] is None
    assert api_db.get(Employee, "STAFF").department_id == child["id"]


@pytest.mark.parametrize("field", ["name_en", "name_ar"])
@pytest.mark.parametrize("operation", ["create", "patch"])
def test_department_names_are_globally_unique(client, api_db, field, operation):
    employee(api_db, "ROOT")
    employee(api_db, "CHILD", "ROOT")
    first = create_department(client, "ROOT")
    body = {"name_en": "Other", "name_ar": "آخر", "head_employee_id": "CHILD"}
    if operation == "create":
        body[field] = first[field]
        response = client.post(API, json=body)
    else:
        second = create_department(client, "CHILD", "Other")
        response = client.patch(f"{API}/{second['id']}", json={field: first[field]})
    assert_error(response, 409, "DEPARTMENT_NAME_TAKEN")


@pytest.mark.parametrize("operation", ["create", "patch"])
@pytest.mark.parametrize("invalid", ["taken", "missing", "exception"])
def test_department_head_validation(client, api_db, operation, invalid):
    for employee_id in ("ROOT", "OTHER", "EXCEPTION"):
        employee(api_db, employee_id)
    root = create_department(client, "ROOT")
    assert (
        client.put(f"{API}/exceptions/EXCEPTION", json={"department_id": None}).status_code == 200
    )
    head, status, code = {
        "taken": ("ROOT", 409, "DEPARTMENT_HEAD_TAKEN"),
        "missing": ("MISSING", 404, "EMPLOYEE_NOT_FOUND"),
        "exception": ("EXCEPTION", 422, "DEPARTMENT_HEAD_EXCEPTION"),
    }[invalid]
    if operation == "create":
        response = client.post(
            API, json={"name_en": "Other", "name_ar": "آخر", "head_employee_id": head}
        )
    else:
        other = create_department(client, "OTHER", "Other")
        response = client.patch(f"{API}/{other['id']}", json={"head_employee_id": head})
    assert_error(response, status, code)
    rows = client.get(API).json()
    assert len(rows) == (1 if operation == "create" else 2)
    assert next(row for row in rows if row["id"] == root["id"])["head_employee_id"] == "ROOT"
    if operation == "patch":
        assert next(row for row in rows if row["id"] == other["id"])["head_employee_id"] == "OTHER"


def test_patch_head_and_active_recompute_membership_and_parent(client, api_db):
    employee(api_db, "ROOT")
    employee(api_db, "OLD", "ROOT")
    employee(api_db, "OLDREPORT", "OLD")
    employee(api_db, "NEW")
    employee(api_db, "NEWREPORT", "NEW")
    root = create_department(client, "ROOT")
    nested = create_department(client, "OLD", "Nested")
    changed = client.patch(f"{API}/{nested['id']}", json={"head_employee_id": "NEW"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["parent_id"] is None
    for employee_id in ("OLD", "OLDREPORT"):
        assert api_db.get(Employee, employee_id).department_id == root["id"]
    for employee_id in ("NEW", "NEWREPORT"):
        assert api_db.get(Employee, employee_id).department_id == nested["id"]
    restored = client.patch(f"{API}/{nested['id']}", json={"head_employee_id": "OLD"})
    assert restored.json()["parent_id"] == root["id"]
    inactive = client.patch(f"{API}/{nested['id']}", json={"active": False})
    assert inactive.status_code == 200, inactive.text
    assert inactive.json()["employee_count"] == 0
    assert api_db.get(Employee, "OLDREPORT").department_id == root["id"]
    active = client.patch(f"{API}/{nested['id']}", json={"active": True})
    assert active.json()["employee_count"] == 2
    assert api_db.get(Employee, "OLDREPORT").department_id == nested["id"]


def test_department_arabic_rename_updates_derived_labels_only(client, api_db):
    employee(api_db, "HEAD")
    employee(api_db, "REPORT", "HEAD")
    target = create_department(client, "HEAD")
    employee(api_db, "HINT", department=target["name_ar"])
    api_db.commit()
    renamed = client.patch(f"{API}/{target['id']}", json={"name_ar": "قسم العمليات"})
    assert renamed.status_code == 200, renamed.text
    assert api_db.get(Employee, "REPORT").department == "قسم العمليات"
    assert api_db.get(Employee, "HINT").department == target["name_ar"]


def test_employee_writes_preserve_tree_derived_department_and_label(client, api_db):
    employee(api_db, "HEAD")
    target = create_department(client, "HEAD")
    created = client.post(
        "/api/v1/employees",
        json={"id": "STAFF", "name_en": "Staff", "department": "Free text"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["department_id"] is None
    assigned = client.patch("/api/v1/org-tree/STAFF/supervisor", json={"supervisor_id": "HEAD"})
    assert assigned.status_code == 200, assigned.text
    response = client.get("/api/v1/employees/STAFF")
    assert response.json()["department_id"] == target["id"]
    assert response.json()["department"] == target["name_ar"]
    text_only = client.patch("/api/v1/employees/STAFF", json={"department": "Still conflicting"})
    assert text_only.status_code == 200, text_only.text
    assert text_only.json()["department"] == target["name_ar"]
    cleared = client.patch("/api/v1/org-tree/STAFF/supervisor", json={"supervisor_id": None})
    assert cleared.status_code == 200, cleared.text
    unassigned = client.get("/api/v1/employees/STAFF").json()
    assert unassigned["department_id"] is None
    assert unassigned["department"] is None


def test_employee_list_department_filter_uses_derived_membership(client, api_db):
    employee(api_db, "FIRST")
    employee(api_db, "SECOND")
    employee(api_db, "REPORT", "FIRST")
    first = create_department(client, "FIRST")
    create_department(client, "SECOND", "Second")
    assert client.get("/api/v1/employees").json()["total"] == 3
    filtered = client.get("/api/v1/employees", params={"department_id": first["id"]})
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["total"] == 2
    assert {row["id"] for row in filtered.json()["items"]} == {"FIRST", "REPORT"}
    assert all(row["department_name_en"] == first["name_en"] for row in filtered.json()["items"])


def test_people_replaces_grants_and_rejects_overlap_and_unknown_users_atomically(client, api_db):
    employee(api_db, "HEAD")
    target = create_department(client, "HEAD")
    deputy, viewer = account(api_db, "deputy"), account(api_db, "viewer")
    url = f"{API}/{target['id']}/people"
    response = client.put(
        url, json={"deputy_user_ids": [deputy.id, deputy.id], "viewer_user_ids": [viewer.id]}
    )
    assert response.status_code == 200, response.text
    assert response.json()["deputies"] == [
        {"user_id": deputy.id, "display_name": deputy.email, "role": "deputy"}
    ]
    assert response.json()["viewers"] == [
        {"user_id": viewer.id, "display_name": viewer.email, "role": "viewer"}
    ]
    assert (
        client.put(
            url, json={"deputy_user_ids": [viewer.id], "viewer_user_ids": [viewer.id]}
        ).status_code
        == 422
    )
    assert_error(client.put(url, json={"deputy_user_ids": [99999]}), 404, "USER_NOT_FOUND")
    assert {(row.user_id, row.role) for row in api_db.scalars(select(DepartmentMember))} == {
        (deputy.id, "deputy"),
        (viewer.id, "viewer"),
    }
    cleared = client.put(url, json={"deputy_user_ids": [], "viewer_user_ids": []})
    assert cleared.json()["deputies"] == cleared.json()["viewers"] == []
    assert api_db.get(Employee, "HEAD").department_id == target["id"]


def test_service_catalog_validation_and_replacement(client, api_db):
    employee(api_db, "HEAD")
    target = create_department(client, "HEAD")
    url = f"{API}/{target['id']}/services"
    assert_error(
        client.put(url, json={"service_ids": ["invented"]}), 422, "DEPARTMENT_SERVICE_UNKNOWN"
    )
    assert any(
        row["id"] == "Employment Application Form"
        for row in client.get(f"{API}/service-options").json()
    )
    configured = client.put(
        url, json={"service_ids": ["General Book", "Employment Application Form", "General Book"]}
    )
    assert configured.status_code == 200, configured.text
    assert set(configured.json()["service_ids"]) == {"General Book", "Employment Application Form"}
    assert client.put(url, json={"service_ids": []}).json()["service_ids"] == []


def test_exceptions_crud_recomputes_branch_and_reports_tree_department(client, api_db):
    employee(api_db, "ROOT")
    employee(api_db, "BRANCH", "ROOT")
    employee(api_db, "REPORT", "BRANCH")
    employee(api_db, "OTHER")
    source = create_department(client, "ROOT")
    target = create_department(client, "OTHER", "Other")
    url = f"{API}/exceptions/BRANCH"
    assert client.get(f"{API}/exceptions").json() == []
    moved = client.put(url, json={"department_id": target["id"]})
    assert moved.status_code == 200, moved.text
    assert moved.json()["tree_department_id"] == source["id"]
    assert moved.json()["department_id"] == target["id"]
    assert moved.json()["created_by"] == "admin@departments.test"
    assert moved.json()["created_at"]
    assert client.get(f"{API}/exceptions").json() == [moved.json()]
    assert (
        next(row for row in client.get(API).json() if row["id"] == target["id"])["exception_count"]
        == 1
    )
    assert api_db.get(Employee, "REPORT").department_id == target["id"]
    outside = client.put(url, json={"department_id": None})
    assert outside.status_code == 200, outside.text
    for employee_id in ("BRANCH", "REPORT"):
        assert api_db.get(Employee, employee_id).department_id is None
    assert client.delete(url).status_code == 204
    assert client.get(f"{API}/exceptions").json() == []
    assert api_db.get(Employee, "REPORT").department_id == source["id"]
    assert_error(client.delete(url), 404, "DEPARTMENT_EXCEPTION_NOT_FOUND")


def test_exception_validation(client, api_db):
    employee(api_db, "HEAD")
    employee(api_db, "STAFF", "HEAD")
    target = create_department(client, "HEAD")
    assert_error(
        client.put(f"{API}/exceptions/MISSING", json={"department_id": None}),
        404,
        "EMPLOYEE_NOT_FOUND",
    )
    assert_error(
        client.put(f"{API}/exceptions/HEAD", json={"department_id": None}),
        422,
        "DEPARTMENT_HEAD_EXCEPTION",
    )
    assert_error(
        client.put(f"{API}/exceptions/STAFF", json={"department_id": 99999}),
        422,
        "DEPARTMENT_NOT_FOUND",
    )
    client.patch(f"{API}/{target['id']}", json={"active": False})
    assert_error(
        client.put(f"{API}/exceptions/STAFF", json={"department_id": target["id"]}),
        422,
        "DEPARTMENT_NOT_FOUND",
    )
    assert client.get(f"{API}/exceptions").json() == []


def test_unassigned_groups_follow_tree_roots_not_legacy_labels(client, api_db):
    employee(api_db, "ROOT", name_en="Root", name_ar="رئيس", duty_unit="Unit")
    employee(api_db, "CHILD", "ROOT", duty_unit="Different", department="Legacy")
    employee(api_db, "GONE", "ROOT", status="Resigned")
    employee(api_db, "OTHER", name_en="Other", duty_unit="Unit", department="Legacy")
    employee(api_db, "HEAD", "ROOT")
    create_department(client, "HEAD")
    assert client.get(f"{API}/unassigned-employees").json() == [
        {
            "top_employee_id": "ROOT",
            "top_name_en": "Root",
            "top_name_ar": "رئيس",
            "duty_unit": "Unit",
            "employee_ids": ["CHILD", "ROOT"],
            "count": 2,
        },
        {
            "top_employee_id": "OTHER",
            "top_name_en": "Other",
            "top_name_ar": None,
            "duty_unit": "Unit",
            "employee_ids": ["OTHER"],
            "count": 1,
        },
    ]


def test_delete_cascades_configuration_and_recomputes_descendants(client, api_db):
    employee(api_db, "ROOT")
    employee(api_db, "REPORT", "ROOT")
    employee(api_db, "NESTED", "ROOT")
    employee(api_db, "OUTSIDE")
    root = create_department(client, "ROOT")
    nested = create_department(client, "NESTED", "Nested")
    user = account(api_db, "deputy")
    grant(api_db, root["id"], user, "deputy")
    client.put(f"{API}/{root['id']}/services", json={"service_ids": ["General Book"]})
    client.put(f"{API}/exceptions/OUTSIDE", json={"department_id": root["id"]})
    assert client.delete(f"{API}/{root['id']}").status_code == 204
    assert api_db.get(Department, root["id"]) is None
    for model in (DepartmentMember, DepartmentService, DepartmentException):
        assert list(api_db.scalars(select(model))) == []
    for employee_id in ("ROOT", "REPORT", "OUTSIDE"):
        assert api_db.get(Employee, employee_id).department_id is None
    assert client.get(API).json()[0]["parent_id"] is None
    assert api_db.get(Employee, "NESTED").department_id == nested["id"]


@pytest.mark.parametrize("reference", ["record", "send", "folder_share"])
def test_delete_rejects_persisted_record_send_and_share_references(client, api_db, reference):
    employee(api_db, "HEAD")
    target = create_department(client, "HEAD")
    admin = api_db.scalar(select(User).where(User.role == "admin"))
    if reference == "folder_share":
        folder = BookFolder(name="Restricted", created_by_user_id=admin.id)
        api_db.add(folder)
        api_db.flush()
        row = BookFolderShare(folder_id=folder.id, department_id=target["id"])
    else:
        api_db.add(BookCategory(id="HR", prefix="HR"))
        book = Book(
            category_id="HR",
            ref_number="HR-1",
            department_id=target["id"] if reference == "record" else None,
        )
        api_db.add(book)
        api_db.flush()
        row = (
            book
            if reference == "record"
            else BookDepartmentSend(
                book_id=book.id,
                department_id=target["id"],
                sent_by_user_id=admin.id,
                purpose="info",
            )
        )
    api_db.add(row)
    api_db.commit()
    assert_error(client.delete(f"{API}/{target['id']}"), 409, "DEPARTMENT_IN_USE")
    assert api_db.get(Department, target["id"]) is not None
    api_db.delete(row)
    api_db.commit()
    assert client.delete(f"{API}/{target['id']}").status_code == 204


@pytest.mark.parametrize("operation", ["create", "approve"])
def test_account_inputs_omit_department_and_derive_membership(client, api_db, operation):
    employee(api_db, "HEAD")
    employee(api_db, "STAFF", "HEAD")
    source = create_department(client, "HEAD")
    schema = AdminUserCreateRequest if operation == "create" else ApproveRequest
    assert "department_id" not in schema.model_fields
    body = {"employee_id": "STAFF", "role": "operator"}
    if operation == "create":
        response = client.post("/api/v1/auth/users", json={**body, "email": "created@test.ae"})
        assert response.status_code == 201, response.text
        user = response.json()["user"]
    else:
        pending = account(api_db, "pending", status="pending")
        response = client.post(f"/api/v1/auth/users/{pending.id}/approve", json=body)
        assert response.status_code == 200, response.text
        user = response.json()
    assert user["departments"] == [
        {
            "department_id": source["id"],
            "name_en": source["name_en"],
            "name_ar": source["name_ar"],
            "role": "member",
        }
    ]
    assert list(api_db.scalars(select(DepartmentMember))) == []


def test_account_link_and_reads_combine_derived_roles_without_primary_memberships(client, api_db):
    for employee_id in ("HEAD", "DEPUTYHEAD", "VIEWHEAD", "MEMBERHEAD"):
        employee(api_db, employee_id)
    employee(api_db, "MEMBER", "MEMBERHEAD")
    heads = [
        create_department(client, employee_id, employee_id)
        for employee_id in ("HEAD", "DEPUTYHEAD", "VIEWHEAD", "MEMBERHEAD")
    ]
    user = account(api_db, "roles", "HEAD")
    grant(api_db, heads[0]["id"], user, "viewer")
    grant(api_db, heads[1]["id"], user, "deputy")
    grant(api_db, heads[2]["id"], user, "viewer")
    rows = {row["id"]: row for row in client.get("/api/v1/auth/users").json()}
    assert [(row["department_id"], row["role"]) for row in rows[user.id]["departments"]] == [
        (heads[0]["id"], "head"),
        (heads[1]["id"], "deputy"),
        (heads[2]["id"], "viewer"),
    ]
    linked = client.patch(f"/api/v1/auth/users/{user.id}/link", json={"employee_id": "MEMBER"})
    assert linked.status_code == 200, linked.text
    assert {(row["department_id"], row["role"]) for row in linked.json()["departments"]} == {
        (heads[0]["id"], "viewer"),
        (heads[1]["id"], "deputy"),
        (heads[2]["id"], "viewer"),
        (heads[3]["id"], "member"),
    }
    assert all("is_primary" not in row for row in linked.json()["departments"])


def test_plain_users_can_list_but_not_manage_departments_or_scoping(client, api_db):
    employee(api_db, "HEAD")
    create_department(client, "HEAD")
    admin = api_db.scalar(select(User).where(User.role == "admin"))
    admin.role = "operator"
    api_db.commit()
    assert client.get(API).status_code == 200
    assert (
        client.post(
            API, json={"name_en": "Denied", "name_ar": "مرفوض", "head_employee_id": "HEAD"}
        ).status_code
        == 403
    )
    assert client.get(f"{API}/scoping").status_code == 403
    assert client.put(f"{API}/scoping", json={"enabled": True}).status_code == 403


def test_scoping_preflight_receivers_audit_and_cache_invalidation(client, api_db):
    for employee_id in ("EMPTY", "HEAD", "DEPUTY", "INACTIVE"):
        employee(api_db, employee_id)
    empty = create_department(client, "EMPTY", "Empty")
    staffed = create_department(client, "HEAD", "Staffed")
    deputy = create_department(client, "DEPUTY", "Deputy staffed")
    department(api_db, "Inactive", "INACTIVE", active=False)
    user = account(api_db, "unassigned", display_name="Unassigned")
    account(api_db, "head", "HEAD")
    receiver = account(api_db, "deputy")
    viewer = account(api_db, "viewer")
    grant(api_db, deputy["id"], receiver, "deputy")
    grant(api_db, empty["id"], viewer, "viewer")
    account(api_db, "disabled", "EMPTY", status="disabled")
    for target in (staffed, deputy):
        client.put(f"{API}/{target['id']}/services", json={"service_ids": ["General Book"]})
    assert resolve_department_scope(api_db, user).organization
    preflight = client.get(f"{API}/scoping")
    assert preflight.status_code == 200, preflight.text
    descriptor = {key: empty[key] for key in ("id", "name_en", "name_ar")}
    assert preflight.json() == {
        "enabled": False,
        "records_backfilled": 0,
        "users_without_department": [
            {"user_id": user.id, "display_name": "Unassigned", "email": user.email}
        ],
        "departments_without_receiver": [descriptor],
        "departments_without_services": [descriptor],
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
    assert [json.loads(row.payload)["after"] for row in audits] == [True, False]


def test_candidate_users_are_active_non_inmate_and_gated_by_manage(client, api_db):
    from app.db.models import UserPermission

    employee(api_db, "NAMED", name_en="Bader")
    account(api_db, "zed", display_name="Zed")
    account(api_db, "linked", "NAMED")
    account(api_db, "aaa-email-only")
    account(api_db, "off", status="disabled", display_name="Off")
    account(api_db, "inmate", display_name="Inmate").role = "inmate_reporter"
    manager = api_db.scalar(select(User).where(User.role == "admin"))
    manager.role = "operator"
    manager.display_name = "Manager"
    api_db.add(UserPermission(user_id=manager.id, capability="departments.manage", effect="grant"))
    api_db.commit()
    response = client.get(f"{API}/candidate-users")
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [row["email"] for row in rows] == [
        "aaa-email-only@departments.test",
        "linked@departments.test",
        "admin@departments.test",
        "zed@departments.test",
    ]
    linked = rows[1]
    assert linked["display_name"] == "Bader" and linked["employee_id"] == "NAMED"
    api_db.query(UserPermission).delete()
    api_db.commit()
    manager._effective_caps_cache = None
    assert client.get(f"{API}/candidate-users").status_code == 403
