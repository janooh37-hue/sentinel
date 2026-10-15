"""Build the monthly vehicle log by editing the landscape letterhead ZIP/XML.

Usage: venv/Scripts/python.exe backend/scripts/build_vehicle_mileage_template.py
       --letterhead PATH (defaults to the supplied Desktop original)

Header/footer artwork and relationships are kept byte-for-byte. The first-page
reference textbox is copied from General Book, including its DrawingML/VML pair;
only landscape position and the barcode placeholder/size are adapted. Word must
never resave the source or the generated template.
"""

from __future__ import annotations

import argparse
import copy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from lxml import etree

BACKEND = Path(__file__).resolve().parents[1]
OUTPUT = BACKEND / "templates" / "GSSG-GS_300-005_Vehicle_Mileage_Log.docx"
GENERAL_BOOK = BACKEND / "templates" / "GSSG-GS_300-003_General_Book.docx"
NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "v": "urn:schemas-microsoft-com:vml",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
WIDTHS = [480, 1320, 2220, 1320, 1320, 1260, 3000, 1440, 1440]


def element(tag: str, **attributes: str) -> etree._Element:
    node = etree.Element(f"{{{NS['w']}}}{tag}")
    for key, value in attributes.items():
        node.set(f"{{{NS['w']}}}{key}", value)
    return node


def paragraph(text: str, *, bold: bool = False, size: int = 20, rtl: bool = True) -> etree._Element:
    p = element("p")
    props = element("pPr")
    props.extend(
        [
            element("bidi", val="1" if rtl else "0"),
            element("spacing", before="0", after="0", line="260", lineRule="atLeast"),
            element("jc", val="center"),
        ]
    )
    p.append(props)
    run = element("r")
    rprops = element("rPr")
    rprops.append(element("rFonts", ascii="Arial", hAnsi="Arial", cs="Arial"))
    if bold:
        rprops.extend([element("b"), element("bCs")])
    rprops.extend(
        [
            element("sz", val=str(size)),
            element("szCs", val=str(size)),
            element("rtl", val="1" if rtl else "0"),
        ]
    )
    run.append(rprops)
    for index, line in enumerate(text.split("\n")):
        if index:
            run.append(element("br"))
        content = element("t")
        content.text = line
        run.append(content)
    p.append(run)
    return p


def table_row(texts: list[str], *, heading: bool = False) -> etree._Element:
    row = element("tr")
    properties = element("trPr")
    properties.append(element("cantSplit"))
    if heading:
        properties.append(element("tblHeader"))
    row.append(properties)
    for text, width in zip(texts, WIDTHS, strict=True):
        cell = element("tc")
        props = element("tcPr")
        props.append(element("tcW", w=str(width), type="dxa"))
        if heading:
            props.append(element("shd", val="clear", fill="E9EEF2"))
        props.append(element("vAlign", val="center"))
        cell.append(props)
        numeric = text in {
            "{{ r.seq }}",
            "{{ r.plate }}",
            "{{ r.opening_km }}",
            "{{ r.closing_km }}",
            "{{ r.km_driven }}",
            "{{ r.maintenance_cost }}",
            "{{ total_km_driven }}",
            "{{ total_maintenance_cost }}",
        }
        cell.append(paragraph(text, bold=heading, rtl=not numeric))
        row.append(cell)
    return row


def reference_block() -> etree._Element:
    with ZipFile(GENERAL_BOOK) as archive:
        header = etree.fromstring(archive.read("word/header3.xml"))
    block = next(
        node
        for node in header.xpath(".//mc:AlternateContent", namespaces=NS)
        if node.find(".//w:txbxContent", NS) is not None
    )
    block = copy.deepcopy(block)
    # A page-relative position avoids inheriting the landscape header's indent.
    for anchor in block.xpath(".//wp:anchor", namespaces=NS):
        horizontal = anchor.find("wp:positionH", NS)
        vertical = anchor.find("wp:positionV", NS)
        horizontal.set("relativeFrom", "page")
        horizontal.find("wp:posOffset", NS).text = str(395 * 12700)
        vertical.set("relativeFrom", "page")
        vertical.find("wp:posOffset", NS).text = str(5 * 12700)
        anchor.find("wp:extent", NS).set("cx", str(400 * 12700))
    for extent in block.xpath(".//*[local-name()='xfrm']/*[local-name()='ext']"):
        extent.set("cx", str(400 * 12700))
    for shape in block.xpath(".//v:shape", namespaces=NS):
        style = shape.get("style", "")
        replacements = {
            "margin-left": "395pt",
            "margin-top": "5pt",
            "width": "400pt",
            "mso-position-horizontal-relative": "page",
            "mso-position-vertical-relative": "page",
        }
        shape.set(
            "style",
            ";".join(
                f"{key}:{replacements.get(key, value)}"
                for item in style.split(";")
                if ":" in item
                for key, value in [item.split(":", 1)]
            ),
        )
    for textbox in block.xpath(".//w:txbxContent", namespaces=NS):
        paragraphs = list(textbox)
        # The landscape red rule is at 94pt. Exact 15pt lines keep the four
        # header lines and the 8pt barcode above it.
        for p in paragraphs:
            props = p.find("w:pPr", NS)
            if props is None:
                props = element("pPr")
                p.insert(0, props)
            spacing = props.find("w:spacing", NS)
            if spacing is not None:
                props.remove(spacing)
            props.insert(0, element("spacing", before="0", after="0", line="300", lineRule="exact"))
            for text in p.xpath("./w:r/w:t", namespaces=NS):
                if "{{ date }}" in (text.text or ""):
                    text.text = text.text.replace("{{ date }}", "\u200e{{ date }}\u200e")
        ref = next(p for p in paragraphs if "{{ ref }}" in "".join(p.itertext()))
        barcode = next(
            p
            for p in paragraphs
            if p.xpath(".//w:rFonts[@w:ascii='Libre Barcode 39']", namespaces=NS)
            and p.xpath("./w:r/w:t", namespaces=NS)
        )
        indent = barcode.find("w:pPr/w:ind", NS)
        if indent is not None:
            indent.set(f"{{{NS['w']}}}left", "0")
            indent.set(f"{{{NS['w']}}}right", "0")
        for text in barcode.xpath("./w:r/w:t", namespaces=NS):
            text.text = "{{ barcode }}"
        # Keep the General Book's 8pt barcode, but let its tall glyphs set the
        # line height, and drop the blank barcode-font spacer above it.
        barcode.find("w:pPr/w:spacing", NS).set(f"{{{NS['w']}}}lineRule", "atLeast")
        for p in paragraphs:
            if p is not barcode and p.xpath(
                ".//w:rFonts[@w:ascii='Libre Barcode 39']", namespaces=NS
            ):
                textbox.remove(p)
        if not any("{%p if ref %}" in "".join(p.itertext()) for p in paragraphs):
            ref.addprevious(paragraph("{%p if ref %}"))
            barcode.addnext(paragraph("{%p endif %}"))
    # No external image relationship is needed by this textbox-only block.
    return block


def enlarge_logo(header: etree._Element, scale: float = 1.3) -> None:
    """Scale the inline GSSG logo and lift it by collapsing the blank line above it."""
    logo = next(p for p in header.findall("w:p", NS) if p.find(".//wp:inline", NS) is not None)
    for size in logo.xpath(".//wp:inline/wp:extent | .//wpg:grpSpPr/a:xfrm/a:ext", namespaces=NS):
        for axis in ("cx", "cy"):
            size.set(axis, str(round(int(size.get(axis)) * scale)))
    for group in logo.xpath(".//v:group", namespaces=NS):
        group.set(
            "style",
            ";".join(
                f"{key}:{float(value.removesuffix('pt')) * scale:.1f}pt"
                if key in ("width", "height")
                else f"{key}:{value}"
                for item in group.get("style", "").split(";")
                if ":" in item
                for key, value in [item.split(":", 1)]
            ),
        )
    spacer = logo.getprevious()
    props = spacer.find("w:pPr", NS)
    if props is None:
        props = element("pPr")
        spacer.insert(0, props)
    for old in props.findall("w:spacing", NS):
        props.remove(old)
    props.insert(0, element("spacing", before="0", after="0", line="100", lineRule="exact"))


def build(letterhead: Path) -> Path:
    with ZipFile(letterhead) as archive:
        entries = {item.filename: archive.read(item.filename) for item in archive.infolist()}
    document = etree.fromstring(entries["word/document.xml"])
    body = document.find("w:body", NS)
    section = body.find("w:sectPr", NS)
    for child in list(body):
        if child is not section:
            body.remove(child)
    # Header artwork ends at 109pt; start the title beneath it, not behind it.
    # Side margins stay as the letterhead's so logo and footer keep their place.
    section.find("w:pgMar", NS).set(f"{{{NS['w']}}}top", "2400")
    title = paragraph("سجل عداد المسافات والصيانة الشهري للمركبات", bold=True, size=28)
    month = paragraph("شهر {{ month_label }}", bold=True, size=32)
    # Breathing room between the month heading and the table.
    month.find("w:pPr/w:spacing", NS).set(f"{{{NS['w']}}}after", "280")
    body.insert(0, title)
    body.insert(1, month)
    table = element("tbl")
    props = element("tblPr")
    props.extend(
        [
            element("bidiVisual"),
            element("tblW", w=str(sum(WIDTHS)), type="dxa"),
            element("jc", val="center"),
        ]
    )
    borders = element("tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(element(edge, val="single", sz="4", color="71808E"))
    props.append(borders)
    props.append(element("tblLayout", type="fixed"))
    margins = element("tblCellMar")
    for edge, width in (("top", "80"), ("left", "60"), ("bottom", "80"), ("right", "60")):
        margins.append(element(edge, w=width, type="dxa"))
    props.append(margins)
    table.append(props)
    grid = element("tblGrid")
    grid.extend(element("gridCol", w=str(width)) for width in WIDTHS)
    table.append(grid)
    table.append(
        table_row(
            [
                "ت",
                "رقم اللوحة",
                "نوع المركبة",
                "العداد أول الشهر\n(كم)",
                "العداد آخر الشهر\n(كم)",
                "المسافة المقطوعة\n(كم)",
                "الصيانة المنجزة / التاريخ",
                "تكلفة الصيانة\n(درهم)",
                "ملاحظات",
            ],
            heading=True,
        )
    )
    table.append(table_row(["{%tr for r in rows %}"] + [""] * 8))
    table.append(
        table_row(
            [
                "{{ r.seq }}",
                "{{ r.plate }}",
                "{{ r.vehicle_type }}",
                "{{ r.opening_km }}",
                "{{ r.closing_km }}",
                "{{ r.km_driven }}",
                "{{ r.maintenance }}",
                "{{ r.maintenance_cost }}",
                "",
            ]
        )
    )
    table.append(table_row(["{%tr endfor %}"] + [""] * 8))
    table.append(
        table_row(
            [
                "",
                "الإجمالي",
                "",
                "",
                "",
                "{{ total_km_driven }}",
                "",
                "{{ total_maintenance_cost }}",
                "",
            ],
            heading=True,
        )
    )
    # Only the actual column header repeats, not the totals row.
    total_properties = table[-1].find("w:trPr", NS)
    total_properties.remove(total_properties.find("w:tblHeader", NS))
    body.insert(2, table)
    body.insert(3, paragraph(""))
    header = etree.fromstring(entries["word/header2.xml"])
    enlarge_logo(header)
    # Anchor in the existing first paragraph: a new paragraph would push the inline logo down.
    run = element("r")
    run.append(reference_block())
    header.find("w:p", NS).append(run)
    entries["word/header2.xml"] = etree.tostring(
        header, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    entries["word/document.xml"] = etree.tostring(
        document, xml_declaration=True, encoding="UTF-8", standalone=True
    )
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return OUTPUT


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--letterhead",
        type=Path,
        default=Path.home() / "Desktop" / "نماذج" / "Letterhead Landscape final.docx",
    )
    print(build(parser.parse_args().letterhead))


if __name__ == "__main__":
    main()
