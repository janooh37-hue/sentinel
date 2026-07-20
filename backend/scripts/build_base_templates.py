"""Build the two canonical General Book base templates.

Creates ``base_text.docx`` (letterhead tokens, free body, no table) and
``base_table.docx`` (same + one 2-column data table: الاسم / الجهة) in the
given output directory, or in ``data_dir/book_templates`` by default.

Usage:
    venv\\Scripts\\python.exe backend/scripts/build_base_templates.py [OUTPUT_DIR]
    venv\\Scripts\\python.exe backend/scripts/build_base_templates.py --check [OUTPUT_DIR]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# sys.path bootstrap — mirrors other scripts in this directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from docx import Document
from docx.shared import Pt

from app.core.book_template_retokenize import retokenize_general_book, validate_book_template


def _build_text(path: Path) -> None:
    """Create base_text.docx: letterhead tokens + free body, no table."""
    doc = Document()
    doc.add_paragraph("الرقم: 1/2026")
    doc.add_paragraph("التاريخ: 01-01-2026")
    doc.add_paragraph("السيد / اسم المستلم")
    doc.add_paragraph("الموضوع: موضوع الكتاب")
    doc.add_paragraph("نص الكتاب العام.")
    footer = doc.sections[0].footer
    run = footer.paragraphs[0].add_run("G-0000")
    run.font.size = Pt(9)
    doc.save(str(path))
    retokenize_general_book(path, submitter_g="G-0000")
    validate_book_template(path)


def _build_table(path: Path) -> None:
    """Create base_table.docx: same header tokens + 2-column data table (الاسم / الجهة)."""
    doc = Document()
    doc.add_paragraph("الرقم: 1/2026")
    doc.add_paragraph("التاريخ: 01-01-2026")
    doc.add_paragraph("السيد / اسم المستلم")
    doc.add_paragraph("الموضوع: موضوع الكتاب")
    doc.add_paragraph("نص الكتاب العام.")
    tbl = doc.add_table(rows=2, cols=2)
    tbl.cell(0, 0).text = "الاسم"
    tbl.cell(0, 1).text = "الجهة"
    tbl.cell(1, 0).text = "قيمة 1"
    tbl.cell(1, 1).text = "قيمة 2"
    footer = doc.sections[0].footer
    run = footer.paragraphs[0].add_run("G-0000")
    run.font.size = Pt(9)
    doc.save(str(path))
    retokenize_general_book(path, submitter_g="G-0000")
    validate_book_template(path)


def build_templates(output_dir: Path) -> None:
    """Build both base templates into *output_dir* (must exist or be creatable)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _build_text(output_dir / "base_text.docx")
    _build_table(output_dir / "base_table.docx")


def check_templates(output_dir: Path) -> bool:
    """Return True iff both base templates exist and pass validate_book_template."""
    for name in ("base_text.docx", "base_table.docx"):
        p = output_dir / name
        if not p.is_file():
            return False
        try:
            validate_book_template(p)
        except ValueError:
            return False
    return True


def _default_output_dir() -> Path:
    # Deferred import so ``--check DIR`` works without side-effects from Settings.
    from app.config import get_settings

    return get_settings().data_dir / "book_templates"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "output_dir", nargs="?", help="Output directory (default: data_dir/book_templates)"
    )
    parser.add_argument(
        "--check", action="store_true", help="Assert both files exist and validate; exit 1 if not"
    )
    args = parser.parse_args()

    out = Path(args.output_dir) if args.output_dir else _default_output_dir()

    if args.check:
        ok = check_templates(out)
        if ok:
            print(f"OK: both base templates present and valid in {out}")
            return 0
        print(f"FAIL: one or both base templates missing or invalid in {out}", file=sys.stderr)
        return 1

    build_templates(out)
    print(f"Built base_text.docx and base_table.docx in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
