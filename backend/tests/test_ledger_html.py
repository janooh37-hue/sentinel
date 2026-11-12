"""Ledger editor HTML preserves formatting without active or remote content."""

import pytest

from app.core.ledger_html import sanitize_body

PREFIX = "/api/v1/ledger/drafts/7/images/"
IMAGE = "0123456789abcdef0123456789abcdef.png"


def clean(html: str) -> str:
    return sanitize_body(html, image_src_prefixes=(PREFIX,))


def test_event_handlers_and_javascript_links_are_removed() -> None:
    assert (
        clean('<p onclick="alert(1)"><a href="javascript:alert(1)">read</a></p>') == "<p>read</p>"
    )
    assert (
        clean(f'<img src="{PREFIX}{IMAGE}" onerror="alert(1)">') == f'<img src="{PREFIX}{IMAGE}">'
    )


@pytest.mark.parametrize(
    "src",
    [
        "http://evil.test/x.png",
        "https://evil.test/x.png",
        "data:image/png;base64,iVBORw0KGgo=",
        "//evil.test/x.png",
        f"{PREFIX}../{IMAGE}",
        f"{PREFIX}%2e%2e%2f{IMAGE}",
        f"/api/v1/ledger/drafts/8/images/{IMAGE}",
    ],
)
def test_images_outside_exact_owned_image_paths_are_dropped(src: str) -> None:
    assert clean(f'<p>before<img src="{src}" alt="photo">after</p>') == "<p>beforeafter</p>"


def test_alt_text_cannot_disguise_a_missing_src_attribute() -> None:
    assert clean(f'<img src="https://evil.test/x.png" alt="fake src={PREFIX}{IMAGE}">') == ""


@pytest.mark.parametrize("tag", ["script", "style", "iframe", "svg"])
def test_active_elements_are_removed_with_their_content(tag: str) -> None:
    assert (
        clean(f"<p>before</p><{tag}>hostile content</{tag}><p>after</p>")
        == "<p>before</p><p>after</p>"
    )


def test_comments_are_removed() -> None:
    assert clean("<p>before<!-- hidden -->after</p>") == "<p>beforeafter</p>"


@pytest.mark.parametrize(
    "style",
    [
        "background:url(https://evil.test/x.png)",
        "background-color:url(https://evil.test/x.png)",
        "width:expression(alert(1))",
        "width:ExPrEsSiOn(alert(1))",
    ],
)
def test_executable_and_network_styles_are_neutralised(style: str) -> None:
    assert clean(f'<p style="{style}">safe</p>') == "<p>safe</p>"


def test_disallowed_style_properties_do_not_erase_allowed_formatting() -> None:
    assert (
        clean('<p style="position:fixed;text-align:right;color:red">text</p>')
        == '<p style="text-align:right;color:red">text</p>'
    )


def test_owned_image_retains_display_attributes() -> None:
    html = f'<img src="{PREFIX}{IMAGE}" alt="صورة" width="320" height="240">'
    assert clean(html) == html


def test_hugerte_rtl_lists_and_tables_preserve_editor_formatting() -> None:
    html = (
        '<div dir="rtl" lang="ar"><p style="text-align:right">'
        "<strong>عنوان</strong> <em>نص</em> <u>مهم</u></p>"
        "<ol><li>First</li></ol><ul><li>Second</li></ul>"
        '<table style="border-collapse:collapse;width:100%">'
        '<tbody><tr><th colspan="2" style="border:1px solid black">Heading</th></tr>'
        '<tr><td rowspan="2" style="padding:4px;vertical-align:top">Cell</td>'
        "<td>Other</td></tr><tr><td>Last</td></tr></tbody></table></div>"
    )
    assert clean(html) == html


@pytest.mark.parametrize(
    ("family", "serialized"),
    [
        ("Calibri", "Calibri"),
        ("'Sakkal Majalla'", "&quot;Sakkal Majalla&quot;"),
        ("'Univers Next Arabic'", "&quot;Univers Next Arabic&quot;"),
        ("'Noto Naskh Arabic'", "&quot;Noto Naskh Arabic&quot;"),
        ("serif", "serif"),
        ("sans-serif", "sans-serif"),
        ("Calibri, 'Sakkal Majalla', serif", "Calibri , &quot;Sakkal Majalla&quot; , serif"),
        ("'sAkKaL mAjAlLa'", "&quot;sAkKaL mAjAlLa&quot;"),
        (
            "  Calibri  ,  'Sakkal Majalla'  ,  serif  ",
            "Calibri , &quot;Sakkal Majalla&quot; , serif",
        ),
    ],
)
@pytest.mark.parametrize("tag", ["span", "p"])
def test_hugerte_allowed_font_families_survive(family: str, serialized: str, tag: str) -> None:
    # nh3 removes declaration whitespace and emits double-quoted family names.
    # Its normalized HTML, including escaped quotes, must round-trip unchanged.
    expected = f'<{tag} style="font-family:{serialized}">x</{tag}>'
    assert clean(f'<{tag} style="font-family: {family};">x</{tag}>') == expected
    assert clean(expected) == expected


@pytest.mark.parametrize(
    ("tag", "style", "serialized"),
    [
        ("span", "font-size: 18pt;", "font-size:18pt"),
        (
            "h2",
            "text-align: center; font-size: 18pt; font-weight: bold;",
            "text-align:center;font-size:18pt;font-weight:bold",
        ),
        ("h3", "font-size: 16pt; font-weight: bold;", "font-size:16pt;font-weight:bold"),
        (
            "h4",
            "font-size: 14pt; font-weight: bold; text-decoration: underline;",
            "font-size:14pt;font-weight:bold;text-decoration:underline",
        ),
        ("p", "font-size: 16pt;", "font-size:16pt"),
        ("p", "font-size: 12pt;", "font-size:12pt"),
    ],
)
def test_hugerte_heading_and_font_size_presets_survive(
    tag: str, style: str, serialized: str
) -> None:
    expected = f'<{tag} style="{serialized}">x</{tag}>'
    assert clean(f'<{tag} style="{style}">x</{tag}>') == expected
    assert clean(expected) == expected


def test_hugerte_fixed_table_layout_and_cell_borders_survive() -> None:
    html = (
        '<table style="border-collapse: collapse; width: 100%; table-layout: fixed; '
        'margin-left: auto; margin-right: auto;" border="1"><tbody><tr>'
        '<td style="border: 0.2mm solid #000; padding: 1mm 2mm;">x</td>'
        "</tr></tbody></table>"
    )
    expected = (
        '<table style="border-collapse:collapse;width:100%;table-layout:fixed;'
        'margin-left:auto;margin-right:auto"><tbody><tr>'
        '<td style="border:0.2mm solid #000;padding:1mm 2mm">x</td>'
        "</tr></tbody></table>"
    )
    assert clean(html) == expected
    assert clean(expected) == expected


@pytest.mark.parametrize(
    ("tag", "style"),
    [
        ("p", "page-break-before:always"),
        ("p", "page-break-after:always"),
        ("p", "page-break-inside:avoid"),
        ("div", "break-before:page"),
        ("div", "break-after:page"),
        ("div", "break-inside:avoid"),
        ("div", "max-width:100%"),
        ("div", "max-inline-size:100%"),
        ("div", "min-width:10mm"),
    ],
)
def test_hugerte_page_breaks_and_size_constraints_survive(tag: str, style: str) -> None:
    html = f'<{tag} style="{style}">x</{tag}>'
    assert clean(html) == html


def test_hugerte_pagebreak_comments_remain_stripped() -> None:
    assert clean("<p>before</p><!-- pagebreak --><p>after</p>") == "<p>before</p><p>after</p>"


@pytest.mark.parametrize(
    "family",
    [
        "'Comic Sans MS'",
        "Calibri, 'Comic Sans MS'",
        "'Comic Sans MS', serif",
        "'Calibri, Comic Sans MS'",
        "'Sakkal Majalla Extra'",
        "inherit",
        "var(--editor-font)",
        "Calibri,",
    ],
)
def test_disallowed_font_families_are_removed_without_erasing_other_styles(family: str) -> None:
    assert (
        clean(f'<span style="font-size: 18pt; font-family: {family}; color: red;">x</span>')
        == '<span style="font-size:18pt;color:red">x</span>'
    )


def test_disallowed_font_family_without_other_styles_is_removed() -> None:
    assert clean("<span style=\"font-family: 'Comic Sans MS';\">x</span>") == "<span>x</span>"


def test_allowed_fonts_do_not_allow_positioning() -> None:
    assert (
        clean('<span style="font-family: Calibri; position: fixed; font-size: 18pt;">x</span>')
        == '<span style="font-family:Calibri;font-size:18pt">x</span>'
    )


@pytest.mark.parametrize(
    "style",
    [
        "font-family: Calibri; color: url(https://evil.test/x.png)",
        "font-family: Calibri; width: expression(alert(1))",
        r"font-family: C\61libri; color: red",
        "font-family: Calibri/**/; color: red",
        "font-family: Calibri; @import 'https://evil.test/x.css'",
        "font-family: Calibri; color: javascript:alert(1)",
    ],
)
def test_font_families_do_not_bypass_forbidden_style_patterns(style: str) -> None:
    assert clean(f'<span style="{style}">x</span>') == "<span>x</span>"


@pytest.mark.parametrize("prefix", ["images/", "https://evil.test/images/", "//evil.test/images/"])
def test_image_prefix_must_be_same_origin(prefix: str) -> None:
    with pytest.raises(ValueError, match="same-origin"):
        sanitize_body("<p>text</p>", image_src_prefixes=(prefix,))


ATTRIBUTE_BREAKOUT = '<img alt="><svg onload=alert(1)>">'


def test_srcless_img_with_markup_in_alt_never_exposes_live_tags() -> None:
    assert clean(ATTRIBUTE_BREAKOUT) == ""
    assert clean(f"<p>x{ATTRIBUTE_BREAKOUT}y</p>") == "<p>xy</p>"


def test_img_with_markup_in_alt_keeps_it_as_escaped_attribute_text() -> None:
    out = clean(f'<img src="{PREFIX}{IMAGE}" alt="><svg onload=alert(1)>">')

    assert "<svg" not in out
    assert out == f'<img src="{PREFIX}{IMAGE}" alt="&gt;&lt;svg onload=alert(1)&gt;">'


def test_image_pass_handles_nh3_0_3_6_unescaped_attribute_output() -> None:
    # nh3 0.3.6 emits this payload verbatim (a raw '>' inside the quoted alt);
    # the src-less-image pass must parse it as one attribute, not cut it.
    from app.core.ledger_html import _drop_srcless_images

    assert _drop_srcless_images('<p><img alt="><svg onload=alert(1)>"></p>') == "<p></p>"


PAGEBREAK_SEPARATOR = '<div style="break-after:page;page-break-after:always"></div>'


def test_editor_pagebreak_separator_survives_unchanged() -> None:
    assert (
        clean(f"<p>a</p>{PAGEBREAK_SEPARATOR}<p>b</p>") == f"<p>a</p>{PAGEBREAK_SEPARATOR}<p>b</p>"
    )


# The markup the editor's ready-made tables and text presets emit
# (frontend ledgerEditorConfig.ts). Keep the two in step.
PRESET_TABLE = "width:100%;table-layout:fixed;border-collapse:collapse;margin-inline:auto"
PRESET_HEAD = "background-color:#d9d9d9;font-weight:bold;text-align:center"
PRESET_BODIES = [
    f'<table style="{PRESET_TABLE}"><thead><tr>'
    f'<th style="width:8%;{PRESET_HEAD}">م</th><th style="{PRESET_HEAD}">الاسم</th>'
    f'<th style="width:22%;{PRESET_HEAD}">الرقم الوظيفي</th></tr></thead>'
    '<tbody><tr><td style="text-align:center">1</td><td>x</td><td>G-1</td></tr></tbody></table>',
    f'<table style="{PRESET_TABLE}"><tbody><tr>'
    '<td style="width:30%;background-color:#f2f2f2;font-weight:bold">a</td><td>b</td>'
    "</tr></tbody></table>",
    '<p style="font-size:16pt;text-align:justify">x</p>',
    '<p style="font-size:16pt;font-weight:bold;text-align:center">x</p>',
    '<p style="line-height:1.15">x</p>',
]


@pytest.mark.parametrize("body", PRESET_BODIES)
def test_editor_presets_survive_unchanged(body: str) -> None:
    assert clean(body) == body
