"""Internal-transfer service.

``transfer`` moves one or more employees, each to its OWN destination duty
unit/post, and mints an official **General Book** transfer letter as the audit
record. One letter therefore covers a whole transfer round: the selected
employees may come from different units and each row carries its own
destination, which is exactly what the letter's fixed intro promises (إلى
الجهات المبينة بجانب أسمائهم) — a straight swap is expressible. The letter body
is server-built HTML — a formal Arabic intro paragraph, a red-header 5-column
``<table>`` (الرقم الوظيفي · المسمى الوظيفي · الاسم · من · إلى) with one row per
moved employee, and two closing lines — which the General Book renderer
(``core/arabic_rtl.html_to_docx`` via ``_pp_general_book``) turns into a real,
variable-length RTL Word table. Subject constant: ``النقل``.

When every selected employee is currently unassigned, the move is initial placement and no book/email is produced.
``recipient_id``, ``manager_id``, and ``cc`` are forwarded into the General Book
pipeline's ``fields`` dict; the adapter resolves the addressee name and joins CC.

Transaction note: ``document_service.generate_document`` owns its own commit. We
stage the employee ``duty_unit``/``duty_post`` mutations on the same session
*before* calling it (after building the FROM column from their current values),
so the doc/Book/Document rows AND the employee moves land in that single commit
together. The General Book's signing path is ``chain`` → the Book lands
``approval_state="none"`` (not auto-approved), consistent with every other
General Book.
"""

from __future__ import annotations

import html
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.db.models import Employee, User
from app.db.workforce_models import DutyAssignmentEvent
from app.schemas.duty import DutyTransferMove, DutyTransferResult
from app.schemas.employee import EMPLOYEE_STATUS_TRANSFERRED, WORKING_STATUSES
from app.services import book_service, document_service, workforce_schedule_service

# Event types written when an employee's status crosses the working boundary.
# They carry no actor when the scheduler or the 0120 backfill writes them.
EVENT_SERVICE_END: Final = "service_end"
EVENT_TRANSFER_OUT: Final = "transfer_out"
EVENT_REINSTATEMENT: Final = "reinstatement"
DEPARTURE_EVENT_TYPES: Final[tuple[str, ...]] = (EVENT_SERVICE_END, EVENT_TRANSFER_OUT)

_UNSPECIFIED = "غير محدد"
_SUBJECT = "النقل"

_INTRO = (
    "ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المرفق إلى الجهات "
    "المبينة بجانب أسمائهم إعتباراً من تاريخه ."
)

_COLS = ["الرقم الوظيفي", "المسمى الوظيفي", "الاسم", "من", "إلى"]
_TH = (
    "border:1px solid #000000;background:#C00000;color:#ffffff;"
    "padding:4px 9px;text-align:center;font-weight:bold"
)
_TD = "border:1px solid #000000;padding:4px 9px;text-align:center"
_SPACER = "<p>&nbsp;</p>"


def _event_hierarchy(
    employee: Employee, unit: str | None, post: str | None
) -> tuple[str | None, str | None, str | None]:
    """Return a hierarchy-prefix-safe snapshot for a duty event.

    The department is recorded when the employee has one and left absent when
    they do not: most of this roster is placed by duty unit alone, and the unit
    and post are the placement worth keeping.  Only a post with no unit is
    dropped, because that is not a hierarchy path.
    """

    department = (employee.department or "").strip() or None
    unit = (unit or "").strip() or None
    post = (post or "").strip() or None
    return department, unit, post if unit is not None else None


def _record_assignment_event(
    db: Session,
    *,
    employee: Employee,
    to_unit: str | None,
    to_post: str | None,
    event_type: str,
    actor_user_id: int | None,
    effective_at: datetime,
    reason: str | None = "Duty transfer",
) -> None:
    """Append the immutable assignment snapshot before mutating ``employee``.

    ``to_unit=None`` is a departure: the employee leaves the hierarchy, so the
    destination records no department either.
    """

    from_department, from_unit, from_post = _event_hierarchy(
        employee, employee.duty_unit, employee.duty_post
    )
    to_department, event_unit, event_post = _event_hierarchy(employee, to_unit, to_post)
    if event_unit is None:
        to_department = None
    db.add(
        DutyAssignmentEvent(
            employee_id=employee.id,
            event_type=event_type,
            from_department=from_department,
            from_unit=from_unit,
            from_post=from_post,
            to_department=to_department,
            to_unit=event_unit,
            to_post=event_post,
            effective_at=effective_at,
            actor_user_id=actor_user_id,
            reason=reason,
        )
    )


def _enqueue_assignment_reevaluation(
    db: Session, *, employee_id: str, effective_at: datetime
) -> None:
    """Stage the current duty-hierarchy reevaluation in the caller transaction."""

    from app.services.attendance_queue_service import enqueue_evaluation

    instant = effective_at.replace(tzinfo=UTC)
    enqueue_evaluation(
        db,
        employee_id=employee_id,
        window_start_at=instant - timedelta(days=1),
        window_end_at=instant + timedelta(days=1),
        reason_code="DUTY_ASSIGNMENT_CHANGED",
        now=datetime.now(UTC),
    )


def apply_status_change(
    db: Session,
    *,
    employee: Employee,
    from_status: str,
    actor_user_id: int | None,
) -> None:
    """Move ``employee`` out of, or back into, the unit structure for a status change.

    Call after ``employee.status`` holds the new status, from every writer that
    changes it. Only a crossing of the working boundary acts:

    * Active/Loaned -> Resigned/Terminated/Transferred records a departure
      (``service_end``, or ``transfer_out`` for Transferred) from the current
      unit/post to nowhere and clears both fields. It is recorded even for an
      unassigned employee, so a later return never restores an older post.
    * a departed status -> Active/Loaned restores the unit/post the latest
      departure left, with a ``reinstatement`` event. An employee already given
      a unit by the same edit keeps it; with nothing to restore they stay
      unassigned.

    Moves between two departed statuses, or between Active and Loaned, change
    nothing. Stages the rows on ``db``; the caller commits.
    """

    was_working = from_status in WORKING_STATUSES
    is_working = employee.status in WORKING_STATUSES
    if was_working == is_working:
        return
    effective_at = datetime.now(UTC).replace(tzinfo=None)
    if not is_working:
        _record_assignment_event(
            db,
            employee=employee,
            to_unit=None,
            to_post=None,
            event_type=(
                EVENT_TRANSFER_OUT
                if employee.status == EMPLOYEE_STATUS_TRANSFERRED
                else EVENT_SERVICE_END
            ),
            actor_user_id=actor_user_id,
            effective_at=effective_at,
            reason=None,
        )
        employee.duty_unit = None
        employee.duty_post = None
    else:
        if (employee.duty_unit or "").strip():
            return
        db.flush()
        departure = db.scalar(
            select(DutyAssignmentEvent)
            .where(
                DutyAssignmentEvent.employee_id == employee.id,
                DutyAssignmentEvent.event_type.in_(DEPARTURE_EVENT_TYPES),
            )
            .order_by(DutyAssignmentEvent.id.desc())
            .limit(1)
        )
        if departure is None or departure.from_unit is None:
            return
        _record_assignment_event(
            db,
            employee=employee,
            to_unit=departure.from_unit,
            to_post=departure.from_post,
            event_type=EVENT_REINSTATEMENT,
            actor_user_id=actor_user_id,
            effective_at=effective_at,
            reason=None,
        )
        employee.duty_unit = departure.from_unit
        employee.duty_post = departure.from_post
        db.flush()
        workforce_schedule_service.reconcile_duty_crew_membership(
            db, employee_id=employee.id, effective_at=effective_at
        )
    _enqueue_assignment_reevaluation(db, employee_id=employee.id, effective_at=effective_at)


def _location_label(unit: str | None, post: str | None) -> str:
    """``unit - post`` / just the unit / ``غير محدد`` when empty."""
    unit = (unit or "").strip()
    post = (post or "").strip()
    if unit and post:
        return f"{unit} - {post}"
    if unit:
        return unit
    return _UNSPECIFIED


def _employee_display_name(emp: Employee) -> str:
    """Prefer the Arabic name; fall back to English; never blank."""
    return (emp.name_ar or emp.name_en or emp.id or "").strip()


def _build_body_html(rows: list[tuple[Employee, str, str | None]]) -> str:
    """Intro sentence + a red-header from→to ``<table>``; nothing else.

    The General Book paper already prints the greeting (…أعلاه انه) before the
    body and the closing (للتفضل بالعلم وإجراءاتكم) after it, so neither is
    repeated here.

    Each row is ``(employee, to_unit, to_post)``. The ``من`` column reads the
    employee's CURRENT unit/post, so callers must build the body BEFORE staging
    the move; ``إلى`` is that row's OWN destination, which is what lets one
    letter cover several source units and even a swap. No effective date or
    reason is rendered — the letter uses ``إعتباراً من تاريخه`` verbatim (see
    the spec).
    """
    head = "".join(f'<th style="{_TH}">{html.escape(c)}</th>' for c in _COLS)
    out = [f"<tr>{head}</tr>"]
    for emp, to_unit, to_post in rows:
        cells = [
            html.escape(emp.id),
            html.escape((emp.position_ar or "").strip()),
            html.escape(_employee_display_name(emp)),
            html.escape(_location_label(emp.duty_unit, emp.duty_post)),
            html.escape(_location_label(to_unit, to_post)),
        ]
        out.append("<tr>" + "".join(f'<td style="{_TD}">{c}</td>' for c in cells) + "</tr>")
    table = '<table dir="rtl" style="border-collapse:collapse">' + "".join(out) + "</table>"

    intro = f"<p>{html.escape(_INTRO)}</p>"
    return intro + _SPACER + table + _SPACER


def transfer(
    db: Session,
    *,
    moves: list[DutyTransferMove],
    recipient_id: int | None = None,
    manager_id: int | None = None,
    cc: list[str] | None = None,
    current_user: User,
) -> DutyTransferResult:
    """Move each employee to its own ``to_unit``/``to_post`` and mint the letter.

    Raises ``ValidationFailedError`` (422) on an empty move list, a blank
    ``to_unit``, a repeated employee, an unknown employee id, or an employee
    who is not working (Resigned, Terminated, Transferred): a departed employee
    cannot be posted.
    """
    if not moves:
        raise ValidationFailedError("DUTY_NO_EMPLOYEES", "At least one employee is required")

    # Resolve every move in request order (which is the letter's row order):
    # normalise the destination, refuse a repeated employee (two destinations for
    # one person is ambiguous — the operator, not us, decides), and load the row
    # so an unknown id fails before anything is written.
    rows: list[tuple[Employee, str, str | None]] = []
    seen: set[str] = set()
    for move in moves:
        to_unit = (move.to_unit or "").strip()
        if not to_unit:
            raise ValidationFailedError("DUTY_NO_UNIT", "Destination unit is required")
        to_post = move.to_post.strip() if move.to_post and move.to_post.strip() else None
        if move.employee_id in seen:
            raise ValidationFailedError(
                "DUTY_DUPLICATE_EMPLOYEE",
                f"Employee {move.employee_id!r} appears more than once",
                id=move.employee_id,
            )
        seen.add(move.employee_id)
        emp = db.get(Employee, move.employee_id)
        if emp is None:
            raise ValidationFailedError(
                "DUTY_EMPLOYEE_NOT_FOUND",
                f"Employee {move.employee_id!r} does not exist",
                id=move.employee_id,
            )
        if emp.status not in WORKING_STATUSES:
            raise ValidationFailedError(
                "DUTY_EMPLOYEE_DEPARTED",
                f"Employee {move.employee_id!r} is not working and cannot be posted",
                id=move.employee_id,
            )
        rows.append((emp, to_unit, to_post))

    # No-book path: when EVERY selected employee is currently unassigned, this is
    # initial placement, not a transfer needing a formal letter — just move them.
    if all(not (emp.duty_unit or "").strip() for emp, _, _ in rows):
        effective_at = datetime.now(UTC).replace(tzinfo=None)
        for emp, to_unit, to_post in rows:
            _record_assignment_event(
                db,
                employee=emp,
                to_unit=to_unit,
                to_post=to_post,
                event_type="initial_placement",
                actor_user_id=current_user.id,
                effective_at=effective_at,
            )
            _enqueue_assignment_reevaluation(db, employee_id=emp.id, effective_at=effective_at)
            emp.duty_unit = to_unit
            emp.duty_post = to_post
            workforce_schedule_service.reconcile_duty_crew_membership(
                db, employee_id=emp.id, effective_at=effective_at, current_user=current_user
            )
        db.commit()
        return DutyTransferResult(moved=[emp.id for emp, _, _ in rows])

    # The letter is a General Book: honour that service's capability exactly as
    # /documents/generate does, before any employee is moved.
    book_service.require_record_type_access(
        db,
        current_user,
        category_id=document_service.record_category_for_template("General Book"),
        service_id="General Book",
        classification_code="12/1",
    )

    # Otherwise mint the transfer letter. Build the body from CURRENT (FROM)
    # locations BEFORE mutating.
    body_html = _build_body_html(rows)

    # Stage the immutable event alongside each legacy mutation.  The document
    # generator's one commit therefore persists all three records together.
    effective_at = datetime.now(UTC).replace(tzinfo=None)
    for emp, to_unit, to_post in rows:
        _record_assignment_event(
            db,
            employee=emp,
            to_unit=to_unit,
            to_post=to_post,
            event_type="transfer",
            actor_user_id=current_user.id,
            effective_at=effective_at,
        )
        _enqueue_assignment_reevaluation(db, employee_id=emp.id, effective_at=effective_at)
        emp.duty_unit = to_unit
        emp.duty_post = to_post
        workforce_schedule_service.reconcile_duty_crew_membership(
            db, employee_id=emp.id, effective_at=effective_at, current_user=current_user
        )

    fields: dict[str, Any] = {"subject": _SUBJECT, "body": body_html}
    if recipient_id is not None:
        fields["recipient_id"] = recipient_id
    if manager_id is not None:
        fields["manager_id"] = manager_id
    if cc:
        fields["cc"] = cc

    result = document_service.generate_document(
        db,
        employee_id=None,  # admin form — no bound employee
        template_id="General Book",
        fields=fields,
        current_user=current_user,
        commit=True,
        # Transfer letters file under شؤون القوة (Force affairs) in the
        # government classification index; every General Book ref now comes
        # from the classified register.
        classification_code="12/1",
    )

    return DutyTransferResult(
        book_id=result.book_id,
        ref=result.ref_number,
        document_id=result.document_id,
        moved=[emp.id for emp, _, _ in rows],
    )
