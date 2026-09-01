"""Add Outlook drafts-folder configuration and enable sent-email logging.

Revision ID: 0083_outlook_handoff
Revises: 0082_service_records_caps
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0083_outlook_handoff"
down_revision: str | Sequence[str] | None = "0082_service_records_caps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column("drafts_folder", sa.String(64), nullable=False, server_default="Drafts")
        )

    op.execute("UPDATE correspondence_rules SET enabled = 1 WHERE trigger = 'email_sent'")


def downgrade() -> None:
    op.execute("UPDATE correspondence_rules SET enabled = 0 WHERE trigger = 'email_sent'")

    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("drafts_folder")
