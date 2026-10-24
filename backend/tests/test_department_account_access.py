"""Account-first access overview: what each account sees, as if limits were on."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.models import User, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import department_scope_service, department_service
from tests.department_fixtures import department, employee, enable_scoping, grant


def account(db, name, employee_id=None, role="operator", **fields):
    user = User(
        email=f"{name}@access.test",
        password_hash="x",
        role=role,
        status=fields.pop("status", "active"),
        employee_id=employee_id,
        display_name=fields.pop("display_name", name.title()),
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture()
def org(api_db):
    """P > M (heads Branch) > S (heads Section) > G1, G2 (Resigned); U > U1, U2; LONE."""
    db = api_db
    employee(db, "P", name_en="Saeed", name_ar="سعيد")
    employee(db, "M", "P")
    employee(db, "S", "M")
    employee(db, "G1", "S", duty_unit="North")
    employee(db, "G2", "S", status="Resigned")
    employee(db, "U", name_en="Unit Top")
    employee(db, "U1", "U")
    employee(db, "U2", "U", status="Loaned")
    employee(db, "LONE")
    branch = department(db, "Branch", "M")
    section = department(db, "Section", "S")
    users = {
        "admin": account(db, "admin", role="admin"),
        "allops": account(db, "allops", "U"),
        "head": account(db, "head", "M", display_name="head"),
        "deputy": account(db, "deputy"),
        "viewer": account(db, "viewer"),
        "manager": account(db, "manager", "P"),
        "plain": account(db, "plain", "G1"),
        "unlinked": account(db, "unlinked"),
        "disabled": account(db, "disabled", status="disabled"),
        "inmate": account(db, "inmate", role="inmate_reporter"),
    }
    db.add(UserPermission(user_id=users["allops"].id, capability="departments.all", effect="grant"))
    db.commit()
    grant(db, branch.id, users["deputy"], "deputy")
    grant(db, section.id, users["viewer"], "viewer")
    return db, users, branch, section


def by_user(db):
    overview = department_service.account_access(db)
    return overview, {row.email.split("@")[0]: row for row in overview.accounts}


def test_each_account_kind_explains_what_it_sees(org):
    db, _users, branch, section = org
    overview, rows = by_user(db)
    assert not overview.limits_enabled
    assert set(rows) == {
        "admin",
        "allops",
        "head",
        "deputy",
        "viewer",
        "manager",
        "plain",
        "unlinked",
    }
    assert [row.display_name for row in overview.accounts] == sorted(
        (row.display_name for row in overview.accounts), key=str.casefold
    )
    working_total = 8  # Everyone except the Resigned G2.

    admin = rows["admin"]
    assert (admin.sees, admin.organization_reason, admin.visible_count) == (
        "organization",
        "admin",
        working_total,
    )
    allops = rows["allops"]
    assert (allops.sees, allops.organization_reason, allops.team_size, allops.visible_count) == (
        "organization",
        "all_departments",
        2,
        working_total,
    )

    head = rows["head"]
    assert (head.sees, head.organization_reason, head.team_size, head.visible_count) == (
        "department",
        None,
        2,
        3,
    )
    assert [(d.department_id, d.role, d.sub_department_count) for d in head.departments] == [
        (branch.id, "head", 1)
    ]
    assert head.receives_department_records == [branch.id]
    assert (head.reports_to_name_en, head.reports_to_name_ar) == ("Saeed", "سعيد")

    deputy = rows["deputy"]
    assert (deputy.sees, deputy.visible_count, deputy.receives_department_records) == (
        "department",
        3,
        [branch.id],
    )
    assert [(d.department_id, d.role, d.sub_department_count) for d in deputy.departments] == [
        (branch.id, "deputy", 1)
    ]
    viewer = rows["viewer"]
    assert (viewer.sees, viewer.visible_count, viewer.receives_department_records) == (
        "department",
        2,
        [],
    )
    assert [(d.role, d.sub_department_count) for d in viewer.departments] == [("viewer", 0)]

    manager = rows["manager"]
    assert (manager.sees, manager.team_size, manager.visible_count) == ("branch", 3, 4)
    assert manager.reports_to_name_en is None and manager.departments == []

    plain = rows["plain"]
    assert (plain.sees, plain.team_size, plain.visible_count, plain.duty_unit) == (
        "self",
        0,
        1,
        "North",
    )
    assert [(d.department_id, d.role) for d in plain.departments] == [(section.id, "member")]

    unlinked = rows["unlinked"]
    assert (unlinked.sees, unlinked.employee_id, unlinked.visible_count) == ("self", None, 0)


def test_unattached_units_skip_the_largest_root_and_lone_people(org):
    db, *_ = org
    overview, _rows = by_user(db)
    assert [(u.top_employee_id, u.name_en, u.team_size) for u in overview.unattached_units] == [
        ("U", "Unit Top", 2)
    ]


def test_unattached_unit_keeps_non_working_root_with_working_reports(api_db):
    db = api_db
    employee(db, "P")
    employee(db, "P1", "P")
    employee(db, "P2", "P")
    employee(db, "U", status="Resigned")
    employee(db, "U1", "U")
    db.commit()

    overview = department_service.account_access(db)

    assert [(u.top_employee_id, u.team_size) for u in overview.unattached_units] == [("U", 1)]


def test_viewer_does_not_include_sub_departments_in_access_summary(org):
    db, users, branch, section = org
    grant(db, branch.id, users["viewer"], "viewer")

    _overview, rows = by_user(db)

    assert {
        (d.department_id, d.role, d.sub_department_count) for d in rows["viewer"].departments
    } == {(branch.id, "viewer", 0), (section.id, "viewer", 0)}


def test_account_access_terminates_on_supervisor_cycle(api_db):
    db = api_db
    root = employee(db, "A")
    employee(db, "B", "A")
    employee(db, "C", "A")
    root.supervisor_id = "C"
    account(db, "cycle", "A")

    overview, rows = by_user(db)

    assert (rows["cycle"].sees, rows["cycle"].team_size, rows["cycle"].visible_count) == (
        "branch",
        2,
        3,
    )
    assert overview.unattached_units == []


def test_inactive_department_deputy_does_not_receive_department_records(org):
    db, users, branch, _section = org
    inactive = department(db, "Inactive", "U", active=False)
    grant(db, inactive.id, users["deputy"], "deputy")

    _overview, rows = by_user(db)
    deputy = rows["deputy"]

    assert (inactive.id, "deputy") in [(d.department_id, d.role) for d in deputy.departments]
    assert deputy.receives_department_records == [branch.id]


@pytest.mark.parametrize("roots", [("A", "Z"), ("Z", "A")])
def test_equal_size_roots_exclude_lowest_employee_id_regardless_of_insert_order(api_db, roots):
    db = api_db
    for root in roots:
        employee(db, root)
        employee(db, f"{root}1", root)
    db.commit()

    overview = department_service.account_access(db)

    assert [(u.top_employee_id, u.team_size) for u in overview.unattached_units] == [("Z", 1)]


@pytest.mark.parametrize(
    ("employee_id", "expected_name"),
    [("E", "Employee fallback"), (None, "fallback@access.test")],
)
def test_display_name_falls_back_to_employee_name_then_email(api_db, employee_id, expected_name):
    db = api_db
    employee(db, "E", name_en="Employee fallback")
    account(db, "fallback", employee_id, display_name=None)

    _overview, rows = by_user(db)

    assert rows["fallback"].display_name == expected_name


def test_visible_count_is_the_configured_outcome_with_limits_off_or_on(org):
    db, users, *_ = org
    off_overview, off = by_user(db)
    # Previewing never stores the as-if-on scope in the live (limits-off) cache.
    cached = getattr(users["plain"], "_department_scope_cache", None)
    assert cached is None or cached.organization
    enable_scoping(db)
    department_scope_service.invalidate_all_department_scopes(db)
    on_overview, on = by_user(db)
    assert (off_overview.limits_enabled, on_overview.limits_enabled) == (False, True)
    assert {k: (r.sees, r.visible_count) for k, r in off.items()} == {
        k: (r.sees, r.visible_count) for k, r in on.items()
    }


def test_preview_scope_does_not_change_live_caching(org):
    db, users, *_ = org
    plain = users["plain"]
    live = department_scope_service.resolve_department_scope(db, plain)
    assert live.organization  # Limits are off.
    preview = department_scope_service.resolve_department_scope(db, plain, assume_enabled=True)
    assert preview.kind == "self"
    assert department_scope_service.resolve_department_scope(db, plain) is live


def test_account_access_requires_departments_manage(org):
    db, users, *_ = org
    caller = users["plain"]
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: caller
    with TestClient(app) as client:
        assert client.get("/api/v1/departments/account-access").status_code == 403
        db.add(UserPermission(user_id=caller.id, capability="departments.manage", effect="grant"))
        db.commit()
        caller._effective_caps_cache = None
        response = client.get("/api/v1/departments/account-access")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"limits_enabled", "accounts", "unattached_units"}
