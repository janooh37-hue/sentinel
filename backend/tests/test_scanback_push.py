"""TDD: the scan-back Web Push body.

Two things this locks down:
1. `_build_push` must DISPATCH on "scanback". Its fallthrough is `_doc_push`,
   which renders "Signature needed · NAT-0612" — plausible, wrong, and it ships
   green because nothing raises.
2. N stranded records produce ONE push, not N. `_notify_user` groups by kind
   before sending, so the existing 25-record backlog is a single notification.
"""

from __future__ import annotations

from app.services import scheduler_service
from app.services.notification_service import ActionableItem


def _item(ref: str, subject: str | None = None) -> ActionableItem:
    return ActionableItem("scanback", f"book:{ref}", f"/books/{ref}", ref, subject=subject)


def test_single_record_names_the_ref_and_deep_links_to_it():
    messages, url = scheduler_service._build_push(
        "scanback", [_item("NAT-0612", "Violation Form")], "/scan-back"
    )
    _en_title, en_body = messages["en"]
    assert "NAT-0612" in en_body
    assert "Violation Form" in en_body
    assert url == "/books/NAT-0612"


def test_single_record_body_is_not_the_approval_copy():
    """Guards the _doc_push fallthrough: 'Signature needed' is the wrong verb."""
    messages, _ = scheduler_service._build_push("scanback", [_item("NAT-0612")], "/scan-back")
    assert "Signature needed" not in messages["en"][1]
    assert "بانتظار توقيعك" not in messages["ar"][1]


def test_many_records_collapse_to_one_counted_body():
    items = [_item(f"NAT-{i:04d}") for i in range(25)]
    messages, url = scheduler_service._build_push("scanback", items, "/scan-back")
    assert "25" in messages["en"][1]
    assert url == "/scan-back"


def test_arabic_body_is_arabic():
    messages, _ = scheduler_service._build_push("scanback", [_item("NAT-0612")], "/scan-back")
    ar_body = messages["ar"][1]
    assert "النسخة" in ar_body
    assert "Signed copy not filed" not in ar_body


def test_kind_meta_points_at_the_scan_back_page():
    assert scheduler_service._KIND_META["scanback"] == "/scan-back"


def test_arabic_multi_record_body_agrees_by_count():
    """The Arabic body must pick the correct count-noun form (CLDR Arabic
    plural rules), matching ar.json's scanBack.gate.title_* family word for
    word. A hardcoded few-form ('سجلات ... نسختها') for every n is wrong for
    the live ~25-record backlog (many-form) and would ship silently."""
    items = {n: [_item(f"NAT-{i:04d}") for i in range(n)] for n in (2, 5, 25, 100)}

    messages2, _ = scheduler_service._build_push("scanback", items[2], "/scan-back")
    assert messages2["ar"][1] == "سجلان بانتظار نسختهما الموقّعة"

    messages5, _ = scheduler_service._build_push("scanback", items[5], "/scan-back")
    assert messages5["ar"][1] == "5 سجلات بانتظار نسختها الموقّعة"

    messages25, _ = scheduler_service._build_push("scanback", items[25], "/scan-back")
    assert messages25["ar"][1] == "25 سجلاً بانتظار نسخته الموقّعة"

    messages100, _ = scheduler_service._build_push("scanback", items[100], "/scan-back")
    assert messages100["ar"][1] == "100 سجل بانتظار نسخته الموقّعة"
