"""Printed level mark: سري / شخصي at the top of every page of a record DOCX.

The mark lives in each header part inside a content control tagged
``gssg-level-mark`` so it survives Word round-trips and can be replaced or
removed when the record's level changes. It is a positioned frame in the top
margin, so it never pushes the letterhead or body down.
"""

from __future__ import annotations

import logging
from pathlib import Path

from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls

logger = logging.getLogger(__name__)

LEVEL_MARK_TAG = "gssg-level-mark"
LEVEL_MARKS = {"secret": "سري", "personal": "شخصي"}
# Distance of the mark's top from the page's top edge, in twips (0.35 cm).
_MARK_Y_TWIPS = 200
_EMPTY_HEADER_P = (
    f"<w:p {nsdecls('w')}><w:pPr>"
    '<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>'
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>'
)


def _mark_xml(text: str) -> str:
    return (
        f"<w:sdt {nsdecls('w')}>"
        f'<w:sdtPr><w:alias w:val="Level"/><w:tag w:val="{LEVEL_MARK_TAG}"/></w:sdtPr>'
        "<w:sdtContent><w:p><w:pPr>"
        f'<w:framePr w:wrap="around" w:hAnchor="page" w:vAnchor="page" w:xAlign="center" w:y="{_MARK_Y_TWIPS}"/>'
        '<w:bidi/><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
        '<w:ind w:left="0" w:right="0"/><w:jc w:val="center"/>'
        "</w:pPr><w:r><w:rPr>"
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>'
        '<w:color w:val="000000"/><w:sz w:val="18"/><w:szCs w:val="18"/>'
        '<w:u w:val="single"/><w:rtl/><w:cs/>'
        f"</w:rPr><w:t>{text}</w:t></w:r></w:p></w:sdtContent></w:sdt>"
    )


def _ensure_headers(doc) -> None:  # type: ignore[no-untyped-def]
    """Give every used page kind an inheritable header in the first section.

    Later sections without their own header inherit the first one's, including
    a first-page header enabled only in a later section. Headerless documents
    get a frame-only header at the page edge; existing letterhead margins stay.
    """
    section = doc.sections[0]
    had_headers = bool(section._sectPr.headerReference_lst)
    headers = [section.header]
    if any(s.different_first_page_header_footer for s in doc.sections):
        headers.append(section.first_page_header)
    if doc.settings.odd_and_even_pages_header_footer:
        headers.append(section.even_page_header)
    for header in headers:
        if header.is_linked_to_previous:
            header.is_linked_to_previous = False
            for child in list(header._element):
                header._element.remove(child)
    if not had_headers:
        section.header_distance = 0


def apply_level_mark(docx_path: Path | str, level: str) -> bool:
    """Make every header carry exactly the mark for ``level`` (none for general/directed).

    Idempotent. Returns False when the DOCX can't be opened or saved.
    """
    text = LEVEL_MARKS.get(level)
    try:
        doc = Document(str(docx_path))
        if text is not None:
            _ensure_headers(doc)
        changed = False
        seen: set[int] = set()
        for section in doc.sections:
            for header in (section.header, section.first_page_header, section.even_page_header):
                if header.is_linked_to_previous:
                    continue
                hdr = header._element
                if id(hdr) in seen:
                    continue
                seen.add(id(hdr))
                old = hdr.xpath(f'.//w:sdt[w:sdtPr/w:tag/@w:val="{LEVEL_MARK_TAG}"]')
                for sdt in old:
                    sdt.getparent().remove(sdt)
                if text is not None:
                    hdr.insert(0, parse_xml(_mark_xml(text)))
                elif len(hdr) == 0:
                    # A header we created for the mark: keep it valid and hairline-thin.
                    hdr.append(parse_xml(_EMPTY_HEADER_P))
                changed = changed or bool(old) or text is not None
        if changed:
            doc.save(str(docx_path))
        return True
    except Exception:
        logger.exception("Level mark failed for %s", docx_path)
        return False
