"""timesheet statistics quotas: billed posts per designation, frozen position

Revision ID: 0116_timesheet_statistics_quotas
Revises: 0115_employee_statement_prints

The client statistics bill a fixed number of posts per designation, split by
nationality: posts for U.A.E nationals and posts for Arab nationals of other
countries. Holders fill their own posts first; gaps are filled from spare
Security Guards one grade up at most; everyone else prints below the line.

* ``timesheet_designations.quota_uae`` / ``quota_arab`` — the billed posts.
* ``timesheet_designations.quota_fill`` — who fills them: ``own`` holders only,
  ``own_then_guards`` (gaps from spare Security Guards), or ``guards_only``
  (spare Security Guards only; the holders themselves are company-paid).
* ``timesheet_snapshot_rows.stat_row_no`` — the frozen statistics position.
  Nullable: rows sealed before this revision were printed in attendance order,
  which their ``row_no`` already records.

The quotas are backfilled with the contract the finance office confirmed on
2026-10-29 (249 billed posts), keyed by the catalog's stable ``system_key``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0116_timesheet_statistics_quotas"
down_revision: str | Sequence[str] | None = "0115_employee_statement_prints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: system_key -> (quota_uae, quota_arab, quota_fill). Frozen here on purpose: a
#: migration must not read app constants that may change after it ships.
_CONTRACT: dict[str, tuple[int, int, str]] = {
    "prisons_director": (1, 0, "own"),
    "assistant_director": (1, 0, "own"),
    "project_manager": (1, 0, "own"),
    "branch_manager": (4, 0, "own"),
    "duty_in_charge": (4, 0, "own"),
    "security_supervisor": (7, 0, "own"),
    "armory_officer": (4, 0, "own"),
    "assistant_security_supervisor": (20, 0, "own"),
    "armory_keeper": (4, 0, "own_then_guards"),
    "control_room_security_guard": (48, 0, "own_then_guards"),
    "clinic_security_guard": (0, 8, "own"),
    "habilitation_security_guard": (0, 4, "guards_only"),
    "escort_security_guard": (0, 10, "guards_only"),
    "messengers": (40, 0, "own_then_guards"),
    "security_guard": (55, 38, "own_then_guards"),
}


def upgrade() -> None:
    with op.batch_alter_table("timesheet_designations") as batch:
        batch.add_column(
            sa.Column("quota_uae", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )
        batch.add_column(
            sa.Column("quota_arab", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )
        batch.add_column(
            sa.Column("quota_fill", sa.String(16), nullable=False, server_default="own")
        )
        batch.create_check_constraint(
            "ck_timesheet_desig_quota",
            "quota_uae >= 0 AND quota_arab >= 0 "
            "AND quota_fill IN ('own', 'own_then_guards', 'guards_only')",
        )
    designations = sa.table(
        "timesheet_designations",
        sa.column("system_key", sa.String),
        sa.column("quota_uae", sa.Integer),
        sa.column("quota_arab", sa.Integer),
        sa.column("quota_fill", sa.String),
    )
    for system_key, (uae, arab, fill) in _CONTRACT.items():
        op.execute(
            designations.update()
            .where(designations.c.system_key == system_key)
            .values(quota_uae=uae, quota_arab=arab, quota_fill=fill)
        )

    with op.batch_alter_table("timesheet_snapshot_rows") as batch:
        batch.add_column(sa.Column("stat_row_no", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("timesheet_snapshot_rows") as batch:
        batch.drop_column("stat_row_no")

    with op.batch_alter_table("timesheet_designations") as batch:
        batch.drop_constraint("ck_timesheet_desig_quota", type_="check")
        batch.drop_column("quota_fill")
        batch.drop_column("quota_arab")
        batch.drop_column("quota_uae")
