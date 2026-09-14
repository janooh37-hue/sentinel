"""Characterization tests for the shared workforce ETag contract."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

import pytest

from app.api.errors import ConflictError
from app.services import workforce_admin_service, workforce_etag


def test_etag_for_uses_canonical_json_and_a_quoted_sha256_tag() -> None:
    assert workforce_admin_service.etag_for({"b": 2, "a": 1}) == (
        '"43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777"'
    )


def test_row_etag_includes_timestamp_strings_and_explicit_extra_state() -> None:
    row = SimpleNamespace(
        id=7,
        created_at=datetime(2026, 1, 2, 3, 4, 5),
        updated_at=None,
    )

    assert (
        workforce_admin_service.row_etag(row, extra={"mapping_state": "verified"})
        == '"fce0f0bbda2c069f5de9acd2328ed062472ff5df183096adf49a9db62259d5d7"'
    )


@pytest.mark.parametrize("if_match", [None, '"stale"'])
def test_require_if_match_rejects_missing_and_stale_tags(if_match: str | None) -> None:
    with pytest.raises(ConflictError) as captured:
        workforce_admin_service.require_if_match(if_match, '"current"')

    assert captured.value.code == "WORKFORCE_VERSION_CONFLICT"
    assert captured.value.message == ("The workforce record was modified; refresh and retry.")


def test_require_if_match_accepts_exact_tag_and_preserves_custom_code() -> None:
    workforce_admin_service.require_if_match('"current"', '"current"')

    with pytest.raises(ConflictError) as captured:
        workforce_admin_service.require_if_match(
            '"stale"', '"current"', code="ATTENDANCE_CASE_VERSION_CONFLICT"
        )

    assert captured.value.code == "ATTENDANCE_CASE_VERSION_CONFLICT"


def test_admin_service_reexports_the_canonical_helpers() -> None:
    assert workforce_admin_service.etag_for is workforce_etag.etag_for
    assert workforce_admin_service.row_etag is workforce_etag.row_etag
    assert workforce_admin_service.require_if_match is workforce_etag.require_if_match
