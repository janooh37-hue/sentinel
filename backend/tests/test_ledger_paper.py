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
    urgency="High",
    ref="1/11/42",
    paper_date=date(2026, 10, 28),
    draft_number=None,
    submitter_g_number="G1234",
    viewer_name="Viewer Person",
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


@pytest.mark.parametrize(
    ("urgency", "label"), [("Normal", None), ("High", "عاجل"), ("Very High", "عاجل جداً")]
)
def test_urgency_prints_once_only_when_not_normal(urgency: str, label: str | None) -> None:
    html = render_paper(replace(ISSUED, urgency=urgency))

    if label is None:
        assert "الاستعجال" not in html
    else:
        assert html.count("الاستعجال") == 1
        assert f"الاستعجال: {label}<" in html


@pytest.mark.parametrize("grade", GRADE_CODES)
def test_grade_mark_follows_grade(grade: str) -> None:
    html = render_paper(replace(ISSUED, grade=grade))
    mark = paper_mark(grade)

    if mark is None:
        assert 'class="mark"' not in html
    else:
        assert f'<div class="mark">{mark}</div>' in html


@pytest.mark.parametrize("grade", GRADE_CODES)
def test_viewer_watermark_only_for_secret_and_above(grade: str) -> None:
    html = render_paper(replace(ISSUED, grade=grade))

    assert ("Viewer Person" in html) is (grade != "unclassified")


def test_text_fields_are_escaped_and_output_has_no_script() -> None:
    hostile = '<script>alert("x")</script> \' "q"'
    html = render_paper(
        replace(
            DRAFT,
            grade="secret",
            subjects=(hostile, "second"),
            viewer_name=hostile,
            draft_number=hostile,
            submitter_g_number=hostile,
            asset_base='/x"><script>',
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
