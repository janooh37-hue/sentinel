"""Spread the Report paper's letterhead to the rest of the report templates.

The operator redesigns the letterhead in Word on the Report template's FIRST
page (``header2.xml`` = logo + date + title + rule, ``footer3.xml`` = contact
strip). This script then:

* Report — adds the ``{{ submitter_g }}`` G-number to the footer (right margin,
  on the contact row) if it's missing, and rebuilds the continuation-page
  header (``header1.xml``) as the first-page header minus its text, so pages
  2+ carry the same logo and rule without repeating the date/title.
* Inmate Conduct Violations — takes the same footer, the same continuation
  header, and a first-page header made of the Report's logo line and rule
  followed by the inmate paper's own addressee/subject/opening lines (the old
  letterhead table is dropped).

Pages 2+ get the first-page footer at render time (``syncs_general_book_footer``).

Run after editing the Report letterhead, then review both papers in Word and
commit the two templates:
    venv\\Scripts\\python.exe backend/scripts/apply_report_letterhead.py
"""

from __future__ import annotations

import copy
import posixpath
import re
import zipfile
from pathlib import Path

from lxml import etree

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"
REPORT = TEMPLATES / "GSSG-GS_300-004_Report.docx"
INMATE = TEMPLATES / "GSSG-NAT_300-005_Inmate_Conduct_Violations.docx"

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
PKG_R = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W}

SUBMITTER_TOKEN = "{{ submitter_g }}"
#: Footer G-number: its own cell at the end of the contact-strip table, right-
#: aligned on the margin, Helvetica 8pt in the strip's grey, sitting at the end
#: of the thin rule (the row's top edge + 4pt puts it on the rule's centre
#: line). The row keeps its height, so nothing else in the footer moves.
SUBMITTER_CELL_TWIPS = 900
SUBMITTER_CELL = (
    f'<w:tc xmlns:w="{W}"><w:tcPr><w:tcW w:w="{SUBMITTER_CELL_TWIPS}" w:type="dxa"/>'
    '<w:vAlign w:val="top"/></w:tcPr><w:p><w:pPr><w:pStyle w:val="Footer"/>'
    '<w:spacing w:before="80" w:after="0"/><w:jc w:val="right"/></w:pPr>'
    '<w:r><w:rPr><w:rFonts w:ascii="Helvetica" w:hAnsi="Helvetica"/>'
    '<w:color w:val="A09F9F"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>'
    f"<w:t>{SUBMITTER_TOKEN}</w:t></w:r></w:p></w:tc>"
)
#: The inmate paper's own first-page lines start at this header paragraph text.
INMATE_FIRST_LINE = "رئيس قسم شؤون النزلاء"
#: Space between the logo's bottom edge and the rule on the inmate paper.
RULE_GAP_EMU = 8 * 12700  # 8pt


def w(tag: str) -> str:
    return f"{{{W}}}{tag}"


def read(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def write(path: Path, parts: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)


def xml(data: bytes) -> etree._Element:
    return etree.fromstring(data)


def dump(root: etree._Element) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def strip_text(p: etree._Element) -> None:
    """Drop a paragraph's text runs, keeping runs that carry drawings."""
    for r in p.findall("w:r", NS):
        if not any(el.tag != w("rPr") and el.tag not in (w("t"), w("tab")) for el in r):
            p.remove(r)


def continuation_header(first: bytes) -> bytes:
    """Pages 2+ header: the first-page header with every text run removed."""
    root = xml(first)
    for p in root.iter(w("p")):
        strip_text(p)
    return dump(root)


def with_submitter_g(footer: bytes, width: int) -> bytes:
    """Add the G-number cell to the footer's contact-strip table.

    The table grows to the text *width*; the last existing column gives up
    whatever the new cell needs beyond that.
    """
    root = xml(footer)
    if SUBMITTER_TOKEN in "".join(t.text or "" for t in root.iter(w("t"))):
        return footer
    tbl = root.findall("w:tbl", NS)[-1]
    tbl_w = tbl.find("w:tblPr/w:tblW", NS)
    shrink = max(0, int(tbl_w.get(w("w"))) + SUBMITTER_CELL_TWIPS - width)
    last_col = tbl.find("w:tblGrid", NS).findall("w:gridCol", NS)[-1]
    last_col.set(w("w"), str(int(last_col.get(w("w"))) - shrink))
    etree.SubElement(tbl.find("w:tblGrid", NS), w("gridCol"), {w("w"): str(SUBMITTER_CELL_TWIPS)})
    for tr in tbl.findall("w:tr", NS):
        last_w = tr.findall("w:tc", NS)[-1].find("w:tcPr/w:tcW", NS)
        last_w.set(w("w"), str(int(last_w.get(w("w"))) - shrink))
        tr.append(etree.fromstring(SUBMITTER_CELL))
    tbl_w.set(w("w"), str(int(tbl_w.get(w("w"))) + SUBMITTER_CELL_TWIPS - shrink))
    return dump(root)


def text_width_twips(parts: dict[str, bytes]) -> int:
    sect = xml(parts["word/document.xml"]).findall(".//w:body/w:sectPr", NS)[-1]
    size, mar = sect.find("w:pgSz", NS), sect.find("w:pgMar", NS)
    return int(size.get(w("w"))) - int(mar.get(w("left"))) - int(mar.get(w("right")))


def rels_name(part: str) -> str:
    folder, name = posixpath.split(part)
    return f"{folder}/_rels/{name}.rels"


def copy_part_with_rels(src: dict[str, bytes], dst: dict[str, bytes], part: str, into: str) -> None:
    """Copy ``src[part]``'s relationships to ``dst[into]``, bringing media along.

    Media are renamed on a clash so the destination's own images survive.
    """
    rels = xml(src[rels_name(part)])
    for rel in rels.findall(f"{{{PKG_R}}}Relationship"):
        if rel.get("TargetMode") == "External":
            continue
        target = posixpath.normpath(posixpath.join("word", rel.get("Target")))
        name = target
        stem, ext = posixpath.splitext(target)
        n = 1
        while name in dst and dst[name] != src[target]:
            name, n = f"{stem}_lh{n}{ext}", n + 1
        dst[name] = src[target]
        rel.set("Target", posixpath.relpath(name, "word"))
    dst[rels_name(into)] = dump(rels)


def ensure_styles(src: dict[str, bytes], dst: dict[str, bytes], part: bytes) -> None:
    """Copy the styles *part* uses (plus their linked/base styles) that *dst* lacks."""
    src_styles, dst_styles = xml(src["word/styles.xml"]), xml(dst["word/styles.xml"])
    have = {s.get(w("styleId")) for s in dst_styles.findall("w:style", NS)}
    by_id = {s.get(w("styleId")): s for s in src_styles.findall("w:style", NS)}
    todo = [s.decode() for s in re.findall(rb'w:(?:pStyle|rStyle) w:val="([^"]+)"', part)]
    while todo:
        sid = todo.pop()
        if sid in have or sid not in by_id:
            continue
        have.add(sid)
        style = copy.deepcopy(by_id[sid])
        dst_styles.append(style)
        todo += [el.get(w("val")) for el in style if el.tag in (w("link"), w("basedOn"))]
    dst["word/styles.xml"] = dump(dst_styles)


def inmate_first_header(report_h2: bytes, inmate_h2: bytes, top_emu: int) -> bytes:
    """Report logo line + rule, then the inmate paper's own lines.

    The inmate paper has no title under the logo, so the Report's trailing
    blank title line is dropped and the rule is lifted to just under the logo
    (logo bottom = header top + its paragraph offset + its height).
    """
    report, inmate = xml(report_h2), xml(inmate_h2)
    paras = report.findall("w:p", NS)
    if not list(paras[-1].iter(f"{{{WP}}}anchor")):
        paras = paras[:-1]
    logo_block = []
    for p in paras:
        clone = copy.deepcopy(p)
        strip_text(clone)
        logo_block.append(clone)

    def offset(anchor: etree._Element) -> etree._Element:
        return anchor.find(f"{{{WP}}}positionV/{{{WP}}}posOffset")

    anchors = [a for p in logo_block for a in p.iter(f"{{{WP}}}anchor")]
    by_frame = {a.find(f"{{{WP}}}positionV").get("relativeFrom"): a for a in anchors}
    logo, rule = by_frame["paragraph"], by_frame["page"]
    extent = int(logo.find(f"{{{WP}}}extent").get("cy"))
    logo_bottom = top_emu + int(offset(logo).text) + extent
    offset(rule).text = str(logo_bottom + RULE_GAP_EMU)

    body = inmate.findall("w:p", NS)
    start = next(
        i
        for i, p in enumerate(body)
        if INMATE_FIRST_LINE in "".join(t.text or "" for t in p.iter(w("t")))
    )
    for child in list(inmate):
        inmate.remove(child)
    for p in logo_block + body[start:]:
        inmate.append(p)
    return dump(inmate)


def header_top_emu(parts: dict[str, bytes]) -> int:
    sect = xml(parts["word/document.xml"]).findall(".//w:body/w:sectPr", NS)[-1]
    return int(sect.find("w:pgMar", NS).get(w("header"))) * 635


def main() -> None:
    report, inmate = read(REPORT), read(INMATE)

    footer = with_submitter_g(report["word/footer3.xml"], text_width_twips(report))
    report["word/footer3.xml"] = footer
    report["word/header1.xml"] = continuation_header(report["word/header2.xml"])
    copy_part_with_rels(report, report, "word/header2.xml", "word/header1.xml")

    inmate["word/footer3.xml"] = footer
    copy_part_with_rels(report, inmate, "word/footer3.xml", "word/footer3.xml")
    inmate["word/header2.xml"] = inmate_first_header(
        report["word/header2.xml"], inmate["word/header2.xml"], header_top_emu(inmate)
    )
    copy_part_with_rels(report, inmate, "word/header2.xml", "word/header2.xml")
    inmate["word/header1.xml"] = continuation_header(report["word/header2.xml"])
    copy_part_with_rels(report, inmate, "word/header2.xml", "word/header1.xml")
    ensure_styles(report, inmate, inmate["word/footer3.xml"] + inmate["word/header2.xml"])

    write(REPORT, report)
    write(INMATE, inmate)
    print(f"wrote {REPORT.name} and {INMATE.name}")


if __name__ == "__main__":
    main()
