"""security permits — permits, permit_people, permit_visits tables.

Revision ID: 0058
Revises: 0057
Create Date: 2026-07-21

A greenfield feature: a register of physical security-zone entry permits.
Each permit authorizes a company's contractor personnel to enter the green
and/or red zone for a window (start_date..end_date). No v3 parity requirement.

Naming note: this is unrelated to the ``permissions`` / RBAC tables (those are
app-access capabilities). Domain here is "permits" throughout.

Three tables:

1. ``permits`` — the permit header (company, zone, window, lifecycle status).
   ``permit_no`` is stamped after insert as ``PMT-0001``; a partial unique
   index enforces uniqueness across live (non-deleted) rows.
2. ``permit_people`` — contractor personnel on a permit (free-text identity,
   soft-removed via ``removed_at`` so amendment history survives).
3. ``permit_visits`` — the forward hook for a future gate / UAE-ID scanner.
   No UI in v1; kept so a gate integration is a drop-in later.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0058"
down_revision: str | Sequence[str] | None = "0057"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "permits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("permit_no", sa.String(32), nullable=True),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("zone", sa.String(8), nullable=False, server_default="green"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoke_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_permits_status_end", "permits", ["status", "end_date"])
    op.create_index("ix_permits_company", "permits", ["company"])
    op.create_index(
        "ux_permits_permit_no",
        "permits",
        ["permit_no"],
        unique=True,
        sqlite_where=sa.text("permit_no IS NOT NULL AND deleted_at IS NULL"),
    )

    op.create_table(
        "permit_people",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "permit_id",
            sa.Integer(),
            sa.ForeignKey("permits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("uae_id", sa.String(32), nullable=True),
        sa.Column("nationality", sa.String(64), nullable=True),
        sa.Column("role", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_permit_people_permit", "permit_people", ["permit_id"])

    op.create_table(
        "permit_visits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "permit_id",
            sa.Integer(),
            sa.ForeignKey("permits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "person_id",
            sa.Integer(),
            sa.ForeignKey("permit_people.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("direction", sa.String(4), nullable=False, server_default="in"),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("uae_id", sa.String(32), nullable=True),
        sa.Column("gate", sa.String(64), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_permit_visits_permit_occurred",
        "permit_visits",
        ["permit_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_permit_visits_permit_occurred", table_name="permit_visits")
    op.drop_table("permit_visits")
    op.drop_index("ix_permit_people_permit", table_name="permit_people")
    op.drop_table("permit_people")
    op.drop_index("ux_permits_permit_no", table_name="permits")
    op.drop_index("ix_permits_company", table_name="permits")
    op.drop_index("ix_permits_status_end", table_name="permits")
    op.drop_table("permits")
