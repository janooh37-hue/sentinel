"""email_accounts table — IMAP credentials for ledger auto-import.

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-21

Single-row table (id=1 by convention) holding the operator's IMAP details.
``password_encrypted`` is Fernet ciphertext; the symmetric key lives at
``<data_dir>/.email_key`` outside the DB so a stolen backup file alone can't
recover the password.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | Sequence[str] | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_accounts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("email", sa.String(256), nullable=False),
        sa.Column("imap_host", sa.String(256), nullable=False),
        sa.Column("imap_port", sa.Integer(), nullable=False, server_default="993"),
        sa.Column("use_ssl", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("username", sa.String(256), nullable=False),
        sa.Column("password_encrypted", sa.Text(), nullable=False),
        sa.Column("sent_folder", sa.String(64), nullable=False, server_default="Sent"),
        sa.Column("inbox_folder", sa.String(64), nullable=False, server_default="INBOX"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("last_sync_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("email_accounts")
