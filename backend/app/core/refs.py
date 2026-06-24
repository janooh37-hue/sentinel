"""Reference-number allocator ported from `BooksDatabase` (v3.5.4 line 1766).

In v3.5.4 the counter lives in `books_database.json` alongside the books list.
For Phase 01 we extract the *pure allocation logic* — a monotonic counter
formatted as ``{category}-{n:04d}`` — and let Phase 02 wire the persistence
through SQLAlchemy.

Public contract (Phase 01):

    RefAllocator(start: int = 1)
        .peek(category: str) -> str        # next ref without advancing
        .next(category: str) -> str        # allocate and advance
        .reserve(category: str) -> str     # alias of next() — matches v3's
                                           # ``pre_allocate_ref`` semantics
        .counter -> int                    # raw counter (for persistence)
        .set_counter(n: int) -> None       # restore from persistence

The allocator is *not* category-scoped in v3 — there is a single global counter
shared across every category. Mirroring that here so the format stays stable.
"""

from __future__ import annotations

from threading import Lock


class RefAllocator:
    """Single global monotonic counter, formatted ``{cat}-{n:04d}``."""

    def __init__(self, start: int = 1) -> None:
        if start < 1:
            raise ValueError(f"start must be >= 1, got {start}")
        self._n: int = start
        self._lock = Lock()

    @property
    def counter(self) -> int:
        """Current counter value — the *next* number that would be allocated."""
        with self._lock:
            return self._n

    def set_counter(self, n: int) -> None:
        """Reset the counter (typically called when loading from persistence)."""
        if n < 1:
            raise ValueError(f"counter must be >= 1, got {n}")
        with self._lock:
            self._n = n

    def peek(self, category: str) -> str:
        """Format the next ref *without* advancing the counter."""
        cat = _validate_category(category)
        with self._lock:
            return f"{cat}-{self._n:04d}"

    def next(self, category: str) -> str:
        """Allocate and return the next ref, advancing the counter by 1."""
        cat = _validate_category(category)
        with self._lock:
            ref = f"{cat}-{self._n:04d}"
            self._n += 1
            return ref

    # v3 alias — used when the caller stamps the document first and writes the
    # book entry afterwards (`pre_allocate_ref`). Same behaviour as `next`.
    reserve = next


def _validate_category(category: str) -> str:
    cat = (category or "").strip()
    if not cat:
        raise ValueError("category must be a non-empty string")
    return cat
