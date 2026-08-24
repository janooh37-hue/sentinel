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


def test_designation_seed_is_the_16_stable_keys_in_order():
    assert len(DESIGNATION_SEED) == 16
    assert [row[1] for row in DESIGNATION_SEED] == list(range(1, 17))
    assert DESIGNATION_SEED == (
        ("prisons_director", 1, "Prisons Director", "مدير عام الحراسات الأمنية", "main"),
        ("assistant_director", 2, "Ass. Director", "نائب عام مدير الحراسات الأمنية", "main"),
        ("project_manager", 3, "Project Manager", "مديرمركز الإصلاح والتأهيل", "main"),
        ("branch_manager", 4, "Branche Manager", "مدير فرع", "main"),
        ("duty_in_charge", 5, "Duty In charge", "مناوب عام", "main"),
        ("security_supervisor", 6, "Security Supervisor", "مشرف", "main"),
        ("armory_officer", 7, "Armory Officer", "مسؤول قطعة سلاح", "main"),
        ("assistant_security_supervisor", 8, "assistant security supervisor", "مساعد مشرف", "main"),
        ("armory_keeper", 9, "Armory Keeper", "خازن سلاح", "main"),
        (
            "control_room_security_guard",
            10,
            "Control room Security Guard",
            "حارس امن عرفة العمليات",
            "main",
        ),
        ("clinic_security_guard", 11, "Clinic Security Guard", "حارس امن حرس العيادة", "main"),
        (
            "habilitation_security_guard",
            12,
            "Habilitation Security Guard",
            "حارس امن حرس التأهيل",
            "main",
        ),
        ("escort_security_guard", 13, "Escort Security Guard", "حارس امن تنويم مستشفيات", "main"),
        ("messengers", 14, "Messengers", "حارس امن الارساليات", "main"),
        ("security_guard", 15, "Security Guard", "حارس امن", "main"),
        ("driver", 16, "Driver", "سائق", "drivers"),
    )
    assert len({row[0] for row in DESIGNATION_SEED}) == 16
    assert {row[4] for row in DESIGNATION_SEED} == {"main", "drivers"}
