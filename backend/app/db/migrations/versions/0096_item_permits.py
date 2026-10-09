"""item permits — the item-entry (إدخال مواد) register.

Revision ID: 0096_item_permits
Revises: 0095_employee_status_events
Create Date: 2026-10-06 00:00:00.000000

One table: each row is a 1/5 letter authorizing materials into a facility zone,
naming the employee who brings them. ``book_id`` / ``manager_id`` mirror
``permits`` (no FK). Soft-deleted via ``deleted_at``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0096_item_permits"
down_revision: str | Sequence[str] | None = "0095_employee_status_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "item_permits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=False),
        sa.Column("recipient", sa.String(255), nullable=False),
        sa.Column("zone", sa.String(8), nullable=False),
        sa.Column("site", sa.String(255), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("manager_id", sa.Integer(), nullable=True),
        sa.Column("book_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("zone IN ('red', 'green')", name="ck_item_permits_zone"),
    )
    op.create_index("ix_item_permits_employee", "item_permits", ["employee_id"])


def downgrade() -> None:
    op.drop_index("ix_item_permits_employee", table_name="item_permits")
    op.drop_table("item_permits")
