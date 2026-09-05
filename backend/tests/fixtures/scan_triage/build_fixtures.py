from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import tempfile
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont, features

from app.core.extraction.form_ref import candidate_refs
from app.core.extraction.ocr import pdf_text_layer
from app.core.qr import decode_qr_refs, make_aztec_png

FIXTURE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(__file__).resolve().parents[4]
FONT_PATH = PROJECT_ROOT / "docs" / "how-we-work" / "assets" / "fonts" / "naskh-700.ttf"
RETURNED_FORM_PDF = "returned-form-text.pdf"
RETURNED_FORM_TEXT = "Synthetic returned form\nRef: GS-0042\n"
EXTERNAL_PDF = "external-multi-signal.pdf"
EXTERNAL_TEXT = """Resident Identity Card
784-1990-1234567-1
Name: LAYLA HASSAN
الاسم: ليلى حسن
IBAN AE070331234567890123456
Expiry Date: 31/12/2030
"""
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


def _bilingual_scan() -> bytes:
    if not features.check_feature("raqm"):
        raise RuntimeError("Pillow RAQM support is required to build Arabic fixtures")
    image = Image.new("RGB", (2400, 1800), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT_PATH, 150)
    y = 120
    for line in EXTERNAL_TEXT.splitlines():
        font = ImageFont.truetype(FONT_PATH, 150)
        while draw.textlength(line, font=font) > 2160:
            font = ImageFont.truetype(FONT_PATH, font.size - 1)
        if line.startswith("الاسم"):
            draw.text(
                (2280, y),
                line,
                font=font,
                fill="black",
                anchor="ra",
                direction="rtl",
                language="ar",
            )
        else:
            draw.text((120, y), line, font=font, fill="black")
        y += 250
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    image.close()
    return buffer.getvalue()


def _reference_scan(lines: tuple[str, ...]) -> bytes:
    if not features.check_feature("raqm"):
        raise RuntimeError("Pillow RAQM support is required to build Arabic fixtures")
    image = Image.new("RGB", (2400, 1200), "white")
    try:
        draw = ImageDraw.Draw(image)
        for index, line in enumerate(lines):
            font = ImageFont.truetype(FONT_PATH, 160)
            while draw.textlength(line, font=font) > 2160:
                font = ImageFont.truetype(FONT_PATH, font.size - 1)
            if any("\u0600" <= char <= "\u06ff" for char in line):
                draw.text(
                    (2280, 150 + index * 220),
                    line,
                    font=font,
                    fill="black",
                    anchor="ra",
                    direction="rtl",
                    language="ar",
                )
            else:
                draw.text((120, 150 + index * 220), line, font=font, fill="black")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", compress_level=9)
        return buffer.getvalue()
    finally:
        image.close()


def _scan_pdf(raw: bytes, logical_text: str | None = None) -> bytes:
    with pymupdf.open() as doc:
        page = doc.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(35, 80, 560, 342), stream=raw)
        if logical_text is not None:
            _add_logical_text_layer(doc, page, logical_text)
        doc.set_metadata(PDF_METADATA)
        return doc.tobytes(garbage=4, deflate=True, no_new_id=True)


def _add_logical_text_layer(
    doc: pymupdf.Document,
    page: pymupdf.Page,
    logical_text: str,
) -> None:
    before = set(page.get_contents())
    page.insert_text(
        (36, 36),
        "GSSG synthetic searchable text layer 0000000000000000",
        fontname="helv",
        fontsize=8,
        render_mode=3,
    )
    added = set(page.get_contents()) - before
    if len(added) != 1:
        raise RuntimeError("Expected one PDF content stream for the logical text layer")
    xref = added.pop()
    content = doc.xref_stream(xref)
    actual = (b"\xfe\xff" + logical_text.encode("utf-16-be")).hex().upper()
    doc.update_stream(
        xref,
        f"/Span <</ActualText <{actual}>>> BDC\n".encode() + content + b"\nEMC\n",
    )


def _searchable_external_document() -> bytes:
    doc = pymupdf.open()
    try:
        page = doc.new_page(width=595, height=842)
        page.insert_image(pymupdf.Rect(35, 80, 560, 474), stream=_bilingual_scan())
        _add_logical_text_layer(doc, page, EXTERNAL_TEXT)
        doc.set_metadata(PDF_METADATA)
        return doc.tobytes(garbage=4, deflate=True, no_new_id=True)
    finally:
        doc.close()


def _extracted_text(raw: bytes) -> str:
    with pymupdf.open(stream=raw, filetype="pdf") as doc:
        return "\n".join(page.get_text() for page in doc)


def _build(output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    fixtures = {
        RETURNED_FORM_PDF: (_searchable_returned_form(), RETURNED_FORM_TEXT),
        EXTERNAL_PDF: (_searchable_external_document(), EXTERNAL_TEXT),
    }
    fixture_manifest = {}
    for filename, (raw, expected_text) in fixtures.items():
        extracted = _extracted_text(raw)
        if extracted != expected_text:
            raise RuntimeError(
                f"Unexpected searchable PDF text: {extracted!r} != {expected_text!r}"
            )
        alphanumeric_count = sum(char.isalnum() for char in extracted)
        if alphanumeric_count < 16:
            raise RuntimeError("Searchable PDF text is below the production threshold")
        (output / filename).write_bytes(raw)
        fixture_manifest[filename] = {
            "alphanumeric_count": alphanumeric_count,
            "byte_length": len(raw),
            "expected_pdf_text": expected_text,
            "kind": "searchable_pdf",
            "page_size_points": [595, 842],
            "sha256": hashlib.sha256(raw).hexdigest(),
        }

    qr = make_aztec_png("GS-0042", module_size=12, border=4)
    with Image.open(io.BytesIO(qr)) as image:
        if decode_qr_refs(image) != ["GS-0042"]:
            raise RuntimeError("Synthetic Aztec fixture did not decode")
        dimensions = list(image.size)
    (output / "returned-form-qr.png").write_bytes(qr)
    fixture_manifest["returned-form-qr.png"] = {
        "kind": "aztec_png",
        "dimensions": dimensions,
        "payload": "GSSG:GS-0042",
        "byte_length": len(qr),
        "sha256": hashlib.sha256(qr).hexdigest(),
    }

    with Image.new("RGB", (2400, 1200), "white") as blank:
        buffer = io.BytesIO()
        blank.save(buffer, format="PNG", compress_level=9)
    raw = buffer.getvalue()
    (output / "blank-valid.png").write_bytes(raw)
    fixture_manifest["blank-valid.png"] = {
        "kind": "png",
        "dimensions": [2400, 1200],
        "source_text": "",
        "byte_length": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }

    for name, raw in {
        "malformed.bin": b"GSSG synthetic malformed scan\x00\xff",
        "malformed.pdf": b"%PDF-1.7\nGSSG synthetic malformed PDF\n%%EOF\n",
    }.items():
        (output / name).write_bytes(raw)
        fixture_manifest[name] = {
            "kind": "malformed",
            "byte_length": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }

    arabic_text = "وثيقة اختبار اصطناعية\nالرقم: 1/5/141\nالتاريخ: 05/09/2026\n"  # noqa: RUF001 - literal mixed Arabic/Latin evidence
    arabic_pdf = _scan_pdf(_reference_scan(tuple(arabic_text.splitlines())), arabic_text)
    if pdf_text_layer(arabic_pdf) != arabic_text or candidate_refs(arabic_text) != ["1/5/141"]:
        raise RuntimeError("Arabic fixture logical reference/date evidence differs")
    name = "classified-ref-ar.pdf"
    (output / name).write_bytes(arabic_pdf)
    fixture_manifest[name] = {
        "kind": "searchable_pdf",
        "expected_pdf_text": arabic_text,
        "source_text": arabic_text,
        "byte_length": len(arabic_pdf),
        "sha256": hashlib.sha256(arabic_pdf).hexdigest(),
        "page_size_points": [595, 842],
    }

    for name, lines in {
        "returned-form-scan-en.png": ("Synthetic returned form", "Ref: GS-0042"),
        "returned-form-scan-mixed.png": (
            "Synthetic returned form",
            "وثيقة اختبار اصطناعية",
            "الرقم: GS-0042 General Services",
        ),
    }.items():
        raw = _reference_scan(lines)
        (output / name).write_bytes(raw)
        fixture_manifest[name] = {
            "kind": "png",
            "dimensions": [2400, 1200],
            "source_text": "\n".join(lines) + "\n",
            "byte_length": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        if name == "returned-form-scan-en.png":
            pdf = _scan_pdf(raw)
            if pdf_text_layer(pdf):
                raise RuntimeError("Image-only fixture unexpectedly contains searchable text")
            pdf_name = "returned-form-scan-en.pdf"
            (output / pdf_name).write_bytes(pdf)
            fixture_manifest[pdf_name] = {
                "kind": "image_only_pdf",
                "page_size_points": [595, 842],
                "source_text": "\n".join(lines) + "\n",
                "byte_length": len(pdf),
                "sha256": hashlib.sha256(pdf).hexdigest(),
            }

    external_scan = _bilingual_scan()
    (output / "external-multi-signal.png").write_bytes(external_scan)
    fixture_manifest["external-multi-signal.png"] = {
        "kind": "png",
        "dimensions": [2400, 1800],
        "source_text": EXTERNAL_TEXT,
        "byte_length": len(external_scan),
        "sha256": hashlib.sha256(external_scan).hexdigest(),
    }

    manifest = {
        "dependencies": {
            "Pillow": importlib.metadata.version("Pillow"),
            "aztec-code-generator": importlib.metadata.version("aztec-code-generator"),
            "PyMuPDF": importlib.metadata.version("PyMuPDF"),
        },
        "fixtures": fixture_manifest,
        "fonts": {
            str(FONT_PATH.relative_to(PROJECT_ROOT)): hashlib.sha256(
                FONT_PATH.read_bytes()
            ).hexdigest()
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
        for name in (
            *json.loads((generated / "manifest.json").read_text())["fixtures"],
            "manifest.json",
        ):
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
