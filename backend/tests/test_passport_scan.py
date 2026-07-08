import pytest

from app.core.extraction import passport_scan as ps
from app.core.extraction.ocr import OcrUnavailableError
from app.core.extraction.types import DocType, ExtractedField, Extraction


class _FakeImg:
    """Stand-in for a PIL image; identity is all the tests need."""

    def __init__(self, tag: str) -> None:
        self.tag = tag


def test_pages_from_bytes_pdf_rasterises_and_caps(monkeypatch):
    monkeypatch.setattr(
        ps, "pdf_to_images", lambda raw, *, dpi: [_FakeImg(f"p{i}") for i in range(12)]
    )
    pages = ps.pages_from_bytes(b"%PDF-1.7 ...")
    assert len(pages) == ps.MAX_PAGES  # 12 pages capped to 8


def test_pages_from_bytes_image_returns_single(monkeypatch):
    sentinel = _FakeImg("img")
    monkeypatch.setattr(ps, "load_image", lambda raw: sentinel)
    pages = ps.pages_from_bytes(b"\xff\xd8\xff jpeg bytes")
    assert pages == [sentinel]


def test_ocr_mrz_pass_raises_when_tesseract_missing(monkeypatch):
    monkeypatch.setattr(ps, "_resolve_tesseract_cmd", lambda: None)
    with pytest.raises(OcrUnavailableError):
        ps.ocr_mrz_pass(_FakeImg("x"))


def _mrz_extraction(number: str, *, valid: bool) -> Extraction:
    conf = 0.95 if valid else 0.55
    return Extraction(
        doc_type=DocType.PASSPORT,
        doc_type_confidence=conf,
        fields=[ExtractedField("passport_no", number, conf)],
    )


def _wire_scoring(monkeypatch, valid_tokens=None, structural_tokens=None):
    """Make _orientations yield deterministic (deg, token) pairs, ocr_mrz_pass
    echo the token, and extract_passport map tokens -> Extraction."""
    valid_tokens = valid_tokens or set()
    structural_tokens = structural_tokens or set()
    monkeypatch.setattr(
        ps, "_orientations", lambda page: [(deg, f"{page}:{deg}") for deg in (0, 90, 180, 270)]
    )
    monkeypatch.setattr(ps, "ocr_mrz_pass", lambda token: token)

    def fake_extract(token: str):
        if token in valid_tokens:
            return _mrz_extraction("N1234567", valid=True)
        if token in structural_tokens:
            return _mrz_extraction("N7654321", valid=False)
        return None

    monkeypatch.setattr(ps, "extract_passport", fake_extract)


def test_best_mrz_picks_biodata_page_over_cover(monkeypatch):
    # cover page yields nothing; page 2 (index 1) has a valid MRZ upright.
    _wire_scoring(monkeypatch, valid_tokens={"biodata:0"})
    cand = ps.best_mrz(["cover", "biodata"])
    assert cand is not None
    assert cand.valid and cand.number == "N1234567"
    assert cand.page_index == 1 and cand.rotation == 0


def test_best_mrz_picks_correct_rotation(monkeypatch):
    # only the 180°-rotated render of the single page yields a valid MRZ.
    _wire_scoring(monkeypatch, valid_tokens={"page:180"})
    cand = ps.best_mrz(["page"])
    assert cand is not None and cand.valid and cand.rotation == 180


def test_best_mrz_returns_structural_when_no_valid(monkeypatch):
    _wire_scoring(monkeypatch, structural_tokens={"page:90"})
    cand = ps.best_mrz(["page"])
    assert cand is not None and not cand.valid
    assert cand.confidence == pytest.approx(0.55) and cand.number == "N7654321"


def test_best_mrz_none_when_nothing_found(monkeypatch):
    _wire_scoring(monkeypatch)
    assert ps.best_mrz(["a", "b"]) is None


def test_best_mrz_reraises_ocr_unavailable(monkeypatch):
    monkeypatch.setattr(ps, "_orientations", lambda page: [(0, page)])

    def boom(_):
        raise OcrUnavailableError("no tesseract")

    monkeypatch.setattr(ps, "ocr_mrz_pass", boom)
    with pytest.raises(OcrUnavailableError):
        ps.best_mrz(["p"])


def test_best_printed_prefers_mrz_context_page(monkeypatch):
    texts = {
        "cover": "Reference Passport No: X0000000 cover sheet",
        "bio": "Passport No: A7654321\nP<UAEDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<",
    }
    monkeypatch.setattr(ps, "extract_text", lambda page: type("R", (), {"text": texts[page]}))
    # Guard: the cover fixture must itself yield a number, else the preference
    # assertions below would be vacuously satisfied.
    cover_only = ps.best_printed_number(["cover"])
    assert cover_only is not None and cover_only[0] == "X0000000"
    # The MRZ-context (bio) page must win over the cover's number, in either order.
    assert ps.best_printed_number(["cover", "bio"])[0] == "A7654321"
    assert ps.best_printed_number(["bio", "cover"])[0] == "A7654321"
