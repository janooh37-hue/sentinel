"""Add employees.passport_no_source provenance column.

Records how passport_no was set: 'mrz' (auto OCR of a validated MRZ) or
'manual' (operator PATCH). NULL when unset. See spec 2026-07-02-passport-ocr.

Revision ID: 0046_employee_passport_no_source
Revises: 0045_leave_dedupe_index
Create Date: 2026-07-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0046_employee_passport_no_source"
down_revision: str | Sequence[str] | None = "0045_leave_dedupe_index"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column("passport_no_source", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("employees", "passport_no_source")
