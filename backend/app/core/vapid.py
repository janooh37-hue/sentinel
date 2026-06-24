"""VAPID keypair management for Web Push (Phase 5).

The EC keypair is generated on first use and persisted at
``<data_dir>/.vapid_key`` — mirroring the Fernet ``.email_key`` pattern in
``core/crypto.py``.  The file is cached for the process lifetime; restart to
pick up a rotated key.

NEVER commit ``.vapid_key`` to git (covered in ``.gitignore``).

API surface:
  ``public_key()``     → url-safe-base64 application server key for the browser
  ``private_pem_path()`` → path to the key file (passed to pywebpush.webpush)
  ``_get_or_create``   → lru_cached loader (call ``.cache_clear()`` in tests)
"""

from __future__ import annotations

import base64
import contextlib
import os
import stat
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from py_vapid import Vapid

from app.config import get_settings

KEY_FILENAME = ".vapid_key"


@lru_cache(maxsize=1)
def _get_or_create(data_dir: Path) -> Vapid:
    """Load the VAPID keypair from disk or generate a fresh one.

    The lru_cache binds on ``data_dir`` so tests that inject a different
    ``tmp_data_dir`` get an isolated instance after ``cache_clear()``.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / KEY_FILENAME
    if path.exists():
        v: Vapid = Vapid.from_file(str(path))
    else:
        v = Vapid()
        v.generate_keys()
        v.save_key(str(path))
        # Restrict permissions on POSIX (no-op on Windows).
        with contextlib.suppress(OSError):
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    return v


def _vapid() -> Vapid:
    return _get_or_create(get_settings().data_dir)


def public_key() -> str:
    """Return the url-safe-base64 application server key the browser needs.

    The key is the uncompressed EC point (0x04 || x || y, 65 bytes) encoded
    as url-safe base64 without padding — exactly what
    ``PushManager.subscribe({ applicationServerKey })`` expects.
    """
    v = _vapid()
    raw = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def private_pem_path() -> str:
    """Return the path to the private key file on disk.

    ``pywebpush.webpush`` accepts a path string for ``vapid_private_key``;
    it reads and parses the PEM at call time.
    """
    return str(get_settings().data_dir / KEY_FILENAME)
