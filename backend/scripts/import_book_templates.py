"""One-time import: Desktop 'book template' docx files → the shared library.

Each file goes through the SAME retokenize + fail-closed validation as
save-as-template (so the hand-made legacy files can't land broken). Existing
library names are skipped, never overwritten. Run manually:

    venv\\Scripts\\python.exe backend/scripts/import_book_templates.py
"""

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.book_template_retokenize import (
    retokenize_general_book,
    validate_book_template,
)
from app.services.book_template_service import (
    safe_template_name,
    templates_dir,
)

SOURCE = Path.home() / "Desktop" / "book template"


def main() -> int:
    if not SOURCE.is_dir():
        print(f"SOURCE not found: {SOURCE}")
        return 1
    ok = skipped = failures = 0
    for src in sorted(SOURCE.glob("*.docx")):
        if src.name.startswith("~$"):  # Word owner/lock stub, not a document
            continue
        name = safe_template_name(src.stem)
        dest = templates_dir() / name
        if dest.exists():
            skipped += 1
            print(f"SKIP  {name} (already in library)")
            continue
        tmp = dest.with_suffix(".tmp")
        try:
            shutil.copy2(src, tmp)
            retokenize_general_book(tmp, submitter_g=None)
            validate_book_template(tmp)
            tmp.rename(dest)
            ok += 1
            print(f"OK    {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL  {name}: {exc}")
        finally:
            tmp.unlink(missing_ok=True)
    print(f"done: {ok} OK / {skipped} SKIP / {failures} FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
