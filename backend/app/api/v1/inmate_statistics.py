"""Monthly inmate conduct violation register.

Read is ``books.view`` plus the service's own visibility grant; writing a manual
entry or completing an imported copy is ``books.edit`` plus the service's create
grant — the same pair the Records service already uses. No ``inmate_stats.*``
capability family exists: the details column reproduces each Record's narrative,
so a register-only viewer would already read the papers' contents.

Close and reopen are ``require_admin``, and exporting never closes a month
(deliberately unlike the timesheet, where the download owns the seal).
"""

from __future__ import annotations

from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.api.errors import AppError
from app.core.nationalities import NATIONALITIES, NATIONALITY_ALIASES
from app.db.models import User
from app.db.session import get_db
from app.schemas.inmate_statistics import (
    ArrivedAfterCloseOut,
    AwaitingCloseOut,
    AwaitingMonthOut,
    BlockingEntryOut,
    CloseIn,
    CompletionIn,
    ManualProvenanceOut,
    ManualRowIn,
    ManualRowPatch,
    MonthCountsOut,
    MonthOut,
    NationalityListOut,
    NationalityOut,
    RegisterEntryOut,
    UncountedRecordOut,
)
from app.services import inmate_statistics_service as register
from app.services import perm_service

router = APIRouter(prefix="/inmate-violations", tags=["inmate-violations"])

Year = Annotated[int, Path(ge=2000, le=2100)]
Month = Annotated[int, Path(ge=1, le=12)]
Language = Annotated[str, Query(pattern="^(ar|en)$")]

_VIEW_CAPS: tuple[str, ...] = (
    "books.view",
    f"books.servicerecords.{register.TEMPLATE_ID}",
)
_EDIT_CAPS: tuple[str, ...] = (
    "books.edit",
    f"books.service.{register.TEMPLATE_ID}",
)

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _require(db: Session, user: User, capabilities: tuple[str, ...]) -> User:
    for capability in capabilities:
        if not perm_service.has_capability(db, user, capability):
            raise AppError(
                "FORBIDDEN",
                f"Missing capability: {capability}",
                http_status=403,
                details={"capability": capability},
            )
    return user


def register_reader(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    return _require(db, user, _VIEW_CAPS)


def register_writer(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    return _require(db, user, _EDIT_CAPS)


# --------------------------------------------------------------------------- #
# serialization
# --------------------------------------------------------------------------- #


def _entry_out(entry: register.RegisterEntry) -> RegisterEntryOut:
    manual = (
        ManualProvenanceOut(
            row_id=entry.manual_row_id,
            reason=entry.manual_reason,
            created_by=entry.manual_created_by,
            created_by_name=entry.manual_created_by_name,
            created_at=entry.manual_created_at,
        )
        if entry.is_manual
        else None
    )
    return RegisterEntryOut(
        id=entry.handle,
        origin=entry.origin,
        row_no=entry.row_no,
        population=entry.population,
        name=entry.name,
        uid=entry.uid,
        nationality_label=entry.nationality_label,
        nationality_code=entry.nationality_code,
        violation_date=entry.violation_date,
        duty_unit=entry.duty_unit,
        details_text=entry.details_text,
        wing=entry.wing,
        holding_no=entry.holding_no,
        reporter_id=entry.reporter_id,
        reporter_name=entry.reporter_name,
        source_book_id=entry.source_book_id,
        source_version_no=entry.source_version_no,
        source_row_index=entry.source_row_index,
        source_ref_number=entry.source_ref_number,
        incomplete_marks=list(entry.incomplete_marks),
        missing=list(entry.missing),
        duplicate_of=entry.duplicate_of,
        completion_book_id=entry.completion_book_id,
        manual=manual,
    )


def _month_out(month: register.MonthRegister, *, today: date | None = None) -> MonthOut:
    counts = month.counts
    return MonthOut(
        year=month.year,
        month=month.month,
        closed=month.closed,
        closed_at=month.closed_at,
        closed_by=month.closed_by,
        closed_by_name=month.closed_by_name,
        reopened_at=month.reopened_at,
        reopened_by=month.reopened_by,
        reopened_by_name=month.reopened_by_name,
        force_reason=month.force_reason,
        force_closed=month.force_reason is not None,
        can_close=register.month_has_ended(month.year, month.month, today=today),
        first_closable_date=register.first_closable_date(month.year, month.month),
        export_ready=month.export_ready,
        counts=MonthCountsOut(
            citizens=counts[register.POPULATION_CITIZENS],
            expats=counts[register.POPULATION_EXPATS],
            pending=counts[register.POPULATION_PENDING],
            total=counts["total"],
        ),
        entries=[_entry_out(entry) for entry in month.entries],
        uncounted=[
            UncountedRecordOut(
                book_id=record.book_id,
                ref_number=record.ref_number,
                reason=record.reason,
            )
            for record in month.uncounted
        ],
        arrived_after_close=[
            ArrivedAfterCloseOut(
                id=item.handle,
                name=item.name,
                violation_date=item.violation_date,
                ref_number=item.ref_number,
                source_book_id=item.source_book_id,
            )
            for item in month.arrived_after_close
        ],
        blocking=[
            BlockingEntryOut(id=entry.handle, name=entry.name, missing=list(entry.missing))
            for entry in month.blocking
        ],
    )


# --------------------------------------------------------------------------- #
# reads
# --------------------------------------------------------------------------- #


@router.get("/nationalities", response_model=NationalityListOut)
def list_nationalities(
    _user: Annotated[User, Depends(get_current_user)],
) -> NationalityListOut:
    """The closed inmate nationality list, for the entry form and the register."""

    return NationalityListOut(
        items=[
            NationalityOut(
                code=item.code,
                label_ar=item.label_ar,
                label_en=item.label_en,
                selectable=item.selectable,
            )
            for item in NATIONALITIES
        ],
        aliases=dict(NATIONALITY_ALIASES),
    )


@router.get("/statistics/awaiting-close", response_model=AwaitingCloseOut)
def awaiting_close(
    _admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> AwaitingCloseOut:
    """Ended months that still carry no seal, with what blocks each one."""

    months = register.awaiting_close(db)
    return AwaitingCloseOut(
        months=[
            AwaitingMonthOut(
                year=item.year,
                month=item.month,
                row_count=item.row_count,
                pending_count=item.pending_count,
                closable=item.closable,
            )
            for item in months
        ],
        count=len(months),
    )


@router.get("/statistics/{year}/{month}", response_model=MonthOut)
def get_month(
    year: Year,
    month: Month,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.build_month(db, year, month))


@router.get("/statistics/{year}/{month}/export")
def export_month(
    year: Year,
    month: Month,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
    language: Language = "ar",
    populations: Annotated[list[str] | None, Query()] = None,
) -> Response:
    """Download the register workbook. This never closes or re-closes a month.

    ``populations`` narrows the table blocks; omitted, every group is carried,
    because an export that silently omits a filed occurrence is the one failure
    this register cannot have.
    """

    scope = tuple(key for key in register.POPULATIONS if populations is None or key in populations)
    if not scope:
        raise AppError(
            "INMATE_REGISTER_EMPTY_SCOPE",
            "At least one register table must be exported.",
            http_status=422,
        )
    payload, filename = register.export_workbook(
        db, year, month, language=language, populations=scope
    )
    return Response(
        content=payload,
        media_type=_XLSX_MEDIA_TYPE,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
            "X-Content-Type-Options": "nosniff",
        },
    )


# --------------------------------------------------------------------------- #
# the seal
# --------------------------------------------------------------------------- #


@router.post("/statistics/{year}/{month}/close", response_model=MonthOut)
def close_month(
    year: Year,
    month: Month,
    body: CloseIn,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(
        register.close_month(db, year, month, actor=admin, force_reason=body.force_reason)
    )


@router.post("/statistics/{year}/{month}/reopen", response_model=MonthOut)
def reopen_month(
    year: Year,
    month: Month,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.reopen_month(db, year, month, actor=admin))


# --------------------------------------------------------------------------- #
# writes
# --------------------------------------------------------------------------- #


@router.post(
    "/statistics/{year}/{month}/manual-rows",
    response_model=MonthOut,
    status_code=status.HTTP_201_CREATED,
)
def create_manual_row(
    year: Year,
    month: Month,
    body: ManualRowIn,
    user: Annotated[User, Depends(register_writer)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    register.create_manual_row(
        db,
        year,
        month,
        actor=user,
        name=body.name,
        violation_date=body.violation_date,
        reason=body.reason,
        uid=body.uid,
        nationality_label=body.nationality_label,
        wing=body.wing,
        holding_no=body.holding_no,
        reporter_id=body.reporter_id,
        details_text=body.details_text,
    )
    return _month_out(register.build_month(db, year, month))


@router.patch("/statistics/manual-rows/{row_id}", response_model=MonthOut)
def update_manual_row(
    row_id: int,
    body: ManualRowPatch,
    user: Annotated[User, Depends(register_writer)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    row = register.update_manual_row(
        db,
        row_id,
        actor=user,
        changes=body.model_dump(exclude_unset=True),
    )
    return _month_out(register.build_month(db, row.year, row.month))


@router.delete("/statistics/manual-rows/{row_id}", response_model=MonthOut)
def delete_manual_row(
    row_id: int,
    user: Annotated[User, Depends(register_writer)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    year, month = register.manual_row_month(db, row_id)
    register.delete_manual_row(db, row_id, actor=user)
    return _month_out(register.build_month(db, year, month))


@router.post("/statistics/completions/{book_id}", response_model=MonthOut)
def complete_import(
    book_id: int,
    body: CompletionIn,
    user: Annotated[User, Depends(register_writer)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    """Fill in an uploaded approved copy so its occurrences become countable."""

    book = register.complete_import(
        db,
        book_id,
        actor=user,
        report_time=body.report_time,
        reporter_id=body.reporter_id,
        violation_details=body.violation_details,
        inmates=[item.model_dump() for item in body.inmates],
    )
    year, month = register.record_month(db, book)
    return _month_out(register.build_month(db, year, month))
