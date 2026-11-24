import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.core.attendance_verdict import JudgedRow, judge_register_row, parse_instant

_FIXTURE = (
    Path(__file__).resolve().parents[2] / "frontend/src/test/fixtures/attendance-verdicts.json"
)
_CASES = json.loads(_FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", _CASES, ids=[case["name"] for case in _CASES])
def test_attendance_verdict_contract(case: dict[str, Any]) -> None:
    now = parse_instant(case["now"])
    assert now is not None
    row = case["row"]
    judged = JudgedRow(
        **{
            **row,
            "absence_due_at": parse_instant(row["absence_due_at"]),
            "judgment_due_at": parse_instant(row["judgment_due_at"]),
        }
    )
    expected = case["expected"]
    assert judge_register_row(judged, now=now) == (
        expected["state"],
        expected["minutes_past_grace"],
    )


def test_naive_deadline_and_clock_are_compared_as_utc() -> None:
    naive = datetime(2026, 8, 19, 2)
    aware = naive.replace(tzinfo=UTC)
    assert parse_instant(naive) == aware
    row = JudgedRow("scheduled", 0, None, 30, naive, None)
    assert judge_register_row(row, now=aware) == ("absent", 0)
    row = JudgedRow("scheduled", 0, None, 30, aware, None)
    assert judge_register_row(row, now=naive) == ("absent", 0)


@pytest.mark.parametrize(("grace_minutes", "expected"), [(None, ("late", 1)), (0, ("late", 11))])
def test_custom_fallback_only_applies_without_policy_grace(
    grace_minutes: int | None, expected: tuple[str, int]
) -> None:
    row = JudgedRow("completed", 2, 11, grace_minutes, None, None)
    now = datetime(2026, 8, 19, 12, tzinfo=UTC)
    assert judge_register_row(row, now=now, fallback_grace_minutes=10) == expected
