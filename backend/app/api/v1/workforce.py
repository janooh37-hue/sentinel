"""Capability-gated, scoped workforce API surface."""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Annotated, Any, TypeVar
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.db.models import AuditLog, Employee, User
from app.db.session import get_db
from app.db.workforce_models import (
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    UserWorkforceScope,
    WorkAttendancePolicy,
    WorkCrew,
    WorkCrewMembership,
    WorkCrewSchedule,
    WorkRotationPattern,
    WorkShiftDefinition,
    WorkShiftOverride,
    WorkStaffingRequirement,
)
from app.schemas.workforce import (
    AdjustmentRevokeWrite,
    AttendanceAdjustmentWrite,
    AttendanceCaseRead,
    AttendanceDayRowRead,
    AttendanceExceptionRead,
    AttendancePolicyWrite,
    ConfigurationPatch,
    CoverageRowRead,
    CrewMembershipEndWrite,
    CrewMembershipWrite,
    CrewSchedulePreviewRead,
    CrewSchedulePreviewWrite,
    CrewScheduleReplaceWrite,
    CrewScheduleWrite,
    CursorPage,
    DutyAssignmentEventRead,
    EmployeeAttendanceHistoryRead,
    EmployeeAttendanceRangeRead,
    EvaluationQueueRead,
    IntegrationStatusRead,
    ProviderPersonMappingWrite,
    ProviderPersonRead,
    RosterRowRead,
    ShiftOverrideWrite,
    ShiftSwapWrite,
    StaffingRequirementWrite,
    WorkCrewPatch,
    WorkCrewRead,
    WorkCrewWrite,
    WorkforceAccessRead,
    WorkforceAnalyticsRead,
    WorkforceConfiguration,
    WorkforceConfigurationRead,
    WorkforceCrewMembershipRead,
    WorkforceCrewScheduleRead,
    WorkforceRotationRead,
    WorkforceScopeReplace,
    WorkforceShiftDefinitionRead,
    WorkforceSnapshotRead,
)
from app.services import (
    attendance_history_service,
    attendance_sync_service,
    perm_service,
    scheduler_service,
    settings_service,
    workforce_admin_service,
    workforce_dashboard_service,
    workforce_read_service,
    workforce_schedule_service,
)
from app.services.attendance_provider import AttendanceProvider
from app.services.attendance_queue_service import retry_evaluation_queue_item
from app.services.workforce_scope_service import (
    WorkforceScope,
    decode_cursor,
    encode_cursor,
    intersect_workforce_scope,
    normalize_scope_entry,
    normalize_scope_value,
    resolve_workforce_scope,
    scope_allows,
)

router = APIRouter(prefix="/workforce", tags=["workforce"])
_T = TypeVar("_T")
_MAX_LIMIT = 500


def _scope(db: Session, user: User) -> WorkforceScope:
    return resolve_workforce_scope(db, user)


def _scope_fingerprint(scope: object) -> str:
    """Bind a cursor to its issuing scope; organization-wide routes pass a marker."""
    return hashlib.sha256(repr(scope).encode("utf-8")).hexdigest()


def _cursor_page[T](rows: list[T], *, endpoint: str, scope: object, filters: dict[str, object], limit: int, cursor: str | None) -> tuple[list[T], str | None]:
    try:
        decoded = decode_cursor(cursor)
    except ValueError as exc:
        raise ValidationFailedError("INVALID_CURSOR", "Cursor is invalid.") from exc
    filter_blob = json.dumps(filters, sort_keys=True, separators=(",", ":"), default=str)
    scope_id = _scope_fingerprint(scope)
    offset = 0
    if decoded is not None:
        if decoded.get("endpoint") != endpoint or decoded.get("scope") != scope_id or decoded.get("filters") != filter_blob:
            raise ValidationFailedError("INVALID_CURSOR", "Cursor does not belong to this query.")
        position = decoded.get("position")
        if not isinstance(position, int) or position < 0:
            raise ValidationFailedError("INVALID_CURSOR", "Cursor is invalid.")
        offset = position
    items = rows[offset : offset + limit]
    next_cursor = None
    if offset + limit < len(rows):
        next_cursor = encode_cursor({"endpoint": endpoint, "scope": scope_id, "filters": filter_blob, "position": offset + limit})
    return items, next_cursor


def _set_etag(response: Response, tag: str) -> None:
    response.headers["ETag"] = tag


def _scope_rows(db: Session, user_id: int) -> list[UserWorkforceScope]:
    return list(db.scalars(select(UserWorkforceScope).where(UserWorkforceScope.user_id == user_id).order_by(UserWorkforceScope.scope_kind, UserWorkforceScope.department, UserWorkforceScope.duty_unit, UserWorkforceScope.duty_post)))


def _scope_payload(rows: list[UserWorkforceScope]) -> list[dict[str, str | None]]:
    return [{"scope_kind": row.scope_kind, "department": row.department, "duty_unit": row.duty_unit, "duty_post": row.duty_post} for row in rows]


def _scope_etag(rows: list[UserWorkforceScope]) -> str:
    return workforce_admin_service.etag_for(_scope_payload(rows))


def _assert_scope_filter(scope: WorkforceScope, *, department: str | None, duty_unit: str | None, duty_post: str | None) -> WorkforceScope:
    if any(value is not None for value in (department, duty_unit, duty_post)) and not scope_allows(
        scope,
        employee_id="__scope_filter__",
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    ):
        raise AppError("FORBIDDEN", "Requested filter is outside workforce scope.", http_status=403)
    return intersect_workforce_scope(
        scope,
        department=department,
        duty_unit=duty_unit,
        duty_post=duty_post,
    )


def _intersect_coverage_scope(
    scope: WorkforceScope,
    *,
    department: str | None,
    duty_unit: str | None,
) -> WorkforceScope:
    """Allow a selected hierarchy ancestor without widening a narrower grant."""
    if department is None and duty_unit is None:
        return scope
    for entry in scope.entries:
        if entry.scope_kind == "organization":
            return intersect_workforce_scope(scope, department=department, duty_unit=duty_unit)
        if entry.scope_kind == "self":
            continue
        if entry.department is not None and entry.department != department:
            continue
        if duty_unit is not None and entry.scope_kind != "department" and entry.duty_unit != duty_unit:
            continue
        return intersect_workforce_scope(scope, department=department, duty_unit=duty_unit)
    raise AppError("FORBIDDEN", "Requested filter is outside workforce scope.", http_status=403)


def _require_organization_schedule_scope(db: Session, user: User) -> None:
    """Crew identity and anchors are organization-wide, never hierarchy-local."""

    if not _scope(db, user).is_organization:
        raise AppError(
            "FORBIDDEN",
            "Organization workforce scope is required for crew and anchor changes.",
            http_status=403,
        )


def _require_organization_workforce_scope(db: Session, user: User) -> None:
    """Guard organization-global surfaces that no hierarchy scope can own.

    Provider configuration/test/sync, unmapped-person reconciliation, and
    organization-wide policy/configuration all bind every department, so a
    capability alone must not authorize them.
    """

    if not _scope(db, user).is_organization:
        raise AppError(
            "FORBIDDEN",
            "Organization workforce scope is required for this change.",
            http_status=403,
        )


def _is_own_employee(user: User, employee_id: str) -> bool:
    """Whether this caller is asking about their own linked employee record."""
    linked = (user.employee_id or "").strip()
    return bool(linked) and linked == employee_id


def _require_employee_schedule_scope(db: Session, user: User, employee_id: str) -> Employee:
    """Return a target employee only when the manager's resolved scope permits it."""

    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFoundError("WORKFORCE_EMPLOYEE_NOT_FOUND", "Employee was not found.")
    if not _scope(db, user).allows_employee(
        employee_id=employee.id,
        department=employee.department,
        duty_unit=employee.duty_unit,
        duty_post=employee.duty_post,
    ):
        raise AppError(
            "FORBIDDEN",
            "The employee is outside the assigned workforce scope.",
            http_status=403,
        )
    return employee


def _crew_collection_etag(rows: list[WorkCrew]) -> str:
    return workforce_admin_service.etag_for(
        [
            {"id": row.id, "updated_at": row.updated_at, "created_at": row.created_at}
            for row in rows
        ]
    )


def _crew_schedule_collection_etag(rows: list[WorkCrewSchedule]) -> str:
    return workforce_admin_service.etag_for(
        [
            {
                "id": row.id,
                "version": row.version,
                "updated_at": row.updated_at,
                "created_at": row.created_at,
            }
            for row in rows
        ]
    )


def _crew_membership_collection_etag(rows: list[WorkCrewMembership]) -> str:
    return workforce_admin_service.etag_for(
        [
            {"id": row.id, "updated_at": row.updated_at, "created_at": row.created_at}
            for row in rows
        ]
    )


def _require_management(db: Session, user: User) -> None:
    if any(
        perm_service.has_capability(db, user, cap)
        for cap in ("workforce.schedule.manage", "workforce.policy.manage", "workforce.integration.manage")
    ):
        return
    raise AppError("FORBIDDEN", "Missing workforce management capability.", http_status=403)


def _visible_crew_memberships(
    db: Session, *, crew_id: int, scope: WorkforceScope
) -> list[WorkCrewMembership]:
    rows = workforce_read_service.list_crew_memberships(db, crew_id=crew_id)
    employee_ids = {row.employee_id for row in rows}
    employees = {
        employee.id: employee
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids)))
    }
    return [
        row
        for row in rows
        if (employee := employees.get(row.employee_id)) is not None
        and scope.allows_employee(
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        )
    ]


def _configuration_etag(
    configuration: WorkforceConfiguration | None,
) -> str:
    value = (
        configuration.model_dump(mode="json")
        if configuration is not None
        else {"configured": False}
    )
    return workforce_admin_service.etag_for(value)




def _crew_read(row: WorkCrew) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "name_en": row.name_en,
        "name_ar": row.name_ar,
        "active": row.active,
        "version": workforce_admin_service.row_etag(row),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }

def _provider_read(row: AttendanceProviderPerson) -> dict[str, Any]:
    return {"id": row.id, "provider": row.provider, "external_person_id": row.external_person_id, "external_employee_code": row.external_employee_code, "display_name_snapshot": row.display_name_snapshot, "employee_id": row.employee_id, "mapping_state": row.mapping_state, "active": row.active, "first_seen_at": row.first_seen_at, "last_seen_at": row.last_seen_at}


def _queue_read(row: AttendanceEvaluationQueue) -> dict[str, Any]:
    return {"id": row.id, "employee_id": row.employee_id, "window_start_at": row.window_start_at, "window_end_at": row.window_end_at, "reason_codes": row.reason_codes, "available_at": row.available_at, "failed_at": row.failed_at, "attempts": row.attempts, "last_error_code": row.last_error_code}


# `exclude_unset` omits the capability-gated `self`/`aggregate` blocks the service
# never set, while preserving explicit nulls: a null judgment means "withheld",
# which `exclude_none` would erase into an indistinguishable missing field.
@router.get("/dashboard/snapshot", response_model=WorkforceSnapshotRead, response_model_exclude_unset=True)
def get_dashboard_snapshot(user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    aggregate = perm_service.has_capability(db, user, "workforce.dashboard.view")
    self_allowed = bool(user.employee_id) and perm_service.has_capability(db, user, "workforce.self.view")
    if not aggregate and not self_allowed:
        raise AppError("FORBIDDEN", "Missing workforce dashboard capability.", http_status=403)
    return workforce_dashboard_service.get_workforce_snapshot(db, scope=_scope(db, user) if aggregate else None, self_employee_id=user.employee_id if self_allowed else None, include_aggregate=aggregate).value


@router.get("/dashboard/analytics", response_model=WorkforceAnalyticsRead)
def get_dashboard_analytics(user: Annotated[User, Depends(require_capability("workforce.dashboard.view"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    return workforce_dashboard_service.get_workforce_analytics(db, scope=_scope(db, user)).value


@router.get("/dashboard/coverage", response_model=CursorPage[CoverageRowRead])
def get_dashboard_coverage(
    operational_date: date,
    parent_kind: Annotated[str, Query(pattern="^(organization|department|duty_unit)$")],
    user: Annotated[User, Depends(require_capability("workforce.dashboard.view"))],
    db: Annotated[Session, Depends(get_db)],
    department: str | None = None,
    duty_unit: str | None = None,
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    department = normalize_scope_value(department)
    duty_unit = normalize_scope_value(duty_unit)
    if parent_kind == "organization" and (department is not None or duty_unit is not None):
        raise ValidationFailedError("WORKFORCE_COVERAGE_PARENT_INVALID", "Organization coverage cannot include a parent filter.")
    if parent_kind == "department" and (department is None or duty_unit is not None):
        raise ValidationFailedError("WORKFORCE_COVERAGE_PARENT_INVALID", "Duty-unit coverage requires only a department filter.")
    if parent_kind == "duty_unit" and (department is None or duty_unit is None):
        raise ValidationFailedError("WORKFORCE_COVERAGE_PARENT_INVALID", "Duty-post coverage requires department and duty-unit filters.")
    scope = _intersect_coverage_scope(_scope(db, user), department=department, duty_unit=duty_unit)
    rows = workforce_dashboard_service.get_coverage_children(
        db,
        scope=scope,
        operational_date=operational_date,
        parent_kind=parent_kind,
        department=department,
        duty_unit=duty_unit,
    )
    items, next_cursor = _cursor_page(
        rows,
        endpoint="coverage",
        scope=scope,
        filters={
            "operational_date": operational_date,
            "parent_kind": parent_kind,
            "department": department,
            "duty_unit": duty_unit,
        },
        limit=limit,
        cursor=cursor,
    )
    return {"items": items, "next_cursor": next_cursor}


@router.get("/access/me", response_model=WorkforceAccessRead)
def get_my_workforce_access(user: Annotated[User, Depends(get_current_user)], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    scope = _scope(db, user)
    # `canonical_payload()` exists for authorization-version hashing and carries
    # `employee_id`, which `WorkforceScopeRead` forbids (and which is always None
    # here, since `persisted_entries` excludes the synthesized self leg). Emit
    # exactly the response shape instead: widening the Read model would also
    # widen WorkforceScopeWrite, which correctly rejects a client-authored
    # employee binding today.
    return {
        "workforce_access_tier": scope.workforce_access_tier,
        "scopes": [
            {
                "scope_kind": entry.scope_kind,
                "department": entry.department,
                "duty_unit": entry.duty_unit,
                "duty_post": entry.duty_post,
            }
            for entry in scope.persisted_entries
        ],
    }


@router.get("/access/users/{user_id}/scopes", response_model=WorkforceScopeReplace)
def get_user_scopes(user_id: int, response: Response, _admin: Annotated[User, Depends(require_capability("users.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    if db.get(User, user_id) is None:
        raise NotFoundError("USER_NOT_FOUND", "User was not found.")
    rows = _scope_rows(db, user_id)
    _set_etag(response, _scope_etag(rows))
    return {"scopes": _scope_payload(rows)}


@router.put("/access/users/{user_id}/scopes", response_model=WorkforceScopeReplace)
def replace_user_scopes(*, user_id: int, body: WorkforceScopeReplace, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, actor: Annotated[User, Depends(require_capability("users.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    if db.get(User, user_id) is None:
        raise NotFoundError("USER_NOT_FOUND", "User was not found.")
    current = _scope_rows(db, user_id)
    workforce_admin_service.require_if_match(if_match, _scope_etag(current))
    normalized = [normalize_scope_entry(**scope.model_dump()) for scope in body.scopes]
    if len(set(normalized)) != len(normalized):
        raise ValidationFailedError("DUPLICATE_WORKFORCE_SCOPE", "Scope replacement contains a duplicate grant.")
    db.query(UserWorkforceScope).filter(UserWorkforceScope.user_id == user_id).delete(synchronize_session=False)
    for entry in normalized:
        db.add(UserWorkforceScope(user_id=user_id, scope_kind=entry.scope_kind, department=entry.department, duty_unit=entry.duty_unit, duty_post=entry.duty_post, created_by_user_id=actor.id))
    db.add(AuditLog(actor=actor.employee_id or actor.email, action="workforce.scope.replaced", entity_type="user_workforce_scope", entity_id=str(user_id), payload=json.dumps({"scope_count": len(normalized)})))
    db.commit()
    rows = _scope_rows(db, user_id)
    _set_etag(response, _scope_etag(rows))
    return {"scopes": _scope_payload(rows)}


@router.get("/roster", response_model=CursorPage[RosterRowRead])
def get_roster(operational_date: date, user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = workforce_read_service.list_roster(db, scope=scope, operational_date=operational_date)
    items, next_cursor = _cursor_page(rows, endpoint="roster", scope=scope, filters={"operational_date": operational_date}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/attendance/exceptions", response_model=CursorPage[AttendanceExceptionRead])
def get_attendance_exceptions(user: Annotated[User, Depends(require_capability("workforce.attendance.review"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)], operational_date: date | None = None, presence: str | None = None, exception: str | None = None, corrected: bool | None = None, limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = workforce_read_service.list_exceptions(db, scope=scope, operational_date=operational_date, presence=presence, exception=exception, corrected=corrected)
    def severity(row: dict[str, Any]) -> tuple[int, str, int]:
        if row.get("presence_state") == "absent":
            return (0, row["employee_id"], row["case_id"])
        if row.get("missing_checkout"):
            return (1, row["employee_id"], row["case_id"])
        if (row.get("late_minutes") or 0) > 0:
            return (2, row["employee_id"], row["case_id"])
        if (row.get("early_exit_minutes") or 0) > 0:
            return (3, row["employee_id"], row["case_id"])
        if row.get("presence_state") == "unknown":
            return (4, row["employee_id"], row["case_id"])
        return (5, row["employee_id"], row["case_id"])
    rows = sorted(rows, key=severity)
    items, next_cursor = _cursor_page(rows, endpoint="exceptions", scope=scope, filters={"operational_date": operational_date, "presence": presence, "exception": exception, "corrected": corrected}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/attendance/day", response_model=CursorPage[AttendanceDayRowRead])
def get_attendance_day(
    operational_date: date,
    user: Annotated[User, Depends(require_capability("workforce.attendance.review"))],
    people_user: Annotated[User, Depends(require_capability("workforce.people.view"))],
    db: Annotated[Session, Depends(get_db)],
    shift_code: Annotated[str | None, Query(pattern="^[a-z_]{1,32}$")] = None,
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 200,
    cursor: str | None = None,
) -> dict[str, Any]:
    """The register payload: one row per person per scheduled shift, with punches."""
    scope = _scope(db, user)
    rows = workforce_read_service.list_attendance_day(
        db, scope=scope, operational_date=operational_date, shift_code=shift_code
    )
    items, next_cursor = _cursor_page(
        rows,
        endpoint="attendance-day",
        scope=scope,
        filters={"operational_date": operational_date, "shift_code": shift_code},
        limit=limit,
        cursor=cursor,
    )
    return {"items": items, "next_cursor": next_cursor}


@router.get("/employees/{employee_id}/attendance", response_model=EmployeeAttendanceRangeRead)
def get_employee_attendance(
    employee_id: str,
    from_date: date,
    to_date: date,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """One employee's attendance days.

    Two separate doors: ``workforce.self.view`` opens only the caller's own linked
    employee record, while a roster reader needs both ``workforce.people.view``
    and ``workforce.attendance.review`` and stays inside their resolved scope.
    """
    own = _is_own_employee(user, employee_id)
    if not (own and perm_service.has_capability(db, user, "workforce.self.view")):
        for capability in ("workforce.people.view", "workforce.attendance.review"):
            if not perm_service.has_capability(db, user, capability):
                raise AppError(
                    "FORBIDDEN",
                    "Capability required.",
                    http_status=status.HTTP_403_FORBIDDEN,
                )
    return workforce_read_service.employee_attendance_range(
        db,
        scope=_scope(db, user),
        employee_id=employee_id,
        from_date=from_date,
        to_date=to_date,
    )


def get_attendance_provider() -> AttendanceProvider:
    """The configured provider, as an overridable dependency.

    A route that resolved this itself would reach the vendor from a test run, and
    a caller could not substitute a double. Injection keeps the network at the
    edge where it can be replaced.
    """
    provider = scheduler_service._resolve_verified_attendance_provider()
    if provider is None:
        raise AppError(
            "PROVIDER_UNAVAILABLE",
            "Attendance provider is not configured.",
            http_status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return provider


@router.get(
    "/employees/{employee_id}/attendance/history",
    response_model=EmployeeAttendanceHistoryRead,
)
def get_employee_attendance_history(
    employee_id: str,
    from_date: date,
    to_date: date,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    provider: Annotated[AttendanceProvider, Depends(get_attendance_provider)],
) -> dict[str, Any]:
    """One employee's punch history, read from the provider on request.

    The provider owns years the roster does not cover, so this answers "when was
    this person seen" without importing anything and without pretending the days
    before the schedule existed can be judged. Same two doors as
    ``get_employee_attendance``, plus the caller's resolved scope.
    """
    if _is_own_employee(user, employee_id) and perm_service.has_capability(
        db, user, "workforce.self.view"
    ):
        if db.get(Employee, employee_id) is None:
            raise NotFoundError("WORKFORCE_EMPLOYEE_NOT_FOUND", "Employee was not found.")
    else:
        for capability in ("workforce.people.view", "workforce.attendance.review"):
            if not perm_service.has_capability(db, user, capability):
                raise AppError(
                    "FORBIDDEN",
                    "Capability required.",
                    http_status=status.HTTP_403_FORBIDDEN,
                )
        _require_employee_schedule_scope(db, user, employee_id)
    if to_date < from_date:
        raise ValidationFailedError(
            "WORKFORCE_HISTORY_RANGE_INVALID", "to_date must not precede from_date."
        )
    if (to_date - from_date).days + 1 > attendance_history_service.MAX_RANGE_DAYS:
        raise ValidationFailedError(
            "WORKFORCE_HISTORY_RANGE_INVALID",
            f"Range must not exceed {attendance_history_service.MAX_RANGE_DAYS} days.",
        )
    try:
        return attendance_history_service.employee_punch_history(
            db,
            employee_id=employee_id,
            from_date=from_date,
            to_date=to_date,
            provider=provider,
            zone=ZoneInfo(get_settings().biotime_time_zone),
        )
    except Exception as exc:
        # Never surface vendor response text: it can carry personal data and the
        # configured provider URL.
        raise AppError(
            "PROVIDER_UNAVAILABLE",
            "The attendance provider could not be read.",
            http_status=status.HTTP_502_BAD_GATEWAY,
        ) from exc


@router.get("/attendance/cases/{case_id}", response_model=AttendanceCaseRead)
def get_attendance_case(case_id: int, response: Response, user: Annotated[User, Depends(require_capability("workforce.attendance.review"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    snapshot = workforce_read_service.get_attendance_case_snapshot(
        db, scope=_scope(db, user), case_id=case_id
    )
    _set_etag(response, snapshot.etag)
    return snapshot.body


@router.post("/attendance/cases/{case_id}/adjustments", status_code=status.HTTP_201_CREATED)
def create_attendance_adjustment(*, case_id: int, body: AttendanceAdjustmentWrite, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.attendance.correct"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    workforce_read_service.get_attendance_case(db, scope=_scope(db, user), case_id=case_id)
    row = workforce_admin_service.apply_adjustment(db, case_id=case_id, payload=body.model_dump(mode="python"), if_match=if_match, actor=user)
    db.commit()
    _set_etag(response, workforce_admin_service.attendance_case_etag(db, case_id))
    return {"id": row.id, "case_id": case_id}


@router.post("/attendance/cases/{case_id}/adjustments/{adjustment_id}/revoke")
def revoke_attendance_adjustment(*, case_id: int, adjustment_id: int, body: AdjustmentRevokeWrite, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.attendance.correct"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    workforce_read_service.get_attendance_case(db, scope=_scope(db, user), case_id=case_id)
    row = workforce_admin_service.revoke_adjustment(db, case_id=case_id, adjustment_id=adjustment_id, reason=body.reason, if_match=if_match, actor=user)
    db.commit()
    _set_etag(response, workforce_admin_service.attendance_case_etag(db, case_id))
    return {"id": row.id, "revoked_at": row.revoked_at}


@router.get("/duty-assignment-events", response_model=CursorPage[DutyAssignmentEventRead])
def get_duty_assignment_events(user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = workforce_read_service.list_duty_assignment_events(db, scope=scope)
    items, next_cursor = _cursor_page(rows, endpoint="duty-events", scope=scope, filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.get(
    "/schedule/definitions",
    response_model=CursorPage[WorkforceShiftDefinitionRead],
)
def get_shift_definitions(
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    rows = list(db.scalars(select(WorkShiftDefinition).order_by(WorkShiftDefinition.code)))
    items, next_cursor = _cursor_page(
        [workforce_read_service.shift_definition_read(row) for row in rows],
        endpoint="schedule-definitions",
        scope={"management": True},
        filters={},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(
        response,
        workforce_admin_service.etag_for(
            [
                {"id": row.id, "updated_at": row.updated_at, "created_at": row.created_at}
                for row in rows
            ]
        ),
    )
    return {"items": items, "next_cursor": next_cursor}


@router.get("/schedule/rotation", response_model=WorkforceRotationRead)
def get_rotation_pattern(
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.scalar(select(WorkRotationPattern).order_by(WorkRotationPattern.code).limit(1))
    if row is None:
        raise NotFoundError("WORKFORCE_ROTATION_NOT_FOUND", "Rotation pattern was not found.")
    data = workforce_read_service.rotation_read(db, row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.get("/crews", response_model=CursorPage[WorkCrewRead])
def list_crews(
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    rows = list(db.scalars(select(WorkCrew).order_by(WorkCrew.code)))
    items, next_cursor = _cursor_page(
        [_crew_read(row) for row in rows],
        endpoint="crews",
        scope={"management": True},
        filters={},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, _crew_collection_etag(rows))
    return {"items": items, "next_cursor": next_cursor}


@router.get("/crews/{crew_id}", response_model=WorkCrewRead)
def get_crew(
    crew_id: int,
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.get(WorkCrew, crew_id)
    if row is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    data = _crew_read(row)
    _set_etag(response, data["version"])
    return data


@router.post("/crews", response_model=WorkCrewRead, status_code=status.HTTP_201_CREATED)
def create_crew(
    *,
    body: WorkCrewWrite,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_organization_schedule_scope(db, user)
    workforce_admin_service.require_if_match(
        if_match,
        _crew_collection_etag(list(db.scalars(select(WorkCrew).order_by(WorkCrew.id)))),
    )
    row = workforce_admin_service.create_crew(db, payload=body.model_dump(), actor=user)
    db.commit()
    data = _crew_read(row)
    _set_etag(response, data["version"])
    return data


@router.patch("/crews/{crew_id}", response_model=WorkCrewRead)
def patch_crew(
    *,
    crew_id: int,
    body: WorkCrewPatch,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_organization_schedule_scope(db, user)
    row = workforce_admin_service.update_crew(
        db,
        crew_id=crew_id,
        payload=body.model_dump(exclude_unset=True),
        if_match=if_match,
        actor=user,
    )
    db.commit()
    data = _crew_read(row)
    _set_etag(response, data["version"])
    return data


@router.delete("/crews/{crew_id}", response_model=WorkCrewRead)
def retire_crew(
    *,
    crew_id: int,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_organization_schedule_scope(db, user)
    row = workforce_admin_service.retire_crew(
        db,
        crew_id=crew_id,
        if_match=if_match,
        actor=user,
    )
    db.commit()
    data = _crew_read(row)
    _set_etag(response, data["version"])
    return data


@router.get(
    "/crews/{crew_id}/schedules",
    response_model=CursorPage[WorkforceCrewScheduleRead],
)
def list_crew_schedules(
    crew_id: int,
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    if db.get(WorkCrew, crew_id) is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    rows = workforce_read_service.list_crew_schedules(db, crew_id=crew_id)
    items, next_cursor = _cursor_page(
        [workforce_read_service.crew_schedule_read(row) for row in rows],
        endpoint="crew-schedules",
        scope={"management": True},
        filters={"crew_id": crew_id},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, _crew_schedule_collection_etag(rows))
    return {"items": items, "next_cursor": next_cursor}


@router.get(
    "/crews/{crew_id}/schedules/{schedule_id}",
    response_model=WorkforceCrewScheduleRead,
)
def get_crew_schedule(
    crew_id: int,
    schedule_id: int,
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.get(WorkCrewSchedule, schedule_id)
    if row is None or row.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_SCHEDULE_NOT_FOUND", "Crew schedule was not found.")
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.post(
    "/crews/{crew_id}/schedules",
    response_model=WorkforceCrewScheduleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_crew_schedule(
    *,
    crew_id: int,
    body: CrewScheduleWrite,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_organization_schedule_scope(db, user)
    crew = db.get(WorkCrew, crew_id)
    if crew is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    if not crew.active:
        raise ValidationFailedError("WORKFORCE_CREW_INACTIVE", "Crew is retired.")
    schedules = workforce_read_service.list_crew_schedules(db, crew_id=crew_id)
    workforce_admin_service.require_if_match(if_match, _crew_schedule_collection_etag(schedules))
    try:
        row = workforce_schedule_service.create_crew_schedule(
            db,
            crew_id=crew_id,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_SCHEDULE_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.post(
    "/crews/{crew_id}/schedules/{schedule_id}/replace",
    response_model=WorkforceCrewScheduleRead,
    status_code=status.HTTP_201_CREATED,
)
def replace_crew_schedule(
    *,
    crew_id: int,
    schedule_id: int,
    body: CrewScheduleReplaceWrite,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_organization_schedule_scope(db, user)
    current = db.get(WorkCrewSchedule, schedule_id)
    if current is None or current.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_SCHEDULE_NOT_FOUND", "Crew schedule was not found.")
    workforce_admin_service.require_if_match(
        if_match, workforce_admin_service.row_etag(current)
    )
    try:
        row = workforce_schedule_service.replace_crew_schedule(
            db,
            crew_id=crew_id,
            expected_version=current.version,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_SCHEDULE_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.post(
    "/crews/{crew_id}/schedules/preview",
    response_model=CrewSchedulePreviewRead,
)
def preview_crew_schedule(
    crew_id: int,
    body: CrewSchedulePreviewWrite,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    _require_organization_schedule_scope(db, user)
    if db.get(WorkCrew, crew_id) is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    return workforce_read_service.preview_crew_schedule(
        db,
        crew_id=crew_id,
        **body.model_dump(mode="python"),
    )


@router.get(
    "/crews/{crew_id}/memberships",
    response_model=CursorPage[WorkforceCrewMembershipRead],
)
def list_crew_memberships(
    crew_id: int,
    response: Response,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    if db.get(WorkCrew, crew_id) is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    scope = _scope(db, user)
    rows = [
        row
        for row in workforce_read_service.list_crew_memberships(db, crew_id=crew_id)
        if (employee := db.get(Employee, row.employee_id)) is not None
        and scope.allows_employee(
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        )
    ]
    items, next_cursor = _cursor_page(
        [workforce_read_service.crew_membership_read(row) for row in rows],
        endpoint="crew-memberships",
        scope=scope,
        filters={"crew_id": crew_id},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, _crew_membership_collection_etag(rows))
    return {"items": items, "next_cursor": next_cursor}


@router.get(
    "/crews/{crew_id}/memberships/{membership_id}",
    response_model=WorkforceCrewMembershipRead,
)
def get_crew_membership(
    crew_id: int,
    membership_id: int,
    response: Response,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row = db.get(WorkCrewMembership, membership_id)
    if row is None or row.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_MEMBERSHIP_NOT_FOUND", "Crew membership was not found.")
    _require_employee_schedule_scope(db, user, row.employee_id)
    data = workforce_read_service.crew_membership_read(row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.post(
    "/crews/{crew_id}/memberships",
    response_model=WorkforceCrewMembershipRead,
    status_code=status.HTTP_201_CREATED,
)
def create_crew_membership(
    *,
    crew_id: int,
    body: CrewMembershipWrite,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    _require_employee_schedule_scope(db, user, body.employee_id)
    crew = db.get(WorkCrew, crew_id)
    if crew is None:
        raise NotFoundError("WORKFORCE_CREW_NOT_FOUND", "Crew was not found.")
    if not crew.active:
        raise ValidationFailedError("WORKFORCE_CREW_INACTIVE", "Crew is retired.")
    scope = _scope(db, user)
    memberships = [
        membership
        for membership in workforce_read_service.list_crew_memberships(db, crew_id=crew_id)
        if (employee := db.get(Employee, membership.employee_id)) is not None
        and scope.allows_employee(
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        )
    ]
    workforce_admin_service.require_if_match(
        if_match, _crew_membership_collection_etag(memberships)
    )
    try:
        row = workforce_schedule_service.create_crew_membership(
            db,
            crew_id=crew_id,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_MEMBERSHIP_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_membership_read(row)
    _set_etag(response, workforce_admin_service.row_etag(row))
    return data


@router.post(
    "/crews/{crew_id}/memberships/{membership_id}/end",
    response_model=WorkforceCrewMembershipRead,
)
def end_crew_membership(
    *,
    crew_id: int,
    membership_id: int,
    body: CrewMembershipEndWrite,
    response: Response,
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
    user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    workforce_schedule_service.acquire_schedule_write_lock(db)
    row = db.get(WorkCrewMembership, membership_id)
    if row is None or row.crew_id != crew_id:
        raise NotFoundError("WORKFORCE_MEMBERSHIP_NOT_FOUND", "Crew membership was not found.")
    _require_employee_schedule_scope(db, user, row.employee_id)
    workforce_admin_service.require_if_match(
        if_match, workforce_admin_service.row_etag(row)
    )
    try:
        updated = workforce_schedule_service.end_crew_membership(
            db,
            membership_id=membership_id,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_MEMBERSHIP_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_membership_read(updated)
    _set_etag(response, workforce_admin_service.row_etag(updated))
    return data


@router.get("/overrides", response_model=CursorPage[dict[str, Any]])
def list_overrides(user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    # A scoped manager must not enumerate other hierarchies' people or exceptions.
    scope = _scope(db, user)
    rows = db.scalars(select(WorkShiftOverride).order_by(WorkShiftOverride.starts_at.desc()).limit(_MAX_LIMIT))
    visible = []
    for row in rows:
        employee = db.get(Employee, row.employee_id)
        if employee is None or not scope.allows_employee(
            employee_id=employee.id,
            department=employee.department,
            duty_unit=employee.duty_unit,
            duty_post=employee.duty_post,
        ):
            continue
        visible.append({"id": row.id, "employee_id": row.employee_id, "assignment_kind": row.assignment_kind, "reason_kind": row.reason_kind, "starts_at": row.starts_at, "ends_at": row.ends_at, "cancelled_at": row.cancelled_at, "version": workforce_admin_service.row_etag(row)})
    items, next_cursor = _cursor_page(visible, endpoint="overrides", scope=scope, filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/overrides", status_code=status.HTTP_201_CREATED)
def create_shift_override(body: ShiftOverrideWrite, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    _require_employee_schedule_scope(db, user, body.employee_id)
    try:
        row = workforce_schedule_service.create_shift_override(db, current_user=user, **body.model_dump(mode="python"))
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_OVERRIDE_INVALID", str(exc)) from exc
    db.commit()
    return {"id": row.id}


@router.post("/overrides/{override_id}/cancel")
def cancel_shift_override(*, override_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    row = db.get(WorkShiftOverride, override_id)
    if row is None:
        raise NotFoundError("WORKFORCE_OVERRIDE_NOT_FOUND", "Shift override was not found.")
    workforce_admin_service.require_if_match(if_match, workforce_admin_service.row_etag(row))
    # Cancellation mutates that employee's schedule, so it needs the same gate.
    _require_employee_schedule_scope(db, user, row.employee_id)
    try:
        row = workforce_schedule_service.cancel_shift_override(db, override_id=override_id, current_user=user)
    except ValueError as exc:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", str(exc)) from exc
    db.commit()
    return {"id": row.id, "cancelled_at": row.cancelled_at}


@router.post("/overrides/swap", status_code=status.HTTP_201_CREATED)
def create_shift_swap(body: ShiftSwapWrite, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    # Spec: every leg of a swap is checked BEFORE its atomic transaction starts.
    _require_employee_schedule_scope(db, user, body.from_employee_id)
    _require_employee_schedule_scope(db, user, body.to_employee_id)
    try:
        off, work, correlation = workforce_schedule_service.create_shift_swap(
            db,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        db.rollback()
        raise ValidationFailedError("WORKFORCE_SWAP_INVALID", str(exc)) from exc
    db.commit()
    return {"off_override_id": off.id, "work_override_id": work.id, "correlation_id": correlation}


@router.get("/requirements", response_model=CursorPage[dict[str, Any]])
def list_requirements(user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    rows = [{"id": row.id, "scope_kind": row.scope_kind, "department": row.department, "duty_unit": row.duty_unit, "duty_post": row.duty_post, "minimum_headcount": row.minimum_headcount, "effective_from": row.effective_from, "effective_to": row.effective_to, "approved_at": row.approved_at, "version": workforce_admin_service.row_etag(row)} for row in db.scalars(select(WorkStaffingRequirement).order_by(WorkStaffingRequirement.id.desc()).limit(_MAX_LIMIT))]
    items, next_cursor = _cursor_page(rows, endpoint="requirements", scope=_scope(db, user), filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/requirements", status_code=status.HTTP_201_CREATED)
def create_staffing_requirement(body: StaffingRequirementWrite, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    # The hierarchy target is client-authored, so it must be inside the actor's scope.
    _assert_scope_filter(
        _scope(db, user),
        department=body.department,
        duty_unit=body.duty_unit,
        duty_post=body.duty_post,
    )
    try:
        row = workforce_schedule_service.create_staffing_requirement(db, current_user=user, **body.model_dump(mode="python"))
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_REQUIREMENT_INVALID", str(exc)) from exc
    db.commit()
    return {"id": row.id}


@router.post("/requirements/{requirement_id}/approve")
def approve_staffing_requirement(*, requirement_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    row = db.get(WorkStaffingRequirement, requirement_id)
    if row is None:
        raise NotFoundError("WORKFORCE_REQUIREMENT_NOT_FOUND", "Staffing requirement was not found.")
    workforce_admin_service.require_if_match(if_match, workforce_admin_service.row_etag(row))
    _assert_scope_filter(
        _scope(db, user),
        department=row.department,
        duty_unit=row.duty_unit,
        duty_post=row.duty_post,
    )
    try:
        row = workforce_schedule_service.approve_staffing_requirement(db, requirement_id=requirement_id, current_user=user)
    except ValueError as exc:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", str(exc)) from exc
    db.commit()
    return {"id": row.id, "approved_at": row.approved_at}


@router.get("/policies", response_model=CursorPage[dict[str, Any]])
def list_attendance_policies(user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    rows = [{"id": row.id, "shift_definition_id": row.shift_definition_id, "grace_minutes": row.grace_minutes, "absence_after_minutes": row.absence_after_minutes, "effective_from": row.effective_from, "effective_to": row.effective_to, "approved_at": row.approved_at, "version": workforce_admin_service.row_etag(row)} for row in db.scalars(select(WorkAttendancePolicy).order_by(WorkAttendancePolicy.id.desc()).limit(_MAX_LIMIT))]
    items, next_cursor = _cursor_page(rows, endpoint="policies", scope=_scope(db, user), filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/policies", status_code=status.HTTP_201_CREATED)
def create_attendance_policy(body: AttendancePolicyWrite, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    # An attendance policy with no shift binding is organization-global.
    _require_organization_workforce_scope(db, user)
    row = workforce_admin_service.create_attendance_policy(db, payload=body.model_dump(mode="python"), actor=user)
    db.commit()
    return {"id": row.id}


@router.post("/policies/{policy_id}/approve")
def approve_policy(*, policy_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    _require_organization_workforce_scope(db, user)
    row = workforce_admin_service.approve_attendance_policy(db, policy_id=policy_id, if_match=if_match, actor=user)
    db.commit()
    return {"id": row.id, "approved_at": row.approved_at}


@router.get("/integration/status", response_model=IntegrationStatusRead)
def get_integration_status(_user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    return workforce_read_service.integration_status(db)


@router.post("/integration/test")
def test_integration(
    _user: Annotated[User, Depends(require_capability("workforce.integration.manage"))],
) -> dict[str, Any]:
    """Probe the configured provider without exposing credentials or vendor detail."""
    provider = scheduler_service._resolve_verified_attendance_provider()
    if provider is None:
        raise ValidationFailedError(
            "ATTENDANCE_PROVIDER_NOT_CONFIGURED", "Attendance provider is not configured."
        )
    health = provider.test_connection()
    return {"status": health.status, "summary": health.summary}


@router.post("/integration/sync", status_code=status.HTTP_202_ACCEPTED)
def start_integration_sync(
    _user: Annotated[User, Depends(require_capability("workforce.integration.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Import one people page and one punch page, then commit.

    Bounded on purpose: the request path must not hold a transaction open for a
    full backfill. The scheduled job drains the remaining pages.
    """
    provider = scheduler_service._resolve_verified_attendance_provider()
    if provider is None:
        raise ValidationFailedError(
            "ATTENDANCE_PROVIDER_NOT_CONFIGURED", "Attendance provider is not configured."
        )
    configuration = settings_service.get_workforce_configuration(db)
    if configuration is None:
        raise ValidationFailedError(
            "WORKFORCE_NOT_CONFIGURED", "Workforce configuration is incomplete."
        )
    now = datetime.now(UTC)
    people = attendance_sync_service.sync_people(db, provider=provider, now=now)
    punches = attendance_sync_service.sync_punches(
        db,
        provider=provider,
        now=now,
        backfill_start=configuration.initial_backfill_start_at,
    )
    db.commit()
    return {"imported_people": people, "imported_punches": punches}


@router.get("/integration/people", response_model=CursorPage[ProviderPersonRead])
def list_integration_people(user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)], mapping_state: str | None = None, limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    # Unmapped-person reconciliation is organization-global: it exposes provider
    # display names and employee ids for people in every hierarchy.
    _require_organization_workforce_scope(db, user)
    rows = [_provider_read(row) for row in workforce_read_service.list_provider_people(db, mapping_state=mapping_state)]
    items, next_cursor = _cursor_page(rows, endpoint="integration-people", scope={"integration": True}, filters={"mapping_state": mapping_state}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.patch("/integration/people/{person_id}/mapping", response_model=ProviderPersonRead)
def patch_provider_mapping(*, person_id: int, body: ProviderPersonMappingWrite, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    _require_organization_workforce_scope(db, user)
    row = workforce_admin_service.update_provider_mapping(db, person_id=person_id, if_match=if_match, actor=user, **body.model_dump())
    db.commit()
    _set_etag(response, workforce_admin_service.row_etag(row, extra={"mapping_state": row.mapping_state, "employee_id": row.employee_id}))
    return _provider_read(row)


@router.get("/integration/evaluation-queue", response_model=CursorPage[EvaluationQueueRead])
def list_evaluation_queue(user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)], state: Annotated[str, Query(pattern="^failed$")] = "failed", limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    _require_organization_workforce_scope(db, user)
    rows = [_queue_read(row) for row in workforce_read_service.list_failed_queue(db)]
    items, next_cursor = _cursor_page(rows, endpoint="evaluation-queue", scope={"integration": True}, filters={"state": state}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/integration/evaluation-queue/{queue_id}/retry", response_model=EvaluationQueueRead)
def retry_evaluation_queue(queue_id: int, user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    # The service raises NotFoundError / ValidationFailedError directly; both are
    # AppError subclasses the global handler renders. Catching ValueError here
    # would never fire and would mask a genuine 409 as a 404.
    row = retry_evaluation_queue_item(db, queue_id=queue_id, now=datetime.now(UTC), actor_user_id=user.id)
    db.commit()
    return _queue_read(row)


@router.get("/configuration", response_model=WorkforceConfigurationRead)
def get_workforce_configuration(
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> WorkforceConfigurationRead:
    _require_management(db, user)
    try:
        configuration = settings_service.get_workforce_configuration(db)
    except ValueError as exc:
        raise ValidationFailedError(
            "WORKFORCE_CONFIGURATION_INVALID",
            str(exc),
        ) from exc
    _set_etag(response, _configuration_etag(configuration))
    return WorkforceConfigurationRead(
        configured=configuration is not None,
        configuration=configuration,
    )


@router.patch("/configuration", response_model=WorkforceConfigurationRead)
def patch_workforce_configuration(
    body: ConfigurationPatch,
    response: Response,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> WorkforceConfigurationRead:
    _require_management(db, user)
    # Configuration keys are single organization-global AppSetting rows, so a
    # hierarchy-scoped manager must not be able to move controls (privacy fold,
    # retention) that bind every other department.
    _require_organization_workforce_scope(db, user)
    values = body.model_dump(exclude_unset=True)
    if not values:
        raise ValidationFailedError(
            "WORKFORCE_CONFIGURATION_PATCH_EMPTY",
            "At least one workforce configuration field is required.",
        )

    integration_fields = {
        "integration_enabled",
        "sync_interval_minutes",
        "stale_after_minutes",
        "initial_backfill_start_at",
        "evaluation_start_at",
    }
    if (
        any(field in values for field in integration_fields)
        and not perm_service.has_capability(
            db,
            user,
            "workforce.integration.manage",
        )
    ):
        raise AppError(
            "FORBIDDEN",
            "Missing capability: workforce.integration.manage",
            http_status=403,
        )
    if (
        set(values) - integration_fields
        and not perm_service.has_capability(
            db,
            user,
            "workforce.policy.manage",
        )
    ):
        raise AppError(
            "FORBIDDEN",
            "Missing capability: workforce.policy.manage",
            http_status=403,
        )

    try:
        current = settings_service.get_workforce_configuration(db)
    except ValueError as exc:
        raise ValidationFailedError(
            "WORKFORCE_CONFIGURATION_INVALID",
            str(exc),
        ) from exc
    workforce_admin_service.require_if_match(
        if_match,
        _configuration_etag(current),
    )

    if current is None:
        missing = sorted(set(ConfigurationPatch.model_fields) - set(values))
        if missing:
            raise ValidationFailedError(
                "WORKFORCE_CONFIGURATION_INCOMPLETE",
                "Initial workforce configuration must provide every field.",
                missing_fields=missing,
            )
        merged: dict[str, object] = values
    else:
        merged = current.model_dump(mode="python")
        merged.update(values)

    try:
        updated = WorkforceConfiguration.model_validate(merged)
        result = settings_service.update_workforce_configuration(
            db,
            updated,
            actor=user.employee_id or user.email,
        )
    except ValueError as exc:
        raise ValidationFailedError(
            "WORKFORCE_CONFIGURATION_INVALID",
            str(exc),
        ) from exc

    if any(field in values for field in integration_fields):
        # Persistence committed first; scheduler uses a fresh session. No
        # scheduler/provider work occurs inside the configuration transaction.
        scheduler_service.reschedule_workforce_sync()
    _set_etag(response, _configuration_etag(result))
    return WorkforceConfigurationRead(
        configured=True,
        configuration=result,
    )


__all__ = ["router"]
