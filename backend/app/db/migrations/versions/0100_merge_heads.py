"""Merge 0098_book_send_state and 0099_inmate_violations_category heads.

Revision ID: 0100_merge_heads
Revises: 0098_book_send_state, 0099_inmate_violations_category
"""

from collections.abc import Sequence

revision: str = "0100_merge_heads"
down_revision: str | Sequence[str] | None = (
    "0098_book_send_state",
    "0099_inmate_violations_category",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
