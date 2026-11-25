"""Throwaway for the PR Agent autofix end-to-end check. Will be closed, not merged."""

from __future__ import annotations

from pathlib import Path, PurePosixPath, PureWindowsPath

DOCUMENTS_ROOT = Path("data/employee_documents")


def employee_document_path(employee_code: str, filename: str) -> Path:
    """Return the stored file for an employee's uploaded document.

    Raises ``ValueError`` when ``employee_code`` is not a single directory name, when
    ``filename`` is absolute, drive-qualified or UNC (POSIX or Windows form, checked
    before anything is resolved), when the employee directory resolves anywhere but
    ``DOCUMENTS_ROOT/<employee_code>`` (a link or alias to another directory), or when the
    resolved file (symlinks included) is not inside that employee's directory.
    """
    if employee_code in {"", ".", ".."} or any(sep in employee_code for sep in "/\\:"):
        raise ValueError(f"invalid employee code: {employee_code!r}")
    # Reject absolute, drive and UNC filenames before resolving: on Windows, resolving a
    # UNC path opens an SMB connection to the named host.
    if PurePosixPath(filename).anchor or PureWindowsPath(filename).anchor:
        raise ValueError("document path is outside the employee directory")
    root = DOCUMENTS_ROOT.resolve()
    employee_dir = (root / employee_code).resolve()
    if employee_dir != root / employee_code:
        raise ValueError("employee directory resolves outside DOCUMENTS_ROOT/<employee_code>")
    candidate = (employee_dir / filename).resolve()
    if candidate == employee_dir or not candidate.is_relative_to(employee_dir):
        raise ValueError("document path is outside the employee directory")
    return candidate


def read_employee_document(employee_code: str, filename: str) -> bytes:
    """Read an employee's document for download."""
    return employee_document_path(employee_code, filename).read_bytes()
