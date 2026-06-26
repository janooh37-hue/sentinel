"""Push-notification copy — title is always the app name (EN+AR), bodies are
specific and professional. Pure unit tests over the copy builders / helpers."""

from app.services import notification_service as ns
from app.services import scheduler_service as ss
from app.services.notification_service import ActionableItem

APP = "GSSG Manager"


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
