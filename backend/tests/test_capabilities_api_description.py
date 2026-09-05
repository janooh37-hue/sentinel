"""Tests that the capability catalog exposes description fields (Task 6)."""

from app.core.permissions import CAPABILITIES


def test_catalog_payload_builder_includes_description():
    sample = {c.id: (c.description_en, c.description_ar) for c in CAPABILITIES}
    assert all(sample["books.approve"])
