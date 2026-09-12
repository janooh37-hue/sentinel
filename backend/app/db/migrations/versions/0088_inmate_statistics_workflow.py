"""Archive legacy seals and add the inmate monthly approval workflow.

Revision ID: 0088_inmate_statistics_workflow
Revises: 0087_vehicle_photo_library
"""

from __future__ import annotations

import hashlib
import json

import sqlalchemy as sa
from alembic import op

revision = "0088_inmate_statistics_workflow"
down_revision = "0087_vehicle_photo_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inmate_violation_workflows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("state", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("current_sequence", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("year", "month", name="uq_inmate_violation_workflows_month"),
        sa.CheckConstraint("month BETWEEN 1 AND 12", name="ck_inmate_violation_workflows_month"),
        sa.CheckConstraint("year BETWEEN 2000 AND 2100", name="ck_inmate_violation_workflows_year"),
        sa.CheckConstraint(
            "version >= 0 AND current_sequence >= 0", name="ck_inmate_violation_workflows_version"
        ),
        sa.CheckConstraint(
            "state IN ('draft','awaiting_review','awaiting_manager','closed')",
            name="ck_inmate_violation_workflows_state",
        ),
    )
    op.create_index("ix_inmate_violation_workflows_state", "inmate_violation_workflows", ["state"])
    op.create_table(
        "inmate_violation_submissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "workflow_id",
            sa.Integer(),
            sa.ForeignKey("inmate_violation_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False),
        sa.Column(
            "reviewer_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("reviewer_employee_id", sa.String(16), nullable=True),
        sa.Column(
            "manager_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("manager_employee_id", sa.String(16), nullable=True),
        sa.Column("legacy_metadata", sa.JSON(), nullable=True),
        sa.UniqueConstraint(
            "workflow_id", "sequence", name="uq_inmate_violation_submissions_sequence"
        ),
        sa.CheckConstraint("sequence > 0", name="ck_inmate_violation_submissions_sequence"),
        sa.CheckConstraint(
            "origin IN ('workflow','legacy')", name="ck_inmate_violation_submissions_origin"
        ),
        sa.CheckConstraint(
            "origin = 'legacy' OR created_at IS NOT NULL",
            name="ck_inmate_violation_submissions_created_at",
        ),
    )
    op.create_index(
        "ix_inmate_violation_submissions_reviewer",
        "inmate_violation_submissions",
        ["reviewer_user_id"],
    )
    op.create_index(
        "ix_inmate_violation_submissions_manager",
        "inmate_violation_submissions",
        ["manager_user_id"],
    )
    op.create_table(
        "inmate_violation_workflow_actions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "workflow_id",
            sa.Integer(),
            sa.ForeignKey("inmate_violation_workflows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "submission_id",
            sa.Integer(),
            sa.ForeignKey("inmate_violation_submissions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("actor_name_ar", sa.String(256), nullable=True),
        sa.Column("actor_employee_id", sa.String(16), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "action IN ('prepared','reviewed','approved','returned','superseded','invalidated','reopened')",
            name="ck_inmate_violation_actions_kind",
        ),
        sa.CheckConstraint(
            "action NOT IN ('prepared','reviewed','approved') OR (submission_id IS NOT NULL AND actor_user_id IS NOT NULL AND length(trim(actor_name_ar)) > 0 AND actor_name_ar IS NOT NULL AND length(trim(actor_employee_id)) > 0 AND actor_employee_id IS NOT NULL)",
            name="ck_inmate_violation_actions_actor",
        ),
        sa.CheckConstraint(
            "action NOT IN ('returned','reopened') OR (reason IS NOT NULL AND length(trim(reason)) > 0)",
            name="ck_inmate_violation_actions_reason",
        ),
    )
    op.create_index(
        "ix_inmate_violation_actions_workflow",
        "inmate_violation_workflow_actions",
        ["workflow_id", "id"],
    )
    op.create_index(
        "uq_inmate_violation_actions_stage",
        "inmate_violation_workflow_actions",
        ["submission_id", "action"],
        unique=True,
        sqlite_where=sa.text("action IN ('prepared','reviewed','approved')"),
    )
    connection = op.get_bind()
    metadata = sa.MetaData()
    periods = sa.Table("inmate_violation_periods", metadata, autoload_with=connection)
    rows = sa.Table("inmate_violation_stat_rows", metadata, autoload_with=connection)
    workflows = sa.Table("inmate_violation_workflows", metadata, autoload_with=connection)
    submissions = sa.Table("inmate_violation_submissions", metadata, autoload_with=connection)
    for period in connection.execute(sa.select(periods).order_by(periods.c.id)).mappings():
        workflow_id = connection.execute(
            workflows.insert().values(
                year=period["year"],
                month=period["month"],
                version=0,
                state="closed" if period["closed_at"] else "draft",
                current_sequence=1,
            )
        ).inserted_primary_key[0]
        entries = []
        stored_rows = []
        for stored in connection.execute(
            sa.select(rows)
            .where(rows.c.period_id == period["id"])
            .order_by(rows.c.population, rows.c.row_no)
        ).mappings():
            stored_rows.append(dict(stored))
            entry = {
                key: value
                for key, value in stored.items()
                if key not in {"id", "period_id", "row_handle"}
            }
            entry["handle"] = stored["row_handle"]
            for key in ("uid", "nationality_label", "details_text", "wing", "holding_no"):
                entry[key] = entry[key] or ""
            entry["duty_unit"] = entry["duty_unit"] or "غير محدد"
            entry["incomplete_marks"] = entry["incomplete_marks"] or []
            entry.update(
                manual_row_id=None,
                missing=[],
                duplicate_of=None,
                completion_book_id=None,
                _sort_created_at="",
            )
            entries.append(entry)
        payload = json.loads(
            json.dumps(
                {
                    "schema_version": 1,
                    "year": period["year"],
                    "month": period["month"],
                    "entries": entries,
                },
                ensure_ascii=False,
                default=lambda value: value.isoformat(),
            )
        )
        canonical = {
            **payload,
            "entries": [
                {
                    key: value
                    for key, value in row.items()
                    if key not in {"manual_created_by_name", "_sort_created_at"}
                }
                for row in payload["entries"]
            ],
        }
        fingerprint = hashlib.sha256(
            json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(
                "utf-8"
            )
        ).hexdigest()
        legacy = json.loads(
            json.dumps(
                {
                    key: period[key]
                    for key in (
                        "closed_at",
                        "closed_by",
                        "reopened_at",
                        "reopened_by",
                        "force_reason",
                        "export_path",
                    )
                },
                default=lambda value: value.isoformat(),
            )
        )
        legacy["stored_rows"] = json.loads(
            json.dumps(stored_rows, ensure_ascii=False, default=lambda value: value.isoformat())
        )
        connection.execute(
            submissions.insert().values(
                workflow_id=workflow_id,
                sequence=1,
                payload=payload,
                fingerprint=fingerprint,
                created_at=None,
                origin="legacy",
                legacy_metadata=legacy,
            )
        )
    with op.batch_alter_table("inmate_violation_periods") as batch:
        batch.drop_column("force_reason")


def downgrade() -> None:
    with op.batch_alter_table("inmate_violation_periods") as batch:
        batch.add_column(sa.Column("force_reason", sa.Text(), nullable=True))
    connection = op.get_bind()
    metadata = sa.MetaData()
    periods = sa.Table("inmate_violation_periods", metadata, autoload_with=connection)
    workflows = sa.Table("inmate_violation_workflows", metadata, autoload_with=connection)
    submissions = sa.Table("inmate_violation_submissions", metadata, autoload_with=connection)
    statement = (
        sa.select(periods.c.id, submissions.c.legacy_metadata)
        .join(
            workflows, (workflows.c.year == periods.c.year) & (workflows.c.month == periods.c.month)
        )
        .join(
            submissions,
            (submissions.c.workflow_id == workflows.c.id)
            & (submissions.c.sequence == workflows.c.current_sequence),
        )
        .where(
            periods.c.closed_at.is_not(None),
            workflows.c.state == "closed",
            submissions.c.origin == "legacy",
        )
    )
    for period_id, legacy in connection.execute(statement):
        connection.execute(
            periods.update()
            .where(periods.c.id == period_id)
            .values(force_reason=(legacy or {}).get("force_reason"))
        )
    op.drop_table("inmate_violation_workflow_actions")
    op.drop_table("inmate_violation_submissions")
    op.drop_table("inmate_violation_workflows")
