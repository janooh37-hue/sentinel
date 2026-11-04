"""Capability-gated Uniform catalogue and ledger API."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_capability
from app.api.errors import NotFoundError
from app.db.models import Employee, User
from app.db.repos import uniform_repo
from app.db.session import get_db
from app.schemas import uniform as s
from app.services import uniform_service as service

router = APIRouter(prefix="/uniform", tags=["uniform"])
_Db = Annotated[Session, Depends(get_db)]
_View = Annotated[User, Depends(require_capability("uniform.view"))]
_Edit = Annotated[User, Depends(require_capability("uniform.edit"))]


def _size(db, row):
    result = s.UniformSizeRead.model_validate(row)
    result.held_qty = sum(
        h.qty for h in uniform_repo.holdings(db, item_id=row.item_id) if h.size_id == row.id
    )
    result.is_low = row.min_qty is not None and row.on_hand <= row.min_qty
    return result


def _item(db, row):
    holdings = uniform_repo.holdings(db, item_id=row.id)
    employees = (
        {
            e.id: e
            for e in db.scalars(
                select(Employee).where(Employee.id.in_({h.employee_id for h in holdings}))
            )
        }
        if holdings
        else {}
    )
    return s.UniformItemRead(
        **{
            key: getattr(row, key)
            for key in s.UniformItemRead.model_fields
            if key not in {"version", "sizes", "holders"}
        },
        version=service.item_etag(row),
        sizes=[_size(db, size) for size in row.sizes if size.archived_at is None],
        holders=[
            s.UniformHolder(
                employee_id=h.employee_id,
                name_en=employees[h.employee_id].name_en,
                name_ar=employees[h.employee_id].name_ar,
                qty=h.qty,
            )
            for h in holdings
        ]
        if row.tracking == "holder"
        else [],
    )


@router.get("/items", response_model=list[s.UniformItemRead])
def items(db: _Db, user: _View, include_archived: bool = False):
    return [
        _item(db, row) for row in uniform_repo.list_items(db, include_archived=include_archived)
    ]


@router.post("/items", response_model=s.UniformItemRead, status_code=201)
def create_item(payload: s.UniformItemCreate, db: _Db, user: _Edit):
    return _item(
        db, service.create_item(db, **payload.model_dump(), actor=user.email, actor_user_id=user.id)
    )


@router.patch("/items/{item_id}", response_model=s.UniformItemRead)
def update_item(
    item_id: int,
    payload: s.UniformItemUpdate,
    db: _Db,
    user: _Edit,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
):
    return _item(
        db,
        service.update_item(
            db, item_id, payload.model_dump(exclude_unset=True), if_match=if_match, actor=user.email
        ),
    )


@router.post("/items/{item_id}/archive", response_model=s.UniformItemRead)
def archive_item(item_id: int, db: _Db, user: _Edit):
    return _item(db, service.archive_item(db, item_id, actor=user.email))


@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: int, db: _Db, user: _Edit):
    service.delete_item(db, item_id, actor=user.email)
    return Response(status_code=204)


@router.post("/items/{item_id}/sizes", response_model=s.UniformSizeRead, status_code=201)
def add_size(item_id: int, payload: s.UniformSizeCreate, db: _Db, user: _Edit):
    return _size(db, service.add_size(db, item_id, **payload.model_dump(), actor=user.email))


@router.patch("/sizes/{size_id}", response_model=s.UniformSizeRead)
def update_size(size_id: int, payload: s.UniformSizeUpdate, db: _Db, user: _Edit):
    return _size(
        db,
        service.update_size(db, size_id, payload.model_dump(exclude_unset=True), actor=user.email),
    )


@router.delete("/sizes/{size_id}", status_code=204)
def remove_size(size_id: int, db: _Db, user: _Edit):
    service.remove_size(db, size_id, actor=user.email)
    return Response(status_code=204)


@router.get("/receipts", response_model=list[s.UniformReceiptRead])
def receipts(db: _Db, user: _View):
    return service.list_receipts(db)


@router.post("/receipts", response_model=s.UniformReceiptRead, status_code=201)
def create_receipt(payload: s.UniformReceiptCreate, db: _Db, user: _Edit):
    data = payload.model_dump()
    data["lines"] = [service.ReceiptLineIn(**line) for line in data["lines"]]
    return service.create_receipt(db, **data, actor=user.email, actor_user_id=user.id)


@router.get("/issues", response_model=list[s.UniformIssueRead])
def issues(db: _Db, user: _View, employee_id: str | None = None):
    return service.issue_reads(db, service.list_issues(db, employee_id=employee_id))


@router.post("/issues", response_model=s.UniformIssueRead, status_code=201)
def create_issue(payload: s.UniformIssueCreate, db: _Db, user: _Edit):
    data = payload.model_dump()
    data["lines"] = [service.IssueLineIn(**line) for line in data["lines"]]
    row = service.create_issue(db, **data, actor=user.email, actor_user_id=user.id)
    return service.issue_reads(db, [row])[0]


@router.get("/returns", response_model=list[s.UniformReturnRead])
def returns(db: _Db, user: _View, employee_id: str | None = None):
    return service.return_reads(db, service.list_returns(db, employee_id=employee_id))


@router.post("/returns", response_model=s.UniformReturnRead, status_code=201)
def create_return(payload: s.UniformReturnCreate, db: _Db, user: _Edit):
    data = payload.model_dump()
    data["lines"] = [service.ReturnLineIn(**line) for line in data["lines"]]
    row = service.create_return(db, **data, actor=user.email, actor_user_id=user.id)
    return service.return_reads(db, [row])[0]


@router.get("/adjustments", response_model=list[s.UniformAdjustmentRead])
def adjustments(db: _Db, user: _View):
    return service.list_adjustments(db)


@router.post("/adjustments", response_model=list[s.UniformAdjustmentRead], status_code=201)
def create_adjustments(payload: s.UniformAdjustmentCreate, db: _Db, user: _Edit):
    data = payload.model_dump()
    data["lines"] = [service.AdjustmentLineIn(**line) for line in data["lines"]]
    return service.create_adjustments(db, **data, actor=user.email, actor_user_id=user.id)


@router.post("/receipts/{record_id}/void", response_model=s.UniformReceiptRead)
def void_receipt(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit):
    return service.void_receipt(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )


@router.post("/issues/{record_id}/void", response_model=s.UniformIssueRead)
def void_issue(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit):
    row = service.void_issue(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )
    return service.issue_reads(db, [row])[0]


@router.post("/returns/{record_id}/void", response_model=s.UniformReturnRead)
def void_return(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit):
    row = service.void_return(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )
    return service.return_reads(db, [row])[0]


@router.post("/adjustments/{record_id}/void", response_model=s.UniformAdjustmentRead)
def void_adjustment(record_id: int, payload: s.UniformVoid, db: _Db, user: _Edit):
    return service.void_adjustment(
        db, record_id, reason=payload.reason, actor=user.email, actor_user_id=user.id
    )


@router.get("/recipients", response_model=list[s.UniformRecipient])
def recipients(db: _Db, user: _View, q: str = ""):
    issues = [row for row in service.list_issues(db) if row.voided_at is None]
    held = {}
    for h in uniform_repo.holdings(db):
        held[h.employee_id] = held.get(h.employee_id, 0) + h.qty
    totals = {}
    for row in issues:
        entry = totals.setdefault(row.employee_id, [0, row.issued_on])
        entry[0] += sum(line.qty for line in row.lines)
    employees = db.scalars(select(Employee).where(Employee.id.in_(totals)))
    return [
        s.UniformRecipient(
            employee_id=e.id,
            name_en=e.name_en,
            name_ar=e.name_ar,
            held_total=held.get(e.id, 0),
            issued_total=totals[e.id][0],
            last_issued_on=totals[e.id][1],
        )
        for e in employees
        if q.casefold() in f"{e.id} {e.name_en} {e.name_ar or ''}".casefold()
    ]


@router.get("/employees/{employee_id}", response_model=s.UniformEmployeeRead)
def employee(employee_id: str, db: _Db, user: _View):
    if db.get(Employee, employee_id) is None:
        raise NotFoundError("uniform_employee_not_found", "Employee not found.")
    return s.UniformEmployeeRead(
        holdings=uniform_repo.holdings(db, employee_id=employee_id),
        issues=service.issue_reads(db, service.list_issues(db, employee_id=employee_id)),
        returns=service.return_reads(db, service.list_returns(db, employee_id=employee_id)),
    )


@router.get("/summary", response_model=s.UniformSummary)
def summary(db: _Db, user: _View):
    active = uniform_repo.list_items(db)
    sizes = [size for item in active for size in item.sizes if size.archived_at is None]
    holdings = uniform_repo.holdings(db)
    suits = {item.id for item in active if item.drawing == "suit"}
    return s.UniformSummary(
        shelf_total=sum(size.on_hand for size in sizes),
        holder_count=len({h.employee_id for h in holdings}),
        suits_issued=sum(h.qty for h in holdings if h.item_id in suits),
        out_of_stock=sum(size.on_hand == 0 for size in sizes),
        low_sizes=sum(size.min_qty is not None and size.on_hand <= size.min_qty for size in sizes),
    )
