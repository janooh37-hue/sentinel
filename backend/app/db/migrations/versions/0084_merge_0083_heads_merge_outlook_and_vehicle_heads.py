"""merge outlook and vehicle heads

Revision ID: 0084_merge_0083_heads
Revises: 0083_outlook_handoff, 0083_vehicles
Create Date: 2026-09-03 11:50:58.738959
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0084_merge_0083_heads"
down_revision: str | Sequence[str] | None = ("0083_outlook_handoff", "0083_vehicles")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
