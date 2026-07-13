"""Backfill outbound_messages from legacy sms_messages + whatsapp_messages.

Revision ID: 0051_backfill_outbound_messages
Revises: 0050_outbound_messages
Create Date: 2026-07-13

Copies every legacy row into the unified log, channel-stamped, so the single
badge shows full history. Legacy tables are left intact. Downgrade deletes only
the backfilled rows (attempts=0 AND created from legacy — identified by a marker
is unavailable on SQLite; downgrade instead truncates outbound_messages, which is
safe because 0050 created it empty in this chain).
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
