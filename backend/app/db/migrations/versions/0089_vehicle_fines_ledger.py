"""Convert vehicle fine amounts to fils and add payment/receipt/archive state.

Revision ID: 0089_vehicle_fines_ledger
Revises: 0088_inmate_statistics_workflow

Historical fines never tracked whether they were paid: they become
``unknown`` (displayed as "payment not recorded") rather than joining either
the paid or unpaid totals until staff classify them. A fine created after
this migration always starts ``unpaid``.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0089_vehicle_fines_ledger"
down_revision = "0088_inmate_statistics_workflow"
branch_labels = None
depends_on = None

# SQLite's INTEGER column is a signed 64-bit value; a legacy whole-AED amount
# must survive an exact x100 conversion to fils without overflowing it.
_MAX_LEGACY_AED = (2**63 - 1) // 100


def upgrade() -> None:
    conn = op.get_bind()
    bad = conn.execute(
        sa.text(
            "SELECT id, amount, amount_after_discount FROM vehicle_fines "
            "WHERE typeof(amount) != 'integer' "
            "OR (amount_after_discount IS NOT NULL AND typeof(amount_after_discount) != 'integer') "
            "OR amount > :max_aed "
            "OR (amount_after_discount IS NOT NULL AND amount_after_discount > :max_aed)"
        ),
        {"max_aed": _MAX_LEGACY_AED},
    ).fetchall()
    if bad:
        first = bad[0]
        raise RuntimeError(
            f"Cannot convert vehicle_fines to fils: {len(bad)} row(s) have a "
            "non-integer or overflowing amount, e.g. "
            f"id={first[0]!r} amount={first[1]!r} amount_after_discount={first[2]!r}."
        )

    with op.batch_alter_table("vehicle_fines") as batch:
        batch.add_column(sa.Column("amount_fils", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("amount_after_discount_fils", sa.Integer(), nullable=True))
        batch.add_column(
            sa.Column(
                "payment_status", sa.String(length=8), nullable=False, server_default="unknown"
            )
        )
        batch.add_column(sa.Column("receipt_file_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))

    conn.execute(sa.text("UPDATE vehicle_fines SET amount_fils = amount * 100"))
    conn.execute(
        sa.text(
            "UPDATE vehicle_fines SET amount_after_discount_fils = amount_after_discount * 100 "
            "WHERE amount_after_discount IS NOT NULL"
        )
    )
    # Every pre-existing row is unknown: payment was never tracked before this
    # migration, so it counts in neither the paid nor unpaid total until staff
    # classify it. New rows created from here on set unpaid explicitly.
    conn.execute(sa.text("UPDATE vehicle_fines SET payment_status = 'unknown'"))

    with op.batch_alter_table("vehicle_fines") as batch:
        batch.alter_column("amount_fils", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("amount")
        batch.drop_column("amount_after_discount")
        batch.alter_column(
            "payment_status", existing_type=sa.String(length=8), server_default="unpaid"
        )


def downgrade() -> None:
    conn = op.get_bind()
    # `paid` is the only status the legacy whole-AED, status-free schema
    # cannot represent; `unknown`/`unpaid` both collapse to "no status" and
    # downgrade cleanly. A receipt, an archive timestamp, or a fractional
    # amount would also be silently discarded, so refuse those too.
    lossy = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM vehicle_fines WHERE "
            "receipt_file_id IS NOT NULL OR archived_at IS NOT NULL "
            "OR payment_status = 'paid' "
            "OR amount_fils % 100 != 0 "
            "OR (amount_after_discount_fils IS NOT NULL AND amount_after_discount_fils % 100 != 0)"
        )
    ).scalar_one()
    if lossy:
        raise RuntimeError(
            f"Cannot downgrade: {lossy} vehicle_fines row(s) carry a receipt, an "
            "archive timestamp, a paid status, or a fractional amount that a "
            "whole-AED, status-free column would discard."
        )

    with op.batch_alter_table("vehicle_fines") as batch:
        batch.add_column(sa.Column("amount", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("amount_after_discount", sa.Integer(), nullable=True))

    conn.execute(sa.text("UPDATE vehicle_fines SET amount = amount_fils / 100"))
    conn.execute(
        sa.text(
            "UPDATE vehicle_fines SET amount_after_discount = amount_after_discount_fils / 100 "
            "WHERE amount_after_discount_fils IS NOT NULL"
        )
    )

    with op.batch_alter_table("vehicle_fines") as batch:
        batch.alter_column("amount", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("archived_at")
        batch.drop_column("receipt_file_id")
        batch.drop_column("payment_status")
        batch.drop_column("amount_after_discount_fils")
        batch.drop_column("amount_fils")
