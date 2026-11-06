"""Ledger Book paper: an A4 HTML recreation of the Word General Book (ADR 0007).

``render_paper`` turns a Ledger Book Revision (or a Draft) into one complete,
script-free HTML document. The letterhead mirrors the General Book template
(``backend/templates/GSSG-GS_300-003_General_Book.docx``): the first-page
header (``word/header3.xml``) carries the logo, the reference / date / office
block and the decorative Code 39 barcode (bars only); every page repeats the
red rule of the continuation header (``word/header2.xml``), the mirrored red
rule and contact footer with the submitter G-number (``word/footer1.xml``).
The body follows ``word/document.xml``: one «السيد \\ … المحترم» line per To,
the subject on the left, the signing manager's block, then «نسخة إلى:».

Repetition on every printed page uses ``position: fixed`` (the rule, footer,
Grade mark and watermarks) and a spacer ``<thead>``/``<tfoot>`` that browsers
repeat on each page, so the body never runs under the letterhead. ``@page``
margins are zero, which also stops browsers printing their own headers.

Every text field is escaped; only ``body_html`` (sanitized upstream on every
save) is inserted raw. ``paper_response`` adds the hardened headers.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from html import escape
from typing import Final

from fastapi.responses import HTMLResponse

from app.core.grades import GRADE_RANK, SECRET, paper_mark
from app.core.qr import barcode_payload

PAPER_CSP: Final = (
    "sandbox allow-same-origin allow-modals; default-src 'none'; img-src 'self'; "
    "font-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; "
    "form-action 'none'; frame-ancestors 'self'"
)

# The General Book's office line (header3.xml), printed as-is.
_OFFICE_AR: Final = "مكتب ادارة الوثبة"


@dataclass(frozen=True)
class PaperContext:
    body_html: str  # ALREADY sanitized upstream; inserted as-is
    subjects: tuple[str, ...]  # ordered; escape every one
    grade: str  # core.grades code
    ref: str | None  # None for a Draft
    paper_date: date | None  # None for a Draft
    draft_number: str | None  # "000123" for a Draft, else None
    submitter_g_number: str | None
    viewer_g_number: str | None  # tiled across the sheet for Secret and above
    asset_base: str  # URL prefix where the asset router is mounted
    # Printed addressees, in order: "السيد \ {name} المحترم" per To, "نسخة إلى:" CC.
    to_names: tuple[str, ...] = ()
    cc_names: tuple[str, ...] = ()
    # The signing manager; their signature image only once the Revision is signed.
    signer_name: str | None = None
    signer_title: str | None = None
    signature_src: str | None = None  # same-origin URL, or a data: URI for PDF


def _e(text: str) -> str:
    return escape(text, quote=True)


def _asset(ctx: PaperContext, name: str) -> str:
    return _e(f"{ctx.asset_base.rstrip('/')}/{name}")


_CSS: Final = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "GSSG Naskh", serif;
  font-size: 13pt;
  line-height: 1.6;
  color: #000;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media screen {
  body { inline-size: 210mm; margin-inline: auto; box-shadow: 0 0 4mm rgb(0 0 0 / 0.2); }
  /* On screen, pin the per-page furniture to the sheet, not the window. */
  .paper > .rule, .paper > .foot-rule, .paper > .mark, .paper > .footer, .paper > .watermark { position: absolute; }
}
.paper { position: relative; inline-size: 210mm; min-block-size: 297mm; }
.frame td { padding-block: 0; padding-inline: 13.2mm 14.3mm; vertical-align: top; }
.head-space { block-size: 43mm; }
.foot-space { block-size: 36mm; }
.first-head {
  position: absolute; inset-block-start: 0; inset-inline: 0;
  block-size: 41mm; direction: ltr;
}
.logo {
  position: absolute; top: 3mm; left: 5.5mm; width: 86.9mm; height: 29mm;
}
.office {
  position: absolute; top: 4.7mm; right: 13.2mm; width: 70mm;
  direction: rtl; text-align: right; font-size: 10pt; line-height: 1.45;
}
.office p { margin: 0; }
.office .ref { unicode-bidi: isolate; direction: ltr; }
.barcode {
  margin-block-start: 1mm; direction: ltr; text-align: right;
  font-family: "GSSG Barcode 39"; font-size: 8pt; line-height: 1; white-space: nowrap;
}
.rule {
  position: fixed; top: 35mm; left: 25.1mm; width: 184.5mm; height: 5.5mm;
}
.rule .line {
  position: absolute; left: 0; top: 48.3%; width: 65%; height: 0.15mm; background: #b92027;
}
.rule .block {
  position: absolute; left: 65%; right: 0; top: 0; bottom: 0; background: #b92027;
}
/* footer1.xml: the same red, mirrored, above the contacts on every page. */
.foot-rule {
  position: fixed; bottom: 27.5mm; left: 0; width: 183.6mm; height: 5.5mm;
}
.foot-rule .block {
  position: absolute; left: 0; width: 34.6%; top: 0; bottom: 0; background: #b92027;
}
.foot-rule .line {
  position: absolute; left: 34.6%; right: 0; top: 48.3%; height: 0.15mm; background: #b92027;
}
.mark {
  position: fixed; top: 3.5mm; left: 0; right: 0; text-align: center;
  font-size: 9pt; text-decoration: underline; z-index: 3;
}
.footer {
  position: fixed; bottom: 14mm; left: 13.2mm; right: 14.3mm;
  direction: ltr; color: #a09f9f; font-family: "Gill Sans MT", "Gill Sans", sans-serif;
  font-size: 8pt; line-height: 1.3;
}
.contacts { display: flex; justify-content: space-between; align-items: center; gap: 4mm; }
.contact { display: flex; align-items: center; gap: 2mm; }
.contact img { width: 7mm; height: 7mm; }
.contact span { display: block; white-space: nowrap; }
.submitter { margin-block-end: 1mm; text-align: right; font-family: Helvetica, Arial, sans-serif; }
.watermark {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg);
  text-align: center; white-space: nowrap; pointer-events: none; z-index: 2;
  color: rgb(0 0 0 / 0.12); line-height: 1.3;
}
.watermark .draft { font-size: 64pt; font-weight: bold; font-family: "GSSG Naskh", sans-serif; }
.watermark .draft-number { font-size: 28pt; direction: ltr; unicode-bidi: isolate; }
.tiles { position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 2; }
.tiles-grid {
  position: absolute; inset: -30%; transform: rotate(-35deg);
  display: grid; grid-template-columns: repeat(5, 1fr); align-content: space-evenly;
  justify-items: center; row-gap: 14mm;
  color: rgb(0 0 0 / 0.10); font-family: Helvetica, Arial, sans-serif; font-size: 16pt;
  direction: ltr; white-space: nowrap;
}
/* General Book: subject on the inline end (left), bold, underlined, 16pt. */
.addressees { margin: 0 0 3mm; font-weight: bold; font-size: 14pt; }
.addressees p { margin: 0; }
.subjects {
  display: flex; justify-content: flex-end; gap: 1.5mm; margin: 0 0 4mm;
  font-weight: bold; font-size: 16pt; text-decoration: underline;
}
.subjects .lines { display: flex; flex-direction: column; }
/* Signature block and copies sit on the inline end (left), like the General Book. */
.signoff {
  inline-size: 70mm; margin-block-start: 8mm; margin-inline-start: auto;
  text-align: center; font-weight: bold; font-size: 14pt; break-inside: avoid;
}
.signoff p { margin: 0; }
.signoff .signature { display: block; margin-inline: auto; max-inline-size: 45mm; max-block-size: 22mm; }
.copies { display: flex; justify-content: flex-end; gap: 1.5mm; margin-block-start: 4mm; font-size: 10pt; }
.copies .lines { display: flex; flex-direction: column; }
.body { overflow-wrap: anywhere; }
.body img { max-inline-size: 100%; }
.body table { border-collapse: collapse; }
.body td, .body th { border: 0.2mm solid #000; padding-block: 1mm; padding-inline: 2mm; }
"""


def _fonts(ctx: PaperContext) -> str:
    return (
        "@font-face { font-family: 'GSSG Naskh'; font-weight: 400; "
        f"src: url('{_asset(ctx, 'NotoNaskhArabic-Regular.ttf')}') format('truetype'); }}\n"
        "@font-face { font-family: 'GSSG Naskh'; font-weight: 700; "
        f"src: url('{_asset(ctx, 'NotoNaskhArabic-Bold.ttf')}') format('truetype'); }}\n"
        "@font-face { font-family: 'GSSG Barcode 39'; "
        f"src: url('{_asset(ctx, 'LibreBarcode39-Regular.ttf')}') format('truetype'); }}\n"
    )


def _office_block(ctx: PaperContext) -> str:
    lines: list[str] = []
    is_draft = ctx.ref is None or ctx.paper_date is None
    if is_draft:
        if ctx.draft_number:
            lines.append(f'<p>رقم المسودة: <span class="ref">{_e(ctx.draft_number)}</span></p>')
    else:
        assert ctx.ref is not None and ctx.paper_date is not None
        lines.append(f'<p>الرقم: <span class="ref">{_e(ctx.ref)}</span></p>')
        lines.append(f'<p>التاريخ: <span class="ref">{ctx.paper_date:%d-%m-%Y}</span></p>')
    lines.append(f"<p>{_e(_OFFICE_AR)}</p>")
    if not is_draft:
        assert ctx.ref is not None and ctx.paper_date is not None
        payload = _e(barcode_payload(ctx.ref, ctx.paper_date))
        lines.append(f'<div class="barcode" aria-hidden="true">{payload}</div>')
    return '<div class="office">' + "".join(lines) + "</div>"


def _watermark(ctx: PaperContext) -> str:
    """The DRAFT mark, centred once; only Drafts carry it."""
    if ctx.ref is not None and ctx.paper_date is not None:
        return ""
    parts = ['<div class="draft">DRAFT / مسودة</div>']
    if ctx.draft_number:
        parts.append(f'<div class="draft-number">{_e(ctx.draft_number)}</div>')
    return '<div class="watermark" aria-hidden="true">' + "".join(parts) + "</div>"


_TILE_ROWS: Final = 12
_TILE_COLUMNS: Final = 5


def _viewer_tiles(ctx: PaperContext) -> str:
    """Secret and above: the viewer's G-number repeated across every page."""
    if GRADE_RANK[ctx.grade] < GRADE_RANK[SECRET] or not ctx.viewer_g_number:
        return ""
    tile = f"<span>{_e(ctx.viewer_g_number)}</span>"
    return (
        '<div class="tiles" aria-hidden="true"><div class="tiles-grid">'
        + tile * (_TILE_ROWS * _TILE_COLUMNS)
        + "</div></div>"
    )


def _footer(ctx: PaperContext) -> str:
    def contact(icon: str, *texts: str) -> str:
        spans = "".join(f"<span>{_e(text)}</span>" for text in texts)
        return (
            f'<div class="contact"><img src="{_asset(ctx, icon)}" alt=""><div>{spans}</div></div>'
        )

    return (
        '<div class="foot-rule" aria-hidden="true"><div class="block"></div><div class="line"></div></div>'
        '<footer class="footer">'
        f'<div class="submitter">{_e(ctx.submitter_g_number or "")}</div>'
        '<div class="contacts">'
        + contact("icon-location.png", "Abu Dhabi, United Arab Emirates")
        + contact("icon-email.png", "info@gss-group.net", "www.gss-group.net")
        + contact("icon-phone.png", "Phone: +9712 6666898", "Fax: +971 2 666 8980")
        + "</div></footer>"
    )


def _addressees(ctx: PaperContext) -> str:
    """General Book opening: one line per To, then the greeting once."""
    if not ctx.to_names:
        return ""
    lines = "".join(f'<p class="to">السيد \\ {_e(name)} المحترم</p>' for name in ctx.to_names)
    return f'<div class="addressees">{lines}<p class="greeting">تحية طيبة وبعد،</p></div>'


def _subjects(ctx: PaperContext) -> str:
    """General Book subject: on the left, bold, underlined; the label once."""
    if not ctx.subjects:
        return ""
    lines = "".join(f"<span>{_e(subject)}</span>" for subject in ctx.subjects)
    return (
        '<div class="subjects"><span class="label">الموضوع:</span>'
        f'<span class="lines">{lines}</span></div>'
    )


def _signoff(ctx: PaperContext) -> str:
    """Signing manager: signature (once signed), name, title."""
    if not ctx.signer_name:
        return ""
    parts: list[str] = []
    if ctx.signature_src:
        parts.append(f'<img class="signature" src="{_e(ctx.signature_src)}" alt="">')
    parts.append(f"<p>{_e(ctx.signer_name)}</p>")
    if ctx.signer_title:
        parts.append(f"<p>{_e(ctx.signer_title)}</p>")
    return '<div class="signoff">' + "".join(parts) + "</div>"


def _copies(ctx: PaperContext) -> str:
    """ "نسخة إلى:" once, then one CC per line."""
    if not ctx.cc_names:
        return ""
    lines = "".join(f"<span>{_e(name)}</span>" for name in ctx.cc_names)
    return (
        '<div class="copies"><span class="label">نسخة إلى:</span>'
        f'<span class="lines">{lines}</span></div>'
    )


def render_paper(ctx: PaperContext) -> str:
    """The complete A4 HTML paper for a Ledger Book Revision or Draft."""
    mark = paper_mark(ctx.grade)
    mark_html = f'<div class="mark">{_e(mark)}</div>' if mark else ""
    subjects_html = _subjects(ctx)
    title = ctx.ref or (f"مسودة {ctx.draft_number}" if ctx.draft_number else "مسودة")
    return (
        '<!DOCTYPE html>\n<html lang="ar" dir="rtl"><head><meta charset="utf-8">'
        f"<title>{_e(title)}</title>"
        f"<style>{_fonts(ctx)}{_CSS}</style></head><body>"
        '<div class="paper">'
        '<header class="first-head">'
        f'<img class="logo" src="{_asset(ctx, "letterhead-logo.png")}" alt="GSSG">'
        f"{_office_block(ctx)}</header>"
        '<div class="rule" aria-hidden="true"><div class="line"></div><div class="block"></div></div>'
        f"{mark_html}{_watermark(ctx)}{_viewer_tiles(ctx)}{_footer(ctx)}"
        '<table class="frame" role="presentation">'
        '<thead><tr><td><div class="head-space"></div></td></tr></thead>'
        '<tfoot><tr><td><div class="foot-space"></div></td></tr></tfoot>'
        f"<tbody><tr><td><main>{_addressees(ctx)}{subjects_html}"
        f'<div class="body">{ctx.body_html}</div>{_signoff(ctx)}{_copies(ctx)}</main>'
        "</td></tr></tbody></table></div></body></html>"
    )


def paper_response(html: str) -> HTMLResponse:
    """Serve a rendered paper with the ADR 0007 hardened headers."""
    return HTMLResponse(
        html,
        headers={
            "Content-Security-Policy": PAPER_CSP,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
