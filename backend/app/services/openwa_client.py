"""Thin transport to the self-hosted OpenWA gateway.

The ONLY module that knows OpenWA's HTTP shape. Sends free-form text, checks
WhatsApp registration, reads message acks, and reports session health. One retry
on transport error; API errors map to a result dataclass so callers never see a
raw exception. Paths/fields follow the pinned contract in deploy/openwa/README.md.
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass

import httpx

from app.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)
_PROBE_TIMEOUT = httpx.Timeout(3.0)  # status path only — keeps a dead gateway from pinning workers
_transport: httpx.BaseTransport | None = None  # overridable in tests

_ACK_STATE = {-1: "failed", 0: "sent", 1: "sent", 2: "delivered", 3: "read", 4: "read"}


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


@dataclass(frozen=True)
class Group:
    id: str
    name: str


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


def _probe_client() -> httpx.Client:
    return httpx.Client(transport=_transport, timeout=_PROBE_TIMEOUT)


def _msg_id(data: dict[str, object]) -> str | None:
    mid = data.get("id")
    if isinstance(mid, dict):
        serialized = mid.get("_serialized") or mid.get("id")
        return serialized if isinstance(serialized, str) else None
    if isinstance(mid, str):
        return mid
    key = data.get("key")
    if isinstance(key, dict):
        kid = key.get("id")
        return kid if isinstance(kid, str) else None
    return None


def send_to_chat(chat_id: str, text: str) -> SendResult:
    """Send free-form text to any WhatsApp chat id (person @c.us or group @g.us)."""
    cfg = get_settings()
    url = f"{_base()}/api/sendText"
    payload = {"session": cfg.openwa_session, "chatId": chat_id, "text": text}
    last_err: str | None = None
    for attempt in range(2):
        try:
            with _client() as c:
                resp = c.post(url, headers=_headers(), json=payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("openwa: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            data = resp.json() if resp.content else {}
            return SendResult(ok=True, message_id=_msg_id(data))
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


def send(phone: str, text: str) -> SendResult:
    return send_to_chat(_chat_id(phone), text)


def list_groups() -> list[Group]:
    """Groups the connected number belongs to. Empty on any error (never raises)."""
    cfg = get_settings()
    url = f"{_base()}/api/{cfg.openwa_session}/groups"
    try:
        with _client() as c:
            resp = c.get(url, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("openwa: list_groups transport error: %s", e)
        return []
    if resp.status_code // 100 != 2:
        return []
    data = resp.json() if resp.content else []
    rows = data.get("groups", data) if isinstance(data, dict) else data
    out: list[Group] = []
    for r in rows if isinstance(rows, list) else []:
        raw_id = r.get("id") or r.get("chatId") or r.get("_serialized")
        gid = raw_id.get("_serialized") if isinstance(raw_id, dict) else raw_id
        name = r.get("name") or r.get("subject") or gid
        if gid:
            out.append(Group(id=str(gid), name=str(name)))
    return out


def send_file(
    chat_id: str, *, data: bytes, filename: str, caption: str, mimetype: str = "application/pdf"
) -> SendResult:
    """Send a file to a WhatsApp chat id as a base64 attachment (WAHA sendFile)."""
    cfg = get_settings()
    url = f"{_base()}/api/sendFile"
    payload = {
        "session": cfg.openwa_session,
        "chatId": chat_id,
        "file": {
            "mimetype": mimetype,
            "filename": filename,
            "data": base64.b64encode(data).decode("ascii"),
        },
        "caption": caption,
    }
    last_err: str | None = None
    for _attempt in range(2):
        try:
            with _client() as c:
                resp = c.post(url, headers=_headers(), json=payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            continue
        if resp.status_code // 100 == 2:
            return SendResult(ok=True, message_id=_msg_id(resp.json() if resp.content else {}))
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return SendResult(ok=False, error=last_err or "network error")


def is_registered(phone: str) -> bool | None:
    """True/False if the gateway can tell us; None when unknown (endpoint error)."""
    cfg = get_settings()
    url = f"{_base()}/api/contacts/check-exists"
    try:
        with _client() as c:
            resp = c.get(
                url,
                headers=_headers(),
                params={"phone": phone.removeprefix("+"), "session": cfg.openwa_session},
            )
    except httpx.HTTPError as e:
        log.warning("openwa: is_registered transport error: %s", e)
        return None
    if resp.status_code // 100 != 2:
        return None
    data = resp.json() if resp.content else {}
    val = data.get("numberExists")
    return bool(val) if val is not None else None


def get_ack(message_id: str, chat_id: str) -> DeliveryResult:
    cfg = get_settings()
    url = f"{_base()}/api/{cfg.openwa_session}/chats/{chat_id}/messages/{message_id}"
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
            ack = data.get("ack")
            state = None if ack is None else _ACK_STATE.get(int(ack), "sent")
            return DeliveryResult(ok=True, state=state)
        return DeliveryResult(ok=False, error=f"HTTP {resp.status_code}: {resp.text}")
    return DeliveryResult(ok=False, error=last_err or "network error")


def session_state() -> str:
    """4-state session probe: disabled | unreachable | disconnected | connected.

    Returns ``"disabled"`` immediately (no HTTP) when openwa is not enabled.
    Never raises.
    """
    cfg = get_settings()
    if not cfg.openwa_enabled:
        return "disabled"
    url = f"{_base()}/api/sessions/{cfg.openwa_session}"
    try:
        with _probe_client() as c:
            resp = c.get(url, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("openwa: session_state transport error: %s", e)
        return "unreachable"
    if resp.status_code // 100 != 2:
        return "unreachable"
    data = resp.json() if resp.content else {}
    if str(data.get("status", "")).upper() in {"CONNECTED", "READY", "WORKING"}:
        return "connected"
    return "disconnected"


def logout() -> bool:
    """Unlink the current WhatsApp session on the gateway. Never raises.

    WAHA session logout (POST /api/sessions/{session}/logout) — confirm the path
    against the reconciled WAHA client / dumped OpenAPI. Returns False on any error.
    """
    cfg = get_settings()
    url = f"{_base()}/api/sessions/{cfg.openwa_session}/logout"
    try:
        with _client() as c:
            resp = c.post(url, headers=_headers())
    except httpx.HTTPError as e:
        log.warning("openwa: logout transport error: %s", e)
        return False
    return resp.status_code // 100 == 2


def fetch_qr() -> str | None:
    """Fetch the current QR code from the gateway as a data URL, or None on any error.

    Returns a ``data:image/png;base64,...`` URL built from WAHA's binary QR
    response. Never raises.
    """
    cfg = get_settings()
    url = f"{_base()}/api/{cfg.openwa_session}/auth/qr"
    try:
        with _client() as c:
            resp = c.get(url, headers={"X-API-Key": cfg.openwa_api_key, "Accept": "image/png"})
    except httpx.HTTPError as e:
        log.warning("openwa: fetch_qr transport error: %s", e)
        return None
    if resp.status_code // 100 != 2 or not resp.content:
        return None
    ctype = resp.headers.get("content-type", "image/png")
    return f"data:{ctype};base64," + base64.b64encode(resp.content).decode("ascii")


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
