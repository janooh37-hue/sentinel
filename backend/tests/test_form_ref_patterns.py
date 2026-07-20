"""OCR ref-candidate extraction — legacy ``GS-0048`` AND classified
``1/{tab}/GSSG/{serial}`` shapes, so signed-copy scan-backs auto-match both."""

from app.core.extraction.form_ref import candidate_refs


def test_legacy_stamped_ref_still_matches():
    assert candidate_refs("header Ref: GS-0048 body") == ["GS-0048"]


def test_classified_stamped_ref_matches():
    text = "some letterhead\nRef: 1/5/GSSG/141\nsubject line"
    assert candidate_refs(text)[0] == "1/5/GSSG/141"


def test_classified_bare_ref_matches_as_fallback():
    text = "الرقم: 1/12/GSSG/7 التاريخ 18-07-2026"
    assert "1/12/GSSG/7" in candidate_refs(text)


def test_stamped_hits_ordered_before_bare():
    text = "Ref: 1/5/GSSG/141 ... elsewhere HR-0012 appears"
    refs = candidate_refs(text)
    assert refs[0] == "1/5/GSSG/141"
    assert "HR-0012" in refs


def test_lowercase_ocr_read_normalised():
    assert candidate_refs("ref: 1/5/gssg/141")[0] == "1/5/GSSG/141"


def test_plain_date_not_matched():
    assert candidate_refs("التاريخ 18/07/2026") == []


def test_arabic_stamped_anchor_beats_bare_fallback():
    """Scan-back of a book with no English header stamp: the الرقم:-anchored
    ref must rank in the stamped tier, ahead of earlier bare-shaped noise."""
    text = "GS-0048 noise ... الرقم: 1/5/GSSG/141 التاريخ: 01-01-2026"
    refs = candidate_refs(text)
    assert refs[0] == "1/5/GSSG/141"


def test_new_ref_stamped_anchor_matches():
    assert "1/5/141" in candidate_refs("الرقم: 1/5/141")


def test_new_ref_bare_does_not_match():
    assert "1/5/141" not in candidate_refs("التاريخ 1/5/141 شيء ما")


def test_slash_date_ocr_no_match():
    assert candidate_refs("التاريخ 18/07/2026") == []
    assert candidate_refs("تاريخ الميلاد 1/5/2026") == []


def test_legacy_gssg_bare_still_matches():
    assert "1/12/GSSG/7" in candidate_refs("الرقم: 1/12/GSSG/7 التاريخ 18-07-2026")


def test_legacy_gssg_stamped_still_matches():
    assert candidate_refs("some letterhead\nRef: 1/5/GSSG/141\nsubject line")[0] == "1/5/GSSG/141"
