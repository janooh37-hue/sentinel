"""create duty_supervisors + seed verified designation mapping

Revision ID: 0052
Revises: 0051
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0051_backfill_outbound_messages"
branch_labels = None
depends_on = None

# Verified against live data 2026-07-13 (see the Phase 2 spec, §2a seed mapping).
_SEED: list[tuple[str, str]] = [
    ("السرية الأولى", "مسؤول سرية"),
    ("السرية الثانية", "مسؤول سرية"),
    ("السرية الثالثة", "مسؤول سرية"),
    ("السرية الرابعة", "مسؤول سرية"),
    ("السرية الخامسة", "مسؤول سرية"),
    ("الدوام الرسمي", "مدير فرع الخدمات العامة"),
    ("الدوام الرسمي", "مدير مشروع"),
]


def upgrade() -> None:
    op.create_table(
        "duty_supervisors",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("duty_unit", sa.String(length=128), nullable=False),
        sa.Column("recipient_duty_post", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ux_duty_supervisors_unit_post",
        "duty_supervisors",
        ["duty_unit", "recipient_duty_post"],
        unique=True,
    )
    dsv = sa.table(
        "duty_supervisors",
        sa.column("duty_unit", sa.String),
        sa.column("recipient_duty_post", sa.String),
    )
    op.bulk_insert(dsv, [{"duty_unit": u, "recipient_duty_post": p} for u, p in _SEED])


def downgrade() -> None:
    op.drop_index("ux_duty_supervisors_unit_post", table_name="duty_supervisors")
    op.drop_table("duty_supervisors")
