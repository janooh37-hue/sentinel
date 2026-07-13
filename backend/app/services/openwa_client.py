"""Thin transport to the self-hosted OpenWA gateway.

The ONLY module that knows OpenWA's HTTP shape. Sends free-form text, checks
WhatsApp registration, reads message acks, and reports session health. One retry
on transport error; API errors map to a result dataclass so callers never see a
raw exception. Paths/fields follow the pinned contract in deploy/openwa/README.md.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)
_transport: httpx.BaseTransport | None = None  # overridable in tests


@dataclass(frozen=True)
class SendResult:
    ok: bool
    message_id: str | None = None
    error: str | None = None
    not_registered: bool = False


@dataclass(frozen=True)
class DeliveryResult:
    ok: bool
    state: str | None = None
    error: str | None = None


def _base() -> str:
    base = get_settings().openwa_api_base.strip().rstrip("/")
    if base and "://" not in base:
        base = "http://" + base
    return base


def _headers() -> dict[str, str]:
    return {
        "X-API-Key": get_settings().openwa_api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _chat_id(phone: str) -> str:
    return f"{phone.removeprefix('+')}@c.us"


def _client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=_TIMEOUT)


def send(phone: str, text: str) -> SendResult:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/send-text"
    payload = {"chatId": _chat_id(phone), "text": text}
    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            with _client() as c:
                resp = c.post(url, headers=_headers(), json=payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("openwa: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            data = resp.json() if resp.content else {}
            return SendResult(
                ok=True, message_id=data.get("id") or (data.get("key") or {}).get("id")
            )
        body = resp.text
        not_reg = (
            resp.status_code == 422
            or "not a whatsapp" in body.casefold()
            or "not registered" in body.casefold()
        )
        return SendResult(
            ok=False, error=f"HTTP {resp.status_code}: {body}", not_registered=not_reg
        )
    return SendResult(ok=False, error=last_err or "network error")


def is_registered(phone: str) -> bool | None:
    """True/False if the gateway can tell us; None when unknown (endpoint error)."""
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/contacts/check"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers(), params={"phone": phone.removeprefix("+")})
    except httpx.HTTPError as e:
        log.warning("openwa: is_registered transport error: %s", e)
        return None
    if resp.status_code // 100 != 2:
        return None
    data = resp.json() if resp.content else {}
    val = data.get("numberExists")
    return bool(val) if val is not None else None


def get_ack(message_id: str) -> DeliveryResult:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/messages/{message_id}"
    last_err: str | None = None
    for _attempt in range(2):
        try:
            with _client() as c:
                resp = c.get(url, headers=_headers())
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            continue
        if resp.status_code // 100 == 2:
            data = resp.json() if resp.content else {}
            return DeliveryResult(ok=True, state=(data.get("ack") or data.get("status")))
        return DeliveryResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return DeliveryResult(ok=False, error=last_err or "network error")


def health() -> bool:
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers())
    except httpx.HTTPError:
        return False
    if resp.status_code // 100 != 2:
        return False
    data = resp.json() if resp.content else {}
    return str(data.get("status", "")).upper() in {"CONNECTED", "READY", "WORKING"}
