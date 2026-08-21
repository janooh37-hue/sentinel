"""Monthly time-sheet endpoints — the grid, the corrections, and both workbooks.

Routes:
  GET    /timesheet/designations                              — the catalog
  PUT    /timesheet/designations/order                        — re-rank it
  GET    /timesheet/{year}/{month}                            — the grid
  PUT    /timesheet/{year}/{month}/cell                       — force one cell
  PATCH  /timesheet/{year}/{month}                            — posts + fillers
  POST   /timesheet/{year}/{month}/close                      — seal it
  POST   /timesheet/{year}/{month}/reopen                     — break the seal
  POST   /timesheet/{year}/{month}/start-ack                  — accept a joiner
  GET    /timesheet/{year}/{month}/export                     — the workbook
  GET    /timesheet/employee/{id}/{year}/{month}/export        — one man's sheet

Three things about this module are load-bearing:

* **The two ``designations`` routes are declared first.** ``/{year}/{month}``
  matches ``/designations/order`` too, so declaring it earlier makes the catalog
  a 422 on ``int("designations")``.
* **The month export freezes the month**, which is why it is gated on
  ``timesheet.edit`` while the per-employee export — which freezes nothing —
  needs only ``timesheet.view``. A read-only holder must not be able to seal a
  month that only an editor can reopen.
* **Every write passes the signed-in user down.** ``created_by``, ``closed_by``,
  ``reopened_by`` and ``acked_by`` exist to answer "who did this", and a route
  that drops the id leaves those columns NULL forever.

The month writes answer with the refreshed grid, which is the state the page has
to render next; the export answers with raw bytes and an RFC 5987
``content-disposition``, because Starlette encodes headers as latin-1 and a bare
``filename="كشف حضور…"`` raises mid-response.
"""

from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import NotFoundError, ValidationFailedError
from app.core import timesheet_xlsx
from app.db.models import Employee, TimesheetDesignation, User
from app.db.session import get_db
from app.schemas.timesheet import (
    Sheet,
    TimesheetCellUpdate,
    TimesheetDesignationOrder,
    TimesheetDesignationRead,
    TimesheetGridResponse,
    TimesheetPeriodPatch,
    TimesheetStartAckRequest,
    Variant,
)
from app.services import timesheet_service as svc

router = APIRouter(prefix="/timesheet", tags=["timesheet"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

#: Bounds on the path, so an impossible month answers 422 instead of a 500 out of
#: ``calendar.monthrange``. The site's records start in the 2020s.
_MIN_YEAR = 2000
_MAX_YEAR = 2100

Year = Annotated[int, Path(ge=_MIN_YEAR, le=_MAX_YEAR)]
Month = Annotated[int, Path(ge=1, le=12)]


def _grid(db: Session, year: int, month: int, sheet: str) -> TimesheetGridResponse:
    return TimesheetGridResponse.model_validate(svc.build_month(db, year, month, sheet=sheet))


def _preflight(db: Session, year: int, month: int) -> dict[str, svc.MonthGrid]:
    """Build both deliverables and refuse to seal if either one is blocked."""

    grids = {sheet: svc.build_month(db, year, month, sheet=sheet) for sheet in svc.SHEETS}
    blocking = [
        {
            "sheet": sheet,
            "employee_id": issue.employee_id,
            "kind": issue.kind,
            "detail": issue.detail,
        }
        for sheet, grid in grids.items()
        for issue in grid.blocking
    ]
    if blocking:
        raise ValidationFailedError(
            "TIMESHEET_BLOCKED",
            "Fix the blocking issues before downloading the sheets.",
            blocking=blocking,
        )
    return grids


def _attachment(payload: bytes, filename: str) -> Response:
    """The workbook as a download named in Arabic.

    ``filename*`` only: the percent-encoded form is the one every browser this
    office runs reads, and the ASCII fallback of an Arabic name is punctuation.
    """

    return Response(
        content=payload,
        media_type=XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _sheet_of(db: Session, employee_id: str) -> str:
    """The workbook this employee is printed on — drivers report separately.

    Resolved from his designation rather than by searching both grids: the
    per-employee export is reached from the employee record, which knows nothing
    about sheets, and a man off this month's roster still has to resolve to the
    sheet his row would be on. Mirrors ``timesheet_service._lists_on``: no
    designation means the main sheet, where he also raises a blocking issue.
    """

    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError(
            "EMPLOYEE_NOT_FOUND", f"No employee {employee_id!r}", employee_id=employee_id
        )
    designation = (
        db.get(TimesheetDesignation, employee.designation_id)
        if employee.designation_id is not None
        else None
    )
    return svc.SHEETS[0] if designation is None else designation.sheet


def _require_on_roster(db: Session, year: int, month: int, employee_id: str) -> None:
    """Refuse an acknowledgement for a month the employee is not on.

    ``acknowledge_start`` only checks that the employee *exists*, and
    ``timesheet_start_acks`` carries no foreign key, so without this an ack for
    someone whose ``doj`` is months away is stored and answered 204. That is not
    inert: ``start_confirmed`` is read live, so once he does reach the roster —
    a corrected ``doj``, an extended ``end_date`` — his row would render
    ``start_confirmed: true`` over a starting point nobody ever accepted.

    Deliberately a roster check, not an open-month check: a closed month must
    still accept the acknowledgement.
    """

    grid = svc.build_month(db, year, month, sheet=_sheet_of(db, employee_id))
    if not any(row.employee_id == employee_id for row in grid.rows):
        raise NotFoundError(
            "EMPLOYEE_NOT_ON_SHEET",
            f"{employee_id!r} is not on the {month}/{year} roster",
            employee_id=employee_id,
        )


# --------------------------------------------------------------------------- #
# the catalog — declared BEFORE /{year}/{month}, which would shadow it
# --------------------------------------------------------------------------- #


@router.get("/designations", response_model=list[TimesheetDesignationRead])
def list_designations(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("timesheet.view"))],
) -> list[TimesheetDesignation]:
    return svc.list_designations(db)


@router.put("/designations/order", response_model=list[TimesheetDesignationRead])
def reorder_designations(
    payload: TimesheetDesignationOrder,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("timesheet.edit"))],
) -> list[TimesheetDesignation]:
    svc.reorder_designations(db, payload.ids)
    return svc.list_designations(db)


# --------------------------------------------------------------------------- #
# the grid
# --------------------------------------------------------------------------- #


@router.get("/{year}/{month}", response_model=TimesheetGridResponse)
def get_month(
    year: Year,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("timesheet.view"))],
    sheet: Sheet = "main",
) -> TimesheetGridResponse:
    return _grid(db, year, month, sheet)


@router.put("/{year}/{month}/cell", response_model=TimesheetGridResponse)
def set_cell(
    year: Year,
    month: Month,
    payload: TimesheetCellUpdate,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("timesheet.edit"))],
    sheet: Sheet = "main",
) -> TimesheetGridResponse:
    svc.set_cell(
        db,
        year,
        month,
        payload.employee_id,
        payload.day,
        payload.code,
        note=payload.note,
        user_id=user.id,
    )
    return _grid(db, year, month, sheet)


@router.patch("/{year}/{month}", response_model=TimesheetGridResponse)
def patch_month(
    year: Year,
    month: Month,
    payload: TimesheetPeriodPatch,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("timesheet.edit"))],
    sheet: Sheet = "main",
) -> TimesheetGridResponse:
    """The post count and any filler choices, applied as one unit.

    Both writers are handed ``commit=False`` and the transaction is closed once
    here: each of them commits on its own by default, so a bad filler halfway
    down the list would otherwise persist the post count and the fillers before
    it and still answer with a failure.
    """

    if payload.post_count is not None:
        svc.set_post_count(db, year, month, payload.post_count, commit=False)
    for filler in payload.fillers:
        svc.set_filler(db, year, month, filler.employee_id, filler.code, commit=False)
    db.commit()
    return _grid(db, year, month, sheet)


@router.post("/{year}/{month}/close", response_model=TimesheetGridResponse)
def close_month(
    year: Year,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("timesheet.edit"))],
    sheet: Sheet = "main",
) -> TimesheetGridResponse:
    _preflight(db, year, month)
    svc.close_month(db, year, month, user_id=user.id)
    return _grid(db, year, month, sheet)


@router.post("/{year}/{month}/reopen", response_model=TimesheetGridResponse)
def reopen_month(
    year: Year,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("timesheet.edit"))],
    sheet: Sheet = "main",
) -> TimesheetGridResponse:
    svc.reopen_month(db, year, month, user_id=user.id)
    return _grid(db, year, month, sheet)


@router.post("/{year}/{month}/start-ack", status_code=status.HTTP_204_NO_CONTENT)
def acknowledge_start(
    year: Year,
    month: Month,
    payload: TimesheetStartAckRequest,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("timesheet.edit"))],
) -> Response:
    """Accept a mid-month joiner's starting point.

    Idempotent, and deliberately allowed on a closed month: it changes no cell,
    so refusing it after the seal would strand the flag forever.
    """

    _require_on_roster(db, year, month, payload.employee_id)
    svc.acknowledge_start(db, year, month, payload.employee_id, user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# the workbooks
# --------------------------------------------------------------------------- #


@router.get("/{year}/{month}/export")
def export_month(
    year: Year,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("timesheet.edit"))],
    sheet: Sheet = "main",
    variant: Variant = "attendance",
) -> Response:
    """Both deliverables come from here — and downloading one freezes the month.

    The preflight runs before the seal, so a refused download freezes nothing.
    The grid built for the check is the one rendered: ``close_month`` snapshots
    exactly it, so re-rendering after the seal would be the same bytes twice.
    """
    grids = _preflight(db, year, month)
    grid = grids[sheet]
    payload = timesheet_xlsx.render(grid, variant=variant)
    svc.close_month(db, year, month, user_id=user.id)
    return _attachment(payload, timesheet_xlsx.filename_for(grid, variant=variant))


@router.get("/employee/{employee_id}/{year}/{month}/export")
def export_employee(
    employee_id: str,
    year: Year,
    month: Month,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("timesheet.view"))],
    # A bounded int, not ``Literal[1, 2]``: pydantic does not coerce the query
    # string "2" to the literal 2, so the two-month form would 422 on arrival.
    months: Annotated[int, Query(ge=1, le=2)] = 1,
) -> Response:
    """One employee's own sheet. Freezes nothing, so ``timesheet.view`` is enough.

    ``months=2`` is the resignation and termination handover HR asked for: the
    month of departure and the one before it, earlier sheet first, named for the
    later month. ``render_single`` cannot produce a second sheet, so the span
    renderer takes both grids.

    The span renderer tolerates a month he was not on the roster for, and the
    name follows it: someone who finished in the **earlier** month is exactly the
    handover this parameter exists for, so the later month's name is used
    whenever it can be resolved and the earlier grid names the file otherwise.
    A man on neither month still 404s, out of ``render_single_span``.
    """

    sheet = _sheet_of(db, employee_id)
    grid = svc.build_month(db, year, month, sheet=sheet)
    if months == 1:
        return _attachment(
            timesheet_xlsx.render_single(grid, employee_id),
            timesheet_xlsx.filename_for_single(grid, employee_id),
        )
    earlier_year, earlier_month = svc.previous_month(year, month)
    earlier = svc.build_month(db, earlier_year, earlier_month, sheet=sheet)
    payload = timesheet_xlsx.render_single_span([earlier, grid], employee_id)
    named = grid if any(row.employee_id == employee_id for row in grid.rows) else earlier
    return _attachment(payload, timesheet_xlsx.filename_for_single(named, employee_id))


__all__ = ["router"]
