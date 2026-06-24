"""Form-submitter list helpers (v3.5.4 lines 7329-7423).

The "submitter" is the HR/admin person who hands the leave-application form
to the manager — not the leave applicant. v3 stores a list of submitters in
`app_settings['leave_submitters']` as ``{'g': 'G123', 'name': 'Name'}``
dicts. The Leave Application + Undertaking forms use the picked submitter
for the bottom signature block.

Public contract:

    label(record) -> str
        Display string for a record: ``"Name (G1234)"`` or ``""``.

    resolve(label, records) -> record | None
        Reverse lookup by display string. Returns ``None`` for the
        ``"(none …)"`` sentinel or any unmatched label.

    combo_values(records) -> list[str]
        Combobox values including the leading "(none)" sentinel.

    add(records, g, name) -> list[dict]
        Returns a new list with the record inserted at the top.
        Raises ``ValueError`` if `g` is blank or already present.

    remove(records, g) -> list[dict]
        Returns a new list with the matching record removed.

The G-number normalisation rule (strip, upper-case, prepend "G" if absent)
matches `Vault.normalize_g_number` — kept inline here to avoid coupling.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final, TypedDict

NONE_SENTINEL: Final[str] = "(none — لا أحد)"


class SubmitterRecord(TypedDict):
    g: str
    name: str


def normalize_g(g_number: str) -> str:
    """Strip, uppercase, prepend ``G`` if not already prefixed."""
    g = (g_number or "").strip().upper()
    if not g:
        raise ValueError("G-number must be non-empty")
    if not g.startswith("G"):
        g = "G" + g
    return g


def label(record: SubmitterRecord | None) -> str:
    """Display label for a submitter: ``"Name (G1234)"``."""
    if not record:
        return ""
    return f"{record.get('name', '')} ({record.get('g', '')})".strip()


def resolve(
    text: str | None,
    records: Sequence[SubmitterRecord],
) -> SubmitterRecord | None:
    """Find a record whose `label()` matches `text`, else ``None``.

    The "(none …)" sentinel always resolves to ``None`` — same as v3 line 7347.
    """
    if not text or text.startswith("(none"):
        return None
    for rec in records:
        if label(rec) == text:
            return rec
    return None


def combo_values(records: Sequence[SubmitterRecord]) -> list[str]:
    """Build the combobox value list, leading with the (none) sentinel."""
    return [NONE_SENTINEL, *(label(r) for r in records)]


def add(
    records: Sequence[SubmitterRecord],
    g: str,
    name: str,
) -> list[SubmitterRecord]:
    """Return a new list with a fresh record inserted at the head.

    Raises ``ValueError`` if `g` is blank or a record with that G already
    exists — v3 surfaces these as messageboxes; we let callers handle them.
    """
    norm = normalize_g(g)
    for r in records:
        if r.get("g") == norm:
            raise ValueError(f"Submitter {norm} is already in the list")
    new_record: SubmitterRecord = {"g": norm, "name": (name or "").strip()}
    return [new_record, *records]


def remove(
    records: Sequence[SubmitterRecord],
    g: str,
) -> list[SubmitterRecord]:
    """Return a new list without the record whose `g` matches (case-insensitive)."""
    norm = normalize_g(g)
    return [r for r in records if r.get("g") != norm]
