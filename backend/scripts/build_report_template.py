# backend/scripts/build_report_template.py
"""One-shot: build the Report template on the General Book paper.

The body mirrors the operator's reference letter (تقارير شاملة.docx,
2026-07-24): letter top block (date / addressee / greeting / centered
subject), a bold 16pt justified Word-authored body anchor, centered
closing, and an 18pt kashida signature block. Headers, footers (footer3
carries {{ submitter_g }}) and styles come from the General Book template
untouched.

Run once, then commit backend/templates/GSSG-GS_300-004_Report.docx:
    venv\\Scripts\\python.exe backend/scripts/build_report_template.py
"""

from __future__ import annotations

import zipfile
from pathlib import Path

SRC = Path("backend/templates/GSSG-GS_300-003_General_Book.docx")
DST = Path("backend/templates/GSSG-GS_300-004_Report.docx")

# --- run/paragraph properties (copied from the reference letter) ----------
# Plain 16pt (sz 32 half-points), Calibri for the Arabic (cs) script.
RPR32 = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
RPR32CS = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri" w:hint="cs"/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
# Bold 16pt — the body/closing weight in the reference.
RPR32B = (
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi" w:hint="cs"/><w:b/><w:bCs/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr>'
)
# 18pt — the signature block size in the reference.
RPR36 = (
    '<w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Calibri" w:hint="cs"/>'
    '<w:sz w:val="36"/><w:szCs w:val="36"/><w:rtl/></w:rPr>'
)
# The reference positions the signature block with a literal bold-italic
# 16pt run of spaces before the name label — copied verbatim.
RPR32BI = (
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi" w:hint="cs"/><w:b/><w:bCs/>'
    '<w:i/><w:iCs/><w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/>'
    '<w:lang w:bidi="ar-AE"/></w:rPr>'
)

BLANK = "<w:p><w:pPr><w:bidi/>" + RPR32 + "</w:pPr></w:p>"
PPR_BODY = (
    '<w:pPr><w:bidi/><w:jc w:val="both"/>'
    '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/>'
    '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr></w:pPr>'
)

NAME_LABEL = "الإس" + "ـ" * 75 + "م : "
SIGN_LABEL = "التوقي" + "ـ" * 69 + "ع:"

BODY = "".join(
    [
        # التاريخ: {{ date }}
        "<w:p><w:pPr><w:bidi/>"
        + RPR32
        + "</w:pPr><w:r>"
        + RPR32CS
        + '<w:t xml:space="preserve">التاريخ: {{ date }}</w:t></w:r></w:p>',
        BLANK,
        # السيد {{ recipient_name }} <tab> المحترم — tab stop pushes المحترم
        # to the line's end whatever the recipient name length. NB: OOXML
        # pPr child order is fixed — tabs MUST precede bidi.
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="8789"/></w:tabs><w:bidi/>'
        + RPR32
        + "</w:pPr><w:r>"
        + RPR32CS
        + '<w:t xml:space="preserve">السيد {{ recipient_name }}</w:t></w:r>'
        + "<w:r>"
        + RPR32CS
        + '<w:tab/><w:t xml:space="preserve">المحترم </w:t></w:r></w:p>',
        BLANK,
        # تحية طيبة وبعد ,,  (reference punctuation kept verbatim)
        "<w:p><w:pPr><w:bidi/>"
        + RPR32
        + "</w:pPr><w:r>"
        + RPR32CS
        + '<w:t xml:space="preserve">تحية طيبة وبعد ,,</w:t></w:r></w:p>',
        BLANK,
        # الموضوع — centered, hidden entirely when there is no subject.
        '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>'
        + RPR32
        + "</w:pPr><w:r>"
        + RPR32CS
        + "<w:t xml:space=\"preserve\">{{ '' if not subject else 'الموضوع : ' ~ subject }}</w:t>"
        + "</w:r></w:p>",
        BLANK,
        BLANK,
        # {{ body }} anchor — bold 16pt justified; the paragraph-mark rPr
        # matches so typing at the cleared anchor inherits this format.
        "<w:p>" + PPR_BODY + "<w:r>" + RPR32B + "<w:t>{{ body }}</w:t></w:r></w:p>",
        BLANK,
        # للتفضل بالعلم وإجراءاتكم لطفاً،،،
        "<w:p>"
        + PPR_BODY
        + "<w:r>"
        + RPR32B
        + "<w:t>للتفضل بالعلم وإجراءاتكم لطفاً،،،</w:t></w:r></w:p>",
        BLANK * 7,
        # وتفضلوا بقبول فائق الإحترام والتقدير ,,, — centered bold
        '<w:p><w:pPr><w:bidi/><w:jc w:val="center"/>'
        '<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/>'
        '<w:sz w:val="32"/><w:szCs w:val="32"/><w:rtl/></w:rPr></w:pPr>'
        "<w:r>" + RPR32B + "<w:t>وتفضلوا بقبول فائق الإحترام والتقدير ,,,</w:t></w:r></w:p>",
        BLANK * 9,
        # Signature block — 18pt, positioned like the reference (literal
        # space runs + left indent copied verbatim).
        "<w:p><w:pPr><w:bidi/>"
        + RPR36
        + "</w:pPr>"
        + "<w:r>"
        + RPR32BI
        + '<w:t xml:space="preserve">'
        + " " * 73
        + "</w:t></w:r>"
        + "<w:r>"
        + RPR36
        + '<w:t xml:space="preserve">'
        + NAME_LABEL
        + "{{ manager_name }}  </w:t></w:r></w:p>",
        '<w:p><w:pPr><w:bidi/><w:jc w:val="both"/>'
        + RPR36
        + "</w:pPr>"
        + "<w:r>"
        + RPR36
        + '<w:t xml:space="preserve">'
        + " " * 66
        + "</w:t></w:r>"
        + "<w:r>"
        + RPR36
        + '<w:t xml:space="preserve">'
        + "المسمى الوظيفي : {{ manager_title }} </w:t></w:r></w:p>",
        '<w:p><w:pPr><w:bidi/><w:ind w:left="4680"/>'
        + RPR36
        + "</w:pPr>"
        + "<w:r>"
        + RPR36
        + '<w:t xml:space="preserve">       '
        + SIGN_LABEL
        + " {{ manager_sig }}</w:t></w:r></w:p>",
        BLANK,
    ]
)


def main() -> None:
    with zipfile.ZipFile(SRC) as zin:
        entries = {name: zin.read(name) for name in zin.namelist()}
    xml = entries["word/document.xml"].decode("utf-8")
    head = xml[: xml.find("<w:body>") + len("<w:body>")]
    tail = xml[xml.rfind("<w:sectPr") :]  # body-level sectPr is the last one
    entries["word/document.xml"] = (head + BODY + tail).encode("utf-8")
    with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in entries.items():
            zout.writestr(name, data)
    print(f"wrote {DST}")


if __name__ == "__main__":
    main()
