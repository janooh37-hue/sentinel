"""Capability-gated, scoped workforce API surface."""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime
from typing import Annotated, Any, TypeVar
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Header, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_capability
from app.api.errors import AppError, ConflictError, ValidationFailedError
from app.config import get_settings
from app.db.models import User
from app.db.session import get_db
from app.db.workforce_models import (
    AttendanceEvaluationQueue,
    AttendanceProviderPerson,
    WorkCrew,
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
    attendance_correction_service,
    attendance_history_service,
    attendance_sync_service,
    perm_service,
    scheduler_service,
    settings_service,
    workforce_access_service,
    workforce_admin_service,
    workforce_dashboard_service,
    workforce_read_service,
    workforce_schedule_service,
)
from app.services.attendance_provider import AttendanceProvider
from app.services.attendance_queue_service import retry_evaluation_queue_item
from app.services.workforce_etag import etag_for, require_if_match, row_etag
from app.services.workforce_scope_service import (
    WorkforceScope,
    decode_cursor,
    encode_cursor,
    normalize_scope_value,
    resolve_workforce_scope,
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


def _is_own_employee(user: User, employee_id: str) -> bool:
    """Whether this caller is asking about their own linked employee record."""
    linked = (user.employee_id or "").strip()
    return bool(linked) and linked == employee_id


def _require_management(db: Session, user: User) -> None:
    if any(
        perm_service.has_capability(db, user, cap)
        for cap in ("workforce.schedule.manage", "workforce.policy.manage", "workforce.integration.manage")
    ):
        return
    raise AppError("FORBIDDEN", "Missing workforce management capability.", http_status=403)


def _configuration_etag(
    configuration: WorkforceConfiguration | None,
) -> str:
    value = (
        configuration.model_dump(mode="json")
        if configuration is not None
        else {"configured": False}
    )
    return etag_for(value)




def _crew_read(row: WorkCrew) -> dict[str, Any]:
    return {
        "id": row.id,
        "code": row.code,
        "name_en": row.name_en,
        "name_ar": row.name_ar,
        "active": row.active,
        "version": row_etag(row),
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
    scope = workforce_access_service.intersect_coverage_scope(
        _scope(db, user), department=department, duty_unit=duty_unit
    )
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
    rows, etag = workforce_access_service.user_scopes(db, user_id=user_id)
    _set_etag(response, etag)
    return {"scopes": workforce_access_service.scope_payload(rows)}


@router.put("/access/users/{user_id}/scopes", response_model=WorkforceScopeReplace)
def replace_user_scopes(*, user_id: int, body: WorkforceScopeReplace, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, actor: Annotated[User, Depends(require_capability("users.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    rows, etag = workforce_access_service.replace_user_scopes(
        db,
        user_id=user_id,
        scopes=body.scopes,
        if_match=if_match,
        actor=actor,
    )
    db.commit()
    _set_etag(response, etag)
    return {"scopes": workforce_access_service.scope_payload(rows)}


@router.get("/roster", response_model=CursorPage[RosterRowRead])
def get_roster(operational_date: date, user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = workforce_read_service.list_roster(db, scope=scope, operational_date=operational_date)
    items, next_cursor = _cursor_page(rows, endpoint="roster", scope=scope, filters={"operational_date": operational_date}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/attendance/exceptions", response_model=CursorPage[AttendanceExceptionRead])
def get_attendance_exceptions(user: Annotated[User, Depends(require_capability("workforce.attendance.review"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)], operational_date: date | None = None, presence: str | None = None, exception: str | None = None, limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = workforce_read_service.list_exceptions(db, scope=scope, operational_date=operational_date, presence=presence, exception=exception)
    items, next_cursor = _cursor_page(rows, endpoint="exceptions", scope=scope, filters={"operational_date": operational_date, "presence": presence, "exception": exception}, limit=limit, cursor=cursor)
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
    if not (
        _is_own_employee(user, employee_id)
        and perm_service.has_capability(db, user, "workforce.self.view")
    ):
        for capability in ("workforce.people.view", "workforce.attendance.review"):
            if not perm_service.has_capability(db, user, capability):
                raise AppError(
                    "FORBIDDEN",
                    "Capability required.",
                    http_status=status.HTTP_403_FORBIDDEN,
                )
    try:
        return attendance_history_service.employee_punch_history(
            db,
            scope=_scope(db, user),
            employee_id=employee_id,
            from_date=from_date,
            to_date=to_date,
            provider=provider,
            zone=ZoneInfo(get_settings().biotime_time_zone),
        )
    except AppError:
        raise
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
    row = attendance_correction_service.correct(
        db,
        scope=_scope(db, user),
        case_id=case_id,
        snapshot=body.model_dump(mode="python"),
        if_match=if_match,
        actor=user,
    )
    db.commit()
    _set_etag(response, attendance_correction_service.case_etag(db, case_id))
    return {"id": row.id, "case_id": case_id}


@router.post("/attendance/cases/{case_id}/adjustments/{adjustment_id}/revoke")
def revoke_attendance_adjustment(*, case_id: int, adjustment_id: int, body: AdjustmentRevokeWrite, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.attendance.correct"))], people_user: Annotated[User, Depends(require_capability("workforce.people.view"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    row = attendance_correction_service.revoke(
        db,
        scope=_scope(db, user),
        case_id=case_id,
        adjustment_id=adjustment_id,
        reason=body.reason,
        if_match=if_match,
        actor=user,
    )
    db.commit()
    _set_etag(response, attendance_correction_service.case_etag(db, case_id))
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
    rows, etag = workforce_read_service.list_shift_definitions(db)
    items, next_cursor = _cursor_page(
        [workforce_read_service.shift_definition_read(row) for row in rows],
        endpoint="schedule-definitions",
        scope={"management": True},
        filters={},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, etag)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/schedule/rotation", response_model=WorkforceRotationRead)
def get_rotation_pattern(
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row, etag = workforce_read_service.rotation_detail(db)
    data = workforce_read_service.rotation_read(db, row)
    _set_etag(response, etag)
    return data


@router.get("/crews", response_model=CursorPage[WorkCrewRead])
def list_crews(
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100,
    cursor: str | None = None,
) -> dict[str, Any]:
    rows, etag = workforce_read_service.list_crews(db)
    items, next_cursor = _cursor_page(
        [_crew_read(row) for row in rows],
        endpoint="crews",
        scope={"management": True},
        filters={},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, etag)
    return {"items": items, "next_cursor": next_cursor}


@router.get("/crews/{crew_id}", response_model=WorkCrewRead)
def get_crew(
    crew_id: int,
    response: Response,
    _user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    row, etag = workforce_read_service.crew_detail(db, crew_id=crew_id)
    data = _crew_read(row)
    _set_etag(response, etag)
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
    row = workforce_admin_service.create_crew(
        db,
        scope=_scope(db, user),
        if_match=if_match,
        payload=body.model_dump(),
        actor=user,
    )
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
    row = workforce_admin_service.update_crew(
        db,
        scope=_scope(db, user),
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
    row = workforce_admin_service.retire_crew(
        db,
        scope=_scope(db, user),
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
    rows, etag = workforce_read_service.list_crew_schedules(db, crew_id=crew_id)
    items, next_cursor = _cursor_page(
        [workforce_read_service.crew_schedule_read(row) for row in rows],
        endpoint="crew-schedules",
        scope={"management": True},
        filters={"crew_id": crew_id},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, etag)
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
    row, etag = workforce_read_service.crew_schedule_detail(
        db, crew_id=crew_id, schedule_id=schedule_id
    )
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, etag)
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
    try:
        row = workforce_schedule_service.create_crew_schedule(
            db,
            scope=_scope(db, user),
            if_match=if_match,
            crew_id=crew_id,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_SCHEDULE_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, row_etag(row))
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
    try:
        row = workforce_schedule_service.replace_crew_schedule(
            db,
            scope=_scope(db, user),
            crew_id=crew_id,
            schedule_id=schedule_id,
            if_match=if_match,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_SCHEDULE_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_schedule_read(row)
    _set_etag(response, row_etag(row))
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
    return workforce_read_service.preview_crew_schedule(
        db,
        scope=_scope(db, user),
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
    scope = _scope(db, user)
    rows, etag = workforce_read_service.list_crew_memberships(
        db, crew_id=crew_id, scope=scope
    )
    items, next_cursor = _cursor_page(
        [workforce_read_service.crew_membership_read(row) for row in rows],
        endpoint="crew-memberships",
        scope=scope,
        filters={"crew_id": crew_id},
        limit=limit,
        cursor=cursor,
    )
    _set_etag(response, etag)
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
    row, etag = workforce_read_service.crew_membership_detail(
        db,
        crew_id=crew_id,
        membership_id=membership_id,
        scope=_scope(db, user),
    )
    data = workforce_read_service.crew_membership_read(row)
    _set_etag(response, etag)
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
    scope = _scope(db, user)
    try:
        row = workforce_schedule_service.create_crew_membership(
            db,
            scope=scope,
            if_match=if_match,
            crew_id=crew_id,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_MEMBERSHIP_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_membership_read(row)
    _set_etag(response, row_etag(row))
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
    try:
        updated = workforce_schedule_service.end_crew_membership(
            db,
            scope=_scope(db, user),
            crew_id=crew_id,
            membership_id=membership_id,
            if_match=if_match,
            current_user=user,
            **body.model_dump(mode="python"),
        )
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_MEMBERSHIP_INVALID", str(exc)) from exc
    db.commit()
    data = workforce_read_service.crew_membership_read(updated)
    _set_etag(response, row_etag(updated))
    return data


@router.get("/overrides", response_model=CursorPage[dict[str, Any]])
def list_overrides(user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    visible = [{"id": row.id, "employee_id": row.employee_id, "assignment_kind": row.assignment_kind, "reason_kind": row.reason_kind, "starts_at": row.starts_at, "ends_at": row.ends_at, "cancelled_at": row.cancelled_at, "version": row_etag(row)} for row in workforce_read_service.list_shift_overrides(db, scope=scope)]
    items, next_cursor = _cursor_page(visible, endpoint="overrides", scope=scope, filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/overrides", status_code=status.HTTP_201_CREATED)
def create_shift_override(body: ShiftOverrideWrite, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    try:
        row = workforce_schedule_service.create_shift_override(db, scope=_scope(db, user), current_user=user, **body.model_dump(mode="python"))
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_OVERRIDE_INVALID", str(exc)) from exc
    db.commit()
    return {"id": row.id}


@router.post("/overrides/{override_id}/cancel")
def cancel_shift_override(*, override_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    try:
        row = workforce_schedule_service.cancel_shift_override(db, scope=_scope(db, user), override_id=override_id, if_match=if_match, current_user=user)
    except ValueError as exc:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", str(exc)) from exc
    db.commit()
    return {"id": row.id, "cancelled_at": row.cancelled_at}


@router.post("/overrides/swap", status_code=status.HTTP_201_CREATED)
def create_shift_swap(body: ShiftSwapWrite, user: Annotated[User, Depends(require_capability("workforce.schedule.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    try:
        off, work, correlation = workforce_schedule_service.create_shift_swap(
            db,
            scope=_scope(db, user),
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
    scope = _scope(db, user)
    rows = [{"id": row.id, "scope_kind": row.scope_kind, "department": row.department, "duty_unit": row.duty_unit, "duty_post": row.duty_post, "minimum_headcount": row.minimum_headcount, "effective_from": row.effective_from, "effective_to": row.effective_to, "approved_at": row.approved_at, "version": row_etag(row)} for row in workforce_read_service.list_staffing_requirements(db, scope=scope)]
    items, next_cursor = _cursor_page(rows, endpoint="requirements", scope=scope, filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/requirements", status_code=status.HTTP_201_CREATED)
def create_staffing_requirement(body: StaffingRequirementWrite, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    try:
        row = workforce_schedule_service.create_staffing_requirement(db, scope=_scope(db, user), current_user=user, **body.model_dump(mode="python"))
    except ValueError as exc:
        raise ValidationFailedError("WORKFORCE_REQUIREMENT_INVALID", str(exc)) from exc
    db.commit()
    return {"id": row.id}


@router.post("/requirements/{requirement_id}/approve")
def approve_staffing_requirement(*, requirement_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    try:
        row = workforce_schedule_service.approve_staffing_requirement(db, scope=_scope(db, user), requirement_id=requirement_id, if_match=if_match, current_user=user)
    except ValueError as exc:
        raise ConflictError("WORKFORCE_VERSION_CONFLICT", str(exc)) from exc
    db.commit()
    return {"id": row.id, "approved_at": row.approved_at}


@router.get("/policies", response_model=CursorPage[dict[str, Any]])
def list_attendance_policies(user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)], limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    rows = [{"id": row.id, "shift_definition_id": row.shift_definition_id, "grace_minutes": row.grace_minutes, "absence_after_minutes": row.absence_after_minutes, "effective_from": row.effective_from, "effective_to": row.effective_to, "approved_at": row.approved_at, "version": row_etag(row)} for row in workforce_read_service.list_attendance_policies(db)]
    items, next_cursor = _cursor_page(rows, endpoint="policies", scope=_scope(db, user), filters={}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.post("/policies", status_code=status.HTTP_201_CREATED)
def create_attendance_policy(body: AttendancePolicyWrite, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)]) -> dict[str, Any]:
    row = workforce_admin_service.create_attendance_policy(db, scope=_scope(db, user), payload=body.model_dump(mode="python"), actor=user)
    db.commit()
    return {"id": row.id}


@router.post("/policies/{policy_id}/approve")
def approve_policy(*, policy_id: int, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.policy.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    row = workforce_admin_service.approve_attendance_policy(db, scope=_scope(db, user), policy_id=policy_id, if_match=if_match, actor=user)
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
    scope = _scope(db, user)
    rows = [_provider_read(row) for row in workforce_read_service.list_provider_people(db, scope=scope, mapping_state=mapping_state)]
    items, next_cursor = _cursor_page(rows, endpoint="integration-people", scope={"integration": True}, filters={"mapping_state": mapping_state}, limit=limit, cursor=cursor)
    return {"items": items, "next_cursor": next_cursor}


@router.patch("/integration/people/{person_id}/mapping", response_model=ProviderPersonRead)
def patch_provider_mapping(*, person_id: int, body: ProviderPersonMappingWrite, response: Response, if_match: Annotated[str | None, Header(alias="If-Match")] = None, user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)] ) -> dict[str, Any]:
    row = workforce_admin_service.update_provider_mapping(db, scope=_scope(db, user), person_id=person_id, if_match=if_match, actor=user, **body.model_dump())
    db.commit()
    _set_etag(response, row_etag(row, extra={"mapping_state": row.mapping_state, "employee_id": row.employee_id}))
    return _provider_read(row)


@router.get("/integration/evaluation-queue", response_model=CursorPage[EvaluationQueueRead])
def list_evaluation_queue(user: Annotated[User, Depends(require_capability("workforce.integration.manage"))], db: Annotated[Session, Depends(get_db)], state: Annotated[str, Query(pattern="^failed$")] = "failed", limit: Annotated[int, Query(ge=1, le=_MAX_LIMIT)] = 100, cursor: str | None = None) -> dict[str, Any]:
    scope = _scope(db, user)
    rows = [_queue_read(row) for row in workforce_read_service.list_failed_queue(db, scope=scope)]
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
    workforce_access_service.require_organization(
        _scope(db, user),
        message="Organization workforce scope is required for this change.",
    )
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
    require_if_match(
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
