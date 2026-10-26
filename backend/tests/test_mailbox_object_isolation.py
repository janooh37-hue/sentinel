"""Public-route regressions for the three WP1 mailbox isolation fingerprints."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime
from functools import cache
from hashlib import sha256
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.config import get_settings
from app.db.models import Book, BookCategory, Employee, LedgerEntry, LedgerFlag, User
from app.db.session import get_db
from app.main import create_app


@cache
def _application():
    return create_app()


@pytest.fixture(scope="module", autouse=True)
def shared_http_application():
    app = _application()
    yield app
    app.dependency_overrides.clear()
    _application.cache_clear()


@pytest.fixture()
def data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _user(db: Session, name: str, role: str = "manager") -> User:
    user = User(
        email=f"{name}@example.invalid",
        password_hash="x",
        display_name=name,
        role=role,
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def _client(db: Session, user: User) -> TestClient:
    app = _application()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _mail(db: Session, root: Path, owner: User | None, **fields) -> LedgerEntry:
    entry = LedgerEntry(
        entry_date=date(2026, 10, 23),
        direction="incoming",
        channel="email",
        counterparty="sender@example.invalid",
        subject="Synthetic private mail",
        notes_html="<p>Private synthetic body</p>",
        tags=["email"],
        owner_user_id=owner.id if owner else None,
    )
    for key, value in fields.items():
        setattr(entry, key, value)
    db.add(entry)
    db.flush()
    relative = f"ledger/{entry.id}/synthetic.txt"
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"synthetic private attachment")
    entry.attachment_paths = [relative]
    db.commit()
    return entry


def _snapshot(db: Session, root: Path) -> dict[str, object]:
    """Capture every column, not only the fields an operation normally changes."""
    db.expire_all()
    tables = {}
    for table in LedgerEntry.metadata.sorted_tables:
        rows = db.execute(select(table)).mappings().all()
        tables[table.name] = [dict(row) for row in rows]
    return {
        "rows": tables,
        "files": {
            str(p.relative_to(root)): sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*"))
            if p.is_file()
        },
    }


_READS = ("detail", "index", "name", "zip", "thread")
_MUTATIONS = ("patch", "delete", "star", "read", "unread", "set-flag", "clear-flag")


def _request(client: TestClient, entry_id: int, operation: str, scope: str = ""):
    paths = {
        "detail": ("GET", f"/{entry_id}"),
        "index": ("GET", f"/{entry_id}/attachments/by-index/0"),
        "name": ("GET", f"/{entry_id}/attachments/synthetic.txt"),
        "zip": ("GET", f"/entries/{entry_id}/attachments.zip"),
        "thread": ("GET", f"/{entry_id}/thread"),
        "patch": ("PATCH", f"/{entry_id}"),
        "delete": ("DELETE", f"/{entry_id}"),
        "star": ("POST", f"/entries/{entry_id}/star"),
        "read": ("POST", f"/entries/{entry_id}/mark-read"),
        "unread": ("POST", f"/entries/{entry_id}/mark-unread"),
        "set-flag": ("POST", f"/{entry_id}/flag"),
        "clear-flag": ("DELETE", f"/{entry_id}/flag"),
    }
    method, path = paths[operation]
    kwargs = {"json": {"subject": "Authorized edit"}} if operation == "patch" else {}
    return client.request(method, f"/api/v1/ledger{path}{scope}", **kwargs)


def _prepare_operation(db: Session, entry: LedgerEntry, actor: User, operation: str) -> None:
    if operation == "unread":
        entry.read_at = datetime(2026, 10, 22)
    if operation == "clear-flag":
        db.add(LedgerFlag(user_id=actor.id, entry_id=entry.id))
    db.commit()


@pytest.mark.parametrize("operation", _READS + _MUTATIONS)
@pytest.mark.parametrize("direction", ("incoming", "outgoing", "legacy-null"))
@pytest.mark.parametrize("scope", ("", "?scope=all"))
def test_foreign_mail_is_404_unchanged_and_owner_still_succeeds(
    api_db: Session, data_dir: Path, operation: str, direction: str, scope: str
) -> None:
    a, b = _user(api_db, "a"), _user(api_db, "b")
    legacy = direction == "legacy-null"
    target = _mail(
        api_db, data_dir, None if legacy else b, direction="incoming" if legacy else direction
    )
    _prepare_operation(api_db, target, a, operation)
    # Run the positive control even on RED: a failure must not hide a broken route.
    authorized = _mail(api_db, data_dir, b) if operation in _MUTATIONS else target
    actor = _user(api_db, "admin", "admin") if legacy and operation in _READS else b
    _prepare_operation(api_db, authorized, actor, operation)
    before = _snapshot(api_db, data_dir)
    denied = _request(_client(api_db, a), target.id, operation, scope)
    after = _snapshot(api_db, data_dir)
    positive = _request(
        _client(api_db, actor),
        authorized.id,
        operation,
        "?scope=all" if legacy and operation in _READS else "",
    )
    assert positive.status_code == (204 if operation == "delete" else 200), positive.text
    assert denied.status_code == 404, denied.text
    assert after == before


@pytest.mark.parametrize("operation", _READS)
@pytest.mark.parametrize("legacy", (False, True))
def test_admin_read_expansion_requires_explicit_all_scope(
    api_db: Session, data_dir: Path, operation: str, legacy: bool
) -> None:
    admin, b = _user(api_db, "admin", "admin"), _user(api_db, "b")
    entry = _mail(api_db, data_dir, None if legacy else b)
    before = _snapshot(api_db, data_dir)
    default = _request(_client(api_db, admin), entry.id, operation)
    after = _snapshot(api_db, data_dir)
    expanded = _request(_client(api_db, admin), entry.id, operation, "?scope=all")
    assert expanded.status_code == 200, expanded.text
    assert _snapshot(api_db, data_dir) == after
    assert default.status_code == 404, default.text
    assert after == before


@pytest.mark.parametrize("operation", _MUTATIONS)
@pytest.mark.parametrize("legacy", (False, True))
def test_admin_all_scope_never_widens_mutation_authority(
    api_db: Session, data_dir: Path, operation: str, legacy: bool
) -> None:
    admin, b = _user(api_db, "admin", "admin"), _user(api_db, "b")
    foreign = _mail(api_db, data_dir, None if legacy else b)
    own = _mail(api_db, data_dir, admin)
    for entry in (foreign, own):
        _prepare_operation(api_db, entry, admin, operation)
    before = _snapshot(api_db, data_dir)
    denied = _request(_client(api_db, admin), foreign.id, operation, "?scope=all")
    after = _snapshot(api_db, data_dir)
    positive = _request(_client(api_db, admin), own.id, operation, "?scope=all")
    assert positive.status_code == (204 if operation == "delete" else 200), positive.text
    assert denied.status_code == 404, denied.text
    assert after == before


@pytest.mark.parametrize("channel", ("email", "letter"))
def test_own_mail_and_shared_nonemail_remain_readable(
    api_db: Session, data_dir: Path, channel: str
) -> None:
    a, b = _user(api_db, "a"), _user(api_db, "b")
    entry = _mail(api_db, data_dir, a if channel == "email" else b, channel=channel)
    before = _snapshot(api_db, data_dir)
    response = _request(_client(api_db, a), entry.id, "detail")
    assert response.status_code == 200, response.text
    assert response.json()["id"] == entry.id
    assert _snapshot(api_db, data_dir) == before


def test_employee_detail_keeps_private_mail_owned_and_shared_correspondence_visible(
    api_db: Session, data_dir: Path
) -> None:
    a, b = _user(api_db, "a"), _user(api_db, "b")
    employee = Employee(id="G-MAIL-1", name_en="Synthetic employee")
    api_db.add(employee)
    api_db.commit()
    draft = _mail(api_db, data_dir, b, related_employee_id=employee.id, tags=["draft"])
    foreign = _mail(api_db, data_dir, b, related_employee_id=employee.id)
    legacy = _mail(api_db, data_dir, None, related_employee_id=employee.id)
    own = _mail(api_db, data_dir, a, related_employee_id=employee.id)
    shared = _mail(api_db, data_dir, None, related_employee_id=employee.id, channel="letter")
    before = _snapshot(api_db, data_dir)
    responses = [
        _client(api_db, actor).get(f"/api/v1/employees/{employee.id}/detail") for actor in (a, b)
    ]
    assert all(response.status_code == 200 for response in responses)
    a_ids, b_ids = (
        {row["id"] for row in response.json()["recent_ledger"]} for response in responses
    )
    assert _snapshot(api_db, data_dir) == before
    assert {draft.id, foreign.id, shared.id} <= b_ids
    assert own.id not in b_ids and legacy.id not in b_ids
    assert a_ids == {own.id, shared.id}


@pytest.mark.parametrize("surface", ("suggestions", "create-count", "list-count"))
def test_smart_folder_metadata_excludes_mail_linked_to_inaccessible_personal_books(
    api_db: Session, data_dir: Path, surface: str
) -> None:
    a, b = _user(api_db, "a"), _user(api_db, "b")
    api_db.add(BookCategory(id="MAIL", name_en="Mail", name_ar="بريد", prefix="MAIL"))
    api_db.commit()
    books = [
        Book(
            category_id="MAIL",
            ref_number=f"MAIL-{index}",
            subject="Synthetic",
            confidentiality="personal",
            created_by_user_id=owner.id,
        )
        for index, owner in enumerate((b, a))
    ]
    api_db.add_all(books)
    api_db.commit()
    hidden, visible = [], []
    for book, subject, entries in (
        (books[0], "Hidden synthetic cluster", hidden),
        (books[1], "Visible synthetic cluster", visible),
    ):
        for _ in range(5):
            entries.append(_mail(api_db, data_dir, a, related_book_id=book.id, subject=subject))
    client = _client(api_db, a)
    before = _snapshot(api_db, data_dir)
    denied = _request(client, hidden[0].id, "detail")
    assert denied.status_code == 404
    assert _snapshot(api_db, data_dir) == before
    assert _request(client, visible[0].id, "detail").status_code == 200
    if surface == "suggestions":
        response = client.get("/api/v1/ledger/smart-folders/suggestions")
        assert response.status_code == 200, response.text
        assert _snapshot(api_db, data_dir) == before
        assert response.json() == [
            {
                "cluster_key": "visible synthetic cluster",
                "name_suggestion": "Visible synthetic cluster",
                "count": 5,
                "correspondent_count": 1,
                "sample_subjects": ["Visible synthetic cluster"],
            }
        ]
    else:
        created = []
        for name in ("Hidden", "Visible"):
            response = client.post(
                "/api/v1/ledger/smart-folders",
                json={
                    "name_en": name,
                    "name_ar": "بريد",
                    "rule_value": f"{name} synthetic cluster",
                },
            )
            assert response.status_code == 201, response.text
            created.append(response.json())
        if surface == "list-count":
            before_list = _snapshot(api_db, data_dir)
            response = client.get("/api/v1/ledger/smart-folders")
            assert response.status_code == 200, response.text
            assert _snapshot(api_db, data_dir) == before_list
            created = response.json()
        assert {row["name_en"]: row["count"] for row in created} == {"Hidden": 0, "Visible": 5}


@pytest.mark.parametrize("legacy", (False, True))
def test_detail_reports_mail_owner_for_read_only_all_mail_view(
    api_db: Session, data_dir: Path, legacy: bool
) -> None:
    admin, b = _user(api_db, "admin", "admin"), _user(api_db, "b")
    entry = _mail(api_db, data_dir, None if legacy else b)
    before = _snapshot(api_db, data_dir)
    response = _request(_client(api_db, admin), entry.id, "detail", "?scope=all")
    assert response.status_code == 200, response.text
    assert _snapshot(api_db, data_dir) == before
    assert "owner_user_id" in response.json()
    assert response.json()["owner_user_id"] == entry.owner_user_id
