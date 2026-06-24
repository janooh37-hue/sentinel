"""font_scale enum to int

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-22

Phase 17 — TAMM redesign. The ``settings.font_scale`` AppSetting used to be a
three-step enum (``"sm"``/``"md"``/``"lg"``); it's now a 7-step integer
(13..19) so the Settings UI can offer a finer-grained sizing slider.

This migration walks the existing ``app_settings`` row (if any) and maps the
legacy JSON-encoded enum value to its integer equivalent.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | Sequence[str] | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Mapping from JSON-encoded legacy value -> JSON-encoded integer.
MAPPING = {'"sm"': "13", '"md"': "15", '"lg"': "18"}


def upgrade() -> None:
    conn = op.get_bind()
    row = conn.execute(
        sa.text("SELECT value FROM app_settings WHERE key='settings.font_scale'")
    ).fetchone()
    if row is None:
        return
    raw = row[0]
    if raw in MAPPING:
        conn.execute(
            sa.text("UPDATE app_settings SET value=:v WHERE key='settings.font_scale'"),
            {"v": MAPPING[raw]},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE app_settings SET value='\"md\"' WHERE key='settings.font_scale'")
    )
