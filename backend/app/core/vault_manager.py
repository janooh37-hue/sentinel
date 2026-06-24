"""Per-employee file vault ported from `EmployeeFileManager` (v3.5.4 line 1515).

Layout under ``<root>/<G>/`` — identical to v3 so the Phase 09 migration is a
move-only operation, not a rewrite:

    documents/uae_id/
    documents/passport/
    documents/other/
    leaves/
    violations/

Plus Personnel-Affairs form subfolders (acknowledgment, salary_transfer, …)
created on demand by :meth:`Vault.form_output_dir`.

This module is pure file-system mechanics — no thumbnail rendering, no PDF
preview, no PIL/fitz imports. Those concerns belong in services (the React
client requests rendered pages from a dedicated endpoint).
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Final

from app.core.constants import (
    ALLOWED_DOC_EXTS,
    DOC_CATEGORY_OTHER,
    DOC_CATEGORY_PASSPORT,
    DOC_CATEGORY_UAE_ID,
    FORM_TYPE_SUBFOLDER,
)

_DOC_CATEGORIES: Final[frozenset[str]] = frozenset(
    {DOC_CATEGORY_UAE_ID, DOC_CATEGORY_PASSPORT, DOC_CATEGORY_OTHER}
)
_LEAF_FOLDERS: Final[frozenset[str]] = frozenset({"leaves", "violations"})


class Vault:
    """Per-employee folder tree under ``root_dir/<G>/``."""

    def __init__(self, root_dir: Path | str) -> None:
        self.root = Path(root_dir)
        self.root.mkdir(parents=True, exist_ok=True)

    # --- G-number normalisation ------------------------------------------

    @staticmethod
    def normalize_g_number(g_number: str) -> str:
        """Uppercase, strip, ensure ``G`` prefix. v3 line 1530."""
        g = (g_number or "").upper().strip()
        if not g:
            raise ValueError("g_number must be non-empty")
        if not g.startswith("G"):
            g = "G" + g
        return g

    def emp_root(self, g_number: str) -> Path:
        return self.root / self.normalize_g_number(g_number)

    # --- Folder creation -------------------------------------------------

    def ensure_folder(self, g_number: str) -> Path:
        """Create the full subfolder skeleton for an employee. Idempotent."""
        base = self.emp_root(g_number)
        for sub in (
            "documents",
            "documents/uae_id",
            "documents/passport",
            "documents/other",
            "leaves",
            "violations",
        ):
            (base / sub).mkdir(parents=True, exist_ok=True)
        return base

    # --- Path resolution -------------------------------------------------

    def path(self, g_number: str, kind: str) -> Path:
        """Resolve the directory for a given file *kind*.

        Accepts:
          * ``"uae_id"`` / ``"passport"`` / ``"other"`` → documents subfolder.
          * ``"leaves"`` / ``"violations"`` → top-level subfolder.

        Unknown kinds fall back to ``documents/other`` to match v3 behaviour
        (which silently grouped unmapped categories there).
        """
        self.ensure_folder(g_number)
        base = self.emp_root(g_number)
        if kind in _DOC_CATEGORIES:
            return base / "documents" / kind
        if kind in _LEAF_FOLDERS:
            return base / kind
        return base / "documents" / DOC_CATEGORY_OTHER

    def form_output_dir(self, g_number: str, form_type: str) -> Path | None:
        """Return the per-employee output folder for a Personnel-Affairs form.

        Returns ``None`` if the form_type has no mapping (Admin-Affairs or
        General Book — those write to OUTPUT_DIR via the document service)
        or the G-number is blank. Auto-creates the folder when mapped.
        """
        sub = FORM_TYPE_SUBFOLDER.get(form_type)
        g = (g_number or "").strip()
        if not sub or not g:
            return None
        target = self.emp_root(g) / sub
        target.mkdir(parents=True, exist_ok=True)
        return target

    # --- File operations -------------------------------------------------

    @staticmethod
    def collision_safe_name(target_dir: Path, filename: str) -> Path:
        """Append ``_1``, ``_2``, … before the extension to avoid overwrite.

        Exposed as a static method so other services (document generator) can
        reuse the same collision rule.
        """
        stem = Path(filename).stem
        ext = Path(filename).suffix
        candidate = target_dir / filename
        i = 1
        while candidate.exists():
            candidate = target_dir / f"{stem}_{i}{ext}"
            i += 1
        return candidate

    def add_file(self, g_number: str, kind: str, src_path: Path | str) -> Path:
        """Copy ``src_path`` into the employee's vault folder."""
        src = Path(src_path)
        if not src.exists():
            raise FileNotFoundError(str(src))
        if src.suffix.lower() not in ALLOWED_DOC_EXTS:
            raise ValueError(
                f"File type not allowed - نوع الملف غير مسموح: {src.suffix}"
            )
        tgt_dir = self.path(g_number, kind)
        tgt_dir.mkdir(parents=True, exist_ok=True)
        dest = self.collision_safe_name(tgt_dir, src.name)
        shutil.copy2(src, dest)
        return dest

    def list_files(self, g_number: str, kind: str) -> list[Path]:
        d = self.path(g_number, kind)
        if not d.exists():
            return []
        return sorted(
            p
            for p in d.iterdir()
            if p.is_file() and p.suffix.lower() in ALLOWED_DOC_EXTS
        )

    @staticmethod
    def delete_file(path: Path | str) -> bool:
        """Delete a single vault file. Returns True iff the file existed and
        was removed. Mirrors v3's lenient semantics (no exception on missing).
        """
        p = Path(path)
        if not p.exists() or not p.is_file():
            return False
        try:
            p.unlink()
            return True
        except OSError:
            return False
