"""Correct a live employee number without rewriting issued history.

Every metadata FK to employees.id follows the employee, including workforce
models. Operational non-FKs (supervisors, start acknowledgements, Word signers,
the legacy admin setting and pending inmate-report assignments) follow too.
Frozen timesheet_snapshot_rows, completed inmate-report stages and actors, audit
payloads and document field snapshots deliberately retain the number recorded then.
Generated DOCX/PDF bytes and filenames are never changed: only their stored
location pointers follow the vault folder move. Thumbnail caches are path-hashed
and therefore miss naturally after a move; leave/imported-book caches are cleared.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from sqlalchemy import JSON, Column, String, func, select, text
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, ValidationFailedError
from app.config import get_settings
from app.core.clock import utcnow
from app.db import workforce_models  # noqa: F401 -- register workforce metadata
from app.db.base import Base
from app.db.models import AppSetting, AuditLog, Employee, EmployeeFormerId, User, VaultFile
from app.schemas.employee_id_change import (
    EmployeeIdChangeImpactRead,
    EmployeeIdChangePreviewRead,
    ImpactKey,
)
from app.services import book_service, employee_service, leave_service

# These are live references deliberately lacking SQLite FK constraints.
_OPERATIONAL_COLUMNS = (
    ("employees", "supervisor_id"),
    ("timesheet_start_acks", "employee_id"),
    ("book_edit_sessions", "signer_employee_id"),
)
# Inmate-report assignees still owed a stage: the assigned person must remain
# recognisable. Once the stage is done the captured number is history.
_PENDING_ASSIGNEE_COLUMNS = (
    ("awaiting_review", "reviewer_employee_id"),
    ("awaiting_manager", "manager_employee_id"),
)


def employee_reference_columns() -> list[Column[Any]]:
    """Discover actual FKs, not names: future employee-linked tables follow too."""
    return [
        column
        for table in Base.metadata.tables.values()
        for column in table.columns
        if any(fk.target_fullname == "employees.id" for fk in column.foreign_keys)
    ]


def _count(db: Session, table_name: str, employee_id: str, *, live: bool = False) -> int:
    table = Base.metadata.tables[table_name]
    query = select(func.count()).select_from(table).where(table.c.employee_id == employee_id)
    if live:
        query = query.where(table.c.deleted_at.is_(None))
    return int(db.scalar(query) or 0)


def _impact(db: Session, employee_id: str) -> list[EmployeeIdChangeImpactRead]:
    # Attendance tab's employee_attendance_range reads attendance_cases: count
    # persisted shift/day cases, not provider punches (which belong to a provider
    # person, and raw history is fetched externally rather than persisted).
    counts: dict[ImpactKey, int] = {
        "documents": _count(db, "documents", employee_id),
        "leaves": _count(db, "leaves", employee_id, live=True),
        "violations": _count(db, "violations", employee_id),
        "absences": _count(db, "absences", employee_id),
        "attendance": _count(db, "attendance_cases", employee_id),
        # Live employee-specific rows; frozen snapshots intentionally excluded.
        "timesheet": sum(
            _count(db, name, employee_id)
            for name in (
                "timesheet_overrides",
                "timesheet_stat_fillers",
                "timesheet_start_acks",
                "timesheet_roster_assignments",
            )
        ),
        "messages": sum(
            _count(db, name, employee_id)
            for name in ("sms_messages", "whatsapp_messages", "outbound_messages")
        ),
        "uniform": _count(db, "uniform_issues", employee_id),
        "vault_files": _count(db, "vault_files", employee_id),
    }
    # Include files imported without VaultFile rows, without counting tracked
    # files twice. A missing tracked file still represents a linked record.
    folder = get_settings().vault_dir / employee_id
    tracked = {
        _canonical_path(str(path))
        for path in db.scalars(select(VaultFile.path).where(VaultFile.employee_id == employee_id))
    }
    if folder.is_dir():
        root = get_settings().vault_dir
        counts["vault_files"] += sum(
            1
            for path in folder.rglob("*")
            if path.is_file() and path.relative_to(root).as_posix() not in tracked
        )
    return [EmployeeIdChangeImpactRead(key=key, count=count) for key, count in counts.items()]


def preview(db: Session, employee_id: str, new_id: str) -> EmployeeIdChangePreviewRead:
    employee_service.get_employee(db, employee_id)
    normalized = new_id.strip().upper()
    result = EmployeeIdChangePreviewRead(
        new_id=normalized, status="ok", impact=_impact(db, employee_id)
    )
    if re.fullmatch(r"G\d{3,4}", normalized) is None:
        result.status = "invalid"
    elif normalized == employee_id:
        result.status = "same"
    else:
        owner = db.get(Employee, normalized) or employee_service.former_number_owner(
            db, normalized, excluding=employee_id
        )
        if owner is not None:
            result.status = "taken"
            result.owner_id = owner.id
            result.owner_name_en = owner.name_en
            result.owner_name_ar = owner.name_ar
    return result


def _canonical_path(value: str) -> str:
    return value.replace("\\", "/")


def _path_prefixes(old: str, new: str) -> list[tuple[str, str]]:
    settings = get_settings()
    return list(
        dict.fromkeys(
            (
                (
                    _canonical_path(str(settings.vault_dir / old)),
                    _canonical_path(str(settings.vault_dir / new)),
                ),
                (f"vault/{old}", f"vault/{new}"),
                (old, new),
            )
        )
    )


def _rewrite_path(value: object, prefixes: list[tuple[str, str]]) -> object:
    if isinstance(value, str):
        canonical = _canonical_path(value)
        for old, new in prefixes:
            if canonical == old or canonical.startswith(old + "/"):
                return new + canonical[len(old) :]
        return value
    if isinstance(value, list):
        return [_rewrite_path(item, prefixes) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite_path(item, prefixes) for key, item in value.items()}
    return value


def _rewrite_stored_paths(db: Session, old: str, new: str) -> None:
    prefixes = _path_prefixes(old, new)
    for table in Base.metadata.tables.values():
        for column in table.columns:
            # Only location columns, never free text, form fields or audit JSON.
            if "path" not in column.name and column.name != "source_file":
                continue
            if isinstance(column.type, String):
                canonical = func.replace(column, "\\", "/")
                for before, after in prefixes:
                    db.execute(
                        table.update()
                        .where(canonical.startswith(before + "/", autoescape=True))
                        .values({column.name: after + func.substr(canonical, len(before) + 1)})
                    )
            elif isinstance(column.type, JSON):
                primary_keys = list(table.primary_key.columns)
                for row in db.execute(select(*primary_keys, column)).all():
                    value = row[-1]
                    rewritten = _rewrite_path(value, prefixes)
                    if rewritten != value:
                        statement = table.update()
                        for index, pk in enumerate(primary_keys):
                            statement = statement.where(pk == row[index])
                        db.execute(statement.values({column.name: rewritten}))


def change(db: Session, user: User, employee_id: str, new_id: str, reason: str) -> Employee:
    """Move folder before commit; roll both DB and filesystem back on failure."""
    source: Path | None = None
    destination: Path | None = None
    moved = False
    try:
        # Serialize validation/reservation against other SQLite writers. Auth
        # can already have opened a SQLAlchemy transaction, but sqlite3 normally
        # hasn't begun its physical transaction until the first write.
        connection = db.connection()
        driver = connection.connection.driver_connection
        if connection.dialect.name == "sqlite" and driver is not None and not driver.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        db.execute(text("PRAGMA defer_foreign_keys = ON"))
        result = preview(db, employee_id, new_id)
        if result.status == "invalid":
            raise ValidationFailedError("EMPLOYEE_ID_INVALID", "Use G followed by 3 or 4 digits.")
        if result.status == "same":
            raise ConflictError("EMPLOYEE_ID_SAME", "The employee already has this number.")
        if result.status == "taken":
            raise ConflictError(
                "EMPLOYEE_ID_TAKEN",
                "This number belongs to another employee.",
                owner_id=result.owner_id,
                owner_name_en=result.owner_name_en,
                owner_name_ar=result.owner_name_ar,
            )
        reason = reason.strip()
        if not 5 <= len(reason) <= 500:
            raise ValidationFailedError(
                "EMPLOYEE_ID_REASON_INVALID", "Reason must be 5-500 characters."
            )
        new_id = result.new_id
        settings = get_settings()
        source = settings.vault_dir / employee_id
        destination = settings.vault_dir / new_id
        if destination.exists() or destination.is_symlink():
            raise ConflictError(
                "EMPLOYEE_ID_VAULT_CONFLICT", "The target vault folder already exists."
            )
        now = utcnow()
        actor_id, actor_name = user.id, user.employee_id or user.email
        for column in employee_reference_columns():
            db.execute(
                column.table.update().where(column == employee_id).values({column.name: new_id})
            )
        for table_name, column_name in _OPERATIONAL_COLUMNS:
            table = Base.metadata.tables[table_name]
            db.execute(
                table.update()
                .where(table.c[column_name] == employee_id)
                .values({column_name: new_id})
            )
        workflows = Base.metadata.tables["inmate_violation_workflows"]
        for state, column_name in _PENDING_ASSIGNEE_COLUMNS:
            db.execute(
                workflows.update()
                .where(workflows.c.state == state, workflows.c[column_name] == employee_id)
                .values({column_name: new_id})
            )
        db.execute(
            Base.metadata.tables["employees"]
            .update()
            .where(Employee.id == employee_id)
            .values(id=new_id, updated_at=now)
        )
        admin = db.get(AppSetting, "settings.admin_employee_id")
        if admin is not None and admin.value == json.dumps(employee_id):
            admin.value = json.dumps(new_id)
        _rewrite_stored_paths(db, employee_id, new_id)
        db.add(
            EmployeeFormerId(
                employee_id=new_id,
                former_id=employee_id,
                new_id=new_id,
                changed_at=now,
                changed_by_user_id=actor_id,
                reason=reason,
            )
        )
        db.add(
            AuditLog(
                actor=actor_name,
                action="employee.id.changed",
                entity_type="employee",
                entity_id=new_id,
                payload=json.dumps({"former_id": employee_id, "new_id": new_id, "reason": reason}),
                ts=now,
            )
        )
        db.flush()
        if source.exists():
            source.rename(destination)
            moved = True
        db.commit()
    except Exception:
        db.rollback()
        if moved and source is not None and destination is not None:
            destination.rename(source)
        raise
    # Core updates may have changed primary keys in the identity map (employee
    # and attendance profile). Drop stale identities rather than reload old PKs.
    db.expunge_all()
    leave_service._cache_invalidate_employee(employee_id)
    leave_service._cache_invalidate_employee(new_id)
    book_service._resolve_imported_paths.cache_clear()
    return employee_service.get_employee(db, new_id)
