"""Signature identity primitives.

Every RENDERED manager/employee/submitter signature occurrence — not every
signature image FILE — gets a stable identity independent of its embedded
bytes: ``wp:docPr/@name = "GSSG_SIG_<uuid32>"`` and
``wp:docPr/@descr = "gssg-signature:v1:<role>:<uuid32>"``.

Why this survives the two things that would otherwise defeat identity:

* ``docxtpl`` renumbers ``wp:docPr/@id`` on every render and deduplicates
  identical media (repeated manager images share one ``/word/media/*``
  part) — neither the numeric id nor the media relationship distinguishes
  two occurrences of the SAME image (e.g. Employee Clearance's repeated
  manager signature). The UUID in ``@name``/``@descr`` is assigned fresh per
  occurrence at insertion time and is untouched by either process.
* A Word round-trip (open, save, convert to PDF) does not rewrite
  ``docPr`` attributes it doesn't understand; both ``@name`` and ``@descr``
  survive.

Database actor provenance (who signed, when, from which account) lives in
``SignatureArtifactRevision`` — never encoded in these markers. The markers
answer only "which occurrence is this", not "who put it there".
"""

from __future__ import annotations

import hashlib
import io
import re
import tempfile
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"

# EMU (English Metric Units) per point — the fixed OOXML conversion factor
# used throughout `wp:posOffset`/`wp:extent` (approval-signature-placement
# plan §6.4).
EMU_PER_POINT = 12700

# Probe geometry/matching tuning. Empirically proven against real Word
# (docx2pdf/win32com SaveAs2 → PyMuPDF get_image_info + pixel sampling):
# a 1pt probe is below Word's PDF-export anti-aliasing noise floor and
# reads back as a blurred, unmatchable color; 6pt survives reliably. A
# render-resolution pixmap sample (72 dpi) is too coarse for a probe this
# small — 300 dpi resolves it to a multi-pixel patch with a stable center
# color. Probes are floating (`wrapNone`), so their physical size never
# perturbs layout/pagination — only ONE run (the moved drawing's own, when
# it was inline) ever occupies real flow space; see `write_signature_position`.
_PROBE_SIZE_PT = 6.0
_SAMPLE_DPI = 300
_MATCH_TOLERANCE = 10
_MAX_ANCHOR_CANDIDATES = 64
# Grid step guarantees any two distinct probe indices differ by this much in
# at least one channel — far above `_MATCH_TOLERANCE`, so up to 8**3 = 512
# simultaneously-probed drawings/anchors never read back ambiguously.
_PROBE_GRID_BASE = 16
_PROBE_GRID_STEP = 32

SignatureRole = Literal["manager", "employee", "submitter"]

_MARKER_PREFIX = "GSSG_SIG_"
_DESCR_RE = re.compile(r"^gssg-signature:v1:(manager|employee|submitter):([0-9a-f]{32})$")

# Context keys `app.core.docx_render.render` resolves into inline images,
# after `docx_engine._adapt_common` (and the other per-form adapters that
# wrap it) have already renamed the v3 `sig1_path`/`sig2_path` keys. Any
# `*_sig_path` key NOT listed here (a future/unknown key) stays an ordinary
# unmarked image — see `role_for_sig_key`.
ROLE_BY_SIG_KEY: dict[str, SignatureRole] = {
    "manager_sig_path": "manager",
    "employee_sig_path": "employee",
    "submitter_sig_path": "submitter",
}


class SignatureIdentityError(ValueError):
    """A signature marker is malformed, mismatched, or duplicated.

    Raised by `inspect_signature_drawings` — never silently skipped, since
    treating a stale/foreign/ambiguous marker as absent would let placement
    code move under the wrong identity."""


def new_signature_id() -> str:
    """A fresh identity for one rendered signature occurrence."""
    return uuid.uuid4().hex


def marker_name(signature_id: str) -> str:
    return f"{_MARKER_PREFIX}{signature_id}"


def marker_descr(role: SignatureRole, signature_id: str) -> str:
    return f"gssg-signature:v1:{role}:{signature_id}"


def parse_marker_descr(descr: str | None) -> tuple[SignatureRole, str] | None:
    """Recover ``(role, signature_id)`` from a ``wp:docPr/@descr`` value, or
    None when *descr* is absent/foreign (an unrelated image's alt text)."""
    if not descr:
        return None
    match = _DESCR_RE.match(descr.strip())
    if not match:
        return None
    role = match.group(1)
    assert role in ("manager", "employee", "submitter")
    return role, match.group(2)  # type: ignore[return-value]


def role_for_sig_key(key: str) -> SignatureRole | None:
    """Role for a `docx_render` context key ending in `_sig_path`, or None
    for an unrecognized key (which stays an ordinary unmarked image)."""
    return ROLE_BY_SIG_KEY.get(key)


@dataclass(frozen=True, slots=True)
class SignatureDrawing:
    """One identified signature occurrence found in a rendered `.docx`."""

    signature_id: str
    role: SignatureRole
    part_name: str
    image_sha256: str
    width_emu: int
    height_emu: int


def inspect_signature_drawings(docx_path: Path) -> list[SignatureDrawing]:
    """Enumerate every marked signature occurrence in *docx_path*'s main
    document body (including table cells it contains).

    A marker whose ``descr`` is malformed, or whose ``docPr/@name`` doesn't
    match its ``descr``-encoded id, is an error (`SignatureIdentityError`) —
    never silently skipped, since a stray/foreign marker moving under
    someone else's identity is exactly the failure this scheme exists to
    prevent. Two drawings claiming the same `signature_id` is also an
    error. An unmarked drawing (a logo, an Aztec code, a header image) is
    simply not returned — it was never a signature occurrence.
    """
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(str(docx_path))
    part = doc.part
    seen_ids: set[str] = set()
    out: list[SignatureDrawing] = []
    for docpr in doc.element.body.iter(qn("wp:docPr")):
        name = docpr.get("name") or ""
        descr = docpr.get("descr")
        parsed = parse_marker_descr(descr)
        is_marker_name = name.startswith(_MARKER_PREFIX)
        if not is_marker_name and parsed is None:
            continue  # unrelated drawing (logo, header art, Aztec code, …)
        if parsed is None or not is_marker_name:
            raise SignatureIdentityError(
                f"Drawing has a partial/malformed signature marker in {docx_path}: "
                f"name={name!r} descr={descr!r}"
            )
        role, signature_id = parsed
        if name != marker_name(signature_id):
            raise SignatureIdentityError(
                f"Signature marker name/descr mismatch in {docx_path}: "
                f"name={name!r} descr={descr!r}"
            )
        if signature_id in seen_ids:
            raise SignatureIdentityError(
                f"Duplicate signature identity {signature_id!r} in {docx_path}"
            )
        seen_ids.add(signature_id)

        container = docpr.getparent()  # wp:inline or wp:anchor
        extent = container.find(qn("wp:extent")) if container is not None else None
        width_emu = int(extent.get("cx")) if extent is not None and extent.get("cx") else 0
        height_emu = int(extent.get("cy")) if extent is not None and extent.get("cy") else 0

        image_sha256 = ""
        blip = container.find(f".//{{{_A_NS}}}blip") if container is not None else None
        if blip is not None:
            rel_id = blip.get(f"{{{_R_NS}}}embed")
            if rel_id and rel_id in part.rels:
                image_sha256 = hashlib.sha256(part.rels[rel_id].target_part.blob).hexdigest()

        out.append(
            SignatureDrawing(
                signature_id=signature_id,
                role=role,
                part_name=str(part.partname),
                image_sha256=image_sha256,
                width_emu=width_emu,
                height_emu=height_emu,
            )
        )
    return out


class SignatureSourceUnavailableError(RuntimeError):
    """The retained/authored DOCX a measurement or move needs is missing,
    unreadable, or carries no eligible marked drawing. Maps to
    ``SIGNATURE_SOURCE_UNAVAILABLE`` (approval-signature-placement plan
    §6.10)."""


class SignatureRenderFailedError(RuntimeError):
    """Word/PDF conversion failed or produced no output during a
    measurement or move. Maps to ``SIGNATURE_RENDER_FAILED``."""


class SignatureLayoutChangedError(RuntimeError):
    """A move's rendered result changed page count, document text, or a
    non-target drawing's geometry/identity — the edit is rejected even
    though Word conversion itself succeeded. Maps to
    ``SIGNATURE_LAYOUT_CHANGED``."""


class SignatureLayoutUnsupportedError(RuntimeError):
    """The requested destination page has no safe anchor paragraph — moving
    there would require inserting a paragraph/page break, which this
    feature never does. Maps to ``SIGNATURE_LAYOUT_UNSUPPORTED`` (HTTP
    409)."""


class SignaturePositionInvalidError(ValueError):
    """Non-finite/out-of-range coordinates or a page number that isn't a
    positive integer. Maps to ``SIGNATURE_POSITION_INVALID`` (HTTP 422) —
    never silently clamped server-side."""


@dataclass(frozen=True, slots=True)
class SignaturePageInfo:
    """One physical page of a measured document, with a verified-safe
    anchor paragraph a move onto this page may reparent the drawing's run
    to. ``anchor_paragraph_index`` is the paragraph's 0-based ordinal among
    every ``w:p`` in the document body (including table cells), in document
    order — stable across a later `write_signature_position` call against
    the SAME source file."""

    page: int
    width_pt: float
    height_pt: float
    anchor_paragraph_index: int


@dataclass(frozen=True, slots=True)
class SignatureGeometry:
    """One signature occurrence's measured physical position."""

    page: int
    x: float
    y: float
    width_pt: float
    height_pt: float


@dataclass(frozen=True, slots=True)
class SignatureLayout:
    """A document's full measured layout: every physical page with a safe
    destination anchor, and every marked signature's current position.
    ``source_sha256`` binds a later `write_signature_position` call to this
    EXACT source content — a move against a source that changed since
    measurement (a concurrent correction, an unfile/replace) is rejected by
    the caller comparing this hash, not by this module."""

    source_sha256: str
    pages: tuple[SignaturePageInfo, ...]
    drawings: dict[str, SignatureGeometry]


def _distinct_rgb(index: int) -> tuple[int, int, int]:
    """A probe color for *index*, guaranteed >= `_PROBE_GRID_STEP` from
    every other index's color in at least one channel (up to 8**3 = 512
    simultaneously live indices)."""
    r = index % 8
    g = (index // 8) % 8
    b = (index // 64) % 8
    return (
        _PROBE_GRID_BASE + r * _PROBE_GRID_STEP,
        _PROBE_GRID_BASE + g * _PROBE_GRID_STEP,
        _PROBE_GRID_BASE + b * _PROBE_GRID_STEP,
    )


def _probe_png_bytes(rgb: tuple[int, int, int]) -> bytes:
    """A small OPAQUE solid-color PNG — deliberately NOT run through
    `signature_render.prepare_signature` (that pipeline recolors pixels by
    ink-coverage for real scanned signatures and would destroy a probe's
    intended exact RGB)."""
    from PIL import Image as _Image

    buf = io.BytesIO()
    _Image.new("RGB", (24, 24), rgb).save(buf, format="PNG")
    return buf.getvalue()


def _transparent_png_bytes() -> bytes:
    """A 1x1 fully-transparent PNG — the inline spacer left behind when a
    previously-inline signature is floated for the first time (plan §6.6)."""
    from PIL import Image as _Image

    buf = io.BytesIO()
    _Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def _iter_body_paragraphs(document: Any) -> list[Any]:
    """Every paragraph in the document body, INCLUDING table cells, in
    document order — used for STABLE ordinal indexing
    (`SignaturePageInfo.anchor_paragraph_index`) only. Table-nested
    paragraphs are excluded from actual anchor CANDIDACY by
    `_is_table_nested` — see `measure_signature_layout`."""
    from docx.oxml.ns import qn
    from docx.text.paragraph import Paragraph

    return [Paragraph(p_el, document) for p_el in document.element.body.iter(qn("w:p"))]


def _is_table_nested(paragraph: Any) -> bool:
    """True iff *paragraph* sits inside a ``w:tbl`` (at any depth).

    Empirically, real Word's PDF export does not reliably honor
    ``positionH/positionV relativeFrom="page"`` with ``layoutInCell="0"``
    for a floating anchor whose run lives inside a table cell — the cell's
    own column offset measurably leaks into the rendered position (proven
    against the real Leave Application Form template: a same-page move
    landed ~78pt off in x when reparented into a table-nested anchor
    paragraph). Anchor CANDIDATES are therefore restricted to paragraphs
    that are direct descendants of ``w:body`` — never inside any table —
    even though the ORIGINAL signature drawing itself may live in a table
    cell (only its destination anchor paragraph must not)."""
    from docx.oxml.ns import qn as _qn

    element = paragraph._p.getparent()
    while element is not None:
        if element.tag == _qn("w:tbl"):
            return True
        if element.tag == _qn("w:body"):
            return False
        element = element.getparent()
    return False


def _embed_raw_probe(paragraph: Any, probe_bytes: bytes, *, width_pt: float) -> Any:
    """Add *probe_bytes* as a fresh inline run in *paragraph*, bypassing the
    signature-ink processing pipeline. Returns the resulting ``w:drawing``."""
    from docx.oxml.ns import qn
    from docx.shared import Emu

    run = paragraph.add_run()
    run.add_picture(io.BytesIO(probe_bytes), width=Emu(round(width_pt * EMU_PER_POINT)))
    return run._element.find(qn("w:drawing"))


def _find_probe(
    document: Any, rgb: tuple[int, int, int]
) -> tuple[int, tuple[float, float, float, float]] | None:
    """Locate the rendered image matching *rgb* by sampling its bounding
    box's center pixel at `_SAMPLE_DPI` (a render-resolution 72 dpi sample
    is too coarse for a probe this small — proven empirically). Returns
    ``(0-based page index, bbox)`` or None."""
    import fitz

    for page_index in range(document.page_count):
        page = document[page_index]
        for info in page.get_image_info(hashes=True):
            rect = fitz.Rect(info["bbox"])
            if rect.width <= 0 or rect.height <= 0:
                continue
            pix = page.get_pixmap(clip=rect, dpi=_SAMPLE_DPI)
            if pix.width == 0 or pix.height == 0:
                continue
            sample = pix.pixel(pix.width // 2, pix.height // 2)[:3]
            if all(abs(a - b) <= _MATCH_TOLERANCE for a, b in zip(sample, rgb, strict=True)):
                return page_index, (rect.x0, rect.y0, rect.x1, rect.y1)
    return None


def measure_signature_layout(
    docx_path: Path, *, converter: Callable[[Path], Path | None]
) -> SignatureLayout:
    """Measure every marked signature's physical page/position in
    *docx_path*, plus a bounded set of verified-safe destination anchor
    paragraphs (one representative per physical page reached).

    Runs ONE disposable Word conversion: every marked signature's image is
    swapped to a distinct opaque probe color (new relationship per
    occurrence — the shared media part is never touched, so repeated
    identical-byte signatures stay disambiguated), and a bounded, evenly
    sampled set of body/table paragraphs each get a floating, non-wrapping,
    distinctly colored probe (`_convert_inline_drawing_to_anchor` — zero
    layout-height, never perturbs pagination). *converter* is called
    exactly once, directly (never recursively resubmitted to whatever
    executor the caller itself runs under — the isolated worker in
    ``_pdf_executor`` owns that policy, not this function).

    Raises `SignatureSourceUnavailableError` when *docx_path* carries no
    marked drawing, `SignatureIdentityError` (from `inspect_signature_drawings`)
    on a malformed/duplicate marker, and `SignatureRenderFailedError` when
    *converter* fails to produce a PDF.
    """
    import fitz
    from docx import Document
    from docx.oxml.ns import qn

    from app.core._docx_helpers import _convert_inline_drawing_to_anchor

    drawings = inspect_signature_drawings(docx_path)
    if not drawings:
        raise SignatureSourceUnavailableError(f"{docx_path} has no marked signature drawing")

    source_sha256 = hashlib.sha256(docx_path.read_bytes()).hexdigest()
    doc = Document(str(docx_path))
    part = doc.part

    docpr_by_id: dict[str, Any] = {}
    for docpr in doc.element.body.iter(qn("wp:docPr")):
        parsed = parse_marker_descr(docpr.get("descr"))
        if parsed is not None:
            docpr_by_id[parsed[1]] = docpr

    probe_index = 0
    sig_probe_rgb: dict[str, tuple[int, int, int]] = {}
    for drawing in drawings:
        docpr = docpr_by_id.get(drawing.signature_id)
        if docpr is None:
            continue  # unreachable: inspect_signature_drawings sourced this same id
        container = docpr.getparent()
        blip = container.find(f".//{{{_A_NS}}}blip") if container is not None else None
        if blip is None:
            raise SignatureIdentityError(
                f"Signature {drawing.signature_id!r} has no image reference in {docx_path}"
            )
        rgb = _distinct_rgb(probe_index)
        probe_index += 1
        sig_probe_rgb[drawing.signature_id] = rgb
        new_rel_id, _image = part.get_or_add_image(io.BytesIO(_probe_png_bytes(rgb)))
        blip.set(f"{{{_R_NS}}}embed", new_rel_id)

    full_paragraphs = _iter_body_paragraphs(doc)
    eligible_indices = [i for i, p in enumerate(full_paragraphs) if not _is_table_nested(p)]
    if len(eligible_indices) > _MAX_ANCHOR_CANDIDATES:
        step = len(eligible_indices) / _MAX_ANCHOR_CANDIDATES
        candidate_indices = sorted(
            {eligible_indices[int(i * step)] for i in range(_MAX_ANCHOR_CANDIDATES)}
        )
    else:
        candidate_indices = eligible_indices

    anchor_probe_rgb: dict[int, tuple[int, int, int]] = {}
    for full_index in candidate_indices:
        rgb = _distinct_rgb(probe_index)
        probe_index += 1
        anchor_probe_rgb[full_index] = rgb
        drawing_el = _embed_raw_probe(
            full_paragraphs[full_index], _probe_png_bytes(rgb), width_pt=_PROBE_SIZE_PT
        )
        _convert_inline_drawing_to_anchor(drawing_el, bottom_align=False, center_horizontal=False)

    with tempfile.TemporaryDirectory(prefix="gssg-sig-measure-") as tmp_dir:
        tmp_docx = Path(tmp_dir) / "measure.docx"
        doc.save(str(tmp_docx))
        pdf_path = converter(tmp_docx)
        if pdf_path is None or not pdf_path.exists():
            raise SignatureRenderFailedError(f"Word conversion failed while measuring {docx_path}")

        pdf = fitz.open(str(pdf_path))
        try:
            page_dims = {
                i: (pdf[i].bound().width, pdf[i].bound().height) for i in range(pdf.page_count)
            }

            page_infos: list[SignaturePageInfo] = []
            seen_pages: set[int] = set()
            for full_index in candidate_indices:
                located = _find_probe(pdf, anchor_probe_rgb[full_index])
                if located is None:
                    continue
                page_index, _bbox = located
                if page_index in seen_pages:
                    continue
                seen_pages.add(page_index)
                width_pt, height_pt = page_dims[page_index]
                page_infos.append(
                    SignaturePageInfo(
                        page=page_index + 1,
                        width_pt=width_pt,
                        height_pt=height_pt,
                        anchor_paragraph_index=full_index,
                    )
                )

            geometries: dict[str, SignatureGeometry] = {}
            for drawing in drawings:
                probe_rgb = sig_probe_rgb.get(drawing.signature_id)
                if probe_rgb is None:
                    continue
                located = _find_probe(pdf, probe_rgb)
                if located is None:
                    continue
                page_index, (x0, y0, x1, y1) = located
                width_pt, height_pt = page_dims[page_index]
                geometries[drawing.signature_id] = SignatureGeometry(
                    page=page_index + 1,
                    x=x0 / width_pt if width_pt else 0.0,
                    y=y0 / height_pt if height_pt else 0.0,
                    width_pt=x1 - x0,
                    height_pt=y1 - y0,
                )
        finally:
            pdf.close()

    return SignatureLayout(
        source_sha256=source_sha256,
        pages=tuple(sorted(page_infos, key=lambda p: p.page)),
        drawings=geometries,
    )


def _position_drawing_as_page_anchor(
    drawing: Any,
    *,
    x_emu: int,
    y_emu: int,
    width_emu: int,
    height_emu: int,
    behind_doc: str,
) -> None:
    """Rebuild *drawing*'s ``wp:inline``/``wp:anchor`` child as a fresh
    page-relative ``wp:anchor`` at the given offsets/size, carrying over its
    EXISTING ``wp:docPr``/``wp:cNvGraphicFramePr``/``a:graphic`` — same
    relationship id, same image bytes, same crop/rotation transforms.
    Idempotent whether the prior container was inline or already anchored."""
    from docx.oxml import parse_xml
    from docx.oxml.ns import qn

    container = drawing.find(qn("wp:inline"))
    if container is None:
        container = drawing.find(qn("wp:anchor"))
    if container is None:
        raise SignatureIdentityError("Drawing has neither wp:inline nor wp:anchor")

    anchor_xml = (
        f'<wp:anchor xmlns:wp="{_WP_NS}" '
        'distT="0" distB="0" distL="0" distR="0" simplePos="0" '
        f'relativeHeight="251660000" behindDoc="{behind_doc}" locked="0" '
        'layoutInCell="0" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/>'
        '<wp:positionH relativeFrom="page">'
        f"<wp:posOffset>{x_emu}</wp:posOffset></wp:positionH>"
        '<wp:positionV relativeFrom="page">'
        f"<wp:posOffset>{y_emu}</wp:posOffset></wp:positionV>"
        f'<wp:extent cx="{width_emu}" cy="{height_emu}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        "<wp:wrapNone/>"
        "</wp:anchor>"
    )
    anchor = parse_xml(anchor_xml)
    ns_uri = {"wp": _WP_NS, "a": _A_NS}
    for prefixed in ("wp:docPr", "wp:cNvGraphicFramePr", "a:graphic"):
        prefix, local = prefixed.split(":")
        child = container.find(f"{{{ns_uri[prefix]}}}{local}")
        if child is not None:
            anchor.append(child)
    drawing.remove(container)
    drawing.append(anchor)


def write_signature_position(
    source: Path,
    destination: Path,
    *,
    signature_id: str,
    page: int,
    x: float,
    y: float,
    layout: SignatureLayout,
) -> None:
    """Move the marked signature *signature_id* in *source* to the given
    physical *page* (1-based) and normalized top-left (*x*, *y*), writing
    the result to *destination*. *source* is never modified.

    ``wp:anchor``, ``positionH``/``positionV relativeFrom="page"``, offsets
    in EMU (approval-signature-placement plan §6.5) — the requested point
    IS the displayed rectangle's top-left; no further adjustment is applied
    by a caller. Image relationship/bytes/crop/rotation and physical size
    (the drawing's own existing extent, not a value the caller supplies)
    are preserved exactly; only position changes.

    A previously-inline drawing leaves an unmarked transparent 1x1 PNG
    spacer at its original extent in its original run, so the paragraph's
    line/row allocation is unaffected (plan §6.6). An already-floating
    drawing is reparented without a spacer. Both cases append the moved
    drawing's OWN run (not a copy) to the destination page's verified
    anchor paragraph, from `layout.pages`.

    Raises `SignaturePositionInvalidError` for a non-finite/out-of-range
    ``x``/``y``, a non-positive ``page``, or a rectangle that would not
    fully fit the destination page. Raises `SignatureLayoutUnsupportedError`
    when *page* has no verified-safe anchor in *layout* (never inserts a
    paragraph/page break to manufacture one). Raises `SignatureIdentityError`
    when *signature_id* is not present/malformed in *source*.
    """
    import math

    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Emu

    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise SignaturePositionInvalidError(f"page must be a positive integer, got {page!r}")
    if not math.isfinite(x) or not math.isfinite(y) or isinstance(x, bool) or isinstance(y, bool):
        raise SignaturePositionInvalidError(f"x/y must be finite numbers, got x={x!r} y={y!r}")
    if not (0.0 <= x <= 1.0) or not (0.0 <= y <= 1.0):
        raise SignaturePositionInvalidError(f"x/y must be within [0, 1], got x={x!r} y={y!r}")

    page_info = next((p for p in layout.pages if p.page == page), None)
    if page_info is None:
        raise SignatureLayoutUnsupportedError(
            f"page {page} has no verified-safe destination anchor"
        )

    geometry = layout.drawings.get(signature_id)
    if geometry is None:
        raise SignatureIdentityError(f"{signature_id!r} was not measured in this layout")
    if (
        x * page_info.width_pt + geometry.width_pt > page_info.width_pt + 0.5
        or y * page_info.height_pt + geometry.height_pt > page_info.height_pt + 0.5
    ):
        raise SignaturePositionInvalidError(
            f"signature rectangle does not fit page {page} at x={x!r} y={y!r}"
        )

    doc = Document(str(source))
    docpr = None
    for candidate in doc.element.body.iter(qn("wp:docPr")):
        if candidate.get("name") == marker_name(signature_id):
            docpr = candidate
            break
    if docpr is None:
        raise SignatureIdentityError(f"{signature_id!r} not found in {source}")

    container = docpr.getparent()  # wp:inline or wp:anchor
    was_anchor = container.tag == qn("wp:anchor")
    behind_doc = container.get("behindDoc", "0") if was_anchor else "0"
    extent = container.find(qn("wp:extent"))
    width_emu = int(extent.get("cx"))
    height_emu = int(extent.get("cy"))

    drawing = container.getparent()  # w:drawing
    run_element = drawing.getparent()  # w:r
    source_paragraph_element = run_element.getparent()  # w:p

    if not was_anchor:
        # First move of a previously-inline drawing: leave a same-extent
        # transparent spacer at the ORIGINAL run's position so line/row
        # allocation is unaffected, per plan §6.6.
        from docx.text.paragraph import Paragraph as _Paragraph

        source_index = list(source_paragraph_element).index(run_element)
        spacer_paragraph = _Paragraph(source_paragraph_element, doc)
        spacer_run = spacer_paragraph.add_run()
        spacer_run.add_picture(
            io.BytesIO(_transparent_png_bytes()),
            width=Emu(width_emu),
            height=Emu(height_emu),
        )
        spacer_element = spacer_run._element
        source_paragraph_element.remove(spacer_element)
        source_paragraph_element.insert(source_index, spacer_element)

    source_paragraph_element.remove(run_element)
    x_emu = round(x * page_info.width_pt * EMU_PER_POINT)
    y_emu = round(y * page_info.height_pt * EMU_PER_POINT)
    _position_drawing_as_page_anchor(
        drawing,
        x_emu=x_emu,
        y_emu=y_emu,
        width_emu=width_emu,
        height_emu=height_emu,
        behind_doc=behind_doc,
    )

    full_paragraphs = _iter_body_paragraphs(doc)
    target_paragraph = full_paragraphs[page_info.anchor_paragraph_index]
    target_paragraph._p.append(run_element)

    destination.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(destination))


def validate_move(
    *,
    before_docx: Path,
    after_docx: Path,
    before_pdf: Path,
    after_pdf: Path,
    signature_id: str,
    requested_page: int,
    requested_x: float,
    requested_y: float,
    layout_after: SignatureLayout,
) -> None:
    """Raise `SignatureLayoutChangedError` unless *after_docx*/*after_pdf*
    differ from *before_docx*/*before_pdf* by nothing but *signature_id*'s
    position (plan §6.8). Checked, in order: PDF page count; extracted
    document text (ordered, exact); every OTHER marked signature's identity
    (image SHA-256) and physical size; and that the moved signature
    actually landed on *requested_page* within 1 point of
    (*requested_x*, *requested_y*). Never mutates either input.

    Deliberately does not diff arbitrary UNMARKED image byte-identity
    across the two separate Word conversions — Word's own PDF re-embedding
    is not proven deterministic run-to-run for content this function never
    touches, so that comparison would be noise, not signal. Marked
    signatures are compared via `signature_layout` identity (byte-stable by
    construction), and ordered document text is the strong content-loss
    signal the plan requires.
    """
    import fitz

    before_pdf_doc = fitz.open(str(before_pdf))
    after_pdf_doc = fitz.open(str(after_pdf))
    try:
        if before_pdf_doc.page_count != after_pdf_doc.page_count:
            raise SignatureLayoutChangedError(
                f"page count changed: {before_pdf_doc.page_count} -> {after_pdf_doc.page_count}"
            )
        before_text = "".join(page.get_text() for page in before_pdf_doc)
        after_text = "".join(page.get_text() for page in after_pdf_doc)
        if before_text != after_text:
            raise SignatureLayoutChangedError("document text changed")
    finally:
        before_pdf_doc.close()
        after_pdf_doc.close()

    before_drawings = {d.signature_id: d for d in inspect_signature_drawings(before_docx)}
    after_drawings = {d.signature_id: d for d in inspect_signature_drawings(after_docx)}
    if set(before_drawings) != set(after_drawings):
        raise SignatureLayoutChangedError("signature identity set changed")
    for sig_id, before_drawing in before_drawings.items():
        if sig_id == signature_id:
            continue
        after_drawing = after_drawings[sig_id]
        if before_drawing.image_sha256 != after_drawing.image_sha256:
            raise SignatureLayoutChangedError(f"non-target signature {sig_id} image changed")
        if (
            before_drawing.width_emu != after_drawing.width_emu
            or before_drawing.height_emu != after_drawing.height_emu
        ):
            raise SignatureLayoutChangedError(f"non-target signature {sig_id} size changed")

    geometry = layout_after.drawings.get(signature_id)
    if geometry is None:
        raise SignatureLayoutChangedError("moved signature not found after remeasurement")
    if geometry.page != requested_page:
        raise SignatureLayoutChangedError(
            f"moved signature landed on page {geometry.page}, requested {requested_page}"
        )
    page_info = next((p for p in layout_after.pages if p.page == geometry.page), None)
    width_pt = page_info.width_pt if page_info is not None else 612.0
    height_pt = page_info.height_pt if page_info is not None else 792.0
    dx = abs(geometry.x * width_pt - requested_x * width_pt)
    dy = abs(geometry.y * height_pt - requested_y * height_pt)
    if dx > 1.0 or dy > 1.0:
        raise SignatureLayoutChangedError(
            f"moved signature landed {dx:.2f}/{dy:.2f}pt off the requested position"
        )


def render_signature_free_background(
    docx_path: Path, *, signature_id: str, converter: Callable[[Path], Path | None]
) -> Path:
    """Render *docx_path* with ONLY *signature_id*'s image replaced by a
    transparent same-extent placeholder, in a disposable temporary copy —
    the editor's drag-preview background (plan §6.9). Never erases a PDF
    rectangle (which could delete the manager name or other nearby
    content); only the one drawing's image reference changes.

    Returns the rendered PDF path, inside a fresh temporary directory the
    CALLER owns and must clean up. Raises `SignatureIdentityError` when
    *signature_id* is absent, `SignatureRenderFailedError` when *converter*
    fails to produce a PDF.
    """
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(str(docx_path))
    part = doc.part
    docpr = next(
        (
            c
            for c in doc.element.body.iter(qn("wp:docPr"))
            if c.get("name") == marker_name(signature_id)
        ),
        None,
    )
    if docpr is None:
        raise SignatureIdentityError(f"{signature_id!r} not found in {docx_path}")
    container = docpr.getparent()
    blip = container.find(f".//{{{_A_NS}}}blip") if container is not None else None
    if blip is None:
        raise SignatureIdentityError(f"{signature_id!r} has no image reference in {docx_path}")
    new_rel_id, _image = part.get_or_add_image(io.BytesIO(_transparent_png_bytes()))
    blip.set(f"{{{_R_NS}}}embed", new_rel_id)

    tmp_dir = Path(tempfile.mkdtemp(prefix="gssg-sig-bg-"))
    tmp_docx = tmp_dir / "background.docx"
    doc.save(str(tmp_docx))
    pdf_path = converter(tmp_docx)
    if pdf_path is None or not pdf_path.exists():
        raise SignatureRenderFailedError(
            f"Word conversion failed while rendering signature-free background for {docx_path}"
        )
    return pdf_path


def extract_signature_image_bytes(docx_path: Path, signature_id: str) -> bytes:
    """Return the raw embedded image bytes for *signature_id* in
    *docx_path* — no crop/rotation transform applied (an accepted scope
    reduction from the plan's "applying its existing crop/rotation for
    preview" language: the transform-aware render belongs to the Word-COM
    layer and is not duplicated here for a plain still-image preview).
    Raises `SignatureIdentityError` when *signature_id* is absent."""
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(str(docx_path))
    part = doc.part
    docpr = next(
        (
            c
            for c in doc.element.body.iter(qn("wp:docPr"))
            if c.get("name") == marker_name(signature_id)
        ),
        None,
    )
    if docpr is None:
        raise SignatureIdentityError(f"{signature_id!r} not found in {docx_path}")
    container = docpr.getparent()
    blip = container.find(f".//{{{_A_NS}}}blip") if container is not None else None
    if blip is None:
        raise SignatureIdentityError(f"{signature_id!r} has no image reference in {docx_path}")
    rel_id = blip.get(f"{{{_R_NS}}}embed")
    if not rel_id or rel_id not in part.rels:
        raise SignatureIdentityError(f"{signature_id!r} image relationship is missing")
    blob = part.rels[rel_id].target_part.blob
    return bytes(blob)


def extract_candidate_image_bytes(docx_path: Path, docpr_name: str) -> bytes:
    """Return the raw embedded image bytes for an UNMARKED legacy candidate
    drawing identified by its ``wp:docPr/@name`` — same scope as
    `extract_signature_image_bytes`."""
    from docx import Document
    from docx.oxml.ns import qn

    doc = Document(str(docx_path))
    part = doc.part
    docpr = next(
        (c for c in doc.element.body.iter(qn("wp:docPr")) if (c.get("name") or "") == docpr_name),
        None,
    )
    if docpr is None:
        raise SignatureIdentityError(f"candidate drawing {docpr_name!r} not found in {docx_path}")
    container = docpr.getparent()
    blip = container.find(f".//{{{_A_NS}}}blip") if container is not None else None
    if blip is None:
        raise SignatureIdentityError(f"candidate drawing {docpr_name!r} has no image reference")
    rel_id = blip.get(f"{{{_R_NS}}}embed")
    if not rel_id or rel_id not in part.rels:
        raise SignatureIdentityError(f"candidate drawing {docpr_name!r} image relationship missing")
    blob = part.rels[rel_id].target_part.blob
    return bytes(blob)
