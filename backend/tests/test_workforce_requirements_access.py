from __future__ import annotations

from datetime import date

import pytest

from app.db.workforce_models import WorkStaffingRequirement
from app.services import perm_service, workforce_read_service
from app.services.workforce_access_service import organization_scope
from app.services.workforce_scope_service import WorkforceScope, WorkforceScopeEntry
from tests.test_workforce_api_permissions import _client, _scope, _user


def _requirement(*, department: str, actor_id: int) -> WorkStaffingRequirement:
    return WorkStaffingRequirement(
        scope_kind="department",
        department=department,
        duty_unit=None,
        duty_post=None,
        shift_definition_id=None,
        minimum_headcount=1,
        effective_from=date(2026, 1, 1),
        effective_to=None,
        created_by_user_id=actor_id,
    )


def test_requirements_filter_before_limit_and_paginate_only_visible_rows(api_db) -> None:
    manager = _user(api_db, email="requirements-operations@test.ae")
    perm_service.set_user_override(
        api_db,
        manager.id,
        "workforce.policy.manage",
        "grant",
    )
    _scope(api_db, manager, kind="department", department="Operations")
    allowed = [_requirement(department="Operations", actor_id=manager.id) for _ in range(3)]
    api_db.add_all(allowed)
    api_db.flush()
    allowed_ids = [row.id for row in allowed]
    api_db.add_all([_requirement(department="Finance", actor_id=manager.id) for _ in range(500)])
    api_db.commit()

    client = _client(api_db, manager)
    first = client.get("/api/v1/workforce/requirements?limit=2")

    assert first.status_code == 200, first.text
    assert [row["id"] for row in first.json()["items"]] == [allowed_ids[2], allowed_ids[1]]
    assert first.json()["next_cursor"] is not None

    second = client.get(
        "/api/v1/workforce/requirements",
        params={"limit": 2, "cursor": first.json()["next_cursor"]},
    )
    assert second.status_code == 200, second.text
    assert [row["id"] for row in second.json()["items"]] == [allowed_ids[0]]
    assert second.json()["next_cursor"] is None

    _scope(api_db, manager, kind="department", department="Finance")
    replay = client.get(
        "/api/v1/workforce/requirements",
        params={"limit": 2, "cursor": first.json()["next_cursor"]},
    )
    assert replay.status_code == 422, replay.text
    assert replay.json()["error"]["code"] == "INVALID_CURSOR"


@pytest.mark.parametrize(
    ("scope", "visible_ids"),
    [
        (organization_scope(), [1, 2, 3]),
        (
            WorkforceScope(
                entries=(WorkforceScopeEntry(scope_kind="department", department="Operations"),)
            ),
            [1],
        ),
        (
            WorkforceScope(
                entries=(WorkforceScopeEntry(scope_kind="duty_unit", duty_unit="Gate 1"),)
            ),
            [2, 3],
        ),
        (
            WorkforceScope(
                entries=(
                    WorkforceScopeEntry(
                        scope_kind="duty_post", duty_unit="Gate 1", duty_post="North"
                    ),
                )
            ),
            [3],
        ),
        (
            WorkforceScope(entries=(WorkforceScopeEntry(scope_kind="self", employee_id="G-SELF"),)),
            [],
        ),
        (WorkforceScope(), []),
    ],
)
def test_requirement_reads_follow_hierarchy_and_allow_absent_department(
    db_session, scope, visible_ids
) -> None:
    actor = _user(db_session, email=f"requirements-{len(visible_ids)}@test.ae")
    rows = [
        WorkStaffingRequirement(
            id=1,
            scope_kind="department",
            department="Operations",
            duty_unit=None,
            duty_post=None,
            shift_definition_id=None,
            minimum_headcount=1,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            created_by_user_id=actor.id,
        ),
        WorkStaffingRequirement(
            id=2,
            scope_kind="duty_unit",
            department=None,
            duty_unit="Gate 1",
            duty_post=None,
            shift_definition_id=None,
            minimum_headcount=1,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            created_by_user_id=actor.id,
        ),
        WorkStaffingRequirement(
            id=3,
            scope_kind="duty_post",
            department=None,
            duty_unit="Gate 1",
            duty_post="North",
            shift_definition_id=None,
            minimum_headcount=1,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            created_by_user_id=actor.id,
        ),
    ]
    db_session.add_all(rows)
    db_session.commit()

    visible = workforce_read_service.list_staffing_requirements(db_session, scope=scope)
    assert sorted(row.id for row in visible) == visible_ids
