from __future__ import annotations

import warnings

import pytest
from sqlalchemy.exc import SAWarning

from app.api.errors import AppError
from app.db.models import AuditLog, Employee, User
from app.schemas.workforce import WorkforceScopeWrite
from app.services.workforce_access_service import (
    employee_in_scope,
    replace_user_scopes,
    user_scopes,
)
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry


def _employee(employee_id: str, *, unit: str) -> Employee:
    return Employee(
        id=employee_id,
        name_en=f"Employee {employee_id}",
        department=None,
        duty_unit=unit,
        duty_post="Gate 1",
    )


def test_employee_in_scope_loads_allowed_employee_and_denies_foreign_target(db_session) -> None:
    allowed = _employee("G-ALLOWED", unit="Operations")
    foreign = _employee("G-FOREIGN", unit="Finance")
    db_session.add_all([allowed, foreign])
    db_session.commit()
    scope = WorkforceScope(
        entries=(WorkforceScopeEntry(scope_kind="duty_unit", duty_unit="Operations"),)
    )

    assert employee_in_scope(db_session, scope=scope, employee_id=allowed.id) is allowed
    with pytest.raises(AppError) as denied:
        employee_in_scope(db_session, scope=scope, employee_id=foreign.id)
    assert denied.value.code == "FORBIDDEN"
    assert denied.value.http_status == 403


def test_scope_replacement_normalizes_audit_and_leaves_commit_to_caller(db_session) -> None:
    actor = User(
        email="scope-actor@test.ae",
        password_hash="x",
        role="admin",
        status="active",
    )
    target = User(
        email="scope-target@test.ae",
        password_hash="x",
        role="operator",
        status="active",
    )
    db_session.add_all([actor, target])
    db_session.commit()

    before, original_etag = user_scopes(db_session, user_id=target.id)
    assert before == []
    rows, replacement_etag = replace_user_scopes(
        db_session,
        user_id=target.id,
        scopes=[
            WorkforceScopeWrite(
                scope_kind="duty_unit",
                department=None,
                duty_unit="  Operations  ",
                duty_post=None,
            )
        ],
        if_match=original_etag,
        actor=actor,
    )

    assert [(row.scope_kind, row.department, row.duty_unit, row.duty_post) for row in rows] == [
        ("duty_unit", None, "Operations", None)
    ]
    assert replacement_etag != original_etag
    assert db_session.query(AuditLog).filter_by(action="workforce.scope.replaced").count() == 1

    db_session.rollback()
    restored, restored_etag = user_scopes(db_session, user_id=target.id)
    assert restored == []
    assert restored_etag == original_etag


def test_nonempty_scope_can_be_replaced_and_restored_without_identity_warnings(
    db_session,
) -> None:
    actor = User(email="cycle-actor@test.ae", password_hash="x", role="admin", status="active")
    target = User(email="cycle-target@test.ae", password_hash="x", role="operator", status="active")
    db_session.add_all([actor, target])
    db_session.commit()
    _, empty_etag = user_scopes(db_session, user_id=target.id)

    _, operations_etag = replace_user_scopes(
        db_session,
        user_id=target.id,
        scopes=[
            WorkforceScopeWrite(
                scope_kind="department",
                department="Operations",
                duty_unit=None,
                duty_post=None,
            )
        ],
        if_match=empty_etag,
        actor=actor,
    )
    db_session.commit()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        restored, restored_etag = replace_user_scopes(
            db_session,
            user_id=target.id,
            scopes=[
                WorkforceScopeWrite(
                    scope_kind="department",
                    department="Finance",
                    duty_unit=None,
                    duty_post=None,
                )
            ],
            if_match=operations_etag,
            actor=actor,
        )
        db_session.commit()
        _, finance_etag = user_scopes(db_session, user_id=target.id)
        second_restore, second_etag = replace_user_scopes(
            db_session,
            user_id=target.id,
            scopes=[
                WorkforceScopeWrite(
                    scope_kind="department",
                    department="Operations",
                    duty_unit=None,
                    duty_post=None,
                )
            ],
            if_match=finance_etag,
            actor=actor,
        )
        db_session.flush()

    assert not [warning for warning in caught if issubclass(warning.category, SAWarning)]
    assert [row.department for row in restored] == ["Finance"]
    assert restored_etag == finance_etag
    assert [row.department for row in second_restore] == ["Operations"]
    assert second_etag == operations_etag


def test_scope_replacement_preserves_missing_stale_and_duplicate_precedence(
    db_session,
) -> None:
    actor = User(email="errors-actor@test.ae", password_hash="x", role="admin", status="active")
    target = User(
        email="errors-target@test.ae", password_hash="x", role="operator", status="active"
    )
    db_session.add_all([actor, target])
    db_session.commit()
    duplicate = WorkforceScopeWrite(
        scope_kind="duty_unit",
        department=None,
        duty_unit="Operations",
        duty_post=None,
    )

    with pytest.raises(AppError) as missing:
        replace_user_scopes(
            db_session,
            user_id=target.id + 10_000,
            scopes=[duplicate, duplicate],
            if_match='"stale"',
            actor=actor,
        )
    assert missing.value.code == "USER_NOT_FOUND"

    before_rows, before_etag = user_scopes(db_session, user_id=target.id)
    with pytest.raises(AppError) as stale:
        replace_user_scopes(
            db_session,
            user_id=target.id,
            scopes=[duplicate, duplicate],
            if_match='"stale"',
            actor=actor,
        )
    assert stale.value.code == "WORKFORCE_VERSION_CONFLICT"
    db_session.flush()
    assert user_scopes(db_session, user_id=target.id) == (before_rows, before_etag)

    with pytest.raises(AppError) as duplicated:
        replace_user_scopes(
            db_session,
            user_id=target.id,
            scopes=[duplicate, duplicate.model_copy(update={"duty_unit": " Operations "})],
            if_match=before_etag,
            actor=actor,
        )
    assert duplicated.value.code == "DUPLICATE_WORKFORCE_SCOPE"
    db_session.flush()
    assert user_scopes(db_session, user_id=target.id) == (before_rows, before_etag)
    assert db_session.query(AuditLog).filter_by(action="workforce.scope.replaced").count() == 0
