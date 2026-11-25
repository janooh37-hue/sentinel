"""Path containment for employee document downloads."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services import throwaway_autofix


@pytest.fixture
def documents_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "employee_documents"
    for code in ("EMP001", "EMP002"):
        (root / code).mkdir(parents=True)
        (root / code / "contract.pdf").write_bytes(code.encode())
    (tmp_path / "secret.txt").write_bytes(b"secret")
    monkeypatch.setattr(throwaway_autofix, "DOCUMENTS_ROOT", root)
    return root


def _symlink(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=target.is_dir())
    except OSError as exc:  # Windows without symlink privilege
        pytest.skip(f"cannot create symlinks here: {exc}")


def test_reads_own_document(documents_root: Path) -> None:
    assert throwaway_autofix.read_employee_document("EMP001", "contract.pdf") == b"EMP001"


@pytest.mark.parametrize(
    "filename",
    ["../EMP002/contract.pdf", "../../secret.txt", "sub/../../EMP002/contract.pdf"],
)
def test_filename_cannot_escape_employee_directory(documents_root: Path, filename: str) -> None:
    with pytest.raises(ValueError, match="outside"):
        throwaway_autofix.read_employee_document("EMP001", filename)


@pytest.mark.parametrize(
    "filename",
    [
        "\\\\attacker\\share\\x.pdf",
        "//attacker/share/x.pdf",
        "\\\\?\\C:\\Windows\\win.ini",
        "C:\\Windows\\win.ini",
        "D:x.pdf",
        "\\Windows\\win.ini",
    ],
)
def test_windows_anchored_filename_is_rejected_before_resolving(
    documents_root: Path, filename: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Resolving a UNC path on Windows opens an SMB connection, so reject lexically first.
    real_resolve = Path.resolve

    def guarded_resolve(self: Path, strict: bool = False) -> Path:
        # Substring catches the Linux join; is_relative_to catches Windows, where an
        # anchored filename replaces the documents root instead of joining under it.
        assert filename not in str(self) and self.is_relative_to(documents_root), (
            f"resolved caller-supplied path {self}"
        )
        return real_resolve(self, strict=strict)

    monkeypatch.setattr(Path, "resolve", guarded_resolve)
    with pytest.raises(ValueError, match="outside"):
        throwaway_autofix.read_employee_document("EMP001", filename)


def test_absolute_filename_is_rejected(documents_root: Path) -> None:
    target = documents_root / "EMP002" / "contract.pdf"
    with pytest.raises(ValueError, match="outside"):
        throwaway_autofix.read_employee_document("EMP001", str(target))


@pytest.mark.parametrize(
    "employee_code",
    [
        "..",
        "EMP001/../EMP002",
        "../EMP002",
        "",
        ".",
        "EMP001\\..\\EMP002",
        "..\\EMP002",
        "C:",
        "C:EMP002",
    ],
)
def test_employee_code_must_be_single_component(documents_root: Path, employee_code: str) -> None:
    with pytest.raises(ValueError, match="employee code"):
        throwaway_autofix.read_employee_document(employee_code, "contract.pdf")


def test_symlinked_employee_directory_outside_root_is_rejected(
    documents_root: Path, tmp_path: Path
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "contract.pdf").write_bytes(b"outside")
    _symlink(documents_root / "EMP003", outside)
    with pytest.raises(ValueError, match="outside"):
        throwaway_autofix.read_employee_document("EMP003", "contract.pdf")


def test_symlinked_file_outside_employee_directory_is_rejected(documents_root: Path) -> None:
    _symlink(documents_root / "EMP001" / "link.pdf", documents_root / "EMP002" / "contract.pdf")
    with pytest.raises(ValueError, match="outside"):
        throwaway_autofix.read_employee_document("EMP001", "link.pdf")
