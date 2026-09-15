"""Generic DOCX template renderer using docxtpl (Jinja-in-DOCX).

Replaces the hand-coded ``fill_*`` methods of v3's ``TemplateFiller`` with a
single ``render()`` that walks the template and substitutes ``{{ tokens }}``
against a data dict.

## Public contract

    render(template_path, data, output_path, *, post_process=None) -> Path

## Token convention

* Tokens match data-dict keys exactly. ``{{ employee_id }}`` ↔ ``data["employee_id"]``.
* Missing keys render as empty string (Jinja lenient mode by default).
* Signature paths pass through `data["<name>_sig_path"]`; the renderer
  converts present-and-existing paths to ``InlineImage`` and missing/blank
  paths to ``""``. Use token ``{{ employee_sig }}`` for data key
  ``employee_sig_path``.
* ``data["today"]`` defaults to ``datetime.now().strftime("%d/%m/%Y")``.

## Jinja globals registered for templates

* ``tick(label)`` — returns ``☑`` if `data["leave_type"]` matches, else ``□``.
* ``check(key)`` — returns ``✓`` if `data["doc_selections"][key]` is truthy.
* ``item(i, field, default="")`` — safe lookup into `data["items"][i][field]`.
* ``vio(row, field, default="")`` — find violation in `data["violations"]`
  where ``v["row"] == row``, return ``v[field]`` (default if not found).
* ``clearance(table_idx, row, default="")`` — formatted "Y - remark" / "N"
  from `data["clearance_marks"][f"{table_idx}_{row}"]`.
* ``weekday_ar`` (variable) — Arabic weekday name for `data["today"]` (or now).
* ``now_time`` (variable) — Arabic 12-hour clock for now, e.g. "1:05 م".

## post_process hook

Optional callable ``(doc: Document, ctx: dict) -> None`` invoked AFTER the
Jinja render. Used by forms that need:

* Behind-text floating signature anchoring (Leave Permit, Admin Leave).
* Dotted-line paragraph fallback for long reasons (Resignation Letter).
"""

from __future__ import annotations

import base64
import logging
from collections.abc import Callable, Mapping
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from docx.shared import Mm
from docxtpl import DocxTemplate, InlineImage
from jinja2 import Environment, StrictUndefined, Undefined
from jinja2.sandbox import SandboxedEnvironment

from app.core.constants import ARABIC_WEEKDAYS
from app.core.signature_render import (
    DEFAULT_SIG_BOLDNESS,
    DEFAULT_SIG_SIZE_MM,
    prepare_signature,
)

log = logging.getLogger(__name__)

DEFAULT_SIG_WIDTH_MM = DEFAULT_SIG_SIZE_MM


class SignatureInlineImage(InlineImage):  # type: ignore[misc]
    """``InlineImage`` that tags its inserted drawing with a stable
    per-occurrence identity marker (``wp:docPr`` ``@name``/``@descr`` — see
    ``app.core.signature_layout``).

    docxtpl renumbers drawing ids and deduplicates identical media on every
    render, so neither survives as an identity for "this particular
    signature occurrence" (a form with a repeated manager image, e.g.
    Employee Clearance, gets ONE media part shared by several drawings).
    Assigning a fresh UUID here, at insertion time, is unaffected by either.

    Overrides only ``_insert_image`` — the run-boundary wrapper text emitted
    by ``InlineImage.__str__``/``__html__`` is untouched, so this is a
    drop-in replacement wherever an ``InlineImage`` was used.
    """

    def __init__(
        self,
        tpl: DocxTemplate,
        image_descriptor: Any,
        *,
        role: str,
        width: Any = None,
        height: Any = None,
        anchor: str | None = None,
    ) -> None:
        super().__init__(tpl, image_descriptor, width=width, height=height, anchor=anchor)
        self._signature_role = role

    def _insert_image(self) -> str:
        from docx.oxml import parse_xml

        from app.core.signature_layout import marker_descr, marker_name, new_signature_id

        inline = self.tpl.current_rendering_part.new_pic_inline(
            self.image_descriptor, self.width, self.height
        )
        signature_id = new_signature_id()
        inline.docPr.name = marker_name(signature_id)
        inline.docPr.set("descr", marker_descr(self._signature_role, signature_id))  # type: ignore[arg-type]
        pic = inline.xml
        if self.anchor:
            run = parse_xml(pic)
            if run.xpath(".//a:blip"):
                hyperlink = self._add_hyperlink(run, self.anchor, self.tpl.current_rendering_part)
                pic = hyperlink.xml
        return f'</w:t></w:r><w:r><w:drawing>{pic}</w:drawing></w:r><w:r><w:t xml:space="preserve">'


class _SilentUndefined(Undefined):
    """Render missing tokens as empty string instead of raising — v3 was
    lenient (missing keys → ``""``) and we preserve that behaviour."""

    def __str__(self) -> str:
        return ""

    def __bool__(self) -> bool:
        return False


def _make_tick(leave_type: str) -> Callable[[str], str]:
    def tick(label: str) -> str:
        return "☑" if label == leave_type else "□"

    return tick


def _make_check(selections: Mapping[str, Any]) -> Callable[[str], str]:
    def check(key: str) -> str:
        # ✓ when checked, □ (white square) when not — matches v3's visual
        # behaviour where unchecked cells preserved their Wingdings box glyph.
        return "✓" if selections.get(key) else "□"

    return check


def _make_item_lookup(items: list[dict[str, Any]]) -> Callable[..., Any]:
    def item(i: int, field: str, default: str = "") -> Any:
        """Return items[i][field], or `default` only when the item exists.

        Out-of-range indices return "" (empty rows stay blank), matching v3
        which only filled rows that had data.
        """
        if 0 <= i < len(items):
            return items[i].get(field, default)
        return ""

    return item


def _make_vio_lookup(violations: list[dict[str, Any]]) -> Callable[..., Any]:
    def vio(row: int, field: str, default: str = "") -> Any:
        """Return v[field] for the violation matching `row`, else "".

        The `default` only applies when a matching violation exists but the
        field is absent — never when the violation itself is absent. This
        matches v3 behaviour (empty rows print blank, filled rows get the
        ✓ default for remarks).
        """
        for v in violations:
            if v.get("row") == row:
                return v.get(field, default)
        return ""

    return vio


def _make_clearance_lookup(
    marks: Mapping[str, Any], remarks: Mapping[str, str]
) -> Callable[..., str]:
    def clearance(table_idx: int, row: int, default: str = "") -> str:
        key = f"{table_idx}_{row}"
        if key not in marks:
            return default
        mark = "Y" if marks[key] else "N"
        remark = remarks.get(key, "")
        return f"{mark} - {remark}" if remark else mark

    return clearance


def _resolve_sig(
    tpl: DocxTemplate,
    path: str | Path | None,
    width_mm: int = DEFAULT_SIG_WIDTH_MM,
    dilate_radius_px: int = DEFAULT_SIG_BOLDNESS,
    *,
    role: str | None = None,
) -> InlineImage | str:
    if not path:
        return ""
    # Captured (drawn) signatures arrive as a base64 ``data:image/...`` URL
    # from the React SignatureField, not a filesystem path. Decode those into
    # raw bytes so the image still embeds (Path(...).exists() would be False
    # and silently drop the signature).
    if isinstance(path, str) and path.startswith("data:"):
        try:
            head, _, b64 = path.partition(",")
            if "base64" not in head or not b64:
                return ""
            raw = base64.b64decode(b64)
        except (ValueError, base64.binascii.Error) as e:  # type: ignore[attr-defined]
            log.warning("_resolve_sig: base64 decode failed: %s", e)
            return ""
        prepared = BytesIO(prepare_signature(raw, dilate_radius_px=dilate_radius_px))
        if role is not None:
            return SignatureInlineImage(tpl, prepared, role=role, width=Mm(width_mm))
        return InlineImage(tpl, prepared, width=Mm(width_mm))
    p = Path(path)
    if not p.exists():
        return ""
    prepared = BytesIO(prepare_signature(p.read_bytes(), dilate_radius_px=dilate_radius_px))
    if role is not None:
        return SignatureInlineImage(tpl, prepared, role=role, width=Mm(width_mm))
    return InlineImage(tpl, prepared, width=Mm(width_mm))


def _arabic_weekday(today_str: str) -> str:
    """Map dd/mm/yyyy → ARABIC_WEEKDAYS[weekday()]. Falls back to today."""
    try:
        dt = datetime.strptime(today_str, "%d/%m/%Y")
    except (ValueError, TypeError):
        dt = datetime.now()
    return ARABIC_WEEKDAYS[dt.weekday()]


def _arabic_clock(now: datetime) -> str:
    """12-hour clock with the Arabic meridiem, e.g. "1:05 م" (ص before noon)."""
    hour = now.hour % 12 or 12
    meridiem = "ص" if now.hour < 12 else "م"
    return f"{hour}:{now.minute:02d} {meridiem}"


def _apply_context_defaults(context: dict[str, Any]) -> None:
    """Date/weekday/time tokens every template may use. Caller values win."""
    context.setdefault("today", datetime.now().strftime("%d/%m/%Y"))
    context.setdefault("weekday_ar", _arabic_weekday(context["today"]))
    context.setdefault("now_time", _arabic_clock(datetime.now()))


def _prepare_manager_signature_bookmark(template_path: Path) -> Path | BytesIO:
    """Return a source to render *template_path* from that carries the
    ``GSSG_ManagerSignature`` bookmark around its ``{{ manager_sig }}``
    paragraph — added BEFORE Jinja substitution removes the empty token, so
    the paragraph is still identifiable afterward regardless of whether the
    token resolved to an image or stayed blank (approval-signature-placement
    plan §3; General Book / Security Permit only).

    Returns *template_path* unchanged when the bookmark is already present
    (idempotent) or the token paragraph can't be found (caller falls back to
    text-anchor detection at signing time —
    ``docx_engine._stamp_manager_signing_block``). Otherwise returns an
    in-memory ``BytesIO`` (``DocxTemplate`` accepts either a path or a
    stream) — never writes to the tracked template file, and a stream needs
    no temp-file cleanup since ``docxtpl`` only reads it lazily inside
    ``.render()``, well after this function returns.
    """
    from docx import Document as _Document

    from app.core._docx_helpers import find_bookmark_index, wrap_paragraph_in_bookmark

    doc = _Document(str(template_path))
    paras = list(doc.paragraphs)
    if find_bookmark_index(paras, "GSSG_ManagerSignature") is not None:
        return template_path
    target = next((p for p in paras if p.text.strip() == "{{ manager_sig }}"), None)
    if target is None:
        return template_path
    wrap_paragraph_in_bookmark(target, "GSSG_ManagerSignature")
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf


def render(
    template_path: Path | str,
    data: Mapping[str, Any],
    output_path: Path | str,
    *,
    post_process: Callable[[Any, dict[str, Any]], None] | None = None,
    strict: bool = False,
    sandboxed: bool = False,
    ensure_manager_signature_bookmark: bool = False,
) -> Path:
    """Render `template_path` with `data` and save to `output_path`.

    Args:
        template_path: Path to a `.docx` template with ``{{ tokens }}``.
        data: Field values. Keys map 1:1 to template tokens.
        output_path: Where to write the rendered DOCX.
        post_process: Optional hook ``(doc, context) -> None`` called after
            Jinja rendering.
        strict: If True, raise on missing tokens (useful in tests).
        ensure_manager_signature_bookmark: Mark the template's
            ``{{ manager_sig }}`` paragraph with the ``GSSG_ManagerSignature``
            bookmark before rendering (General Book / Security Permit's
            keep-together signing block; see
            ``_prepare_manager_signature_bookmark``). The tracked template
            file itself is never modified.

    Returns:
        `output_path` as a Path.
    """
    template_path = Path(template_path)
    output_path = Path(output_path)
    if not template_path.exists():
        raise FileNotFoundError(template_path)

    render_source: Path | BytesIO = template_path
    if ensure_manager_signature_bookmark:
        render_source = _prepare_manager_signature_bookmark(template_path)

    tpl = DocxTemplate(render_source if isinstance(render_source, BytesIO) else str(render_source))

    context: dict[str, Any] = dict(data)
    _apply_context_defaults(context)

    # _sig_path → _sig (InlineImage or "").
    from app.core.signature_layout import role_for_sig_key

    sig_w = int(context.get("_sig_size_mm", DEFAULT_SIG_WIDTH_MM))
    sig_b = int(context.get("_sig_boldness", DEFAULT_SIG_BOLDNESS))
    for key in list(context):
        if key.endswith("_sig_path"):
            context[key[:-5]] = _resolve_sig(
                tpl,
                context[key],
                width_mm=sig_w,
                dilate_radius_px=sig_b,
                role=role_for_sig_key(key),
            )

    env_cls = SandboxedEnvironment if sandboxed else Environment
    jinja_env = env_cls(
        undefined=StrictUndefined if strict else _SilentUndefined,
        autoescape=False,
    )
    jinja_env.globals["tick"] = _make_tick(context.get("leave_type", ""))
    jinja_env.globals["check"] = _make_check(context.get("doc_selections") or {})
    jinja_env.globals["item"] = _make_item_lookup(context.get("items") or [])
    jinja_env.globals["vio"] = _make_vio_lookup(context.get("violations") or [])
    jinja_env.globals["clearance"] = _make_clearance_lookup(
        context.get("clearance_marks") or {},
        context.get("clearance_remarks") or {},
    )

    tpl.render(context, jinja_env=jinja_env, autoescape=False)

    if post_process is not None:
        post_process(tpl.docx, context)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tpl.save(str(output_path))
    return output_path
