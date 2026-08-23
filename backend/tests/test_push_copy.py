"""Push-notification copy for approval, review, scan, and scan-back actions."""

from app.services import scheduler_service as ss
from app.services.notification_service import ActionableItem

APP = "GSSG Manager"


def _item(kind: str, **kwargs: object) -> ActionableItem:
    base: dict[str, object] = {"kind": kind, "ref": f"{kind}:1", "url": f"/{kind}/1", "label": "#1"}
    base.update(kwargs)
    return ActionableItem(**base)


def test_titles_are_app_name_in_both_languages() -> None:
    cases = [
        ("approval", [_item("approval", label="HR-1", subject="Leave", requester="Sam")]),
        ("review", [_item("review", label="HR-2")]),
        ("scan", [_item("scan")]),
    ]
    for kind, items in cases:
        messages, _url = ss._build_push(kind, items, "/section")
        assert messages["en"][0] == APP
        assert messages["ar"][0] == APP


def test_approval_single_signature_needed_with_from_and_deeplink() -> None:
    it = _item("approval", url="/books/5", label="HR-0409", subject="Annual leave", requester="Ali")
    messages, url = ss._build_push("approval", [it], "/books?status=pending")
    assert "Signature needed" in messages["en"][1]
    assert "HR-0409" in messages["en"][1]
    assert "Ali" in messages["en"][1]
    assert "بانتظار توقيعك" in messages["ar"][1]
    assert url == "/books/5"


def test_review_single_says_review_not_signature() -> None:
    it = _item("review", url="/books/6", label="HR-7", subject="Memo", requester="Lina")
    body_en = ss._build_push("review", [it], "/books?status=pending")[0]["en"][1]
    assert "Review needed" in body_en
    assert "Signature" not in body_en


def test_approval_multiple_counts_queue() -> None:
    items = [_item("approval", ref=f"book:{i}") for i in range(3)]
    messages, url = ss._build_push("approval", items, "/books?status=pending")
    assert messages["en"][1] == "3 documents awaiting your signature"
    assert messages["ar"][1] == "3 مستندات بانتظار توقيعك"
    assert url == "/books?status=pending"


def test_scan_single_and_multiple() -> None:
    one, _ = ss._build_push("scan", [_item("scan", url="/scan-inbox", label="#42")], "/scan-inbox")
    assert "New scan to review" in one["en"][1]
    assert "#42" in one["en"][1]
    many, _ = ss._build_push("scan", [_item("scan"), _item("scan")], "/scan-inbox")
    assert many["en"][1] == "2 scanned documents awaiting your review"


def test_scanback_single_links_to_the_record() -> None:
    it = _item("scanback", url="/books/7", label="GS-7", subject="Memo")
    messages, url = ss._build_push("scanback", [it], "/scan-back")
    assert "Signed copy not filed" in messages["en"][1]
    assert "GS-7" in messages["en"][1]
    assert url == "/books/7"
