"""merge heads

Revision ID: 0080_merge_dashboard_idle_lock
Revises: 0079_user_dashboard_layouts, 0079_user_idle_lock
Create Date: 2026-08-29 06:42:55.585143
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '0080_merge_dashboard_idle_lock'
down_revision: str | Sequence[str] | None = ('0079_user_dashboard_layouts', '0079_user_idle_lock')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
