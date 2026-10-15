"""«Save as PDF»: POST /leaves/report/pdf prints the posted report sheet with
the host's browser and returns the PDF (base64); a host without Edge or Chrome
gets a clear 503."""

from __future__ import annotations

import base64
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.main import create_app
from app.services import sheet_pdf_service
from tests.conftest import make_user

SHEET = (
    '<div class="print-leave-report"><img src="/brand/gssg-wordmark.png" alt="GSSG">'
    "<script>alert(1)</script><p>تقرير الإجازات</p></div>"
)


@pytest.fixture()
def static(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    (tmp_path / "assets").mkdir()
    (tmp_path / "brand").mkdir()
    (tmp_path / "index.html").write_text(
        '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">', encoding="utf-8"
    )
    (tmp_path / "assets" / "index-abc.css").write_text(
        "@font-face{src:url(/assets/f.woff2)}", encoding="utf-8"
    )
    (tmp_path / "brand" / "gssg-wordmark.png").write_bytes(b"\x89PNG-wordmark")
    monkeypatch.setattr(sheet_pdf_service, "STATIC_DIR", tmp_path)
    return tmp_path


def _post(db: Session, payload: dict[str, str]):
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: make_user(db, role="admin")
    return TestClient(app).post("/api/v1/leaves/report/pdf", json=payload)


def test_prints_the_posted_sheet_without_its_scripts(
    api_db: Session, static: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, str] = {}

    class FakeBrowser:
        def __init__(self, args: list[str], **_: object) -> None:
            seen["page"] = Path(url2pathname(urlparse(args[-1]).path)).read_text(encoding="utf-8")
            out = next(a for a in args if a.startswith("--print-to-pdf=")).split("=", 1)[1]
            Path(out).write_bytes(b"%PDF-sheet")

        def wait(self, timeout: float | None = None) -> int:
            return 0

    monkeypatch.setattr(sheet_pdf_service, "find_browser", lambda: Path("msedge.exe"))
    monkeypatch.setattr(sheet_pdf_service.subprocess, "Popen", FakeBrowser)

    r = _post(api_db, {"html": SHEET, "lang": "ar"})

    assert r.status_code == 200
    assert base64.b64decode(r.text) == b"%PDF-sheet"
    page = seen["page"]
    assert '<html lang="ar" dir="rtl">' in page
    assert "<script" not in page and "تقرير الإجازات" in page
    assert "Content-Security-Policy" in page
    assert f'src="data:image/png;base64,{base64.b64encode(b"\x89PNG-wordmark").decode()}"' in page
    assert f"url({(static / 'assets').as_uri()}/f.woff2)" in page


def test_host_without_a_browser_gets_a_clear_503(
    api_db: Session, static: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sheet_pdf_service, "find_browser", lambda: None)

    r = _post(api_db, {"html": SHEET, "lang": "en"})

    assert r.status_code == 503
    assert r.json()["error"]["code"] == "PDF_BROWSER_UNAVAILABLE"
