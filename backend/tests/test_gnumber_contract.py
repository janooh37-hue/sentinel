from __future__ import annotations

import json
from pathlib import Path

from app.core.gnumber import detect_g_numbers


FIXTURE = Path(__file__).resolve().parents[2] / "shared/contracts/gnumber_cases.json"


def test_python_detector_matches_shared_contract() -> None:
    cases = json.loads(FIXTURE.read_text(encoding="utf-8"))
    for case in [*cases["valid"], *cases["invalid"]]:
        assert detect_g_numbers(case["text"]) == tuple(case["matches"])


def test_detector_normalizes_and_deduplicates() -> None:
    assert detect_g_numbers("g3082 / G3082 / G123") == ("G3082", "G123")
