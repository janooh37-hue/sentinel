"""merge approvals-flow and signature/vehicle heads

Revision ID: 0092_merge_approvals_flow
Revises: 0090_resync_word_revised_book_state, 0091_merge_signature_vehicle

This merge revision joins the revision-scoped approvals chain
(0089_book_revision_access -> 0090_resync_word_revised_book_state) with the
signature-placement / vehicle-certificate chain merged in 0091. It
intentionally performs no schema operations.
"""

from __future__ import annotations

from collections.abc import Sequence

revision: str = "0092_merge_approvals_flow"
down_revision: str | Sequence[str] | None = (
    "0090_resync_word_revised_book_state",
    "0091_merge_signature_vehicle",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
