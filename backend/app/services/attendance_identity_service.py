"""Deterministic employee-code matching between a provider mirror and Sentinel.

Sentinel employees are keyed by their G number (``Employee.id``, e.g. ``G3082``).
The installed BioTime stores the same person under ``emp_code``, which on this
deployment is frequently the bare digits (``3082``) and sometimes carries the
letter prefix. Re-typing that correspondence by hand for hundreds of people is
both wasted work and a source of silent error, so it is derived here.

Two rules keep the derivation safe:

* **Codes only.** Display names are never compared. A near-identical Arabic or
  transliterated name is not evidence of identity, and the design forbids
  name-based automatic matching.
* **Ambiguity is never resolved by guessing.** A digits-only comparison can
  match more than one Sentinel employee (``G1234`` and ``A1234`` share ``1234``).
  That is reported as a conflict for a human to settle, never silently bound to
  whichever row the database happened to return first.

The caller decides what to persist. This module performs no writes and reads
only the employee table, so it is safe to call from import and from an operator
-triggered reconciliation alike.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Employee

MatchState = Literal["exact", "digits", "conflict", "none"]

_NON_ALNUM = re.compile(r"[^0-9A-Za-z]+")
_DIGITS = re.compile(r"\d+")


def canonical_code(value: str | None) -> str | None:
    """Fold a code to comparable form: uppercase, alphanumerics only.

    ``" g-1234 "`` and ``"G1234"`` are the same identifier written differently.
    """
    if value is None:
        return None
    folded = _NON_ALNUM.sub("", value).upper()
    return folded or None


def digit_key(value: str | None) -> str | None:
    """Return the significant digits of a code, ignoring prefix and zero padding.

    ``"G1234"``, ``"1234"`` and ``"01234"`` all reduce to ``"1234"``. Returns
    ``None`` for a code with no digits, which must never match by this rule.
    """
    if value is None:
        return None
    digits = "".join(_DIGITS.findall(value))
    if not digits:
        return None
    return digits.lstrip("0") or "0"


@dataclass(frozen=True, slots=True)
class EmployeeCodeIndex:
    """Precomputed lookup over Sentinel employees, built once per batch.

    Matching a page of provider people one query at a time is needless work;
    the employee table is small and stable for the duration of an import.
    """

    by_canonical: dict[str, list[str]] = field(default_factory=dict)
    by_digits: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def build(cls, db: Session, *, active_only: bool = False) -> EmployeeCodeIndex:
        """Index every employee id by its canonical and digits-only forms."""
        statement = select(Employee.id)
        if active_only:
            statement = statement.where(Employee.status == "Active")
        index = cls()
        for employee_id in db.scalars(statement):
            canonical = canonical_code(employee_id)
            if canonical is not None:
                index.by_canonical.setdefault(canonical, []).append(employee_id)
            digits = digit_key(employee_id)
            if digits is not None:
                index.by_digits.setdefault(digits, []).append(employee_id)
        return index


@dataclass(frozen=True, slots=True)
class IdentityMatch:
    """One resolution attempt, including why it did or did not settle."""

    state: MatchState
    employee_id: str | None = None
    candidates: tuple[str, ...] = ()

    @property
    def resolved(self) -> bool:
        """True only when exactly one Sentinel employee was identified."""
        return self.employee_id is not None


def match_employee_code(index: EmployeeCodeIndex, external_code: str | None) -> IdentityMatch:
    """Resolve one provider employee code against the Sentinel employee index.

    Precedence is exact-then-digits so a fully written code can never be
    outvoted by a padding-insensitive comparison.
    """
    canonical = canonical_code(external_code)
    if canonical is None:
        return IdentityMatch(state="none")

    exact = index.by_canonical.get(canonical, ())
    if len(exact) == 1:
        return IdentityMatch(state="exact", employee_id=exact[0], candidates=tuple(exact))
    if len(exact) > 1:
        # Duplicate employee ids cannot occur (primary key), so this is
        # unreachable in practice; treated as a conflict rather than asserted.
        return IdentityMatch(state="conflict", candidates=tuple(sorted(exact)))

    digits = digit_key(external_code)
    if digits is None:
        return IdentityMatch(state="none")

    by_digits = index.by_digits.get(digits, ())
    if len(by_digits) == 1:
        return IdentityMatch(state="digits", employee_id=by_digits[0], candidates=tuple(by_digits))
    if len(by_digits) > 1:
        return IdentityMatch(state="conflict", candidates=tuple(sorted(by_digits)))
    return IdentityMatch(state="none")


__all__ = [
    "EmployeeCodeIndex",
    "IdentityMatch",
    "MatchState",
    "canonical_code",
    "digit_key",
    "match_employee_code",
]
