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


@pytest.mark.parametrize("prefix", ["images/", "https://evil.test/images/", "//evil.test/images/"])
def test_image_prefix_must_be_same_origin(prefix: str) -> None:
    with pytest.raises(ValueError, match="same-origin"):
        sanitize_body("<p>text</p>", image_src_prefixes=(prefix,))
