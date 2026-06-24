"""Pydantic schemas for POST /api/v1/intake.

``IntakeResponse`` is a discriminated union on ``mode``:
- ``"returned_form"`` → ``ReturnedFormOut``
- ``"external"``      → ``ExternalOut``
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.schemas.extraction import ExtractedFieldOut

# ---------------------------------------------------------------------------
# Route mapper: document_type → (route_kind, form_slug)
# ---------------------------------------------------------------------------

# Form slugs MUST match the frontend `slugifyTemplate` output (underscores, the
# trailing "form" dropped) so `?form=<slug>` resolves via `resolveTemplateIdFromSlug`.
_ROUTE_MAP: dict[str, tuple[str, str | None]] = {
    "emirates_id": ("employee", None),
    "passport": ("employee", None),
    "bank_iban": ("salary_transfer", "salary_transfer_request"),
    "sick_leave": ("leave", "leave_application"),
}


def route_for_doc_type(doc_type: str) -> tuple[str, str | None]:
    """Map a pipeline ``doc_type`` string to ``(route_kind, form_slug)``."""
    return _ROUTE_MAP.get(doc_type, ("manual", None))


# ---------------------------------------------------------------------------
# Returned-form variant
# ---------------------------------------------------------------------------


class ReturnedFormOut(BaseModel):
    mode: Literal["returned_form"] = "returned_form"
    book_id: int
    ref_number: str
    approval_state: str = "none"
    category: str | None = None
    subject: str | None = None
    employee_id: str | None = None
    employee_name: str | None = None


# ---------------------------------------------------------------------------
# External-document variant
# ---------------------------------------------------------------------------


class ExternalOut(BaseModel):
    mode: Literal["external"] = "external"
    document_type: str
    document_type_confidence: float
    alternatives: list[str] = []
    extraction: list[ExtractedFieldOut] = []
    matched_employee_id: str | None = None
    match_score: float = 0.0
    matched_employee_name_en: str | None = None
    matched_employee_name_ar: str | None = None
    route_kind: Literal["employee", "salary_transfer", "leave", "manual"]
    route_form_slug: str | None = None


# ---------------------------------------------------------------------------
# Discriminated union
# ---------------------------------------------------------------------------

IntakeResponse = Annotated[
    ReturnedFormOut | ExternalOut,
    Field(discriminator="mode"),
]


__all__ = [
    "ExternalOut",
    "IntakeResponse",
    "ReturnedFormOut",
    "route_for_doc_type",
]
