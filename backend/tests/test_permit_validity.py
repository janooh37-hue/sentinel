from datetime import date

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
