"""Column D prints English nationalities; the DB stores Arabic, with variants."""

import pytest

from app.core.constants import ARABIC_MONTHS, DESIGNATION_SEED, nationality_en


@pytest.mark.parametrize(
    ("arabic", "english"),
    [
        ("الإمارات", "U.A.E"),
        ("الامارات", "U.A.E"),  # variant spelling, 79 employees
        ("سلطنة عُمان", "Oman"),
        ("سلطنة عمان", "Oman"),
        ("عمان", "Oman"),
        ("نيبال", "Nepal"),
        ("السودان", "Sudan"),
        ("الأردن", "Jordan"),
        ("اليمن", "Yemen"),
        ("جزر القمر", "Comoros"),
        ("موريتانيا", "Mauritania"),
        ("مصر", "Egypt"),
        ("سوريا", "Syria"),
        ("المغرب", "Morocco"),
        ("الجزائر", "Algeria"),
    ],
)
def test_every_nationality_in_the_database_maps(arabic, english):
    assert nationality_en(arabic) == english


def test_surrounding_whitespace_is_tolerated():
    assert nationality_en("  الإمارات  ") == "U.A.E"


def test_an_unmapped_nationality_returns_none_so_preflight_can_block():
    assert nationality_en("فرنسا") is None
    assert nationality_en(None) is None


def test_arabic_months_are_twelve_and_ordered():
    assert len(ARABIC_MONTHS) == 12
    assert ARABIC_MONTHS[0] == "يناير"
    assert ARABIC_MONTHS[6] == "يوليو"
    assert ARABIC_MONTHS[11] == "ديسمبر"


def test_designation_seed_is_the_16_ranks_in_order():
    assert len(DESIGNATION_SEED) == 16
    assert [row[0] for row in DESIGNATION_SEED] == list(range(1, 17))
    assert DESIGNATION_SEED[0][1:] == (
        "Prisons Director",
        "مدير عام الحراسات الأمنية",
        "main",
    )
    assert DESIGNATION_SEED[-1][1:] == ("Driver", "سائق", "drivers")
    assert {row[3] for row in DESIGNATION_SEED} == {"main", "drivers"}
