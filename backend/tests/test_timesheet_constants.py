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
    # Pinned whole: sampling indices lets an adjacent transposition through, and the
    # only symptom is a workbook titled with the wrong month.
    assert ARABIC_MONTHS == (
        "يناير",
        "فبراير",
        "مارس",
        "أبريل",
        "مايو",
        "يونيو",
        "يوليو",
        "أغسطس",
        "سبتمبر",
        "أكتوبر",
        "نوفمبر",
        "ديسمبر",
    )


def test_designation_seed_is_the_16_ranks_in_order():
    assert len(DESIGNATION_SEED) == 16
    assert [row[0] for row in DESIGNATION_SEED] == list(range(1, 17))
    assert DESIGNATION_SEED == (
        (1, "Prisons Director", "مدير عام الحراسات الأمنية", "main"),
        (2, "Ass. Director", "نائب عام مدير الحراسات الأمنية", "main"),
        (3, "Project Manager", "مديرمركز الإصلاح والتأهيل", "main"),
        (4, "Branche Manager", "مدير فرع", "main"),
        (5, "Duty In charge", "مناوب عام", "main"),
        (6, "Security Supervisor", "مشرف", "main"),
        (7, "Armory Officer", "مسؤول قطعة سلاح", "main"),
        (8, "assistant security supervisor", "مساعد مشرف", "main"),
        (9, "Armory Keeper", "خازن سلاح", "main"),
        (10, "Control room Security Guard", "حارس امن عرفة العمليات", "main"),
        (11, "Clinic Security Guard", "حارس امن حرس العيادة", "main"),
        (12, "Habilitation Security Guard", "حارس امن حرس التأهيل", "main"),
        (13, "Escort Security Guard", "حارس امن تنويم مستشفيات", "main"),
        (14, "Messengers", "حارس امن الارساليات", "main"),
        (15, "Security Guard", "حارس امن", "main"),
        (16, "Driver", "سائق", "drivers"),
    )
    assert {row[3] for row in DESIGNATION_SEED} == {"main", "drivers"}
