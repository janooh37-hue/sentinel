"""Leave service — CRUD, balance, and audit-log writes.

Phase 03 added :func:`list_for_employee` (read-only, for the Employees tab).
Phase 06 expands this module with full management operations.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.errors import NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import leave_lifecycle
from app.core.leave_calc import TOTAL_AVAILABLE_CAP, LeaveBalance
from app.db.models import AuditLog, Document, Employee, Leave, User
from app.schemas.leave import LeaveBalanceRead, LeaveCreate, LeaveStatus, LeaveUpdate

# ---------------------------------------------------------------------------
# Simple TTL cache for balance results
# key → (value, expires_at_monotonic)
# ---------------------------------------------------------------------------

log = logging.getLogger(__name__)

_balance_cache: dict[tuple[str, date], tuple[LeaveBalanceRead, float]] = {}
_CACHE_TTL = 60.0  # seconds


def _cache_get(key: tuple[str, date]) -> LeaveBalanceRead | None:
    entry = _balance_cache.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.monotonic() > expires_at:
        del _balance_cache[key]
        return None
    return value


def _cache_set(key: tuple[str, date], value: LeaveBalanceRead) -> None:
    _balance_cache[key] = (value, time.monotonic() + _CACHE_TTL)


def _cache_invalidate_employee(employee_id: str) -> None:
    """Remove all cached balance entries for an employee."""
    keys = [k for k in _balance_cache if k[0] == employee_id]
    for k in keys:
        del _balance_cache[k]


# ---------------------------------------------------------------------------
# SQLAlchemy-backed LeaveHistory Protocol adapter
# ---------------------------------------------------------------------------


# Statuses whose days never consume a balance (matched on canonical/English half
# so bilingual free-text like "Rejected - مرفوض" is excluded too).
_NON_CONSUMING_STATUSES = frozenset({"Rejected", "Cancelled"})


def _type_matches(row_leave_type: str, requested: str) -> bool:
    """Does a stored (often bilingual, inconsistent) ``leave_type`` belong to the
    balance bucket the calculator asked for?

    ``leave_calc`` asks for the bare words ``"Annual"`` and ``"Sick"``; rows are
    stored as anything from ``"Annual"`` to ``"Annual Leave - إجازة سنوية"``. We
    classify both sides the same way the rest of the app does instead of an exact
    string compare (the old bug: nothing matched, so taken was always 0)."""
    requested_norm = requested.strip().lower()
    if requested_norm in ("annual", "annual leave"):
        return leave_lifecycle.is_annual(row_leave_type)
    if requested_norm in ("sick", "sick leave"):
        return leave_lifecycle.classify_group(row_leave_type) == "sick"
    # Any other bucket: compare lifecycle groups (robust to bilingual labels).
    return leave_lifecycle.classify_group(row_leave_type) == leave_lifecycle.classify_group(
        requested
    )


def _sum_live_deduped(rows: list[Leave], leave_type: str) -> float:
    """Total balance-consuming days for ``leave_type`` across ``rows``.

    Filters out non-matching types and Rejected/Cancelled rows, then counts each
    distinct ``(start_date, end_date)`` span once — a regenerated or double-entered
    leave (same span) must not deduct twice. Rows arrive id-ascending, so the
    earliest row of a duplicate span wins (mirrors ``leave_dedupe`` keep policy)."""
    seen: set[tuple[date, date]] = set()
    total = 0.0
    for row in rows:
        if not _type_matches(row.leave_type, leave_type):
            continue
        if leave_lifecycle.canonical_status(row.status) in _NON_CONSUMING_STATUSES:
            continue
        span = (row.start_date, row.end_date)
        if span in seen:
            continue
        seen.add(span)
        total += float(row.days or 0)
    return total


class _DbLeaveHistory:
    """Adapts the ``leaves`` table to the :class:`~app.core.leave_calc.LeaveHistory` Protocol.

    Type/status filtering, and same-span deduplication, happen in Python: both
    ``leave_type`` and ``status`` are stored as inconsistent bilingual free-text,
    so an ORM equality filter is unsafe (see ``list_annual_overlapping``)."""

    def __init__(self, db: Session) -> None:
        self._db = db

    def get_employee_leaves_in_year(self, g_number: str, year: int, leave_type: str) -> float:
        stmt = (
            select(Leave)
            .where(
                Leave.employee_id == g_number,
                func.strftime("%Y", Leave.start_date) == str(year),
                Leave.deleted_at.is_(None),
            )
            .order_by(Leave.id)
        )
        rows = list(self._db.execute(stmt).scalars().all())
        return _sum_live_deduped(rows, leave_type)

    def get_employee_leaves_in_period(
        self,
        g_number: str,
        start: datetime,
        end: datetime,
        leave_type: str,
    ) -> float:
        stmt = (
            select(Leave)
            .where(
                Leave.employee_id == g_number,
                Leave.start_date >= start.date(),
                Leave.start_date <= end.date(),
                Leave.deleted_at.is_(None),
            )
            .order_by(Leave.id)
        )
        rows = list(self._db.execute(stmt).scalars().all())
        return _sum_live_deduped(rows, leave_type)


# _DbLeaveHistory satisfies the LeaveHistory Protocol — verified structurally.

# ---------------------------------------------------------------------------
# Phase 03 helper (preserved for backward compat — employees router still uses it)
# ---------------------------------------------------------------------------


def list_for_employee(db: Session, employee_id: str) -> list[Leave]:
    if db.get(Employee, employee_id) is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )
    stmt = (
        select(Leave)
        .where(Leave.employee_id == employee_id, Leave.deleted_at.is_(None))
        .order_by(Leave.start_date.desc(), Leave.id.desc())
    )
    return list(db.execute(stmt).scalars().all())


# ---------------------------------------------------------------------------
# Phase 06 — full management surface
# ---------------------------------------------------------------------------


def list_leaves(
    db: Session,
    *,
    employee_id: str | None = None,
    status: str | None = None,
    leave_type: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Leave], int]:
    """Paginated list; returns (rows, total)."""
    base = select(Leave)
    if not include_deleted:
        base = base.where(Leave.deleted_at.is_(None))
    if employee_id is not None:
        base = base.where(Leave.employee_id == employee_id)
    if status is not None:
        base = base.where(Leave.status == status)
    if leave_type is not None:
        base = base.where(Leave.leave_type == leave_type)
    if from_date is not None:
        base = base.where(Leave.start_date >= from_date)
    if to_date is not None:
        base = base.where(Leave.start_date <= to_date)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        base = base.where(
            or_(
                Leave.employee_id.ilike(needle),
                Leave.leave_type.ilike(needle),
            )
        )

    count_stmt = select(func.count()).select_from(base.subquery())
    total = db.execute(count_stmt).scalar_one()

    rows_stmt = (
        base.options(joinedload(Leave.employee))  # eager-load name (no N+1)
        .order_by(Leave.start_date.desc(), Leave.id.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list(db.execute(rows_stmt).scalars().all())
    return rows, total


def get_leave(db: Session, leave_id: int, *, include_deleted: bool = False) -> Leave:
    row = db.get(Leave, leave_id)
    if row is None:
        raise NotFoundError(
            "LEAVE_NOT_FOUND",
            f"Leave record {leave_id} does not exist",
            id=leave_id,
        )
    if not include_deleted and row.deleted_at is not None:
        raise NotFoundError(
            "LEAVE_NOT_FOUND",
            f"Leave record {leave_id} has been deleted",
            id=leave_id,
        )
    return row


def update_leave(
    db: Session, leave_id: int, payload: LeaveUpdate, *, actor: str | None = None
) -> Leave:
    """Apply a PATCH payload with per-kind lifecycle enforcement."""
    row = get_leave(db, leave_id)

    status_changed = False
    if payload.status is not None:
        old_status = row.status
        new_status: LeaveStatus = payload.status
        allowed = leave_lifecycle.allowed_transitions(row.leave_type, old_status)
        if new_status not in allowed:
            raise ValidationFailedError(
                "LEAVE_STATE_FORBIDDEN",
                f"Cannot transition from {old_status!r} to {new_status!r} for {row.leave_type!r}",
                current_status=old_status,
                requested_status=new_status,
            )
        row.status = new_status
        status_changed = True
        _audit(db, "leave.status_changed", leave_id, actor, {"from": old_status, "to": new_status})

    if payload.start_date is not None or payload.end_date is not None:
        if not leave_lifecycle.can_edit_dates(row.leave_type, row.status):
            raise ValidationFailedError(
                "LEAVE_DATES_FORBIDDEN",
                f"Dates of a {row.leave_type!r} record in state {row.status!r} cannot be edited",
                current_status=row.status,
            )
        new_start = payload.start_date if payload.start_date is not None else row.start_date
        new_end = payload.end_date if payload.end_date is not None else row.end_date
        if new_end < new_start:
            raise ValidationFailedError(
                "LEAVE_DATES_INVALID",
                "end_date must be on or after start_date",
            )
        old = {"start": str(row.start_date), "end": str(row.end_date), "days": row.days}
        row.start_date = new_start
        row.end_date = new_end
        row.days = (new_end - new_start).days + 1
        _audit(
            db,
            "leave.dates_changed",
            leave_id,
            actor,
            {"from": old, "to": {"start": str(new_start), "end": str(new_end), "days": row.days}},
        )

    if payload.notes is not None:
        row.notes = payload.notes

    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    _cache_invalidate_employee(row.employee_id)
    # Notify the employee of the new step (approved / rejected / cancelled).
    # Best-effort — a gateway hiccup must never fail the status change.
    if status_changed:
        try:
            from app.services import notify_dispatch

            notify_dispatch.auto_send_leave_status(db, leave_id)
        except Exception:
            log.exception("auto leave-status SMS failed for leave %s", leave_id)
    return row


def amend_approved_leave(
    db: Session, leave_id: int, *, end_date: date, reason: str, actor: str | None = None
) -> Leave:
    """Post-approval amendment: Annual + Approved only, end date/days only
    (start fixed), reason required. Notifies the employee (best-effort) with
    old vs new duration and the reason. Spec 2026-07-15."""
    row = get_leave(db, leave_id)
    if not leave_lifecycle.can_amend(row.leave_type, row.status):
        raise ValidationFailedError(
            "LEAVE_AMEND_FORBIDDEN",
            f"A {row.leave_type!r} record in state {row.status!r} cannot be amended",
            current_status=row.status,
        )
    if end_date < row.start_date:
        raise ValidationFailedError(
            "LEAVE_DATES_INVALID", "end_date must be on or after start_date"
        )
    old = {"end": str(row.end_date), "days": row.days}
    old_days = row.days
    row.end_date = end_date
    row.days = (end_date - row.start_date).days + 1
    row.notes = reason
    row.updated_at = _utcnow()
    _audit(
        db,
        "leave.amended",
        leave_id,
        actor,
        {"from": old, "to": {"end": str(end_date), "days": row.days}, "reason": reason},
    )
    db.commit()
    db.refresh(row)
    _cache_invalidate_employee(row.employee_id)
    # Best-effort — a gateway hiccup must never fail the amendment.
    try:
        from app.services import notify_dispatch

        notify_dispatch.auto_send_leave_amended(db, leave_id, old_days=old_days, reason=reason)
    except Exception:
        log.exception("auto leave-amended notification failed for leave %s", leave_id)
    return row


def create_leave(db: Session, payload: LeaveCreate, *, actor: str | None = None) -> Leave:
    """Manual record creation. v1 is National-Service-only — every other kind
    is born from form generation (document_service)."""
    if leave_lifecycle.classify_group(payload.leave_type) != "national_service":
        raise ValidationFailedError(
            "LEAVE_TYPE_UNSUPPORTED",
            "Manual records are National Service only; other kinds come from form generation",
            leave_type=payload.leave_type,
        )
    if db.get(Employee, payload.employee_id) is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {payload.employee_id!r} does not exist",
            id=payload.employee_id,
        )
    if payload.end_date < payload.start_date:
        raise ValidationFailedError(
            "LEAVE_DATES_INVALID", "end_date must be on or after start_date"
        )

    row = Leave(
        employee_id=payload.employee_id,
        leave_type=payload.leave_type,
        start_date=payload.start_date,
        end_date=payload.end_date,
        days=(payload.end_date - payload.start_date).days + 1,
        status=leave_lifecycle.birth_status(payload.leave_type),
        notes=payload.notes,
        request_date=_utcnow().date(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _audit(db, "leave.created", row.id, actor, {"leave_type": row.leave_type})
    _cache_invalidate_employee(row.employee_id)
    return row


# Path separators / control chars PLUS unicode bidi-control, zero-width and BOM
# codepoints (U+200B-U+200F, U+202A-U+202E, U+2066-U+2069, U+FEFF) that pass
# isalnum but enable display-name spoofing (e.g. RIGHT-TO-LEFT OVERRIDE).
_UNSAFE_CHARS = re.compile(
    # Path separators / control chars PLUS unicode bidi-control, zero-width
    # and BOM codepoints that pass ``isalnum`` but enable display-name
    # spoofing (e.g. U+202E RIGHT-TO-LEFT OVERRIDE in a filename).
    '[\\/:*?"<>|\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]'
)


def _safe_filename(filename: str) -> str:
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip().strip(".")
    return name or "certificate"


def add_certificate(
    db: Session, leave_id: int, filename: str, data: bytes, *, actor: str | None = None
) -> Leave:
    """Attach the National Service completion certificate; completes the record.

    Re-uploading on a Completed record replaces the file (status unchanged).
    """
    row = get_leave(db, leave_id)
    if not leave_lifecycle.accepts_certificate(row.leave_type):
        raise ValidationFailedError(
            "LEAVE_CERT_UNSUPPORTED",
            f"{row.leave_type!r} records do not take a completion certificate",
            leave_type=row.leave_type,
        )
    current = leave_lifecycle.canonical_status(row.status)
    if current not in ("Pending", "Completed"):
        raise ValidationFailedError(
            "LEAVE_STATE_FORBIDDEN",
            f"Cannot attach a certificate to a {row.status!r} record",
            current_status=row.status,
        )

    # Size guards — parity with book_service.add_attachment / MAX_ATTACHMENT_BYTES.
    MAX_CERTIFICATE_BYTES = 25 * 1024 * 1024  # 25 MiB
    if len(data) == 0:
        raise ValidationFailedError("LEAVE_CERT_EMPTY", "Uploaded certificate is empty")
    if len(data) > MAX_CERTIFICATE_BYTES:
        raise ValidationFailedError(
            "LEAVE_CERT_TOO_LARGE",
            f"Certificate exceeds {MAX_CERTIFICATE_BYTES // (1024 * 1024)} MiB",
            size=len(data),
        )

    data_dir = get_settings().data_dir
    dest_dir = data_dir / "leave_certificates" / str(leave_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / _safe_filename(filename)
    dest.write_bytes(data)

    row.certificate_path = dest.relative_to(data_dir).as_posix()
    # The certificate no longer completes NS — it is the proof that GATES the
    # return form. file_return() is what sets Completed. Status stays Pending.
    _audit(db, "leave.certificate_added", leave_id, actor, {"filename": dest.name})
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    _cache_invalidate_employee(row.employee_id)
    return row


def file_return(
    db: Session,
    leave_id: int,
    *,
    resumption_date: date,
    delay_reason: str | None = None,
    manager_id: int | None = None,
    actor: str | None = None,
    current_user: User | None = None,
) -> Leave:
    """File the Duty Resumption (return) form for a returnable leave.

    Generates the Duty Resumption document (auto-signature embed), attaches it
    to THIS leave (no standalone register row), records the return date, and
    sets status -> Completed. NS requires a certificate already on file.
    """
    from app.services import document_service  # local import: avoid cycle

    row = get_leave(db, leave_id)
    has_cert = bool(row.certificate_path)
    if not leave_lifecycle.can_file_return(row.leave_type, row.status, has_certificate=has_cert):
        if leave_lifecycle.classify_group(row.leave_type) == "national_service" and not has_cert:
            raise ValidationFailedError(
                "LEAVE_RETURN_NEEDS_CERTIFICATE",
                "Upload the completion certificate before filing the return form",
                current_status=row.status,
            )
        raise ValidationFailedError(
            "LEAVE_RETURN_FORBIDDEN",
            f"A {row.leave_type!r} record in state {row.status!r} cannot file a return form",
            current_status=row.status,
        )
    if resumption_date < row.start_date:
        raise ValidationFailedError(
            "LEAVE_RETURN_DATE_INVALID",
            "resumption_date must be on or after the leave start date",
        )

    fields: dict[str, Any] = {
        "first_date_leave": row.start_date.strftime("%d/%m/%Y"),
        "last_date_leave": row.end_date.strftime("%d/%m/%Y"),
        "leave_type": row.leave_type,
        "resumption_date": resumption_date.strftime("%d/%m/%Y"),
        "delay_reason": delay_reason or "",
    }
    document_service.generate_document(
        db,
        employee_id=row.employee_id,
        template_id="Duty Resumption Form",
        fields=fields,
        manager_id=manager_id,
        current_user=current_user,
        return_for_leave_id=leave_id,
    )

    # generate_document already linked the doc + committed. Now complete the leave.
    db.refresh(row)
    old = row.status
    row.return_date = resumption_date
    last_doc = (
        db.execute(
            select(Document).where(Document.leave_id == leave_id).order_by(Document.id.desc())
        )
        .scalars()
        .first()
    )
    row.return_doc_path = (last_doc.pdf_path or last_doc.docx_path) if last_doc else None
    row.status = "Completed"
    row.updated_at = _utcnow()
    _audit(db, "leave.status_changed", leave_id, actor, {"from": old, "to": "Completed"})
    _audit(
        db,
        "leave.return_filed",
        leave_id,
        actor,
        {"resumption_date": str(resumption_date)},
    )
    db.commit()
    db.refresh(row)
    _cache_invalidate_employee(row.employee_id)
    return row


def get_certificate_file(db: Session, leave_id: int) -> Path:
    row = get_leave(db, leave_id)
    if not row.certificate_path:
        raise NotFoundError(
            "LEAVE_CERT_NOT_FOUND", f"Leave {leave_id} has no certificate", id=leave_id
        )
    data_dir = get_settings().data_dir
    data_dir_resolved = data_dir.resolve()
    path = (data_dir / row.certificate_path).resolve()
    if data_dir_resolved not in path.parents or not path.is_file():
        raise NotFoundError(
            "LEAVE_CERT_NOT_FOUND", f"Certificate file for leave {leave_id} is missing", id=leave_id
        )
    return path


def soft_delete_leave(db: Session, leave_id: int, *, actor: str | None = None) -> None:
    row = get_leave(db, leave_id)
    row.deleted_at = _utcnow()
    row.updated_at = _utcnow()
    db.commit()
    _audit(db, "leave.deleted", leave_id, actor, {})
    _cache_invalidate_employee(row.employee_id)


def compute_balance(
    db: Session,
    employee_id: str,
    *,
    as_of: date,
) -> LeaveBalanceRead:
    cached = _cache_get((employee_id, as_of))
    if cached is not None:
        return cached

    emp = db.get(Employee, employee_id)
    if emp is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )

    history = _DbLeaveHistory(db)
    as_of_dt = datetime(as_of.year, as_of.month, as_of.day)
    doj_dt = datetime(emp.doj.year, emp.doj.month, emp.doj.day) if emp.doj is not None else None
    result = LeaveBalance(history).compute(employee_id, doj_dt, as_of=as_of_dt)

    # Available annual days = accrual + carry-over, capped (mirrors the
    # ``total_available`` clamp inside LeaveBalance._annual). Equivalent to
    # annual_remaining + annual_taken pre-clamp; computed here so the API
    # exposes the progress-meter denominator without recomputing the cap.
    annual_total = round(min(result.annual_accrued + result.carry_over, TOTAL_AVAILABLE_CAP), 1)

    balance_read = LeaveBalanceRead(
        employee_id=employee_id,
        as_of=as_of,
        annual_accrued=result.annual_accrued,
        annual_total=annual_total,
        annual_taken=result.annual_taken,
        annual_remaining=result.annual,
        sick_taken=result.sick_taken,
        sick_remaining=result.sick_remaining,
        carry_over=result.carry_over,
        eligible=result.eligible,
        message=result.message,
    )

    _cache_set((employee_id, as_of), balance_read)
    return balance_read


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    from datetime import UTC

    return datetime.now(UTC).replace(tzinfo=None)


def _audit(
    db: Session,
    action: str,
    leave_id: int,
    actor: str | None,
    payload: dict[str, Any],
) -> None:
    log = AuditLog(
        actor=actor,
        action=action,
        entity_type="leave",
        entity_id=str(leave_id),
        payload=json.dumps(payload),
    )
    db.add(log)
    db.commit()


def list_annual_overlapping(
    db: Session,
    *,
    month_start: date,
    month_end: date,
    duty_unit: str | None = None,
) -> list[Leave]:
    """Approved, non-deleted annual leaves overlapping [month_start, month_end].

    Overlap = start_date <= month_end AND end_date >= month_start. Annual-type
    and canonical-Approved filtering happen in Python (both are stored as
    inconsistent bilingual free-text, so an ORM equality filter is unsafe)."""
    stmt = select(Leave).where(
        Leave.deleted_at.is_(None),
        Leave.start_date <= month_end,
        Leave.end_date >= month_start,
    )
    if duty_unit is not None:
        stmt = stmt.join(Employee, Employee.id == Leave.employee_id).where(
            Employee.duty_unit == duty_unit
        )
    stmt = stmt.order_by(Leave.employee_id, Leave.start_date)
    rows = list(db.scalars(stmt))
    return [
        lv
        for lv in rows
        if leave_lifecycle.is_annual(lv.leave_type)
        and leave_lifecycle.canonical_status(lv.status) == "Approved"
    ]


__all__ = [
    "add_certificate",
    "compute_balance",
    "create_leave",
    "file_return",
    "get_certificate_file",
    "get_leave",
    "list_annual_overlapping",
    "list_for_employee",
    "list_leaves",
    "soft_delete_leave",
    "update_leave",
]
