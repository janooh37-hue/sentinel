"""Saved-signature endpoints — GET /signatures/me, POST /signatures/preview.

Returns the signed-in user's own signature PNG (stored at
``<vault>/<G>/documents/signature.png`` by ``core.signature.save``). Self-scoped
— any authenticated user may read their own, no admin gate.

Mirrors the IDM workaround in ``documents.py``: when ``?encoding=base64`` is
supplied the bytes are base64-encoded and returned as ``text/plain`` with
``X-Content-Type-Options: nosniff`` so Internet Download Manager doesn't sniff
the PNG and hijack the response.

Returns 404 when the caller has no linked employee, or has one but never saved
a signature.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.config import get_settings
from app.core import signature as sig_core
from app.core.signature_render import clamp_boldness, clamp_size, prepare_signature
from app.core.vault_manager import Vault
from app.db.models import User

router = APIRouter(prefix="/signatures", tags=["signatures"])


class SignaturePreviewRequest(BaseModel):
    size_mm: int
    boldness: int


class SignaturePreviewResponse(BaseModel):
    data_url: str
    size_mm: int
    boldness: int


@router.get("/me")
def get_my_signature(
    current_user: Annotated[User, Depends(get_current_user)],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Return the current user's saved signature PNG (self-scoped).

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` —
    the frontend uses this to dodge Internet Download Manager. Default returns
    raw ``image/png`` inline.
    """
    if not current_user.employee_id:
        raise NotFoundError(
            "SIGNATURE_NOT_FOUND",
            "No signature on file for this user.",
        )

    vault = Vault(get_settings().vault_dir)
    path = sig_core.vault_path(vault, current_user.employee_id)
    if not path.is_file():
        raise NotFoundError(
            "SIGNATURE_NOT_FOUND",
            "No signature on file for this user.",
        )

    data = path.read_bytes()
    if encoding == "base64":
        return Response(
            content=base64.b64encode(data),
            media_type="text/plain",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    return Response(content=data, media_type="image/png")


@router.post("/preview", response_model=SignaturePreviewResponse)
def preview_my_signature(
    body: SignaturePreviewRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SignaturePreviewResponse:
    """Render the caller's SIGNING signature at the given size/boldness (self-scoped).

    Reads ``user.signature_path`` — the exact file embedded when this user signs a
    book (``book_service.sign_book``) — so the preview matches what lands on the
    document. This is deliberately NOT the employee-vault signature served by
    ``GET /signatures/me`` (those can differ).
    """
    if not current_user.signature_path:
        raise NotFoundError("SIGNATURE_NOT_FOUND", "No signature on file for this user.")
    path = Path(current_user.signature_path)
    if not path.is_absolute():
        path = get_settings().data_dir / path
    if not path.is_file():
        raise NotFoundError("SIGNATURE_NOT_FOUND", "No signature on file for this user.")

    size_mm = clamp_size(body.size_mm)
    boldness = clamp_boldness(body.boldness)
    png = prepare_signature(path.read_bytes(), dilate_radius_px=boldness)
    data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return SignaturePreviewResponse(data_url=data_url, size_mm=size_mm, boldness=boldness)


__all__ = ["router"]
