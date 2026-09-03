"""Add the vehicle fleet ledger and vehicle book categories.

Revision ID: 0083_vehicles
Revises: 0082_service_records_caps
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0083_vehicles"
down_revision: str | Sequence[str] | None = "0082_service_records_caps"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vehicle_sites",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_ar", sa.String(128), nullable=False),
        sa.Column("name_en", sa.String(128), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "vehicles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("plate_code", sa.String(8), nullable=True),
        sa.Column("plate_number", sa.String(16), nullable=False),
        sa.Column("traffic_code", sa.String(16), nullable=False),
        sa.Column("type_ar", sa.String(128), nullable=False),
        sa.Column("type_en", sa.String(128), nullable=False),
        sa.Column("class_ar", sa.String(64), nullable=False),
        sa.Column("class_en", sa.String(64), nullable=False),
        sa.Column("vin", sa.String(32), nullable=True),
        sa.Column(
            "site_id",
            sa.Integer(),
            sa.ForeignKey("vehicle_sites.id"),
            nullable=False,
        ),
        sa.Column("contract_note_ar", sa.Text(), nullable=True),
        sa.Column("contract_note_en", sa.Text(), nullable=True),
        sa.Column("license_start", sa.Date(), nullable=False),
        sa.Column("license_expiry", sa.Date(), nullable=False),
        sa.Column("photo_file_id", sa.Integer(), nullable=True),
        sa.Column("license_file_id", sa.Integer(), nullable=True),
        sa.Column("expiry_reminder_sent_for", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "uq_vehicles_plate",
        "vehicles",
        ["plate_code", "plate_number"],
        unique=True,
    )
    op.create_index(
        "uq_vehicles_plate_without_code",
        "vehicles",
        ["plate_number"],
        unique=True,
        sqlite_where=sa.text("plate_code IS NULL"),
    )
    op.create_index("ix_vehicles_site", "vehicles", ["site_id"])
    op.create_index("ix_vehicles_plate_number", "vehicles", ["plate_number"])

    op.create_table(
        "vehicle_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label_ar", sa.String(128), nullable=True),
        sa.Column("label_en", sa.String(128), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("media_type", sa.String(64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_vehicle_files_vehicle", "vehicle_files", ["vehicle_id"])

    op.create_table(
        "vehicle_license_renewals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start", sa.Date(), nullable=False),
        sa.Column("expiry", sa.Date(), nullable=False),
        sa.Column("renewed_on", sa.Date(), nullable=False),
        sa.Column("cost", sa.Integer(), nullable=True),
        sa.Column("scan_file_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_vehicle_license_renewals_vehicle",
        "vehicle_license_renewals",
        ["vehicle_id"],
    )

    op.create_table(
        "vehicle_fines",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.String(8), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("amount_after_discount", sa.Integer(), nullable=True),
        sa.Column("black_points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(8), nullable=False, server_default="manual"),
        sa.Column("evg_ticket_no", sa.String(32), nullable=True),
        sa.Column("location", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("fine_type", sa.String(32), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "uq_vehicle_fines_evg_ticket",
        "vehicle_fines",
        ["evg_ticket_no"],
        unique=True,
    )
    op.create_index(
        "ix_vehicle_fines_vehicle_date",
        "vehicle_fines",
        ["vehicle_id", "date"],
    )

    op.create_table(
        "vehicle_accidents",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("employee_id", sa.String(16), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("time", sa.String(5), nullable=True),
        sa.Column("location_ar", sa.Text(), nullable=False),
        sa.Column("location_en", sa.Text(), nullable=True),
        sa.Column("description_ar", sa.Text(), nullable=False),
        sa.Column("description_en", sa.Text(), nullable=True),
        sa.Column("police_ref", sa.String(64), nullable=True),
        sa.Column("damage_cost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(8), nullable=False, server_default="open"),
        sa.Column("photo_file_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("letter_book_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_vehicle_accidents_vehicle", "vehicle_accidents", ["vehicle_id"])

    op.create_table(
        "vehicle_maintenance",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("odometer_km", sa.Integer(), nullable=True),
        sa.Column("cost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vendor_ar", sa.String(128), nullable=True),
        sa.Column("vendor_en", sa.String(128), nullable=True),
        sa.Column("next_due", sa.Date(), nullable=True),
        sa.Column("receipt_file_id", sa.Integer(), nullable=True),
        sa.Column("reminder_sent_for", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_vehicle_maintenance_vehicle",
        "vehicle_maintenance",
        ["vehicle_id"],
    )

    conn = op.get_bind()
    for category in (
        {
            "id": "VF",
            "name_en": "Vehicle Fines",
            "name_ar": "مخالفات المركبات",
            "prefix": "VF",
        },
        {
            "id": "VA",
            "name_en": "Vehicle Accidents",
            "name_ar": "حوادث المركبات",
            "prefix": "VA",
        },
    ):
        conn.execute(
            sa.text(
                "INSERT OR IGNORE INTO book_categories (id, name_en, name_ar, prefix)"
                " VALUES (:id, :name_en, :name_ar, :prefix)"
            ),
            category,
        )


def downgrade() -> None:
    op.drop_table("vehicle_maintenance")
    op.drop_table("vehicle_accidents")
    op.drop_table("vehicle_fines")
    op.drop_table("vehicle_license_renewals")
    op.drop_table("vehicle_files")
    op.drop_table("vehicles")
    op.drop_table("vehicle_sites")

    op.get_bind().execute(
        sa.text(
            "DELETE FROM book_categories "
            "WHERE id IN ('VF', 'VA') "
            "AND NOT EXISTS ("
            "SELECT 1 FROM books WHERE books.category_id = book_categories.id"
            ")"
        )
    )
