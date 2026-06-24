"""Ledger→Outlook Phase 2: per-user address book.

Revision ID: 0031_address_book_contacts
Revises: 0030_ledger_per_user_mailboxes
Create Date: 2026-06-07

New ``address_book_contacts`` table — saved compose contacts, scoped per
signed-in user. ``owner_user_id`` carries no DB-level FK (app-side integrity,
mirrors the Phase-1 owner columns). UNIQUE (owner_user_id, address) makes a
contact unique per owner; the service upserts on that key. Brand-new empty
table — no backfill.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_address_book_contacts"
down_revision: str | Sequence[str] | None = "0030_ledger_per_user_mailboxes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "address_book_contacts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=False, server_default=""),
        sa.Column("address", sa.String(320), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "owner_user_id", "address", name="uq_address_book_owner_address"
        ),
    )
    op.create_index(
        "ix_address_book_contacts_owner_user_id",
        "address_book_contacts",
        ["owner_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_address_book_contacts_owner_user_id", table_name="address_book_contacts"
    )
    op.drop_table("address_book_contacts")
