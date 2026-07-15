"""Pydantic schemas for the announcements API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GroupOut(BaseModel):
    id: str
    name: str


class GroupSendOut(BaseModel):
    group_id: str
    group_name: str
    ok: bool
    error: str | None = None


class DirectSendOut(BaseModel):
    """Outcome of one direct (private) employee send."""

    employee_id: str
    employee_name: str
    ok: bool
    fell_back: bool = False
    error: str | None = None


class AnnouncementOut(BaseModel):
    # None when the send had no group targets (direct-only private message).
    announcement_id: int | None = None
    sent: int
    failed: int
    results: list[GroupSendOut]
    direct_results: list[DirectSendOut] = Field(default_factory=list)


class GatewayStatusOut(BaseModel):
    state: str


class GatewayQrOut(BaseModel):
    qr: str | None


class GatewayUnlinkOut(BaseModel):
    ok: bool
