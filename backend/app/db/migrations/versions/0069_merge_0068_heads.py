"""merge 0068 heads

Two migrations were numbered 0068 on separate branches (record-included-papers
and the PDF-only documents change); both revised 0067, which left a split head
and made `alembic upgrade head` refuse to run.

Revision ID: 0069_merge
Revises: 0068, 0068_record_included_papers
Create Date: 2026-08-11 10:38:16.425215
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0069_merge"
down_revision: str | Sequence[str] | None = ("0068", "0068_record_included_papers")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
