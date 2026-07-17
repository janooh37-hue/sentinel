"""Government classification index (التبويب) for classified General Books."""

from typing import NamedTuple

STANDARD_TEMPLATE = "GSSG-GS_301-001_Classified_Standard.docx"


class Classification(NamedTuple):
    code: str
    tab: int
    name_ar: str
    name_en: str
    unit_ar: str
    template: str


_ADMIN = "الشؤون الإدارية والمالية"

CLASSIFICATIONS: tuple[Classification, ...] = (
    Classification(
        "1/1", 1, "الغيابات دون عذر رسمي", "Unexcused absences", _ADMIN, STANDARD_TEMPLATE
    ),
    Classification(
        "2/1",
        2,
        "محاضر الإجتماع وجدول الإجتماع الشهري",
        "Meeting minutes & monthly schedule",
        _ADMIN,
        STANDARD_TEMPLATE,
    ),
    Classification("3/1", 3, "الإجازات السنوية", "Annual leaves", _ADMIN, STANDARD_TEMPLATE),
    Classification("4/1", 4, "الإجازات المرضية", "Sick leaves", _ADMIN, STANDARD_TEMPLATE),
    Classification("5/1", 5, "التصاريح الأمنية", "Security permits", _ADMIN, STANDARD_TEMPLATE),
    Classification(
        "6/1",
        6,
        "الإحصائيات والتقارير الشهرية",
        "Statistics & monthly reports",
        _ADMIN,
        STANDARD_TEMPLATE,
    ),
    Classification(
        "7/1", 7, "الشؤون المالية بشكل عام", "Financial affairs", _ADMIN, STANDARD_TEMPLATE
    ),
    Classification(
        "8/1",
        8,
        "شهادات الرواتب وطلبات جواز السفر",
        "Salary certificates & passport requests",
        _ADMIN,
        STANDARD_TEMPLATE,
    ),
    Classification(
        "9/1",
        9,
        "العهدة والملابس والبطاقات التعريفية",
        "Custody, clothing & ID cards",
        _ADMIN,
        STANDARD_TEMPLATE,
    ),
    Classification(
        "10/1", 10, "جرد المواد الإستهلاكية", "Consumables inventory", _ADMIN, STANDARD_TEMPLATE
    ),
    Classification("11/1", 11, "أعمال الصيانة", "Maintenance works", "الصيانة", STANDARD_TEMPLATE),
    Classification("12/1", 12, "شؤون القوة", "Force affairs", _ADMIN, STANDARD_TEMPLATE),
    Classification(
        "13/1",
        13,
        "شؤون النزلاء والأمانات",
        "Inmates affairs & deposits",
        "شؤون النزلاء",
        STANDARD_TEMPLATE,
    ),
    Classification("14/1", 14, "العيادة", "Clinic", "شؤون النزلاء", STANDARD_TEMPLATE),
    Classification("15/1", 15, "( متنوعة )", "(Miscellaneous)", _ADMIN, STANDARD_TEMPLATE),
)

_BY_CODE = {c.code: c for c in CLASSIFICATIONS}


def get_classification(code: str) -> Classification | None:
    return _BY_CODE.get(code)


def classified_ref(tab: int, serial: int) -> str:
    return f"1/{tab}/GSSG/{serial}"
