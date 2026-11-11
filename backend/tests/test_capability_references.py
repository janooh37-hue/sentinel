"""Every capability id the code checks must exist in the catalog.

A misspelt or invented id fails silently: the backend 403s everyone, the UI
hides the feature for everyone, and an admin finds nothing to grant. This
sweeps the literal ids passed to the backend gates and the frontend
`has(...)` / `cap=` checks and requires each to be a catalog id.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.core.permissions import (
    CAPABILITY_IDS,
    CLASSIFICATION_CATEGORY_CAPABILITY_IDS,
    SERVICE_CAPABILITY_IDS,
    SERVICE_RECORDS_CAPABILITY_IDS,
)

_REPO = Path(__file__).resolve().parents[2]
_KNOWN = (
    CAPABILITY_IDS
    | SERVICE_CAPABILITY_IDS
    | SERVICE_RECORDS_CAPABILITY_IDS
    | CLASSIFICATION_CATEGORY_CAPABILITY_IDS
)
# A capability id is ``domain.action`` — the dot keeps URL-param `has('tab')`
# calls out of the sweep. Template literals (`books.service.${id}`) are
# dynamic and deliberately not matched.
_ID = r"([a-z_]+\.[^'\"$`]+)"
_BACKEND_PATTERNS = (
    re.compile(rf'require_capability\(\s*"{_ID}"'),
    re.compile(rf'has_capability\(\s*\w+\s*,\s*[\w.]+\s*,\s*"{_ID}"'),
)
_FRONTEND_PATTERNS = (
    re.compile(rf"\bhas\(\s*'{_ID}'\s*\)"),
    re.compile(rf'\bcaps?="{_ID}"'),
    re.compile(rf"\bcap:\s*'{_ID}'"),
    re.compile(rf"_CAP\s*=\s*'{_ID}'"),
)


def _literal_ids(files: list[Path], patterns: tuple[re.Pattern[str], ...]) -> dict[str, str]:
    found: dict[str, str] = {}
    for path in files:
        text = path.read_text(encoding="utf-8")
        for pattern in patterns:
            for match in pattern.finditer(text):
                found.setdefault(match.group(1), str(path.relative_to(_REPO)))
    return found


def test_every_checked_capability_id_is_in_the_catalog() -> None:
    backend = sorted((_REPO / "backend" / "app").rglob("*.py"))
    frontend = sorted(
        path
        for pattern in ("*.ts", "*.tsx")
        for path in (_REPO / "frontend" / "src").rglob(pattern)
        if ".test." not in path.name
    )
    found = _literal_ids(backend, _BACKEND_PATTERNS) | _literal_ids(frontend, _FRONTEND_PATTERNS)

    assert found, "the sweep matched nothing; its patterns no longer fit the code"
    unknown = {cap: where for cap, where in found.items() if cap not in _KNOWN}
    assert unknown == {}
