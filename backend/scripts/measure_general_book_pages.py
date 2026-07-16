"""Measure the General Book's usable body region for the editor page guides.

Renders the real template with marker paragraphs via DocxEngine, converts to
PDF (Word COM — run on the office machine), and measures where body content
starts on page 1 and where the footer begins. Prints the px@96dpi constants
for GENERAL_BOOK_PAGE_VIEW in frontend/src/components/ui/rich-editor-config.ts.

Usage:  venv\\Scripts\\python.exe backend\\scripts\\measure_general_book_pages.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

MARKER = "XCALIBRATEX"
PX_PER_PT = 4.0 / 3.0  # 96dpi


def main() -> None:
    import fitz  # PyMuPDF
    from docx2pdf import convert

    from app.core.docx_engine import DocxEngine
    from app.services.document_service import GENERAL_BOOK_BODY_SENTINEL

    # Enough filler to spill onto page 2 so both page shapes are measurable.
    body_html = f"<p>{MARKER}1</p>" + "<p>سطر التعبئة للمعايرة</p>" * 60 + f"<p>{MARKER}2</p>"
    data = {
        "subject": "معايرة",
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": body_html,
        "recipient_name": "معايرة",
        "cc": "",
    }

    with tempfile.TemporaryDirectory() as td:
        docx_path = Path(td) / "calibrate.docx"
        pdf_path = Path(td) / "calibrate.pdf"
        DocxEngine(BACKEND / "templates").fill("General Book", data, docx_path)
        convert(str(docx_path), str(pdf_path))

        pdf = fitz.open(str(pdf_path))
        page1 = pdf[0]
        ph = page1.rect.height  # pt
        pw = page1.rect.width

        hits = page1.search_for(MARKER + "1")
        if not hits:
            raise SystemExit("marker not found on page 1 — check the sentinel path")
        body_top = hits[0].y0

        # Footer top = highest object that starts in the bottom fifth of page 1.
        candidates = [b for b in page1.get_text("blocks") if b[1] > ph * 0.8]
        candidates += [page1.get_image_bbox(i) for i in page1.get_images(full=True)]
        footer_top = min(
            (b[1] if isinstance(b, tuple) else b.y0)
            for b in candidates
            if (b[1] if isinstance(b, tuple) else b.y0) > ph * 0.8
        )

        # Pages 2+: measure where content starts and where the footer begins.
        page2 = pdf[1]
        blocks2 = [b for b in page2.get_text("blocks") if MARKER not in (b[4] or "")]
        body2_top = min(b[1] for b in blocks2) if blocks2 else 36.0
        cand2 = [b for b in page2.get_text("blocks") if b[1] > ph * 0.8]
        cand2 += [page2.get_image_bbox(i) for i in page2.get_images(full=True)]
        footer2_tops = [
            (b[1] if isinstance(b, tuple) else b.y0)
            for b in cand2
            if (b[1] if isinstance(b, tuple) else b.y0) > ph * 0.8
        ]
        footer2_top = min(footer2_tops) if footer2_tops else ph - 36.0

        page1_body_pt = footer_top - body_top
        pagen_body_pt = footer2_top - body2_top
        content_w_pt = pw - 35.45 - 36.0  # section margins (verified)

        print(f"pageWidthPx: {round(content_w_pt * PX_PER_PT)}")
        print(f"page1BodyPx: {round(page1_body_pt * PX_PER_PT)}")
        print(f"pageNBodyPx: {round(pagen_body_pt * PX_PER_PT)}")
        pdf.close()  # release file handle before TemporaryDirectory cleanup


if __name__ == "__main__":  # REQUIRED — docx2pdf spawns; no guard = runs twice
    main()
