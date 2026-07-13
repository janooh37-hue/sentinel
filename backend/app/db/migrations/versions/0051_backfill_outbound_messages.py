"""Backfill outbound_messages from legacy sms_messages + whatsapp_messages.

Revision ID: 0051_backfill_outbound_messages
Revises: 0050_outbound_messages
Create Date: 2026-07-13

Copies every legacy row into the unified log, channel-stamped, so the single
badge shows full history. Legacy tables are left intact.

Downgrade deletes all rows from outbound_messages. SQLite provides no reliable
per-row marker that would let the downgrade delete only the backfilled rows while
preserving later ones, so the simplest safe operation is a full table truncation.
This is safe within the 0050→0051 migration pair because 0050 created the table
empty — a downgrade immediately after upgrade loses nothing that was not just
inserted. However, rolling back 0051 on a live database that has since accumulated
new outbound_messages rows will delete those rows too; treat this migration as
effectively one-way in production.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0051_backfill_outbound_messages"
down_revision: str | Sequence[str] | None = "0050_outbound_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    # SMS → outbound (has body + delivery_state + delivery_checked_at)
    conn.exec_driver_sql(
        """
        INSERT INTO outbound_messages
          (employee_id,event_type,event_ref,language,phone,channel,status,
           delivery_state,delivery_checked_at,fell_back,attempts,
           provider_msg_id,error,body,sent_by,created_at)
        SELECT employee_id,event_type,event_ref,language,phone,'sms',status,
               delivery_state,delivery_checked_at,0,0,
               provider_msg_id,error,body,sent_by,created_at
        FROM sms_messages
        """
    )
    # WhatsApp (Infobip) → outbound (no body/delivery_state/delivery_checked_at columns)
    conn.exec_driver_sql(
        """
        INSERT INTO outbound_messages
          (employee_id,event_type,event_ref,language,phone,channel,status,
           fell_back,attempts,provider_msg_id,error,sent_by,created_at)
        SELECT employee_id,event_type,event_ref,language,phone,'whatsapp',status,
               0,0,provider_msg_id,error,sent_by,created_at
        FROM whatsapp_messages
        """
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DELETE FROM outbound_messages")
