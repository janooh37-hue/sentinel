"""Pure parsers for Emirates Vehicle Gate fine lookup pages."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime

from lxml import html as lxml_html
from lxml.html import HtmlElement

_TICKETS_TABLE_ID = "ctl00_cphScrollMenu_gettickets1_ctl00_gvTickets"
_DATE_RE = re.compile(r"^(\d{2}-\d{2}-\d{4})")
_TICKET_NO_RE = re.compile(r"(?:[?&]|&amp;)TicketNo=(\d+)", re.IGNORECASE)
_PAGE_RE = re.compile(
    r"__doPostBack\([^)]*?['\"](?P<page>Page\$\d+)['\"]\s*\)",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(r"-?[\d,]+(?:\.\d+)?")


@dataclass(frozen=True, slots=True)
class EvgTicketRow:
    ticket_no: str
    date: date
    location: str
    plate_number: str
    amount: int
    discount_pct: int
    amount_after_discount: int
    late_charges: int
    black_points: int
    fine_type: str


@dataclass(frozen=True, slots=True)
class EvgTicketDetails:
    ticket_no: str
    time: str | None
    plate_code: str | None
    owner_traffic_no: str
    descriptions: list[str]


def _parse_document(source: str) -> HtmlElement:
    if not source.strip():
        source = "<html></html>"
    return lxml_html.fromstring(source)


def _text(element: HtmlElement) -> str:
    return " ".join("".join(element.itertext()).split())


def _whole_number(value: str) -> int:
    match = _NUMBER_RE.search(value)
    if match is None:
        return 0
    return round(float(match.group(0).replace(",", "")))


def _tickets_table(source: str) -> HtmlElement | None:
    root = _parse_document(source)
    tables = root.xpath(f'//*[@id="{_TICKETS_TABLE_ID}"]')
    return tables[0] if tables else None


def parse_tickets_page(html: str) -> list[EvgTicketRow]:
    """Parse all ticket rows in an EVG fines result grid."""

    table = _tickets_table(html)
    if table is None:
        return []

    tickets: list[EvgTicketRow] = []
    for table_row in table.xpath(".//tr"):
        cells = [_text(cell) for cell in table_row.xpath("./th|./td")]
        if len(cells) < 10:
            continue
        date_match = _DATE_RE.match(cells[2])
        if date_match is None:
            continue
        row_html = lxml_html.tostring(table_row, encoding="unicode")
        ticket_match = _TICKET_NO_RE.search(row_html)
        if ticket_match is None:
            continue

        tickets.append(
            EvgTicketRow(
                ticket_no=ticket_match.group(1),
                date=datetime.strptime(date_match.group(1), "%d-%m-%Y").date(),
                location=cells[3],
                plate_number=cells[4],
                amount=_whole_number(cells[5]),
                discount_pct=_whole_number(cells[6]),
                amount_after_discount=_whole_number(cells[7]),
                late_charges=_whole_number(cells[8]),
                black_points=_whole_number(cells[9]),
                fine_type=cells[10] if len(cells) > 10 else "",
            )
        )
    return tickets


def has_next_page(html: str) -> str | None:
    """Return the EVG grid postback argument for the next pager link."""

    table = _tickets_table(html)
    if table is None:
        return None

    for pager_row in table.xpath(".//tr"):
        row_html = lxml_html.tostring(pager_row, encoding="unicode")
        if _PAGE_RE.search(row_html) is None:
            continue

        links: list[tuple[int, str]] = []
        for anchor in pager_row.xpath(".//a"):
            anchor_html = lxml_html.tostring(anchor, encoding="unicode")
            match = _PAGE_RE.search(anchor_html)
            if match is None:
                continue
            argument = match.group("page")
            links.append((int(argument.removeprefix("Page$")), argument))
        if not links:
            return None

        current_numbers = [
            int(value.strip())
            for value in pager_row.xpath(".//text()[not(ancestor::a)]")
            if value.strip().isdigit()
        ]
        if current_numbers:
            current_page = current_numbers[0]
            later = [link for link in links if link[0] > current_page]
            return min(later)[1] if later else None
        return min(links)[1]
    return None


def _normalise_time(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    for pattern in ("%I:%M:%S %p", "%I:%M %p", "%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(value.upper(), pattern).strftime("%H:%M")
        except ValueError:
            continue
    return None


def _detail_values(root: HtmlElement) -> dict[str, str]:
    values: dict[str, str] = {}
    for table_row in root.xpath("//tr"):
        cells = table_row.xpath("./th|./td")
        if len(cells) < 2:
            continue
        label = _text(cells[0]).rstrip(":").strip().casefold()
        if label:
            values.setdefault(label, _text(cells[1]))
    return values


def _descriptions(root: HtmlElement) -> list[str]:
    for table in root.xpath("//table"):
        rows = table.xpath(".//tr")
        for header_position, table_row in enumerate(rows):
            cells = table_row.xpath("./th|./td")
            labels = [_text(cell).rstrip(":").strip().casefold() for cell in cells]
            try:
                description_index = labels.index("description")
            except ValueError:
                continue

            descriptions: list[str] = []
            for detail_row in rows[header_position + 1 :]:
                detail_cells = detail_row.xpath("./th|./td")
                if description_index >= len(detail_cells):
                    continue
                description = _text(detail_cells[description_index])
                if description and description.casefold() != "description":
                    descriptions.append(description)
            return descriptions
    return []


def parse_ticket_details(html: str) -> EvgTicketDetails:
    """Parse and normalize one EVG ticket-details page."""

    root = _parse_document(html)
    values = _detail_values(root)
    return EvgTicketDetails(
        ticket_no=values.get("fine no.", values.get("fine no", "")),
        time=_normalise_time(values.get("time", "")),
        plate_code=plate_code_from_color(values.get("plate color", "")),
        owner_traffic_no=values.get(
            "owner traffic no.",
            values.get("owner traffic no", ""),
        ),
        descriptions=_descriptions(root),
    )


_SIMPLE_ORDINALS = {
    "FIRST": 1,
    "SECOND": 2,
    "THIRD": 3,
    "FOURTH": 4,
    "FIFTH": 5,
    "SIXTH": 6,
    "SEVENTH": 7,
    "EIGHTH": 8,
    "NINTH": 9,
    "TENTH": 10,
    "ELEVENTH": 11,
    "TWELFTH": 12,
    "THIRTEENTH": 13,
    "FOURTEENTH": 14,
    "FIFTEENTH": 15,
    "SIXTEENTH": 16,
    "SEVENTEENTH": 17,
    "EIGHTEENTH": 18,
    "NINETEENTH": 19,
    "TWENTIETH": 20,
    "THIRTIETH": 30,
    "FORTIETH": 40,
    "FIFTIETH": 50,
}
_COMPOUND_TENS = {"TWENTY": 20, "THIRTY": 30, "FORTY": 40, "FIFTY": 50}
_UNIT_ORDINALS = {key: value for key, value in _SIMPLE_ORDINALS.items() if value < 10}


def plate_code_from_color(text: str) -> str | None:
    """Map EVG's English ordinal plate-color label to a numeric plate code."""

    normalized = text.upper().replace("\u2013", "-").replace("\u2014", "-")
    normalized = re.sub(r"\s+CATEGORY\b.*$", "", normalized).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    if not normalized:
        return None
    if value := _SIMPLE_ORDINALS.get(normalized):
        return str(value)

    parts = re.split(r"[- ]", normalized)
    if len(parts) == 2:
        tens = _COMPOUND_TENS.get(parts[0])
        units = _UNIT_ORDINALS.get(parts[1])
        if tens is not None and units is not None:
            return str(tens + units)
    return None
