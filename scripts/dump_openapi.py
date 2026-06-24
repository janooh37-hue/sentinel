"""Dump the FastAPI app's OpenAPI schema to ``backend/openapi.json``.

The frontend reads that file via ``npm run gen:api`` to regenerate its TypeScript
types. Keeping the JSON committed (no — gitignored, see backend/.gitignore note)
means CI / a fresh checkout can produce types without standing up the backend.

Run me with the project venv:

    venv/Scripts/python.exe -X utf8 scripts/dump_openapi.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import create_app  # noqa: E402


def main() -> None:
    app = create_app()
    schema = app.openapi()
    out = ROOT / "backend" / "openapi.json"
    out.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out} ({len(schema.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
