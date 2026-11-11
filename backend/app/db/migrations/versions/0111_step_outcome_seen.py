"""Reconcile both historical 0110 branches without replaying outcome backfill.

Revision ID: 0111_step_outcome_seen
Revises: 0110_employee_statement_prints, 0110_step_outcome_seen

PR #273 renamed the already-merged outcome revision to this ID. Retain both
identities: databases at 0111 (or its store descendants) already have the
original outcome schema; databases at either 0110 must apply only the missing
branch. The original 0110 owns the column, backfill and inverse. This merge
must not acknowledge newer unread decisions or remove the shared column.
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0111_step_outcome_seen"
down_revision: str | Sequence[str] | None = (
    "0110_employee_statement_prints",
    "0110_step_outcome_seen",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
