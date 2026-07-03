"""Employee Clearance Form must expose manager + submitter pickers.

The pickers are wired end-to-end by field *type*: ApplicationPage extracts
manager_picker/submitter_picker into the payload, and document_service resolves
manager_id -> manager_name and submitter_id -> submitter_name. So exposing the
two fields in the schema is the whole change. Regression guard."""

from __future__ import annotations

from app.services import template_service


def _fields_by_type(template_id: str) -> dict[str, str]:
    detail = template_service.get_template_fields(template_id)
    return {f.type: f.key for f in detail.fields}


def test_clearance_has_manager_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("manager_picker") == "manager_id"


def test_clearance_has_submitter_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("submitter_picker") == "submitter_id"
