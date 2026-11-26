"""Capability-gated Armory catalogue, ledger, and employee integrations."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Path, Query, Response
from pydantic import StringConstraints
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.db.models import User
from app.db.session import get_db
from app.schemas import armory as s
from app.services import armory_audit_service as audit
from app.services import armory_catalog_service as catalog
from app.services import armory_custody_service as custody
from app.services import armory_read_service as reads
from app.services import armory_service as core
from app.services import armory_void_service as reversal

router = APIRouter(
    prefix="/armory", tags=["armory"], dependencies=[Depends(require_capability("armory.view"))]
)
_Db = Annotated[Session, Depends(get_db)]
_User = Annotated[User, Depends(get_current_user)]
_PathId = Annotated[int, Path(ge=1)]
_QueryId = Annotated[int | None, Query(ge=1)]
_QueryText = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] | None, Query()
]
_SerialText = Annotated[
    Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] | None, Query()
]
_Page = Annotated[int, Query(ge=1)]
_PageSize = Annotated[int, Query(ge=1, le=core.PAGE_SIZE_MAX)]
_IfMatch = Annotated[str | None, Header(alias="If-Match")]


@router.get("/safes", response_model=list[s.ArmorySafeRead])
def list_armory_safes(db: _Db) -> list[s.ArmorySafeRead]:
    return catalog.list_safes(db)


@router.post(
    "/safes",
    response_model=s.ArmorySafeRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_safe(payload: s.ArmorySafeCreate, db: _Db, user: _User) -> s.ArmorySafeRead:
    return catalog.create_safe(db, user, payload)


@router.get(
    "/site-options",
    response_model=s.ArmorySiteOptionsRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def list_armory_site_options(db: _Db) -> s.ArmorySiteOptionsRead:
    return catalog.site_options(db)


@router.get(
    "/settings",
    response_model=s.ArmorySettingsRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def get_armory_settings(db: _Db, response: Response) -> s.ArmorySettingsRead:
    settings = catalog.get_settings(db)
    response.headers["ETag"] = core.etag(settings.version)
    return settings


@router.patch(
    "/settings",
    response_model=s.ArmorySettingsRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def update_armory_settings(
    payload: s.ArmorySettingsUpdate,
    db: _Db,
    user: _User,
    response: Response,
    if_match: _IfMatch = None,
) -> s.ArmorySettingsRead:
    settings = catalog.update_settings(db, user, payload, if_match)
    response.headers["ETag"] = core.etag(settings.version)
    return settings


@router.get("/items", response_model=list[s.ArmoryItemRead])
def list_armory_items(
    db: _Db,
    safe_id: _QueryId = None,
    category: s.ArmoryCategory | None = None,
    q: _QueryText = None,
    stock_view: s.StockView = "all",
) -> list[s.ArmoryItemRead]:
    return catalog.list_items(db, safe_id=safe_id, category=category, q=q, stock_view=stock_view)


@router.post(
    "/items",
    response_model=s.ArmoryItemDetailRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_item(payload: s.ArmoryItemCreate, db: _Db, user: _User) -> s.ArmoryItemDetailRead:
    return catalog.create_item(db, user, payload)


@router.get("/items/{item_id}", response_model=s.ArmoryItemDetailRead)
def get_armory_item(item_id: _PathId, db: _Db, safe_id: _QueryId = None) -> s.ArmoryItemDetailRead:
    return catalog.item_detail(db, item_id, safe_id=safe_id)


@router.post(
    "/items/{item_id}/serials/record",
    response_model=s.ArmoryPostingRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def record_armory_serials(
    item_id: _PathId, payload: s.ArmorySerialRegistrationCreate, db: _Db, user: _User
) -> s.ArmoryPostingRead:
    return catalog.record_serials(db, user, item_id, payload)


@router.get("/serials/{serial_id}", response_model=s.ArmorySerialDetailRead)
def get_armory_serial(serial_id: _PathId, db: _Db) -> s.ArmorySerialDetailRead:
    return catalog.serial_detail(db, serial_id)


@router.post(
    "/serials/{serial_id}/movements",
    response_model=s.ArmoryPostingRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def move_armory_serial(
    serial_id: _PathId, payload: s.ArmorySerialMovementCreate, db: _Db, user: _User
) -> s.ArmoryPostingRead:
    return catalog.move_serial(db, user, serial_id, payload)


@router.get("/kits", response_model=list[s.ArmoryKitRead])
def list_armory_kits(db: _Db) -> list[s.ArmoryKitRead]:
    return catalog.list_kits(db)


@router.post(
    "/stock/receipts",
    response_model=s.ArmoryPostingRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_receipt(
    payload: s.ArmoryReceiptCreate, db: _Db, user: _User
) -> s.ArmoryPostingRead:
    return catalog.create_receipt(db, user, payload)


@router.get("/shift", response_model=s.ArmoryShiftRead)
def get_armory_shift(db: _Db, user: _User, safe_id: _QueryId = None) -> s.ArmoryShiftRead:
    return audit.shift(db, user, safe_id=safe_id)


@router.get(
    "/people",
    response_model=list[s.ArmoryPersonCandidateRead],
    dependencies=[Depends(require_capability("armory.edit"))],
)
def list_armory_people(
    db: _Db,
    user: _User,
    purpose: s.PeoplePurpose,
    q: _QueryText = None,
    safe_id: _QueryId = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[s.ArmoryPersonCandidateRead]:
    return custody.list_people(db, user, purpose=purpose, q=q, safe_id=safe_id, limit=limit)


@router.get("/issues/{issue_id}", response_model=s.ArmoryAssignmentRead)
def get_armory_issue(issue_id: _PathId, db: _Db) -> s.ArmoryAssignmentRead:
    return custody.get_issue(db, issue_id)


@router.post(
    "/issues",
    response_model=s.ArmoryAssignmentRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_issue(
    payload: s.ArmoryShiftIssueCreate, db: _Db, user: _User
) -> s.ArmoryAssignmentRead:
    return custody.create_issue(db, user, payload)


@router.post(
    "/returns",
    response_model=s.ArmoryReturnRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_return(payload: s.ArmoryReturnCreate, db: _Db, user: _User) -> s.ArmoryReturnRead:
    return custody.create_return(db, user, payload)


@router.post(
    "/returns/bulk",
    response_model=list[s.ArmoryReturnRead],
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_bulk_return(
    payload: s.ArmoryBulkReturnCreate, db: _Db, user: _User
) -> list[s.ArmoryReturnRead]:
    return custody.create_bulk_return(db, user, payload)


@router.get("/custody", response_model=s.ArmoryAssignmentPage)
def list_armory_custody(
    db: _Db,
    safe_id: _QueryId = None,
    state: s.CustodyStateFilter = "active",
    q: _QueryText = None,
    page: _Page = 1,
    page_size: _PageSize = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryAssignmentPage:
    return custody.list_custody(
        db, safe_id=safe_id, state=state, q=q, page=page, page_size=page_size
    )


@router.post(
    "/custody",
    response_model=s.ArmoryAssignmentRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_custody(
    payload: s.ArmoryCustodyCreate, db: _Db, user: _User
) -> s.ArmoryAssignmentRead:
    return custody.create_custody(db, user, payload)


@router.get("/custody/{custody_id}", response_model=s.ArmoryAssignmentRead)
def get_armory_custody(custody_id: _PathId, db: _Db) -> s.ArmoryAssignmentRead:
    return custody.get_custody(db, custody_id)


@router.get("/guards", response_model=s.ArmoryGuardPage)
def list_armory_guards(
    db: _Db,
    q: _QueryText = None,
    licence_status: s.ArmoryLicenceStatus | None = None,
    include_former: bool = False,
    page: _Page = 1,
    page_size: _PageSize = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryGuardPage:
    return custody.list_guards(
        db,
        q=q,
        licence_status=licence_status,
        include_former=include_former,
        page=page,
        page_size=page_size,
    )


@router.get("/guards/{employee_id}", response_model=s.ArmoryGuardRead)
def get_armory_guard(employee_id: str, db: _Db, response: Response) -> s.ArmoryGuardRead:
    guard = custody.get_guard(db, employee_id)
    response.headers["ETag"] = core.etag(guard.qualification.version)
    return guard


@router.put(
    "/guards/{employee_id}",
    response_model=s.ArmoryGuardRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def save_armory_qualification(
    employee_id: str,
    payload: s.ArmoryQualificationUpsert,
    db: _Db,
    user: _User,
    response: Response,
    if_match: _IfMatch = None,
) -> s.ArmoryGuardRead:
    guard = custody.save_qualification(db, user, employee_id, payload, if_match)
    response.headers["ETag"] = core.etag(guard.qualification.version)
    return guard


@router.get(
    "/safes/{safe_id}/shift-checks/draft",
    response_model=s.ArmoryShiftCheckDraftRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def get_armory_shift_check_draft(
    safe_id: _PathId, db: _Db, user: _User
) -> s.ArmoryShiftCheckDraftRead:
    return audit.shift_check_draft(db, user, safe_id)


@router.post(
    "/safes/{safe_id}/shift-checks",
    response_model=s.ArmoryCountRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_shift_check(
    safe_id: _PathId, payload: s.ArmoryShiftCheckCreate, db: _Db, user: _User
) -> s.ArmoryCountRead:
    return audit.create_shift_check(db, user, safe_id, payload)


@router.get(
    "/safes/{safe_id}/monthly-counts/draft",
    response_model=s.ArmoryMonthlyCountDraftRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def get_armory_monthly_count_draft(
    safe_id: _PathId, db: _Db, user: _User
) -> s.ArmoryMonthlyCountDraftRead:
    return audit.monthly_count_draft(db, user, safe_id)


@router.post(
    "/safes/{safe_id}/monthly-counts",
    response_model=s.ArmoryCountRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def create_armory_monthly_count(
    safe_id: _PathId, payload: s.ArmoryMonthlyCountCreate, db: _Db, user: _User
) -> s.ArmoryCountRead:
    return audit.create_monthly_count(db, user, safe_id, payload)


@router.get("/counts", response_model=s.ArmoryCountPage)
def list_armory_counts(
    db: _Db,
    safe_id: _QueryId = None,
    kind: s.CountKindFilter | None = None,
    month: Annotated[str | None, Query(pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")] = None,
    page: _Page = 1,
    page_size: _PageSize = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryCountPage:
    return audit.list_counts(
        db, safe_id=safe_id, kind=kind, month=month, page=page, page_size=page_size
    )


@router.get("/counts/{count_id}", response_model=s.ArmoryCountRead)
def get_armory_count(count_id: _PathId, db: _Db) -> s.ArmoryCountRead:
    return audit.get_count(db, count_id)


@router.get("/discrepancies", response_model=s.ArmoryDiscrepancyPage)
def list_armory_discrepancies(
    db: _Db,
    user: _User,
    safe_id: _QueryId = None,
    status: s.DiscrepancyStatusFilter = "open",
    discrepancy_id: _QueryId = None,
    page: _Page = 1,
    page_size: _PageSize = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryDiscrepancyPage:
    return audit.list_discrepancies(
        db,
        user,
        safe_id=safe_id,
        status=status,
        discrepancy_id=discrepancy_id,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/discrepancies/{discrepancy_id}/decision",
    response_model=s.ArmoryDiscrepancyRead,
    status_code=201,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def decide_armory_discrepancy(
    discrepancy_id: _PathId, payload: s.ArmoryDecisionCreate, db: _Db, user: _User
) -> s.ArmoryDiscrepancyRead:
    return audit.decide(db, user, discrepancy_id, payload)


@router.get("/movements", response_model=s.ArmoryPostingPage)
def list_armory_movements(
    db: _Db,
    safe_id: _QueryId = None,
    item_id: _QueryId = None,
    serial: _SerialText = None,
    employee_id: str | None = None,
    q: _QueryText = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    kind: s.ArmoryPostingKind | None = None,
    page: _Page = 1,
    page_size: _PageSize = core.PAGE_SIZE_DEFAULT,
) -> s.ArmoryPostingPage:
    return reads.list_movements(
        db,
        safe_id=safe_id,
        item_id=item_id,
        serial=serial,
        employee_id=employee_id,
        q=q,
        date_from=date_from,
        date_to=date_to,
        kind=kind,
        page=page,
        page_size=page_size,
    )


@router.get("/movements/{posting_id}", response_model=s.ArmoryPostingRead)
def get_armory_movement(posting_id: _PathId, db: _Db) -> s.ArmoryPostingRead:
    return reads.get_movement(db, posting_id)


@router.post(
    "/movements/{posting_id}/void",
    response_model=s.ArmoryPostingRead,
    dependencies=[Depends(require_capability("armory.edit"))],
)
def void_armory_movement(
    posting_id: _PathId, payload: s.ArmoryVoid, db: _Db, user: _User
) -> s.ArmoryPostingRead:
    return reversal.void(db, user, posting_id, payload)


@router.get("/find", response_model=s.ArmoryFindRead)
def find_armory_records(
    db: _Db, q: _QueryText = None, recent_safe_id: _QueryId = None
) -> s.ArmoryFindRead:
    return reads.find(db, q=q, recent_safe_id=recent_safe_id)


@router.get("/summary", response_model=s.ArmoryAlertsRead)
def get_armory_summary(db: _Db, safe_id: _QueryId = None) -> s.ArmoryAlertsRead:
    return audit.summary(db, safe_id=safe_id)


@router.get(
    "/employees/{employee_id}",
    response_model=s.ArmoryEmployeeRead,
    dependencies=[Depends(require_capability("employees.view"))],
)
def get_armory_employee(
    employee_id: str, db: _Db, page: _Page = 1, page_size: _PageSize = core.PAGE_SIZE_DEFAULT
) -> s.ArmoryEmployeeRead:
    return custody.employee_armory(db, employee_id, page=page, page_size=page_size)


@router.get(
    "/employees/{employee_id}/clearance",
    response_model=s.ArmoryClearanceRead,
    dependencies=[
        Depends(require_capability("documents.generate")),
        Depends(require_capability("books.view")),
        Depends(require_capability("books.service.Employee Clearance Form")),
    ],
)
def get_armory_clearance(employee_id: str, db: _Db) -> s.ArmoryClearanceRead:
    return custody.clearance(db, employee_id)
