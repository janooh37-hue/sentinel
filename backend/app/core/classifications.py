"""Government classification index (التبويب) for General Books.

Every General Book — rich-editor or Word-authored — files under one of these
codes and takes its ref from the shared classified register
(``1/{tab}/GSSG/{serial}``). Rendering always uses the single General Book
template (``core.constants.TEMPLATE_FILES["General Book"]``); the registry
carries no per-classification layout.
"""

from typing import NamedTuple


class Classification(NamedTuple):
    code: str
    tab: int
    name_ar: str
    name_en: str
    unit_ar: str


_ADMIN = "الشؤون الإدارية والمالية"

CLASSIFICATIONS: tuple[Classification, ...] = (
    Classification("1/1", 1, "الغيابات دون عذر رسمي", "Unexcused absences", _ADMIN),
    Classification(
        "2/1",
        2,
        "محاضر الإجتماع وجدول الإجتماع الشهري",
        "Meeting minutes & monthly schedule",
        _ADMIN,
    ),
    Classification("3/1", 3, "الإجازات السنوية", "Annual leaves", _ADMIN),
    Classification("4/1", 4, "الإجازات المرضية", "Sick leaves", _ADMIN),
    Classification("5/1", 5, "التصاريح الأمنية", "Security permits", _ADMIN),
    Classification(
        "6/1",
        6,
        "الإحصائيات والتقارير الشهرية",
        "Statistics & monthly reports",
        _ADMIN,
    ),
    Classification("7/1", 7, "الشؤون المالية بشكل عام", "Financial affairs", _ADMIN),
    Classification(
        "8/1",
        8,
        "شهادات الرواتب وطلبات جواز السفر",
        "Salary certificates & passport requests",
        _ADMIN,
    ),
    Classification(
        "9/1",
        9,
        "العهدة والملابس والبطاقات التعريفية",
        "Custody, clothing & ID cards",
        _ADMIN,
    ),
    Classification("10/1", 10, "جرد المواد الإستهلاكية", "Consumables inventory", _ADMIN),
    Classification("11/1", 11, "أعمال الصيانة", "Maintenance works", "الصيانة"),
    Classification("12/1", 12, "شؤون القوة", "Force affairs", _ADMIN),
    Classification(
        "13/1", 13, "شؤون النزلاء والأمانات", "Inmates affairs & deposits", "شؤون النزلاء"
    ),
    Classification("14/1", 14, "العيادة", "Clinic", "شؤون النزلاء"),
    Classification("15/1", 15, "( متنوعة )", "(Miscellaneous)", _ADMIN),
)

_BY_CODE = {c.code: c for c in CLASSIFICATIONS}


def get_classification(code: str) -> Classification | None:
    return _BY_CODE.get(code)


def classified_ref(tab: int, serial: int) -> str:
    return f"1/{tab}/GSSG/{serial}"
