"""fts_query -- build FTS5 MATCH expressions from user text as literals, never as syntax.

FTS5 treats ``- : ^ ( ) + * "`` and the words ``AND OR NOT NEAR`` in a bare expression as
grammar, so user input such as ``E-40817`` raises a syntax error and ``a OR b`` silently
changes the query. Quoting a token makes it an FTS5 string: the index tokenizer then splits
it exactly as it split the indexed text (``E-40817`` becomes the adjacent tokens ``e``,
``40817``), and ``""`` inside the quotes is the documented escape for a quote character.

A NUL cannot be quoted (FTS5 rejects it with ``unterminated string``) and must not be
silently dropped or joined either, so text containing one yields ``None``: callers treat
that as "no full-text match" and must test for it *before* any normalisation that could
alter it.
"""

from __future__ import annotations

_NUL = "\x00"


def has_nul(text: str) -> bool:
    return _NUL in text


def _quote(token: str) -> str:
    return '"' + token.replace('"', '""') + '"'


def and_prefix_query(text: str) -> str | None:
    """Whitespace-separated tokens, all required (implicit AND); the last one is a prefix.

    ``None`` when there is nothing to search for or the text contains a NUL.
    """
    if has_nul(text):
        return None
    tokens = text.split()
    if not tokens:
        return None
    quoted = [_quote(t) for t in tokens]
    quoted[-1] += "*"
    return " ".join(quoted)


def phrase_query(text: str) -> str | None:
    """The whole (stripped) text as one phrase. ``None`` when blank or it contains a NUL."""
    if has_nul(text):
        return None
    stripped = text.strip()
    return _quote(stripped) if stripped else None
