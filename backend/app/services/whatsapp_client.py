"""Thin transport to the Infobip WhatsApp API.

The ONLY module that knows the provider's HTTP shape. Sends a pre-registered
*template* message (business-initiated messages must use templates). One retry
on network/timeout; API errors are mapped to a ``SendResult`` so callers never
see a raw exception.

Infobip contract (verified against the Infobip OpenAPI spec):
  POST {api_base}/whatsapp/1/message/template
  Authorization: App {api_key}
  body: {"messages":[{"from": sender, "to": msisdn,
         "content": {"templateName": ..., "language": "en"|"ar",
                     "templateData": {"body": {"placeholders": [...]}}}}]}
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


def _post(url: str, headers: dict, payload: dict) -> httpx.Response:
    with httpx.Client(transport=_transport, timeout=_TIMEOUT) as client:
        return client.post(url, headers=headers, json=payload)


def send_text(phone: str, template_name: str, lang: str, params: list[str]) -> SendResult:
    cfg = get_settings()
    url = f"{cfg.whatsapp_api_base}/whatsapp/1/message/template"
    headers = {
        "Authorization": f"App {cfg.whatsapp_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "messages": [
            {
                "from": cfg.whatsapp_sender,
                "to": phone.removeprefix("+"),
                "content": {
                    "templateName": template_name,
                    "language": "ar" if lang == "ar" else "en",
                    "templateData": {"body": {"placeholders": params}},
                },
            }
        ]
    }

    last_err: str | None = None
    for attempt in range(2):  # initial + one retry on transport error
        try:
            resp = _post(url, headers, payload)
        except httpx.HTTPError as e:
            last_err = str(e) or e.__class__.__name__
            log.warning("whatsapp: transport error (attempt %d): %s", attempt + 1, last_err)
            continue
        if resp.status_code // 100 == 2:
            data = resp.json()
            msg_id = (data.get("messages") or [{}])[0].get("messageId")
            return SendResult(ok=True, message_id=msg_id)
        # Non-2xx: extract Infobip's error text, do not retry (it's a real reject).
        try:
            svc = resp.json().get("requestError", {}).get("serviceException", {})
            err = svc.get("text") or resp.text
        except ValueError:
            err = resp.text
        return SendResult(ok=False, error=f"HTTP {resp.status_code}: {err}")
    return SendResult(ok=False, error=last_err or "network error")
