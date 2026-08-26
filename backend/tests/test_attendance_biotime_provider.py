"""BioTime adapter behaviour, pinned to shapes recorded from the installed build.

The payload fragments below are the field sets the probe observed on
`gssbiotime` (values replaced): the `{code,count,data,msg,next,previous}`
envelope, `punch_state` 255, naive local timestamps, and `emp` as the join key.
"""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest

from app.services.attendance_biotime_provider import (
    BioTimeAttendanceProvider,
    BioTimeContractError,
    SiteScope,
)

DUBAI_OFFSET_HOURS = 4

_HTML_SOFT_404 = (
    "<!DOCTYPE HTML><html><head><title>Page not found</title></head>"
    "<body><h2>Page not found</h2>"
    "<p>Sorry,you have no the permission or the page doesn&#39;t exist!</p></body></html>"
)


def _envelope(data: list[dict], *, count: int | None = None, next_url: str | None = None) -> dict:
    return {
        "code": 0,
        "msg": "success",
        "count": count if count is not None else len(data),
        "next": next_url,
        "previous": None,
        "data": data,
    }


def _punch_row(**overrides) -> dict:
    row = {
        "id": 5001,
        "emp": 1077,
        "emp_code": "3082",
        "punch_time": "2026-08-18 09:11:32",
        "punch_state": "255",
        "punch_state_display": "Unknown",
        "verify_type": 15,
        "terminal_sn": "RYQ1252000369",
        "terminal_alias": "Al Watbha Prison 2",
        "area_alias": "Al Watbha Prison 2",
        "upload_time": "2026-08-18 09:11:33",
    }
    row.update(overrides)
    return row


def _person_row(**overrides) -> dict:
    row = {
        "id": 1077,
        "emp_code": "3082",
        "first_name": "Sample",
        "full_name": "Sample Person",
        "format_name": "3082 Sample Person",
        "department": {"id": 4, "dept_code": "4", "dept_name": "Al Watbha Prison 2"},
        "area": [{"id": 8, "area_code": "8", "area_name": "Al Watbha Prison 2"}],
        "update_time": "2026-06-01 13:09:35",
    }
    row.update(overrides)
    return row


def _provider(handler, **kwargs) -> BioTimeAttendanceProvider:
    client = httpx.Client(
        base_url="http://biotime.test", transport=httpx.MockTransport(handler)
    )
    return BioTimeAttendanceProvider(
        base_url="http://biotime.test",
        username="probe",
        password="secret",
        client=client,
        **kwargs,
    )


def _auth_ok(request: httpx.Request) -> httpx.Response | None:
    if request.url.path == "/jwt-api-token-auth/":
        return httpx.Response(200, json={"token": "tok"})
    return None


def test_authenticates_with_jwt_scheme_and_reads_punches():
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        seen["authorization"] = request.headers.get("authorization", "")
        seen["path"] = request.url.path
        return httpx.Response(200, json=_envelope([_punch_row()]))

    page = _provider(handler).list_punches(
        cursor=None, since=datetime(2026, 8, 18, 0, 0, tzinfo=UTC), until=datetime(2026, 8, 18, 6, 0, tzinfo=UTC)
    )

    assert seen["authorization"] == "JWT tok"
    assert seen["path"] == "/iclock/api/transactions/"
    assert len(page.items) == 1


def test_punch_window_overlaps_start_by_one_second_in_site_wall_time():
    """BioTime excludes both bounds; overlap keeps a punch on the shared boundary."""
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        captured.update(dict(request.url.params))
        return httpx.Response(200, json=_envelope([]))

    _provider(handler).list_punches(
        cursor=None,
        since=datetime(2026, 8, 18, 4, 0, tzinfo=UTC),
        until=datetime(2026, 8, 18, 10, 0, tzinfo=UTC),
    )

    # 04:00Z and 10:00Z are 08:00 and 14:00 in Asia/Dubai. The start overlaps
    # one second because BioTime excludes a punch exactly equal to start_time.
    assert captured["start_time"] == "2026-08-18 07:59:59"
    assert captured["end_time"] == "2026-08-18 14:00:00"


def test_punch_time_is_interpreted_as_local_and_stored_as_utc():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_punch_row(punch_time="2026-08-18 09:11:32")]))

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert page.items[0].occurred_at == datetime(2026, 8, 18, 5, 11, 32, tzinfo=UTC)


def test_unknown_punch_state_yields_no_direction():
    """Every observed row reports 255/Unknown; inventing in/out would be a fabrication."""

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_punch_row(punch_state="255")]))

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert page.items[0].direction is None


@pytest.mark.parametrize(("state", "expected"), [("0", "in"), ("1", "out")])
def test_recognised_punch_states_are_reported(state, expected):
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_punch_row(punch_state=state)]))

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert page.items[0].direction == expected


def test_html_body_with_status_200_is_rejected_not_read_as_empty():
    """The verified soft-404. Accepting it would advance freshness over unread time."""

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, text=_HTML_SOFT_404, headers={"content-type": "text/html"})

    with pytest.raises(BioTimeContractError):
        _provider(handler).list_punches(
            cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
        )


def test_fresh_through_only_advances_on_the_final_page():
    """A partially imported window is not trustworthy yet."""
    until = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        page = request.url.params.get("page")
        if page == "1":
            return httpx.Response(
                200, json=_envelope([_punch_row()], count=2, next_url="?page=2")
            )
        return httpx.Response(200, json=_envelope([_punch_row(id=5002)], count=2))

    provider = _provider(handler)

    first = provider.list_punches(cursor=None, since=None, until=until)
    assert first.exhausted is False
    assert first.next_cursor == "2"
    assert first.fresh_through is None

    second = provider.list_punches(cursor=first.next_cursor, since=None, until=until)
    assert second.exhausted is True
    assert second.next_cursor is None
    assert second.fresh_through == until


def test_site_filtering_never_signals_end_of_window():
    """Dropping another site's rows must not be mistaken for exhaustion."""

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(
            200,
            json=_envelope(
                [_punch_row(area_alias="Depot", terminal_sn="SN-OTHER")],
                count=2,
                next_url="?page=2",
            ),
        )

    page = _provider(
        handler, scope=SiteScope(area_names=frozenset({"Al Watbha Prison 2"}))
    ).list_punches(cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC))

    assert page.items == []
    assert page.exhausted is False
    assert page.next_cursor == "2"


def test_punches_outside_the_site_allow_list_are_dropped():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(
            200,
            json=_envelope(
                [
                    _punch_row(id=1, area_alias="Al Watbha Prison 2"),
                    _punch_row(id=2, area_alias="Depot", terminal_sn="SN-DEPOT"),
                ]
            ),
        )

    page = _provider(
        handler, scope=SiteScope(area_names=frozenset({"Al Watbha Prison 2"}))
    ).list_punches(cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC))

    assert [item.external_event_id for item in page.items] == ["1"]


def test_terminal_serial_also_admits_a_punch():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_punch_row(area_alias=None)]))

    page = _provider(
        handler, scope=SiteScope(terminal_sns=frozenset({"RYQ1252000369"}))
    ).list_punches(cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC))

    assert len(page.items) == 1


def test_person_uses_emp_join_key_and_employee_code():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_person_row()]))

    page = _provider(handler).list_people(cursor=None)
    person = page.items[0]

    assert person.external_person_id == "1077"
    assert person.external_employee_code == "3082"
    assert person.display_name_snapshot == "Sample Person"
    assert person.source_updated_at == datetime(2026, 6, 1, 9, 9, 35, tzinfo=UTC)


def test_punch_joins_on_emp_not_emp_code():
    """`emp_code` is written inconsistently; `emp` is the employees primary key."""

    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_punch_row(emp=1077, emp_code="G3082")]))

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert page.items[0].external_person_id == "1077"


def test_people_outside_the_department_scope_are_dropped():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(
            200,
            json=_envelope(
                [
                    _person_row(id=1, department={"id": 4, "dept_name": "Al Watbha Prison 2"}),
                    _person_row(id=2, department={"id": 9, "dept_name": "Head Office"}),
                ]
            ),
        )

    page = _provider(
        handler, scope=SiteScope(department_ids=frozenset({"4"}))
    ).list_people(cursor=None)

    assert [item.external_person_id for item in page.items] == ["1"]


def test_rows_missing_identity_or_instant_are_skipped_not_stored():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(
            200,
            json=_envelope(
                [
                    _punch_row(id=1),
                    _punch_row(id=2, punch_time=None),
                    _punch_row(id=3, emp=None),
                ]
            ),
        )

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert [item.external_event_id for item in page.items] == ["1"]


def test_expired_token_is_refreshed_once_without_operator_action():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/jwt-api-token-auth/":
            calls.append("auth")
            return httpx.Response(200, json={"token": f"tok{calls.count('auth')}"})
        calls.append(request.headers.get("authorization", ""))
        if calls.count("auth") == 1:
            return httpx.Response(401, json={"detail": "Token expired."})
        return httpx.Response(200, json=_envelope([_punch_row()]))

    page = _provider(handler).list_punches(
        cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
    )

    assert len(page.items) == 1
    assert calls.count("auth") == 2


def test_persistent_denial_raises_rather_than_reporting_an_empty_window():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(403, json={"detail": "You do not have permission."})

    with pytest.raises(BioTimeContractError):
        _provider(handler).list_punches(
            cursor=None, since=None, until=datetime(2026, 8, 18, 12, 0, tzinfo=UTC)
        )


def test_unexpected_envelope_is_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json={"unexpected": True})

    with pytest.raises(BioTimeContractError):
        _provider(handler).list_people(cursor=None)


def test_test_connection_reports_error_without_leaking_vendor_text():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, text=_HTML_SOFT_404, headers={"content-type": "text/html"})

    health = _provider(handler).test_connection()

    assert health.status == "error"
    assert "biotime.test" not in (health.summary or "")


def test_test_connection_reports_healthy_on_a_valid_page():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([_person_row()]))

    assert _provider(handler).test_connection().status == "healthy"


def test_malformed_cursor_is_rejected():
    def handler(request: httpx.Request) -> httpx.Response:
        auth = _auth_ok(request)
        if auth is not None:
            return auth
        return httpx.Response(200, json=_envelope([]))

    with pytest.raises(BioTimeContractError):
        _provider(handler).list_people(cursor="not-a-page")
