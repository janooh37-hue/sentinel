"""Private Ledger Book drafts and their owner-scoped image storage."""

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.config import Settings
from app.db.models import BookDraft, UserPermission
from app.db.session import get_db
from app.main import create_app
from app.services import ledger_book_service
from tests.conftest import make_user

BASE = "/api/v1/ledger/drafts"
PNG = b"\x89PNG\r\n\x1a\nimage payload"


@pytest.fixture
def drafts(api_db, tmp_path, monkeypatch):
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(ledger_book_service, "get_settings", lambda: settings)
    owner = make_user(api_db, email="writer@example.ae")
    other = make_user(api_db, email="other@example.ae")
    actor = [owner]
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: actor[0]
    with TestClient(app) as client:
        yield client, api_db, actor, owner, other, settings.data_dir
    app.dependency_overrides.clear()


def error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code


def test_draft_crud_sanitizes_and_clears_nullable_tab(drafts):
    client, db, _, _, _, _ = drafts
    response = client.post(
        BASE,
        json={
            "tab": 5,
            "subjects": ["  First  "],
            "body_html": '<script>bad()</script><p onerror="bad()">Safe</p>',
        },
    )
    assert response.status_code == 201, response.text
    draft = response.json()
    assert draft["draft_number"] == f"{draft['id']:06d}"
    assert draft["subjects"] == ["First"]
    assert draft["body_html"] == "<p>Safe</p>"
    url = f"{BASE}/{draft['id']}"
    assert client.get(url).json() == draft
    assert [row["id"] for row in client.get(BASE).json()] == [draft["id"]]
    response = client.patch(
        url,
        json={"tab": None, "body_html": '<p onerror="oops()">Changed</p><script>oops()</script>'},
    )
    assert response.status_code == 200
    assert response.json()["tab"] is None
    assert response.json()["subjects"] == ["First"]
    assert response.json()["body_html"] == "<p>Changed</p>"
    assert db.get(BookDraft, draft["id"]).body_html == "<p>Changed</p>"
    assert client.delete(url).status_code == 204
    error(client.get(url), 404, "DRAFT_NOT_FOUND")
    assert client.get(BASE).json() == []


def test_other_users_cannot_discover_or_mutate_drafts_or_images(drafts):
    client, _, actor, _, other, _ = drafts
    draft = client.post(BASE, json={}).json()
    url = f"{BASE}/{draft['id']}"
    image = client.post(f"{url}/images", files={"file": ("image.png", PNG, "image/png")}).json()
    actor[0] = other
    own = client.post(BASE, json={"subjects": ["Other's draft"]}).json()
    assert [row["id"] for row in client.get(BASE).json()] == [own["id"]]
    for response in (
        client.get(url),
        client.patch(url, json={"tab": 1}),
        client.delete(url),
        client.get(image["src"]),
        client.post(f"{url}/images", files={"file": ("x.png", PNG, "image/png")}),
    ):
        error(response, 404, "DRAFT_NOT_FOUND")


def test_inmate_reporter_cannot_create_drafts(drafts):
    client, db, actor, _, _, _ = drafts
    actor[0] = make_user(db, role="inmate_reporter", email="reporter@example.ae")
    assert client.post(BASE, json={}).status_code == 403


@pytest.mark.parametrize("operation", ["create", "patch"])
def test_secret_grade_requires_clearance_but_top_secret_does_not(drafts, operation):
    client, db, actor, owner, _, _ = drafts
    draft = client.post(BASE, json={}).json()

    def choose(grade):
        if operation == "create":
            return client.post(BASE, json={"grade": grade})
        return client.patch(f"{BASE}/{draft['id']}", json={"grade": grade})

    error(choose("secret"), 403, "SECRET_CLEARANCE_REQUIRED")
    assert choose("top_secret").json()["grade"] == "top_secret"
    db.add(UserPermission(user_id=owner.id, capability="books.secret", effect="grant"))
    db.commit()
    owner._effective_caps_cache = None
    actor[0] = owner
    response = choose("secret")
    assert response.status_code in (200, 201), response.text
    assert response.json()["grade"] == "secret"


@pytest.mark.parametrize(
    ("data", "extension", "media_type"),
    [
        (PNG, "png", "image/png"),
        (b"\xff\xd8\xffjpeg payload", "jpg", "image/jpeg"),
        (b"GIF89aimage payload", "gif", "image/gif"),
        (b"RIFF\x04\x00\x00\x00WEBPpayload", "webp", "image/webp"),
    ],
)
def test_images_use_magic_bytes_and_are_served_with_detected_type(
    drafts, data, extension, media_type
):
    client, _, _, _, _, root = drafts
    draft = client.post(BASE, json={}).json()
    response = client.post(
        f"{BASE}/{draft['id']}/images", files={"file": ("misleading.txt", data, "text/plain")}
    )
    assert response.status_code == 201, response.text
    image = response.json()
    assert image["name"].endswith(f".{extension}")
    assert len(image["name"].split(".")[0]) == 32
    response = client.get(image["src"])
    assert response.status_code == 200
    assert response.content == data
    assert response.headers["content-type"] == media_type
    folder = root / "ledger_drafts" / str(draft["id"])
    assert (folder / image["name"]).read_bytes() == data
    assert client.delete(f"{BASE}/{draft['id']}").status_code == 204
    assert not folder.exists()


def test_invalid_oversized_and_unknown_image_names(drafts):
    client, _, _, _, _, _ = drafts
    draft = client.post(BASE, json={}).json()
    url = f"{BASE}/{draft['id']}/images"
    error(
        client.post(url, files={"file": ("fake.png", b"plain text", "image/png")}),
        422,
        "IMAGE_TYPE_UNSUPPORTED",
    )
    error(
        client.post(
            url, files={"file": ("large.png", PNG + b"x" * (5 * 1024 * 1024), "image/png")}
        ),
        413,
        "IMAGE_TOO_LARGE",
    )
    for name in ("0" * 32 + ".png", "invalid.png", "%2e%2e%2fsecret.png", "%2e%2e%5csecret.png"):
        assert client.get(f"{url}/{name}").status_code == 404
