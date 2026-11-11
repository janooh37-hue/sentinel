"""Conservative delivery-note proposals: source numbers are never base stock units."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹\u066b\u066c", "01234567890123456789.,")
_NON_ITEM = re.compile(
    r"^(?:(?:grand\s+|sub\s*)?total\b|vat\b|tax\b|delivery\s+note\b|"
    r"invoice\b|date\b|page\b|received\s+by\b|signature\b|الإجمالي|المجموع|التاريخ)"
    r"|\b(?:trading\s+(?:llc|l\.l\.c)|شركة)\b",
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
        "total",
        "no",
        "s",
        "n",
        "الكمية",
        "الصنف",
        "السعر",
    }
)
_CARTON = r"(?:ctns?\.?|cartons?|كرتون|كراتين|كرتونة)"
_LOOSE = r"(?:loose(?:\s+(?:pieces?|pcs|units?))?|مفرد|مفردة|فرط|حبات?\s+مفردة)"
_PACK = r"(?:contains|pack(?:\s+size)?|pcs\s*/\s*(?:ctn|carton)|pieces\s+per\s+carton|محتويات|يحتوي|حبة\s*/\s*كرتون)"
_EXPIRY = re.compile(
    r"(?:expiry|expires?|exp\.?|best\s+before|انتهاء|الصلاحية)(?:\s+date)?\s*[:=]?\s*"
    r"(\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|\d{1,2}[-/]\d{4}|\d{1,2}[-/]\d{1,2}[-/]\d{4})",
    re.I,
)


def normalize_item_text(text: str) -> str:
    """Case/punctuation/digit normalization shared by matching and alias writes."""
    text = unicodedata.normalize("NFKC", text).translate(_DIGITS).casefold()
    return " ".join("".join(c if c.isalnum() else " " for c in text).split())


@dataclass(frozen=True, slots=True)
class DeliveryNoteRow:
    item_text: str
    cartons: int | None = None
    loose_quantity: int | None = None
    carton_contains_qty: int | None = None
    expiry: str | None = None


def _take_number(text: str, unit: str) -> tuple[int | None, str]:
    # Only explicit unit-labelled integers, never decimals, sizes or prices.
    pattern = re.compile(
        rf"(?<![\w.,])(?:(\d+)\s*{unit}\b(?!\s*[:=])|{unit}\s*[:=]?\s*(\d+)(?![\w.,]))",
        re.I,
    )
    match = pattern.search(text)
    if match is None:
        return None, text
    return int(match.group(1) or match.group(2)), text[: match.start()] + " " + text[match.end() :]


def _expiry(value: str) -> str | None:
    parts = [int(part) for part in re.split(r"[-/]", value)]
    try:
        if parts[0] >= 1000:
            year, month = parts[:2]
            day = parts[2] if len(parts) == 3 else None
        else:
            year = parts[-1]
            day, month = (parts[0], parts[1]) if len(parts) == 3 else (None, parts[0])
        date(year, month, day or 1)
        return f"{year:04d}-{month:02d}" + (f"-{day:02d}" if day else "")
    except ValueError:
        return None


def parse_row(text: str) -> DeliveryNoteRow | None:
    """Retain non-priced item rows too; ambiguous units stay blank for review."""
    text = unicodedata.normalize("NFKC", text).translate(_DIGITS).strip()
    normalized = normalize_item_text(text)
    words = [word for word in normalized.split() if not word.isdigit()]
    if not words or _NON_ITEM.search(text):
        return None
    if sum(word in _HEADER_WORDS for word in words) > len(words) / 2:
        return None
    expiry_match = _EXPIRY.search(text)
    expiry = _expiry(expiry_match.group(1)) if expiry_match else None
    if expiry_match:
        text = text[: expiry_match.start()] + " " + text[expiry_match.end() :]
    contains, text = _take_number(text, _PACK)
    # Common explicit '24 pcs/carton' notation.
    if contains is None:
        match = re.search(
            r"(?<![\w.,])(\d+)\s*(?:pcs|pieces|حبة)\s*/\s*(?:carton|ctn|كرتون)\b", text, re.I
        )
        if match:
            contains = int(match.group(1))
            text = text[: match.start()] + " " + text[match.end() :]
    cartons, text = _take_number(text, _CARTON)
    loose, text = _take_number(text, _LOOSE)
    # Remove price columns and bare numbers from the matching description, not
    # from raw_text (the caller retains the complete evidence and coordinates).
    text = re.split(
        r"\b(?:AED|USD|SAR|DHS?|price|amount|السعر)\b|[$€£]", text, maxsplit=1, flags=re.I
    )[0]
    tokens = text.split()
    description = " ".join(token for token in tokens if not re.fullmatch(r"[\d.,]+", token))
    description = description.strip(" |;:+-=\t")
    if not any(c.isalpha() for c in description):
        return None
    return DeliveryNoteRow(
        description, cartons, loose, contains if contains and contains >= 1 else None, expiry
    )
