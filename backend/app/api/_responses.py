"""Shared HTTP response helpers for the v1 routers."""

from __future__ import annotations

import base64

from fastapi import Response


def maybe_base64(
    data: bytes,
    encoding: str | None,
    *,
    extra_headers: dict[str, str] | None = None,
) -> Response | None:
    """IDM-safe download shim.

    When ``encoding == "base64"`` return the bytes base64-encoded as
    ``text/plain`` with ``X-Content-Type-Options: nosniff`` — so Internet
    Download Manager / the browser's PDF handler can't hijack the download and
    pdf.js decodes the body itself. Otherwise return ``None`` so the caller
    serves the file with its own media type. ``extra_headers`` are merged in
    (e.g. the signature route's ``X-Signature-Updated``).
    """
    if encoding != "base64":
        return None
    headers = {"X-Content-Type-Options": "nosniff"}
    if extra_headers:
        headers.update(extra_headers)
    return Response(content=base64.b64encode(data), media_type="text/plain", headers=headers)
