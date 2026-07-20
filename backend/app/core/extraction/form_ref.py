"""Extract candidate GSSG form ref-numbers from OCR text.

Priority: ``Ref:``-anchored hits (stamped by ``docx_engine.stamp_ref_number``)
are returned first; bare occurrences are appended as lower-confidence fallbacks.
Results are ordered-unique so the caller can iterate in confidence order.
"""

from __future__ import annotations

import re

# Matches the explicit ``Ref: GS-0048`` stamp written into the document header.
# Book ref_number is ``{category_id}-{NNNN}`` where the category id is a short
# alpha/alphanumeric code (e.g. GS, HR, 9), so the prefix is ``[A-Z0-9]{1,5}``.
# The alternation also admits the classified General Book register shape
# ``1/{tab}/GSSG/{serial}`` (e.g. ``1/5/GSSG/141``) or new form ``1/{tab}/{serial}``
# (e.g. ``1/5/141``).

# Two distinct patterns for the classified General Book ref shape.
# _CLASSIFIED_STAMPED: GSSG optional — used ONLY inside _STAMPED_RE where the
#   Ref:/الرقم: anchor disambiguates from OCR slash-dates.
# _CLASSIFIED_BARE: GSSG required — used in the anchor-less _BARE_RE so only
#   legacy refs match without an anchor; new refs need the anchor.
_CLASSIFIED_STAMPED = r"1/\d{1,2}/(?:GSSG/)?\d{1,6}(?!\d)"
_CLASSIFIED_BARE = r"1/\d{1,2}/GSSG/\d{1,6}"

_STAMPED_RE = re.compile(
    rf"(?:Ref:|الرقم\s*[:：]?)\s*([A-Z0-9]{{1,5}}-\d{{3,5}}|{_CLASSIFIED_STAMPED})",  # noqa: RUF001
    re.IGNORECASE,
)

# Bare fallback — wider; GSSG stays required to prevent slash-date false matches.
_BARE_RE = re.compile(rf"\b([A-Z0-9]{{1,5}}-\d{{3,5}}|{_CLASSIFIED_BARE})\b", re.IGNORECASE)

# Loose ``Ref:``-anchored token — admits malformed OCR reads the strict pattern
# rejects (e.g. ``50-@315``, ``56-5``).  Input for confusion-aware fuzzy match.
_STAMPED_LOOSE_RE = re.compile(r"Ref:\s*([A-Z0-9@]{1,5}-[A-Z0-9@]{1,5})", re.IGNORECASE)

# OCR confusion table: letters that Tesseract renders as digit lookalikes (and
# the @ misread of 0). Canonicalising BOTH sides lets "SC-0315" equal "50-0315".
_CONFUSION = str.maketrans(
    {
        "O": "0",
        "Q": "0",
        "D": "0",
        "C": "0",
        "S": "5",
        "G": "6",
        "B": "8",
        "I": "1",
        "L": "1",
        "Z": "2",
        "@": "0",
    }
)


def candidate_refs(text: str) -> list[str]:
    """Return candidate ref strings from *text*, stamped hits first.

    Stamped hits (``Ref: <ref>``) are trustworthy; bare hits are fallbacks and
    may overlap with dates / phone-number fragments.  The caller should try them
    in order and stop at the first DB match.

    Returns an ordered-unique list: stamped first, then any additional bare
    occurrences not already found via the stamp pattern.
    """
    # Ref numbers are stored uppercase ("GS-0048"); normalise so a lowercase OCR
    # read still matches the DB. Dedup preserves stamped-first ordering.
    stamped = [m.upper() for m in _STAMPED_RE.findall(text)]
    bare = [m.upper() for m in _BARE_RE.findall(text)]

    seen: set[str] = set()
    result: list[str] = []
    for ref in stamped + bare:
        if ref not in seen:
            seen.add(ref)
            result.append(ref)
    return result


def canonical_ref(ref: str) -> str:
    """Map *ref* to its OCR-confusion canonical form (uppercase, lookalikes → digits)."""
    return ref.upper().translate(_CONFUSION)


def stamped_tokens(text: str) -> list[str]:
    """Raw ``Ref:``-anchored tokens, including malformed ones the strict
    pattern rejects (e.g. ``50-@315``) — input for fuzzy matching."""
    return [m.upper() for m in _STAMPED_LOOSE_RE.findall(text)]


__all__ = ["candidate_refs", "canonical_ref", "stamped_tokens"]
