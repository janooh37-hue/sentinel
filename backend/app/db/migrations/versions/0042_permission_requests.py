from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0042_permission_requests"
down_revision: str | Sequence[str] | None = "0041_push_notify_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_permissions", sa.Column("expires_at", sa.DateTime(), nullable=True))
    op.create_table(
        "permission_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("decision", sa.String(length=16), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("decided_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_permission_requests_user_id", "permission_requests", ["user_id"])
    op.create_index("ix_permission_requests_status", "permission_requests", ["status"])


def downgrade() -> None:
    op.drop_index("ix_permission_requests_status", table_name="permission_requests")
    op.drop_index("ix_permission_requests_user_id", table_name="permission_requests")
    op.drop_table("permission_requests")
    op.drop_column("user_permissions", "expires_at")
