"""Ledger Books desk list: recipients/signer rows, wider search, all-scope search, sort."""

from __future__ import annotations

from app.db.models import Manager
from tests.test_book_confidentiality import API, ApiHarness, _send
from tests.test_book_confidentiality import (
    confidentiality_api as confidentiality_api,
)


def _rows(api: ApiHarness, **params: str) -> list[dict]:
    response = api.client.get(f"{API}/books", params=params)
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_desk_rows_carry_visible_recipients_and_signer(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    manager = Manager(name_en="Juma Saadi", name_ar="جمعة الساعدي")
    api.db.add(manager)
    api.db.flush()
    api.records["directed"].doc_manager_id = manager.id
    api.db.commit()
    _send(api, "directed", ["B", "C"], purpose="action", note="Stock count")
    api.as_user("B")
    assert api.client.post(f"{API}/books/{api.records['directed'].id}/inbox/done").status_code == 200

    # A recipient who is not the creator sees only their own row, never C's.
    (row,) = _rows(api, inbox="done")
    assert [r["user_id"] for r in row["recipients"]] == [api.users["B"].id]
    assert (row["signer_name"], row["signer_name_ar"]) == ("Juma Saadi", "جمعة الساعدي")

    api.as_user("A")
    (sent,) = _rows(api, inbox="sent")
    progress = {r["user_id"]: r["done_at"] is not None for r in sent["recipients"]}
    assert progress == {api.users["B"].id: True, api.users["C"].id: False}
    # Plain record lists stay lean.
    assert all(item["recipients"] is None for item in _rows(api))


def test_desk_search_matches_note_purpose_and_sender_across_scopes(
    confidentiality_api: ApiHarness,
) -> None:
    api = confidentiality_api
    api.users["A"].display_name = "Saeed Sender"
    api.db.commit()
    _send(api, "directed", ["B"], purpose="action", note="Stock count")
    _send(api, "general", ["B"], purpose="info")
    api.as_user("B")
    assert api.client.post(f"{API}/books/{api.records['general'].id}/inbox/done").status_code == 200
    directed, general = api.records["directed"].id, api.records["general"].id

    def found(q: str, inbox: str) -> set[int]:
        return {item["id"] for item in _rows(api, inbox=inbox, q=q)}

    assert found("stock", "received") == {directed}
    assert found("للتنفيذ", "received") == {directed}
    assert found("للاطلاع", "received") == set()  # the info book is in Done
    assert found("للاطلاع", "any") == {general}
    assert found("saeed", "any") == {directed, general}
    assert found("no such words", "any") == set()


def test_desk_sort_by_send_time_and_confidentiality(confidentiality_api: ApiHarness) -> None:
    api = confidentiality_api
    # Created general → secret; sent secret first, then general (by cleared D).
    api.as_user("D")
    _send(api, "secret", ["C2"])
    _send(api, "general", ["C2"])
    api.as_user("C2")
    secret, general = api.records["secret"].id, api.records["general"].id

    def order(sort: str) -> list[int]:
        return [item["id"] for item in _rows(api, inbox="received", sort=sort)]

    assert order("newest") == [general, secret]
    assert order("oldest") == [secret, general]
    assert order("secret") == [secret, general]
    assert api.client.get(f"{API}/books", params={"sort": "bogus"}).status_code == 422
