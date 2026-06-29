from app.core.permissions import (
    CAPABILITY_IDS, ROLE_DEFAULTS, default_caps_for_role,
)
from app.core.roles import ADMIN_ROLE, MANAGER_ROLE, OPERATOR_ROLE


def test_notify_capability_exists():
    assert "employees.notify" in CAPABILITY_IDS


def test_notify_default_role_assignment():
    assert "employees.notify" in default_caps_for_role(MANAGER_ROLE)
    assert "employees.notify" in default_caps_for_role(ADMIN_ROLE)
    assert "employees.notify" not in default_caps_for_role(OPERATOR_ROLE)
