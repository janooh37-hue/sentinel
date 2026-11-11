"""Employee Clearance Form must expose manager + submitter pickers.

The pickers are wired end-to-end by field *type*: ApplicationPage extracts
manager_picker/submitter_picker into the payload, and document_service resolves
manager_id -> manager_name and submitter_id -> submitter_name. So exposing the
two fields in the schema is the whole change. Regression guard."""

from __future__ import annotations

import pytest

from app.services import template_service
from app.services.document_service import (
    _replayed_submitter_signs,
    _submitter_signs_employee_cell,
)


def _fields_by_type(template_id: str) -> dict[str, str]:
    detail = template_service.get_template_fields(template_id)
    return {f.type: f.key for f in detail.fields}


def test_clearance_has_manager_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("manager_picker") == "manager_id"


def test_clearance_has_submitter_picker():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("submitter_picker") == "submitter_id"


def test_clearance_offers_the_employee_signature():
    by_type = _fields_by_type("Employee Clearance Form")
    assert by_type.get("hand_sign_checkbox") == "hand_sign_employee"
    assert by_type.get("signature") == "employee_sig_path"


# --- Submitter signs the employee cell ---------------------------------------
# The submitter is optional on every form with a Submitter box: picked, their
# signature fills the employee cell; empty, the employee's own signature does.

SUBMITTER_FORMS = [
    "Leave Application Form",
    "Duty Resumption Form",
    "Employee Clearance Form",
    "Leave Undertaking",
    "Employee Performance Appraisal Form",
    "Leave Encashment Form",
    "Loan Request Form",
    "Salary Advance Request Form",
    "Breach of Discipline Form",
    "Expense Claim Form",
    "Employee Exit Form",
    "Employee Exit Form – Project or Contract",  # noqa: RUF001 - the real template id
]


@pytest.mark.parametrize("template_id", SUBMITTER_FORMS)
def test_picked_submitter_signs_without_employee_opt_in(template_id):
    assert _submitter_signs_employee_cell(template_id, 5)
    assert not _submitter_signs_employee_cell(template_id, None)


def test_form_without_submitter_box_never_swaps():
    assert not _submitter_signs_employee_cell("General Book", 5)


@pytest.mark.parametrize(
    ("template_id", "employee_embed", "expected"),
    [
        ("Employee Clearance Form", False, True),
        ("Leave Application Form", True, True),
        ("Leave Application Form", False, False),
        ("Loan Request Form", True, False),
    ],
)
def test_snapshot_without_flag_replays_the_rules_it_was_rendered_under(
    template_id, employee_embed, expected
):
    assert _replayed_submitter_signs(template_id, {}, 5, {"employee": employee_embed}) is expected


@pytest.mark.parametrize("recorded", [True, False])
def test_snapshot_flag_wins_on_replay(recorded):
    signing = {"submitter_signs": recorded}
    assert (
        _replayed_submitter_signs("Loan Request Form", signing, 5, {"employee": not recorded})
        is recorded
    )
