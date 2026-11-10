"""Merge legacy category permissions without changing records or reference data.

Live legacy categories become creation and record-visibility service overrides,
including Other. Old-only categories become classification overrides. A deny
also covers every existing record filed in the legacy category that those
targets miss (a record classified, or recognised as a service, outside the
category's filing services): a classified record adds a deny on its
classification, any other record a records deny on its resolved service.
A recovery journal preserves deleted rows and the prior state of touched
targets/requests for a best-effort downgrade.
Downgrade restores that state; subsequent edits to those same rows are not kept.
Grant sources never opt users into default-denied services. Temporary grants
narrow existing target grants to the earlier expiry; permanent grants leave
existing targets unchanged. A deny meeting an existing deny keeps the later
expiry, a permanent one winning. These fail-closed rules prevent wider access.
"""

from __future__ import annotations

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0117_merge_legacy_record_categories"
down_revision: str | Sequence[str] | None = "0116_outbound_skip_reason"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen from form_kind.SERVICE_IDS and document_service's filing categories at
# revision 0116. Do not import application policy into a historical migration.
_CLASSIFICATIONS = frozenset(
    {
        "1/1",
        "2/1",
        "3/1",
        "4/1",
        "5/1",
        "6/1",
        "7/1",
        "8/1",
        "9/1",
        "10/1",
        "11/1",
        "12/1",
        "13/1",
        "14/1",
        "15/1",
    }
)
_SERVICES_FILING_INTO_LEGACY_CATEGORY = {
    "GS": (
        "Acknowledgment Form",
        "General Book",
        "Report",
        "Vehicle Mileage Log",
    ),
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
# Frozen from record_categories.SERVICE_RECORD_CATEGORY and form_kind's
# SERVICE_ALIASES / LEGACY_SUBJECT_ALIASES at this revision.
_SERVICE_RECORD_CATEGORY = {
    "Leave Application Form": "3/1",
    "Leave Permit Form": "3/1",
    "Administrative Leave Form": "3/1",
    "Duty Resumption Form": "3/1",
    "Salary Transfer Request": "7/1",
    "Salary Deduction Form": "7/1",
    "Salary Advance Request Form": "7/1",
    "Loan Request Form": "7/1",
    "Allowance Request Form": "7/1",
    "Employee Overtime Form": "7/1",
    "Expense Claim Form": "7/1",
    "Leave Encashment Form": "7/1",
    "Vehicle Fines": "7/1",
    "Passport Release Form": "8/1",
    "Passport Release List": "8/1",
    "HR Request Form": "8/1",
    "Acknowledgment Form": "9/1",
    "Material Request Form": "10/1",
    "Material Request Form (Arabic)": "10/1",
    "Vehicle Mileage Log": "11/1",
    "Vehicle Accident Report": "11/1",
    "Resignation Letter": "12/1",
    "Employee Clearance Form": "12/1",
    "Violation Form": "12/1",
    "Warning Form": "12/1",
    "Breach of Discipline Form": "12/1",
    "Promotion and Salary Increment Request Form": "12/1",
    "Employee Performance Appraisal Form": "12/1",
    "Manpower Requisition Form": "12/1",
    "Employment Application Form": "12/1",
    "Interview Assessment Form": "12/1",
    "Interview Scores Form": "12/1",
    "Employment Offer Letter": "12/1",
    "Employee Job Description": "12/1",
    "Employee Information Form": "12/1",
    "Employee Exit Form": "12/1",
    "Employee Exit Form – Project or Contract": "12/1",  # noqa: RUF001
    "Staff Attendance Form": "12/1",
    "Inmate Conduct Violations": "13/1",
    "Report": "13/1",
    "General Book": "15/1",
}
_OTHER_SERVICE = "other"
_TEMPLATE_SERVICE_ALIASES = {"Security Permit": "General Book"}
# (lower-cased subject prefix, service), longest first, as form_kind._PREFIX_TABLE.
_SUBJECT_PREFIXES = tuple(
    sorted(
        (
            *((service.lower(), service) for service in _SERVICE_RECORD_CATEGORY),
            ("resignation form", "Resignation Letter"),
            ("كتاب عام", "General Book"),
        ),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
)
_CATEGORY_PREFIX = "books.category."
_BACKUP = "_record_category_merge_backup"
_REQUEST_REASON = (
    "Closed by record-category permission migration: legacy category permissions "
    "were replaced. Submit a new request for the appropriate record category or service."
)


def _legacy_category(capability: str) -> str | None:
    if not capability.startswith(_CATEGORY_PREFIX):
        return None
    category = capability[len(_CATEGORY_PREFIX) :]
    return None if category in _CLASSIFICATIONS else category


def _subject_service(subject: str) -> str:
    lowered = subject.lower()
    for prefix, service in _SUBJECT_PREFIXES:
        if lowered.startswith(prefix):
            return service
    return _OTHER_SERVICE


def _record_services(book: sa.RowMapping) -> set[str]:
    """Every service the Python and SQL record resolvers can assign to ``book``."""
    if book["versioned"]:
        template = book["template_id"] or ""
        service = _TEMPLATE_SERVICE_ALIASES.get(template, template)
        return {service if service in _SERVICE_RECORD_CATEGORY else _OTHER_SERVICE}
    subject = book["subject"] or ""
    # resolve_service strips the subject; its SQL ILIKE mirror does not.
    services = {_subject_service(subject.strip()), _subject_service(subject)}
    # A version-less GS Word draft resolves by its marker while a session is open.
    if book["category_id"] == "GS":
        if book["ref_number"].startswith("REPORT-"):
            services.add("Report")
        elif book["classification_code"] is not None:
            services.add("General Book")
    return services


def _record_category(service: str, classification: str | None, category_id: str) -> str:
    """Frozen ``record_categories.record_category`` for a legacy ``category_id``."""
    if classification is not None:
        return classification
    if service != _OTHER_SERVICE:
        return _SERVICE_RECORD_CATEGORY[service]
    return _LEGACY_CATEGORY_RECORD_CATEGORY.get(category_id, "15/1")


def _uncovered_record_targets(
    connection: sa.Connection, category: str, targets: Sequence[str]
) -> tuple[str, ...]:
    """Denies that keep hidden each existing record in ``category`` that ``targets`` miss.

    The legacy deny hid a record by its stored category alone, whatever produced
    it. Records imported or entered by hand need not match the filing services,
    so their resolved service and record category may escape the mapped targets.
    """
    covered = set(targets)
    books = connection.execute(
        sa.text(
            "SELECT b.category_id, b.subject, b.ref_number, b.classification_code, "
            "EXISTS (SELECT 1 FROM book_versions v WHERE v.book_id = b.id) AS versioned, "
            "(SELECT v.template_id FROM book_versions v WHERE v.book_id = b.id "
            "ORDER BY v.version_no DESC LIMIT 1) AS template_id "
            "FROM books b WHERE b.category_id = :category"
        ),
        {"category": category},
    ).mappings()
    extra: set[str] = set()
    for book in books:
        classification = book["classification_code"]
        for service in _record_services(book):
            records = f"books.servicerecords.{service}"
            code = _record_category(service, classification, category)
            if records in covered or _CATEGORY_PREFIX + code in covered:
                continue
            # A classified record is hidden by its classification; any other by
            # its service records, which (unlike a category) leaves creation open.
            extra.add(
                _CATEGORY_PREFIX + classification if classification in _CLASSIFICATIONS else records
            )
    return tuple(sorted(extra))


def _remember(
    connection: sa.Connection,
    kind: str,
    key: Sequence[object],
    row: sa.RowMapping | None,
) -> None:
    # Plain SQL reads retain SQLite's original datetime text, including precision.
    # NULL row_data records a newly inserted target that downgrade must remove.
    connection.execute(
        sa.text(
            f"INSERT OR IGNORE INTO {_BACKUP} (kind, row_key, row_data) VALUES (:kind, :key, :data)"
        ),
        {
            "kind": kind,
            "key": json.dumps(key),
            "data": json.dumps(dict(row)) if row is not None else None,
        },
    )


def _copy_override(connection: sa.Connection, source: sa.RowMapping, target: str) -> None:
    key = {"user_id": source["user_id"], "capability": target}
    existing = (
        connection.execute(
            sa.text(
                "SELECT user_id, capability, effect, expires_at FROM user_permissions "
                "WHERE user_id = :user_id AND capability = :capability"
            ),
            key,
        )
        .mappings()
        .first()
    )
    if existing is None:
        if (
            source["effect"] == "grant"
            and target.removeprefix("books.servicerecords.").removeprefix("books.service.")
            in _OPT_IN_SERVICE_IDS
        ):
            return
        _remember(connection, "user", (source["user_id"], target), None)
        connection.execute(
            sa.text(
                "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
                "VALUES (:user_id, :capability, :effect, :expires_at)"
            ),
            {**key, "effect": source["effect"], "expires_at": source["expires_at"]},
        )
    elif source["effect"] == "deny":
        # Deny wins over a grant; two denies keep the later expiry, NULL (permanent)
        # dominating, so the merged deny lasts as long as either did.
        if existing["effect"] == "grant" or None in (source["expires_at"], existing["expires_at"]):
            deny_expiry = None
        else:
            deny_expiry = max(str(source["expires_at"]), str(existing["expires_at"]))
        if existing["effect"] != "deny" or existing["expires_at"] != deny_expiry:
            _remember(connection, "user", (source["user_id"], target), existing)
            connection.execute(
                sa.text(
                    "UPDATE user_permissions SET effect = 'deny', expires_at = :expires_at "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                {**key, "expires_at": deny_expiry},
            )
    elif source["effect"] == existing["effect"] == "grant" and source["expires_at"] is not None:
        source_expiry = str(source["expires_at"])
        if existing["expires_at"] is None or source_expiry < existing["expires_at"]:
            _remember(connection, "user", (source["user_id"], target), existing)
            connection.execute(
                sa.text(
                    "UPDATE user_permissions SET expires_at = :expires_at "
                    "WHERE user_id = :user_id AND capability = :capability"
                ),
                {**key, "expires_at": source_expiry},
            )


def upgrade() -> None:
    # Recovery metadata is deliberately independent of live-user foreign keys:
    # deleting a user after upgrade must not destroy the migration journal.
    op.create_table(
        _BACKUP,
        sa.Column("kind", sa.String(length=16), primary_key=True),
        sa.Column("row_key", sa.Text(), primary_key=True),
        sa.Column("row_data", sa.Text(), nullable=True),
    )
    connection = op.get_bind()
    overrides = (
        connection.execute(
            sa.text(
                "SELECT user_id, capability, effect, expires_at FROM user_permissions "
                "WHERE capability LIKE 'books.category.%' ORDER BY user_id, capability"
            )
        )
        .mappings()
        .all()
    )
    uncovered: dict[str, tuple[str, ...]] = {}
    for source in overrides:
        category = _legacy_category(source["capability"])
        if category is None:
            continue
        _remember(connection, "user", (source["user_id"], source["capability"]), source)
        services = _SERVICES_FILING_INTO_LEGACY_CATEGORY.get(category)
        if services:
            targets: tuple[str, ...] = tuple(
                f"{prefix}{service}"
                for service in (*services, _OTHER_SERVICE)
                for prefix in ("books.service.", "books.servicerecords.")
            )
        else:
            targets = (_CATEGORY_PREFIX + _LEGACY_CATEGORY_RECORD_CATEGORY.get(category, "15/1"),)
        if source["effect"] == "deny":
            if category not in uncovered:
                uncovered[category] = _uncovered_record_targets(connection, category, targets)
            targets = (*targets, *uncovered[category])
        for target in targets:
            _copy_override(connection, source, target)
        connection.execute(
            sa.text(
                "DELETE FROM user_permissions WHERE user_id = :user_id AND capability = :capability"
            ),
            {"user_id": source["user_id"], "capability": source["capability"]},
        )

    roles = (
        connection.execute(
            sa.text(
                "SELECT role, capability FROM role_permissions WHERE capability LIKE 'books.category.%'"
            )
        )
        .mappings()
        .all()
    )
    for row in roles:
        if _legacy_category(row["capability"]) is None:
            continue
        _remember(connection, "role", (row["role"], row["capability"]), row)
        connection.execute(
            sa.text("DELETE FROM role_permissions WHERE role = :role AND capability = :capability"),
            dict(row),
        )
    reporter_key = {"role": "inmate_reporter", "capability": "books.category.13/1"}
    reporter = (
        connection.execute(
            sa.text(
                "SELECT role, capability FROM role_permissions WHERE role = :role AND capability = :capability"
            ),
            reporter_key,
        )
        .mappings()
        .first()
    )
    if reporter is None:
        _remember(connection, "role", tuple(reporter_key.values()), None)
        connection.execute(
            sa.text(
                "INSERT OR IGNORE INTO role_permissions (role, capability) VALUES (:role, :capability)"
            ),
            reporter_key,
        )

    requests = (
        connection.execute(
            sa.text(
                "SELECT id, status, decision, note, decided_at, decided_by_user_id, capability "
                "FROM permission_requests WHERE status = 'pending' "
                "AND capability LIKE 'books.category.%'"
            )
        )
        .mappings()
        .all()
    )
    for row in requests:
        if _legacy_category(row["capability"]) is None:
            continue
        _remember(connection, "request", (row["id"],), row)
        connection.execute(
            sa.text(
                "UPDATE permission_requests SET status = 'refused', decision = 'refused', "
                "note = :note, decided_at = CURRENT_TIMESTAMP, decided_by_user_id = NULL "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "note": f"{row['note']}\n\n{_REQUEST_REASON}" if row["note"] else _REQUEST_REASON,
            },
        )


def downgrade() -> None:
    connection = op.get_bind()
    entries = (
        connection.execute(sa.text(f"SELECT kind, row_key, row_data FROM {_BACKUP}"))
        .mappings()
        .all()
    )
    for entry in entries:
        key = json.loads(entry["row_key"])
        row = json.loads(entry["row_data"]) if entry["row_data"] is not None else None
        if entry["kind"] == "user":
            parameters = {"user_id": key[0], "capability": key[1]}
            if row is None:
                connection.execute(
                    sa.text(
                        "DELETE FROM user_permissions WHERE user_id = :user_id AND capability = :capability"
                    ),
                    parameters,
                )
            elif (
                connection.scalar(sa.text("SELECT id FROM users WHERE id = :user_id"), parameters)
                is not None
            ):
                connection.execute(
                    sa.text(
                        "INSERT INTO user_permissions (user_id, capability, effect, expires_at) "
                        "VALUES (:user_id, :capability, :effect, :expires_at) "
                        "ON CONFLICT (user_id, capability) DO UPDATE "
                        "SET effect = excluded.effect, expires_at = excluded.expires_at"
                    ),
                    row,
                )
        elif entry["kind"] == "role":
            if row is None:
                connection.execute(
                    sa.text(
                        "DELETE FROM role_permissions WHERE role = :role AND capability = :capability"
                    ),
                    {"role": key[0], "capability": key[1]},
                )
            else:
                connection.execute(
                    sa.text(
                        "INSERT OR IGNORE INTO role_permissions (role, capability) VALUES (:role, :capability)"
                    ),
                    row,
                )
        elif entry["kind"] == "request":
            # Do not resurrect requests/users removed after upgrade, or an actor
            # removed since the snapshot (the live FK uses ON DELETE SET NULL).
            connection.execute(
                sa.text(
                    "UPDATE permission_requests SET status = :status, decision = :decision, "
                    "note = :note, decided_at = :decided_at, decided_by_user_id = "
                    "(SELECT id FROM users WHERE id = :decided_by_user_id) WHERE id = :id"
                ),
                row,
            )
    op.drop_table(_BACKUP)
