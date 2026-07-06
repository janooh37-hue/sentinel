"""Pydantic schemas for the Scan Inbox REST surface."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class EmployeeCandidate(BaseModel):
    employee_id: str
    name_en: str
    name_ar: str | None = None
    score: float


class ScanInboxItem(BaseModel):
    id: int
    created_at: datetime
    source: str
    state: str
    filename: str
    document_type: str | None = None
    confidence: float = 0.0
    confidence_tier: str | None = None
    proposed_route: str | None = None
    proposed_ref: str | None = None
    proposed_book_id: int | None = None
    proposed_employee_id: str | None = None
    proposed_employee_name_en: str | None = None
    proposed_employee_name_ar: str | None = None
    match_score: float | None = None
    ledger_entry_id: int | None = None
    email_sender: str | None = None
    email_subject: str | None = None
    error_detail: str | None = None
    fields: dict[str, str] = {}
    candidates: list[EmployeeCandidate] = []


class ScanInboxList(BaseModel):
    items: list[ScanInboxItem]
    total: int


class ScanInboxCount(BaseModel):
    awaiting_confirmation: int
    unrouted: int
    total: int


class RouteRequest(BaseModel):
    employee_id: str | None = None
    book_id: int | None = None


__all__ = ["EmployeeCandidate", "RouteRequest", "ScanInboxCount", "ScanInboxItem", "ScanInboxList"]
