"""Cross-cutting constants ported from `gssg_manager.pyw` (v3.5.4) lines 196-409.

Anything that was a module-level literal in the .pyw lives here. Higher layers
import from this module instead of hard-coding strings — keeps the wire format
(category codes, form labels, status strings) byte-identical to v3 so the
migration in Phase 09 is a no-op.

Trivial lookups over those literals live here too, beside the map they read
(`nationality_en`), rather than in a service of their own.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

# --- Reference-number categories (Books database) --------------------------

DEFAULT_CATEGORIES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "1": "Employee Staff - شؤون الموظفين",
        "2": "Logistics - اللوجستيك",
        "3": "Employee Fines - مخالفات الموظفين",
        "4": "Training - التدريب",
        "5": "Incidents - الحوادث",
        "6": "Equipment - المعدات",
        "7": "Client Comm - التواصل مع العملاء",
        "8": "Memos - المذكرات",
        "9": "Attendance - الحضور",
        "10": "Performance - الأداء",
        "11": "Contracts - العقود",
        "12": "Misc - متفرقات",
    }
)


# --- Form type → template DOCX filename ------------------------------------

TEMPLATE_FILES: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Acknowledgment Form": "GSSG-GS_300-003_Acknowledgment_Form_.docx",
        "Salary Transfer Request": "GSSG-HR_300-024_Salary_Transfer_Request_Form.docx",
        "Salary Deduction Form": "GSSG-HR_300-013_Salary_Deduction_Form_.docx",
        "Violation Form": "GSSG-NAT_300-004_Violation_Form.docx",
        "Employee Clearance Form": "GSSG-HR_300-009_Employee_Clearance_Form_.docx",
        "Leave Application Form": "GSSG-HR_300-003_Leave_Application_Form.docx",
        "Passport Release Form": "GSSG-HR_300-004_Passport_Release_Form.docx",
        "Duty Resumption Form": "GSSG-HR_300-016_Duty_Resumption_Form.docx",
        "Material Request Form": "GSSG-NAT_300-004_Material_Request_Form__MRF__.docx",
        "General Book": "GSSG-GS_300-003_General_Book.docx",
        # The security-permit letter (classification 5/1) is a General Book on
        # its OWN paper: same tokens, same header/footer structure, separate
        # file so edits to the permit form never touch every other 1/x letter.
        # Rendered by permit_service, never authored by hand — form_kind
        # .SERVICE_ALIASES keeps it out of the Services gallery and files its
        # books under the General Book rail.
        "Security Permit": "GSSG-GS_300-003_Security_Permit.docx",
        "HR Request Form": "GSSG-HR 300-014_HR Request Form.docx",
        "Resignation Declaration": "GSSG-HR_300-010_Employee_Resignation_Form_.docx",
        "Resignation Letter": "GSSG-HR_301-010_Employee_Resignation_Form_.docx",
        "Leave Undertaking": "GSSG-HR_301-003_Leave_Application_Form.docx",
        "Leave Permit Form": "GSSG-HR_301-004_Leave_permit_Form.docx",
        "Administrative Leave Form": "GSSG-HR_301-005_Administrative_leave_Form.docx",
        "Warning Form": "GSSG-NAT_301-004_Warning_Form.docx",
        # Key "Passport Release List" DISPLAYS as "Passport Release" (multi-employee
        # landscape list). The single-employee custody form keeps key
        # "Passport Release Form" but now displays as "Passport Request".
        "Passport Release List": "GSSG-HR_300-004b_Passport_Release_List.docx",
        "Report": "GSSG-GS_300-004_Report.docx",
        "Inmate Conduct Violations": "GSSG-NAT_300-005_Inmate_Conduct_Violations.docx",
    }
)

# --- The classified Arabic letter papers -----------------------------------

#: Template ids that render the classified Arabic letter. They share one whole
#: pipeline: the ref is allocated from the classified register
#: (``1/{tab}/GSSG/{serial}``) and printed into the body's «الرقم:» line instead
#: of the English header stamp, the entire body is rendered from HTML by
#: ``docx_engine._pp_general_book``, ``footer2`` is synced from ``footer3`` so
#: page 2+ keeps the letterhead, and the signature block prefers the manager's
#: Arabic name.
#:
#: ``Security Permit`` is the 1/5 permit letter: the same paper on its own
#: ``.docx`` above, so the permit form can be edited without touching every
#: other 1/x letter.
#:
#: Callers MUST test membership here, never equality with a single id. A miss
#: is silent — it yields a plausible-looking letter with a legacy ``HR-####``
#: ref, a plain-text body, no page-2 footer and a stray English ref stamp
#: painted over the Arabic paper.
CLASSIFIED_BOOK_FORMS: Final[frozenset[str]] = frozenset({"General Book", "Security Permit"})


# --- Project / company strings ---------------------------------------------

PROJECT_LOCATION: Final[str] = "0331"
COMPANY_NAME: Final[str] = "GLOBAL SECURITY SERVICES GROUP"
WEBSITE: Final[str] = "www.gss-group.net"


# --- Arabic weekday names (Monday-first, matches `datetime.weekday()`) ------

ARABIC_WEEKDAYS: Final[tuple[str, ...]] = (
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
    "الأحد",
)


# --- Manager defaults (General Book signature block) -----------------------

DEFAULT_MANAGER_NAME: Final[str] = "سعيد راشد اليحيائي"
DEFAULT_MANAGER_TITLE: Final[str] = "مدير مشروع مركز الإصلاح والتأهيل – الوثبة 2"  # noqa: RUF001


# --- Reference-number stamp styles -----------------------------------------

STAMP_STYLE_HEADER: Final[str] = "Header Text (Ref: XX-0000)"
STAMP_STYLE_TOP_RIGHT: Final[str] = "Bold Top-Right Corner"
STAMP_STYLE_WATERMARK: Final[str] = "Watermark Style"
STAMP_STYLES: Final[tuple[str, ...]] = (
    STAMP_STYLE_HEADER,
    STAMP_STYLE_TOP_RIGHT,
    STAMP_STYLE_WATERMARK,
)


# --- Employee lifecycle status ---------------------------------------------

EMPLOYEE_STATUS_ACTIVE: Final[str] = "Active - نشط"
EMPLOYEE_STATUS_RESIGNED: Final[str] = "Resigned - مستقيل"
EMPLOYEE_STATUS_TERMINATED: Final[str] = "Terminated - مفصول"
EMPLOYEE_STATUS_LIST: Final[tuple[str, ...]] = (
    EMPLOYEE_STATUS_ACTIVE,
    EMPLOYEE_STATUS_RESIGNED,
    EMPLOYEE_STATUS_TERMINATED,
)


# --- Per-employee document categories --------------------------------------

DOC_CATEGORY_UAE_ID: Final[str] = "uae_id"
DOC_CATEGORY_PASSPORT: Final[str] = "passport"
DOC_CATEGORY_OTHER: Final[str] = "other"
DOC_CATEGORIES: Final[tuple[tuple[str, str], ...]] = (
    (DOC_CATEGORY_UAE_ID, "UAE ID - الهوية الإماراتية"),
    (DOC_CATEGORY_PASSPORT, "Passport - جواز السفر"),
    (DOC_CATEGORY_OTHER, "Other Documents - مستندات أخرى"),
)
ALLOWED_DOC_EXTS: Final[frozenset[str]] = frozenset({".pdf", ".png", ".jpg", ".jpeg"})


# --- Form-type → per-employee subfolder mapping -----------------------------
# Personnel-Affairs forms land under data/employee_files/<G>/<sub>/. Admin-
# Affairs forms (and General Book) still write to OUTPUT_DIR via the document
# service; this map only governs Personnel.

FORM_TYPE_SUBFOLDER: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Leave Application Form": "leaves",
        "Passport Release Form": "passport_release",
        "Duty Resumption Form": "duty_resumption",
        "Resignation Form": "resignations",
        "Violation Form": "violations",
        "Acknowledgment Form": "acknowledgment",
        "Salary Transfer Request": "salary_transfer",
        "Salary Deduction Form": "salary_deduction",
        "Employee Clearance Form": "clearance",
        "HR Request Form": "hr_requests",
        "Leave Permit Form": "leave_permit",
        "Administrative Leave Form": "admin_leave",
        "Warning Form": "warnings",
    }
)


# --- Companion-form pairings -----------------------------------------------
# Some forms generate paired DOCXs in the same folder (e.g. leave application
# + undertaking). The companion locator walks both directions.

COMPANION_FORM_PAIRS: Final[Mapping[str, str]] = MappingProxyType(
    {
        "LeaveApp_": "LeaveUndertaking_",
        "ResignationLetter_": "ResignationDecl_",
    }
)

# --- Companion template ids (never shown as standalone services) -----------
# These forms auto-generate alongside their primary (see
# document_service._COMPANION_RULES). They must never appear as their own
# gallery tile or quick-action, so `list_templates()` filters them out.
COMPANION_TEMPLATE_IDS: Final[frozenset[str]] = frozenset(
    {"Leave Undertaking", "Resignation Declaration"}
)


# --- Violation numbering (maps to the printed GSSG-NAT 300-004 form rows) ---
# Section headers occupy template rows 6 (Grooming), 15 (PSFRD Requirements) and
# 20 (Conduct); the markable data rows are 7-14, 16-19, 21-28. Names mirror the
# printed labels so a ticked row matches its on-form description (the v4 UI
# `ViolationCheckboxesField` carries the same list).

VIOLATION_NAMES: Final[Mapping[int, str]] = MappingProxyType(
    {
        # Grooming
        7: "Failing to shave",
        8: "Improper Hair Cut",
        9: "Inadequate Personal Hygiene",
        10: "Improper Uniform / Improper Socks",
        11: "Unkempt or Dirty Uniform",
        12: "Not wearing beret / cap on duty",
        13: "Loss / damage of Equipment",
        14: "Improper footwear",
        # PSFRD Requirements
        16: "Fail to have or display PSFRD License",
        17: "Fail to Report Incident / Accident",
        18: "Fail to have / display Company ID",
        19: "No Note Books / Fail to record in NB",
        # Conduct
        21: "Sleeping on Duty",
        22: "Failing to perform duty",
        23: "Theft Act",
        24: "Insubordination",
        25: "Reporting under Alcohol (site / Accommodation)",
        26: "Having alcohol (duty / Accommodation)",
        27: "Failing to report misconduct by another",
        28: "Contract Breaching",
    }
)

VIOLATION_STATUS_OPEN: Final[str] = "Open - مفتوح"
VIOLATION_STATUS_CLOSED: Final[str] = "Closed - مغلق"
VIOLATION_STATUS_LIST: Final[tuple[str, ...]] = (
    VIOLATION_STATUS_OPEN,
    VIOLATION_STATUS_CLOSED,
)


# --- Admin-Affairs form labels (used by the form-picker UI) -----------------

ADMIN_TYPES: Final[tuple[str, ...]] = (
    "Acknowledgment Form - استلام المواد",
    "Material Request Form - طلب مواد",
    "Leave Permit Form - تصريح خروج",
    "Administrative Leave Form - طلب إجازة إدارية",
    "General Book - كتاب عام",
)


#: The two monthly time-sheet workbooks. Drivers have always been reported
#: separately from the main guard sheet.
TIMESHEET_MAIN: Final[str] = "main"
TIMESHEET_DRIVERS: Final[str] = "drivers"
TIMESHEET_SHEETS: Final[tuple[str, str]] = (TIMESHEET_MAIN, TIMESHEET_DRIVERS)


# --- Time-sheet display values ---------------------------------------------

#: Arabic nationality → the English label column D of the time sheet prints.
#: Variant spellings are all present in the live data (both `الإمارات` and
#: `الامارات`; three spellings of Oman) so they are all mapped rather than
#: normalised away.
NATIONALITY_EN: Final[Mapping[str, str]] = MappingProxyType(
    {
        "الإمارات": "U.A.E",
        "الامارات": "U.A.E",
        "سلطنة عُمان": "Oman",
        "سلطنة عمان": "Oman",
        "عمان": "Oman",
        "نيبال": "Nepal",
        "السودان": "Sudan",
        "الأردن": "Jordan",
        "اليمن": "Yemen",
        "جزر القمر": "Comoros",
        "موريتانيا": "Mauritania",
        "مصر": "Egypt",
        "سوريا": "Syria",
        "المغرب": "Morocco",
        "الجزائر": "Algeria",
    }
)


def nationality_en(value: str | None) -> str | None:
    """English nationality label, or ``None`` when unmapped (preflight blocks)."""

    if not value:
        return None
    return NATIONALITY_EN.get(value.strip())


#: Gregorian month names in Arabic (UAE-standard transliterations), January at
#: index 0. The one table for every Arabic month label in the app: time-sheet
#: titles, notification text, digests.
ARABIC_MONTHS: Final[tuple[str, ...]] = (
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

#: The printable time-sheet designations:
#: (system_key, rank_order, name_en, name_ar, sheet).
#: Ranks 1-8 are the order the client already accepted; 9-15 group the guard tier
#: by post. Reference data, so ``timesheet_service.seed_designations`` can insert
#: it at startup and in tests — the suite builds schema from ``metadata.create_all``
#: and never runs the migration that first inserted these rows.
DESIGNATION_SEED: Final[tuple[tuple[str, int, str, str, str], ...]] = (
    ("prisons_director", 1, "Prisons Director", "مدير عام الحراسات الأمنية", "main"),
    ("assistant_director", 2, "Ass. Director", "نائب عام مدير الحراسات الأمنية", "main"),
    ("project_manager", 3, "Project Manager", "مديرمركز الإصلاح والتأهيل", "main"),
    ("branch_manager", 4, "Branche Manager", "مدير فرع", "main"),
    ("duty_in_charge", 5, "Duty In charge", "مناوب عام", "main"),
    ("security_supervisor", 6, "Security Supervisor", "مشرف", "main"),
    ("armory_officer", 7, "Armory Officer", "مسؤول قطعة سلاح", "main"),
    ("assistant_security_supervisor", 8, "assistant security supervisor", "مساعد مشرف", "main"),
    ("armory_keeper", 9, "Armory Keeper", "خازن سلاح", "main"),
    ("control_room_security_guard", 10, "Control room Security Guard", "حارس امن عرفة العمليات", "main"),
    ("clinic_security_guard", 11, "Clinic Security Guard", "حارس امن حرس العيادة", "main"),
    ("habilitation_security_guard", 12, "Habilitation Security Guard", "حارس امن حرس التأهيل", "main"),
    ("escort_security_guard", 13, "Escort Security Guard", "حارس امن تنويم مستشفيات", "main"),
    ("messengers", 14, "Messengers", "حارس امن الارساليات", "main"),
    ("security_guard", 15, "Security Guard", "حارس امن", "main"),
    ("driver", 16, "Driver", "سائق", "drivers"),
)
