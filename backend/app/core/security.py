"""Password hashing + session-token helpers for multi-user auth.

Passwords are bcrypt digests; session tokens are opaque random strings whose
sha256 hash is what we persist (the raw token only ever lives in the cookie).
See ``docs/superpowers/plans/2026-05-24-multi-user-login.md``.
"""

from __future__ import annotations

import hashlib
import secrets

import bcrypt

_BCRYPT_ROUNDS = 12
# bcrypt only considers the first 72 bytes and 5.x raises on longer input, so
# cap explicitly. Truncating mid-codepoint is fine — bcrypt hashes raw bytes.
_MAX_PW_BYTES = 72


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:_MAX_PW_BYTES]
    return bcrypt.hashpw(pw, bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        pw = password.encode("utf-8")[:_MAX_PW_BYTES]
        return bcrypt.checkpw(pw, password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def new_session_token() -> str:
    """A fresh opaque session token for the ``gssg_session`` cookie."""
    return secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


__all__ = ["hash_password", "hash_token", "new_session_token", "verify_password"]
