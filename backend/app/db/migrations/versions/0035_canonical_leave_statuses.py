"""Canonicalize leave statuses for per-kind lifecycles.

Revision ID: 0035_canonical_leave_statuses
Revises: 0034_forms_signing_paths
Create Date: 2026-06-12

- Bilingual v3 labels collapse to the English half.
- 'Generated' is retired: those rows are historical facts -> 'Approved'
  (anything cancelled in the old system was deleted, not flagged).
- Kinds with no approval flow (sick + record kinds) cannot sit in 'Pending';
  stragglers become 'Approved'.

Data-only; downgrade is a no-op (the bilingual/Generated information is
intentionally discarded).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0035_canonical_leave_statuses"
down_revision: str | Sequence[str] | None = "0034_forms_signing_paths"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE leaves SET status='Pending' WHERE status LIKE 'Pending%'")
    op.execute(
        "UPDATE leaves SET status='Approved' "
        "WHERE status LIKE 'Approved%' OR status LIKE 'Generated%'"
    )
    op.execute("UPDATE leaves SET status='Rejected' WHERE status LIKE 'Rejected%'")
    op.execute(
        "UPDATE leaves SET status='Approved' WHERE status='Pending' AND ("
        "leave_type LIKE 'Sick%' OR leave_type LIKE 'Administrative Leave%' "
        "OR leave_type LIKE 'Leave Permit%' OR leave_type LIKE 'Passport Release%' "
        "OR leave_type LIKE 'Duty Resumption%')"
    )


def downgrade() -> None:
    pass
