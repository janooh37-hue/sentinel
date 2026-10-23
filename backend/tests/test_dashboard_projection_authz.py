"""Dashboard projections honor subsystem denies without denying the whole page."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import Employee, Leave, LedgerEntry, User, UserPermission, Violation
from app.db.session import get_db
from app.main import create_app
from app.services.ledger_service import DRAFT_TAG


def _user(db: Session, email: str, *, role: str = "operator", deny: str | None = None) -> User:
    user = User(email=email, password_hash="x", display_name=email, role=role, status="active")
    db.add(user)
    db.flush()
    if deny:
        db.add(UserPermission(user_id=user.id, capability=deny, effect="deny"))
    db.commit()
    return user


def _get(db: Session, user: User):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
    return response.json()


def _seed(db: Session, actor: User, other: User) -> None:
    today = date.today()
    db.add(Employee(id="DASH", name_en="Dashboard Person", status="Active"))
    db.flush()
    db.add(Leave(employee_id="DASH", leave_type="Annual Leave", start_date=today,
                 end_date=today + timedelta(days=2), days=3, status="Approved"))
    db.add(Violation(employee_id="DASH", violation_type="Late", date=today, status="Open"))
    for subject, channel, owner, tags in [
        ("Own mail", "email", actor.id, []),
        ("Foreign mail", "email", other.id, []),
        ("Ownerless mail", "email", None, []),
        ("Shared letter", "letter", other.id, []),
        ("Own draft", "email", actor.id, [DRAFT_TAG]),
        ("Foreign draft", "email", other.id, [DRAFT_TAG]),
    ]:
        db.add(LedgerEntry(entry_date=today, direction="incoming", channel=channel,
                           counterparty="Synthetic", subject=subject, owner_user_id=owner,
                           tags=tags))
    db.commit()


def _snapshot(db: Session):
    return {
        model.__tablename__: [dict(row) for row in db.execute(select(model.__table__)).mappings()]
        for model in (Employee, Leave, Violation, LedgerEntry, UserPermission)
    }


@pytest.mark.parametrize("denied", ["leaves.view", "violations.view", "ledger.view", "employees.view"])
def test_dashboard_denies_hide_only_protected_sections(api_db: Session, denied: str) -> None:
    actor = _user(api_db, "denied@example.test", deny=denied)
    allowed = _user(api_db, "allowed@example.test")
    _seed(api_db, actor, allowed)
    before = _snapshot(api_db)
    data = _get(api_db, actor)
    totals = data["totals"]
    if denied == "leaves.view":
        assert data["on_leave_today"] == []
        assert data["upcoming_leave_ends"] == []
        assert totals["on_leave_today"] is None
        assert totals["present_today"] is None
    elif denied == "violations.view":
        assert totals["open_violations_count"] is None
    elif denied == "ledger.view":
        assert data["recent_ledger"] == []
    else:
        for field in ("employees_active", "our_staff", "loaned", "present_today"):
            assert totals[field] is None
    assert _snapshot(api_db) == before
    authorized = _get(api_db, allowed)
    assert len(authorized["on_leave_today"]) == 1
    assert len(authorized["upcoming_leave_ends"]) == 1
    assert authorized["totals"]["open_violations_count"] == 1
    assert authorized["totals"]["employees_active"] == 1
    assert authorized["totals"]["on_leave_today"] == 1
    assert authorized["totals"]["present_today"] == 0
    assert authorized["recent_ledger"]
    assert _snapshot(api_db) == before


@pytest.mark.parametrize("role", ["operator", "admin"])
def test_dashboard_mail_is_private_and_drafts_are_owner_scoped(api_db: Session, role: str) -> None:
    actor = _user(api_db, "actor@example.test", role=role)
    other = _user(api_db, "other@example.test")
    _seed(api_db, actor, other)
    before = _snapshot(api_db)
    data = _get(api_db, actor)
    assert {row["subject"] for row in data["recent_ledger"]} == {"Own mail", "Shared letter"}
    assert data["totals"]["draft_count"] == 1
    assert _snapshot(api_db) == before
    other_data = _get(api_db, other)
    assert {row["subject"] for row in other_data["recent_ledger"]} == {"Foreign mail", "Shared letter"}
    assert other_data["totals"]["draft_count"] == 1
    assert _snapshot(api_db) == before
