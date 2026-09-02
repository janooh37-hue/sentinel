"""Send account-mail (verify / reset) links via Microsoft Graph ``sendMail``.

The only module that knows the Graph HTTP shape. Auth is client-credentials
(app-only, no ``msal`` dependency — ``mng deploy`` doesn't run ``pip
install``, so a new package needs a manual production step; ``httpx`` is
already the project's HTTP client, see ``sms_client.py``). The access token is
cached at module scope and refreshed a minute before expiry.

Never log the recipient, token, URL, message body, bearer token, or client
secret — only the Graph status code and its ``request-id`` header, which is
what support needs to correlate with Microsoft's side without leaking PII.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx

from app.config import get_settings
from app.services import account_mail_templates

log = logging.getLogger(__name__)

_TOKEN_TIMEOUT = httpx.Timeout(15.0)
_SEND_TIMEOUT = httpx.Timeout(20.0)
# Overridable in tests via monkeypatch (httpx.MockTransport).
_transport: httpx.BaseTransport | None = None

_token_lock = threading.Lock()
_cached_token: str | None = None
_cached_expires_monotonic: float = 0.0


class AccountMailError(RuntimeError):
    """Raised when Graph rejects the token request or the send."""

    def __init__(self, status: int | None, request_id: str | None) -> None:
        super().__init__(f"account mail: graph error status={status} request_id={request_id}")
        self.status = status
        self.request_id = request_id


def _access_token() -> str:
    global _cached_token, _cached_expires_monotonic
    with _token_lock:
        if _cached_token is not None and _cached_expires_monotonic - time.monotonic() > 60:
            return _cached_token
        cfg = get_settings()
        with httpx.Client(transport=_transport, timeout=_TOKEN_TIMEOUT) as client:
            resp = client.post(
                f"https://login.microsoftonline.com/{cfg.microsoft_tenant_id}/oauth2/v2.0/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": cfg.microsoft_client_id,
                    "client_secret": cfg.microsoft_client_secret,
                    "scope": "https://graph.microsoft.com/.default",
                },
            )
        if resp.status_code != 200:
            raise AccountMailError(resp.status_code, resp.headers.get("x-ms-request-id"))
        data = resp.json()
        _cached_token = str(data["access_token"])
        _cached_expires_monotonic = time.monotonic() + float(data.get("expires_in", 3600))
        return _cached_token


def _drop_cached_token() -> None:
    global _cached_token, _cached_expires_monotonic
    with _token_lock:
        _cached_token = None
        _cached_expires_monotonic = 0.0


def _post_send(token: str, recipient: str, subject: str, html: str) -> httpx.Response:
    cfg = get_settings()
    with httpx.Client(transport=_transport, timeout=_SEND_TIMEOUT) as client:
        return client.post(
            f"https://graph.microsoft.com/v1.0/users/{cfg.account_mail_sender}/sendMail",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "message": {
                    "subject": subject,
                    "body": {"contentType": "HTML", "content": html},
                    "toRecipients": [{"emailAddress": {"address": recipient}}],
                },
                "saveToSentItems": True,
            },
        )


def _send(recipient: str, subject: str, html: str) -> None:
    token = _access_token()
    resp = _post_send(token, recipient, subject, html)
    if resp.status_code == 401:
        # Cached token may have been revoked/expired early — refresh once and retry.
        _drop_cached_token()
        token = _access_token()
        resp = _post_send(token, recipient, subject, html)
    if resp.status_code != 202:
        request_id = resp.headers.get("request-id")
        log.warning(
            "account mail: graph rejected send status=%s request_id=%s",
            resp.status_code,
            request_id,
        )
        raise AccountMailError(resp.status_code, request_id)


def _link_url(path: str, raw_token: str) -> str:
    base = get_settings().account_mail_link_base_url.rstrip("/")
    return f"{base}{path}?token={raw_token}"


def send_verification_email(*, recipient: str, raw_token: str, locale: str) -> None:
    url = _link_url("/verify-email", raw_token)
    subject, html = account_mail_templates.render_verification(url, locale)
    _send(recipient, subject, html)


def send_password_reset_email(*, recipient: str, raw_token: str, locale: str) -> None:
    url = _link_url("/reset-password", raw_token)
    subject, html = account_mail_templates.render_password_reset(url, locale)
    _send(recipient, subject, html)


__all__ = ["AccountMailError", "send_password_reset_email", "send_verification_email"]
