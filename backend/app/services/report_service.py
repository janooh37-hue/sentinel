"""Helpers for the Report doc type reused by word_book_service."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import signature as signature_core
from app.db.models import Employee


def _resolve_signer(db: Session, employee_id: str) -> tuple[str, str, str | None]:
    """(name, designation, signature_path|None) for the picked employee.

    The signature is ALWAYS the employee's saved profile signature — the SAME
    source the Report form's signer preview and
    ``POST /employees/{id}/signature`` use. No Submitter fallback: falling
    back to a legacy Submitter file let the preview and a later signed
    document disagree once the profile was consolidated or deleted.
    """
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {employee_id} not found", http_status=404)
    name = (emp.name_ar or emp.name_en or "").strip()
    title = (emp.position_ar or emp.position or "").strip()
    return name, title, signature_core.employee_signature_str(get_settings().vault_dir, employee_id)
