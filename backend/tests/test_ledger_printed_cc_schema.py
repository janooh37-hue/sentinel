"""Printed CC request semantics and canonical hash compatibility."""

import hashlib
import json

import pytest
from pydantic import ValidationError

from app.schemas.ledger_book import LedgerContentUpdate, LedgerDraftCreate, LedgerDraftUpdate
from app.services.ledger_book_service import _content_sha256


@pytest.mark.parametrize("schema", [LedgerDraftUpdate, LedgerContentUpdate])
def test_optional_printed_cc_is_nonnullable_in_contract(schema):
    properties = schema.model_json_schema()["properties"]
    assert properties["printed_cc"]["type"] == "array"
    assert "printed_cc" not in schema.model_json_schema().get("required", [])


def test_printed_cc_defaults_trim_limits_and_explicit_null():
    assert LedgerDraftCreate().printed_cc == []
    assert "printed_cc" not in LedgerDraftUpdate().model_fields_set
    assert LedgerDraftUpdate(printed_cc=[]).printed_cc == []
    assert LedgerDraftUpdate(printed_cc=[" x "]).printed_cc == ["x"]
    assert LedgerDraftCreate(printed_cc=["x" * 500] * 20).printed_cc == ["x" * 500] * 20
    with pytest.raises(ValidationError):
        LedgerDraftUpdate(printed_cc=None)


def test_legacy_hash_omits_null_but_includes_explicit_empty_cc():
    content = {"subjects": ["Subject"], "body_html": "<p>Body</p>"}
    old_hash = hashlib.sha256(
        json.dumps(content, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    assert _content_sha256(content["subjects"], content["body_html"]) == old_hash
    assert _content_sha256(content["subjects"], content["body_html"], printed_cc=[]) != old_hash
    assert _content_sha256(["Subject"], "<p>Body</p>", "Office", ["Team"]) != _content_sha256(
        ["Subject"], "<p>Body</p>", "Office", []
    )
