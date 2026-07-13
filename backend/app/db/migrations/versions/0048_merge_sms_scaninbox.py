"""merge sms_message_body + scan_inbox_candidates heads

Revision ID: 0048_merge_sms_scaninbox
Revises: 0047_scan_inbox_candidates, 0047_sms_message_body
Create Date: 2026-07-06 13:05:18.641510
"""
from __future__ import annotations

from collections.abc import Sequence

revision: str = '0048_merge_sms_scaninbox'
down_revision: str | Sequence[str] | None = ('0047_scan_inbox_candidates', '0047_sms_message_body')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
