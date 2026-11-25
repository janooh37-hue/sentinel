"""Throwaway for the PR Agent autofix end-to-end check. Will be closed, not merged."""

from __future__ import annotations

from pathlib import Path

DOCUMENTS_ROOT = Path("data/employee_documents")


def employee_document_path(employee_code: str, filename: str) -> Path:
    """Return the stored file for an employee's uploaded document."""
    return DOCUMENTS_ROOT / employee_code / filename


def read_employee_document(employee_code: str, filename: str) -> bytes:
    """Read an employee's document for download."""
    return employee_document_path(employee_code, filename).read_bytes()
