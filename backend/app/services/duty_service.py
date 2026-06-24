"""Internal-transfer service.

``transfer`` moves one or more employees to a destination duty unit/post and
mints an official **General Book** transfer letter as the audit record. The
letter body is server-built HTML — a short Arabic narrative plus a ``<table>``
with one row per moved employee (م · الرقم · الاسم · من · إلى) — which the
General Book renderer (``core/arabic_rtl.html_to_docx`` via ``_pp_general_book``)
turns into a real, variable-length RTL Word table. No template change needed.

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
from datetime import date

from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.db.models import Employee, User
from app.schemas.duty import DutyTransferResult
from app.services import document_service

_UNSPECIFIED = "غير محدد"
_SUBJECT = "تنقلات داخلية"


def _employee_display_name(emp: Employee) -> str:
    """Prefer the Arabic name; fall back to English; never blank."""
    return (emp.name_ar or emp.name_en or emp.id or "").strip()


def _location_label(unit: str | None, post: str | None) -> str:
    """``unit — post`` (Arabic dash) / just the unit / ``غير محدد`` when empty."""
    unit = (unit or "").strip()
    post = (post or "").strip()
    if unit and post:
        return f"{unit} — {post}"
    if unit:
        return unit
    return _UNSPECIFIED


def _build_body_html(
    employees: list[Employee],
    *,
    to_unit: str,
    to_post: str | None,
    effective_date: date,
    reason: str | None,
) -> str:
    """Narrative paragraph + a from→to ``<table>`` (one ``<tr>`` per employee)."""
    to_label = _location_label(to_unit, to_post)
    eff = effective_date.strftime("%d-%m-%Y")

    narrative = (
        f"<p>تقرر نقل الموظفين المدرجة أسماؤهم أدناه إلى "
        f"{html.escape(to_label)} اعتباراً من تاريخ {html.escape(eff)}."
    )
    if reason and reason.strip():
        narrative += f" السبب: {html.escape(reason.strip())}."
    narrative += "</p>"

    rows: list[str] = [
        "<tr>"
        "<th>م</th><th>الرقم</th><th>الاسم</th>"
        "<th>من</th><th>إلى</th>"
        "</tr>"
    ]
    for idx, emp in enumerate(employees, start=1):
        from_label = _location_label(emp.duty_unit, emp.duty_post)
        rows.append(
            "<tr>"
            f"<td>{idx}</td>"
            f"<td>{html.escape(emp.id)}</td>"
            f"<td>{html.escape(_employee_display_name(emp))}</td>"
            f"<td>{html.escape(from_label)}</td>"
            f"<td>{html.escape(to_label)}</td>"
            "</tr>"
        )
    table = "<table>" + "".join(rows) + "</table>"
    return narrative + table


def transfer(
    db: Session,
    *,
    employee_ids: list[str],
    to_unit: str,
    to_post: str | None,
    effective_date: date,
    reason: str | None,
    current_user: User | None = None,
) -> DutyTransferResult:
    """Move employees to ``to_unit``/``to_post`` and mint the transfer letter.

    Raises ``ValidationFailedError`` (422) on an empty id list, a blank
    ``to_unit``, or any unknown employee id.
    """
    if not employee_ids:
        raise ValidationFailedError(
            "DUTY_NO_EMPLOYEES", "At least one employee is required"
        )
    if not (to_unit or "").strip():
        raise ValidationFailedError("DUTY_NO_UNIT", "Destination unit is required")
    to_unit = to_unit.strip()
    to_post = to_post.strip() if to_post and to_post.strip() else None

    # Load in the requested order, validating every id exists. De-dup the input
    # while preserving order so a repeated id doesn't double-row the table.
    seen: set[str] = set()
    ordered_ids: list[str] = []
    for emp_id in employee_ids:
        if emp_id not in seen:
            seen.add(emp_id)
            ordered_ids.append(emp_id)
    employees: list[Employee] = []
    for emp_id in ordered_ids:
        emp = db.get(Employee, emp_id)
        if emp is None:
            raise ValidationFailedError(
                "DUTY_EMPLOYEE_NOT_FOUND",
                f"Employee {emp_id!r} does not exist",
                id=emp_id,
            )
        employees.append(emp)

    # Build the body from CURRENT (FROM) locations BEFORE mutating.
    body_html = _build_body_html(
        employees,
        to_unit=to_unit,
        to_post=to_post,
        effective_date=effective_date,
        reason=reason,
    )

    # Stage the moves on this session; generate_document's single commit
    # persists them together with the doc/Book rows.
    for emp in employees:
        emp.duty_unit = to_unit
        emp.duty_post = to_post

    result = document_service.generate_document(
        db,
        employee_id=None,  # admin form — no bound employee
        template_id="General Book",
        fields={"subject": _SUBJECT, "body": body_html},
        current_user=current_user,
        commit=True,
    )

    # generate_document creates the Book row in the same commit and now returns
    # its id directly (WF-04) — no fragile by-ref re-lookup / book_id=0 sentinel.
    book_id = result.book_id or 0

    return DutyTransferResult(
        book_id=book_id,
        ref=result.ref_number,
        document_id=result.document_id,
        moved=[emp.id for emp in employees],
    )
