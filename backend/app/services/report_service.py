"""Helpers for the Report doc type reused by word_book_service."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import signature as signature_core
from app.core.vault_manager import Vault
from app.db.models import Employee, Submitter


def _resolve_signer(db: Session, employee_id: str) -> tuple[str, str, str | None]:
    """(name, designation, signature_path|None) for the picked employee.

    The signature comes from the employee's saved-signature store — the SAME
    source the Report form's signer preview and ``POST /employees/{id}/signature``
    use (``signature_core.vault_path``). Reading only ``Submitter.stored_sig_path``
    left every roster signer without a Submitter row finishing UNSIGNED, so the
    sign toggle looked broken. A legacy Submitter file is the fallback.
    """
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {employee_id} not found", http_status=404)
    name = (emp.name_ar or emp.name_en or "").strip()
    title = (emp.position_ar or emp.position or "").strip()
    settings = get_settings()

    emp_sig = signature_core.vault_path(Vault(settings.vault_dir), employee_id)
    if emp_sig.is_file():
        return name, title, str(emp_sig)

    sub = (
        db.execute(select(Submitter).where(Submitter.employee_id == employee_id)).scalars().first()
    )
    sig: str | None = sub.stored_sig_path if sub is not None else None
    if sig is not None:
        p = Path(sig)
        if not p.is_absolute():
            p = settings.data_dir / p
        sig = str(p) if p.is_file() else None
    return name, title, sig
