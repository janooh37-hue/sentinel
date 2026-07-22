"""security permits — permit_vehicles table + permit_people.id_doc_path.

Revision ID: 0060
Revises: 0059
Create Date: 2026-07-21

Extends permits beyond people:

1. ``permit_people.id_doc_path`` — nullable path to a scan of the person's
   UAE ID card.
2. ``permit_vehicles`` — vehicles authorized on a permit (plate + optional
   make/model/driver) with an optional ``license_doc_path`` scan of the
   vehicle licence (mulkiya). Soft-removed via ``removed_at`` like people.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0060"
down_revision: str | Sequence[str] | None = "0059"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("permit_people") as batch:
        batch.add_column(sa.Column("id_doc_path", sa.Text(), nullable=True))

    op.create_table(
        "permit_vehicles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "permit_id",
            sa.Integer(),
            sa.ForeignKey("permits.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("plate_no", sa.String(32), nullable=False),
        sa.Column("plate_emirate", sa.String(32), nullable=True),
        sa.Column("make_model", sa.String(128), nullable=True),
        sa.Column("driver_name", sa.String(255), nullable=True),
        sa.Column("license_doc_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("removed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_permit_vehicles_permit", "permit_vehicles", ["permit_id"])


def downgrade() -> None:
    op.drop_index("ix_permit_vehicles_permit", table_name="permit_vehicles")
    op.drop_table("permit_vehicles")
    with op.batch_alter_table("permit_people") as batch:
        batch.drop_column("id_doc_path")
