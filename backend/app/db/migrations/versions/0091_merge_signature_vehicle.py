"""merge signature placement and vehicle certificate heads

Revision ID: 0091_merge_signature_vehicle
Revises: 0090_signature_placement, 0090_vehicle_certificates

This merge revision joins the two migrations that independently descended from
0089_vehicle_fines_ledger. It intentionally performs no schema operations.
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0091_merge_signature_vehicle"
down_revision: str | Sequence[str] | None = (
    "0090_signature_placement",
    "0090_vehicle_certificates",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
