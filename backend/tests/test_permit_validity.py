from datetime import date

import pytest

from app.core.permit_validity import period_end, period_label


def test_period_end_is_inclusive() -> None:
    start = date(2026, 8, 6)
    assert period_end(start, 1, "day") == date(2026, 8, 6)
    assert period_end(start, 1, "week") == date(2026, 8, 12)
    assert period_end(start, 1, "month") == date(2026, 9, 5)
    assert period_end(start, 6, "month") == date(2027, 2, 5)
    assert period_end(start, 1, "year") == date(2027, 8, 5)


def test_period_labels_preserve_custom_unit() -> None:
    assert period_label(2, "month", "en") == "2 months"
    assert period_label(2, "month", "ar") == "شهران"


@pytest.mark.parametrize(
    ("value", "unit", "expected"),
    [
        (1, "day", "يوم واحد"),
        (2, "month", "شهران"),
        (3, "year", "3 سنوات"),
        (6, "month", "6 أشهر"),
        (11, "week", "11 أسبوعاً"),
        (100, "day", "100 يوم"),
        (103, "day", "103 أيام"),
        (100, "week", "100 أسبوع"),
        (103, "week", "103 أسابيع"),
        (100, "month", "100 شهر"),
        (103, "month", "103 أشهر"),
    ],
)
def test_arabic_period_labels_follow_cldr_categories(
    value: int,
    unit: str,
    expected: str,
) -> None:
    assert period_label(value, unit, "ar") == expected
