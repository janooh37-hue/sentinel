"""Vendor-neutral attendance provider value objects.

This module intentionally defines no BioTime transport, configuration, or payload parsing.
An installed provider implementation can only be added after its documented contract has
been verified against sanitized fixtures.
"""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol, TypeVar

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class ProviderHealth:
    """A safe provider readiness result without credentials or response details."""

    status: Literal["healthy", "not_configured", "error"]
    summary: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderPage[T]:
    """One bounded, cursor-addressed page returned by an attendance provider."""

    items: Sequence[T]
    next_cursor: str | None
    exhausted: bool
    fresh_through: datetime | None


@dataclass(frozen=True, slots=True)
class ProviderPerson:
    """Normalized provider-owned identity data for manual reconciliation."""

    external_person_id: str
    external_employee_code: str | None
    display_name_snapshot: str | None
    active: bool
    source_updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class ProviderPunch:
    """Normalized immutable source event; this intentionally contains no raw payload."""

    external_event_id: str
    external_person_id: str
    occurred_at: datetime
    direction: str | None
    device_id: str | None
    device_name: str | None
    source_updated_at: datetime | None


class AttendanceProvider(Protocol):
    """The only provider contract consumed by the workforce import service."""

    code: str

    def test_connection(self) -> ProviderHealth: ...

    def list_people(self, *, cursor: str | None) -> ProviderPage[ProviderPerson]: ...

    def list_punches(
        self,
        *,
        cursor: str | None,
        since: datetime | None,
        until: datetime,
    ) -> ProviderPage[ProviderPunch]: ...

    def list_person_punches(
        self,
        *,
        external_employee_code: str,
        since: datetime,
        until: datetime,
        cursor: str | None,
    ) -> ProviderPage[ProviderPunch]:
        """Read one person's punches without importing them.

        History is answered from the provider on demand instead of being copied
        into this database: the years before the roster existed cannot be judged,
        and storing them would only duplicate the source of truth.
        """
        ...
