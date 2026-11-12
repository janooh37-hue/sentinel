"""Generic attached-reference delivery must never grant Ledger chain access."""

from datetime import datetime

import pytest
from sqlalchemy import select

from app.core.constants import LEDGER_BOOK_TEMPLATE_ID
from app.db.models import BookLink, BookRecipient
from tests.test_book_links import API, LinkApi
from tests.test_book_links import links_api as links_api


@pytest.mark.parametrize("signed", [False, True])
def test_generic_send_skips_ledger_references_but_preserves_links_and_normal_delivery(
    links_api: LinkApi, signed: bool
) -> None:
    api = links_api
    primary = api.records["open"]
    ledger_reference = api.records["creator_only"]
    ordinary_reference = api.records["named"]
    ledger_reference.versions[0].template_id = LEDGER_BOOK_TEMPLATE_ID
    ledger_reference.versions[0].signed_at = datetime(2026, 11, 11) if signed else None
    api.db.commit()
    for reference in (ledger_reference, ordinary_reference):
        response = api.client.post(
            f"{API}/{primary.id}/links", json={"target_book_id": reference.id}
        )
        assert response.status_code == 201, response.text

    receiver = api.users["receiver"]
    api.as_user("receiver")
    assert api.client.get(f"{API}/{ledger_reference.id}").status_code == 404
    api.as_user("creator")
    response = api.client.post(
        f"{API}/{primary.id}/send", json={"user_ids": [receiver.id], "purpose": "info"}
    )
    assert response.status_code == 200, response.text
    assert [item["book_id"] for item in response.json()["references"]] == [ordinary_reference.id]
    recipient_books = set(
        api.db.scalars(select(BookRecipient.book_id).where(BookRecipient.user_id == receiver.id))
    )
    assert recipient_books == {primary.id, ordinary_reference.id}
    assert set(
        api.db.scalars(select(BookLink.target_book_id).where(BookLink.book_id == primary.id))
    ) == {ledger_reference.id, ordinary_reference.id}
    api.as_user("receiver")
    assert api.client.get(f"{API}/{ledger_reference.id}").status_code == 404
    assert api.client.get(f"{API}/{ordinary_reference.id}").status_code == 200
