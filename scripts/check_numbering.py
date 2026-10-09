"""Fail on a split Alembic history or a reused ADR number.

CI runs this on the pull request's merge ref, so a branch cut from a stale
``main`` that reuses a migration or ADR number fails here instead of after
merge. Stdlib only: parses ``revision``/``down_revision`` without importing
the migration modules (some import ``app``, which needs the full backend deps).
"""

from __future__ import annotations

import ast
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
VERSIONS = ROOT / "backend" / "app" / "db" / "migrations" / "versions"
ADRS = ROOT / "docs" / "adr"


def _revision_ids(path: Path) -> tuple[str, set[str]]:
    found: dict[str, Any] = {}
    for node in ast.parse(path.read_text(encoding="utf-8-sig")).body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
        else:
            continue
        for target in targets:
            if isinstance(target, ast.Name) and target.id in ("revision", "down_revision"):
                found[target.id] = ast.literal_eval(node.value)
    down = found.get("down_revision") or ()
    parents = {down} if isinstance(down, str) else set(down)
    return str(found["revision"]), parents


def main() -> int:
    errors: list[str] = []

    revisions: set[str] = set()
    parents: set[str] = set()
    for path in VERSIONS.glob("*.py"):
        revision, down = _revision_ids(path)
        revisions.add(revision)
        parents |= down
    heads = sorted(revisions - parents)
    if len(heads) != 1:
        errors.append(
            f"Alembic history has {len(heads)} heads: {', '.join(heads)}. "
            "Renumber the new revision onto origin/main's head (see the new-migration skill)."
        )

    prefixes = Counter(
        m.group(1) for p in ADRS.glob("*.md") if (m := re.match(r"(\d{4})-", p.name))
    )
    reused = sorted(n for n, count in prefixes.items() if count > 1)
    if reused:
        errors.append(f"ADR numbers used more than once in docs/adr/: {', '.join(reused)}")

    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if not errors:
        print(f"ok: single Alembic head {heads[0]}; {len(prefixes)} unique ADR numbers")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
