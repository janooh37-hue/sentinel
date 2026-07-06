"""Add scan_inbox.candidates (ranked employee near-misses for triage chips).

Revision ID: 0047_scan_inbox_candidates
Revises: 0046_employee_passport_no_source
Create Date: 2026-07-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0047_scan_inbox_candidates"
down_revision: str | Sequence[str] | None = "0046_employee_passport_no_source"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("scan_inbox", sa.Column("candidates", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("scan_inbox", "candidates")
