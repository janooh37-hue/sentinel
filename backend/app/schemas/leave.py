"""Leave schemas."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas._base import ORMBase

# Canonical status values. "Generated" was retired by migration 0034 (old rows
# became Approved). Completed is National-Service-only and is set by the
# certificate endpoint, never accepted in a PATCH (lifecycle enforces this).
LeaveStatus = Literal["Pending", "Approved", "Rejected", "Cancelled", "Completed"]


class LeaveCreate(BaseModel):
    """POST /leaves — manual record creation (v1: National Service only).

    status / days are server-derived (lifecycle birth status; inclusive day
    span); doc_path/certificate_path are never client-settable.
    """

    employee_id: str
    leave_type: str = Field(min_length=1)
    start_date: date
    end_date: date
    notes: str | None = None


class LeaveUpdate(BaseModel):
    """PATCH payload. Dates are accepted only where the lifecycle allows date
    edits (National Service while Pending — delay/extend)."""

    status: LeaveStatus | None = None
    notes: str | None = None
    start_date: date | None = None
    end_date: date | None = None


class LeaveReturnRequest(BaseModel):
    """POST /leaves/{id}/return — file the Duty Resumption (return) form."""

    resumption_date: date
    delay_reason: str | None = None
    manager_id: int | None = None


class LeaveRead(ORMBase):
    id: int
    employee_id: str
    employee_name_en: str | None = None
    employee_name_ar: str | None = None
    leave_type: str
    start_date: date
    end_date: date
    days: int
    status: str
    notes: str | None = None
    request_date: date | None
    doc_path: str | None
    certificate_path: str | None
    return_doc_path: str | None = None
    return_date: date | None = None
    created_at: datetime
    updated_at: datetime | None = None


class LeaveListItem(ORMBase):
    """Slim projection for list views — omits notes and doc paths."""

    id: int
    employee_id: str
    employee_name_en: str | None = None
    employee_name_ar: str | None = None
    leave_type: str
    start_date: date
    end_date: date
    days: int
    status: str
    has_certificate: bool = False
    created_at: datetime


class LeaveListResponse(BaseModel):
    items: list[LeaveListItem]
    total: int
    limit: int
    offset: int


class LeaveBalanceRead(BaseModel):
    employee_id: str
    as_of: date
    annual_accrued: float
    # Total available annual days this year (accrual + carry-over, capped at
    # TOTAL_AVAILABLE_CAP). Drives the annual progress-meter denominator on the
    # frontend — never hardcode 30, the cap is 45.
    annual_total: float
    annual_taken: float
    annual_remaining: float
    sick_taken: float
    sick_remaining: float
    carry_over: float
    eligible: bool
    message: str
