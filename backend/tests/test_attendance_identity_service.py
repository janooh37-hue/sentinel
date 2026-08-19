"""Employee-code matching between the BioTime mirror and Sentinel employees."""

from __future__ import annotations

import pytest

from app.db.models import Employee
from app.services.attendance_identity_service import (
    EmployeeCodeIndex,
    canonical_code,
    digit_key,
    match_employee_code,
)


def _employee(db_session, employee_id: str, *, status: str = "Active") -> Employee:
    row = Employee(id=employee_id, name_en=f"Employee {employee_id}", status=status)
    db_session.add(row)
    return row


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("G1234", "G1234"),
        (" g-1234 ", "G1234"),
        ("g_1234", "G1234"),
        ("1234", "1234"),
        ("", None),
        ("---", None),
        (None, None),
    ],
)
def test_canonical_code_folds_separators_and_case(raw, expected):
    assert canonical_code(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("G1234", "1234"),
        ("1234", "1234"),
        ("01234", "1234"),
        ("G0001", "1"),
        ("0", "0"),
        ("000", "0"),
        ("GSSG", None),
        (None, None),
    ],
)
def test_digit_key_ignores_prefix_and_zero_padding(raw, expected):
    assert digit_key(raw) == expected


def test_bare_provider_digits_match_the_g_number(db_session):
    """The reported case: BioTime holds `1234`, Sentinel holds `G1234`."""
    _employee(db_session, "G1234")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "1234")

    assert match.state == "digits"
    assert match.employee_id == "G1234"
    assert match.resolved


def test_prefixed_provider_code_matches_exactly(db_session):
    _employee(db_session, "G3082")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "g-3082")

    assert match.state == "exact"
    assert match.employee_id == "G3082"


def test_zero_padded_provider_code_matches(db_session):
    _employee(db_session, "G42")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "00042")

    assert match.state == "digits"
    assert match.employee_id == "G42"


def test_shared_digits_across_prefixes_is_a_conflict_not_a_guess(db_session):
    """Two employees share `1234`; binding either one would be a fabrication."""
    _employee(db_session, "G1234")
    _employee(db_session, "A1234")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "1234")

    assert match.state == "conflict"
    assert match.employee_id is None
    assert not match.resolved
    assert match.candidates == ("A1234", "G1234")


def test_exact_match_wins_over_an_ambiguous_digit_match(db_session):
    """A fully written code is evidence; padding-insensitivity must not override it."""
    _employee(db_session, "G1234")
    _employee(db_session, "A1234")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "A1234")

    assert match.state == "exact"
    assert match.employee_id == "A1234"


def test_unknown_provider_person_does_not_match(db_session):
    """People BioTime knows and Sentinel does not are left alone, never invented."""
    _employee(db_session, "G1234")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "9999")

    assert match.state == "none"
    assert match.employee_id is None


def test_code_without_digits_never_matches_by_digits(db_session):
    _employee(db_session, "G1234")
    db_session.flush()

    match = match_employee_code(EmployeeCodeIndex.build(db_session), "TEMP")

    assert match.state == "none"


def test_missing_provider_code_never_matches(db_session):
    _employee(db_session, "G1234")
    db_session.flush()

    assert match_employee_code(EmployeeCodeIndex.build(db_session), None).state == "none"


def test_active_only_index_excludes_departed_employees(db_session):
    """A resigned employee must not silently absorb a rehired person's punches."""
    _employee(db_session, "G1234", status="Resigned")
    db_session.flush()

    index = EmployeeCodeIndex.build(db_session, active_only=True)

    assert match_employee_code(index, "1234").state == "none"
    assert match_employee_code(EmployeeCodeIndex.build(db_session), "1234").state == "digits"
