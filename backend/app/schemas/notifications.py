"""Notification count schema — Phase 4 (instant SSE) + Phase 5 (Web Push)."""

from __future__ import annotations

from pydantic import BaseModel


class NotificationCounts(BaseModel):
    approvals: int  # books awaiting MY signature/approval
    leaves: int  # leave rows needing action (pending + awaiting-return), org-wide
    scans: int  # scan-inbox items awaiting MY confirmation/routing
    emails: int  # unread received email in MY mailbox
    monthly_reviews: int  # eligible monthly report assignments awaiting MY review
    monthly_approvals: int  # eligible monthly report assignments awaiting MY approval
