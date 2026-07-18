"""One-time, idempotent: insert the guarded Arabic ref line above the date
line in the canonical General Book template. The modified .docx is committed
intentionally (template-churn rule: only THIS file changes)."""

import copy
import sys
from pathlib import Path

from docx import Document
from docx.text.paragraph import Paragraph

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-003_General_Book.docx"


def main() -> None:
    doc = Document(str(TEMPLATE))
    if any("{{ ref }}" in p.text for p in doc.paragraphs):
        print("already has ref line; nothing to do")
        return
    date_p = next(p for p in doc.paragraphs if "التاريخ" in p.text and "{{ date }}" in p.text)

    def clone_empty_before() -> Paragraph:
        """Deep-copy the date paragraph (keeps RTL pPr/alignment), strip its
        runs, insert before date_p. Successive calls stack in call order."""
        new_p = copy.deepcopy(date_p._p)
        date_p._p.addprevious(new_p)
        para = Paragraph(new_p, date_p._parent)
        for r in list(para.runs):
            r._element.getparent().remove(r._element)
        return para

    src_run = date_p.runs[0]

    def style_like_date(run) -> None:
        run.font.name = src_run.font.name
        run.font.size = src_run.font.size
        run.font.bold = src_run.font.bold

    p_if = clone_empty_before()
    p_if.add_run("{%p if ref %}")

    p_ref = clone_empty_before()
    label = p_ref.add_run("الرقم: ")
    style_like_date(label)
    ref_run = p_ref.add_run("{{ ref }}")
    style_like_date(ref_run)
    ref_run.font.rtl = False  # LTR isolate — 1/5/GSSG/141 must not reorder

    p_endif = clone_empty_before()
    p_endif.add_run("{%p endif %}")

    doc.save(str(TEMPLATE))
    print("ref line added")


if __name__ == "__main__":
    sys.exit(main())
