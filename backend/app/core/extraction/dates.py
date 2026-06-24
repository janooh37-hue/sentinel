from __future__ import annotations

from datetime import date

_DAY_FIRST_FORMATS = ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y")


def parse_date(text: str) -> date | None:
    """Day-first human date (UAE convention). Returns None if unparseable."""
    from datetime import datetime

    s = text.strip()
    for fmt in _DAY_FIRST_FORMATS:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# Fixed two-digit-year pivot for MRZ dates. A FIXED value (not a today()-relative
# one) keeps the same passport from flipping century as years pass. Years 00..40 →
# 2000s, 41..99 → 1900s. 40 comfortably covers near-future passport expiries while
# leaving 1941+ births in the 1900s; revisit only if passports start expiring >2040.
_MRZ_CENTURY_PIVOT = 40


def parse_mrz_date(yymmdd: str) -> date | None:
    """MRZ 6-digit YYMMDD. 2-digit year pivots: <=_MRZ_CENTURY_PIVOT → 2000s, else 1900s."""
    if len(yymmdd) != 6 or not yymmdd.isdigit():
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6])
    year = 2000 + yy if yy <= _MRZ_CENTURY_PIVOT else 1900 + yy
    try:
        return date(year, mm, dd)
    except ValueError:
        return None
