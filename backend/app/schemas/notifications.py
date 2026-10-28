"""Notification count schema — Phase 4 (instant SSE) + Phase 5 (Web Push)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas._base import ORMBase


class NotificationCounts(BaseModel):
    approvals: int  # books awaiting MY signature/approval
    leaves: int  # leave rows needing action (pending + awaiting-return), org-wide
    scans: int  # scan-inbox items awaiting MY confirmation/routing
    emails: int  # unread received email in MY mailbox
    monthly_reviews: int  # eligible monthly report assignments awaiting MY review
    monthly_approvals: int  # eligible monthly report assignments awaiting MY approval
    inbox: int  # unread direct sends to ME on records I can open
    decisions: int  # unseen signing-manager outcomes on MY submissions


class DecisionNotice(ORMBase):
    book_id: int
    version_id: int
    ref_number: str
    subject: str | None
    verdict: Literal["approved", "rejected", "returned"]
    is_report: bool
    decided_at: datetime
    decider_name: str | None
    decider_name_ar: str | None
    note: str | None


class DecisionNoticesResponse(BaseModel):
    items: list[DecisionNotice]
    total: int
