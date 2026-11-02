"""Synthetic source-unit proposals; no OCR binary or real notes required."""

import pytest

from app.core.extraction.delivery_note import normalize_item_text, parse_row


@pytest.mark.parametrize(
    ("text", "item", "cartons", "loose", "contains", "expiry"),
    [
        (
            "Coffee-mate 15\u00d7400g 8 CTN 2 loose contains 15 expiry 2028-03-19",
            "Coffee-mate 15\u00d7400g",
            8,
            2,
            15,
            "2028-03-19",
        ),
        (
            "مياه ليوا \u0661\u0662 كرتون \u0663 مفرد الصلاحية \u0662\u0660\u0662\u0667/\u0660\u0665",
            "مياه ليوا",
            12,
            3,
            None,
            "2027-05",
        ),
        ("Gloves cartons: 0 pack: 10 exp 05/2027", "Gloves", 0, None, 10, "2027-05"),
        ("Tea 3 CTN 24 pcs/carton 2 loose EXP 19/03/2028", "Tea", 3, 2, 24, "2028-03-19"),
        ("Tea 2 CTN Expiry Date: 05/2027", "Tea", 2, None, None, "2027-05"),
        ("Tea 2 CTN Exp. Date 05/2027", "Tea", 2, None, None, "2027-05"),
        ("Tea 2 CTN EXP DATE 2027-05", "Tea", 2, None, None, "2027-05"),
        ("Liwa Water", "Liwa Water", None, None, None, None),
        ("Tea 5 crates AED 50", "Tea crates", None, None, None, None),
        (
            "Coffee-mate 15\u00d7400g 8 125.00 1000.00",
            "Coffee-mate 15\u00d7400g",
            None,
            None,
            None,
            None,
        ),
        ("Tea 4 50 AED", "Tea", None, None, None, None),
        ("Tea $50.00 4", "Tea", None, None, None, None),
        ("Tea 12x190g 2.5 CTN", "Tea 12x190g CTN", None, None, None, None),
    ],
)
def test_propose_only_explicit_source_units(text, item, cartons, loose, contains, expiry):
    row = parse_row(text)
    assert row is not None
    assert (
        row.item_text,
        row.cartons,
        row.loose_quantity,
        row.carton_contains_qty,
        row.expiry,
    ) == (
        item,
        cartons,
        loose,
        contains,
        expiry,
    )


@pytest.mark.parametrize(
    "text",
    [
        "Item Description Qty Unit Price Amount",
        "Item Qty Unit prlce Total 2 5.00",
        "AL NOOR TRADING LLC",
        "AL NOOR TRADING LLC 31",
        "TOTAL 546.50",
        "Grand Total 1200.00",
        "Subtotal 1200",
        "VAT 5 25.00",
        "Delivery Note 123",
        "المجموع ١٢\u0660",
        "",
        "12 25.00",
    ],
)
def test_drop_non_item_rows(text: str) -> None:
    assert parse_row(text) is None


def test_invalid_expiry_is_not_proposed() -> None:
    row = parse_row("Tea 2 CTN expiry 2027-02-31")
    assert row is not None and row.cartons == 2 and row.expiry is None


def test_alias_normalization() -> None:
    assert normalize_item_text(" COFFEE-mate / ١٢ ") == "coffee mate 12"
