"""ledger_entries: read_at + app_settings: dashboard_layout JSON.

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-22

Two additive, nullable columns powering the dashboard polish pass:

* ``ledger_entries.read_at`` (nullable ``DateTime``) — NULL == unread. Drives
  the numeric NavBell badge for incoming email; only mutated by the explicit
  ``mark-read`` / ``mark-all-read`` endpoints (no backfill on upgrade).
* ``app_settings.dashboard_layout`` (nullable ``JSON``) — operator-specified
  widget visibility + ordering. NULL means "use the bundled defaults"; the
  pydantic schema (``DashboardLayout``) shapes the payload at the API edge.

The original ``app_settings`` schema is a key/value table (``key``, ``value``)
storing every setting as JSON-encoded text under its own key. Adding a column
here is a deliberate divergence from that pattern: ``dashboard_layout`` is a
large structured payload that does not need the per-row key/value indirection
the rest of the settings use. The settings service handles serialisation.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | Sequence[str] | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("ledger_entries") as batch:
        batch.add_column(sa.Column("read_at", sa.DateTime(), nullable=True))

    with op.batch_alter_table("app_settings") as batch:
        batch.add_column(sa.Column("dashboard_layout", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("dashboard_layout")

    with op.batch_alter_table("ledger_entries") as batch:
        batch.drop_column("read_at")
