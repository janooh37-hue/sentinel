"""The permission category for every record, independent of its reference prefix."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Final

from app.core.classifications import get_classification
from app.core.form_kind import OTHER_SERVICE_ID, SERVICE_IDS

SERVICE_RECORD_CATEGORY: Final[Mapping[str, str]] = MappingProxyType(
    {
        "Leave Application Form": "3/1",
        "Leave Permit Form": "3/1",
        "Administrative Leave Form": "3/1",
        "Duty Resumption Form": "3/1",
        "Salary Transfer Request": "7/1",
        "Salary Deduction Form": "7/1",
        "Salary Advance Request Form": "7/1",
        "Loan Request Form": "7/1",
        "Allowance Request Form": "7/1",
        "Employee Overtime Form": "7/1",
        "Expense Claim Form": "7/1",
        "Leave Encashment Form": "7/1",
        "Vehicle Fines": "7/1",
        "Passport Release Form": "8/1",
        "Passport Release List": "8/1",
        "HR Request Form": "8/1",
        "Acknowledgment Form": "9/1",
        "Material Request Form": "10/1",
        "Material Request Form (Arabic)": "10/1",
        "Vehicle Mileage Log": "11/1",
        "Vehicle Accident Report": "11/1",
        "Resignation Letter": "12/1",
        "Employee Clearance Form": "12/1",
        "Violation Form": "12/1",
        "Warning Form": "12/1",
        "Breach of Discipline Form": "12/1",
        "Promotion and Salary Increment Request Form": "12/1",
        "Employee Performance Appraisal Form": "12/1",
        "Manpower Requisition Form": "12/1",
        "Employment Application Form": "12/1",
        "Interview Assessment Form": "12/1",
        "Interview Scores Form": "12/1",
        "Employment Offer Letter": "12/1",
        "Employee Job Description": "12/1",
        "Employee Information Form": "12/1",
        "Employee Exit Form": "12/1",
        "Employee Exit Form – Project or Contract": "12/1",  # noqa: RUF001
        "Staff Attendance Form": "12/1",
        "Inmate Conduct Violations": "13/1",
        "Report": "13/1",
        "General Book": "15/1",
    }
)

LEGACY_CATEGORY_RECORD_CATEGORY: Final[Mapping[str, str]] = MappingProxyType(
    {
        "1": "12/1",
        "2": "10/1",
        "12": "15/1",
        "HR": "12/1",
        "GS": "15/1",
        "NAT": "12/1",
        "SC": "10/1",
        "INV": "13/1",
        "VF": "7/1",
        "VA": "11/1",
    }
)


def record_category(
    *, service_id: str, classification_code: str | None, category_id: str | None
) -> str:
    """Resolve the single category checked by record permission gates."""
    if classification_code is not None:
        return classification_code
    if service_id != OTHER_SERVICE_ID:
        return SERVICE_RECORD_CATEGORY[service_id]
    if category_id is not None and get_classification(category_id) is not None:
        return category_id
    return LEGACY_CATEGORY_RECORD_CATEGORY.get(category_id or "", "15/1")


def services_filing_into_legacy_category(category_id: str) -> tuple[str, ...]:
    """Services whose generated records retain this persisted legacy category."""
    # Document generation depends on record permissions; import only when needed.
    from app.services.document_service import record_category_for_template

    return tuple(
        service_id
        for service_id in SERVICE_IDS
        if record_category_for_template(service_id) == category_id
    )
