from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models import Department, DepartmentMember, Employee, User, UserPermission
from app.schemas.department import DepartmentMembership
from app.services import department_scope_service as scopes
from app.services import department_service, settings_service


@pytest.fixture()
def scope_data(api_db):
    root = Department(name_en="Root", name_ar="الجذر")
    other = Department(name_en="Other", name_ar="آخر")
    api_db.add_all([root, other])
    api_db.flush()
    child = Department(name_en="Child", name_ar="فرع", parent_id=root.id)
    api_db.add(child)
    api_db.flush()
    grandchild = Department(name_en="Grandchild", name_ar="فرع فرعي", parent_id=child.id)
    own = Employee(id="OWN", name_en="Own", department_id=other.id)
    api_db.add_all([grandchild, own])
    api_db.flush()
    user = User(
        email="scoped@test.ae",
        password_hash="x",
        role="manager",
        status="active",
        employee_id=own.id,
    )
    api_db.add(user)
    api_db.commit()
    return api_db, user, root, child, grandchild, other, own


def enable(db):
    settings_service.set_audited_setting(
        db,
        "settings.department_scoping_enabled",
        True,
        actor="admin@test.ae",
        action="department_scoping.enabled",
        entity_type="settings",
        entity_id="department_scoping_enabled",
    )


def test_switch_off_is_organization_and_memoized(scope_data):
    db, user, *_ = scope_data
    scope = scopes.resolve_department_scope(db, user)
    assert scope.organization and scope.kind == "organization"
    assert scopes.resolve_department_scope(db, user) is scope
    assert scopes.employee_visibility_clause(scope) is None


@pytest.mark.parametrize(
    "role,expected",
    [
        ("member", {"Root"}),
        ("head", {"Root", "Child", "Grandchild"}),
        ("deputy", {"Root", "Child", "Grandchild"}),
    ],
)
def test_members_only_see_own_department_heads_and_deputies_see_subtree(scope_data, role, expected):
    db, user, root, _child, _grandchild, _other, own = scope_data
    enable(db)
    db.add(DepartmentMember(user_id=user.id, department_id=root.id, role=role, is_primary=True))
    db.commit()
    scope = scopes.resolve_department_scope(db, user)
    names = set(
        db.scalars(select(Department.name_en).where(Department.id.in_(scope.department_ids)))
    )
    assert names == expected
    assert scope.kind == "department" and not scope.organization
    assert scopes.employee_in_scope(scope, own)
    null_employee = Employee(id="NULL", name_en="Unassigned")
    assert not scopes.employee_in_scope(scope, null_employee)


@pytest.mark.parametrize("admin", [True, False])
def test_admin_and_explicit_organization_capability_are_unrestricted(scope_data, admin):
    db, user, *_ = scope_data
    enable(db)
    if admin:
        user.role = "admin"
    else:
        db.add(UserPermission(user_id=user.id, capability="departments.all", effect="grant"))
    db.commit()
    assert scopes.resolve_department_scope(db, user).organization


def test_no_membership_is_self_and_membership_change_invalidates(scope_data):
    db, user, root, *_ = scope_data
    enable(db)
    scope = scopes.resolve_department_scope(db, user)
    assert scope.kind == "self" and scope.department_ids == frozenset()
    visible = list(db.scalars(select(Employee).where(scopes.employee_visibility_clause(scope))))
    assert [employee.id for employee in visible] == ["OWN"]
    department_service.replace_memberships(
        db,
        user.id,
        [DepartmentMembership(department_id=root.id, role="member", is_primary=True)],
        actor="admin@test.ae",
    )
    assert scopes.resolve_department_scope(db, user).department_ids == frozenset({root.id})


def test_department_filter_intersects_and_never_readds_owner(scope_data):
    db, user, root, child, grandchild, _other, own = scope_data
    enable(db)
    db.add(DepartmentMember(user_id=user.id, department_id=root.id, role="member", is_primary=True))
    db.commit()
    scope = scopes.resolve_department_scope(db, user)
    root_filter = scopes.narrow_department_scope(db, scope, root.id)
    assert root_filter.department_ids == frozenset({root.id})
    assert not scopes.employee_in_scope(root_filter, own)
    outside = scopes.narrow_department_scope(db, scope, child.id)
    assert outside.department_ids == frozenset() and outside.own_employee_id is None
    organization = scopes.DepartmentScope(True, frozenset(), own.id, "organization")
    narrowed = scopes.narrow_department_scope(db, organization, root.id)
    assert narrowed.department_ids == frozenset({root.id, child.id, grandchild.id})
    assert not narrowed.organization


def test_membership_union_and_permission_changes_invalidate(scope_data):
    from app.services import perm_service

    db, user, _root, child, grandchild, other, _own = scope_data
    enable(db)
    db.add_all(
        [
            DepartmentMember(user_id=user.id, department_id=child.id, role="head", is_primary=True),
            DepartmentMember(
                user_id=user.id, department_id=other.id, role="member", is_primary=False
            ),
        ]
    )
    db.commit()
    assert scopes.resolve_department_scope(db, user).department_ids == frozenset(
        {child.id, grandchild.id, other.id}
    )
    admin = User(email="permission-admin@test.ae", password_hash="x", role="admin", status="active")
    db.add(admin)
    db.commit()
    perm_service.set_user_override(db, user.id, "departments.all", "grant", actor=admin)
    assert scopes.resolve_department_scope(db, user).organization
    perm_service.set_user_override(db, user.id, "departments.all", None, actor=admin)
    assert scopes.resolve_department_scope(db, user).kind == "department"
