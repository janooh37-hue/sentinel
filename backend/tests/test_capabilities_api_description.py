"""Tests that the capability catalog exposes description fields (Task 6)."""

from app.core.permissions import CAPABILITIES


def test_catalog_payload_builder_includes_description():
    # The route builds dicts from CAPABILITIES; assert the field is available.
    sample = {c.id: c.description for c in CAPABILITIES}
    assert sample["books.approve"]
