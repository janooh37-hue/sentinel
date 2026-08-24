from __future__ import annotations

import json
import re
from pathlib import Path

PLURAL_SUFFIX = re.compile(r"_(zero|one|two|few|many|other)$")


def keys(value: object, prefix: str = "") -> set[str]:
    if not isinstance(value, dict):
        return {PLURAL_SUFFIX.sub("", prefix)}
    return {
        key
        for name, child in value.items()
        for key in keys(child, f"{prefix}.{name}" if prefix else name)
    }


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    locale_dir = root / "frontend" / "src" / "locales"
    en = keys(json.loads((locale_dir / "en.json").read_text(encoding="utf-8")))
    ar = keys(json.loads((locale_dir / "ar.json").read_text(encoding="utf-8")))
    missing_ar, missing_en = sorted(en - ar), sorted(ar - en)
    if not missing_ar and not missing_en:
        return 0
    if missing_ar:
        print("Missing Arabic locale keys:", ", ".join(missing_ar))
    if missing_en:
        print("Missing English locale keys:", ", ".join(missing_en))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
