"""Cache headers for the built SPA.

Vite emits content-hashed files under ``/assets/`` — their names change when
contents change, so browsers may cache them forever. ``index.html``, ``sw.js``
and the manifest keep ``no-cache`` because their contents change in place.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app


def _static_tree(tmp_path: Path) -> Path:
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "assets" / "app-abc123.js").write_text("console.log(1)\n")
    (static / "index.html").write_text("<!doctype html><title>t</title>")
    (static / "sw.js").write_text("// sw")
    return static


def _client(monkeypatch, tmp_path: Path) -> TestClient:
    monkeypatch.setattr("app.main.STATIC_DIR", _static_tree(tmp_path))
    return TestClient(create_app())


def test_hashed_assets_are_immutable(monkeypatch, tmp_path):
    r = _client(monkeypatch, tmp_path).get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert r.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_missing_asset_has_no_cache_header(monkeypatch, tmp_path):
    r = _client(monkeypatch, tmp_path).get("/assets/gone-000000.js")
    assert r.status_code == 404
    assert "immutable" not in r.headers.get("Cache-Control", "")


def test_index_html_revalidates(monkeypatch, tmp_path):
    r = _client(monkeypatch, tmp_path).get("/")
    assert r.status_code == 200
    assert r.headers["Cache-Control"] == "no-cache"


def test_service_worker_revalidates(monkeypatch, tmp_path):
    r = _client(monkeypatch, tmp_path).get("/sw.js")
    assert r.status_code == 200
    assert r.headers["Cache-Control"] == "no-cache"
