"""Pure-function role derivation for identity-aware UI gates.

Role is **not stored** — it is computed every time from the employee row
and the singleton ``settings.admin_employee_id``. Changing an employee's
position changes their role on the next /identity/me fetch.

Hierarchy: admin > manager > operator.
"""

from __future__ import annotations

from typing import Final

from app.db.models import Employee

ADMIN_ROLE: Final[str] = "admin"
MANAGER_ROLE: Final[str] = "manager"
OPERATOR_ROLE: Final[str] = "operator"

# Substrings that mark an employee as a manager. Casefold comparison.
_MANAGER_TOKENS: Final[tuple[str, ...]] = (
    "manager",
    "director",
    "head",
    "chief",
    "supervisor",
)


def derive_role(employee: Employee, admin_employee_id: str | None) -> str:
    """Return one of ``admin`` / ``manager`` / ``operator``.

    - Admin: the employee whose id matches ``admin_employee_id`` (singleton).
    - Manager: position contains a manager-token (casefold).
    - Operator: everyone else, or null position.
    """
    if admin_employee_id and employee.id == admin_employee_id:
        return ADMIN_ROLE
    position = (employee.position or "").casefold()
    if any(token in position for token in _MANAGER_TOKENS):
        return MANAGER_ROLE
    return OPERATOR_ROLE


__all__ = ["ADMIN_ROLE", "MANAGER_ROLE", "OPERATOR_ROLE", "derive_role"]
