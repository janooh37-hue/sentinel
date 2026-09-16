"""Retain completed assignment access and snapshot approval context.

Revision ID: 0089_book_revision_access
Revises: 0088_inmate_statistics_workflow
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0089_book_revision_access"
down_revision = "0088_inmate_statistics_workflow"
branch_labels = None
depends_on = None



def _decoded_fields(value: object) -> dict[str, object] | None:
    if isinstance(value, dict):
        return value
    if not isinstance(value, (str, bytes, bytearray)):
        return None
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return None
    return decoded if isinstance(decoded, dict) else None


def _resolved_name(
    employee_row_id: str | None,
    employee_name_en: str | None,
    display_name: str | None,
    email: str | None,
) -> str | None:
    """Mirror book_service user-name precedence for legacy snapshots."""
    if employee_row_id is not None:
        return employee_name_en
    if display_name:
        return display_name
    return email


def _utc_iso(value: object) -> str | None:
    """Serialize a real stored assignment timestamp with an explicit UTC offset."""
    if value is None:
        return None
    stamp: datetime
    if isinstance(value, datetime):
        stamp = value
    elif isinstance(value, str):
        try:
            stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    else:
        stamp = stamp.astimezone(UTC)
    return stamp.isoformat()


def _backfill_current_approval_context(bind: sa.Connection) -> None:
    books = sa.table(
        "books",
        sa.column("id", sa.Integer()),
        sa.column("category_id", sa.String()),
        sa.column("subject", sa.String()),
        sa.column("priority", sa.String()),
        sa.column("direction", sa.String()),
        sa.column("stamp_style", sa.String()),
        sa.column("employee_id", sa.String()),
        sa.column("employee_name_snapshot", sa.String()),
        sa.column("submitted_by_user_id", sa.Integer()),
        sa.column("doc_manager_id", sa.Integer()),
    )
    versions = sa.table(
        "book_versions",
        sa.column("id", sa.Integer()),
        sa.column("book_id", sa.Integer()),
        sa.column("version_no", sa.Integer()),
        sa.column("approval_context", sa.JSON()),
        sa.column("fields", sa.JSON()),
    )
    categories = sa.table(
        "book_categories",
        sa.column("id", sa.String()),
        sa.column("name_ar", sa.String()),
        sa.column("name_en", sa.String()),
    )
    managers = sa.table(
        "managers",
        sa.column("id", sa.Integer()),
        sa.column("user_id", sa.Integer()),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.Integer()),
        sa.column("employee_id", sa.String()),
        sa.column("display_name", sa.String()),
        sa.column("email", sa.String()),
    )
    employees = sa.table(
        "employees",
        sa.column("id", sa.String()),
        sa.column("name_en", sa.String()),
    )
    steps = sa.table(
        "book_approval_steps",
        sa.column("version_id", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
    )

    submitter = users.alias("approval_context_submitter")
    submitter_employee = employees.alias("approval_context_submitter_employee")
    manager = managers.alias("approval_context_manager")
    manager_user = users.alias("approval_context_manager_user")
    manager_employee = employees.alias("approval_context_manager_employee")
    current = (
        sa.select(
            versions.c.book_id,
            sa.func.max(versions.c.version_no).label("version_no"),
        )
        .group_by(versions.c.book_id)
        .subquery("approval_context_current_version")
    )
    submitted_at = (
        sa.select(sa.func.min(steps.c.created_at))
        .where(steps.c.version_id == versions.c.id)
        .correlate(versions)
        .scalar_subquery()
    )

    source = (
        versions.join(
            current,
            (current.c.book_id == versions.c.book_id)
            & (current.c.version_no == versions.c.version_no),
        )
        .join(books, books.c.id == versions.c.book_id)
        .outerjoin(categories, categories.c.id == books.c.category_id)
        .outerjoin(submitter, submitter.c.id == books.c.submitted_by_user_id)
        .outerjoin(
            submitter_employee,
            submitter_employee.c.id == submitter.c.employee_id,
        )
        .outerjoin(manager, manager.c.id == books.c.doc_manager_id)
        .outerjoin(manager_user, manager_user.c.id == manager.c.user_id)
        .outerjoin(
            manager_employee,
            manager_employee.c.id == manager_user.c.employee_id,
        )
    )
    rows = bind.execute(
        sa.select(
            versions.c.id.label("version_id"),
            books.c.id.label("book_id"),
            versions.c.fields,
            books.c.subject.label("book_subject"),
            books.c.category_id,
            categories.c.name_ar.label("category_name_ar"),
            categories.c.name_en.label("category_name_en"),
            books.c.priority,
            books.c.direction,
            books.c.stamp_style,
            books.c.employee_id,
            books.c.employee_name_snapshot,
            books.c.submitted_by_user_id,
            submitter_employee.c.id.label("submitter_employee_row_id"),
            submitter_employee.c.name_en.label("submitter_employee_name_en"),
            submitter.c.display_name.label("submitter_display_name"),
            submitter.c.email.label("submitter_email"),
            manager.c.user_id.label("doc_manager_user_id"),
            manager_employee.c.id.label("manager_employee_row_id"),
            manager_employee.c.name_en.label("manager_employee_name_en"),
            manager_user.c.display_name.label("manager_display_name"),
            manager_user.c.email.label("manager_email"),
            submitted_at.label("submitted_at"),
        ).select_from(source)
    ).mappings()

    for row in rows:
        fields = _decoded_fields(row["fields"]) or {}
        raw_subject = fields.get("subject")
        subject = (
            raw_subject.strip()
            if isinstance(raw_subject, str) and raw_subject.strip()
            else row["book_subject"]
        )
        context: dict[str, Any] = {
            "subject": subject,
            "category_id": row["category_id"],
            "category_name_ar": row["category_name_ar"],
            "category_name_en": row["category_name_en"],
            "priority": row["priority"],
            "direction": row["direction"],
            "stamp_style": row["stamp_style"],
            "employee_id": row["employee_id"],
            "employee_name_snapshot": row["employee_name_snapshot"],
            "submitted_by_user_id": row["submitted_by_user_id"],
            "submitted_by_name": _resolved_name(
                row["submitter_employee_row_id"],
                row["submitter_employee_name_en"],
                row["submitter_display_name"],
                row["submitter_email"],
            ),
            "doc_manager_user_id": row["doc_manager_user_id"],
            "doc_manager_name": _resolved_name(
                row["manager_employee_row_id"],
                row["manager_employee_name_en"],
                row["manager_display_name"],
                row["manager_email"],
            ),
            "submitted_at": _utc_iso(row["submitted_at"]),
        }
        bind.execute(
            versions.update()
            .where(versions.c.id == row["version_id"])
            .values(approval_context=context)
        )


def upgrade() -> None:
    with op.batch_alter_table("book_versions") as batch:
        batch.add_column(sa.Column("approval_context", sa.JSON(), nullable=True))

    op.create_table(
        "book_revision_access",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "version_id",
            sa.Integer(),
            sa.ForeignKey("book_versions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("state", sa.String(length=32), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("assigned_at", sa.DateTime(), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_user_id", sa.Integer(), nullable=True),
        sa.Column("revocation_reason", sa.Text(), nullable=True),
        sa.UniqueConstraint(
            "version_id",
            "user_id",
            "kind",
            name="uq_book_revision_access_version_user_kind",
        ),
        sa.CheckConstraint(
            "kind IN ('approver', 'reviewer')",
            name="ck_book_revision_access_kind",
        ),
        sa.CheckConstraint(
            "state IN ('approved', 'rejected', 'returned', 'reviewed', "
            "'changes_requested')",
            name="ck_book_revision_access_state",
        ),
    )
    op.create_index(
        "ix_book_revision_access_user_revoked_version",
        "book_revision_access",
        ["user_id", "revoked_at", "version_id"],
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO book_revision_access (
                version_id,
                user_id,
                kind,
                state,
                note,
                assigned_at,
                decided_at
            )
            SELECT
                ranked.version_id,
                ranked.assignee_user_id,
                ranked.kind,
                ranked.state,
                ranked.note,
                ranked.created_at,
                ranked.decided_at
            FROM (
                SELECT
                    step.version_id,
                    step.assignee_user_id,
                    step.kind,
                    step.state,
                    step.note,
                    step.created_at,
                    step.decided_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY step.version_id, step.assignee_user_id, step.kind
                        ORDER BY step.decided_at DESC, step.id DESC
                    ) AS decision_rank
                FROM book_approval_steps AS step
                WHERE step.version_id IS NOT NULL
                  AND step.decided_at IS NOT NULL
                  AND step.kind IN ('approver', 'reviewer')
                  AND step.state IN (
                      'approved',
                      'rejected',
                      'returned',
                      'reviewed',
                      'changes_requested'
                  )
            ) AS ranked
            WHERE ranked.decision_rank = 1
            """
        )
    )
    _backfill_current_approval_context(bind)


def downgrade() -> None:
    op.drop_index(
        "ix_book_revision_access_user_revoked_version",
        table_name="book_revision_access",
    )
    op.drop_table("book_revision_access")
    with op.batch_alter_table("book_versions") as batch:
        batch.drop_column("approval_context")
