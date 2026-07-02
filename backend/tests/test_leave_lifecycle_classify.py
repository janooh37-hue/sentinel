import pytest

from app.core import leave_lifecycle as L


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Duty Resumption", "record"),
        ("Duty Resumption مباشرة عمل", "record"),  # dash-less bilingual — currently misclassified
        ("Passport Release تسليم جواز", "record"),
        ("Administrative Leave إجازة إدارية", "record"),
        ("Sick Leave - الإجازة المرضية", "sick"),
        ("Sick Leave المرضية", "sick"),
        ("Annual Leave", "request"),
        ("Annual Leave - الإجازة السنوية", "request"),
        ("National Service", "national_service"),
    ],
)
def test_classify_group_handles_dashless_bilingual(value, expected):
    assert L.classify_group(value) == expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Approved - موافق", "Approved"),
        ("Generated - تم الإنشاء", "Approved"),  # legacy alias preserved
        ("Pending - انتظار", "Pending"),
        ("Approved", "Approved"),
    ],
)
def test_canonical_status_still_collapses_bilingual(value, expected):
    assert L.canonical_status(value) == expected
