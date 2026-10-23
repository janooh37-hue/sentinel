from __future__ import annotations

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import (
    Book,
    BookCategory,
    Document,
    Employee,
    EmployeeStatusEvent,
    Leave,
    LedgerEntry,
    User,
    UserPermission,
    VaultFile,
    Violation,
)
from app.db.session import get_db
from app.db.workforce_models import DutyAssignmentEvent
from app.main import create_app
from tests.department_fixtures import (
    department,
    employee,
    enable_scoping,
    exception,
    grant,
    link,
    recompute,
)

API = "/api/v1/employees"


@pytest.fixture()
def scoped(api_db: Session):
    employee(api_db, "G1", name_en="Muhammad Al Farsi")
    employee(api_db, "G2", supervisor="G1", name_en="Muhammad Al Farsi")
    employee(api_db, "G3", name_en="Muhammad Al Farsi")
    employee(api_db, "GOWN", supervisor="G3", name_en="Own employee")
    employee(api_db, "GNULL", name_en="Unassigned employee")
    root = department(api_db, "Operations", "G1", name_ar="العمليات")
    child = department(api_db, "Child", "G2", name_ar="فرع")
    outside = department(api_db, "Other", "G3", name_ar="آخر")
    assert (root.id, child.id, outside.id) == (1, 2, 3)
    assert child.parent_id == root.id
    user = User(
        email="scope-employees@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id="GOWN",
    )
    api_db.add(user)
    api_db.flush()
    link(api_db, user, "GOWN")
    grant(api_db, root.id, user, "deputy")
    enable_scoping(api_db)
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield client, api_db, user
    app.dependency_overrides.clear()


@pytest.mark.parametrize("endpoint", ["", "/lookup"])
@pytest.mark.parametrize(
    "q,expected", [(None, {"G1", "G2", "GOWN"}), ("Muhamad Al Farsi", {"G1", "G2"})]
)
def test_employee_lists_scope_rows_totals_and_fuzzy_fallback(scoped, endpoint, q, expected):
    client, _, _ = scoped
    response = client.get(API + endpoint, params={"q": q} if q else {})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == len(expected)
    assert {item["id"] for item in body["items"]} == expected


@pytest.mark.parametrize("endpoint", ["", "/lookup"])
@pytest.mark.parametrize("department_id,expected", [(1, {"G1", "G2"}), (2, {"G2"}), (3, {"GOWN"})])
def test_department_filter_includes_descendants_without_widening(
    scoped, endpoint, department_id, expected
):
    client, _, _ = scoped
    response = client.get(API + endpoint, params={"department_id": department_id})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == len(expected)
    assert {item["id"] for item in response.json()["items"]} == expected


@pytest.mark.parametrize("department_id,expected", [(None, 3), (1, 2), (2, 1), (3, 1)])
def test_completeness_counts_only_visible_filtered_employees(scoped, department_id, expected):
    client, _, _ = scoped
    response = client.get(
        API + "/completeness", params={"department_id": department_id} if department_id else {}
    )
    assert response.status_code == 200, response.text
    assert response.json()["incomplete"] == expected
    assert response.json()["first_incomplete_id"] in ({"G1", "G2", "GOWN"} if expected else {None})


def test_activity_scopes_all_six_sources_and_query_filters(scoped):
    client, db, user = scoped
    db.add(BookCategory(id="SC", name_en="Scope", prefix="SC"))
    db.flush()
    # Records retain their owning department; activity still intersects that
    # access with the visible subject employees.
    owners = {"G1": 1, "G2": 2, "G3": 3, "GOWN": 3, "GNULL": None}
    for index, employee_id in enumerate(("G1", "G2", "G3", "GOWN", "GNULL"), start=1):
        ref = f"SC-{index:04d}"
        db.add_all(
            [
                Book(
                    category_id="SC",
                    ref_number=ref,
                    employee_id=employee_id,
                    department_id=owners[employee_id],
                    created_by_user_id=user.id if employee_id == "GOWN" else None,
                ),
                Document(
                    employee_id=employee_id,
                    template_id="Certificate",
                    ref_number=ref,
                    docx_path="output/fake.docx",
                    submission_id=f"scope-{index}",
                ),
                Leave(
                    employee_id=employee_id,
                    leave_type="Annual",
                    start_date=date(2026, 8, 1),
                    end_date=date(2026, 8, 2),
                    days=2,
                    status="Approved",
                ),
                Violation(
                    employee_id=employee_id,
                    violation_type="Late",
                    date=date(2026, 8, 1),
                    description="Late",
                    status="Open",
                ),
                LedgerEntry(
                    related_employee_id=employee_id,
                    entry_date=date(2026, 8, 1),
                    direction="incoming",
                    channel="letter",
                    counterparty="Authority",
                    subject="Letter",
                    tags=[],
                ),
                DutyAssignmentEvent(
                    employee_id=employee_id,
                    event_type="transfer",
                    effective_at=datetime(2026, 8, 1, 8),
                    actor_user_id=user.id,
                ),
                EmployeeStatusEvent(
                    employee_id=employee_id,
                    from_status="Loaned",
                    to_status="Active",
                    kind="changed",
                    source="manual",
                ),
            ]
        )
    db.commit()
    response = client.get(API + "/activity", params={"limit": 100})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 18
    assert {(item["kind"], item["employee_id"]) for item in body["items"]} == {
        (kind, employee_id)
        for kind in ("document", "leave", "violation", "ledger", "duty_location", "status")
        for employee_id in ("G1", "G2", "GOWN")
    }
    for params, expected in [
        ({"employee_id": "G3"}, 0),
        ({"department_id": 3}, 6),
        ({"department_id": 1}, 12),
        ({"department_id": 2}, 6),
        ({"kind": "ledger", "department_id": 2}, 1),
    ]:
        filtered = client.get(API + "/activity", params=params)
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == expected


def test_employee_reads_return_derived_departments(scoped):
    client, _, _ = scoped
    for employee_id, department_id in (("G1", 1), ("G2", 2), ("GOWN", 3)):
        response = client.get(API + f"/{employee_id}")
        assert response.status_code == 200, response.text
        assert response.json()["department_id"] == department_id
    rows = client.get(API).json()["items"]
    assert {row["id"]: row["department_id"] for row in rows} == {
        "G1": 1,
        "G2": 2,
        "GOWN": 3,
    }


@pytest.mark.parametrize("employee_id", ["G3", "GNULL", "MISSING"])
def test_employee_object_and_subresources_hide_outside_with_same_404(scoped, employee_id):
    client, _, _ = scoped
    paths = [
        f"/lookup/{employee_id}",
        f"/{employee_id}",
        f"/{employee_id}/detail",
        f"/{employee_id}/leaves",
        f"/{employee_id}/leave-balance",
        f"/{employee_id}/violations",
        f"/{employee_id}/absences",
        f"/{employee_id}/absences/episodes",
        f"/{employee_id}/vault",
        f"/{employee_id}/vault/passport/missing.png/preview",
        f"/{employee_id}/vault/passport/missing.png/download",
        f"/{employee_id}/signature",
        f"/{employee_id}/photo",
    ]
    for path in paths:
        response = client.get(API + path)
        assert response.status_code == 404, (path, response.text)
        assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"
    for method, suffix in [
        ("PATCH", ""),
        ("POST", "/violations"),
        ("POST", "/absences"),
        ("DELETE", "/absences"),
        ("PUT", "/absences/episodes"),
        ("POST", "/vault/upload"),
        ("DELETE", "/vault/passport/file.png"),
        ("POST", "/signature"),
        ("DELETE", "/signature"),
        ("POST", "/photo"),
        ("DELETE", "/photo"),
        ("POST", "/passport/extract"),
    ]:
        response = client.request(method, API + f"/{employee_id}" + suffix)
        assert response.status_code == 404, (method, suffix, response.text)
        assert response.json()["error"]["code"] == "EMPLOYEE_NOT_FOUND"


def test_violation_id_routes_hide_outside(scoped):
    client, db, _ = scoped
    row = Violation(
        employee_id="G3",
        violation_type="Late",
        date=date(2026, 8, 1),
        description="Late",
        status="Open",
    )
    db.add(row)
    db.commit()
    for violation_id in (row.id, 99999):
        for method in ("PATCH", "DELETE"):
            response = client.request(
                method,
                f"/api/v1/violations/{violation_id}",
                json={"status": "Closed"} if method == "PATCH" else None,
            )
            assert response.status_code == 404, response.text
            assert response.json()["error"]["code"] == "VIOLATION_NOT_FOUND"


def test_own_photo_is_allowed_without_employee_view(scoped, tmp_path, monkeypatch):
    from types import SimpleNamespace

    from app.api.v1 import employees

    client, db, user = scoped
    db.add(UserPermission(user_id=user.id, capability="employees.view", effect="deny"))
    db.commit()
    photo = tmp_path / "own.png"
    photo.write_bytes(b"own photo bytes")
    db.add(
        VaultFile(
            employee_id="GOWN", kind="photo", filename=photo.name, path=photo.name, size_bytes=15
        )
    )
    db.commit()
    monkeypatch.setattr(employees, "get_settings", lambda: SimpleNamespace(vault_dir=tmp_path))
    response = client.get(API + "/GOWN/photo")
    assert response.status_code == 200, response.text
    assert response.content == b"own photo bytes"


def test_department_filter_keeps_own_branch_without_exposing_department_peers(scoped):
    client, db, _ = scoped
    employee(db, "GREPORT", supervisor="GOWN")
    recompute(db)
    assert client.get(API).json()["total"] == 4
    for endpoint in ("", "/lookup"):
        response = client.get(API + endpoint, params={"department_id": 3})
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()["items"]} == {"GOWN", "GREPORT"}
        assert response.json()["total"] == 2


def test_supervisor_branch_remains_visible_across_department_exceptions(scoped):
    client, db, _ = scoped
    employee(db, "GREPORT", supervisor="GOWN")
    employee(db, "GINDIRECT", supervisor="GREPORT")
    exception(db, "GREPORT", None)
    response = client.get(API)
    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()["items"]} == {
        "G1",
        "G2",
        "GOWN",
        "GREPORT",
        "GINDIRECT",
    }
    assert db.get(Employee, "GREPORT").department_id is None
    assert db.get(Employee, "GINDIRECT").department_id is None
    narrowed = client.get(API, params={"department_id": 3})
    assert narrowed.status_code == 200, narrowed.text
    assert {row["id"] for row in narrowed.json()["items"]} == {"GOWN"}


def test_direct_service_lists_remain_unrestricted_without_scope(scoped):
    from app.services import employee_service

    _, db, _ = scoped
    rows, total = employee_service.list_employees(db)
    assert total == len(rows) == 5
    rows, total = employee_service.list_employees(db, department_id=1)
    assert total == 2
    assert {row.id for row in rows} == {"G1", "G2"}
