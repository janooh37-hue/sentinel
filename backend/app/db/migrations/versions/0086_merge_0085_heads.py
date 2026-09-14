"""merge inmate violation and vehicle profile heads

Revision ID: 0086_merge_0085_heads
Revises: 0085_inmate_violation_statistics, 0085_vehicle_profile_archive
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0086_merge_0085_heads"
down_revision: str | Sequence[str] | None = (
    "0085_inmate_violation_statistics",
    "0085_vehicle_profile_archive",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
