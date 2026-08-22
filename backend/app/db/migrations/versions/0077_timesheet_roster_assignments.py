"""decouple time-sheet roster assignments

Revision ID: 0077_timesheet_roster_assignments
Revises: 0076_timesheet_start_acks
Create Date: 2026-08-22 00:00:00.000000

Time-sheet designations are effective-dated employee assignments rather than a
single mutable employee property. Existing links are preserved as assignments
effective on 2026-01-01; the downgrade restores the latest representable link.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0077_timesheet_roster_assignments"
down_revision: str | Sequence[str] | None = "0076_timesheet_start_acks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

BUILTIN_KEYS = (
    ("Prisons Director", "prisons_director"),
    ("Ass. Director", "assistant_director"),
    ("Project Manager", "project_manager"),
    ("Branche Manager", "branch_manager"),
    ("Duty In charge", "duty_in_charge"),
    ("Security Supervisor", "security_supervisor"),
    ("Armory Officer", "armory_officer"),
    ("assistant security supervisor", "assistant_security_supervisor"),
    ("Armory Keeper", "armory_keeper"),
    ("Control room Security Guard", "control_room_security_guard"),
    ("Clinic Security Guard", "clinic_security_guard"),
    ("Habilitation Security Guard", "habilitation_security_guard"),
    ("Escort Security Guard", "escort_security_guard"),
    ("Messengers", "messengers"),
    ("Security Guard", "security_guard"),
    ("Driver", "driver"),
)


def upgrade() -> None:
    op.add_column(
        "timesheet_designations",
        sa.Column("system_key", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ux_timesheet_designations_system_key",
        "timesheet_designations",
        ["system_key"],
        unique=True,
    )

    connection = op.get_bind()
    for name_en, system_key in BUILTIN_KEYS:
        connection.execute(
            sa.text(
                "UPDATE timesheet_designations "
                "SET system_key = :system_key "
                "WHERE name_en = :name_en"
            ),
            {"system_key": system_key, "name_en": name_en},
        )

    op.create_table(
        "timesheet_roster_assignments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id"),
            nullable=False,
        ),
        sa.Column(
            "designation_id",
            sa.Integer(),
            sa.ForeignKey("timesheet_designations.id"),
            nullable=True,
        ),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column(
            "assigned_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("assigned_by", sa.Integer(), nullable=True),
        sa.UniqueConstraint(
            "employee_id",
            "effective_from",
            name="uq_timesheet_roster_assignment_effective",
        ),
    )
    op.create_index(
        "ix_timesheet_roster_assignment_effective",
        "timesheet_roster_assignments",
        ["effective_from"],
    )

    op.execute(
        sa.text(
            "INSERT INTO timesheet_roster_assignments "
            "(employee_id, designation_id, effective_from, assigned_at) "
            "SELECT id, designation_id, '2026-01-01', CURRENT_TIMESTAMP "
            "FROM employees WHERE designation_id IS NOT NULL"
        )
    )

    with op.batch_alter_table("employees") as batch:
        batch.drop_column("designation_id")


def downgrade() -> None:
    op.add_column("employees", sa.Column("designation_id", sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE employees "
            "SET designation_id = ("
            "SELECT designation_id FROM timesheet_roster_assignments "
            "WHERE timesheet_roster_assignments.employee_id = employees.id "
            "ORDER BY effective_from DESC LIMIT 1"
            ") "
            "WHERE EXISTS ("
            "SELECT 1 FROM timesheet_roster_assignments "
            "WHERE timesheet_roster_assignments.employee_id = employees.id"
            ")"
        )
    )

    op.drop_index(
        "ix_timesheet_roster_assignment_effective",
        table_name="timesheet_roster_assignments",
    )
    op.drop_table("timesheet_roster_assignments")
    op.drop_index("ux_timesheet_designations_system_key", table_name="timesheet_designations")
    with op.batch_alter_table("timesheet_designations") as batch:
        batch.drop_column("system_key")
