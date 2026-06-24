"""Pydantic schemas for the Web Push endpoints (Phase 5)."""

from __future__ import annotations

from pydantic import BaseModel


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys


class EndpointIn(BaseModel):
    """Body for DELETE /push/subscribe — missing endpoint yields 422."""

    endpoint: str


class VapidKeyOut(BaseModel):
    public_key: str
