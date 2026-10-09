"""Response compression wiring.

JSON list payloads and the JS bundle shrink well under gzip; the middleware
must only kick in above a floor and only when the client advertises support
(WebDAV/Word clients that omit ``Accept-Encoding: gzip`` get identity bytes).
"""

from __future__ import annotations

from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.testclient import TestClient
from starlette.routing import Route

from app.main import create_app

_PROBE = "/_gzip_probe"
_SSE_PROBE = "/_gzip_sse_probe"
_FRAME = "event: counts\ndata: " + "x" * 2000 + "\n\n"


def _app():
    app = create_app()

    def _probe(request):
        return JSONResponse({"blob": "x" * 5000})

    # Prepend: the SPA `{full_path:path}` catch-all registered by create_app
    # would otherwise swallow the probe before it can match.
    app.router.routes.insert(0, Route(_PROBE, _probe, methods=["GET"], include_in_schema=False))

    def _sse(request):
        async def gen():
            yield _FRAME
            yield _FRAME

        return StreamingResponse(gen(), media_type="text/event-stream")

    app.router.routes.insert(0, Route(_SSE_PROBE, _sse, methods=["GET"], include_in_schema=False))
    return app


def test_large_response_is_gzipped_for_gzip_clients():
    client = TestClient(_app())
    r = client.get(_PROBE, headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert len(r.headers["content-length"]) > 0
    assert int(r.headers["content-length"]) < 5000 // 2
    assert r.json() == {"blob": "x" * 5000}  # TestClient transparently decodes


def test_small_response_is_not_compressed():
    client = TestClient(_app())
    r = client.get("/api/v1/system/health", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers


def test_client_without_gzip_gets_identity():
    client = TestClient(_app())
    r = client.get(_PROBE, headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "content-encoding" not in r.headers
    assert r.json() == {"blob": "x" * 5000}


def test_event_stream_bypasses_gzip_so_frames_flush():
    # Starlette 0.41 buffers streamed chunks inside its GzipFile, so a gzipped
    # SSE stream delivers only the 10-byte header until the stream ends.
    client = TestClient(_app())
    with client.stream(
        "GET",
        _SSE_PROBE,
        headers={"Accept": "text/event-stream", "Accept-Encoding": "gzip"},
    ) as r:
        assert r.status_code == 200
        assert "content-encoding" not in r.headers
        first = next(r.iter_raw())
    assert first.decode().startswith("event: counts\ndata: ")
