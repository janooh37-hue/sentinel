"""The permission category for every record, independent of its reference prefix."""

from __future__ import annotations

from collections.abc import Mapping
from functools import cache
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


def service_filing_category(service_id: str) -> str:
    """The legacy category a generated record of ``service_id`` is stored under."""
    return _service_filing_categories()[service_id]


@cache
def _service_filing_categories() -> Mapping[str, str]:
    # Document generation depends on record permissions; import only when needed.
    from app.services.document_service import record_category_for_template

    return MappingProxyType(
        {service_id: record_category_for_template(service_id) for service_id in SERVICE_IDS}
    )


def is_stray_record(*, service_id: str, category_id: str | None) -> bool:
    """Whether a record is stored in a legacy category its service never files into.

    A form revised into a General Book keeps its HR or INV category; hand-filed
    and imported records can sit anywhere. Such a record answers to two
    services and two categories (``record_services``, ``record_gate_categories``).
    """
    return (
        service_id != OTHER_SERVICE_ID
        and category_id is not None
        and get_classification(category_id) is None
        and category_id != service_filing_category(service_id)
    )


def record_services(*, service_id: str, category_id: str | None) -> tuple[str, ...]:
    """Every service whose ``books.servicerecords.*`` gate must allow the record.

    A stray record also answers to Other, so a deny on a legacy category,
    migrated to its filing services plus Other, still hides the records filed
    there by hand, without hiding the stray record's whole service from anyone.
    """
    if is_stray_record(service_id=service_id, category_id=category_id):
        return (service_id, OTHER_SERVICE_ID)
    return (service_id,)


def record_category(
    *, service_id: str, classification_code: str | None, category_id: str | None
) -> str:
    """The one record category a record is listed under."""
    if classification_code is not None:
        return classification_code
    if service_id != OTHER_SERVICE_ID:
        return SERVICE_RECORD_CATEGORY[service_id]
    if category_id is not None and get_classification(category_id) is not None:
        return category_id
    return LEGACY_CATEGORY_RECORD_CATEGORY.get(category_id or "", "15/1")


def record_gate_categories(
    *, service_id: str, classification_code: str | None, category_id: str | None
) -> tuple[str, ...]:
    """Every record category whose ``books.category.*`` gate must allow the record.

    Its listed category, plus, for a stray record, the category its stored
    legacy category maps to, so a deny on an old-only category still hides it.
    """
    listed = record_category(
        service_id=service_id, classification_code=classification_code, category_id=category_id
    )
    if not is_stray_record(service_id=service_id, category_id=category_id):
        return (listed,)
    stored = LEGACY_CATEGORY_RECORD_CATEGORY.get(category_id or "", "15/1")
    return (listed,) if stored == listed else (listed, stored)


def services_filing_into_legacy_category(category_id: str) -> tuple[str, ...]:
    """Services whose generated records retain this persisted legacy category."""
    return tuple(
        service_id
        for service_id in SERVICE_IDS
        if service_filing_category(service_id) == category_id
    )
