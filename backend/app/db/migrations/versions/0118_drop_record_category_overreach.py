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
an old-only category, still hide it. This revision finds every target 0117
inserted or tightened that no legacy deny copied to, and sets it to what 0117
would have left without the extra deny: the row's prior value, with any legacy
grant copied onto it the way 0117 copies grants.

Only a deny that still carries an expiry 0117 could have written is repaired:
one of the user's legacy deny expiries, the prior deny's expiry, or permanent
where 0117 merged a deny into a grant. A row an admin has since turned into a
grant or given another expiry is left alone. An admin's deny set to the very
value 0117 wrote cannot be told apart and is repaired too. A journal table lets
the downgrade put the removed denies back.
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
_OPT_IN_SERVICE_IDS = frozenset(
    {
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
    }
)
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


def _without_extras(
    capability: str, prior: dict[str, object] | None, grants: list[dict[str, object]]
) -> dict[str, object] | None:
    """The row 0117 would have left without its record-driven deny: ``prior`` with
    each legacy grant that copied to ``capability`` applied as 0117's ``_copy_override``."""
    row = dict(prior) if prior is not None else None
    service = capability.removeprefix("books.servicerecords.").removeprefix("books.service.")
    for grant in grants:
        if row is None:
            if service not in _OPT_IN_SERVICE_IDS:
                row = {"effect": "grant", "expires_at": grant["expires_at"]}
        elif row["effect"] == "grant" and grant["expires_at"] is not None:
            expiry = str(grant["expires_at"])
            if row["expires_at"] is None or expiry < str(row["expires_at"]):
                row["expires_at"] = expiry
    return row


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
    denied: dict[int, set[str]] = {}
    deny_expiries: dict[int, set[object]] = {}
    grants: dict[tuple[int, str], list[dict[str, object]]] = {}
    touched: list[tuple[int, str, dict[str, object] | None]] = []
    for entry in sorted(journal, key=lambda e: e["row_key"]):
        user_id, capability = json.loads(entry["row_key"])
        prior = json.loads(entry["row_data"]) if entry["row_data"] is not None else None
        category = _legacy_category(capability)
        if category is None:
            touched.append((user_id, capability, prior))
        elif prior is not None and prior["effect"] == "deny":
            denied.setdefault(user_id, set()).update(_copied_targets(category))
            deny_expiries.setdefault(user_id, set()).add(prior["expires_at"])
        elif prior is not None:
            for target in _copied_targets(category):
                grants.setdefault((user_id, target), []).append(prior)
    for user_id, capability, prior in touched:
        if capability in denied.get(user_id, set()):
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
        # Every deny 0117 wrote took a source's expiry, kept the prior deny's
        # (the later of the two), or became permanent over a grant.
        written = set(deny_expiries.get(user_id, set()))
        if prior is not None and prior["effect"] == "deny":
            written.add(prior["expires_at"])
        if (prior is not None and prior["effect"] == "grant") or (user_id, capability) in grants:
            written.add(None)
        if current["expires_at"] not in written:
            continue
        connection.execute(
            sa.text(
                f"INSERT INTO {_BACKUP} (user_id, capability, row_data) "
                "VALUES (:user_id, :capability, :row_data)"
            ),
            {**key, "row_data": json.dumps(dict(current))},
        )
        restored = _without_extras(capability, prior, grants.get((user_id, capability), []))
        if restored is None:
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
                {**key, "effect": restored["effect"], "expires_at": restored["expires_at"]},
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
