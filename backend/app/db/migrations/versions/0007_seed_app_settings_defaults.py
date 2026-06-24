"""Seed default app settings rows.

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-20

Uses ``INSERT OR IGNORE`` semantics so re-running on an existing DB is a no-op
(existing user customisations are preserved).

Defaults seeded:
  settings.stamp_style       → "Header Text (Ref: XX-0000)"
  settings.theme             → "light"
  settings.language          → "en"
  settings.font_scale        → "md"
  settings.manager_hand_sign_default → false

Nullable defaults (sig paths, default_manager_id) are intentionally not seeded
— their absence is treated as NULL by the service layer.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULTS = [
    ("settings.stamp_style", "Header Text (Ref: XX-0000)"),
    ("settings.theme", "light"),
    ("settings.language", "en"),
    ("settings.font_scale", "md"),
    ("settings.manager_hand_sign_default", False),
]


def upgrade() -> None:
    conn = op.get_bind()
    for key, value in _DEFAULTS:
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO app_settings (key, value) VALUES (:key, :value)"
            ),
            {"key": key, "value": json.dumps(value)},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for key, _ in _DEFAULTS:
        conn.execute(
            sa.text("DELETE FROM app_settings WHERE key = :key"),
            {"key": key},
        )
