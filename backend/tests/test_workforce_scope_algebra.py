"""Workforce scope algebra and conservative role defaults.

Salvaged from the branch's `test_workforce_authorization.py`, which cannot be
ported whole: that file imports `UserPreference` and `app.api.v1.notifications`
and asserts the session-projection / SSE-authorization rework this port
deliberately leaves behind — including a test demanding that
`GET /auth/me/capabilities` be REMOVED, which `frontend/src/lib/useCapabilities.ts`
still depends on. Only the scope and preset guarantees are kept here.
"""

from __future__ import annotations

import pytest

from app.core.permissions import ALL_CAPABILITIES, CAPABILITY_IDS, ROLE_DEFAULTS
from app.db.models import Employee, User, UserWorkforceScope
from app.services import perm_service
from app.services.workforce_scope_service import (
    WorkforceScope,
    intersect_workforce_scope,
    normalize_scope_entry,
    resolve_workforce_scope,
)

WORKFORCE_CAPABILITIES = {
    "workforce.self.view",
    "workforce.dashboard.view",
    "workforce.people.view",
    "workforce.schedule.manage",
    "workforce.policy.manage",
    "workforce.attendance.review",
    "workforce.attendance.correct",
    "workforce.integration.manage",
}


def _employee(
    employee_id: str, *, department: str | None, duty_unit: str, duty_post: str = "Gate 1"
) -> Employee:
    return Employee(
        id=employee_id,
        name_en=f"Employee {employee_id}",
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    )


def _user(db_session, *, email: str, role: str = "operator", employee_id: str | None = None) -> User:
    user = User(
        email=email,
        password_hash="x",
        role=role,
        status="active",
        employee_id=employee_id,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _allows(scope: WorkforceScope, employee: Employee) -> bool:
    return scope.allows_employee(
        employee_id=employee.id,
        department=employee.department,
        duty_unit=employee.duty_unit,
        duty_post=employee.duty_post,
    )


def test_workforce_capability_catalog_and_conservative_role_defaults() -> None:
    """The catalog has exactly the stable workforce IDs and operators get self view only."""
    assert set(CAPABILITY_IDS) >= WORKFORCE_CAPABILITIES
    assert set(ALL_CAPABILITIES) >= WORKFORCE_CAPABILITIES
    assert ROLE_DEFAULTS["operator"] & WORKFORCE_CAPABILITIES == {"workforce.self.view"}
    assert "workforce.dashboard.view" not in ROLE_DEFAULTS["operator"]
    assert "workforce.people.view" not in ROLE_DEFAULTS["operator"]
    assert "workforce.schedule.manage" not in ROLE_DEFAULTS["operator"]
    assert "workforce.policy.manage" not in ROLE_DEFAULTS["operator"]
    assert "workforce.attendance.review" not in ROLE_DEFAULTS["operator"]
    assert "workforce.attendance.correct" not in ROLE_DEFAULTS["operator"]
    assert "workforce.integration.manage" not in ROLE_DEFAULTS["operator"]


def test_resolved_self_and_department_scopes_union_then_requested_filter_only_narrows(
    db_session,
) -> None:
    """Implicit self plus assigned scope is a union; an unrelated filter cannot widen it."""
    self_employee = _employee("G-SELF", department="Operations", duty_unit="North")
    scoped_employee = _employee("G-NORTH", department="Operations", duty_unit="North")
    sibling_employee = _employee("G-SOUTH", department="Operations", duty_unit="South")
    foreign_employee = _employee("G-OTHER", department="Security", duty_unit="North")
    db_session.add_all([self_employee, scoped_employee, sibling_employee, foreign_employee])
    db_session.commit()

    user = _user(db_session, email="scope@test.ae", employee_id=self_employee.id)
    db_session.add(
        UserWorkforceScope(
            user_id=user.id,
            scope_kind="department",
            department="Operations",
            duty_unit=None,
            duty_post=None,
            created_by_user_id=user.id,
        )
    )
    db_session.commit()

    resolved = resolve_workforce_scope(db_session, user)
    assert isinstance(resolved, WorkforceScope)
    assert _allows(resolved, self_employee)
    assert _allows(resolved, scoped_employee)
    assert _allows(resolved, sibling_employee)
    assert not _allows(resolved, foreign_employee)

    narrowed = intersect_workforce_scope(
        resolved,
        department="Operations",
        duty_unit="North",
        duty_post=None,
    )
    assert _allows(narrowed, self_employee)
    assert _allows(narrowed, scoped_employee)
    assert not _allows(narrowed, sibling_employee)
    assert not _allows(narrowed, foreign_employee)

    denied_filter = intersect_workforce_scope(
        resolved,
        department="Security",
        duty_unit="North",
        duty_post=None,
    )
    assert not _allows(denied_filter, self_employee)
    assert not _allows(denied_filter, foreign_employee)


def test_admin_effective_capabilities_still_resolve_explicit_organization_scope(db_session) -> None:
    """The admin shortcut supplies all capabilities without bypassing scope resolution."""
    employee = _employee("G-ADMIN", department="Security", duty_unit="South")
    db_session.add(employee)
    db_session.commit()
    admin = _user(db_session, email="admin-scope@test.ae", role="admin", employee_id=employee.id)

    scope = resolve_workforce_scope(db_session, admin)
    assert perm_service.effective_caps(db_session, admin) >= WORKFORCE_CAPABILITIES
    assert scope.is_organization is True
    assert _allows(scope, employee)


def test_unit_grant_without_a_department_covers_an_unrecorded_department(db_session) -> None:
    """Most of this roster carries no department, so a unit grant must not need one."""
    unrecorded = _employee("G-NODEPT", department=None, duty_unit="First Company")
    recorded = _employee("G-DEPT", department="Internal Security", duty_unit="First Company")
    other_unit = _employee("G-SUPPORT", department=None, duty_unit="Support Group")
    db_session.add_all([unrecorded, recorded, other_unit])
    db_session.commit()

    user = _user(db_session, email="unit-grant@test.ae")
    db_session.add(
        UserWorkforceScope(
            user_id=user.id,
            scope_kind="duty_unit",
            department=None,
            duty_unit="First Company",
            duty_post=None,
            created_by_user_id=user.id,
        )
    )
    db_session.commit()

    scope = resolve_workforce_scope(db_session, user)
    assert _allows(scope, unrecorded)
    assert _allows(scope, recorded)
    assert not _allows(scope, other_unit)


def test_named_department_still_pins_both_levels_and_excludes_unrecorded_people(
    db_session,
) -> None:
    """Naming a department keeps the grant narrow; an unrecorded department is outside it."""
    unrecorded = _employee("G-NODEPT", department=None, duty_unit="First Company")
    recorded = _employee("G-DEPT", department="Internal Security", duty_unit="First Company")
    foreign = _employee("G-FOREIGN", department="General Services", duty_unit="First Company")
    db_session.add_all([unrecorded, recorded, foreign])
    db_session.commit()

    unit_user = _user(db_session, email="named-unit@test.ae")
    department_user = _user(db_session, email="named-department@test.ae")
    db_session.add_all(
        [
            UserWorkforceScope(
                user_id=unit_user.id,
                scope_kind="duty_unit",
                department="Internal Security",
                duty_unit="First Company",
                duty_post=None,
                created_by_user_id=unit_user.id,
            ),
            UserWorkforceScope(
                user_id=department_user.id,
                scope_kind="department",
                department="Internal Security",
                duty_unit=None,
                duty_post=None,
                created_by_user_id=department_user.id,
            ),
        ]
    )
    db_session.commit()

    unit_scope = resolve_workforce_scope(db_session, unit_user)
    assert _allows(unit_scope, recorded)
    assert not _allows(unit_scope, unrecorded)
    assert not _allows(unit_scope, foreign)

    department_scope = resolve_workforce_scope(db_session, department_user)
    assert _allows(department_scope, recorded)
    assert not _allows(department_scope, unrecorded)


def test_normalized_grants_require_their_own_levels_only() -> None:
    """A unit grant needs a unit, a post grant needs the unit that contains it."""
    unit_entry = normalize_scope_entry(
        scope_kind="duty_unit", department=None, duty_unit="First Company", duty_post=None
    )
    assert (unit_entry.department, unit_entry.duty_unit, unit_entry.duty_post) == (
        None,
        "First Company",
        None,
    )

    post_entry = normalize_scope_entry(
        scope_kind="duty_post", department=None, duty_unit="First Company", duty_post="Gate 1"
    )
    assert (post_entry.duty_unit, post_entry.duty_post) == ("First Company", "Gate 1")

    with pytest.raises(ValueError, match="duty_post"):
        normalize_scope_entry(
            scope_kind="duty_post", department="Internal Security", duty_unit=None, duty_post="Gate 1"
        )
    with pytest.raises(ValueError, match="duty_unit"):
        normalize_scope_entry(
            scope_kind="duty_unit", department="Internal Security", duty_unit=None, duty_post=None
        )
    with pytest.raises(ValueError, match="department"):
        normalize_scope_entry(
            scope_kind="department", department=None, duty_unit=None, duty_post=None
        )
