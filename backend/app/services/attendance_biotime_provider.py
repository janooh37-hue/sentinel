"""Installed ZKTeco BioTime adapter for the vendor-neutral attendance contract.

Every behaviour encoded here was measured against the installed build with
``backend/scripts/biotime_probe.py`` rather than taken from a manual for a
different version. The verified facts, and why each one matters:

* **Authentication is JWT.** ``POST /jwt-api-token-auth/`` returns ``{"token": …}``
  and reads require ``Authorization: JWT <token>``. The DRF ``/api-token-auth/``
  endpoint answers ``400`` on this build and must not be used.

* **Only the plural routes are real.** The router at ``/personnel/api/`` and
  ``/iclock/api/`` registers ``employees`` and ``transactions``. Singular
  spellings are either a thinner legacy serializer or absent entirely.

* **A denial can arrive as HTTP 200 with an HTML body.** Asking for a path the
  account may not reach returns ``200`` and a ZKTeco "Page not found" page. A
  reader that trusted the status code would treat that as a successful empty
  page, advance ``fresh_through`` past a window it never actually read, and the
  evaluator would then manufacture absences for people who were at work. Every
  response is therefore required to be JSON with the expected envelope.

* **Times are device-local wall time with no offset.** ``punch_time`` is in the
  site's zone, and the server compares ``start_time``/``end_time`` against it as
  literal strings without conversion. UTC bounds are converted before querying
  and parsed results are converted back; a naive implementation would be wrong
  by the zone offset in both directions.

* **Rows are returned oldest-first and the ``ordering`` parameter is ignored.**
  That default suits the importer, which walks a frozen window forward.

* **There is no punch direction.** ``punch_state`` was ``255``/"Unknown" on every
  row observed. Direction is reported only when the vendor supplies a value this
  adapter recognises, so the evaluator allocates by time rather than trusting a
  fabricated in/out.

The site allow-list is applied here, on ingest, in addition to whatever the
provider account is scoped to. Request-level filters are deliberately not used:
this build silently ignores most of them and an ignored filter fails open.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from app.services.attendance_provider import (
    ProviderHealth,
    ProviderPage,
    ProviderPerson,
    ProviderPunch,
)

log = logging.getLogger(__name__)

PROVIDER_CODE = "biotime"

_AUTH_PATH = "/jwt-api-token-auth/"
_PEOPLE_PATH = "/personnel/api/employees/"
_PUNCH_PATH = "/iclock/api/transactions/"

# The wall-clock format the server both emits and accepts.
_WALL_FORMAT = "%Y-%m-%d %H:%M:%S"

# Vendor direction codes this adapter is willing to interpret. The installed
# build emits 255 ("Unknown") for every event; anything unrecognised stays None
# so the importer records "unknown" rather than inventing a check-in.
_DIRECTIONS: dict[str, str] = {"0": "in", "1": "out"}

_MAX_PAGE_SIZE = 1000


class BioTimeContractError(RuntimeError):
    """The response did not match the verified contract.

    Deliberately carries no vendor text: the caller logs with a traceback and
    the provider body may contain personal data or the configured URL.
    """


def _parse_wall_time(value: object, zone: ZoneInfo) -> datetime | None:
    """Interpret a naive vendor timestamp in the site zone and return UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        naive = datetime.strptime(value.strip(), _WALL_FORMAT)
    except ValueError:
        return None
    return naive.replace(tzinfo=zone).astimezone(UTC)


def _format_wall_time(moment: datetime, zone: ZoneInfo) -> str:
    """Render a UTC bound as the site-local wall time the server compares against."""
    aware = moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)
    return aware.astimezone(zone).strftime(_WALL_FORMAT)


def _format_start_time(moment: datetime, zone: ZoneInfo) -> str:
    """Overlap one second because BioTime excludes records equal to either bound."""
    return _format_wall_time(moment - timedelta(seconds=1), zone)


def _page_number(cursor: str | None) -> int:
    """Decode the opaque cursor. Absent means the first page."""
    if cursor is None:
        return 1
    try:
        page = int(cursor)
    except ValueError as exc:
        raise BioTimeContractError("Malformed provider cursor") from exc
    if page < 1:
        raise BioTimeContractError("Malformed provider cursor")
    return page


def _text(record: dict[str, Any], key: str) -> str | None:
    value = record.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


@dataclass(frozen=True, slots=True)
class SiteScope:
    """Which rows belong to this deployment's site.

    An empty scope accepts everything, which is correct when the provider
    account is already restricted server-side and nothing further is configured.
    """

    area_names: frozenset[str] = field(default_factory=frozenset)
    terminal_sns: frozenset[str] = field(default_factory=frozenset)
    department_ids: frozenset[str] = field(default_factory=frozenset)

    @property
    def filters_punches(self) -> bool:
        return bool(self.area_names or self.terminal_sns)

    @property
    def filters_people(self) -> bool:
        return bool(self.department_ids)

    def accepts_punch(self, record: dict[str, Any]) -> bool:
        if not self.filters_punches:
            return True
        area = _text(record, "area_alias")
        if area is not None and area in self.area_names:
            return True
        serial = _text(record, "terminal_sn")
        return serial is not None and serial in self.terminal_sns

    def accepts_person(self, record: dict[str, Any]) -> bool:
        if not self.filters_people:
            return True
        department = record.get("department")
        identifier = department.get("id") if isinstance(department, dict) else department
        return identifier is not None and str(identifier) in self.department_ids


class BioTimeAttendanceProvider:
    """Read-only mirror of one installed BioTime instance.

    The instance owns an authenticated session and refreshes its token once on
    an authentication failure, because the vendor token expires on its own
    schedule and a scheduled sync must not need an operator to restart it.
    """

    code = PROVIDER_CODE

    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        verify: bool | str = True,
        timeout: float = 30.0,
        page_size: int = 500,
        time_zone: str = "Asia/Dubai",
        scope: SiteScope | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        if not base_url or not username or not password:
            raise ValueError("BioTime provider requires a base URL, username, and password")
        self._username = username
        self._password = password
        self._page_size = max(1, min(page_size, _MAX_PAGE_SIZE))
        self._zone = ZoneInfo(time_zone)
        self._scope = scope or SiteScope()
        self._token: str | None = None
        self._client = client or httpx.Client(
            base_url=base_url.rstrip("/"),
            verify=verify,
            timeout=timeout,
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    # -- transport ---------------------------------------------------------

    def _authenticate(self) -> str:
        try:
            response = self._client.post(
                _AUTH_PATH, json={"username": self._username, "password": self._password}
            )
        except httpx.HTTPError as exc:
            raise BioTimeContractError("Provider authentication transport failure") from exc
        if response.status_code != 200:
            raise BioTimeContractError("Provider rejected the configured credentials")
        try:
            body = response.json()
        except ValueError as exc:
            raise BioTimeContractError("Provider authentication returned a non-JSON body") from exc
        token = body.get("token") if isinstance(body, dict) else None
        if not isinstance(token, str) or not token:
            raise BioTimeContractError("Provider authentication returned no token")
        self._token = token
        return token

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        """Perform one authenticated read and validate the envelope.

        A single re-authentication is attempted on 401/403 so an expired token
        recovers without operator action; a second failure is surfaced.
        """
        for attempt in (1, 2):
            token = self._token or self._authenticate()
            try:
                response = self._client.get(
                    path, params=params, headers={"Authorization": f"JWT {token}"}
                )
            except httpx.HTTPError as exc:
                raise BioTimeContractError("Provider read transport failure") from exc

            if response.status_code in (401, 403) and attempt == 1:
                self._token = None
                continue
            if response.status_code != 200:
                raise BioTimeContractError(
                    f"Provider read returned HTTP {response.status_code}"
                )

            content_type = response.headers.get("content-type", "")
            if "json" not in content_type:
                # The verified soft-404: HTTP 200 with an HTML "no permission or
                # the page doesn't exist" body. Treating this as an empty page
                # would silently skip a window and produce false absences.
                raise BioTimeContractError(
                    "Provider returned a non-JSON body for a list read"
                )
            try:
                payload = response.json()
            except ValueError as exc:
                raise BioTimeContractError("Provider returned an unparsable body") from exc
            if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
                raise BioTimeContractError("Provider response did not match the list envelope")
            return payload

        raise BioTimeContractError("Provider authentication did not recover")

    def _read_page(
        self, path: str, *, cursor: str | None, extra: dict[str, Any] | None = None
    ) -> tuple[list[dict[str, Any]], bool, str | None]:
        """Fetch one server page and derive its cursor state.

        Exhaustion is decided by the server's own ``next`` link, never by the
        number of rows left after site filtering — dropping another site's rows
        must not be mistaken for the end of the window.
        """
        page = _page_number(cursor)
        params: dict[str, Any] = {"page": page, "page_size": self._page_size}
        if extra:
            params.update(extra)
        payload = self._get(path, params)
        rows = [row for row in payload["data"] if isinstance(row, dict)]
        exhausted = not payload.get("next")
        next_cursor = None if exhausted else str(page + 1)
        return rows, exhausted, next_cursor

    # -- AttendanceProvider ------------------------------------------------

    def test_connection(self) -> ProviderHealth:
        """Authenticate and read one bounded page, without leaking vendor detail."""
        try:
            self._token = None
            self._read_page(_PEOPLE_PATH, cursor=None)
        except BioTimeContractError as exc:
            log.warning("biotime: connection test failed (%s)", exc)
            return ProviderHealth(status="error", summary=str(exc))
        except Exception:
            log.exception("biotime: connection test failed")
            return ProviderHealth(status="error", summary="Provider connection failed")
        return ProviderHealth(status="healthy", summary=None)

    def list_people(self, *, cursor: str | None) -> ProviderPage[ProviderPerson]:
        rows, exhausted, next_cursor = self._read_page(_PEOPLE_PATH, cursor=cursor)
        people = [
            self._person(row) for row in rows if self._scope.accepts_person(row)
        ]
        return ProviderPage(
            items=[person for person in people if person is not None],
            next_cursor=next_cursor,
            exhausted=exhausted,
            # People carry no window; freshness belongs to the punch stream.
            fresh_through=None,
        )

    def list_punches(
        self,
        *,
        cursor: str | None,
        since: datetime | None,
        until: datetime,
    ) -> ProviderPage[ProviderPunch]:
        window: dict[str, Any] = {"end_time": _format_wall_time(until, self._zone)}
        if since is not None:
            window["start_time"] = _format_start_time(since, self._zone)
        rows, exhausted, next_cursor = self._read_page(
            _PUNCH_PATH, cursor=cursor, extra=window
        )
        punches = [
            punch
            for punch in (
                self._punch(row) for row in rows if self._scope.accepts_punch(row)
            )
            if punch is not None
        ]
        return ProviderPage(
            items=punches,
            next_cursor=next_cursor,
            exhausted=exhausted,
            # A partially imported window is not yet trustworthy, so the
            # high-water mark only moves once the server says there is no next
            # page for these frozen bounds.
            fresh_through=until if exhausted else None,
        )

    def list_person_punches(
        self,
        *,
        external_employee_code: str,
        since: datetime,
        until: datetime,
        cursor: str | None,
    ) -> ProviderPage[ProviderPunch]:
        """One person's punches inside a window, filtered by the server.

        The filter is ``emp_code`` because it is the only person field this
        endpoint honours: ``emp``, the primary key the import path joins on, is
        accepted and then silently ignored, so filtering by it would return the
        whole site. A caller must therefore still check each row's
        ``external_person_id`` before trusting it as one person's history.

        Reading history never advances the import watermark, so this page carries
        no ``fresh_through``.
        """
        rows, exhausted, next_cursor = self._read_page(
            _PUNCH_PATH,
            cursor=cursor,
            extra={
                "start_time": _format_start_time(since, self._zone),
                "end_time": _format_wall_time(until, self._zone),
                "emp_code": external_employee_code,
            },
        )
        punches = [
            punch
            for punch in (
                self._punch(row) for row in rows if self._scope.accepts_punch(row)
            )
            if punch is not None
        ]
        return ProviderPage(
            items=punches,
            next_cursor=next_cursor,
            exhausted=exhausted,
            fresh_through=None,
        )

    # -- normalization -----------------------------------------------------

    def _person(self, record: dict[str, Any]) -> ProviderPerson | None:
        external_person_id = _text(record, "id")
        if external_person_id is None:
            return None
        display = _text(record, "full_name") or _text(record, "format_name")
        return ProviderPerson(
            external_person_id=external_person_id,
            external_employee_code=_text(record, "emp_code"),
            display_name_snapshot=display,
            # This build's employee serializer exposes no employment-status
            # field, so no departure can be inferred from it. Sentinel's own
            # Employee.status remains the authority on who has left.
            active=True,
            source_updated_at=_parse_wall_time(record.get("update_time"), self._zone),
        )

    def _punch(self, record: dict[str, Any]) -> ProviderPunch | None:
        external_event_id = _text(record, "id")
        # `emp` is the employees-endpoint primary key and is the only reliable
        # join back to a person; `emp_code` is a human-facing code that this
        # deployment writes inconsistently.
        external_person_id = _text(record, "emp")
        occurred_at = _parse_wall_time(record.get("punch_time"), self._zone)
        if external_event_id is None or external_person_id is None or occurred_at is None:
            # A row missing its identity or its instant cannot be an attendance
            # fact. Skipping is safer than storing an unusable placeholder.
            log.warning("biotime: skipped a punch row missing id, employee, or punch_time")
            return None
        return ProviderPunch(
            external_event_id=external_event_id,
            external_person_id=external_person_id,
            occurred_at=occurred_at,
            direction=_DIRECTIONS.get(_text(record, "punch_state") or ""),
            device_id=_text(record, "terminal_sn"),
            device_name=_text(record, "terminal_alias"),
            source_updated_at=_parse_wall_time(record.get("upload_time"), self._zone),
        )


def build_provider_from_settings(settings: Any) -> BioTimeAttendanceProvider | None:
    """Construct the provider when the environment supplies a complete configuration."""
    if not settings.biotime_configured:
        return None
    verify: bool | str = settings.biotime_ca_bundle or settings.biotime_verify_tls
    return BioTimeAttendanceProvider(
        base_url=settings.biotime_base_url,
        username=settings.biotime_username,
        password=settings.biotime_password,
        verify=verify,
        timeout=settings.biotime_timeout_seconds,
        page_size=settings.biotime_page_size,
        time_zone=settings.biotime_time_zone,
        scope=SiteScope(
            area_names=settings.biotime_area_name_set,
            terminal_sns=settings.biotime_terminal_sn_set,
            department_ids=settings.biotime_department_id_set,
        ),
    )


def iter_all_people(provider: BioTimeAttendanceProvider) -> Iterator[ProviderPerson]:
    """Walk every people page. Used by operator tooling, not by scheduled sync."""
    cursor: str | None = None
    while True:
        page = provider.list_people(cursor=cursor)
        yield from page.items
        if page.exhausted:
            return
        cursor = page.next_cursor


__all__ = [
    "PROVIDER_CODE",
    "BioTimeAttendanceProvider",
    "BioTimeContractError",
    "SiteScope",
    "build_provider_from_settings",
    "iter_all_people",
]
