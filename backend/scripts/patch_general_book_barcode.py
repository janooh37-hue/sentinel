"""One-time, idempotent: turn the header3 "gssg" placeholder run into the
``{{ barcode }}`` token at 28pt, and guard the ref+date+barcode block with
``{%p if ref %}`` / ``{%p endif %}`` so a ref-less book shows neither.

The block lives in the first-page header (header3.xml) as FOUR paragraphs per
copy — office label, ref line, date line, [gap], barcode line — duplicated
twice: once under the DrawingML ``mc:Choice`` branch, once under the VML
``mc:Fallback`` branch. Both copies must change identically (docxtpl renders
whichever Word resolves; only one is visible per host, but both must decode).

Re-running on an already-patched template is a no-op (idempotent: matches on
the ``{{ barcode }}`` token already being present).
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt
from docx.text.paragraph import Paragraph

TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "GSSG-GS_300-003_General_Book.docx"

_BARCODE_PT = Pt(28)
_REF_TEXT = "{{ ref }}"
_BARCODE_PLACEHOLDER = "gssg"
_BARCODE_TOKEN = "{{ barcode }}"


def _own_text_paragraphs(root: object) -> list[Paragraph]:
    """Every ``<w:p>`` in *root* whose OWN (non-descendant) runs carry text —
    i.e. real content lines, not the outer paragraph that merely anchors the
    two textbox copies as nested drawings."""
    out = []
    for p in root.findall(".//" + qn("w:p")):  # type: ignore[attr-defined]
        if any(t.text for t in p.findall("./" + qn("w:r") + "/" + qn("w:t"))):
            out.append(Paragraph(p, None))
    return out


def _set_run_size(paragraph: Paragraph, size: Pt) -> None:
    for run in paragraph.runs:
        run.font.size = size
    # paragraph-mark rPr (w:pPr/w:rPr) also carries a size that Word may use
    # for an empty run typed at this spot — keep it in step.
    ppr = paragraph._p.find(qn("w:pPr"))
    if ppr is not None:
        rpr = ppr.find(qn("w:rPr"))
        if rpr is not None:
            sz = rpr.find(qn("w:sz"))
            if sz is not None:
                sz.set(qn("w:val"), str(int(size.pt * 2)))
            szcs = rpr.find(qn("w:szCs"))
            if szcs is not None:
                szcs.set(qn("w:val"), str(int(size.pt * 2)))


def _clone_empty(near: Paragraph) -> Paragraph:
    """Deep-copy *near*'s XML (keeps pPr — alignment, RTL, textbox context),
    strip its runs, return the detached clone (not yet inserted)."""
    new_p = copy.deepcopy(near._p)
    for r in new_p.findall(qn("w:r")):
        new_p.remove(r)
    for pe in new_p.findall(".//" + qn("w:proofErr")):
        pe.getparent().remove(pe)
    return Paragraph(new_p, near._parent)


def _guard_block(paras: list[Paragraph]) -> tuple[Paragraph, Paragraph] | None:
    """Within one copy's paragraph list, find (ref_para, barcode_para), or
    ``None`` if this copy doesn't have both."""
    ref_para = next((p for p in paras if _REF_TEXT in p.text), None)
    barcode_para = next((p for p in paras if p.text.strip() == _BARCODE_PLACEHOLDER), None)
    if ref_para is None or barcode_para is None:
        return None
    return ref_para, barcode_para


def _patch_copy(paras: list[Paragraph]) -> bool:
    found = _guard_block(paras)
    if found is None:
        return False
    ref_para, barcode_para = found

    # 1. Barcode run: "gssg" -> "{{ barcode }}", 8pt -> 28pt.
    for run in barcode_para.runs:
        if run.text.strip() == _BARCODE_PLACEHOLDER:
            run.text = _BARCODE_TOKEN
    _set_run_size(barcode_para, _BARCODE_PT)

    # 2. Guard: {%p if ref %} before the ref line, {%p endif %} after the
    #    barcode line — both cloned from the ref paragraph's own pPr so they
    #    inherit its textbox/alignment context.
    p_if = _clone_empty(ref_para)
    p_if.add_run("{%p if ref %}")
    ref_para._p.addprevious(p_if._p)

    p_endif = _clone_empty(ref_para)
    p_endif.add_run("{%p endif %}")
    barcode_para._p.addnext(p_endif._p)

    return True


def main() -> None:
    doc = Document(str(TEMPLATE))
    hdr = doc.sections[0].first_page_header
    root = hdr.part.element

    if any(_BARCODE_TOKEN in (p.text or "") for p in root.findall(".//" + qn("w:p"))):
        print("already patched; nothing to do")
        return

    paras = _own_text_paragraphs(root)
    # Split into the two copies by ancestry: DrawingML (mc:Choice) vs VML
    # (mc:Fallback/w:pict).
    def in_choice(p: Paragraph) -> bool:
        anc = p._p.getparent()
        while anc is not None:
            tag = anc.tag.rsplit("}", 1)[-1]
            if tag == "Choice":
                return True
            if tag == "Fallback":
                return False
            anc = anc.getparent()
        return False

    choice_paras = [p for p in paras if in_choice(p)]
    fallback_paras = [p for p in paras if not in_choice(p)]

    patched_any = False
    for group in (choice_paras, fallback_paras):
        if _patch_copy(group):
            patched_any = True

    if not patched_any:
        raise SystemExit(
            "could not locate the ref+barcode block in header3 — template shape changed?"
        )

    doc.save(str(TEMPLATE))
    print("barcode token patched: {{ barcode }} at 28pt, ref+barcode guarded (both copies)")


if __name__ == "__main__":
    sys.exit(main())
