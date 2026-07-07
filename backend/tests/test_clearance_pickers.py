"""Employee Clearance Form must expose manager + submitter pickers.

The pickers are wired end-to-end by field *type*: ApplicationPage extracts
manager_picker/submitter_picker into the payload, and document_service resolves
manager_id -> manager_name and submitter_id -> submitter_name. So exposing the
two fields in the schema is the whole change. Regression guard."""

from __future__ import annotations

from app.services import template_service
from app.services.document_service import _submitter_signs_employee_cell


def _fields_by_type(template_id: str) -> dict[str, str]:
    detail = template_service.get_template_fields(template_id)
    return {f.type: f.key for f in detail.fields}


def test_clearance_has_manager_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("manager_picker") == "manager_id"


def test_clearance_has_submitter_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("submitter_picker") == "submitter_id"


# --- Submitter signs the employee cell ---------------------------------------
# The Clearance Form has no employee-signature checkbox in its schema, so the
# picked submitter must ALWAYS sign the employee cell (auto-embed). The sig is
# resolved from the submitter's linked-employee vault signature downstream.


def test_clearance_submitter_auto_signs_without_checkbox():
    # No embed_signature.employee flag (clearance has no such field) — still signs.
    assert _submitter_signs_employee_cell("Employee Clearance Form", 5, {})


def test_clearance_no_submitter_does_not_sign():
    assert not _submitter_signs_employee_cell("Employee Clearance Form", None, {})


def test_leave_form_still_requires_embed_checkbox():
    # Leave forms keep the opt-in checkbox gate — no swap without it.
    assert not _submitter_signs_employee_cell("Leave Application Form", 5, {})
    assert _submitter_signs_employee_cell("Leave Application Form", 5, {"employee": True})


def test_unrelated_form_never_swaps():
    assert not _submitter_signs_employee_cell("General Book", 5, {"employee": True})
