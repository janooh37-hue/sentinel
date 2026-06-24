"""Manager-picker override logic (v3.5.4 ``_apply_manager_override``, line 3985).

When a form is generated, the UI lets the user pick a manager from a saved
list. The picked record contributes ``manager_name`` and ``sig1_path`` to the
form data. If no manager is picked, **do not** clear or blank any existing
field — Arabic-letter forms carry a user-typed manager name in the same key,
and the picker has nothing to say about those entries (CLAUDE.md §"Do not").

Public contract (per `plans/01-core-port.md`):

    apply(base_data, manager_record=None, embed=False) -> base_data

The dict is mutated in place *and* returned, so the caller can write
``base_data = apply(base_data, …)`` or ignore the return value.

Rules (mirroring v3):

  * ``manager_record`` is the dict returned by the manager DB — typically
    ``{'id': int, 'name_en': str, 'name_ar': str, 'title': str|None,
      'sig_path': str|None, …}``.
  * If picked:
      - ``manager_name`` ← English name, falling back to Arabic.
      - ``manager_title`` ← picked record's ``title`` if non-blank
        (Round 2 — Fix A; was previously always the
        ``DEFAULT_MANAGER_TITLE`` constant because the override never wrote
        this key).
      - ``sig1_path`` ← signature path when ``embed=True`` AND the file
        exists on disk; otherwise removed. Round 2 — Fix E inverted the
        semantics: default behaviour is now NO embed (op signs by hand),
        the operator opts in per form.
  * If not picked: leave ``manager_name`` / ``manager_title`` /
    ``sig1_path`` untouched.
  * ``prefer_arabic=True`` flips the name preference: Arabic first, English
    fallback. Default (English-first) is preserved so personnel forms keep
    their existing behaviour; the General Book caller opts in.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any


def apply(
    base_data: dict[str, Any],
    manager_record: Mapping[str, Any] | None = None,
    *,
    embed: bool = False,
    prefer_arabic: bool = False,
) -> dict[str, Any]:
    """Apply manager override rules to `base_data`. See module docstring."""
    if manager_record:
        if prefer_arabic:
            name = (
                manager_record.get("name_ar") or manager_record.get("name_en") or ""
            ).strip()
        else:
            name = (
                manager_record.get("name_en") or manager_record.get("name_ar") or ""
            ).strip()
        # A manager IS resolved here, so the signer line must never be blank:
        # fall back to the default name when the picked record carried no name.
        from app.core.constants import DEFAULT_MANAGER_NAME

        base_data["manager_name"] = name or DEFAULT_MANAGER_NAME

        # Round 2 — Fix A: propagate the picked manager's title when present.
        # `_adapt_common` setdefault(DEFAULT_MANAGER_TITLE) used to always win
        # because nothing wrote `manager_title` before the adapter ran.
        title = (manager_record.get("title") or "").strip()
        if title:
            base_data["manager_title"] = title

        sig = manager_record.get("sig_path") or ""
        if embed and sig and Path(sig).exists():
            base_data["sig1_path"] = str(sig)
        else:
            base_data.pop("sig1_path", None)

    return base_data
