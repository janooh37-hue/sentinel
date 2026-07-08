# Passport OCR — offline rotation + multi-page MRZ selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably extract the passport number from stored passport scans regardless of page orientation, phone-photo/scan quality, or a cover page hiding the bio-data page — fully offline.

**Architecture:** A new image-level module (`passport_scan.py`) brute-forces page rotations and runs an MRZ-optimized Tesseract pass, scoring each page×rotation by the TD3 MRZ checksum — the checksum selects the real bio-data page and the upright orientation automatically. `passport_ocr_service.extract_passport_for_employee` becomes an escalation controller: a cheap upright pass first, image-level escalation only on failure. The write-safety policy is unchanged.

**Tech Stack:** Python 3.12, Pillow (PIL), pytesseract (Tesseract), PyMuPDF (fitz), the `mrz` TD3 checker, SQLAlchemy. No new dependencies.

## Global Constraints

- **Fully offline** — no external/cloud OCR. Only already-installed libs (PIL, pytesseract, PyMuPDF, `mrz`). No new dependency in `pyproject.toml`.
- **Live production checkout** — work on branch `feat/passport-ocr-rotation-multipage`; merge to `main` and push to `origin/main` when done, or `mng update` overwrites it.
- **Write safety unchanged** — `apply_passport_extraction` auto-writes ONLY a checksum-valid MRZ number (confidence ≥ `MRZ_AUTOWRITE_CONFIDENCE` = 0.9) into an EMPTY field. Structural-but-invalid MRZ (0.55) and printed matches (0.5) are review-only, never written.
- **Strict gates** — all Python runs through the repo venv: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check .` + `venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`. pytest runs with `filterwarnings=error`; mypy is `strict`. `pytesseract`, `fitz`, `mrz` are already in the mypy `ignore_missing_imports` override — import them inside functions, mirroring `app/core/extraction/ocr.py`.
- **No API-schema change** — the winning page/rotation is folded into the existing `source_snippet` string only. No Pydantic schema/route change, so no `openapi.json` / `api.types.ts` resync is needed.
- **Never fail the upload** — the passport upload hook (`employees.py`) is best-effort; every failure path in the extractor must degrade to a `"none"` result, never raise.

---

## File Structure

- **Create** `backend/app/core/extraction/passport_scan.py` — image-level MRZ orchestration: rasterize, rotate, MRZ-focused OCR, checksum scoring, per-page printed fallback. Pure logic with injectable OCR seams.
- **Create** `backend/tests/test_passport_scan.py` — unit tests for the above (no Tesseract; inject fakes).
- **Modify** `backend/app/services/passport_ocr_service.py` — turn `extract_passport_for_employee` into the escalation controller.
- **Modify** `backend/tests/test_passport_ocr_service.py` — add escalation tests; keep existing cheap-pass tests green.

---

### Task 1: `passport_scan.py` foundations — `MrzCandidate`, `pages_from_bytes`, `ocr_mrz_pass`

**Files:**
- Create: `backend/app/core/extraction/passport_scan.py`
- Test: `backend/tests/test_passport_scan.py`

**Interfaces:**
- Consumes: `app.core.extraction.ocr.{OCR_GATE, InvalidImageError, OcrUnavailableError, _resolve_tesseract_cmd, pdf_to_images, load_image}`.
- Produces:
  - `MAX_PAGES: int = 8`, `PASSPORT_DPI: int = 300`
  - `MrzCandidate` (frozen dataclass): `number: str`, `confidence: float`, `valid: bool`, `page_index: int`, `rotation: int`
  - `pages_from_bytes(raw: bytes) -> list[Image.Image]` — PDF → rasterize at `PASSPORT_DPI`, else single image; capped to `MAX_PAGES`.
  - `ocr_mrz_pass(image: Image.Image) -> str` — English-only, `--psm 6`, MRZ whitelist charset; acquires `OCR_GATE`; raises `OcrUnavailableError` if Tesseract missing.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_passport_scan.py`:

```python
import pytest

from app.core.extraction import passport_scan as ps
from app.core.extraction.ocr import OcrUnavailableError


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_scan.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.extraction.passport_scan'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/core/extraction/passport_scan.py`:

```python
"""Image-level passport MRZ extraction: rotation brute-force + per-page
checksum scoring.

Classical OCR of a passport fails on three fronts the office actually hits:
non-upright pages, phone-photo/scan quality, and a cover page hiding the real
bio-data page (page 2+ of a PDF/scan). This module rasterises each page,
tries every 90° rotation, runs an MRZ-optimised Tesseract pass, and scores the
result by the TD3 checksum — so the page and orientation that yield a valid MRZ
are selected automatically. Fully offline; no new dependencies.

Injectable seams for tests: ``ocr_mrz_pass``, ``extract_passport``,
``extract_text``, ``_orientations`` are module-level names so tests can
monkeypatch them without a real Tesseract.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass

from PIL import Image

from app.core.extraction.ocr import (
    OCR_GATE,
    InvalidImageError,
    OcrUnavailableError,
    _resolve_tesseract_cmd,
    extract_text,
    load_image,
    pdf_to_images,
)
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no

log = logging.getLogger(__name__)

# Cap pages scanned per document so a pathological large PDF can't run away.
MAX_PAGES = 8
# MRZ reads better at higher DPI than the general 200-DPI rasterise.
PASSPORT_DPI = 300
# The MRZ is OCR-B on [A-Z0-9<]; restricting the charset (and dropping Arabic,
# which corrupts the Latin MRZ font) is the single biggest accuracy lever.
_MRZ_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"
_MRZ_CONFIG = f"--psm 6 -c tessedit_char_whitelist={_MRZ_WHITELIST}"
_ROTATIONS = (0, 90, 180, 270)


@dataclass(frozen=True)
class MrzCandidate:
    number: str
    confidence: float
    valid: bool
    page_index: int
    rotation: int


def pages_from_bytes(raw: bytes) -> list[Image.Image]:
    """Rasterise a passport upload to a capped list of page images.

    A ``%PDF`` upload is rasterised at :data:`PASSPORT_DPI`; anything else is
    loaded as a single image. Capped to :data:`MAX_PAGES`. Corrupt input raises
    :class:`InvalidImageError` (the caller degrades to a review result).
    """
    if raw.startswith(b"%PDF"):
        images = pdf_to_images(raw, dpi=PASSPORT_DPI)
    else:
        images = [load_image(raw)]
    return images[:MAX_PAGES]


def ocr_mrz_pass(image: Image.Image) -> str:
    """MRZ-optimised Tesseract pass (English only, --psm 6, whitelist charset).

    Acquires the shared OCR gate for the single call so a multi-page brute
    force can't starve a concurrent live upload. Raises
    :class:`OcrUnavailableError` when the Tesseract binary is missing.
    """
    cmd = _resolve_tesseract_cmd()
    if cmd is None:
        raise OcrUnavailableError("Tesseract is not installed.")
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = cmd
    with OCR_GATE:
        return pytesseract.image_to_string(image, lang="eng", config=_MRZ_CONFIG)
```

(The remaining functions — `_osd_rotation`, `_orientations`, `best_mrz`, `looks_like_mrz`, `best_printed_number` — land in Task 2. The unused imports `Iterator`, `InvalidImageError`, `extract_text`, `extract_printed_passport_no`, `extract_passport` are consumed there; if `ruff` flags them as unused at this step, add them in Task 2 instead and re-import here then. To keep Task 1 lint-clean, import only what Task 1 uses and add the rest in Task 2.)

To keep Task 1 lint-clean, use this narrower import block for now and widen it in Task 2:

```python
from app.core.extraction.ocr import (
    OCR_GATE,
    OcrUnavailableError,
    _resolve_tesseract_cmd,
    load_image,
    pdf_to_images,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_scan.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint + typecheck the new module**

Run: `venv\Scripts\ruff.exe check backend/app/core/extraction/passport_scan.py backend/tests/test_passport_scan.py && venv\Scripts\mypy.exe backend/app/core/extraction/passport_scan.py`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/extraction/passport_scan.py backend/tests/test_passport_scan.py
git commit -m "feat(passport-ocr): passport_scan foundations (pages, mrz pass)"
```

---

### Task 2: Orientation + checksum scoring — `_orientations`, `best_mrz`, printed fallback

**Files:**
- Modify: `backend/app/core/extraction/passport_scan.py`
- Test: `backend/tests/test_passport_scan.py`

**Interfaces:**
- Consumes: Task 1's `MrzCandidate`, `ocr_mrz_pass`, `MAX_PAGES`; `extract_passport`, `extract_text`, `extract_printed_passport_no`.
- Produces:
  - `_osd_rotation(image: Image.Image) -> int | None` — Tesseract OSD → one of 0/90/180/270, or `None`.
  - `_orientations(image: Image.Image) -> Iterator[tuple[int, Image.Image]]` — OSD-first ordering, else all four rotations.
  - `best_mrz(pages: list[Image.Image]) -> MrzCandidate | None` — the scorer; short-circuits on the first checksum-valid MRZ, else returns the best structural candidate. Re-raises `OcrUnavailableError`.
  - `looks_like_mrz(text: str) -> bool` — heuristic: a line with ≥3 `<` fill chars.
  - `best_printed_number(pages: list[Image.Image]) -> tuple[str, str] | None` — per-page labelled-number regex, preferring an MRZ-context page; returns `(number, snippet)`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_passport_scan.py`:

```python
from app.core.extraction.types import DocType, ExtractedField, Extraction


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
    got = ps.best_printed_number(["cover", "bio"])
    assert got == ("A7654321", pytest.approx(got[1])) or got[0] == "A7654321"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_scan.py -v`
Expected: FAIL with `AttributeError: module 'app.core.extraction.passport_scan' has no attribute 'best_mrz'` (and `_orientations`, `best_printed_number`).

- [ ] **Step 3: Write the implementation**

First, widen the `ocr` import block at the top of `passport_scan.py` back to the full set (add `extract_text`) and keep the `passport_mrz` / `passport_printed` imports:

```python
from collections.abc import Iterator

from app.core.extraction.ocr import (
    OCR_GATE,
    OcrUnavailableError,
    _resolve_tesseract_cmd,
    extract_text,
    load_image,
    pdf_to_images,
)
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no
```

Then append these functions to `passport_scan.py`:

```python
def _osd_rotation(image: Image.Image) -> int | None:
    """Detected upright rotation (0/90/180/270) via Tesseract OSD, or None.

    OSD needs enough text and can fail on noisy photos — any failure returns
    None so the caller brute-forces all four rotations.
    """
    cmd = _resolve_tesseract_cmd()
    if cmd is None:
        return None
    import pytesseract

    pytesseract.pytesseract.tesseract_cmd = cmd
    try:
        osd = pytesseract.image_to_osd(image, output_type=pytesseract.Output.DICT)
    except Exception:  # noqa: BLE001 — OSD is best-effort; any failure -> brute force
        return None
    rotation = int(osd.get("rotate", 0)) % 360
    return rotation if rotation in _ROTATIONS else None


def _orientations(image: Image.Image) -> Iterator[tuple[int, Image.Image]]:
    """Yield (degrees, rotated_image) for each 90° rotation.

    OSD's suggestion is tried first to short-circuit sooner; all four are still
    covered because the MRZ checksum is the real arbiter. ``expand=True`` keeps
    the whole page after rotation.
    """
    suggested = _osd_rotation(image)
    order = list(_ROTATIONS)
    if suggested is not None:
        order = [suggested] + [d for d in _ROTATIONS if d != suggested]
    for deg in order:
        yield deg, (image if deg == 0 else image.rotate(-deg, expand=True))


def best_mrz(pages: list[Image.Image]) -> MrzCandidate | None:
    """Best MRZ candidate across pages × rotations, scored by TD3 checksum.

    Short-circuits on the first checksum-valid MRZ (confidence 0.95). Otherwise
    returns the highest-confidence structural candidate (0.55), or None.
    A per-page/rotation Tesseract error is skipped; a missing binary re-raises.
    """
    best: MrzCandidate | None = None
    for idx, page in enumerate(pages):
        for rotation, img in _orientations(page):
            try:
                text = ocr_mrz_pass(img)
            except OcrUnavailableError:
                raise
            except Exception:  # noqa: BLE001 — a bad page/rotation must not fail the doc
                log.debug("mrz pass failed (page=%d rot=%d)", idx, rotation, exc_info=True)
                continue
            extraction = extract_passport(text)
            if extraction is None:
                continue
            field = extraction.field("passport_no")
            if not (field and field.value):
                continue
            cand = MrzCandidate(
                number=field.value[:64],
                confidence=extraction.doc_type_confidence,
                valid=extraction.doc_type_confidence >= 0.9,
                page_index=idx,
                rotation=rotation,
            )
            if cand.valid:
                return cand
            if best is None or cand.confidence > best.confidence:
                best = cand
    return best


def looks_like_mrz(text: str) -> bool:
    """True if any line looks like an MRZ row (several ``<`` fill characters)."""
    for line in text.upper().splitlines():
        stripped = line.strip().replace(" ", "")
        if stripped.count("<") >= 3 and len(stripped) >= 20:
            return True
    return False


def best_printed_number(pages: list[Image.Image]) -> tuple[str, str] | None:
    """Labelled passport number read per page (ara+eng), review-only.

    Runs the label regex on each page independently — never on concatenated
    text — and prefers a page that also contains MRZ-like content (the
    bio-data page), so a reference/partial number on a cover page can't win.
    Falls back to the last matching page otherwise. Returns (number, snippet).
    """
    best: tuple[bool, str, str] | None = None  # (has_mrz_context, number, snippet)
    for page in pages:
        with OCR_GATE:
            text = extract_text(page).text
        hit = extract_printed_passport_no(text)
        if hit is None:
            continue
        number, snippet = hit
        has_mrz = looks_like_mrz(text)
        if best is None or (has_mrz and not best[0]) or (not best[0] and not has_mrz):
            best = (has_mrz, number, snippet)
    if best is None:
        return None
    return best[1], best[2]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_scan.py -v`
Expected: PASS (all tests).

- [ ] **Step 5: Lint + typecheck**

Run: `venv\Scripts\ruff.exe check backend/app/core/extraction/passport_scan.py backend/tests/test_passport_scan.py && venv\Scripts\ruff.exe format --check backend/app/core/extraction/passport_scan.py && venv\Scripts\mypy.exe backend/app/core/extraction/passport_scan.py`
Expected: no errors. (If `ruff format --check` reports a diff, run `venv\Scripts\ruff.exe format backend/app/core/extraction/passport_scan.py` and re-check.)

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/extraction/passport_scan.py backend/tests/test_passport_scan.py
git commit -m "feat(passport-ocr): rotation + per-page MRZ checksum scoring"
```

---

### Task 3: Rewire the controller — `extract_passport_for_employee` escalation

**Files:**
- Modify: `backend/app/services/passport_ocr_service.py`
- Test: `backend/tests/test_passport_ocr_service.py`

**Interfaces:**
- Consumes: `passport_scan.{pages_from_bytes, best_mrz, best_printed_number, MrzCandidate}`; existing `ocr_bytes_to_text`, `extract_passport`, `extract_printed_passport_no`, `PassportExtractResult`, `MRZ_AUTOWRITE_CONFIDENCE`, `vault_service`.
- Produces: same `PassportExtractResult` contract (methods `"mrz"`/`"printed"`/`"none"`), with the winning page/rotation folded into `source_snippet` for escalated MRZ hits. `apply_passport_extraction` is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_passport_ocr_service.py`:

```python
def test_escalation_returns_valid_mrz_when_cheap_pass_fails(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    # cheap upright pass finds no MRZ...
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz here")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    # ...but escalation rasterises + finds a valid MRZ on page 2, rotated 180°.
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1", "p2"])
    monkeypatch.setattr(
        svc,
        "best_mrz",
        lambda pages: svc.MrzCandidate(
            number="N1234567", confidence=0.95, valid=True, page_index=1, rotation=180
        ),
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567" and res.confidence >= 0.9
    assert "page 2" in res.source_snippet and "180" in res.source_snippet


def test_escalation_structural_mrz_is_review_only(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1"])
    monkeypatch.setattr(
        svc,
        "best_mrz",
        lambda pages: svc.MrzCandidate(
            number="N7654321", confidence=0.55, valid=False, page_index=0, rotation=0
        ),
    )
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N7654321"
    # 0.55 < MRZ_AUTOWRITE_CONFIDENCE -> apply() refuses to write it.
    assert svc.apply_passport_extraction(db_session, emp, res) is False


def test_escalation_falls_back_to_printed(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "no mrz")
    monkeypatch.setattr(svc, "extract_passport", lambda t: None)
    monkeypatch.setattr(svc, "pages_from_bytes", lambda raw: ["p1"])
    monkeypatch.setattr(svc, "best_mrz", lambda pages: None)
    monkeypatch.setattr(svc, "best_printed_number", lambda pages: ("A7654321", "Passport No: A7654321"))
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "printed" and res.number == "A7654321" and res.confidence < 0.9


def test_escalation_not_reached_when_cheap_pass_valid(db_session, emp, monkeypatch, tmp_path):
    _fake_tree_with_passport(monkeypatch, tmp_path)
    monkeypatch.setattr(svc, "ocr_bytes_to_text", lambda raw: "IGNORED")
    from app.core.extraction.types import DocType, ExtractedField, Extraction

    monkeypatch.setattr(
        svc,
        "extract_passport",
        lambda t: Extraction(
            doc_type=DocType.PASSPORT,
            doc_type_confidence=0.95,
            fields=[ExtractedField("passport_no", "N1234567", 0.95)],
        ),
    )

    def _boom(pages):
        raise AssertionError("escalation must not run when the cheap pass is valid")

    monkeypatch.setattr(svc, "best_mrz", _boom)
    res = svc.extract_passport_for_employee(db_session, "G7001")
    assert res.method == "mrz" and res.number == "N1234567"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_ocr_service.py -v`
Expected: the four new tests FAIL (`AttributeError: ... has no attribute 'pages_from_bytes'` / `best_mrz` / `MrzCandidate`); the existing tests still pass.

- [ ] **Step 3: Rewrite the controller**

In `backend/app/services/passport_ocr_service.py`, replace the imports block and the `extract_passport_for_employee` function. Update the imports near the top:

```python
from app.core.extraction.ocr import (
    InvalidImageError,
    OcrUnavailableError,
    ocr_bytes_to_text,
)
from app.core.extraction.passport_mrz import extract_passport
from app.core.extraction.passport_printed import extract_printed_passport_no
from app.core.extraction.passport_scan import (
    MrzCandidate,
    best_mrz,
    best_printed_number,
    pages_from_bytes,
)
```

Then replace the whole `extract_passport_for_employee` function body with:

```python
def extract_passport_for_employee(db: Session, g_number: str) -> PassportExtractResult | None:
    """OCR the employee's newest passport scan → result. None if no scan.

    Escalating: a cheap upright pass first (fast for clean docs); on failure,
    rasterise and brute-force rotations with per-page MRZ checksum scoring; a
    labelled-number printed read is the last, review-only resort.
    """
    filename = _newest_passport_scan(g_number)
    if filename is None:
        return None

    path: Path = vault_service.resolve_file(g_number, "passport", filename)
    raw = path.read_bytes()

    # Step 1 — cheap upright pass. A checksum-valid MRZ here returns immediately.
    try:
        text = ocr_bytes_to_text(raw)
    except OcrUnavailableError:
        log.warning("passport OCR unavailable for %s", g_number)
        return PassportExtractResult(None, 0.0, "none", None, filename)
    except InvalidImageError:
        return PassportExtractResult(None, 0.0, "none", None, filename)

    cheap = extract_passport(text)
    if cheap is not None:
        f = cheap.field("passport_no")
        if f and f.value and cheap.doc_type_confidence >= MRZ_AUTOWRITE_CONFIDENCE:
            return PassportExtractResult(
                f.value[:64], cheap.doc_type_confidence, "mrz", None, filename
            )

    # Step 2 — escalate: rotation brute-force + per-page checksum scoring.
    try:
        pages = pages_from_bytes(raw)
    except InvalidImageError:
        pages = []

    structural: PassportExtractResult | None = None
    if pages:
        try:
            cand: MrzCandidate | None = best_mrz(pages)
        except OcrUnavailableError:
            return PassportExtractResult(None, 0.0, "none", None, filename)
        if cand is not None:
            snippet = f"page {cand.page_index + 1}, rotation {cand.rotation}°"
            result = PassportExtractResult(cand.number, cand.confidence, "mrz", snippet, filename)
            if cand.valid:
                return result
            structural = result

    # Fall back to the cheap pass's structural (checksum-failing) MRZ if escalation
    # produced nothing. Both are review-only (below the auto-write threshold).
    if structural is None and cheap is not None:
        f = cheap.field("passport_no")
        if f and f.value:
            structural = PassportExtractResult(
                f.value[:64], cheap.doc_type_confidence, "mrz", None, filename
            )
    if structural is not None:
        return structural

    # Step 3 — printed fallback: per page when we have rasters, else the cheap
    # concatenated text. Review-only; never auto-written.
    printed = best_printed_number(pages) if pages else None
    if printed is None:
        printed = extract_printed_passport_no(text)
    if printed is not None:
        number, snippet = printed
        return PassportExtractResult(number[:64], 0.5, "printed", snippet, filename)

    return PassportExtractResult(None, 0.0, "none", None, filename)
```

- [ ] **Step 4: Run the full passport test suite**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_passport_ocr_service.py backend/tests/test_passport_scan.py backend/tests/test_passport_mrz.py backend/tests/test_passport_printed.py backend/tests/test_passport_extract_endpoint.py backend/tests/test_passport_upload_hook.py backend/tests/test_backfill_passport_no.py -v`
Expected: PASS (existing cheap-pass + write-policy tests, plus the new escalation tests).

- [ ] **Step 5: Lint + typecheck the changed files**

Run: `venv\Scripts\ruff.exe check backend/app/services/passport_ocr_service.py backend/tests/test_passport_ocr_service.py && venv\Scripts\ruff.exe format --check backend/app/services/passport_ocr_service.py && venv\Scripts\mypy.exe backend/app/services/passport_ocr_service.py`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/passport_ocr_service.py backend/tests/test_passport_ocr_service.py
git commit -m "feat(passport-ocr): escalate to rotation/multi-page MRZ on cheap-pass miss"
```

---

### Task 4: Full-suite verification, self-review, and merge prep

**Files:** none (verification + merge).

- [ ] **Step 1: Run the entire backend test suite**

Run: `venv\Scripts\python.exe -m pytest`
Expected: all tests pass; no warnings (the suite runs with `filterwarnings=error`).

- [ ] **Step 2: Repo-wide lint + format + strict typecheck**

Run: `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check . && venv\Scripts\mypy.exe`
Expected: no errors. Fix any formatting with `venv\Scripts\ruff.exe format .` and re-run.

- [ ] **Step 3: Confirm no dependency or API-schema drift**

Run: `git diff --stat main -- pyproject.toml backend/openapi.json frontend/src/lib/api.types.ts`
Expected: EMPTY output — this change adds no dependency and no schema/route change, so none of these files should differ from `main`. (If any differ, something unintended changed; investigate before merging.)

- [ ] **Step 4: Manual smoke on the server (real scans, no automated PII fixtures)**

Run the backfill in dry-run to exercise the real pipeline against stored passport scans:

`venv\Scripts\python.exe -m scripts.backfill_passport_no`
Expected: prints `filled / needs_review / no_scan` buckets. Confirm the "filled (auto-written MRZ)" count is higher than before this change on the same data (rotated/cover-page scans that previously landed in `needs_review` should now be auto-filled). Do NOT pass `--apply` yet — this is a read-only confidence check.

- [ ] **Step 5: Merge to main and push**

```bash
git checkout main
git merge --no-ff feat/passport-ocr-rotation-multipage
git push origin main
```

(Per the repo's live-production rule, the fix only takes effect on the office server after it is pushed to `origin/main` and `mng update` pulls it.)

- [ ] **Step 6: Deploy + optional apply**

Deploy the pulled code (`scripts\mng.ps1 update` on the server pulls + builds + restarts). After deploy, optionally run the backfill with writes to fill the newly-recoverable numbers: `venv\Scripts\python.exe -m scripts.backfill_passport_no --apply` (this backs up the DB first). Spot-check a few auto-filled employees' passport numbers against their scans before trusting the batch.

---

## Self-Review

**Spec coverage:**
- Offline constraint → no new deps; Task 4 Step 3 asserts `pyproject.toml` unchanged. ✓
- Orientation → `_orientations` + `best_mrz` (Task 2); `test_best_mrz_picks_correct_rotation`. ✓
- Cover-page / multi-page selection → `best_mrz` checksum scoring across pages; `test_best_mrz_picks_biodata_page_over_cover`. ✓
- Mixed quality → MRZ whitelist pass + 300 DPI (`ocr_mrz_pass`, `PASSPORT_DPI`). ✓
- Escalation / live-snappy → cheap pass returns early (Task 3); `test_escalation_not_reached_when_cheap_pass_valid`. ✓
- Printed fallback per-page, review-only → `best_printed_number` + controller Step 3; `test_best_printed_prefers_mrz_context_page`, `test_escalation_falls_back_to_printed`. ✓
- Write safety unchanged → `apply_passport_extraction` untouched; `test_escalation_structural_mrz_is_review_only`. ✓
- Error handling never fails upload → controller degrades to `"none"` on `OcrUnavailableError`/`InvalidImageError`; `best_mrz` skips bad pages. ✓
- Performance guardrails → `MAX_PAGES` cap, short-circuit on valid, OSD-first, per-call `OCR_GATE`. ✓
- Backfill + live both covered → same chokepoint; Task 4 Step 4 exercises backfill. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test shows real assertions. ✓

**Type consistency:** `MrzCandidate` fields (`number`, `confidence`, `valid`, `page_index`, `rotation`) are identical across `passport_scan.py`, `best_mrz`, and the controller tests. `best_mrz -> MrzCandidate | None`, `best_printed_number -> tuple[str, str] | None`, `pages_from_bytes -> list[Image.Image]` used consistently. Controller re-exports `MrzCandidate` (imported) so tests reference `svc.MrzCandidate`. ✓
