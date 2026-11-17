"""Accident reports in one language, with optional insurance details.

A report is now written in the operator's language only, so the Arabic halves
of the location and description become optional; the official letter asks for
the Arabic wording when it is issued. The insurance claim (number, status,
company, repair garage, who bears the cost) is recorded on the report, all
optional. ``damage_cost`` stays for the reports that already carry one; it is
no longer written.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0120_accident_insurance"
down_revision: str | Sequence[str] | None = "0119_employee_former_ids"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("vehicle_accidents") as batch:
        batch.alter_column("location_ar", existing_type=sa.Text(), nullable=True)
        batch.alter_column("description_ar", existing_type=sa.Text(), nullable=True)
        batch.add_column(sa.Column("claim_no", sa.String(64), nullable=True))
        batch.add_column(sa.Column("claim_status", sa.String(16), nullable=True))
        batch.add_column(sa.Column("insurer", sa.String(128), nullable=True))
        batch.add_column(sa.Column("repair_garage", sa.String(128), nullable=True))
        batch.add_column(sa.Column("cost_payer", sa.String(16), nullable=True))
        batch.create_check_constraint(
            "ck_vehicle_accidents_claim_status",
            "claim_status IS NULL OR claim_status IN "
            "('not_submitted', 'submitted', 'under_repair', 'settled')",
        )
        batch.create_check_constraint(
            "ck_vehicle_accidents_cost_payer",
            "cost_payer IS NULL OR cost_payer IN ('insurer', 'company', 'driver')",
        )


def downgrade() -> None:
    # The old schema requires the Arabic halves: a report written in English
    # keeps its English text there rather than failing the downgrade.
    op.execute(
        "UPDATE vehicle_accidents SET location_ar = COALESCE(location_en, '') "
        "WHERE location_ar IS NULL"
    )
    op.execute(
        "UPDATE vehicle_accidents SET description_ar = COALESCE(description_en, '') "
        "WHERE description_ar IS NULL"
    )
    with op.batch_alter_table("vehicle_accidents") as batch:
        batch.drop_constraint("ck_vehicle_accidents_cost_payer", type_="check")
        batch.drop_constraint("ck_vehicle_accidents_claim_status", type_="check")
        batch.drop_column("cost_payer")
        batch.drop_column("repair_garage")
        batch.drop_column("insurer")
        batch.drop_column("claim_status")
        batch.drop_column("claim_no")
        batch.alter_column("description_ar", existing_type=sa.Text(), nullable=False)
        batch.alter_column("location_ar", existing_type=sa.Text(), nullable=False)
