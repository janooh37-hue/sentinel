"""Sanitizer for Ledger Book bodies (ADR 0007): a fixed allowlist, not the email one.

Every Draft update and every Revision save runs :func:`sanitize_body`. The
output keeps the editor's formatting (RTL ``dir``, tables, inline styles from a
short property list) and drops anything that can run script or fetch a remote
resource: no links, no ``url(`` or ``expression(`` in styles, and an ``img``
survives only when its ``src`` is one of our same-origin image paths.
"""

from __future__ import annotations

import re
from typing import Final

import nh3

TAGS: Final[frozenset[str]] = frozenset(
    {
        "p",
        "br",
        "span",
        "div",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "sub",
        "sup",
        "ol",
        "ul",
        "li",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "hr",
        "table",
        "colgroup",
        "col",
        "caption",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "th",
        "td",
        "img",
    }
)

# Removed together with their content (the rest of the disallowed tags are
# unwrapped and keep their text).
_CLEAN_CONTENT_TAGS: Final[frozenset[str]] = frozenset(
    {"script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"}
)

ATTRIBUTES: Final[dict[str, set[str]]] = {
    "*": {"dir", "lang", "style"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
    "img": {"src", "alt", "width", "height"},
}

_SIDES: Final = ("top", "right", "bottom", "left")
_LOGICAL: Final = ("block", "block-start", "block-end", "inline", "inline-start", "inline-end")
_BORDER_PARTS: Final = ("", "-color", "-style", "-width")

STYLE_PROPERTIES: Final[frozenset[str]] = frozenset(
    {
        "text-align",
        "direction",
        "unicode-bidi",
        "font-weight",
        "font-style",
        "text-decoration",
        "color",
        "background-color",
        "font-size",
        "line-height",
        "width",
        "height",
        "vertical-align",
        "list-style-type",
        "margin",
        "padding",
        "border-collapse",
        "border-spacing",
        *(f"{box}-{side}" for box in ("margin", "padding") for side in (*_SIDES, *_LOGICAL)),
        *(f"border{part}" for part in _BORDER_PARTS),
        *(f"border-{side}{part}" for side in (*_SIDES, *_LOGICAL) for part in _BORDER_PARTS),
    }
)

_STYLE_FORBIDDEN = re.compile(r"url\s*\(|expression\s*\(|\\|/\*|@import|javascript:", re.I)
_IMG_TAG = re.compile(r"<img\b[^>]*>")
# nh3 serialises attributes as name="value" with any quote in the value escaped.
_ATTRIBUTE_NAME = re.compile(r'\s([\w:-]+)="[^"]*"')
_IMAGE_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\.(?:png|jpe?g|gif|webp)")


def _allowed_image_src(value: str, prefixes: tuple[str, ...]) -> bool:
    for prefix in prefixes:
        if value.startswith(prefix) and _IMAGE_NAME.fullmatch(value[len(prefix) :]):
            return True
    return False


def sanitize_body(html: str, *, image_src_prefixes: tuple[str, ...]) -> str:
    """Return ``html`` reduced to the Ledger Book allowlist.

    ``image_src_prefixes`` are same-origin API paths ending in ``/``; an ``img``
    is kept only when its ``src`` is one of them followed by a stored image
    name, otherwise the whole element is dropped.
    """
    for prefix in image_src_prefixes:
        if not prefix.startswith("/") or prefix.startswith("//") or not prefix.endswith("/"):
            raise ValueError(f"image prefix must be a same-origin path ending in '/': {prefix!r}")

    def attribute_filter(tag: str, attr: str, value: str) -> str | None:
        if attr == "style":
            return None if _STYLE_FORBIDDEN.search(value) else value
        if tag == "img" and attr == "src":
            return value if _allowed_image_src(value, image_src_prefixes) else None
        return value

    cleaned = nh3.clean(
        html,
        tags=set(TAGS),
        clean_content_tags=set(_CLEAN_CONTENT_TAGS),
        attributes={tag: set(attrs) for tag, attrs in ATTRIBUTES.items()},
        attribute_filter=attribute_filter,
        strip_comments=True,
        link_rel=None,
        url_schemes=set(),
        filter_style_properties=set(STYLE_PROPERTIES),
    )
    # nh3 serialises every surviving tag canonically, so an img whose src was
    # filtered out has no ``src`` attribute left: drop the whole element.
    return _IMG_TAG.sub(
        lambda tag: tag[0] if "src" in _ATTRIBUTE_NAME.findall(tag[0]) else "", cleaned
    )
