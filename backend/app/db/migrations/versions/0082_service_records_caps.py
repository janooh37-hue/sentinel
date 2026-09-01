"""Mirror service permission overrides to service-record capabilities.

Revision ID: 0082_service_records_caps
Revises: 0081_user_lock_layout
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0082_service_records_caps"
down_revision: str | Sequence[str] | None = "0081_user_lock_layout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
            "SELECT up.user_id, "
            "'books.servicerecords.' || "
            "substr(up.capability, length('books.service.') + 1), "
            "up.effect, up.expires_at "
            "FROM user_permissions AS up "
            "WHERE up.capability LIKE 'books.service.%' "
            "AND up.capability NOT LIKE 'books.servicerecords.%' "
            "AND NOT EXISTS ("
            "SELECT 1 FROM user_permissions AS existing "
            "WHERE existing.user_id = up.user_id "
            "AND existing.capability = 'books.servicerecords.' || "
            "substr(up.capability, length('books.service.') + 1)"
            ")"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "DELETE FROM user_permissions "
            "WHERE capability LIKE 'books.servicerecords.%'"
        )
    )
