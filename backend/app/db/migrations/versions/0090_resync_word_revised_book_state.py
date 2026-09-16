"""Resync book state after unsigned Word revisions.

Revision ID: 0090_resync_word_revised_book_state
Revises: 0089_book_revision_access
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0090_resync_word_revised_book_state"
down_revision = "0089_book_revision_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE books
            SET approval_state = 'none',
                submitted_by_user_id = NULL
            WHERE approval_state = 'approved'
              AND ref_number NOT LIKE 'REPORT-%'
              AND deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM book_versions AS latest
                  WHERE latest.book_id = books.id
                    AND latest.version_no = (
                        SELECT MAX(candidate.version_no)
                        FROM book_versions AS candidate
                        WHERE candidate.book_id = books.id
                    )
                    AND latest.version_no > 1
                    AND latest.status = 'none'
                    AND latest.signed_pdf_path IS NULL
                    AND latest.manager_sig_embedded = 0
              )
            """
        )
    )


def downgrade() -> None:
    """The derived state is idempotent and cannot be reversed safely."""
