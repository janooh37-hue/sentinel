"""Synthetic delivery-note rows; no OCR binary or real notes required."""

import pytest

from app.core.extraction.delivery_note import normalize_item_text, parse_row


@pytest.mark.parametrize(
    ("text", "item", "quantity"),
    [
        ("Coffee-mate 15\u00d7400g 8 125.00 1000.00", "Coffee-mate 15\u00d7400g", 8),
        ("1 Liwa Water 12 AED 50 600.00", "Liwa Water", 12),
        ("Tea AED 50", "Tea", None),
        ("Tea 50 AED", "Tea", None),
        ("Tea $50.00 4", "Tea", 4),
        ("مياه ليوا \u0661\u0662 \u0665\u0660\u066b\u0660\u0660", "مياه ليوا", 12),
        ("Gloves \u06f0 \u06f2\u06f0\u066b\u06f0\u06f0", "Gloves", 0),
        ("Unknown supplies", "Unknown supplies", None),
    ],
)
def test_parse_item_rows(text: str, item: str, quantity: int | None) -> None:
    row = parse_row(text)
    assert row is not None
    assert (row.item_text, row.quantity) == (item, quantity)


@pytest.mark.parametrize(
    "text",
    [
        "Item Description Qty Unit Price Amount",
        "Grand Total 1200.00",
        "Subtotal 1200",
        "VAT 5 25.00",
        "Delivery Note 123",
        "المجموع ١٢٠",
        "",
        "12 25.00",
    ],
)
def test_drop_non_item_rows(text: str) -> None:
    assert parse_row(text) is None


def test_alias_normalization() -> None:
    assert normalize_item_text(" COFFEE-mate / ١٢ ") == "coffee mate 12"
