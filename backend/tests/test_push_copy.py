"""Push copy and record privacy — titles stay the app name in both languages;
direct-send counts and actionable items include only visible unread active sends."""

from datetime import datetime

import pytest

from app.db.models import Book, BookCategory, BookRecipient
from app.services import notification_service as ns
from app.services import scheduler_service as ss
from app.services.notification_service import ActionableItem
from tests.conftest import make_user

APP = "GSSG Manager"


def test_monthly_push_names_report_stage_and_links_to_month():
    for kind, en, ar in [
        ("monthly_review", "review", "مراجعتك"),
        ("monthly_approval", "approval", "اعتمادك"),
    ]:
        target = "/services/inmate_conduct_violations?mode=stats&stats_month=2026-08"
        messages, url = ss._build_push(kind, [_item(kind, label="2026-08", url=target)], "/section")
        assert "Monthly inmate violations report" in messages["en"][1]
        assert en in messages["en"][1]
        assert ar in messages["ar"][1]
        assert "\u20662026-08\u2069" in messages["ar"][1]
        assert "\u2066" not in messages["en"][1]
        assert url == target


def test_grouped_monthly_push_links_to_month_section():
    for kind in ("monthly_review", "monthly_approval"):
        assert ss._KIND_META.get(kind) == ns.MONTHLY_TASKS_URL
        messages, url = ss._build_push(
            kind, [_item(kind), _item(kind, ref="inmate-month:2026-09:review")], ss._KIND_META[kind]
        )
        assert "2 monthly inmate violations reports" in messages["en"][1]
        assert "\u20662\u2069" in messages["ar"][1]
        assert "\u2066" not in messages["en"][1]
        assert url == ns.MONTHLY_TASKS_URL


def _item(kind, **kw):
    base = dict(kind=kind, ref=f"{kind}:1", url=f"/{kind}/1", label="#1")
    base.update(kw)
    return ActionableItem(**base)


# --- titles: app name in both languages, every kind ------------------------


def test_titles_are_app_name_in_both_languages():
    cases = [
        ("email", [_item("email", subject="Hi", requester="Sam")]),
        ("approval", [_item("approval", label="HR-1", subject="Leave", requester="Sam")]),
        ("review", [_item("review", label="HR-2")]),
        ("scan", [_item("scan")]),
        ("inbox", [_item("inbox", subject="Memo", requester="Sam")]),
    ]
    for kind, items in cases:
        messages, _url = ss._build_push(kind, items, "/section")
        assert messages["en"][0] == APP
        assert messages["ar"][0] == APP


# --- email: sender + subject + preview + attachments, not "1 unread email" --


def test_email_single_names_sender_subject_preview_attachments():
    it = _item(
        "email",
        url="/ledger",
        subject="Q2 vehicle inspection schedule",
        requester="Ahmed Al Mansoori",
        preview="Please confirm the attached dates by Thursday.",
        attachments=2,
    )
    messages, url = ss._build_push("email", [it], "/ledger")
    body_en = messages["en"][1]
    assert "Ahmed Al Mansoori" in body_en
    assert "Q2 vehicle inspection schedule" in body_en
    assert "Please confirm the attached dates" in body_en
    assert "2 attachments" in body_en
    assert "unread email" not in body_en.lower()
    assert url == "/ledger"  # deep-links to the message, not the section
    # Arabic body carries the same specifics + localized attachment line.
    body_ar = messages["ar"][1]
    assert "Ahmed Al Mansoori" in body_ar
    assert "مرفقات" in body_ar


def test_email_single_no_attachments_omits_line():
    it = _item("email", subject="Hello", requester="Sam", preview="hi", attachments=0)
    body_en = ss._build_push("email", [it], "/ledger")[0]["en"][1]
    assert "attachment" not in body_en


def test_email_multiple_summarizes_and_names_latest():
    items = [
        _item("email", ref="email:9", subject="Newest", requester="Latest Sender"),
        _item("email", ref="email:8", subject="Older", requester="Other"),
    ]
    messages, url = ss._build_push("email", items, "/ledger")
    assert messages["en"][1].startswith("2 new emails")
    assert "Latest Sender" in messages["en"][1]
    assert "Newest" in messages["en"][1]
    assert url == "/ledger"  # several → section link


# --- approval / review ------------------------------------------------------


def test_approval_single_signature_needed_with_from_and_deeplink():
    it = _item("approval", url="/books/5", label="HR-0409", subject="Annual leave", requester="Ali")
    messages, url = ss._build_push("approval", [it], "/books?status=pending")
    assert "Signature needed" in messages["en"][1]
    assert "HR-0409" in messages["en"][1]
    assert "Ali" in messages["en"][1]
    assert "بانتظار توقيعك" in messages["ar"][1]
    assert url == "/books/5"


def test_review_single_says_review_not_signature():
    it = _item("review", url="/books/6", label="HR-7", subject="Memo", requester="Lina")
    body_en = ss._build_push("review", [it], "/books?status=pending")[0]["en"][1]
    assert "Review needed" in body_en
    assert "Signature" not in body_en


def test_approval_multiple_counts_queue():
    items = [_item("approval", ref=f"book:{i}") for i in range(3)]
    messages, url = ss._build_push("approval", items, "/books?status=pending")
    assert messages["en"][1] == "3 documents awaiting your signature"
    assert messages["ar"][1] == "3 مستندات بانتظار توقيعك"
    assert url == "/books?status=pending"


# --- direct sends -----------------------------------------------------------


def test_inbox_confidential_single_is_neutral_even_with_details_present():
    it = _item(
        "inbox",
        url="/books/5",
        label="HR-0409",
        subject="Private memo",
        requester="Ali",
        confidential=True,
    )
    messages, url = ss._build_push("inbox", [it], "/ledger?tab=books&scope=incoming")
    assert messages == {
        "en": (APP, "New record sent to you"),
        "ar": (APP, "لديك معاملة جديدة"),
    }
    assert url == "/books/5"


def test_inbox_general_single_includes_record_and_sender():
    book = Book(
        id=5,
        ref_number="HR-0409",
        subject="Annual leave",
        grade="unclassified",
        distribution="organization",
    )
    item = ns.inbox_item(book, BookRecipient(id=12), "Ali")
    assert (item.kind, item.ref, item.label) == ("inbox", "send:12", "HR-0409")
    assert not item.confidential
    messages, url = ss._build_push("inbox", [item], "/ledger?tab=books&scope=incoming")
    assert messages["en"][1] == "New record sent to you · HR-0409 — Annual leave\nFrom Ali"
    assert messages["ar"][1] == "لديك معاملة جديدة · HR-0409 — Annual leave\nمن Ali"
    assert url == "/books/5"


CLOSED_RECORDS = [
    ("unclassified", "named"),
    ("secret", "organization"),
    ("secret", "named"),
    ("top_secret", "named"),
    ("addressee_only", "named"),
]


@pytest.mark.parametrize(("level", "distribution"), CLOSED_RECORDS)
def test_inbox_item_redacts_non_open_record(level, distribution):
    book = Book(
        id=5, ref_number="HR-0409", subject="Private memo", grade=level, distribution=distribution
    )
    item = ns.inbox_item(book, BookRecipient(id=12), "Ali")
    assert item.subject is None
    assert item.requester is None
    assert item.confidential
    assert (item.ref, item.url, item.label) == ("send:12", "/books/5", "HR-0409")


def test_inbox_multiple_summarizes_without_any_record_details():
    section = ss._KIND_META["inbox"]
    assert section == "/ledger?tab=books&scope=incoming"
    items = [
        _item("inbox", subject="General memo", requester="Ali"),
        _item("inbox", ref="send:2", subject="Private memo", confidential=True),
    ]
    messages, url = ss._build_push("inbox", items, section)
    assert messages["en"][1] == "2 new records sent to you"
    assert messages["ar"][1] == "لديك معاملات جديدة · \u20662\u2069"
    assert url == section


@pytest.mark.parametrize(
    ("level", "distribution"), [("unclassified", "organization"), *CLOSED_RECORDS]
)
def test_record_actionable_items_redact_non_open_subjects(api_db, monkeypatch, level, distribution):
    user = make_user(api_db, role="manager")
    book = Book(
        id=5, ref_number="HR-0409", subject="Private memo", grade=level, distribution=distribution
    )
    is_open = (level, distribution) == ("unclassified", "organization")
    monkeypatch.setattr(ns.book_service, "list_awaiting", lambda *a, **kw: [book])
    monkeypatch.setattr(ns.book_service, "list_awaiting_scan", lambda *a, **kw: [book])
    items = [
        item for item in ns.actionable_items(api_db, user) if item.kind in {"approval", "scanback"}
    ]
    assert {item.kind for item in items} == {"approval", "scanback"}
    for item in items:
        assert item.label == book.ref_number
        assert item.subject == (book.subject if is_open else None)
        messages, _ = ss._build_push(item.kind, [item], "/section")
        for lang in ("en", "ar"):
            assert (book.subject in messages[lang][1]) == is_open


def test_inbox_counts_and_items_only_include_visible_unread_active_sends(api_db, monkeypatch):
    user = make_user(api_db, email="recipient@test.ae")
    sender = make_user(api_db, email="sender@test.ae")
    api_db.add(BookCategory(id="HR", name_en="HR", prefix="HR"))
    rows = []
    for n, (level, distribution) in enumerate(
        [
            ("unclassified", "organization"),
            ("unclassified", "named"),
            ("unclassified", "organization"),
            ("unclassified", "organization"),
            ("secret", "organization"),
            ("unclassified", "organization"),
        ],
        1,
    ):
        book = Book(
            category_id="HR",
            ref_number=f"HR-{n}",
            subject=f"Subject {n}",
            grade=level,
            distribution=distribution,
            created_by_user_id=sender.id,
            deleted_at=datetime(2026, 1, 1) if n == 6 else None,
        )
        api_db.add(book)
        api_db.flush()
        row = BookRecipient(
            book_id=book.id,
            user_id=user.id,
            sent_by_user_id=sender.id,
            purpose="info",
            read_at=datetime(2026, 1, 1) if n == 3 else None,
            revoked_at=datetime(2026, 1, 1) if n == 4 else None,
        )
        api_db.add(row)
        rows.append(row)
    api_db.commit()
    assert ns.relevant_counts(api_db, user, precomputed_leaves=0).inbox == 2
    assert ns.relevant_counts(api_db, sender, precomputed_leaves=0).inbox == 0
    batches = []
    resolve = ns.book_service.resolve_names_by_ids

    def resolve_names(db, ids):
        batches.append(ids)
        return resolve(db, ids)

    monkeypatch.setattr(ns.book_service, "resolve_names_by_ids", resolve_names)
    items = [item for item in ns.actionable_items(api_db, user) if item.kind == "inbox"]
    assert batches == [{sender.id}]
    assert {item.ref for item in items} == {f"send:{row.id}" for row in rows[:2]}
    assert next(item for item in items if not item.confidential).requester == sender.email
    assert next(item for item in items if item.confidential).subject is None


# --- scan -------------------------------------------------------------------


def test_scan_single_and_multiple():
    one, _ = ss._build_push("scan", [_item("scan", url="/scan-inbox", label="#42")], "/scan-inbox")
    assert "New scan to review" in one["en"][1]
    assert "#42" in one["en"][1]
    many, _ = ss._build_push("scan", [_item("scan"), _item("scan")], "/scan-inbox")
    assert many["en"][1] == "2 scanned documents awaiting your review"


# --- helpers ----------------------------------------------------------------


def test_email_preview_strips_html_collapses_and_truncates():
    html = "<p>Hello&nbsp;there</p><div>Second   line</div>"
    out = ns._email_preview(html)
    assert "<" not in out and ">" not in out
    assert "Hello" in out and "Second line" in out
    long = "<p>" + "word " * 80 + "</p>"
    trimmed = ns._email_preview(long, limit=40)
    assert len(trimmed) <= 41
    assert trimmed.endswith("…")


def test_email_preview_empty():
    assert ns._email_preview(None) == ""
    assert ns._email_preview("") == ""


def test_sender_name_extracts_display_name():
    assert ns._sender_name("Ahmed Al Mansoori <ahmed@gssg.ae>") == "Ahmed Al Mansoori"
    assert ns._sender_name("plain@host.com") == "plain@host.com"
    assert ns._sender_name(None) == "Unknown sender"
    assert ns._sender_name('"Quoted Name" <q@x.ae>') == "Quoted Name"


@pytest.mark.parametrize(
    ("verdict", "report", "en", "ar"),
    [
        ("approved", False, "Approved", "تمت الموافقة"),
        ("rejected", False, "Rejected", "مرفوض"),
        ("returned", False, "Returned to you", "مُعاد إليك"),
        ("approved", True, "Reviewed", "تمت المراجعة"),
    ],
)
def test_decision_push_names_outcome_record_and_decider(verdict, report, en, ar):
    item = _item(
        "decision",
        verdict=verdict,
        is_report=report,
        url="/books/5",
        label="HR-5",
        subject="Annual leave",
        requester="Ali",
        requester_ar="علي",
    )
    messages, url = ss._build_push("decision", [item], "/section")
    assert messages == {
        "en": (APP, f"{en} · HR-5 — Annual leave\nBy Ali"),
        "ar": (APP, f"{ar} · \u2066HR-5\u2069 — Annual leave\nبواسطة علي"),
    }
    assert url == "/books/5"


def test_decision_push_redacted_subject_and_fallback_decider_name():
    item = _item("decision", verdict="approved", label="HR-5", requester="Ali")
    messages, _ = ss._build_push("decision", [item], "/section")
    assert messages["en"][1] == "Approved · HR-5\nBy Ali"
    assert messages["ar"][1] == "تمت الموافقة · \u2066HR-5\u2069\nبواسطة Ali"


def test_several_decisions_summarize_without_record_details():
    section = ss._KIND_META["decision"]
    assert section == "/books/approvals?tab=sent"
    items = [
        _item("decision", verdict="approved", subject="Private", requester="Ali"),
        _item("decision", verdict="returned", ref="decision:2"),
    ]
    messages, url = ss._build_push("decision", items, section)
    assert messages == {
        "en": (APP, "2 decisions on your records"),
        "ar": (APP, "قرارات على معاملاتك · \u20662\u2069"),
    }
    assert url == section
