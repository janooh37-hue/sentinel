"""Normalize EVG ticket JSON without coupling domain parsing to its transport."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, time
from typing import cast

# EVG's numeric PlateColorCode is offset from the fleet's plate code by 51. The
# operator's own fleet corroborates both code 19 <-> color 70 and code 21 <-> color 72.
PLATE_COLOR_OFFSET = 51
TICKET_TYPE_LABELS = {"A": "Absent"}


@dataclass(frozen=True, slots=True)
class EvgTicketRow:
    ticket_no: str
    date: date
    time: str | None
    location: str
    plate_number: str
    plate_code: str | None
    amount: int
    discount_pct: int
    amount_after_discount: int | None
    late_charges: int
    black_points: int
    fine_type: str
    descriptions: tuple[str, ...]


def plate_code_from_color_code(code: object) -> str | None:
    """Map the verified EVG color-code range, leaving other rows for operator assignment.

    EVG values 52 through 110 correspond to fleet plate codes 1 through 59 after
    subtracting the verified offset. Values outside that range are not guessed because
    a wrong plate code could silently match a fine to the wrong vehicle.
    """

    if isinstance(code, bool) or not isinstance(code, int) or not 52 <= code <= 110:
        return None
    return str(code - PLATE_COLOR_OFFSET)


def _mapping(value: object) -> Mapping[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    return cast(Mapping[str, object], value)


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _rounded_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return round(value)
    except (OverflowError, ValueError):
        return None


def _integer(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return int(value)
    except (OverflowError, ValueError):
        return None


def _ticket_number(value: object) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    ticket_no = str(value).strip()
    return ticket_no or None


def _ticket_date(value: object) -> date | None:
    if not isinstance(value, str):
        return None
    date_text = value.strip().split("T", 1)[0].split(" ", 1)[0]
    try:
        return date.fromisoformat(date_text)
    except ValueError:
        return None


def _ticket_time(value: object) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).time()
    except ValueError:
        try:
            parsed = time.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed.strftime("%H:%M")


def _descriptions(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()

    descriptions: list[str] = []
    for raw_material in value:
        material = _mapping(raw_material)
        if material is None:
            continue
        description = _text(material.get("MaterialEnglishDesc")) or _text(
            material.get("MaterialArabicDesc")
        )
        if description:
            descriptions.append(description)
    return tuple(descriptions)


def _parse_ticket(value: object) -> EvgTicketRow | None:
    ticket = _mapping(value)
    if ticket is None:
        return None

    ticket_id = _mapping(ticket.get("TicketID"))
    plate_info = _mapping(ticket.get("PlateInfo"))
    if ticket_id is None or plate_info is None:
        return None

    ticket_no = _ticket_number(ticket_id.get("TicketNo"))
    ticket_date = _ticket_date(ticket_id.get("TicketDate"))
    plate_number = _ticket_number(plate_info.get("PlateNo"))
    amount = _rounded_int(ticket.get("TotalAmount"))
    discount_pct = _rounded_int(ticket.get("DiscountRate"))
    if (
        ticket_no is None
        or ticket_date is None
        or plate_number is None
        or amount is None
        or amount < 1
        or discount_pct is None
    ):
        return None

    raw_after_discount = ticket.get("TotalAmountAfterDiscount")
    amount_after_discount = None if raw_after_discount is None else _rounded_int(raw_after_discount)
    if raw_after_discount is not None and amount_after_discount is None:
        return None

    raw_late_charges = ticket.get("LateCharges")
    late_charges = 0 if raw_late_charges is None else _rounded_int(raw_late_charges)
    raw_black_points = ticket.get("BlackPoints")
    black_points = 0 if raw_black_points is None else _integer(raw_black_points)
    if late_charges is None or black_points is None:
        return None

    # The preview schema bounds these (amount >= 1, the rest >= 0). Reject an
    # out-of-range ticket here so one malformed row is skipped like any other,
    # instead of failing the whole preview on response validation.
    if (
        discount_pct < 0
        or late_charges < 0
        or black_points < 0
        or (amount_after_discount is not None and amount_after_discount < 0)
    ):
        return None

    ticket_type = _text(ticket.get("TicketType"))
    return EvgTicketRow(
        ticket_no=ticket_no,
        date=ticket_date,
        time=_ticket_time(ticket.get("TicketTime")),
        location=_text(ticket.get("LocationDescEn")) or _text(ticket.get("LocationDescAr")),
        plate_number=plate_number,
        plate_code=plate_code_from_color_code(plate_info.get("PlateColorCode")),
        amount=amount,
        discount_pct=discount_pct,
        amount_after_discount=amount_after_discount,
        late_charges=late_charges,
        black_points=black_points,
        fine_type=TICKET_TYPE_LABELS.get(ticket_type, ticket_type or "Unknown"),
        descriptions=_descriptions(ticket.get("MaterialsList")),
    )


def parse_tickets_payload(payload: object) -> list[EvgTicketRow]:
    """Parse usable, first-seen tickets from an EVG Quick Search JSON envelope."""

    envelope = _mapping(payload)
    response_value = _mapping(envelope.get("ResponseValue")) if envelope is not None else None
    tickets = response_value.get("Tickets") if response_value is not None else None
    if envelope is None or not isinstance(tickets, list):
        raise ValueError("EVG response does not contain a ticket list")

    rows: list[EvgTicketRow] = []
    seen_ticket_numbers: set[str] = set()
    for raw_ticket in tickets:
        row = _parse_ticket(raw_ticket)
        if row is None or row.ticket_no in seen_ticket_numbers:
            continue
        seen_ticket_numbers.add(row.ticket_no)
        rows.append(row)
    return rows
