"""Pydantic schemas for the announcements API."""

from __future__ import annotations

from pydantic import BaseModel


class GroupOut(BaseModel):
    id: str
    name: str


class GroupSendOut(BaseModel):
    group_id: str
    group_name: str
    ok: bool
    error: str | None = None


class AnnouncementOut(BaseModel):
    announcement_id: int
    sent: int
    failed: int
    results: list[GroupSendOut]


class GatewayStatusOut(BaseModel):
    state: str


class GatewayQrOut(BaseModel):
    qr: str | None


class GatewayUnlinkOut(BaseModel):
    ok: bool
