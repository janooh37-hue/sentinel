# backend/tests/test_passport_printed.py
from app.core.extraction.passport_printed import extract_printed_passport_no


def test_english_label():
    got = extract_printed_passport_no("Nationality: India\nPassport No: N1234567\nDOB: 1990")
    assert got is not None
    assert got[0] == "N1234567"


def test_english_label_hash_and_spacing():
    assert extract_printed_passport_no("Passport #  A9988776")[0] == "A9988776"


def test_arabic_label():
    got = extract_printed_passport_no("رقم الجواز : P7654321\nالجنسية: مصر")
    assert got is not None
    assert got[0] == "P7654321"


def test_no_label_returns_none():
    assert extract_printed_passport_no("just some text with 12345 and no label") is None


def test_requires_digit_rejects_words():
    # A labelled but all-alpha token is not a passport number.
    assert extract_printed_passport_no("Passport No: PENDING") is None
