"""Employee read/write helpers used by the routes.

Keeps two responsibilities in one place because they're inseparable:

1. Translating between SQLAlchemy rows and Pydantic schemas.
2. Re-running the ``status``/``end_date`` invariant on PATCH after merging
   the partial payload against the current row — the schema can't do this
   because it doesn't see the existing values.

Pagination uses ``limit``/``offset`` (not cursors) because the working set
is small (272 employees in live data) and the React side already wants a
``total`` count for the list header.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Final, cast

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.api.errors import ConflictError, NotFoundError, ValidationFailedError
from app.db.models import Employee
from app.schemas.employee import (
    EMPLOYEE_STATUS_ACTIVE,
    EMPLOYEE_STATUS_RESIGNED,
    EMPLOYEE_STATUS_TERMINATED,
    SITE_STATUSES,
    EmployeeCreate,
    EmployeeUpdate,
    validate_status_end_date,
    validate_transfer_fields,
)
from app.services import employee_status_history as history
from app.services import workforce_schedule_service
from app.services.extraction_service import _MATCH_THRESHOLD, _name_scores

LIST_MAX_LIMIT = 500
LIST_DEFAULT_LIMIT = 100


def list_employees(
    db: Session,
    *,
    q: str | None = None,
    status: str | None = None,
    department: str | None = None,
    duty_unit: str | None = None,
    pending: bool = False,
    limit: int = LIST_DEFAULT_LIMIT,
    offset: int = 0,
) -> tuple[list[Employee], int]:
    """Filtered + paginated list. Returns ``(rows, total_count)``.

    ``q`` also matches ``uae_id_no``/``passport_no``. When the exact/ILIKE pass
    returns zero rows and ``q`` isn't pure digits, falls back to rapidfuzz
    name matching (``token_sort_ratio`` >= ``extraction_service._MATCH_THRESHOLD``),
    ordered by score then name (or by ``end_date`` when ``pending=True``, to
    match the exact-match ordering below).

    ``pending=True`` narrows to scheduled departures — Active employees with a
    ``pending_status`` and an ``end_date`` — ordered soonest-first, which is what
    the dashboard's Pending Departures widget reads.
    """
    limit = max(1, min(limit, LIST_MAX_LIMIT))
    offset = max(0, offset)
    stripped = q.strip() if q else ""
    stmt = select(Employee)
    count_stmt = select(func.count()).select_from(Employee)

    non_q_clauses: list[Any] = []

    if q:
        needle = f"%{stripped}%"
        clause = or_(
            Employee.id.ilike(needle),
            Employee.name_en.ilike(needle),
            Employee.name_ar.ilike(needle),
            Employee.uae_id_no.ilike(needle),
            Employee.passport_no.ilike(needle),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
    if status:
        clause = Employee.status == status
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
        non_q_clauses.append(clause)
    if department:
        clause = Employee.department == department
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
        non_q_clauses.append(clause)
    if duty_unit:
        clause = Employee.duty_unit == duty_unit
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
        non_q_clauses.append(clause)
    if pending:
        # Scheduled departure: still Active, but headed somewhere on end_date.
        clause = and_(
            Employee.status == EMPLOYEE_STATUS_ACTIVE,
            Employee.pending_status.is_not(None),
            Employee.end_date.is_not(None),
        )
        stmt = stmt.where(clause)
        count_stmt = count_stmt.where(clause)
        non_q_clauses.append(clause)

    # Soonest departure first when listing pending; otherwise by name.
    order = Employee.end_date if pending else Employee.name_en
    stmt = stmt.order_by(order).limit(limit).offset(offset)

    rows = list(db.execute(stmt).scalars().all())
    total = int(db.execute(count_stmt).scalar_one())

    if stripped and total == 0 and not stripped.isdigit():
        # ponytail: full-table scan below — fine at current employee-table size
        # (hundreds); add an indexed/trigram search if the roster grows into
        # the thousands.
        fuzzy_stmt = select(Employee).where(*non_q_clauses)
        candidates = list(db.execute(fuzzy_stmt).scalars().all())

        matches: list[tuple[Employee, float]] = [
            (cast(Employee, emp), score)
            for emp, score in _name_scores(stripped, candidates)
            if score >= _MATCH_THRESHOLD
        ]
        if pending:
            matches.sort(key=lambda t: (t[0].end_date, t[0].name_en))
        else:
            matches.sort(key=lambda t: (-t[1], t[0].name_en))

        total = len(matches)
        rows = [emp for emp, _score in matches[offset : offset + limit]]

    return rows, total


def get_employee(db: Session, employee_id: str) -> Employee:
    row = db.get(Employee, employee_id)
    if row is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND",
            f"Employee {employee_id!r} does not exist",
            id=employee_id,
        )
    return row


def _validate_transfer(
    status: str,
    end_date: date | None,
    site: str | None,
    return_date: date | None,
) -> None:
    try:
        validate_transfer_fields(status, end_date, site, return_date)
    except ValueError as exc:
        raise ValidationFailedError(
            "EMPLOYEE_INVALID_TRANSFER",
            str(exc),
            status=status,
            end_date=str(end_date) if end_date else None,
            transfer_site=site,
            transfer_return_date=str(return_date) if return_date else None,
        ) from exc


def create_employee(
    db: Session, payload: EmployeeCreate, *, actor_user_id: int | None = None
) -> Employee:
    existing = db.get(Employee, payload.id)
    if existing is not None:
        raise ConflictError(
            "EMPLOYEE_EXISTS",
            f"Employee {payload.id!r} already exists",
            id=payload.id,
        )
    data = payload.model_dump()
    target: str = payload.status
    end = payload.end_date
    # Transfers and loans keep a site / return date.
    if target in SITE_STATUSES:
        data["transfer_site"] = (payload.transfer_site or "").strip() or None
    else:
        data["transfer_site"] = None
        data["transfer_return_date"] = None
    site: str | None = data["transfer_site"]
    return_date: date | None = data["transfer_return_date"]
    scheduled = target != EMPLOYEE_STATUS_ACTIVE and end is not None and end > date.today()
    if scheduled:
        # Same rule as update_employee: a future departure stays Active.
        data["pending_status"] = target
        data["status"] = EMPLOYEE_STATUS_ACTIVE
    row = Employee(**data)
    db.add(row)
    if target != EMPLOYEE_STATUS_ACTIVE:
        history.record_status_event(
            db,
            payload.id,
            from_status=EMPLOYEE_STATUS_ACTIVE,
            to_status=target,
            effective_date=end,
            kind=history.KIND_SCHEDULED if scheduled else history.KIND_CHANGED,
            source=history.SOURCE_MANUAL,
            actor_user_id=actor_user_id,
            site=site,
            return_date=return_date,
        )
    db.commit()
    db.refresh(row)
    return row


def update_employee(
    db: Session,
    employee_id: str,
    payload: EmployeeUpdate,
    *,
    actor_user_id: int | None = None,
) -> Employee:
    """Patch an employee, recording status history for real status changes.

    History rules (``employee_status_events``):

    * immediate change (today-or-past ``end_date``, status differs) -> ``changed``;
    * future-dated change -> ``scheduled`` (row stays Active with
      ``pending_status``); re-scheduling a different target/date/site records a
      fresh ``scheduled``;
    * clearing ``end_date`` on an Active row with a pending departure ->
      ``scheduled_cancelled``;
    * non-Active -> Active -> ``changed`` dated ``effective_date`` (default
      today) with the old transfer site;
    * no-op edits (the form re-sending the same status/end_date) and edits that
      only touch ``transfer_site`` / ``transfer_return_date`` of an
      already-Transferred or Loaned employee record nothing.

    ``effective_date`` is write-only: it never reaches the row.
    """
    row = get_employee(db, employee_id)
    data: dict[str, Any] = payload.model_dump(exclude_unset=True)
    effective_date_in: date | None = data.pop("effective_date", None)

    # A human-entered/confirmed passport number is provenance 'manual'.
    if "passport_no" in data:
        data["passport_no_source"] = "manual"

    old_status = row.status
    old_end = row.end_date
    old_pending = row.pending_status
    old_site = row.transfer_site
    old_return = row.transfer_return_date

    # Merge the patch over the current row to evaluate the invariant.
    merged_status = data.get("status", row.status)
    merged_end = data.get("end_date", row.end_date)
    requested_status = merged_status

    # Validate the REQUESTED target (before a future date becomes a scheduled
    # change). Transfers and loans inherit the row's site / return date; for
    # any other target only an explicit payload return date is checked, so
    # leaving either status is not rejected for the row's stale return date.
    if requested_status in SITE_STATUSES:
        req_site = data.get("transfer_site", old_site)
        req_return = data.get("transfer_return_date", old_return)
    else:
        req_site = None
        req_return = data.get("transfer_return_date")
    _validate_transfer(requested_status, merged_end, req_site, req_return)

    # Scheduled departure. A departure dated in the FUTURE keeps the employee
    # Active through their notice period — they are still working — and records
    # where they are headed in `pending_status`; the daily flip job applies it
    # on the day. Today-or-past applies immediately, which is the pre-existing
    # behaviour and the path for someone who walked off site today.
    #
    # This lives in the service, not in StatusDialog, so the full EmployeeForm
    # gets the same rule and there is one place to be correct.
    # A Transferred or Loaned employee is already off this roster, so a later departure
    # (e.g. resigning from the new site) applies at once instead of putting them
    # back to Active for a notice period they are not serving here.
    is_scheduled_departure = (
        merged_status != EMPLOYEE_STATUS_ACTIVE
        and merged_end is not None
        and merged_end > date.today()
        and row.status not in SITE_STATUSES
    )
    # A REAL reactivation, not merely a payload that happens to carry the
    # employee's current status. EmployeeForm submits every field it renders,
    # so an admin editing a phone number sends status='Active' unchanged — that
    # must not cancel a departure they never touched.
    is_reactivation = (
        data.get("status") == EMPLOYEE_STATUS_ACTIVE and row.status != EMPLOYEE_STATUS_ACTIVE
    )
    is_end_date_cleared = "end_date" in data and data["end_date"] is None
    # An immediate (today-or-past) departure supersedes a scheduled one: the
    # marker must not outlive it, or a now-Terminated employee keeps showing a
    # stale "Resigned" badge. The schedule branch already claims every
    # future-dated case, so a non-Active status here is applying now.
    is_immediate_departure = merged_status != EMPLOYEE_STATUS_ACTIVE

    if is_scheduled_departure:
        data["pending_status"] = merged_status
        data["status"] = EMPLOYEE_STATUS_ACTIVE
        merged_status = EMPLOYEE_STATUS_ACTIVE
    elif is_reactivation or is_end_date_cleared or is_immediate_departure:
        # Clearing the end date is the widget's Cancel path — it sends
        # {end_date: null} alone, which validate_status_end_date already
        # refuses on an already-departed row.
        data["pending_status"] = None

    try:
        validate_status_end_date(merged_status, merged_end)
    except ValueError as exc:
        raise ValidationFailedError(
            "EMPLOYEE_INVALID_STATUS_END_DATE",
            str(exc),
            status=merged_status,
            end_date=str(merged_end) if merged_end else None,
        ) from exc

    # Site fields live on the row only while Transferred or Loaned, or while
    # either status is pending. Leaving them (including reactivation) clears both.
    final_status = data.get("status", row.status)
    final_pending = data.get("pending_status", row.pending_status)
    if final_status in SITE_STATUSES or final_pending in SITE_STATUSES:
        if requested_status in SITE_STATUSES:
            data["transfer_site"] = (req_site or "").strip() or None
            data["transfer_return_date"] = req_return
        else:
            # e.g. a full EmployeeForm save (status still 'Active') on a row
            # with a PENDING transfer or loan: its site fields arrive as nulls,
            # but the departure is still pending, so keep the stored site/return.
            data.pop("transfer_site", None)
            data.pop("transfer_return_date", None)
    else:
        data["transfer_site"] = None
        data["transfer_return_date"] = None
    if is_reactivation:
        data["end_date"] = None

    # --- status history -------------------------------------------------
    today = date.today()
    event: dict[str, Any] | None = None
    new_site: str | None = data.get("transfer_site", old_site)
    new_return: date | None = data.get("transfer_return_date", old_return)
    if is_scheduled_departure:
        unchanged = (
            old_status == EMPLOYEE_STATUS_ACTIVE
            and old_pending == requested_status
            and old_end == merged_end
            and old_site == new_site
            and old_return == new_return
        )
        if not unchanged:
            event = {
                "from_status": EMPLOYEE_STATUS_ACTIVE,
                "to_status": requested_status,
                "effective_date": merged_end,
                "kind": history.KIND_SCHEDULED,
                "site": new_site,
                "return_date": new_return,
            }
    elif is_reactivation:
        event = {
            "from_status": old_status,
            "to_status": EMPLOYEE_STATUS_ACTIVE,
            "effective_date": effective_date_in or today,
            "kind": history.KIND_CHANGED,
            "site": old_site,
            "return_date": None,
        }
    elif old_status == EMPLOYEE_STATUS_ACTIVE and old_pending and is_end_date_cleared:
        event = {
            "from_status": EMPLOYEE_STATUS_ACTIVE,
            "to_status": old_pending,
            "effective_date": old_end,
            "kind": history.KIND_SCHEDULED_CANCELLED,
            "site": old_site,
            "return_date": old_return,
        }
    elif is_immediate_departure and old_status != requested_status:
        event = {
            "from_status": old_status,
            "to_status": requested_status,
            "effective_date": merged_end,
            "kind": history.KIND_CHANGED,
            "site": new_site,
            "return_date": new_return,
        }
    elif (
        old_status == EMPLOYEE_STATUS_ACTIVE
        and old_pending
        and final_status == EMPLOYEE_STATUS_ACTIVE
        and data.get("end_date") is not None
        and data["end_date"] != old_end
    ):
        # Only the date of an already-pending departure moved.
        event = {
            "from_status": EMPLOYEE_STATUS_ACTIVE,
            "to_status": old_pending,
            "effective_date": data["end_date"],
            "kind": history.KIND_SCHEDULED,
            "site": new_site,
            "return_date": new_return,
        }
    if event is not None:
        history.record_status_event(
            db,
            row.id,
            source=history.SOURCE_MANUAL,
            actor_user_id=actor_user_id,
            **event,
        )

    for k, v in data.items():
        setattr(row, k, v)
    if "duty_unit" in data:
        # A raw duty-unit edit changes only this row; the crew that actually
        # generates shifts is `WorkCrewMembership`, which never moved on its
        # own. This keeps shift generation and duty hierarchy pointed at the
        # same place instead of drifting apart (idempotent - a no-op when the
        # employee is unmapped, unenrolled, or already on the right crew).
        workforce_schedule_service.reconcile_duty_crew_membership(
            db, employee_id=row.id, effective_at=datetime.now(UTC)
        )
    db.commit()
    db.refresh(row)
    return row


# Only these may be promoted out of `pending_status` into `status`.
_PENDING_TARGETS: Final[frozenset[str]] = frozenset(
    {EMPLOYEE_STATUS_RESIGNED, EMPLOYEE_STATUS_TERMINATED}
) | SITE_STATUSES


def apply_due_departures(db: Session, *, today: date | None = None) -> list[Employee]:
    """Flip every scheduled departure that has come due. Returns the rows moved.

    A pending departure is `status == 'Active'` with a `pending_status` and an
    `end_date`. On or after that date the employee becomes what
    `pending_status` says and the pending marker is cleared. `end_date` is
    already correct, so it is never rewritten.

    Idempotent: clearing `pending_status` means a second run the same day moves
    nothing. A missed run (deploy, restart) is caught up on the next one,
    because the filter is `<= today` rather than `== today`.

    `pending_status` is free text — SQLite has no enum — so the filter is
    restricted to the legal targets (`_PENDING_TARGETS`). A hand-edited or imported junk value is
    left in place rather than promoted into `status`.
    """
    cutoff = today or date.today()
    rows = list(
        db.scalars(
            select(Employee).where(
                Employee.status == EMPLOYEE_STATUS_ACTIVE,
                Employee.pending_status.in_(tuple(_PENDING_TARGETS)),
                Employee.end_date.is_not(None),
                Employee.end_date <= cutoff,
            )
        )
    )
    for row in rows:
        # The `or` is unreachable — the WHERE clause admits only the legal
        # targets, never NULL — but `pending_status` is `str | None`, so it is
        # what narrows the type for the assignment. Not a real fallback.
        target = row.pending_status or EMPLOYEE_STATUS_ACTIVE
        history.record_status_event(
            db,
            row.id,
            from_status=EMPLOYEE_STATUS_ACTIVE,
            to_status=target,
            effective_date=row.end_date,
            kind=history.KIND_APPLIED,
            source=history.SOURCE_SCHEDULER,
            site=row.transfer_site,
            return_date=row.transfer_return_date,
        )
        row.status = target
        row.pending_status = None
    if rows:
        db.commit()
    return rows


def apply_due_transfer_returns(
    db: Session, *, today: date | None = None
) -> list[tuple[Employee, date, str | None, str]]:
    """Return Transferred or Loaned employees whose expected return date has come.

    Each employee with a status in ``SITE_STATUSES`` and
    ``transfer_return_date <= today`` becomes Active again; ``end_date``,
    ``transfer_site``, ``transfer_return_date`` and ``pending_status`` are
    cleared and an ``applied`` event from the prior status to Active is recorded
    dated the return date. Returns ``(employee, return_date, old_site, old_status)``
    per row moved. Idempotent (the return date is cleared) and catches up missed runs.
    """
    cutoff = today or date.today()
    rows = list(
        db.scalars(
            select(Employee).where(
                Employee.status.in_(SITE_STATUSES),
                Employee.transfer_return_date.is_not(None),
                Employee.transfer_return_date <= cutoff,
            )
        )
    )
    moved: list[tuple[Employee, date, str | None, str]] = []
    for row in rows:
        returned_on = cast(date, row.transfer_return_date)
        site = row.transfer_site
        old_status = row.status
        history.record_status_event(
            db,
            row.id,
            from_status=row.status,
            to_status=EMPLOYEE_STATUS_ACTIVE,
            effective_date=returned_on,
            kind=history.KIND_APPLIED,
            source=history.SOURCE_SCHEDULER,
            site=site,
        )
        row.status = EMPLOYEE_STATUS_ACTIVE
        row.end_date = None
        row.pending_status = None
        row.transfer_site = None
        row.transfer_return_date = None
        moved.append((row, returned_on, site, old_status))
    if rows:
        db.commit()
    return moved


__all__ = [
    "LIST_DEFAULT_LIMIT",
    "LIST_MAX_LIMIT",
    "apply_due_departures",
    "apply_due_transfer_returns",
    "create_employee",
    "get_employee",
    "list_employees",
    "update_employee",
]
