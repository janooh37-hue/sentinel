"""smart_folders + smart_folder_dismissals — per-user saved subject filters

Revision ID: 0055
Revises: 0054

A smart folder is a per-user saved subject filter (no membership). Dismissals
are per-user so one person's dismissal doesn't hide a suggestion from another.
Additive only; downgrade drops both tables.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "smart_folders",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name_en", sa.String(length=128), nullable=False),
        sa.Column("name_ar", sa.String(length=128), nullable=False),
        sa.Column("rule_kind", sa.String(length=32), nullable=False),
        sa.Column("rule_value", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_smart_folders_owner_user_id", "smart_folders", ["owner_user_id"]
    )

    op.create_table(
        "smart_folder_dismissals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("cluster_key", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint(
            "owner_user_id",
            "cluster_key",
            name="uq_smart_folder_dismissals_owner_cluster",
        ),
    )
    op.create_index(
        "ix_smart_folder_dismissals_owner_user_id",
        "smart_folder_dismissals",
        ["owner_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_smart_folder_dismissals_owner_user_id",
        table_name="smart_folder_dismissals",
    )
    op.drop_table("smart_folder_dismissals")
    op.drop_index("ix_smart_folders_owner_user_id", table_name="smart_folders")
    op.drop_table("smart_folders")
