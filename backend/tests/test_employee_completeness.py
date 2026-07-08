"""Completeness core: tracked-field gaps on Employee rows."""

from app.core.employee_completeness import TRACKED_FIELDS, completeness, missing_fields
from app.db.models import Employee


def _emp(**overrides: object) -> Employee:
    base: dict[str, object] = dict(
        id="G0001",
        name_en="TEST",
        name_ar="اختبار",
        dob=None,
        nationality=None,
        contact=None,
        passport_no=None,
        passport_expiry=None,
        uae_id_no=None,
        uae_id_expiry=None,
        iban=None,
        position=None,
        position_ar=None,
        department=None,
        duty_unit=None,
        doj=None,
    )
    base.update(overrides)
    return Employee(**base)  # type: ignore[arg-type]


def test_tracked_fields_is_the_agreed_14() -> None:
    assert TRACKED_FIELDS == (
        "name_en",
        "name_ar",
        "dob",
        "nationality",
        "contact",
        "passport_no",
        "passport_expiry",
        "uae_id_no",
        "uae_id_expiry",
        "iban",
        "position",
        "department",
        "duty_unit",
        "doj",
    )


def test_missing_fields_reports_gaps_in_stable_order() -> None:
    emp = _emp(nationality=None, contact="0501234567")
    missing = missing_fields(emp)
    assert "nationality" in missing
    assert "contact" not in missing
    assert missing == [f for f in TRACKED_FIELDS if f in missing]


def test_blank_and_whitespace_count_as_missing() -> None:
    emp = _emp(nationality="  ", iban="")
    missing = missing_fields(emp)
    assert "nationality" in missing and "iban" in missing


def test_position_ar_satisfies_position() -> None:
    emp = _emp(position=None, position_ar="حارس أمن")
    assert "position" not in missing_fields(emp)


def test_completeness_counts() -> None:
    emp = _emp(nationality="UAE")  # name_en, name_ar, nationality filled = 3
    filled, tracked = completeness(emp)
    assert tracked == 14
    assert filled == 3
