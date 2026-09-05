from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import subprocess
import unicodedata
from pathlib import Path

import pymupdf
import pytest

from app.core.extraction import ocr
from app.services.document_reader import DocumentRead, OcrPageEvidence, read_document


@pytest.fixture(autouse=True)
def prevent_unexpected_tesseract(
    monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest
) -> None:
    if "real_ocr" in request.fixturenames:
        return

    def reject_process() -> str:
        raise AssertionError("ordinary reader test unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_process)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "scan_triage"


def test_searchable_pdf_returns_literal_evidence_without_ocr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_ocr(*_args, **_kwargs):
        raise AssertionError("searchable PDF unexpectedly invoked Tesseract")

    monkeypatch.setattr(ocr, "extract_text", reject_ocr)
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", reject_ocr)

    result = read_document((FIXTURE_DIR / "returned-form-text.pdf").read_bytes())

    assert result == DocumentRead(
        text="Synthetic returned form\nRef: GS-0042\n",
        text_source="pdf_text",
        qr_refs=(),
        ocr_pages=(),
        unavailable_reason=None,
    )


def test_real_aztec_fixture_survives_ocr_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    reason = "Tesseract is not installed. See docs/superpowers/ocr-server-setup.md."

    def unavailable(_image):
        raise ocr.OcrUnavailableError(reason)

    monkeypatch.setattr(ocr, "extract_text", unavailable)
    assert read_document((FIXTURE_DIR / "returned-form-qr.png").read_bytes()) == DocumentRead(
        text="", text_source="unavailable", qr_refs=("GS-0042",), unavailable_reason=reason
    )


def test_blank_ocr_success_retains_page_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ocr, "extract_text", lambda _image: ocr.OcrResult("", 0.0))
    assert read_document((FIXTURE_DIR / "blank-valid.png").read_bytes()) == DocumentRead(
        text="", text_source="ocr", ocr_pages=(OcrPageEvidence(0, "", 0.0),)
    )


@pytest.mark.parametrize(
    "reason",
    [
        "Tesseract is not installed. See docs/superpowers/ocr-server-setup.md.",
        "Tesseract failed to run with languages 'ara+eng'. The 'ara' and 'eng' language packs must both be installed. See docs/superpowers/ocr-server-setup.md.",
    ],
)
def test_unavailable_without_qr_retains_exact_reason(
    monkeypatch: pytest.MonkeyPatch, reason: str
) -> None:
    def unavailable(_image):
        raise ocr.OcrUnavailableError(reason)

    monkeypatch.setattr(ocr, "extract_text", unavailable)
    assert read_document((FIXTURE_DIR / "blank-valid.png").read_bytes()) == DocumentRead(
        text="", text_source="unavailable", unavailable_reason=reason
    )


def test_malformed_image_has_stable_error() -> None:
    with pytest.raises(
        ocr.InvalidImageError, match=r"^The uploaded file is not a readable image\.$"
    ):
        read_document((FIXTURE_DIR / "malformed.bin").read_bytes())


def test_image_only_pdf_preserves_ordered_raw_page_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pymupdf.open() as pdf:
        for _ in range(2):
            page = pdf.new_page(width=595, height=842)
            page.insert_image(page.rect, stream=(FIXTURE_DIR / "blank-valid.png").read_bytes())
        raw = pdf.tobytes()
    outputs = iter(
        (
            ocr.OcrResult("First page\n", 0.81, "eng"),
            ocr.OcrResult("الصفحة الثانية\n", 0.62, "ara+eng"),
        )
    )
    monkeypatch.setattr(ocr, "extract_text", lambda _image: next(outputs))
    assert read_document(raw) == DocumentRead(
        text="First page\n\nالصفحة الثانية\n",  # noqa: RUF001 - literal mixed Arabic/Latin evidence
        text_source="ocr",
        ocr_pages=(
            OcrPageEvidence(0, "First page\n", 0.81, "eng"),
            OcrPageEvidence(1, "الصفحة الثانية\n", 0.62, "ara+eng"),
        ),
    )


def test_malformed_pdf_has_stable_error() -> None:
    with pytest.raises(ocr.InvalidImageError, match=r"^The uploaded PDF is not readable\.$"):
        read_document((FIXTURE_DIR / "malformed.pdf").read_bytes())


@pytest.mark.parametrize("fail", [False, True])
def test_reader_closes_resized_ocr_image(monkeypatch: pytest.MonkeyPatch, fail: bool) -> None:
    import pytesseract

    observed = []
    monkeypatch.setattr(ocr, "_resolve_tesseract_cmd", lambda: "synthetic-tesseract")

    def text(image, **_kwargs):
        observed.append(image)
        if fail:
            raise pytesseract.TesseractError(1, "synthetic language unavailable")
        return "Ref: GS-0042\n"

    monkeypatch.setattr(pytesseract, "image_to_string", text)
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *_args, **_kwargs: {"conf": ["90"]})
    result = read_document((FIXTURE_DIR / "returned-form-qr.png").read_bytes())
    assert result.text_source == ("unavailable" if fail else "ocr")
    assert len(observed) == 1
    with pytest.raises(ValueError, match="closed image"):
        observed[0].getpixel((0, 0))


def test_reader_closes_source_image_decoder(monkeypatch: pytest.MonkeyPatch) -> None:
    from PIL import Image

    original_open = Image.open
    opened = []

    def capture_open(*args, **kwargs):
        image = original_open(*args, **kwargs)
        opened.append(image)
        return image

    monkeypatch.setattr(Image, "open", capture_open)
    monkeypatch.setattr(ocr, "extract_text", lambda _image: ocr.OcrResult("", 0.0))
    assert read_document((FIXTURE_DIR / "blank-valid.png").read_bytes()).text_source == "ocr"
    assert opened
    for image in opened:
        with pytest.raises(ValueError, match="closed image"):
            image.getpixel((0, 0))


def test_searchable_arabic_pdf_preserves_logical_label_and_ignores_date() -> None:
    from app.core.extraction.form_ref import candidate_refs

    result = read_document((FIXTURE_DIR / "classified-ref-ar.pdf").read_bytes())
    assert result == DocumentRead(
        text="وثيقة اختبار اصطناعية\nالرقم: 1/5/141\nالتاريخ: 05/09/2026\n",  # noqa: RUF001 - literal Arabic
        text_source="pdf_text",
    )
    assert candidate_refs(result.text) == ["1/5/141"]


@pytest.fixture(scope="module", autouse=True)
def verify_synthetic_fixture_manifest() -> None:
    manifest = json.loads((FIXTURE_DIR / "manifest.json").read_text(encoding="utf-8"))
    for name, expected in manifest["fixtures"].items():
        raw = (FIXTURE_DIR / name).read_bytes()
        assert len(raw) == expected["byte_length"], name
        assert hashlib.sha256(raw).hexdigest() == expected["sha256"], name


@pytest.fixture
def real_ocr() -> None:
    def unavailable(reason: str) -> None:
        if os.environ.get("GSSG_REQUIRE_REAL_OCR") == "1":
            pytest.fail(reason)
        pytest.skip(reason)

    cmd = ocr._resolve_tesseract_cmd()
    if cmd is None:
        unavailable("Real OCR pending: Tesseract executable unavailable")
        return
    for name in ("pytesseract", "zxingcpp", "aztec_code_generator"):
        try:
            importlib.import_module(name)
        except ImportError:
            unavailable(f"Real OCR pending: {name} unavailable")
    probe = subprocess.run([cmd, "--list-langs"], check=True, capture_output=True, text=True)
    languages = {line.strip() for line in probe.stdout.splitlines()}
    missing = {"ara", "eng", "osd"} - languages
    if missing:
        unavailable(f"Real OCR pending: missing language packs {sorted(missing)}")


def _normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())


def _assert_real_single_page(result: DocumentRead) -> None:
    assert result.text_source == "ocr", result
    assert result.qr_refs == ()
    assert result.unavailable_reason is None
    assert len(result.ocr_pages) == 1
    page = result.ocr_pages[0]
    assert page.page_index == 0
    assert page.text == result.text
    assert page.language == "ara+eng"
    assert isinstance(page.confidence, float)
    assert math.isfinite(page.confidence) and 0.0 <= page.confidence <= 1.0


def test_real_english_scan_uses_ara_eng_adapter(real_ocr: None) -> None:
    from app.core.extraction.form_ref import candidate_refs

    result = read_document((FIXTURE_DIR / "returned-form-scan-en.png").read_bytes())
    _assert_real_single_page(result)
    assert "Ref:" in _normalized(result.text), repr(result.text)
    assert "GS-0042" in _normalized(result.text), repr(result.text)
    assert candidate_refs(result.text) == ["GS-0042"]


def test_real_mixed_scan_uses_ara_eng_adapter(real_ocr: None) -> None:
    from app.core.extraction.form_ref import candidate_refs

    result = read_document((FIXTURE_DIR / "returned-form-scan-mixed.png").read_bytes())
    _assert_real_single_page(result)
    assert "الرقم" in _normalized(result.text), repr(result.text)
    assert "GS-0042" in _normalized(result.text), repr(result.text)
    assert candidate_refs(result.text) == ["GS-0042"]


def test_image_only_pdf_uses_ocr_per_page(real_ocr: None) -> None:
    from app.core.extraction.form_ref import candidate_refs

    raw = (FIXTURE_DIR / "returned-form-scan-en.pdf").read_bytes()
    assert ocr.pdf_text_layer(raw) == ""
    result = read_document(raw)
    _assert_real_single_page(result)
    assert "GS-0042" in _normalized(result.text), repr(result.text)
    assert candidate_refs(result.text) == ["GS-0042"]


def test_blank_valid_image_is_successful_empty_ocr(real_ocr: None) -> None:
    result = read_document((FIXTURE_DIR / "blank-valid.png").read_bytes())
    assert result == DocumentRead(
        text="", text_source="ocr", ocr_pages=(OcrPageEvidence(0, "", 0.0),)
    )


def test_reader_uses_existing_global_ocr_capacity(monkeypatch: pytest.MonkeyPatch) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    started = Event()
    reached_ocr = Event()

    def extract(_image):
        reached_ocr.set()
        return ocr.OcrResult("", 0.0)

    monkeypatch.setattr(ocr, "extract_text", extract)
    raw = (FIXTURE_DIR / "blank-valid.png").read_bytes()

    def read():
        started.set()
        return read_document(raw)

    assert ocr.OCR_GATE.acquire(timeout=2)
    assert ocr.OCR_GATE.acquire(timeout=2)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(read)
        try:
            assert started.wait(2)
            assert not reached_ocr.wait(0.1)
        finally:
            ocr.OCR_GATE.release()
            ocr.OCR_GATE.release()
        assert future.result(timeout=3) == DocumentRead(
            text="", text_source="ocr", ocr_pages=(OcrPageEvidence(0, "", 0.0),)
        )
        assert reached_ocr.is_set()


def test_pdf_ocr_failure_discards_partial_text_and_closes_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pymupdf.open() as pdf:
        for name in ("returned-form-qr.png", "blank-valid.png"):
            page = pdf.new_page(width=595, height=842)
            page.insert_image(
                pymupdf.Rect(35, 80, 300, 345), stream=(FIXTURE_DIR / name).read_bytes()
            )
        raw = pdf.tobytes()
    images = []

    def extract(image):
        images.append(image)
        if len(images) == 2:
            raise ocr.OcrUnavailableError("synthetic page two unavailable")
        return ocr.OcrResult("Partial text\n", 0.9)

    monkeypatch.setattr(ocr, "extract_text", extract)
    assert read_document(raw) == DocumentRead(
        text="",
        text_source="unavailable",
        qr_refs=("GS-0042",),
        unavailable_reason="synthetic page two unavailable",
    )
    assert len(images) == 2
    for image in images:
        with pytest.raises(ValueError, match="closed image"):
            image.getpixel((0, 0))


@pytest.mark.parametrize(
    "layer, source, text",
    [
        ("ABCDEFGHIJKLMNO", "ocr", "OCR fallback\n"),
        ("ABCDEFGHIJKLMNOP", "pdf_text", "ABCDEFGHIJKLMNOP\n"),
    ],
)
def test_pdf_text_authority_starts_at_sixteen_alphanumeric_characters(
    monkeypatch: pytest.MonkeyPatch, layer: str, source: str, text: str
) -> None:
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), layer)
        raw = pdf.tobytes()
    monkeypatch.setattr(ocr, "extract_text", lambda _image: ocr.OcrResult("OCR fallback\n", 0.74))
    result = read_document(raw)
    assert result.text == text
    assert result.text_source == source
    assert result.ocr_pages == (
        (OcrPageEvidence(0, "OCR fallback\n", 0.74),) if source == "ocr" else ()
    )


def test_real_external_scan_preserves_extracted_values_and_source_snippets(real_ocr: None) -> None:
    from app.core.extraction.types import DocType
    from app.services.extraction_service import run_pipeline

    result = read_document((FIXTURE_DIR / "external-multi-signal.png").read_bytes())
    _assert_real_single_page(result)
    extraction = run_pipeline(ocr_text=result.text, employees=[]).extraction
    assert extraction.raw_text == result.text
    assert extraction.doc_type == DocType.EMIRATES_ID, repr(result.text)
    assert extraction.alternatives == [DocType.BANK_IBAN], repr(result.text)
    expected = {
        "uae_id_no": ("784-1990-1234567-1", "784-1990-1234567-1"),
        "name_en": ("LAYLA HASSAN", "Name: LAYLA HASSAN"),
        "name_ar": ("ليلى حسن", "الاسم: ليلى حسن"),
        "expiry": ("2030-12-31", "Expiry Date: 31/12/2030"),
    }
    for key, (value, snippet) in expected.items():
        field = extraction.field(key)
        assert field is not None, (key, repr(result.text))
        assert field.value == value, (key, repr(result.text))
        assert _normalized(field.source_snippet) == snippet, (key, repr(result.text))
        assert field.source_snippet in result.text
