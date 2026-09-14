"""Boundaries required by inmate-statistics rich-text projection."""

import pytest

from app.core.html_text import html_to_text


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("first<br>second", "first\nsecond"),
        ("<p>first</p>second", "first\nsecond"),
    ],
)
def test_line_and_paragraph_boundaries_become_newlines(html: str, expected: str) -> None:
    assert html_to_text(html) == expected


def test_nested_tag_paragraphs_round_trip_to_two_lines() -> None:
    assert html_to_text("<p>first <strong>line</strong></p><p>second <em>line</em></p>") == (
        "first line\nsecond line"
    )


def test_hugerte_entities_are_decoded() -> None:
    assert html_to_text("<p>one&nbsp;&amp;&nbsp;two</p>") == "one & two"


def test_excessive_blank_lines_collapse_to_one_blank_line() -> None:
    assert html_to_text("<p>first</p><br><br><br><br><br>second") == "first\n\nsecond"


@pytest.mark.parametrize("html", [None, ""])
def test_empty_input_returns_empty_text(html: str | None) -> None:
    assert html_to_text(html) == ""


def test_plain_text_without_markup_is_untouched() -> None:
    text = "  already plain\n\n\ntext  "
    assert html_to_text(text) == text
