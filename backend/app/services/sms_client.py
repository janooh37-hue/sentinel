"""Thin transport to the on-site SMS Gateway (SMS Gate, local mode).

The ONLY module that knows the gateway's HTTP shape. Sends a plain-text SMS to
one recipient via the Android phone's local HTTP API. One retry on
network/timeout; HTTP errors are mapped to a ``SendResult`` so callers never
see a raw exception.

SMS Gate local API:
  POST {gateway_url}/message            (HTTP Basic auth)
  body: {"textMessage": {"text": ...}, "phoneNumbers": ["+9715..."]}
  → 2xx: {"id": "...", "state": "Pending", ...}
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)
# Overridable in tests via monkeypatch (httpx.MockTransport).
_transport: httpx.BaseTransport | None = None


@dataclass(frozen=True)
class SendResult:
    ok: bool
    message_id: str | None = None
    error: str | None = None


def _post(url: str, auth: tuple[str, str], headers: dict, payload: dict) -> httpx.Response:
    with httpx.Client(transport=_transport, timeout=_TIMEOUT) as client:
        return client.post(url, auth=auth, headers=headers, json=payload)


def send(phone: str, text: str) -> SendResult:
    cfg = get_settings()
    # SMS Gate local server is plain HTTP; tolerate a base saved without a
    # scheme or with a trailing slash.
    base = cfg.sms_gateway_url.strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    url = f"{base}/message"
    auth = (cfg.sms_username, cfg.sms_password)
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    payload = {"textMessage": {"text": text}, "phoneNumbers": [phone]}

    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            resp = _post(url, auth, headers, payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("sms: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            try:
                data = resp.json()
            except ValueError:
                data = {}
            return SendResult(ok=True, message_id=data.get("id"))
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return SendResult(ok=False, error=last_err or "network error")
