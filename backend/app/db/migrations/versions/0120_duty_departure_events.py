"""Departed employees leave the duty-unit structure.

Revision ID: 0120_duty_departure_events
Revises: 0119_employee_former_ids

Adds three ``duty_assignment_events`` types written when an employee's status
crosses the working boundary: ``service_end`` (Resigned/Terminated),
``transfer_out`` (Transferred) and ``reinstatement`` (back to Active/Loaned).
The scheduler and this backfill write them for no user, so they join
``baseline`` in not requiring an actor.

Backfill: every Resigned/Terminated/Transferred employee still holding a duty
unit or post gets the departure event (dated their ``end_date``, else now) and
the two fields cleared, so the roster is clean on upgrade.

Downgrade puts back, for each employee who is still departed and unassigned,
the unit/post their latest departure event left, then deletes every event of
the new types (the old CHECK rejects them). Attendance cases stamped with one
of those events lose that link (the column is nullable) rather than point at a
deleted, later reused id. A post held without a unit was never a hierarchy
path, so the backfill could not record it and it is not restored.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0120_duty_departure_events"
down_revision: str | Sequence[str] | None = "0119_employee_former_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "duty_assignment_events"
_EVENT_TYPE_CK = "ck_duty_assignment_events_event_type"
_ACTOR_CK = "ck_duty_assignment_events_actor_required"

_OLD_EVENT_TYPES = "event_type IN ('baseline', 'initial_placement', 'transfer', 'manual_change')"
_NEW_EVENT_TYPES = (
    "event_type IN ('baseline', 'initial_placement', 'transfer', 'manual_change', "
    "'service_end', 'transfer_out', 'reinstatement')"
)
_OLD_ACTOR = "actor_user_id IS NOT NULL OR event_type = 'baseline'"
_NEW_ACTOR = (
    "actor_user_id IS NOT NULL OR event_type IN "
    "('baseline', 'service_end', 'transfer_out', 'reinstatement')"
)

# Mirrors app.schemas.employee: frozen here so the migration never drifts.
_DEPARTED = "('Resigned', 'Terminated', 'Transferred')"
_WORKING = "('Active', 'Loaned')"
_NEW_TYPES = "('service_end', 'transfer_out', 'reinstatement')"
_DEPARTURE_TYPES = "('service_end', 'transfer_out')"


def _replace_checks(event_types: str, actor: str) -> None:
    with op.batch_alter_table(_TABLE, recreate="always") as batch:
        batch.drop_constraint(_EVENT_TYPE_CK, type_="check")
        batch.drop_constraint(_ACTOR_CK, type_="check")
        batch.create_check_constraint(_EVENT_TYPE_CK, event_types)
        batch.create_check_constraint(_ACTOR_CK, actor)


def _backfill_departures() -> None:
    """Record and clear the duty location of employees who already departed.

    Same snapshot rules as ``duty_service._event_hierarchy``: blanks are NULL,
    and a post with no unit is dropped (not a hierarchy path).
    """
    bind = op.get_bind()
    unit = "NULLIF(TRIM(COALESCE(duty_unit, '')), '')"
    post = "NULLIF(TRIM(COALESCE(duty_post, '')), '')"
    holds_location = f"({unit} IS NOT NULL OR {post} IS NOT NULL)"
    bind.execute(
        sa.text(
            f"INSERT INTO {_TABLE} "
            "(employee_id, event_type, from_department, from_unit, from_post, "
            "to_department, to_unit, to_post, effective_at, actor_user_id, reason, created_at) "
            "SELECT id, "
            "CASE WHEN status = 'Transferred' THEN 'transfer_out' ELSE 'service_end' END, "
            f"NULLIF(TRIM(COALESCE(department, '')), ''), {unit}, "
            f"CASE WHEN {unit} IS NULL THEN NULL ELSE {post} END, "
            "NULL, NULL, NULL, "
            "COALESCE(end_date || ' 00:00:00', CURRENT_TIMESTAMP), NULL, NULL, CURRENT_TIMESTAMP "
            f"FROM employees WHERE status IN {_DEPARTED} AND {holds_location}"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE employees SET duty_unit = NULL, duty_post = NULL "
            f"WHERE status IN {_DEPARTED} AND {holds_location}"
        )
    )


def _restore_departed_locations() -> None:
    latest = (
        f"SELECT {{col}} FROM {_TABLE} e WHERE e.employee_id = employees.id "
        f"AND e.event_type IN {_DEPARTURE_TYPES} ORDER BY e.id DESC LIMIT 1"
    )
    op.get_bind().execute(
        sa.text(
            f"UPDATE employees SET duty_unit = ({latest.format(col='e.from_unit')}), "
            f"duty_post = ({latest.format(col='e.from_post')}) "
            f"WHERE status NOT IN {_WORKING} "
            "AND NULLIF(TRIM(COALESCE(duty_unit, '')), '') IS NULL "
            f"AND ({latest.format(col='e.from_unit')}) IS NOT NULL"
        )
    )


def upgrade() -> None:
    _replace_checks(_NEW_EVENT_TYPES, _NEW_ACTOR)
    _backfill_departures()


def downgrade() -> None:
    _restore_departed_locations()
    new_events = f"SELECT id FROM {_TABLE} WHERE event_type IN {_NEW_TYPES}"
    op.execute(
        "UPDATE attendance_cases SET duty_assignment_event_id = NULL "
        f"WHERE duty_assignment_event_id IN ({new_events})"
    )
    op.execute(f"DELETE FROM {_TABLE} WHERE event_type IN {_NEW_TYPES}")
    _replace_checks(_OLD_EVENT_TYPES, _OLD_ACTOR)
