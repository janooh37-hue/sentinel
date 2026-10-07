"""item permits — replace item_permits.zone with a multi-value zones list.

Revision ID: 0097_item_permit_zones
Revises: 0096_item_permits
Create Date: 2026-10-07 00:00:00.000000

An item-entry permit can now cover any combination of the red, green and work
residence zones, so the single ``zone`` string (+ ``ck_item_permits_zone``)
becomes a JSON array ``zones``. Existing rows wrap their value into a
one-element array. Downgrade keeps the first zone; ``work_residence`` did not
exist under the old CHECK (red/green only), so it falls back to ``red``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0097_item_permit_zones"
down_revision: str | Sequence[str] | None = "0096_item_permits"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("item_permits") as batch:
        batch.add_column(sa.Column("zones", sa.JSON(), nullable=True))
    op.execute("UPDATE item_permits SET zones = json_array(zone)")
    with op.batch_alter_table("item_permits") as batch:
        batch.alter_column("zones", existing_type=sa.JSON(), nullable=False)
        batch.drop_constraint("ck_item_permits_zone", type_="check")
        batch.drop_column("zone")


def downgrade() -> None:
    with op.batch_alter_table("item_permits") as batch:
        batch.add_column(sa.Column("zone", sa.String(8), nullable=True))
    op.execute(
        "UPDATE item_permits SET zone = CASE json_extract(zones, '$[0]')"
        " WHEN 'green' THEN 'green' ELSE 'red' END"
    )
    with op.batch_alter_table("item_permits") as batch:
        batch.alter_column("zone", existing_type=sa.String(8), nullable=False)
        batch.create_check_constraint("ck_item_permits_zone", "zone IN ('red', 'green')")
        batch.drop_column("zones")
