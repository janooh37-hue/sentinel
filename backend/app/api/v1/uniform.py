"""Capability-gated Uniform catalogue and ledger API."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.db.models import UniformAdjustment, UniformReceipt, User
from app.db.session import get_db
from app.schemas import uniform as s
from app.services import uniform_service as service

router = APIRouter(prefix="/uniform", tags=["uniform"])
_Db = Annotated[Session, Depends(get_db)]
_View = Annotated[User, Depends(require_capability("uniform.view"))]
_Edit = Annotated[User, Depends(require_capability("uniform.edit"))]


@router.get("/items", response_model=list[s.UniformItemRead])
def items(db: _Db, user: _View, include_archived: bool = False) -> list[s.UniformItemRead]:
    return service.item_reads(db, include_archived=include_archived)


@router.post("/items", response_model=s.UniformItemRead, status_code=201)
def create_item(payload: s.UniformItemCreate, db: _Db, user: _Edit) -> s.UniformItemRead:
    return service.item_read(
        db, service.create_item(db, **payload.model_dump(), actor=user.email, actor_user_id=user.id)
    )


@router.patch("/items/{item_id}", response_model=s.UniformItemRead)
def update_item(
    item_id: int,
    payload: s.UniformItemUpdate,
    db: _Db,
    user: _Edit,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> s.UniformItemRead:
    return service.item_read(
        db,
        service.update_item(
            db, item_id, payload.model_dump(exclude_unset=True), if_match=if_match, actor=user.email
        ),
    )


@router.post("/items/{item_id}/archive", response_model=s.UniformItemRead)
def archive_item(item_id: int, db: _Db, user: _Edit) -> s.UniformItemRead:
    return service.item_read(db, service.archive_item(db, item_id, actor=user.email))


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: _Db, user: _Edit) -> Response:
    service.delete_item(db, item_id, actor=user.email)
    return Response(status_code=204)


@router.post("/items/{item_id}/sizes", response_model=s.UniformSizeRead, status_code=201)
def add_size(item_id: int, payload: s.UniformSizeCreate, db: _Db, user: _Edit) -> s.UniformSizeRead:
    return service.size_read(
        db, service.add_size(db, item_id, **payload.model_dump(), actor=user.email)
    )


@router.patch("/sizes/{size_id}", response_model=s.UniformSizeRead)
def update_size(
    size_id: int, payload: s.UniformSizeUpdate, db: _Db, user: _Edit
) -> s.UniformSizeRead:
    return service.size_read(
        db,
        service.update_size(db, size_id, payload.model_dump(exclude_unset=True), actor=user.email),
    )


@router.delete("/sizes/{size_id}", status_code=204)
def remove_size(size_id: int, db: _Db, user: _Edit) -> Response:
    service.remove_size(db, size_id, actor=user.email)
    return Response(status_code=204)


@router.get("/receipts", response_model=list[s.UniformReceiptRead])
def receipts(db: _Db, user: _View) -> list[UniformReceipt]:
    return service.list_receipts(db)


@router.post("/receipts", response_model=s.UniformReceiptRead, status_code=201)
def create_receipt(payload: s.UniformReceiptCreate, db: _Db, user: _Edit) -> UniformReceipt:
    data = payload.model_dump()
    data["lines"] = [service.ReceiptLineIn(**line) for line in data["lines"]]
    return service.create_receipt(db, **data, actor=user.email, actor_user_id=user.id)


@router.get("/issues", response_model=list[s.UniformIssueRead])
def issues(db: _Db, user: _View, employee_id: str | None = None) -> list[s.UniformIssueRead]:
    return service.issue_reads(db, service.list_issues(db, employee_id=employee_id))


@router.post("/issues", response_model=s.UniformIssueRead, status_code=201)
def create_issue(payload: s.UniformIssueCreate, db: _Db, user: _Edit) -> s.UniformIssueRead:
    data = payload.model_dump()
    data["lines"] = [service.IssueLineIn(**line) for line in data["lines"]]
    row = service.create_issue(db, **data, actor=user.email, actor_user_id=user.id)
    return service.issue_reads(db, [row])[0]


@router.get("/returns", response_model=list[s.UniformReturnRead])
def returns(db: _Db, user: _View, employee_id: str | None = None) -> list[s.UniformReturnRead]:
    return service.return_reads(db, service.list_returns(db, employee_id=employee_id))


@router.post("/returns", response_model=s.UniformReturnRead, status_code=201)
def create_return(payload: s.UniformReturnCreate, db: _Db, user: _Edit) -> s.UniformReturnRead:
    data = payload.model_dump()
    data["lines"] = [service.ReturnLineIn(**line) for line in data["lines"]]
    row = service.create_return(db, **data, actor=user.email, actor_user_id=user.id)
    return service.return_reads(db, [row])[0]


@router.get("/adjustments", response_model=list[s.UniformAdjustmentRead])
def adjustments(db: _Db, user: _View) -> list[UniformAdjustment]:
    return service.list_adjustments(db)


@router.post("/adjustments", response_model=list[s.UniformAdjustmentRead], status_code=201)
def create_adjustments(
    payload: s.UniformAdjustmentCreate, db: _Db, user: _Edit
) -> list[UniformAdjustment]:
    data = payload.model_dump()
    data["lines"] = [service.AdjustmentLineIn(**line) for line in data["lines"]]
    return service.create_adjustments(db, **data, actor=user.email, actor_user_id=user.id)


@router.post("/receipts/{record_id}/void", response_model=s.UniformReceiptRead)
def void_receipt(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit) -> UniformReceipt:
    return service.void_receipt(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )


@router.post("/issues/{record_id}/void", response_model=s.UniformIssueRead)
def void_issue(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit) -> s.UniformIssueRead:
    row = service.void_issue(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )
    return service.issue_reads(db, [row])[0]


@router.post("/returns/{record_id}/void", response_model=s.UniformReturnRead)
def void_return(
    record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit
) -> s.UniformReturnRead:
    row = service.void_return(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )
    return service.return_reads(db, [row])[0]


@router.post("/adjustments/{record_id}/void", response_model=s.UniformAdjustmentRead)
def void_adjustment(
    record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit
) -> UniformAdjustment:
    return service.void_adjustment(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )


@router.get("/recipients", response_model=list[s.UniformRecipient])
def recipients(db: _Db, user: _View, q: str = "") -> list[s.UniformRecipient]:
    return service.recipients(db, q=q)


@router.get("/employees/{employee_id}", response_model=s.UniformEmployeeRead)
def employee(employee_id: str, db: _Db, user: _View) -> s.UniformEmployeeRead:
    return service.employee_read(db, employee_id)


@router.get("/summary", response_model=s.UniformSummary)
def summary(db: _Db, user: _View) -> s.UniformSummary:
    return service.summary(db)
