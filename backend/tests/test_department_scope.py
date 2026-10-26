"""Org-tree department scope resolution, intersections and cache invalidation."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Department, Employee, User, UserPermission
from app.services import department_scope_service as scopes
from app.services import department_service, perm_service
from tests.department_fixtures import (
    department,
    employee,
    enable_scoping,
    exception,
    grant,
    link,
    recompute,
)


@pytest.fixture()
def scope_data(api_db):
    employee(api_db, "ROOT_HEAD")
    employee(api_db, "CHILD_HEAD", "ROOT_HEAD")
    employee(api_db, "GRANDCHILD_HEAD", "CHILD_HEAD")
    employee(api_db, "OTHER_HEAD")
    own = employee(api_db, "OWN", "OTHER_HEAD")
    root = department(api_db, "Root", "ROOT_HEAD")
    child = department(api_db, "Child", "CHILD_HEAD")
    grandchild = department(api_db, "Grandchild", "GRANDCHILD_HEAD")
    other = department(api_db, "Other", "OTHER_HEAD")
    user = User(
        email="scoped@test.ae",
        password_hash="x",
        role="manager",
        status="active",
    )
    api_db.add(user)
    link(api_db, user, own.id)
    api_db.commit()
    return api_db, user, root, child, grandchild, other, own


def visible_employee_ids(db, scope):
    clause = scopes.employee_visibility_clause(scope)
    query = select(Employee.id)
    if clause is not None:
        query = query.where(clause)
    visible = set(db.scalars(query))
    assert visible == {
        row.id for row in db.scalars(select(Employee)) if scopes.employee_in_scope(scope, row)
    }
    return visible


def test_switch_off_is_organization_and_memoized(scope_data):
    db, user, *_ = scope_data
    scope = scopes.resolve_department_scope(db, user)
    assert scope.organization and scope.kind == "organization"
    assert scopes.resolve_department_scope(db, user) is scope
    assert scopes.employee_visibility_clause(scope) is None
    assert visible_employee_ids(db, scope) == {
        "ROOT_HEAD",
        "CHILD_HEAD",
        "GRANDCHILD_HEAD",
        "OTHER_HEAD",
        "OWN",
    }


@pytest.mark.parametrize(
    "role,expected",
    [
        ("viewer", {"Root"}),
        ("head", {"Root", "Child", "Grandchild"}),
        ("deputy", {"Root", "Child", "Grandchild"}),
    ],
)
def test_heads_and_deputies_see_subtree_viewers_only_the_granted_department(
    scope_data, role, expected
):
    db, user, root, _child, _grandchild, _other, own = scope_data
    enable_scoping(db)
    if role == "head":
        link(db, user, root.head_employee_id)
        db.commit()
    else:
        grant(db, root.id, user, role)
    scope = scopes.resolve_department_scope(db, user)
    names = set(
        db.scalars(select(Department.name_en).where(Department.id.in_(scope.department_ids)))
    )
    assert names == expected
    assert scope.kind == "department" and not scope.organization
    assert scopes.resolve_department_scope(db, user) is scope
    expected_employees = (
        {"ROOT_HEAD", "CHILD_HEAD", "GRANDCHILD_HEAD"} if role == "head" else {own.id}
    )
    assert scope.employee_ids == frozenset(expected_employees)
    expected_visible = {"ROOT_HEAD"} | expected_employees
    if role != "viewer":
        expected_visible |= {"CHILD_HEAD", "GRANDCHILD_HEAD"}
    assert visible_employee_ids(db, scope) == expected_visible
    assert not scopes.employee_in_scope(scope, Employee(id="NULL", name_en="Unassigned"))


@pytest.mark.parametrize("role", ["head", "deputy", "viewer"])
def test_inactive_department_confers_nothing_to_heads_deputies_or_viewers(scope_data, role):
    db, user, root, _child, _grandchild, _other, own = scope_data
    enable_scoping(db)
    if role == "head":
        link(db, user, root.head_employee_id)
        db.commit()
    else:
        grant(db, root.id, user, role)
    root.active = False
    recompute(db)
    scopes.invalidate_department_scope(db, user.id)
    scope = scopes.resolve_department_scope(db, user)
    assert root.id not in scope.department_ids
    assert root.id not in scopes.user_department_ids(db, user)
    if role != "head":
        assert scope.kind == "self"
        assert visible_employee_ids(db, scope) == {own.id}


def test_inmate_reporters_keep_their_services_when_scoping_is_on(scope_data):
    db, _user, _root, _child, _grandchild, _other, own = scope_data
    reporter = User(
        email="reporter-scope@test.ae", password_hash="x", role="inmate_reporter", status="active"
    )
    db.add(reporter)
    link(db, reporter, own.id)
    db.commit()
    services = {"books.service.Inmate Conduct Violations", "books.service.Report"}
    assert services <= perm_service.effective_caps(db, reporter)
    enable_scoping(db)
    perm_service._invalidate_caps_cache(db, reporter.id)
    assert not scopes.resolve_department_scope(db, reporter).organization
    assert services <= perm_service.effective_caps(db, reporter)


@pytest.mark.parametrize("admin", [True, False])
def test_admin_and_explicit_organization_capability_are_unrestricted(scope_data, admin):
    db, user, *_ = scope_data
    enable_scoping(db)
    if admin:
        user.role = "admin"
    else:
        db.add(UserPermission(user_id=user.id, capability="departments.all", effect="grant"))
    db.commit()
    scope = scopes.resolve_department_scope(db, user)
    assert scope.organization and scope.kind == "organization"
    assert scopes.employee_visibility_clause(scope) is None


def test_derived_membership_alone_is_self_not_department_visibility(scope_data):
    db, user, _root, _child, _grandchild, other, own = scope_data
    enable_scoping(db)
    assert own.department_id == other.id
    assert scopes.user_department_ids(db, user) == frozenset({other.id})
    scope = scopes.resolve_department_scope(db, user)
    assert scope.kind == "self" and not scope.organization
    assert scope.department_ids == frozenset()
    assert scope.employee_ids == frozenset({own.id})
    assert visible_employee_ids(db, scope) == {own.id}


def test_user_without_linked_employee_has_empty_self_scope(scope_data):
    db, user, *_ = scope_data
    enable_scoping(db)
    user.employee_id = None
    db.commit()
    scope = scopes.resolve_department_scope(db, user)
    assert scope.kind == "self" and not scope.organization
    assert scope.department_ids == scope.employee_ids == frozenset()
    assert visible_employee_ids(db, scope) == set()
    assert scopes.user_department_ids(db, user) == frozenset()


def test_supervisor_branch_crosses_department_and_null_exceptions(scope_data):
    db, user, _root, child, _grandchild, other, own = scope_data
    enable_scoping(db)
    report = employee(db, "REPORT", own.id)
    leaf = employee(db, "LEAF", report.id)
    exception(db, report.id, child.id)
    exception(db, leaf.id, None)
    scope = scopes.resolve_department_scope(db, user)
    assert own.department_id == other.id
    assert report.department_id == child.id
    assert leaf.department_id is None
    assert scope.kind == "branch" and not scope.organization
    assert scope.department_ids == frozenset()
    assert scope.employee_ids == frozenset({own.id, report.id, leaf.id})
    assert visible_employee_ids(db, scope) == {own.id, report.id, leaf.id}


def test_people_grant_add_change_and_removal_invalidate_cached_scope(scope_data):
    db, user, root, child, grandchild, _other, own = scope_data
    enable_scoping(db)
    previous = scopes.resolve_department_scope(db, user)
    assert previous.kind == "self"
    for deputies, viewers, expected in [
        ([], [user.id], {root.id}),
        ([user.id], [], {root.id, child.id, grandchild.id}),
        ([], [user.id], {root.id}),
        ([], [], set()),
    ]:
        department_service.replace_people(db, root.id, deputies, viewers, actor="admin@test.ae")
        current = scopes.resolve_department_scope(db, user)
        assert current is not previous
        assert current.department_ids == frozenset(expected)
        assert current.employee_ids == frozenset({own.id})
        assert current.kind == ("department" if expected else "self")
        assert scopes.resolve_department_scope(db, user) is current
        previous = current


@pytest.mark.parametrize(
    "requested,expected_departments,expected_employees",
    [
        ("root", {"root"}, {"REPORT", "LEAF"}),
        ("child", set(), {"LEAF"}),
        ("grandchild", set(), set()),
        ("other", set(), {"OWN"}),
        ("missing", set(), set()),
    ],
)
def test_department_filter_intersects_departments_and_filters_branch_employees(
    scope_data, requested, expected_departments, expected_employees
):
    db, user, root, child, grandchild, other, own = scope_data
    enable_scoping(db)
    employee(db, "REPORT", own.id)
    employee(db, "LEAF", "REPORT")
    employee(db, "UNASSIGNED", own.id)
    exception(db, "REPORT", root.id)
    exception(db, "LEAF", child.id)
    exception(db, "UNASSIGNED", None)
    grant(db, root.id, user, "viewer")
    scope = scopes.resolve_department_scope(db, user)
    assert scopes.narrow_department_scope(db, scope, None) is scope
    departments = {
        "root": root.id,
        "child": child.id,
        "grandchild": grandchild.id,
        "other": other.id,
        "missing": 999999,
    }
    narrowed = scopes.narrow_department_scope(db, scope, departments[requested])
    assert narrowed.department_ids == frozenset(departments[key] for key in expected_departments)
    assert narrowed.employee_ids == frozenset(expected_employees)
    expected_visible = set(expected_employees)
    if expected_departments:
        expected_visible.add("ROOT_HEAD")
    assert visible_employee_ids(db, narrowed) == expected_visible
    assert not narrowed.organization


def test_organization_filter_includes_requested_department_and_descendants(scope_data):
    db, user, root, child, grandchild, _other, _own = scope_data
    organization = scopes.resolve_department_scope(db, user)
    narrowed = scopes.narrow_department_scope(db, organization, root.id)
    assert narrowed.department_ids == frozenset({root.id, child.id, grandchild.id})
    assert narrowed.employee_ids == frozenset()
    assert not narrowed.organization
    assert visible_employee_ids(db, narrowed) == {"ROOT_HEAD", "CHILD_HEAD", "GRANDCHILD_HEAD"}
    missing = scopes.narrow_department_scope(db, organization, 999999)
    assert visible_employee_ids(db, missing) == set()


def test_grant_union_and_permission_override_changes_invalidate(scope_data):
    db, user, _root, child, grandchild, other, own = scope_data
    enable_scoping(db)
    grant(db, child.id, user, "deputy")
    grant(db, other.id, user, "viewer")
    expected = frozenset({child.id, grandchild.id, other.id})
    previous = scopes.resolve_department_scope(db, user)
    assert previous.department_ids == expected
    assert previous.employee_ids == frozenset({own.id})
    admin = User(email="permission-admin@test.ae", password_hash="x", role="admin", status="active")
    db.add(admin)
    db.commit()
    for effect in ["grant", "deny", None]:
        perm_service.set_user_override(db, user.id, "departments.all", effect, actor=admin)
        current = scopes.resolve_department_scope(db, user)
        assert current is not previous
        assert current.organization is (effect == "grant")
        assert current.kind == ("organization" if effect == "grant" else "department")
        if effect != "grant":
            assert current.department_ids == expected
            assert current.employee_ids == frozenset({own.id})
        previous = current


def test_user_department_ids_union_derived_head_and_grants_without_descendants(scope_data):
    db, user, root, child, grandchild, other, _own = scope_data
    enable_scoping(db)
    grant(db, root.id, user, "deputy")
    grant(db, child.id, user, "viewer")
    expected = frozenset({root.id, child.id, other.id})
    assert scopes.user_department_ids(db, user) == expected
    assert frozenset(db.scalars(scopes.user_department_ids_select(user.id))) == expected
    assert grandchild.id not in expected
    link(db, user, child.head_employee_id)
    recompute(db)
    assert scopes.user_department_ids(db, user) == frozenset({root.id, child.id})
    scope = scopes.resolve_department_scope(db, user)
    assert scope.department_ids == frozenset({root.id, child.id, grandchild.id})
    assert scope.employee_ids == frozenset({"CHILD_HEAD", "GRANDCHILD_HEAD"})


def test_recompute_invalidates_cached_branch_after_supervisor_change(scope_data):
    db, user, root, _child, _grandchild, _other, own = scope_data
    enable_scoping(db)
    report = employee(db, "REPORT", root.head_employee_id)
    leaf = employee(db, "LEAF", report.id)
    recompute(db)
    previous = scopes.resolve_department_scope(db, user)
    assert previous.kind == "self"
    assert previous.employee_ids == frozenset({own.id})
    report.supervisor_id = own.id
    recompute(db)
    current = scopes.resolve_department_scope(db, user)
    assert current is not previous
    assert current.kind == "branch"
    assert current.department_ids == frozenset()
    assert current.employee_ids == frozenset({own.id, report.id, leaf.id})
    assert visible_employee_ids(db, current) == {own.id, report.id, leaf.id}
