"""Correspondence employee links and Outlook bridge persistence.

Revision ID: 0078_outlook_correspondence
Revises: 0077_timesheet_roster_assignments
"""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

_MIGRATION_G_NUMBER_RE = re.compile(r"\bG\d{3,4}\b", re.IGNORECASE)


def _migration_g_numbers(text: str) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(match.group(0).upper() for match in _MIGRATION_G_NUMBER_RE.finditer(text))
    )


revision: str = "0078_outlook_correspondence"
down_revision: str | Sequence[str] | None = "0077_timesheet_roster_assignments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "correspondence_employee_links",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "ledger_entry_id",
            sa.Integer(),
            sa.ForeignKey("ledger_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "employee_id",
            sa.String(length=16),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="linked"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="detected"),
        sa.Column(
            "acted_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column(
            "updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint(
            "ledger_entry_id",
            "employee_id",
            name="uq_correspondence_employee_links_entry_employee",
        ),
    )
    op.create_index(
        "ix_correspondence_employee_links_employee_state_entry",
        "correspondence_employee_links",
        ["employee_id", "state", "ledger_entry_id"],
    )
    op.create_index(
        "ix_correspondence_employee_links_entry_state",
        "correspondence_employee_links",
        ["ledger_entry_id", "state"],
    )

    op.create_table(
        "outlook_bridge_devices",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mailbox_address", sa.String(length=320), nullable=False),
        sa.Column("device_label", sa.String(length=128), nullable=False),
        sa.Column("device_credential_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint(
            "device_credential_hash", name="uq_outlook_bridge_devices_credential_hash"
        ),
    )
    op.create_index(
        "ix_outlook_bridge_devices_owner_user_id", "outlook_bridge_devices", ["owner_user_id"]
    )

    op.create_table(
        "outlook_pairings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expected_mailbox", sa.String(length=320), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.UniqueConstraint("token_hash", name="uq_outlook_pairings_token_hash"),
    )
    op.create_index("ix_outlook_pairings_owner_user_id", "outlook_pairings", ["owner_user_id"])

    op.create_table(
        "outlook_handoffs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "owner_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()
        ),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("failure_code", sa.String(length=64), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_outlook_handoffs_token_hash"),
    )
    op.create_index("ix_outlook_handoffs_owner_user_id", "outlook_handoffs", ["owner_user_id"])

    op.create_table(
        "outlook_item_locations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "device_id",
            sa.String(length=64),
            sa.ForeignKey("outlook_bridge_devices.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "correspondence_employee_link_id",
            sa.Integer(),
            sa.ForeignKey("correspondence_employee_links.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("store_id", sa.String(length=512), nullable=False),
        sa.Column("entry_id", sa.String(length=512), nullable=False),
        sa.Column("internet_message_id", sa.String(length=512), nullable=False),
        sa.Column(
            "last_verified_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.current_timestamp(),
        ),
        sa.UniqueConstraint(
            "device_id",
            "correspondence_employee_link_id",
            name="uq_outlook_item_locations_device_link",
        ),
    )
    op.create_index(
        "ix_outlook_item_locations_link_id",
        "outlook_item_locations",
        ["correspondence_employee_link_id"],
    )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "DELETE FROM role_permissions WHERE capability IN "
            "('ledger.view', 'ledger.edit', 'ledger.send')"
        )
    )
    connection.execute(
        sa.text(
            "DELETE FROM user_permissions WHERE capability IN "
            "('ledger.view', 'ledger.edit', 'ledger.send')"
        )
    )
    connection.execute(
        sa.text(
            "INSERT OR IGNORE INTO correspondence_employee_links "
            "(ledger_entry_id, employee_id, state, source) "
            "SELECT id, related_employee_id, 'linked', 'legacy' "
            "FROM ledger_entries WHERE related_employee_id IS NOT NULL"
        )
    )
    employee_ids = set(
        connection.scalars(sa.select(sa.column("id")).select_from(sa.table("employees")))
    )

    for entry_id, subject, notes_html in connection.execute(
        sa.text("SELECT id, subject, notes_html FROM ledger_entries WHERE channel = 'email'")
    ):
        for employee_id in _migration_g_numbers(f"{subject or ''}\n{notes_html or ''}"):
            if employee_id not in employee_ids:
                continue
            connection.execute(
                sa.text(
                    "INSERT OR IGNORE INTO correspondence_employee_links "
                    "(ledger_entry_id, employee_id, state, source) "
                    "VALUES (:entry_id, :employee_id, 'linked', 'detected')"
                ),
                {"entry_id": entry_id, "employee_id": employee_id},
            )

    for entry_id, raw_text in connection.execute(
        sa.text(
            "SELECT ledger_entry_id, raw_text FROM scan_inbox "
            "WHERE source = 'email_attachment' AND ledger_entry_id IS NOT NULL"
        )
    ):
        for employee_id in _migration_g_numbers(raw_text or ""):
            if employee_id not in employee_ids:
                continue
            connection.execute(
                sa.text(
                    "INSERT OR IGNORE INTO correspondence_employee_links "
                    "(ledger_entry_id, employee_id, state, source) "
                    "VALUES (:entry_id, :employee_id, 'linked', 'detected')"
                ),
                {"entry_id": entry_id, "employee_id": employee_id},
            )


def downgrade() -> None:
    op.drop_index("ix_outlook_item_locations_link_id", table_name="outlook_item_locations")
    op.drop_table("outlook_item_locations")
    op.drop_index("ix_outlook_handoffs_owner_user_id", table_name="outlook_handoffs")
    op.drop_table("outlook_handoffs")
    op.drop_index("ix_outlook_pairings_owner_user_id", table_name="outlook_pairings")
    op.drop_table("outlook_pairings")
    op.drop_index("ix_outlook_bridge_devices_owner_user_id", table_name="outlook_bridge_devices")
    op.drop_table("outlook_bridge_devices")
    op.drop_index(
        "ix_correspondence_employee_links_entry_state",
        table_name="correspondence_employee_links",
    )
    op.drop_index(
        "ix_correspondence_employee_links_employee_state_entry",
        table_name="correspondence_employee_links",
    )
    op.drop_table("correspondence_employee_links")
