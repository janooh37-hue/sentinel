"""Deterministic in-repository attendance provider fake.

This satisfies `AttendanceProvider` with no network transport and no wall
clock, so tests and local smoke runs get byte-stable pages for a given input.

It is a TEST DOUBLE ONLY. The production resolver must stay explicitly
`not_configured` until a sanitized installed-BioTime adapter exists; nothing
in `app/` may import this module.

Cursor semantics mirror what `attendance_sync_service` requires:

* a page is either exhausted with `next_cursor is None`, or not exhausted with
  a non-null `next_cursor` (`_validate_page` rejects any other combination);
* `fresh_through` only advances on the final page of a punch window, because a
  partially imported window is not yet trustworthy;
* punch order is stable on `(occurred_at, external_event_id)` so replay of the
  same window yields identical pages and the importer's hash check can prove
  immutability rather than tripping on reordering.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.services.attendance_provider import (
    ProviderHealth,
    ProviderPage,
    ProviderPerson,
    ProviderPunch,
)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


@dataclass
class DeterministicAttendanceProvider:
    """A stable, paginating provider fake driven entirely by its inputs."""

    people: Sequence[ProviderPerson] = field(default_factory=tuple)
    punches: Sequence[ProviderPunch] = field(default_factory=tuple)
    page_size: int = 50
    code: str = "biotime"
    health: ProviderHealth = field(
        default_factory=lambda: ProviderHealth(status="healthy", summary=None)
    )

    #: Recorded calls, so a test can assert cursor/window behaviour.
    people_calls: list[str | None] = field(default_factory=list)
    punch_calls: list[tuple[str | None, datetime | None, datetime]] = field(default_factory=list)
    person_punch_calls: list[tuple[str, str | None, datetime, datetime]] = field(
        default_factory=list
    )

    def test_connection(self) -> ProviderHealth:
        return self.health

    # -- pagination ---------------------------------------------------------

    def _offset(self, cursor: str | None) -> int:
        if cursor is None:
            return 0
        try:
            offset = int(cursor)
        except ValueError as exc:  # a malformed cursor must fail loudly, not silently restart
            raise ValueError(f"Unsupported fake cursor: {cursor!r}") from exc
        if offset < 0:
            raise ValueError(f"Negative fake cursor: {cursor!r}")
        return offset

    def _page[T](self, rows: Sequence[T], offset: int) -> tuple[Sequence[T], str | None, bool]:
        window = rows[offset : offset + self.page_size]
        consumed = offset + len(window)
        exhausted = consumed >= len(rows)
        return window, (None if exhausted else str(consumed)), exhausted

    # -- protocol -----------------------------------------------------------

    def list_people(self, *, cursor: str | None) -> ProviderPage[ProviderPerson]:
        self.people_calls.append(cursor)
        ordered = sorted(self.people, key=lambda person: person.external_person_id)
        items, next_cursor, exhausted = self._page(ordered, self._offset(cursor))
        return ProviderPage(
            items=items,
            next_cursor=next_cursor,
            exhausted=exhausted,
            fresh_through=None,
        )

    def list_punches(
        self,
        *,
        cursor: str | None,
        since: datetime | None,
        until: datetime,
    ) -> ProviderPage[ProviderPunch]:
        self.punch_calls.append((cursor, since, until))
        upper = _aware(until)
        lower = _aware(since) if since is not None else None
        selected = [
            punch
            for punch in self.punches
            if (lower is None or _aware(punch.occurred_at) > lower)
            and _aware(punch.occurred_at) <= upper
        ]
        selected.sort(key=lambda punch: (_aware(punch.occurred_at), punch.external_event_id))
        items, next_cursor, exhausted = self._page(selected, self._offset(cursor))
        return ProviderPage(
            items=items,
            next_cursor=next_cursor,
            exhausted=exhausted,
            # Only a completed window is trustworthy enough to advance freshness.
            fresh_through=upper if exhausted else None,
        )

    def list_person_punches(
        self,
        *,
        external_employee_code: str,
        since: datetime,
        until: datetime,
        cursor: str | None,
    ) -> ProviderPage[ProviderPunch]:
        """Mirror the vendor: filter by employee code, not by person identity.

        The fake keeps the real hazard visible - two enrollments can share a code,
        so a caller that trusts this filter as identity gets the wrong history.
        """
        self.person_punch_calls.append((external_employee_code, cursor, since, until))
        lower, upper = _aware(since), _aware(until)
        codes = {
            row.external_person_id
            for row in self.people
            if row.external_employee_code == external_employee_code
        }
        selected = [
            punch
            for punch in self.punches
            if punch.external_person_id in codes
            and lower <= _aware(punch.occurred_at) < upper
        ]
        selected.sort(key=lambda punch: (_aware(punch.occurred_at), punch.external_event_id))
        items, next_cursor, exhausted = self._page(selected, self._offset(cursor))
        return ProviderPage(
            items=items,
            next_cursor=next_cursor,
            exhausted=exhausted,
            fresh_through=None,
        )


def person(
    external_person_id: str,
    *,
    employee_code: str | None = None,
    display_name: str | None = None,
    active: bool = True,
    source_updated_at: datetime | None = None,
) -> ProviderPerson:
    """Build one provider person without repeating every optional field."""
    return ProviderPerson(
        external_person_id=external_person_id,
        external_employee_code=employee_code,
        display_name_snapshot=display_name,
        active=active,
        source_updated_at=source_updated_at,
    )


def punch(
    external_event_id: str,
    *,
    external_person_id: str,
    occurred_at: datetime,
    direction: str | None = None,
    device_id: str | None = None,
    device_name: str | None = None,
    source_updated_at: datetime | None = None,
) -> ProviderPunch:
    """Build one immutable provider punch event."""
    return ProviderPunch(
        external_event_id=external_event_id,
        external_person_id=external_person_id,
        occurred_at=occurred_at,
        direction=direction,
        device_id=device_id,
        device_name=device_name,
        source_updated_at=source_updated_at,
    )


__all__ = ["DeterministicAttendanceProvider", "person", "punch"]
