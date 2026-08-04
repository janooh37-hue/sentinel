"""Naive timestamps must serialize with an offset, or the frontend is 4h off.

Timestamp columns store naive UTC (``models._utcnow``). Pydantic emitted them
with no offset, and JS ``new Date("2026-08-04T05:51:00")`` reads an offset-less
datetime as LOCAL — so on this UTC+4 box a message sent 09:51 displayed as
05:51. ``ORMBase`` tags the zone at validation time; these assertions cover that,
the two fields that opt out because their column is local, and the OpenAPI
contract that a serializer-based fix would have destroyed.
"""

from __future__ import annotations

from datetime import datetime

from app.schemas.book import BookRead, BookVersionRead
from app.schemas.notify import NotifyMessageRead

NAIVE = datetime(2026, 8, 4, 5, 51, 31)


def _notify(**kw: object) -> NotifyMessageRead:
    base: dict[str, object] = dict(
        id=1,
        event_type="leave_permit",
        event_ref="leave_permit:812",
        language="ar",
        channel="whatsapp",
        status="sent",
        delivery_state=None,
        fell_back=False,
        fallback_reason=None,
        error=None,
        created_at=NAIVE,
        provider_msg_id="3EB0",
        delivery_checked_at=None,
        phone="+971589911905",
    )
    base.update(kw)
    return NotifyMessageRead(**base)  # type: ignore[arg-type]


def _book(**kw: object) -> BookRead:
    base: dict[str, object] = dict(
        id=1,
        ref_number="HR-0001",
        category_id="HR",
        subject="s",
        direction="outgoing",
        stamp_style="header",
        created_at=NAIVE,
        deleted_at=NAIVE,
        priority="normal",
        approval_state="none",
    )
    base.update(kw)
    return BookRead(**base)  # type: ignore[arg-type]


def test_naive_utc_timestamp_serializes_with_a_utc_offset() -> None:
    """The WhatsApp message log — the surface the 4h skew was reported on."""
    assert '"created_at":"2026-08-04T05:51:31Z"' in _notify().model_dump_json()


def test_none_timestamp_survives() -> None:
    assert '"delivery_checked_at":null' in _notify().model_dump_json()


def test_non_datetime_fields_are_untouched() -> None:
    dumped = _notify().model_dump_json()
    assert '"status":"sent"' in dumped and '"event_ref":"leave_permit:812"' in dumped


def test_already_aware_timestamp_is_left_alone() -> None:
    from datetime import UTC

    aware = datetime(2026, 8, 4, 5, 51, 31, tzinfo=UTC)
    assert _notify(created_at=aware).created_at == aware


def test_book_created_at_is_tagged_local_because_the_column_is_local() -> None:
    """``document_service`` stamps Book/BookVersion.created_at with
    ``datetime.now()`` — LOCAL wall-clock (383 live rows sit +4h from their
    Document.created_at). Tagging those UTC would shift them 4h backwards."""
    dumped = _book().model_dump_json()
    assert '"created_at":"2026-08-04T05:51:31+04:00"' in dumped
    # deleted_at on the SAME model is naive UTC and must be tagged UTC.
    assert '"deleted_at":"2026-08-04T05:51:31Z"' in dumped

    version = BookVersionRead(
        id=1, version_no=1, trigger="initial", status="none", created_at=NAIVE
    )
    assert '"created_at":"2026-08-04T05:51:31+04:00"' in version.model_dump_json()


def test_book_created_at_keeps_its_local_calendar_date() -> None:
    """Two frontend sites do `created_at.slice(0, 10)`. Tagging the local value
    UTC would have made every book created 00:00-04:00 Dubai show the previous
    day; the +04:00 tag keeps the slice on the local date."""
    early = _book(created_at=datetime(2026, 8, 4, 1, 30))
    assert early.model_dump_json().split('"created_at":"')[1][:10] == "2026-08-04"


def test_openapi_response_schema_keeps_field_types() -> None:
    """A wildcard field_serializer would have to return ``Any``, which strips
    ``type``/``format`` from every field and turns api.types.ts into
    ``unknown``. Validators do not touch the serialization schema."""
    props = BookRead.model_json_schema(mode="serialization")["properties"]
    assert props["created_at"]["format"] == "date-time"
    assert props["ref_number"]["type"] == "string"
    assert props["id"]["type"] == "integer"
