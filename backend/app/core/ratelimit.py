"""In-memory per-IP rate limiter (no external deps).

A small sliding-window limiter for the single-process dev/office server. Each
limiter keeps a deque of recent hit timestamps per key (the client IP); a hit
is allowed only if fewer than ``max_hits`` fall inside the trailing
``window_seconds``. Old timestamps are pruned on every check.

This is deliberately process-local: the deploy model is one always-on office
PC, so there is no cross-worker state to share. A ``threading.Lock`` guards the
dict so concurrent uvicorn worker threads can't corrupt a key's deque.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.api.errors import AppError

# Limits (constants so callers / tests reference one source of truth).
LOGIN_MAX_HITS = 10
LOGIN_WINDOW_SECONDS = 60
EMAIL_VERIFY_MAX_HITS = 5
EMAIL_VERIFY_WINDOW_SECONDS = 60


class RateLimiter:
    """Sliding-window counter keyed by an arbitrary string (usually client IP)."""

    def __init__(self, *, max_hits: int, window_seconds: float) -> None:
        self.max_hits = max_hits
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        """Record a hit for ``key`` and return whether it is within the limit."""
        now = time.monotonic()
        floor = now - self.window_seconds
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] < floor:
                bucket.popleft()
            if len(bucket) >= self.max_hits:
                return False
            bucket.append(now)
            return True

    def reset(self) -> None:
        """Drop all recorded hits (test hook)."""
        with self._lock:
            self._hits.clear()


def _client_ip(request: Request) -> str:
    """Best-effort client IP for keying. Falls back to a constant when unknown."""
    return request.client.host if request.client else "unknown"


def enforce(limiter: RateLimiter, request: Request) -> None:
    """Raise a 429 ``AppError`` when ``request``'s client IP exceeds ``limiter``."""
    if not limiter.allow(_client_ip(request)):
        raise AppError(
            "RATE_LIMITED",
            "Too many attempts. Please wait a moment and try again.",
            http_status=429,
        )


# Shared singletons applied at the route layer.
login_limiter = RateLimiter(
    max_hits=LOGIN_MAX_HITS, window_seconds=LOGIN_WINDOW_SECONDS
)
email_verify_limiter = RateLimiter(
    max_hits=EMAIL_VERIFY_MAX_HITS, window_seconds=EMAIL_VERIFY_WINDOW_SECONDS
)


__all__ = [
    "EMAIL_VERIFY_MAX_HITS",
    "EMAIL_VERIFY_WINDOW_SECONDS",
    "LOGIN_MAX_HITS",
    "LOGIN_WINDOW_SECONDS",
    "RateLimiter",
    "email_verify_limiter",
    "enforce",
    "login_limiter",
]
