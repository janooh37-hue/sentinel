"""email_accounts: SMTP fields for outgoing send.

Revision ID: 0010
Revises: 0009
Create Date: 2026-05-21

Adds ``smtp_host``, ``smtp_port``, ``smtp_use_tls`` so the same account row
can both fetch (IMAP) and send (SMTP). The SMTP password defaults to the IMAP
password unless the operator overrides it later (deferred — same Fernet blob
is reused).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | Sequence[str] | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.add_column(
            sa.Column("smtp_host", sa.String(256), nullable=False, server_default="smtp.ionos.com")
        )
        batch.add_column(
            sa.Column("smtp_port", sa.Integer(), nullable=False, server_default="587")
        )
        batch.add_column(
            sa.Column(
                "smtp_use_tls",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("1"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("email_accounts") as batch:
        batch.drop_column("smtp_use_tls")
        batch.drop_column("smtp_port")
        batch.drop_column("smtp_host")
