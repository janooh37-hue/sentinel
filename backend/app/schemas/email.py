"""Pydantic schemas for the email-account / sync endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Self

from pydantic import BaseModel, Field, model_validator

from app.schemas._base import ORMBase


class EmailAccountRead(ORMBase):
    """Public IMAP recording view; legacy SMTP columns stay private."""

    id: int
    email: str
    imap_host: str
    imap_port: int
    use_ssl: bool
    username: str
    sent_folder: str
    inbox_folder: str
    enabled: bool
    linked_employee_id: str | None = None
    sync_interval_minutes: int
    last_synced_at: datetime | None
    last_sync_count: int
    last_sync_error: str | None
    owner_user_id: int | None = None
    has_password: bool


class EmailAccountUpsert(BaseModel):
    """IMAP account write payload."""

    email: str
    imap_host: str = Field(default="imap.ionos.com")
    imap_port: int = Field(default=993, ge=1, le=65535)
    use_ssl: bool = True
    username: str
    password: str | None = None
    sent_folder: str = "Sent"
    inbox_folder: str = "INBOX"
    enabled: bool = True
    sync_interval_minutes: int = Field(default=5, ge=0, le=1440)
    linked_employee_id: str | None = None

    @model_validator(mode="after")
    def _enforce_ionos(self) -> Self:
        if self.imap_host != "imap.ionos.com":
            raise ValueError("only imap.ionos.com is supported")
        return self


class EmailSyncResult(ORMBase):
    imported: int
    skipped_duplicate: int
    errors: list[str] = Field(default_factory=list)
    last_synced_at: datetime


class EmailSyncStatus(ORMBase):
    """Live IMAP recording state for the settings sync status."""

    syncing: bool
    last_synced_at: datetime | None
    last_sync_error: str | None
    enabled: bool
    interval_minutes: int
