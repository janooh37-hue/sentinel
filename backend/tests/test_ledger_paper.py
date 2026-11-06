from __future__ import annotations

from dataclasses import replace
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import ledger_paper_assets
from app.core.grades import GRADE_CODES, paper_mark
from app.core.ledger_paper import PaperContext, paper_response, render_paper
from app.core.qr import barcode_payload

ISSUED = PaperContext(
    body_html="<p>نص الكتاب</p>",
    subjects=("طلب صيانة",),
    grade="unclassified",
    ref="1/11/42",
    paper_date=date(2026, 10, 28),
    draft_number=None,
    submitter_g_number="G1234",
    viewer_g_number="G7788",
    asset_base="/api/v1/ledger/paper-assets",
)
DRAFT = replace(ISSUED, ref=None, paper_date=None, draft_number="000123")


def test_draft_has_watermark_and_no_ref_date_or_barcode() -> None:
    html = render_paper(DRAFT)

    assert "DRAFT" in html and "مسودة" in html and "000123" in html
    assert "1/11/42" not in html
    assert "28-10-2026" not in html
    assert "*GSSG+" not in html
    assert 'class="barcode"' not in html


def test_issued_paper_has_ref_date_and_barcode_payload() -> None:
    html = render_paper(ISSUED)

    assert "1/11/42" in html
    assert "28-10-2026" in html
    assert barcode_payload("1/11/42", date(2026, 10, 28)) in html
    assert "DRAFT" not in html
    assert "G1234" in html


def test_barcode_prints_bars_only_with_no_readable_number_under_it() -> None:
    html = render_paper(ISSUED)
    payload = barcode_payload("1/11/42", date(2026, 10, 28))

    assert html.count(payload) == 1
    assert f'<div class="barcode" aria-hidden="true">{payload}</div>' in html


@pytest.mark.parametrize("grade", GRADE_CODES)
def test_grade_mark_follows_grade(grade: str) -> None:
    html = render_paper(replace(ISSUED, grade=grade))
    mark = paper_mark(grade)

    if mark is None:
        assert 'class="mark"' not in html
    else:
        assert f'<div class="mark">{mark}</div>' in html


@pytest.mark.parametrize("grade", GRADE_CODES)
def test_viewer_g_number_tiles_the_page_only_for_secret_and_above(grade: str) -> None:
    html = render_paper(replace(ISSUED, grade=grade))

    if grade == "unclassified":
        assert "G7788" not in html
    else:
        # Repeated across the whole sheet, not printed once.
        assert html.count("G7788") >= 12


def test_each_to_gets_its_own_salutation_line_then_one_greeting() -> None:
    html = render_paper(replace(ISSUED, to_names=("مدير المشروع", "مدير الفرع")))

    first = html.index("السيد \\ مدير المشروع المحترم")
    second = html.index("السيد \\ مدير الفرع المحترم")
    greeting = html.index("تحية طيبة وبعد،")
    assert first < second < greeting < html.index("طلب صيانة")
    assert html.count("تحية طيبة وبعد،") == 1


def test_no_to_prints_no_salutation() -> None:
    html = render_paper(ISSUED)

    assert "السيد" not in html
    assert "تحية طيبة" not in html


def test_subject_label_prints_once_before_every_line_in_order() -> None:
    html = render_paper(replace(ISSUED, subjects=("طلب صيانة", "المبنى الإداري", "الطابق الثاني")))

    assert html.count("الموضوع:") == 1
    label = html.index("الموضوع:")
    assert (
        label < html.index("طلب صيانة") < html.index("المبنى الإداري") < html.index("الطابق الثاني")
    )


def test_signer_name_and_title_print_with_signature_only_once_signed() -> None:
    unsigned = render_paper(replace(ISSUED, signer_name="أحمد علي", signer_title="مدير الفرع"))
    signed = replace(
        ISSUED,
        signer_name="أحمد علي",
        signer_title="مدير الفرع",
        signature_src="/api/v1/ledger/books/7/signature?revision=3",
    )
    html = render_paper(signed)

    for paper in (unsigned, html):
        assert paper.index("نص الكتاب") < paper.index("أحمد علي") < paper.index("مدير الفرع")
    assert "<img" not in unsigned.split("أحمد علي")[0].split('class="body"')[1]
    sig = html.index('src="/api/v1/ledger/books/7/signature?revision=3"')
    assert html.index("نص الكتاب") < sig < html.index("أحمد علي")


def test_no_signer_prints_no_signature_block() -> None:
    html = render_paper(replace(ISSUED, signature_src="/sig.png"))

    assert "/sig.png" not in html


def test_cc_prints_under_the_signature_one_per_line() -> None:
    html = render_paper(
        replace(ISSUED, signer_name="أحمد علي", cc_names=("قسم الموارد البشرية", "قسم المالية"))
    )

    label = html.index("نسخة إلى:")
    assert html.index("أحمد علي") < label
    assert label < html.index("قسم الموارد البشرية") < html.index("قسم المالية")
    assert html.count("نسخة إلى:") == 1


def test_no_cc_prints_no_copy_line() -> None:
    assert "نسخة إلى" not in render_paper(ISSUED)


def test_text_fields_are_escaped_and_output_has_no_script() -> None:
    hostile = '<script>alert("x")</script> \' "q"'
    html = render_paper(
        replace(
            DRAFT,
            grade="secret",
            subjects=(hostile, "second"),
            viewer_g_number=hostile,
            draft_number=hostile,
            submitter_g_number=hostile,
            asset_base='/x"><script>',
            to_names=(hostile,),
            cc_names=(hostile,),
            signer_name=hostile,
            signer_title=hostile,
            signature_src='/s"><script>',
        )
    )

    assert "<script" not in html.lower()
    assert "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#x27; &quot;q&quot;" in html
    assert html.index("&lt;script&gt;alert") < html.index("second")


def test_paper_response_sets_hardened_headers() -> None:
    response = paper_response(render_paper(ISSUED))

    assert response.headers["content-security-policy"] == (
        "sandbox allow-same-origin allow-modals; default-src 'none'; img-src 'self'; "
        "font-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; "
        "form-action 'none'; frame-ancestors 'self'"
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.media_type == "text/html"


def test_every_referenced_asset_is_served() -> None:
    html = render_paper(replace(ISSUED, asset_base="/a"))

    for name in ledger_paper_assets.ASSETS:
        assert (ledger_paper_assets.ASSET_DIR / name).is_file()
    referenced = {part.split("'")[0].split('"')[0] for part in html.split("/a/")[1:]}
    assert referenced == set(ledger_paper_assets.ASSETS)


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(ledger_paper_assets.router, prefix="/api/v1")
    return TestClient(app)


@pytest.mark.parametrize(
    ("name", "media_type"),
    [
        ("letterhead-logo.png", "image/png"),
        ("NotoNaskhArabic-Regular.ttf", "font/ttf"),
        ("LibreBarcode39-Regular.ttf", "font/ttf"),
    ],
)
def test_asset_router_serves_allowlisted_files(
    client: TestClient, name: str, media_type: str
) -> None:
    response = client.get(f"/api/v1/ledger/paper-assets/{name}")

    assert response.status_code == 200
    assert response.headers["content-type"] == media_type
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "max-age=31536000" in response.headers["cache-control"]
    assert response.content == (ledger_paper_assets.ASSET_DIR / name).read_bytes()


@pytest.mark.parametrize(
    "path",
    [
        "NotoNaskhArabic-OFL.txt",
        "missing.png",
        "..%2Fledger_paper.py",
        "..%2F..%2F..%2Fapp%2Fmain.py",
        "%2E%2E%2Fledger_paper.py",
        "../ledger_paper.py",
    ],
)
def test_asset_router_404s_unknown_and_traversal(client: TestClient, path: str) -> None:
    response = client.get(f"/api/v1/ledger/paper-assets/{path}")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Presets, bottom block, fonts, tables and the layout pin
# ---------------------------------------------------------------------------

FULL = replace(
    ISSUED,
    to_names=("مدير المشتريات",),
    cc_names=("قسم المالية", "Contact <x>"),
    signer_name="أحمد علي",
    signer_title="مدير الفرع",
    writer_name="سالم كاتب",
    writer_g_number="G4321",
    references=(("1/5/40", date(2026, 3, 4)), ("5/1/41", date(2025, 12, 31))),
    folder_names=("ملف العقود", "Team <Projects>"),
)


def _css_rule(html: str, selector: str) -> str:
    start = html.index(selector + " {")
    return html[start : html.index("}", start)]


def _font_faces(html: str, family: str) -> list[str]:
    return [
        rule.split("}")[0]
        for rule in html.split("@font-face")[1:]
        if f"font-family: '{family}'" in rule.split("}")[0]
    ]


def test_bottom_block_prints_after_signoff_in_order_with_each_label_once() -> None:
    html = render_paper(FULL)

    signoff = html.index("مدير الفرع")
    copies, refs, files = (
        html.index(label) for label in ("نسخة إلى:", "إشارة إلى:", "نسخة إلى الملف:")
    )
    assert signoff < copies < html.index("قسم المالية") < html.index("Contact &lt;x&gt;") < refs
    assert refs < html.index("1/5/40") < html.index("5/1/41") < files
    assert files < html.index("ملف العقود") < html.index("Team &lt;Projects&gt;")
    for label in ("نسخة إلى:", "إشارة إلى:", "نسخة إلى الملف:"):
        assert html.count(label) == 1


def test_reference_line_has_western_date_and_an_isolated_ltr_ref() -> None:
    html = render_paper(FULL)

    assert 'كتاب رقم <span class="ref">1/5/40</span> بتاريخ 04/03/2026' in html
    assert 'كتاب رقم <span class="ref">5/1/41</span> بتاريخ 31/12/2025' in html
    assert "unicode-bidi: isolate; direction: ltr" in _css_rule(html, ".bottom .ref")


def test_empty_bottom_block_sections_are_omitted() -> None:
    html = render_paper(replace(FULL, cc_names=(), references=()))

    assert "نسخة إلى:" not in html and "إشارة إلى:" not in html
    assert html.index("مدير الفرع") < html.index("نسخة إلى الملف:")


def test_bottom_block_escapes_every_entry() -> None:
    hostile = '<script>alert("x")</script>'
    html = render_paper(
        replace(FULL, references=((hostile, date(2026, 1, 2)),), folder_names=(hostile,))
    )

    assert "<script" not in html.lower()
    assert html.count("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;") == 2


def test_normal_preset_keeps_opening_subject_and_single_signoff() -> None:
    html = render_paper(FULL)

    assert html.index("السيد \\ مدير المشتريات المحترم") < html.index("تحية طيبة وبعد،")
    assert html.index("تحية طيبة وبعد،") < html.index("الموضوع:") < html.index("نص الكتاب")
    assert "تقرير" not in html and "إعداد" not in html and "اعتماد" not in html
    assert "counter-increment" not in html


def test_report_preset_has_title_two_signoffs_and_no_opening() -> None:
    html = render_paper(
        replace(FULL, preset="report", signature_src="/api/v1/ledger/books/7/signature?revision=3")
    )

    assert "السيد \\" not in html and "تحية طيبة وبعد،" not in html
    assert "الموضوع:" not in html
    report, title, body = html.index(">تقرير<"), html.index(">طلب صيانة<"), html.index("نص الكتاب")
    assert report < title < body
    title_css = _css_rule(html, ".report-title")
    assert "text-align: center" in title_css and "font-weight: bold" in title_css
    assert "font-size: 20pt" in title_css
    prepared, approved = html.index("إعداد"), html.index("اعتماد")
    assert body < prepared < html.index("سالم كاتب") < html.index("G4321") < approved
    signature = html.index('src="/api/v1/ledger/books/7/signature?revision=3"')
    assert approved < signature < html.index("أحمد علي")
    assert "display: flex" in _css_rule(html, ".signoffs")
    assert html.index("أحمد علي") < html.index("نسخة إلى:") < html.index("نسخة إلى الملف:")


def test_report_preset_numbers_body_headings_only() -> None:
    report = render_paper(replace(FULL, preset="report"))

    assert "counter-increment: h2" in _css_rule(report, ".body h2")
    assert "counter-increment: h3" in _css_rule(report, ".body h3")
    assert 'content: counter(h2) "." counter(h3)' in _css_rule(report, ".body h3::before")


def test_report_without_signature_prints_no_image() -> None:
    html = render_paper(replace(FULL, preset="report"))

    assert '<img class="signature"' not in html


def test_unknown_layout_or_preset_refuses_to_render() -> None:
    with pytest.raises(ValueError, match="layout"):
        render_paper(replace(FULL, layout=2))
    with pytest.raises(ValueError, match="preset"):
        render_paper(replace(FULL, preset="poster"))


def test_body_font_and_size_and_licensed_fonts_are_local_only() -> None:
    html = render_paper(FULL)

    body = _css_rule(html, "\nbody")
    assert 'font-family: Calibri, "Sakkal Majalla", "GSSG Naskh", serif' in body
    assert "font-size: 16pt" in body
    for family in ("Calibri", "Sakkal Majalla", "Univers Next Arabic"):
        faces = _font_faces(html, family)
        assert faces, family
        assert all("local(" in face and "url(" not in face for face in faces)
    univers = _font_faces(html, "Univers Next Arabic")
    assert any(
        'local("Univers Next Arabic"), local("Univers Next Arabic Regular")' in f for f in univers
    )
    assert any(
        "font-weight: 700" in f
        and 'local("Univers Next Arabic Bold"), local("UniversNextArabic-Bold")' in f
        for f in univers
    )
    noto = " ".join(_font_faces(html, "Noto Naskh Arabic"))
    assert "/NotoNaskhArabic-Regular.ttf" in noto and "/NotoNaskhArabic-Bold.ttf" in noto


def test_body_tables_fit_the_text_column() -> None:
    html = render_paper(FULL)

    table = _css_rule(html, ".body table")
    for rule in (
        "inline-size: 100%",
        "max-inline-size: 100%",
        "table-layout: fixed",
        "margin-inline: auto",
        "border-collapse: collapse",
    ):
        assert rule in table
    assert "overflow-wrap: anywhere" in _css_rule(html, ".body td, .body th")
    assert "display: table-header-group" in _css_rule(html, ".body thead")
    assert "break-inside: avoid" in _css_rule(html, ".body tr")
    assert "max-inline-size: 100%" in _css_rule(html, ".body img")
    # The outer page frame must not grow with a wide (Word-pasted) table.
    frame = _css_rule(html, ".frame")
    assert "table-layout: fixed" in frame and "inline-size: 100%" in frame
