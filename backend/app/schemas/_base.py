"""Shared Pydantic config for ORM-backed Read schemas."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, ValidationInfo, field_validator

# UAE is a fixed UTC+4 year-round (no DST).
DUBAI = timezone(timedelta(hours=4))


class ORMBase(BaseModel):
    """Base for Read schemas — pulls fields off SQLAlchemy rows directly.

    Also tags naive datetimes with their real zone on the way in, so Pydantic
    serializes them with an offset. Timestamp columns store naive **UTC**
    (``models._utcnow``) and Pydantic emitted them with no offset at all —
    ``"2026-08-04T05:51:31"``. JS ``new Date()`` reads an offset-less datetime
    as LOCAL, so every timestamp the frontend rendered was 4h behind on this
    UTC+4 box: a message sent 09:51 displayed as 05:51. Tagging the instant
    fixes all ~79 frontend parse sites at once, including the hand-rolled
    ``iso + 'Z'`` workarounds (they detect the offset and pass through) — see
    ``lib/time.ts``.

    This is a *validator*, not a serializer, on purpose. A wildcard
    ``field_serializer`` has to declare ``return_type``, and since it spans
    every field type that can only be ``Any`` — which strips ``type`` and
    ``format`` from all of them in the OpenAPI response schema and would turn
    every field in ``api.types.ts`` into ``unknown``. Validators only shape the
    *input* schema, which FastAPI does not use for responses, so the generated
    contract is byte-identical.

    Subclasses whose column holds LOCAL wall-clock rather than UTC list those
    fields in ``LOCAL_WALLCLOCK_FIELDS`` — see ``schemas/book.py``.
    """

    model_config = ConfigDict(from_attributes=True)

    #: Field names on this model stored as LOCAL (Asia/Dubai) wall-clock.
    LOCAL_WALLCLOCK_FIELDS: ClassVar[frozenset[str]] = frozenset()

    @field_validator("*")
    @classmethod
    def _tag_timezone(cls, value: Any, info: ValidationInfo) -> Any:
        if isinstance(value, datetime) and value.tzinfo is None:
            local = info.field_name in cls.LOCAL_WALLCLOCK_FIELDS
            return value.replace(tzinfo=DUBAI if local else UTC)
        return value
