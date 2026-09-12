"""Monthly inmate conduct violation register.

Register reads and writes keep the existing Records capabilities. Monthly
review and approval also require their own capabilities, navigation access,
assignment and a distinct linked employee identity. Only the final approval
closes the month; administrator reopening requires a reason.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any, Literal
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
    BlockingEntryOut,
    CompletionIn,
    ManualProvenanceOut,
    ManualRowIn,
    ManualRowPatch,
    MonthCountsOut,
    MonthOut,
    NationalityListOut,
    NationalityOut,
    PrepareIn,
    RegisterEntryOut,
    ReopenIn,
    ReturnIn,
    ReviewIn,
    SubmissionActionIn,
    SubmissionOut,
    SubmissionSummaryOut,
    UncountedRecordOut,
    WorkflowCandidateOut,
    WorkflowTasksOut,
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
        projection_fingerprint=month.projection_fingerprint,
        wing_summary=month.wing_summary,
        workflow=month.workflow,
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


@router.get("/statistics/tasks", response_model=WorkflowTasksOut)
def workflow_tasks(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WorkflowTasksOut:
    items = register.workflow_tasks(db, actor=user)
    return WorkflowTasksOut(items=items, count=len(items))


@router.get("/statistics/{year}/{month}", response_model=MonthOut)
def get_month(
    year: Year,
    month: Month,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.build_month(db, year, month, actor=_user))


@router.get("/statistics/{year}/{month}/export")
def export_month(
    year: Year,
    month: Month,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
    language: Language = "ar",
    populations: Annotated[list[str] | None, Query()] = None,
    submission_id: Annotated[int | None, Query(gt=0)] = None,
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
        db, year, month, language=language, populations=scope, submission_id=submission_id
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


@router.post("/statistics/{year}/{month}/prepare", response_model=MonthOut)
def prepare_month(
    year: Year,
    month: Month,
    body: PrepareIn,
    user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.prepare_month(db, year, month, actor=user, **body.model_dump()))


@router.post("/statistics/{year}/{month}/review", response_model=MonthOut)
def review_month(
    year: Year,
    month: Month,
    body: ReviewIn,
    user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.review_month(db, year, month, actor=user, **body.model_dump()))


@router.post("/statistics/{year}/{month}/return", response_model=MonthOut)
def return_month(
    year: Year,
    month: Month,
    body: ReturnIn,
    user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.return_month(db, year, month, actor=user, **body.model_dump()))


@router.post("/statistics/{year}/{month}/approve", response_model=MonthOut)
def approve_month(
    year: Year,
    month: Month,
    body: SubmissionActionIn,
    user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.approve_month(db, year, month, actor=user, **body.model_dump()))


@router.get("/statistics/{year}/{month}/candidates", response_model=list[WorkflowCandidateOut])
def workflow_candidates(
    year: Year,
    month: Month,
    stage: Literal["review", "approve"],
    user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    return register.workflow_candidates(db, year, month, actor=user, stage=stage)


@router.get("/statistics/{year}/{month}/submissions", response_model=list[SubmissionSummaryOut])
def submission_history(
    year: Year,
    month: Month,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> list[dict[str, Any]]:
    return register.submission_history(db, year, month)


@router.get("/statistics/{year}/{month}/submissions/{submission_id}", response_model=SubmissionOut)
def get_submission(
    year: Year,
    month: Month,
    submission_id: int,
    _user: Annotated[User, Depends(register_reader)],
    db: Annotated[Session, Depends(get_db)],
) -> SubmissionOut:
    view = register.submission_month(db, year, month, submission_id)
    return SubmissionOut(
        **_month_out(view).model_dump(),
        **register.submission_detail(db, year, month, submission_id),
    )


@router.post("/statistics/{year}/{month}/reopen", response_model=MonthOut)
def reopen_month(
    year: Year,
    month: Month,
    body: ReopenIn,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    return _month_out(register.reopen_month(db, year, month, actor=admin, **body.model_dump()))


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
    return _month_out(register.build_month(db, year, month, actor=user))


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
    return _month_out(register.build_month(db, row.year, row.month, actor=user))


@router.delete("/statistics/manual-rows/{row_id}", response_model=MonthOut)
def delete_manual_row(
    row_id: int,
    user: Annotated[User, Depends(register_writer)],
    db: Annotated[Session, Depends(get_db)],
) -> MonthOut:
    year, month = register.manual_row_month(db, row_id)
    register.delete_manual_row(db, row_id, actor=user)
    return _month_out(register.build_month(db, year, month, actor=user))


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
    return _month_out(register.build_month(db, year, month, actor=user))
