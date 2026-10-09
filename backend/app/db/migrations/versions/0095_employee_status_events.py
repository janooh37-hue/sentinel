"""employee status events + transfer fields

Adds ``employees.transfer_site`` / ``employees.transfer_return_date``, the
append-only ``employee_status_events`` history table, and backfills one
``imported`` event per employee who is already non-Active.

Revision ID: 0095_employee_status_events
Revises: 0094_book_created_by
Create Date: 2026-10-05 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time

import sqlalchemy as sa
from alembic import op

revision: str = "0095_employee_status_events"
down_revision: str | Sequence[str] | None = "0094_book_created_by"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _parse_date(value: object) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        # A malformed legacy value must not abort the upgrade.
        return None


def upgrade() -> None:
    with op.batch_alter_table("employees") as batch_op:
        batch_op.add_column(sa.Column("transfer_site", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("transfer_return_date", sa.Date(), nullable=True))

    events = op.create_table(
        "employee_status_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(length=32), nullable=False),
        sa.Column("to_status", sa.String(length=32), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("site", sa.String(length=128), nullable=True),
        sa.Column("return_date", sa.Date(), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_employee_status_events_employee_created",
        "employee_status_events",
        ["employee_id", "created_at"],
    )

    # One `imported` row per employee already off the roster. Naive UTC, to
    # match models._utcnow. `created_at` is the departure date (midnight) when
    # known, so these rows sit at the right point in the Activity timeline
    # instead of all appearing as "just now".
    now = datetime.now(UTC).replace(tzinfo=None)
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, status, end_date FROM employees WHERE status != 'Active'")
    ).all()
    if rows:
        op.bulk_insert(
            events,
            [
                {
                    "employee_id": r.id,
                    "from_status": "Active",
                    "to_status": r.status,
                    "effective_date": _parse_date(r.end_date),
                    "site": None,
                    "return_date": None,
                    "kind": "imported",
                    "source": "backfill",
                    "actor_user_id": None,
                    "created_at": (
                        datetime.combine(d, time.min) if (d := _parse_date(r.end_date)) else now
                    ),
                }
                for r in rows
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_employee_status_events_employee_created", table_name="employee_status_events")
    op.drop_table("employee_status_events")
    with op.batch_alter_table("employees") as batch_op:
        batch_op.drop_column("transfer_return_date")
        batch_op.drop_column("transfer_site")
