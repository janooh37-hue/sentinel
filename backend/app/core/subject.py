"""Canonical email-subject normaliser — shared by ledger thread lookup and
smart-folder clustering.

A subject is normalised by repeatedly peeling a leading reply/forward prefix
(``Re:`` / ``Fwd:`` / ``Fw:`` / ``رد:`` / ``الرد:`` / ``توجيه:`` / ``إعادة:``),
collapsing internal whitespace, trimming, and case-folding (Latin only — Arabic
is caseless). Two subjects belonging to the same thread compare equal after
normalisation.

This is the **backend twin** of ``frontend/src/lib/normaliseSubject.ts``; the
two MUST behave identically (cross-tested with shared cases incl. the Arabic
``رد:``). The prefix set here is the union of both historical rule sets — keep
them in sync when either changes.

Pure, no I/O — unit-tested in ``backend/tests/unit/test_subject.py``.
"""

from __future__ import annotations

import re

# Matches ONE leading reply/forward prefix plus its colon and surrounding
# whitespace. Latin forms (``re``/``fwd``/``fw``) are ASCII-case-insensitive via
# the IGNORECASE flag; the Arabic forms (``رد``/``الرد``/``توجيه``/``إعادة``) are
# caseless. Applied repeatedly so "Re: Fwd: x" peels to "x".
_PREFIX_RE = re.compile(
    r"^\s*(?:re|fwd|fw|رد|الرد|توجيه|إعادة)\s*:\s*",
    flags=re.IGNORECASE,
)

_WHITESPACE_RE = re.compile(r"\s+")


def normalise_subject(subject: str | None) -> str:
    """Strip reply/forward prefixes, collapse whitespace, trim, case-fold.

    Returns ``""`` for ``None``/empty/prefix-only input.
    """
    s = subject or ""
    # Peel reply/forward prefixes repeatedly: "Re: رد: x" → "x".
    prev: str | None = None
    while s != prev:
        prev = s
        s = _PREFIX_RE.sub("", s, count=1)
    # Collapse internal whitespace, trim, then case-fold (Latin only — Arabic
    # has no case so it is left unchanged).
    return _WHITESPACE_RE.sub(" ", s).strip().casefold()


__all__ = ["normalise_subject"]
