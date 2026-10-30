"""Pure delivery-note row heuristics; prices never become quantities.

Rows are intentionally conservative: unknown item descriptions remain available
for human confirmation, while obvious document/table headings and totals vanish.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹\u066b\u066c", "01234567890123456789.,")
_CURRENCY = re.compile(r"^(?:AED|USD|SAR|DHS?\.?|EUR|GBP|د\.?إ\.?|درهم|[$€£])$", re.I)
_PRICE = re.compile(r"(?:\d[.,]\d|[$€£]|\d(?:AED|USD|DHS?))", re.I)
_NON_ITEM = re.compile(
    r"^(?:(?:grand\s+|sub\s*)?total\b|vat\b|tax\b|delivery\s+note\b|"
    r"invoice\b|date\b|page\b|received\s+by\b|signature\b|الإجمالي|المجموع|التاريخ)",
    re.I,
)
_HEADER_WORDS = frozenset(
    {
        "item",
        "description",
        "code",
        "qty",
        "quantity",
        "unit",
        "price",
        "amount",
        "no",
        "s",
        "n",
        "الكمية",
        "الصنف",
        "السعر",
    }
)


def normalize_item_text(text: str) -> str:
    """Case/punctuation/digit normalization shared by matching and alias writes."""
    text = unicodedata.normalize("NFKC", text).translate(_DIGITS).casefold()
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


@dataclass(frozen=True, slots=True)
class DeliveryNoteRow:
    item_text: str
    quantity: int | None


def parse_row(text: str) -> DeliveryNoteRow | None:
    """Extract an item description and first non-price integer after it.

    Pack sizes such as ``12x190g`` remain part of the description. A leading
    integer is a row number; currency-adjacent integers and decimal tokens are
    prices. With no defensible quantity, return null rather than guessing.
    """
    text = unicodedata.normalize("NFKC", text).translate(_DIGITS).strip()
    normalized = normalize_item_text(text)
    if not normalized or _NON_ITEM.match(text):
        return None
    if set(normalized.split()) <= _HEADER_WORDS:
        return None
    tokens = text.split()
    description: list[str] = []
    quantity: int | None = None
    for index, token in enumerate(tokens):
        clean = token.strip("|;:")
        previous = tokens[index - 1] if index else ""
        following = tokens[index + 1] if index + 1 < len(tokens) else ""
        if _CURRENCY.fullmatch(clean) or _PRICE.search(clean):
            continue
        if clean.isascii() and clean.isdigit():
            # Prefer a currency prefix when another number follows it:
            # "Water 12 AED 50" is quantity 12, price AED 50.
            after_currency = tokens[index + 2] if index + 2 < len(tokens) else ""
            currency_suffix = _CURRENCY.fullmatch(following) and not re.match(
                r"^\d", after_currency
            )
            if _CURRENCY.fullmatch(previous) or currency_suffix:
                continue
            if description and quantity is None:
                quantity = int(clean)
            continue
        if quantity is None:
            description.append(token)
    item_text = " ".join(description).strip()
    if not any(c.isalpha() for c in item_text):
        return None
    return DeliveryNoteRow(item_text=item_text, quantity=quantity)
