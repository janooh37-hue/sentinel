"""Nationality registry behaviour for the inmate statistics register."""

import pytest

from app.core.constants import NATIONALITY_EN
from app.core.nationalities import (
    NATIONALITIES,
    NATIONALITY_CODE_STATELESS,
    NATIONALITY_CODE_UAE,
    NATIONALITY_CODE_UNSPECIFIED,
    Nationality,
    is_citizen,
    nationality_by_code,
    resolve_nationality,
)


@pytest.mark.parametrize(
    ("stored_label", "expected_code"),
    [
        ("الإ", "XX"),
        ("الإمارات ", "AE"),
        ("الامارات", "AE"),
        ("الامارات ", "AE"),
        ("الاردن ", "JO"),
        ("الهند", "IN"),
        ("اليمن", "YE"),
        ("اليمن ", "YE"),
        ("باكستان", "PK"),
        ("مصر", "EG"),
        ("نيبال", "NP"),
    ],
)
def test_live_census_spellings_resolve_without_guessing(stored_label, expected_code):
    resolved = resolve_nationality(stored_label)

    assert resolved is not None
    assert resolved.code == expected_code


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_blank_nationality_stays_absent(blank):
    assert resolve_nationality(blank) is None


def test_sentinel_and_citizen_semantics_are_distinct():
    stateless = resolve_nationality("بدون")
    unspecified = resolve_nationality("غير محدد")

    assert stateless == nationality_by_code(NATIONALITY_CODE_STATELESS)
    assert stateless is not None
    assert stateless.selectable is True
    assert not is_citizen(stateless.code)

    assert unspecified == nationality_by_code(NATIONALITY_CODE_UNSPECIFIED)
    assert unspecified is not None
    assert unspecified.selectable is False
    assert not is_citizen(unspecified.code)

    assert [
        nationality.label_ar for nationality in NATIONALITIES if is_citizen(nationality.code)
    ] == ["الإمارات"]


@pytest.mark.parametrize("nationality", NATIONALITIES)
def test_every_canonical_arabic_label_round_trips(nationality):
    assert resolve_nationality(nationality.label_ar) == nationality


def test_registry_keys_and_arabic_labels_are_unique():
    codes = [nationality.code for nationality in NATIONALITIES]
    labels_ar = [nationality.label_ar for nationality in NATIONALITIES]

    assert len(codes) == len(set(codes))
    assert len(labels_ar) == len(set(labels_ar))
    assert codes[:-2] == sorted(codes[:-2])


def test_registry_is_pinned_to_the_complete_iso_set_plus_two_sentinels():
    assert len(NATIONALITIES) == 251
    assert tuple(
        NATIONALITIES[index]
        for index in (0, 1, 64, 104, 112, 171, 176, 192, 232, 244, 248, 249, 250)
    ) == (
        Nationality("AD", "أندورا", "Andorra", True),
        Nationality("AE", "الإمارات", "United Arab Emirates", True),
        Nationality("EG", "مصر", "Egypt", True),
        Nationality("IN", "الهند", "India", True),
        Nationality("JO", "الأردن", "Jordan", True),
        Nationality("OM", "عُمان", "Oman", True),
        Nationality("PH", "الفلبين", "Philippines", True),
        Nationality("SA", "السعودية", "Saudi Arabia", True),
        Nationality("US", "الولايات المتحدة", "United States", True),
        Nationality("YE", "اليمن", "Yemen", True),
        Nationality("ZW", "زيمبابوي", "Zimbabwe", True),
        Nationality("XB", "بدون", "Stateless", True),
        Nationality("XX", "غير محدد", "Unspecified", False),
    )


@pytest.mark.parametrize(
    ("alias", "expected_code"),
    [
        ("أمريكا", "US"),
        ("سلطنة عمان", "OM"),
        ("سلطنة عُمان", "OM"),
        ("الفلبين", "PH"),
        ("فلبيني", "PH"),
        ("سريلانكا", "LK"),
        ("  سلطنة   عُمان  ", "OM"),
        ("\uff55\uff41\uff45", "AE"),
        ("باكـستان", "PK"),
    ],
)
def test_historical_aliases_and_normalized_variants_resolve(alias, expected_code):
    resolved = resolve_nationality(alias)

    assert resolved is not None
    assert resolved.code == expected_code


@pytest.mark.parametrize("stored_label", NATIONALITY_EN)
def test_every_timesheet_nationality_is_a_real_country(stored_label):
    resolved = resolve_nationality(stored_label)

    assert resolved is not None
    assert resolved.code not in {NATIONALITY_CODE_STATELESS, NATIONALITY_CODE_UNSPECIFIED}
    assert nationality_by_code(resolved.code) == resolved


def test_unknown_nonblank_text_uses_the_unselectable_sentinel():
    assert resolve_nationality("not a nationality") == nationality_by_code(
        NATIONALITY_CODE_UNSPECIFIED
    )
    assert nationality_by_code(NATIONALITY_CODE_UAE) == Nationality(
        "AE", "الإمارات", "United Arab Emirates", True
    )
