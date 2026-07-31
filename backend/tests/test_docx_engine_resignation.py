"""Resignation Letter / Declaration date adaptation.

The letter carries three date slots. `today` feeds the header and the
signature block (both the paper's creation date); only the body line
"بطلب إستقالة عن العمل بتاريخ __/__/__" follows the operator's
`resignation_date`.
"""

from app.core.docx_engine import _adapt_resignation_declaration, _adapt_resignation_letter


def test_body_date_follows_resignation_date_iso():
    """The date input sends ISO; the body cell must show that date."""
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": "2026-08-15"})
    assert (out["day"], out["month"], out["year"]) == ("15", "08", "2026")


def test_body_date_accepts_dd_mm_yyyy():
    """Legacy/template-shaped input still parses."""
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": "15/08/2026"})
    assert (out["day"], out["month"], out["year"]) == ("15", "08", "2026")


def test_today_is_not_shifted_by_the_resignation_date():
    """The header and signature dates stay on the creation day."""
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": "2026-08-15"})
    assert out["today"] == "30/07/2026"


def test_missing_resignation_date_falls_back_to_today():
    """The 5 pre-existing records, previews, and re-renders on sign have no
    `resignation_date` — they must keep rendering the creation date."""
    out = _adapt_resignation_letter({"today": "30/07/2026"})
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_unparseable_resignation_date_falls_back_to_today():
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": "not a date"})
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_blank_resignation_date_falls_back_to_today():
    out = _adapt_resignation_letter({"today": "30/07/2026", "resignation_date": ""})
    assert (out["day"], out["month"], out["year"]) == ("30", "07", "2026")


def test_reason_still_routes_from_purpose_plain():
    """Regression guard — this task must not disturb the reason routing."""
    out = _adapt_resignation_letter({"today": "30/07/2026", "purpose_plain": "  relocating  "})
    assert out["reason"] == "relocating"


def test_declaration_still_gets_arabic_weekday():
    """The companion Declaration has no resignation date — only weekday + today."""
    out = _adapt_resignation_declaration({"today": "30/07/2026"})
    assert out["today"] == "30/07/2026"
    assert out["weekday_ar"] == "الخميس"  # 30 July 2026 is a Thursday
