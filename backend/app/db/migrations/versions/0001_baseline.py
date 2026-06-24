"""baseline — Phase 02 schema.

Revision ID: 0001
Revises:
Create Date: 2026-05-16

Captures the full Phase 02 schema. Every later phase that touches the schema
must land its own migration — no schema edits without an Alembic file.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", sa.String(length=16), primary_key=True),
        sa.Column("name_en", sa.String(length=256), nullable=False),
        sa.Column("name_ar", sa.String(length=256), nullable=True),
        sa.Column("dob", sa.Date(), nullable=True),
        sa.Column("doj", sa.Date(), nullable=True),
        sa.Column("doj_company", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="Active"),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("department", sa.String(length=128), nullable=True),
        sa.Column("position", sa.String(length=128), nullable=True),
        sa.Column("position_ar", sa.String(length=128), nullable=True),
        sa.Column("other", sa.String(length=256), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("passport_no", sa.String(length=64), nullable=True),
        sa.Column("uae_id_no", sa.String(length=32), nullable=True),
        sa.Column("nationality", sa.String(length=64), nullable=True),
        sa.Column("contact", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_employees_status", "employees", ["status"])

    op.create_table(
        "book_categories",
        sa.Column("id", sa.String(length=16), primary_key=True),
        sa.Column("name_en", sa.String(length=128), nullable=True),
        sa.Column("name_ar", sa.String(length=128), nullable=True),
        sa.Column("prefix", sa.String(length=16), nullable=False),
    )

    op.create_table(
        "book_ref_sequence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("next_value", sa.Integer(), nullable=False, server_default="1"),
        sa.CheckConstraint("next_value >= 1", name="ck_book_ref_seq_positive"),
    )

    op.create_table(
        "books",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("category_id", sa.String(length=16), nullable=False),
        sa.Column("ref_number", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=512), nullable=True),
        sa.Column("direction", sa.String(length=16), nullable=True),
        sa.Column("stamp_style", sa.String(length=64), nullable=True),
        sa.Column("employee_id", sa.String(length=16), nullable=True),
        sa.Column("employee_name_snapshot", sa.String(length=256), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("doc_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["book_categories.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.UniqueConstraint("ref_number", name="uq_books_ref_number"),
    )
    op.create_index("ix_books_employee_id", "books", ["employee_id"])
    op.create_index("ix_books_created_at", "books", ["created_at"])

    op.create_table(
        "leaves",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), nullable=False),
        sa.Column("leave_type", sa.String(length=64), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="Generated"),
        sa.Column("request_date", sa.Date(), nullable=True),
        sa.Column("doc_path", sa.Text(), nullable=True),
        sa.Column("certificate_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
    )
    op.create_index("ix_leaves_employee_start", "leaves", ["employee_id", "start_date"])

    op.create_table(
        "violations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), nullable=False),
        sa.Column("violation_type", sa.String(length=64), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("deduction_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="Open"),
        sa.Column("doc_path", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
    )
    op.create_index("ix_violations_employee_date", "violations", ["employee_id", "date"])

    op.create_table(
        "managers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name_en", sa.String(length=256), nullable=True),
        sa.Column("name_ar", sa.String(length=256), nullable=True),
        sa.Column("title", sa.String(length=256), nullable=True),
        sa.Column("sig_path", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="1"),
    )

    op.create_table(
        "submitters",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), nullable=True),
        sa.Column("name", sa.String(length=256), nullable=False),
        sa.Column("stored_sig_path", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )

    op.create_table(
        "vault_files",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("employee_id", sa.String(length=16), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
    )
    op.create_index("ix_vault_files_employee_kind", "vault_files", ["employee_id", "kind"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor", sa.String(length=128), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("ts", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_audit_log_ts", "audit_log", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_ts", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_vault_files_employee_kind", table_name="vault_files")
    op.drop_table("vault_files")
    op.drop_table("app_settings")
    op.drop_table("submitters")
    op.drop_table("managers")
    op.drop_index("ix_violations_employee_date", table_name="violations")
    op.drop_table("violations")
    op.drop_index("ix_leaves_employee_start", table_name="leaves")
    op.drop_table("leaves")
    op.drop_index("ix_books_created_at", table_name="books")
    op.drop_index("ix_books_employee_id", table_name="books")
    op.drop_table("books")
    op.drop_table("book_ref_sequence")
    op.drop_table("book_categories")
    op.drop_index("ix_employees_status", table_name="employees")
    op.drop_table("employees")
