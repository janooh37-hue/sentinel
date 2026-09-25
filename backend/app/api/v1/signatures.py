"""Saved-signature endpoints — GET /signatures/me, POST /signatures/preview.

Both read the caller's ONE saved signature
(``user_signature_service.resolve_signature``): the linked employee's profile
file for a linked account, or the account's own file for an unlinked one.

Mirrors the IDM workaround in ``documents.py``: when ``?encoding=base64`` is
supplied the bytes are base64-encoded and returned as ``text/plain`` with
``X-Content-Type-Options: nosniff`` so Internet Download Manager doesn't sniff
the PNG and hijack the response.

Returns 404 when the caller has no saved signature.
"""

from __future__ import annotations

import base64
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.api._responses import maybe_base64
from app.api.deps import get_current_user
from app.api.errors import NotFoundError
from app.core.signature_render import clamp_boldness, clamp_size, prepare_signature
from app.db.models import User
from app.services import user_signature_service

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
    """Return the caller's saved signature PNG (self-scoped).

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` —
    the frontend uses this to dodge Internet Download Manager. Default returns
    raw ``image/png`` inline.
    """
    path = user_signature_service.resolve_signature(current_user)
    if path is None:
        raise NotFoundError(
            "SIGNATURE_NOT_FOUND",
            "No signature on file for this user.",
        )
    data = path.read_bytes()
    if (b64 := maybe_base64(data, encoding)) is not None:
        return b64
    return Response(content=data, media_type="image/png")


@router.post("/preview", response_model=SignaturePreviewResponse)
def preview_my_signature(
    body: SignaturePreviewRequest,
    current_user: Annotated[User, Depends(get_current_user)],
) -> SignaturePreviewResponse:
    """Render the caller's saved signature at the given size/boldness (self-scoped).

    Reads the SAME source as ``GET /signatures/me`` — the preview always
    matches what lands on a signed document.
    """
    path = user_signature_service.resolve_signature(current_user)
    if path is None:
        raise NotFoundError("SIGNATURE_NOT_FOUND", "No signature on file for this user.")
    size_mm = clamp_size(body.size_mm)
    boldness = clamp_boldness(body.boldness)
    png = prepare_signature(path.read_bytes(), dilate_radius_px=boldness)
    data_url = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    return SignaturePreviewResponse(data_url=data_url, size_mm=size_mm, boldness=boldness)


__all__ = ["router"]
