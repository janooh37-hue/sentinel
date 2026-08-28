"""Replace the singleton dashboard layout with one private row per user.

Revision ID: 0079_user_dashboard_layouts
Revises: 0078

Upgrade copies the old ``settings.dashboard_layout`` JSON value to every
existing user before removing the singleton setting and its sidecar column.
Downgrade restores the nullable legacy column but leaves it NULL because
multiple private layouts cannot be collapsed back into one global value.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0079_user_dashboard_layouts"
down_revision: str | Sequence[str] | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_LEGACY_LAYOUT_KEY = "settings.dashboard_layout"


def upgrade() -> None:
    op.create_table(
        "user_dashboard_layouts",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("layout", sa.JSON(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "INSERT INTO user_dashboard_layouts (user_id, layout) "
            "SELECT users.id, app_settings.dashboard_layout "
            "FROM users CROSS JOIN app_settings "
            "WHERE app_settings.key = :key "
            "AND app_settings.dashboard_layout IS NOT NULL"
        ),
        {"key": _LEGACY_LAYOUT_KEY},
    )
    connection.execute(
        sa.text("DELETE FROM app_settings WHERE key = :key"),
        {"key": _LEGACY_LAYOUT_KEY},
    )

    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("dashboard_layout")


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("dashboard_layout", sa.JSON(), nullable=True))

    op.drop_table("user_dashboard_layouts")
