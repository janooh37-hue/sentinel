"""Print an on-screen sheet to PDF with the host's own Chromium browser.

The client posts the printable sheet's HTML (the same DOM «Print» prints); this
wraps it in the app's built stylesheet and runs Edge (else Chrome) headless with
``--print-to-pdf``, so the file matches the browser's print: fonts, RTL, page
breaks, the ``@page`` margin boxes.

Posted HTML is untrusted. Its ``<script>`` tags are stripped and the page's CSP
(``default-src 'none'``, so no scripts either) allows
no network and no ``file:`` images: the only image (the brand wordmark) is
inlined as a data URI here, and ``file:`` is allowed for fonts only (the app's
own). The browser gets a throwaway profile and a timeout; a hung run is killed
with its whole process tree.
"""

from __future__ import annotations

import base64
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from app.api.errors import AppError

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"
TIMEOUT_S = 60

_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src file: data:"
_BRAND_SRC = re.compile(r'src="/brand/([\w.-]+\.png)"')
_SCRIPT = re.compile(r"<script\b.*?</script\s*>", re.IGNORECASE | re.DOTALL)


def find_browser() -> Path | None:
    """Edge, then Chrome, from the standard Windows install locations."""
    roots = [os.environ.get(k) for k in ("ProgramFiles(x86)", "ProgramFiles", "LocalAppData")]
    for rel in ("Microsoft/Edge/Application/msedge.exe", "Google/Chrome/Application/chrome.exe"):
        for root in roots:
            if root and (exe := Path(root) / rel).is_file():
                return exe
    return None


def _stylesheet() -> str:
    """The built app CSS (the one ``index.html`` links), with its root-relative
    ``/assets/`` font URLs pointed at the static dir on disk."""
    index = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    href = re.search(r'<link rel="stylesheet"[^>]*href="(/assets/[^"]+\.css)"', index)
    if href is None:
        raise AppError("PDF_NOT_AVAILABLE", "The app stylesheet is missing.", http_status=503)
    css = (STATIC_DIR / href.group(1).lstrip("/")).read_text(encoding="utf-8")
    return css.replace("url(/assets/", f"url({(STATIC_DIR / 'assets').as_uri()}/")


def _inline_brand(match: re.Match[str]) -> str:
    path = STATIC_DIR / "brand" / match.group(1)
    if not path.is_file():
        return 'src=""'
    return f'src="data:image/png;base64,{base64.b64encode(path.read_bytes()).decode("ascii")}"'


def document(sheet_html: str, *, lang: str) -> str:
    """The sheet as a standalone page, laid out as it is in the app (``#root``
    carries the print rules that flatten backgrounds)."""
    body = _BRAND_SRC.sub(_inline_brand, _SCRIPT.sub("", sheet_html))
    direction = "rtl" if lang == "ar" else "ltr"
    return (
        f'<!doctype html><html lang="{lang}" dir="{direction}"><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{_CSP}">'
        f"<style>{_stylesheet()}</style></head>"
        f'<body><div id="root">{body}</div></body></html>'
    )


def _kill_tree(proc: subprocess.Popen[bytes]) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(proc.pid)], check=False, capture_output=True
        )
    else:
        proc.kill()
    proc.wait()


def print_sheet(sheet_html: str, *, lang: str) -> bytes:
    """The sheet printed to PDF bytes. 503 when no browser is installed or the
    print fails."""
    browser = find_browser()
    if browser is None:
        raise AppError(
            "PDF_BROWSER_UNAVAILABLE",
            "Neither Microsoft Edge nor Google Chrome is installed on the server.",
            http_status=503,
        )
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        work = Path(tmp)
        page = work / "sheet.html"
        page.write_text(document(sheet_html, lang=lang), encoding="utf-8")
        out = work / "sheet.pdf"
        proc = subprocess.Popen(
            [
                str(browser),
                "--headless",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--allow-file-access-from-files",
                f"--user-data-dir={work / 'profile'}",
                "--no-pdf-header-footer",
                f"--print-to-pdf={out}",
                page.as_uri(),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            proc.wait(timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
        if not out.is_file() or out.stat().st_size == 0:
            raise AppError(
                "PDF_NOT_AVAILABLE", "The browser could not print the report.", http_status=503
            )
        return out.read_bytes()
