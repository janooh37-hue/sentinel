"""classify() must survive single-char OCR typos in anchor phrases, not just exact matches."""
from __future__ import annotations

from app.core.extraction.classifier import classify
from app.core.extraction.types import DocType


def test_exact_anchor_still_matches():
    doc, conf, _ = classify("SICK LEAVE certificate, number of days: 3")
    assert doc == DocType.SICK_LEAVE
    assert conf > 0.5


def test_ocr_typo_in_anchor_now_matches():
    # "Sick Leave" OCR'd with an 'l' misread as '1' (one substitution) used to fall to UNKNOWN.
    doc, _, _ = classify("Sick 1eave - medica1 certificate issued for 3 days")
    assert doc == DocType.SICK_LEAVE


def test_arabic_anchor_typo_now_matches():
    # one character dropped from "بطاقة هوية" (Emirates ID anchor), no "784-" digit
    # anchor present — isolates the fuzzy Arabic-phrase match specifically.
    doc, _, _ = classify("بطاقه هوية صادرة عن الهيئة")
    assert doc == DocType.EMIRATES_ID


def test_unrelated_text_still_unknown():
    doc, conf, _ = classify("random meeting notes about catering for Friday lunch")
    assert doc == DocType.UNKNOWN
    assert conf == 0.2


if __name__ == "__main__":
    test_exact_anchor_still_matches()
    test_ocr_typo_in_anchor_now_matches()
    test_arabic_anchor_typo_now_matches()
    test_unrelated_text_still_unknown()
    print("all classifier fuzzy tests passed")
