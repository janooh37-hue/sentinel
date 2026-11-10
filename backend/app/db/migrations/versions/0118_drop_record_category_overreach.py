"""Drop the record-driven denies 0117 added that hid whole services and categories.

Revision ID: 0118_drop_record_category_overreach
Revises: 0117_merge_legacy_record_categories

0117 kept each record filed in a denied legacy category hidden. Where the
record's service did not file into that category (a form revised into a
General Book, a hand-filed or imported record), it added a deny on the
record's whole classification or service: one HR-filed ``5/1`` General Book
hid every ``5/1`` record, entry-permit letters included, from every user with
HR denied.

The record gates now cover such stray records exactly: a stray record answers
to the Other service and to its stored category as well as its own
(``record_categories.record_services`` / ``record_gate_categories``), so the
filing-service and Other denies 0117 copied, or the mapped category deny for
an old-only category, still hide it. This revision removes every target 0117
inserted or tightened that is not one of those copies, restoring a tightened
row's prior value. A row an admin has since turned into a grant is left as is.
A journal table lets the downgrade put the removed denies back.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0118_drop_record_category_overreach"
down_revision: str | Sequence[str] | None = "0117_merge_legacy_record_categories"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen from 0117_merge_legacy_record_categories. Do not import application policy.
_CLASSIFICATIONS = frozenset(f"{tab}/1" for tab in range(1, 16))
_SERVICES_FILING_INTO_LEGACY_CATEGORY = {
    "GS": ("Acknowledgment Form", "General Book", "Report", "Vehicle Mileage Log"),
    "HR": (
        "Salary Transfer Request",
        "Salary Deduction Form",
        "Employee Clearance Form",
        "Leave Application Form",
        "Passport Release Form",
        "Duty Resumption Form",
        "HR Request Form",
        "Resignation Letter",
        "Leave Permit Form",
        "Administrative Leave Form",
        "Passport Release List",
        "Manpower Requisition Form",
        "Employment Application Form",
        "Interview Assessment Form",
        "Employment Offer Letter",
        "Employee Performance Appraisal Form",
        "Employee Job Description",
        "Interview Scores Form",
        "Staff Attendance Form",
        "Leave Encashment Form",
        "Loan Request Form",
        "Employee Information Form",
        "Employee Exit Form",
        "Employee Exit Form – Project or Contract",  # noqa: RUF001
        "Salary Advance Request Form",
        "Breach of Discipline Form",
        "Promotion and Salary Increment Request Form",
        "Allowance Request Form",
        "Employee Overtime Form",
        "Expense Claim Form",
    ),
    "NAT": ("Violation Form", "Warning Form"),
    "SC": ("Material Request Form", "Material Request Form (Arabic)"),
    "INV": ("Inmate Conduct Violations",),
    "VF": ("Vehicle Fines",),
    "VA": ("Vehicle Accident Report",),
}
_LEGACY_CATEGORY_RECORD_CATEGORY = {
    "1": "12/1",
    "2": "10/1",
    "12": "15/1",
    "HR": "12/1",
    "GS": "15/1",
    "NAT": "12/1",
    "SC": "10/1",
    "INV": "13/1",
    "VF": "7/1",
    "VA": "11/1",
}
_CATEGORY_PREFIX = "books.category."
_MERGE_BACKUP = "_record_category_merge_backup"
_BACKUP = "_record_category_overreach_backup"


def _legacy_category(capability: str) -> str | None:
    if not capability.startswith(_CATEGORY_PREFIX):
        return None
    category = capability[len(_CATEGORY_PREFIX) :]
    return None if category in _CLASSIFICATIONS else category


def _copied_targets(category: str) -> set[str]:
    """The targets 0117 copied a legacy override to, before its record-driven extras."""
    services = _SERVICES_FILING_INTO_LEGACY_CATEGORY.get(category)
    if not services:
        return {_CATEGORY_PREFIX + _LEGACY_CATEGORY_RECORD_CATEGORY.get(category, "15/1")}
    return {
        f"{prefix}{service}"
        for service in (*services, "other")
        for prefix in ("books.service.", "books.servicerecords.")
    }


def upgrade() -> None:
    op.create_table(
        _BACKUP,
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("capability", sa.String(length=128), primary_key=True),
        sa.Column("row_data", sa.Text(), nullable=False),
    )
    connection = op.get_bind()
    journal = (
        connection.execute(
            sa.text(f"SELECT row_key, row_data FROM {_MERGE_BACKUP} WHERE kind = 'user'")
        )
        .mappings()
        .all()
    )
    copied: dict[int, set[str]] = {}
    touched: list[tuple[int, str, dict[str, object] | None]] = []
    for entry in journal:
        user_id, capability = json.loads(entry["row_key"])
        prior = json.loads(entry["row_data"]) if entry["row_data"] is not None else None
        category = _legacy_category(capability)
        if category is not None:
            copied.setdefault(user_id, set()).update(_copied_targets(category))
        else:
            touched.append((user_id, capability, prior))
    for user_id, capability, prior in touched:
        if capability in copied.get(user_id, set()):
            continue
        key = {"user_id": user_id, "capability": capability}
        current = (
            connection.execute(
                sa.text(
                    "SELECT effect, expires_at FROM user_permissions "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                key,
            )
            .mappings()
            .first()
        )
        if current is None or current["effect"] != "deny":
            continue
        connection.execute(
            sa.text(
                f"INSERT INTO {_BACKUP} (user_id, capability, row_data) "
                "VALUES (:user_id, :capability, :row_data)"
            ),
            {**key, "row_data": json.dumps(dict(current))},
        )
        if prior is None:
            connection.execute(
                sa.text(
                    "DELETE FROM user_permissions "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                key,
            )
        else:
            connection.execute(
                sa.text(
                    "UPDATE user_permissions SET effect = :effect, expires_at = :expires_at "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                {**key, "effect": prior["effect"], "expires_at": prior["expires_at"]},
            )


def downgrade() -> None:
    connection = op.get_bind()
    entries = (
        connection.execute(sa.text(f"SELECT user_id, capability, row_data FROM {_BACKUP}"))
        .mappings()
        .all()
    )
    for entry in entries:
        row = json.loads(entry["row_data"])
        connection.execute(
            sa.text(
                "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
                "SELECT :user_id, :capability, :effect, :expires_at "
                "WHERE EXISTS (SELECT 1 FROM users WHERE id = :user_id) "
                "ON CONFLICT (user_id, capability) DO UPDATE "
                "SET effect = excluded.effect, expires_at = excluded.expires_at"
            ),
            {
                "user_id": entry["user_id"],
                "capability": entry["capability"],
                "effect": row["effect"],
                "expires_at": row["expires_at"],
            },
        )
    op.drop_table(_BACKUP)
