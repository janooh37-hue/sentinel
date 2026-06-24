"""Symmetric encryption helpers for credentials stored at rest.

Uses Fernet (AES-128 in CBC mode + HMAC-SHA256) from ``cryptography``. The
key lives at ``<data_dir>/.email_key`` — a 32-byte url-safe base64 string
generated on first use. Keeping the key outside the DB means a stolen
SQLite snapshot alone can't recover credentials.

The key file is created with 0o600 perms on POSIX. On Windows there is no
direct equivalent; the file inherits the data dir ACLs (which is fine for
a single-user local app).
"""

from __future__ import annotations

import os
import stat
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

KEY_FILENAME = ".email_key"


@lru_cache(maxsize=1)
def _load_or_create_key(data_dir: Path) -> bytes:
    """Read the Fernet key from the data dir; create one if missing.

    The result is cached for the process lifetime. If the key file is rotated
    on disk the app must be restarted (or ``_load_or_create_key.cache_clear()``
    called) for the new key to take effect. For the current single-process
    local-app use case this is intentional — restarts are cheap and the
    alternative (stat on every encrypt/decrypt) adds needless I/O.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / KEY_FILENAME
    if path.exists():
        return path.read_bytes().strip()
    key = Fernet.generate_key()
    path.write_bytes(key)
    # Restrict perms on POSIX (no-op on Windows).
    try:
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return key


def _fernet() -> Fernet:
    return Fernet(_load_or_create_key(get_settings().data_dir))


def encrypt(plaintext: str) -> str:
    """Encrypt ``plaintext`` to a url-safe base64 token."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt a Fernet token. Raises ``ValueError`` on tamper / wrong key."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError("encrypted blob is invalid or wrong key") from e
