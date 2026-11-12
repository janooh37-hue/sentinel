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
            Path(out).write_bytes(b"%PDF-sheet\n%%EOF\n")

        def wait(self, timeout: float | None = None) -> int:
            return 0

    monkeypatch.setattr(sheet_pdf_service, "find_browser", lambda: Path("msedge.exe"))
    monkeypatch.setattr(sheet_pdf_service.subprocess, "Popen", FakeBrowser)

    r = _post(api_db, {"html": SHEET, "lang": "ar"})

    assert r.status_code == 200
    assert base64.b64decode(r.text) == b"%PDF-sheet\n%%EOF\n"
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


def test_waits_for_pdf_completion_after_browser_launcher_exits(monkeypatch):
    output = None
    ticks = 0

    class BrowserLauncher:
        def __init__(self, args, **kwargs):
            nonlocal output
            output = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--print-to-pdf=")))

        def wait(self, timeout=None):
            return 0

    def advance(seconds):
        nonlocal ticks
        ticks += 1
        output.write_bytes(b"%PDF-partial" if ticks == 1 else b"%PDF-complete\n%%EOF\n")

    monkeypatch.setattr(sheet_pdf_service, "find_browser", lambda: Path("msedge.exe"))
    monkeypatch.setattr(sheet_pdf_service.subprocess, "Popen", BrowserLauncher)
    monkeypatch.setattr("time.sleep", advance)
    assert sheet_pdf_service.print_document("<p>Test</p>") == b"%PDF-complete\n%%EOF\n"
    assert ticks == 2


def test_incomplete_pdf_stops_at_deadline(monkeypatch):
    from app.api.errors import AppError

    class BrowserLauncher:
        def __init__(self, args, **kwargs):
            output = Path(next(a.split("=", 1)[1] for a in args if a.startswith("--print-to-pdf=")))
            output.write_bytes(b"%PDF-incomplete")

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(sheet_pdf_service, "find_browser", lambda: Path("msedge.exe"))
    monkeypatch.setattr(sheet_pdf_service.subprocess, "Popen", BrowserLauncher)
    monkeypatch.setattr(sheet_pdf_service, "TIMEOUT_S", 0)
    with pytest.raises(AppError) as error:
        sheet_pdf_service.print_document("<p>Test</p>")
    assert error.value.code == "PDF_NOT_AVAILABLE"
