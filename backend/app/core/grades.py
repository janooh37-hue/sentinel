"""Fixed record grades, distributions, urgencies and importance (ADRs 0007, 0008).

Grades are code constants: there is no table, setting, or management UI. The
``ck_books_grade`` constraint, the API literals, and the printed marks all
derive from this file.
"""

from __future__ import annotations

from typing import Final, NamedTuple, Protocol

from app.core.constants import CLASSIFIED_BOOK_FORMS


class Grade(NamedTuple):
    code: str
    label_en: str
    label_ar: str
    rank: int
    # Printed at the top of every page; None prints no mark.
    paper_mark: str | None


GRADES: Final[tuple[Grade, ...]] = (
    Grade("unclassified", "Unclassified", "غير سري", 0, None),
    Grade("secret", "Secret", "سري", 1, "سري"),
    Grade("top_secret", "Top Secret", "سري للغاية", 2, "سري للغاية"),
    Grade("addressee_only", "Addressee Only", "لعنايته فقط", 3, "سري للغاية — لعنايته فقط"),
)
GRADE_BY_CODE: Final[dict[str, Grade]] = {grade.code: grade for grade in GRADES}
GRADE_CODES: Final[tuple[str, ...]] = tuple(GRADE_BY_CODE)
GRADE_RANK: Final[dict[str, int]] = {grade.code: grade.rank for grade in GRADES}
UNCLASSIFIED: Final = "unclassified"
SECRET: Final = "secret"
TOP_SECRET: Final = "top_secret"
ADDRESSEE_ONLY: Final = "addressee_only"
# Open only to people named on the record; admins see list metadata only.
RESTRICTED_GRADES: Final[frozenset[str]] = frozenset({TOP_SECRET, ADDRESSEE_ONLY})

ORGANIZATION: Final = "organization"
NAMED: Final = "named"
DISTRIBUTIONS: Final[tuple[str, ...]] = (ORGANIZATION, NAMED)

URGENCIES: Final[tuple[str, ...]] = ("Normal", "High", "Very High")

# Ledger Book Importance (الأهمية, ADR 0008): a desk mark, never printed. None
# means no importance; every non-Ledger record stores None.
MEDIUM: Final = "medium"
HIGH: Final = "high"
IMPORTANCE_LEVELS: Final[tuple[str, ...]] = (MEDIUM, HIGH)
IMPORTANCE_LABEL_EN: Final[dict[str, str]] = {MEDIUM: "Medium", HIGH: "High"}
IMPORTANCE_LABEL_AR: Final[dict[str, str]] = {MEDIUM: "متوسطة", HIGH: "عالية"}


def paper_mark(grade: str) -> str | None:
    """The Arabic mark printed for ``grade``; None for Unclassified."""
    return GRADE_BY_CODE[grade].paper_mark


class Graded(Protocol):
    grade: str
    distribution: str


def is_open_record(record: Graded) -> bool:
    """Unclassified + organization: its subject may appear in notifications."""
    return record.grade == UNCLASSIFIED and record.distribution == ORGANIZATION


def default_distribution(template_id: str | None, grade: str) -> str:
    """A new record's distribution follows its form kind: General Books (and any
    Top Secret / Addressee Only record) are named; service forms are organization."""
    if grade in RESTRICTED_GRADES or template_id in CLASSIFIED_BOOK_FORMS:
        return NAMED
    return ORGANIZATION


def _check(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


GRADE_CHECK: Final = _check("grade", GRADE_CODES)
DISTRIBUTION_CHECK: Final = _check("distribution", DISTRIBUTIONS)
URGENCY_CHECK: Final = _check("urgency", URGENCIES)
IMPORTANCE_CHECK: Final = _check("importance", IMPORTANCE_LEVELS)
