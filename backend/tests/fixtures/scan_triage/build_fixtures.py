from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import tempfile
from pathlib import Path

import pymupdf

FIXTURE_DIR = Path(__file__).resolve().parent
PDF_NAME = "returned-form-text.pdf"
EXPECTED_PDF_TEXT = "Synthetic returned form\nRef: GS-0042\n"
PDF_METADATA = {
    "title": "GSSG synthetic scan fixture",
    "author": "GSSG fixture generator",
    "subject": "Synthetic test data only",
    "producer": "PyMuPDF",
    "creationDate": "D:20260905000000Z",
    "modDate": "D:20260905000000Z",
}


def _searchable_returned_form() -> bytes:
    doc = pymupdf.open()
    try:
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 96), "Synthetic returned form", fontname="helv", fontsize=18)
        page.insert_text((72, 128), "Ref: GS-0042", fontname="helv", fontsize=18)
        doc.set_metadata(PDF_METADATA)
        return doc.tobytes(garbage=4, deflate=True, no_new_id=True)
    finally:
        doc.close()


def _extracted_text(raw: bytes) -> str:
    with pymupdf.open(stream=raw, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def _build(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    raw = _searchable_returned_form()
    extracted = _extracted_text(raw)
    if extracted != EXPECTED_PDF_TEXT:
        raise RuntimeError(
            f"Unexpected searchable PDF text: {extracted!r} != {EXPECTED_PDF_TEXT!r}"
        )
    alphanumeric_count = sum(char.isalnum() for char in extracted)
    if alphanumeric_count < 16:
        raise RuntimeError("Searchable PDF text is below the production threshold")

    (output / PDF_NAME).write_bytes(raw)
    manifest = {
        "dependencies": {"PyMuPDF": importlib.metadata.version("PyMuPDF")},
        "fixtures": {
            PDF_NAME: {
                "alphanumeric_count": alphanumeric_count,
                "byte_length": len(raw),
                "expected_pdf_text": EXPECTED_PDF_TEXT,
                "kind": "searchable_pdf",
                "page_size_points": [595, 842],
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
        },
        "generator": "build_fixtures.py",
        "schema_version": 1,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _check() -> None:
    with tempfile.TemporaryDirectory(prefix="gssg-scan-fixtures-") as temp_dir:
        generated = Path(temp_dir)
        _build(generated)
        for name in (PDF_NAME, "manifest.json"):
            expected = (FIXTURE_DIR / name).read_bytes()
            actual = (generated / name).read_bytes()
            if actual != expected:
                raise RuntimeError(f"Fixture is stale: {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.output is not None and args.check:
        parser.error("--output and --check are mutually exclusive")
    if args.check:
        _check()
        return
    _build(args.output or FIXTURE_DIR)


if __name__ == "__main__":
    main()
