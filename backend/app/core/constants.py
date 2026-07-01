"""Cross-cutting constants ported from `gssg_manager.pyw` (v3.5.4) lines 196-409.

Anything that was a module-level literal in the .pyw lives here. Higher layers
import from this module instead of hard-coding strings — keeps the wire format
(category codes, form labels, status strings) byte-identical to v3 so the
migration in Phase 09 is a no-op.
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
    }
)


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
