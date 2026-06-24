"""ledger_entries: index related_employee_id + related_book_id.

Revision ID: 0027_ledger_related_indexes
Revises: 0026_book_annotations
Create Date: 2026-06-01

The ledger list endpoint filters on ``related_employee_id`` and
``related_book_id`` (smart-link deep-links), but neither FK column carried an
index — every filtered list did a full table scan. These two indexes back
those filters.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0027_ledger_related_indexes"
down_revision: str | Sequence[str] | None = "0026_book_annotations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_ledger_entries_related_employee_id",
        "ledger_entries",
        ["related_employee_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_ledger_entries_related_book_id",
        "ledger_entries",
        ["related_book_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ledger_entries_related_book_id",
        table_name="ledger_entries",
        if_exists=True,
    )
    op.drop_index(
        "ix_ledger_entries_related_employee_id",
        table_name="ledger_entries",
        if_exists=True,
    )
