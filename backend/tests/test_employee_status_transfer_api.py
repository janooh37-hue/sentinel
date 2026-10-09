"""HTTP-level tests for Transferred status, status events and the transfer lifecycle."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.models import Employee, EmployeeStatusEvent, User
from app.db.session import get_db
from app.main import create_app
from app.schemas.employee import EmployeeUpdate
from app.services import employee_service

TODAY = date.today()
FUTURE = TODAY + timedelta(days=10)
LATER = TODAY + timedelta(days=40)


@pytest.fixture()
def hr_user(api_db) -> User:
    user = User(
        email="hr@x.ae", password_hash="x", role="admin", status="active", display_name="HR Admin"
    )
    api_db.add(user)
    api_db.commit()
    api_db.refresh(user)
    return user


@pytest.fixture()
def client(api_db, hr_user) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: hr_user
    return TestClient(app, raise_server_exceptions=True)


def _emp(db, employee_id: str = "G8001", **kw) -> Employee:
    kw.setdefault("status", "Active")
    row = Employee(id=employee_id, name_en=f"Emp {employee_id}", **kw)
    db.add(row)
    db.commit()
    return row


def _events(db, employee_id: str = "G8001") -> list[EmployeeStatusEvent]:
    db.expire_all()
    return list(
        db.scalars(
            select(EmployeeStatusEvent)
            .where(EmployeeStatusEvent.employee_id == employee_id)
            .order_by(EmployeeStatusEvent.id)
        )
    )


def test_patch_transfer_with_site_records_actor(client, api_db, hr_user):
    _emp(api_db)
    r = client.patch(
        "/api/v1/employees/G8001",
        json={"status": "Transferred", "end_date": TODAY.isoformat(), "transfer_site": "Dubai"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "Transferred"
    assert body["transfer_site"] == "Dubai"
    (ev,) = _events(api_db)
    assert ev.actor_user_id == hr_user.id
    assert (ev.to_status, ev.site, ev.kind) == ("Transferred", "Dubai", "changed")


def test_patch_transfer_missing_site_rejected(client, api_db):
    _emp(api_db)
    r = client.patch(
        "/api/v1/employees/G8001",
        json={"status": "Transferred", "end_date": TODAY.isoformat()},
    )
    assert r.status_code in (400, 422), r.text
    assert "EMPLOYEE_INVALID_TRANSFER" in r.text
    assert api_db.get(Employee, "G8001").status == "Active"
    assert _events(api_db) == []


def test_create_transfer_without_site_rejected(client, api_db):
    r = client.post(
        "/api/v1/employees",
        json={
            "id": "G8002",
            "name_en": "New",
            "status": "Transferred",
            "end_date": TODAY.isoformat(),
        },
    )
    assert r.status_code in (400, 422), r.text
    assert api_db.get(Employee, "G8002") is None


def test_create_transfer_with_site_ok(client, api_db, hr_user):
    r = client.post(
        "/api/v1/employees",
        json={
            "id": "G8003",
            "name_en": "New",
            "status": "Transferred",
            "end_date": TODAY.isoformat(),
            "transfer_site": "Abu Dhabi",
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["transfer_site"] == "Abu Dhabi"


def test_reactivation_patch_effective_date(client, api_db):
    _emp(
        api_db,
        status="Transferred",
        end_date=TODAY - timedelta(days=5),
        transfer_site="Dubai",
        transfer_return_date=LATER,
    )
    ret = TODAY - timedelta(days=1)
    r = client.patch(
        "/api/v1/employees/G8001",
        json={"status": "Active", "end_date": None, "effective_date": ret.isoformat()},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "Active"
    assert body["transfer_site"] is None and body["transfer_return_date"] is None
    (ev,) = _events(api_db)
    assert (ev.from_status, ev.to_status) == ("Transferred", "Active")
    assert ev.effective_date == ret


def test_get_employee_returns_transfer_fields(client, api_db):
    _emp(
        api_db,
        status="Transferred",
        end_date=TODAY,
        transfer_site="Dubai",
        transfer_return_date=LATER,
    )
    r = client.get("/api/v1/employees/G8001")
    assert r.status_code == 200
    body = r.json()
    assert body["transfer_site"] == "Dubai"
    assert body["transfer_return_date"] == LATER.isoformat()


def _make_transfer_via_api(client):
    r = client.patch(
        "/api/v1/employees/G8001",
        json={
            "status": "Transferred",
            "end_date": TODAY.isoformat(),
            "transfer_site": "Dubai",
            "transfer_return_date": LATER.isoformat(),
        },
    )
    assert r.status_code == 200, r.text


def test_activity_endpoint_status_kind_has_actor_name(client, api_db):
    _emp(api_db)
    _emp(api_db, "G8009")
    _make_transfer_via_api(client)
    r = client.get("/api/v1/employees/activity", params={"kind": "status"})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items, r.text
    assert {i["kind"] for i in items} == {"status"}
    item = items[0]
    assert item["actor_name"] == "HR Admin"
    assert item["to_status"] == "Transferred"
    assert item["site"] == "Dubai"
    assert item["return_date"] == LATER.isoformat()
    # scoped by employee
    r2 = client.get("/api/v1/employees/activity", params={"kind": "status", "employee_id": "G8009"})
    assert r2.json()["items"] == []


def test_detail_recent_activity_includes_status(client, api_db):
    _emp(api_db)
    _make_transfer_via_api(client)
    r = client.get("/api/v1/employees/G8001/detail")
    assert r.status_code == 200, r.text
    status_items = [a for a in r.json()["recent_activity"] if a["kind"] == "status"]
    assert len(status_items) == 1
    assert status_items[0]["to_status"] == "Transferred"
    assert status_items[0]["site"] == "Dubai"


# --- service-level lifecycle ---------------------------------------------------


def test_full_payload_resend_for_transferred_records_nothing(db_session):
    _emp(
        db_session,
        status="Transferred",
        end_date=TODAY,
        transfer_site="Dubai",
        transfer_return_date=LATER,
    )
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(
            status="Transferred",
            end_date=TODAY,
            transfer_site="Dubai",
            transfer_return_date=LATER,
            department="Ops",
        ),
    )
    row = db_session.get(Employee, "G8001")
    assert row.department == "Ops"
    assert (row.status, row.transfer_site, row.transfer_return_date) == (
        "Transferred",
        "Dubai",
        LATER,
    )
    assert _events(db_session) == []


def test_scheduled_transfer_full_lifecycle(db_session):
    _emp(db_session)
    employee_service.update_employee(
        db_session,
        "G8001",
        EmployeeUpdate(
            status="Transferred",
            end_date=FUTURE,
            transfer_site="Dubai",
            transfer_return_date=LATER,
        ),
    )
    row = db_session.get(Employee, "G8001")
    assert row.status == "Active" and row.pending_status == "Transferred"

    employee_service.apply_due_departures(db_session, today=FUTURE)
    db_session.refresh(row)
    assert row.status == "Transferred"

    moved = employee_service.apply_due_transfer_returns(db_session, today=LATER)
    assert [(e.id, d, s) for e, d, s in moved] == [("G8001", LATER, "Dubai")]
    db_session.refresh(row)
    assert row.status == "Active"
    assert row.end_date is None and row.transfer_site is None
    assert row.transfer_return_date is None and row.pending_status is None

    evs = _events(db_session)
    assert [(e.kind, e.from_status, e.to_status) for e in evs] == [
        ("scheduled", "Active", "Transferred"),
        ("applied", "Active", "Transferred"),
        ("applied", "Transferred", "Active"),
    ]
    assert evs[2].effective_date == LATER
    assert employee_service.apply_due_transfer_returns(db_session, today=LATER) == []
    assert len(_events(db_session)) == 3
