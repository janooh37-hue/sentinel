import pytest

from app.core.phone import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("0501234567", "+971501234567"),       # local mobile, leading 0
        ("971501234567", "+971501234567"),     # bare with CC
        ("+971 50 123 4567", "+971501234567"), # already E.164, spaces
        ("00971501234567", "+971501234567"),   # international 00 prefix
        ("050-123-4567", "+971501234567"),     # dashes
        ("501234567", "+971501234567"),        # local without leading 0
    ],
)
def test_normalizes_uae_numbers(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", "abc", "12", "n/a"])
def test_rejects_unusable(raw):
    assert normalize_phone(raw) is None


def test_rejects_short_local_part_with_country_code():
    # 5-digit local part after the 971 CC is too short → None, not "+97112345"
    assert normalize_phone("97112345") is None
