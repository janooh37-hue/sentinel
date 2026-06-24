"""Pydantic schemas for the email-account / sync endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class EmailAccountRead(BaseModel):
    """Public view — never includes the password."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    imap_host: str
    imap_port: int
    use_ssl: bool
    username: str
    smtp_host: str
    smtp_port: int
    smtp_use_tls: bool
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
    """Write payload. ``password`` is optional on PATCH — only set when
    rotating credentials."""

    email: str
    imap_host: str = Field(default="imap.ionos.com")
    imap_port: int = Field(default=993, ge=1, le=65535)
    use_ssl: bool = True
    username: str
    password: str | None = None
    smtp_host: str = Field(default="smtp.ionos.com")
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_use_tls: bool = True
    sent_folder: str = "Sent"
    inbox_folder: str = "INBOX"
    enabled: bool = True
    sync_interval_minutes: int = Field(default=5, ge=0, le=1440)
    linked_employee_id: str | None = None

    @model_validator(mode="after")
    def _enforce_ionos(self) -> Self:
        if self.imap_host != "imap.ionos.com":
            raise ValueError("only imap.ionos.com is supported")
        if self.smtp_host != "smtp.ionos.com":
            raise ValueError("only smtp.ionos.com is supported")
        return self


class EmailSyncResult(BaseModel):
    imported: int
    skipped_duplicate: int
    errors: list[str] = Field(default_factory=list)
    last_synced_at: datetime


class EmailSyncStatus(BaseModel):
    """Live sync state for the Ledger status strip.

    ``syncing`` reflects the module sync lock — true during BOTH a manual
    ``POST /email/sync`` and a scheduler tick.
    """

    syncing: bool
    last_synced_at: datetime | None
    last_sync_error: str | None
    enabled: bool
    interval_minutes: int


class EmailSendRequest(BaseModel):
    to: list[str] = Field(min_length=1)
    cc: list[str] = Field(default_factory=list)
    subject: str
    html: str
    in_reply_to: str | None = None  # Message-Id of the email being replied to
    references: str | None = None  # threading: full References header
    use_signature: bool = True


class EmailSendResult(BaseModel):
    sent: bool
    message_id: str
    ledger_entry_id: int
