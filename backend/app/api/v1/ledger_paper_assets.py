"""Same-origin assets for the Ledger Book paper (ADR 0007).

``GET /ledger/paper-assets/{name}`` serves the letterhead images and fonts the
paper's CSP (``img-src 'self'; font-src 'self'``) allows. Only the names in
``ASSETS`` resolve; anything else is a 404, so no path ever reaches the disk.
"""

from __future__ import annotations

from pathlib import Path
from typing import Final

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

ASSET_DIR: Final = Path(__file__).resolve().parents[2] / "core" / "ledger_paper_assets"

ASSETS: Final[dict[str, str]] = {
    "letterhead-logo.png": "image/png",
    "icon-location.png": "image/png",
    "icon-email.png": "image/png",
    "icon-phone.png": "image/png",
    "NotoNaskhArabic-Regular.ttf": "font/ttf",
    "NotoNaskhArabic-Bold.ttf": "font/ttf",
    "LibreBarcode39-Regular.ttf": "font/ttf",
}

router = APIRouter(prefix="/ledger/paper-assets", tags=["ledger"])


@router.get("/{name}", include_in_schema=False)
def get_paper_asset(name: str) -> FileResponse:
    media_type = ASSETS.get(name)
    if media_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown paper asset")
    return FileResponse(
        ASSET_DIR / name,
        media_type=media_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
