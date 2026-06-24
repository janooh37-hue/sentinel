"""Error envelope shared across every ``/api/v1/`` endpoint.

PRD §6 nails down the wire shape:

    { "error": { "code": "EMPLOYEE_NOT_FOUND", "message": "...", "details": {} } }

so the React client can switch on a stable ``code`` without parsing prose.
:class:`AppError` is the one exception every route should raise — the handler
installed in :func:`install_handlers` converts it to that envelope. Pydantic
422s and FastAPI ``HTTPException`` go through their own handlers so the wire
stays consistent.
"""

from __future__ import annotations

import logging
import traceback
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    """Route-layer exception carrying a stable error ``code``."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_status: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.details = details or {}

    def envelope(self) -> dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


# Common shortcuts so callers don't sprinkle status codes around.


class NotFoundError(AppError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(
            code, message, http_status=status.HTTP_404_NOT_FOUND, details=details
        )


class ConflictError(AppError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(
            code, message, http_status=status.HTTP_409_CONFLICT, details=details
        )


class ValidationFailedError(AppError):
    def __init__(self, code: str, message: str, **details: Any) -> None:
        super().__init__(
            code,
            message,
            http_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


def _envelope(code: str, message: str, **details: Any) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def install_handlers(app: FastAPI) -> None:
    """Register the three handlers needed for a consistent error envelope."""

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.http_status, content=exc.envelope())

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Pydantic v2 error dicts can contain ``ctx`` values that are raw
        # exception instances (e.g. our ValueError from ``model_validator``).
        # ``jsonable_encoder`` coerces those to strings so the response stays
        # JSON-serialisable.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                "VALIDATION_ERROR",
                "Request payload failed validation",
                errors=jsonable_encoder(exc.errors()),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                f"HTTP_{exc.status_code}",
                str(exc.detail) if exc.detail else "HTTP error",
            ),
        )

    @app.exception_handler(Exception)
    async def _unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        log.error(
            "Unhandled exception on %s %s\n%s",
            request.method,
            request.url.path,
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope("INTERNAL_ERROR", "An unexpected error occurred."),
        )


__all__ = [
    "AppError",
    "ConflictError",
    "NotFoundError",
    "ValidationFailedError",
    "install_handlers",
]
