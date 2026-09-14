"""Fetch EVG Quick Search tickets from its public JSON endpoint.

EVG's relaunched application serves Quick Search through this endpoint, so the previous
headless-browser scrape was retired along with its obsolete HTML and paging machinery.
"""

from __future__ import annotations

import time
from urllib.parse import quote

import httpx

from app.api.errors import EvgError
from app.core.evg_fines import EvgTicketRow, parse_tickets_payload

_TICKETS_URL = "https://evg.ae/PortalApi/api/UTSTickets/{}"
_transport: httpx.BaseTransport | None = None  # overridable in tests
_MAX_UPSTREAM_MESSAGE_LENGTH = 200
# EVG sits behind a bot-defence edge that stalls a burst of requests instead of
# answering them, and a preview fetches one traffic code after another. A single
# short-backoff retry absorbs that throttle; anything more would queue the
# operator behind an outage.
_RETRY_BACKOFF_S = 3.0


def _sanitize_message(value: object) -> str:
    if not isinstance(value, str):
        return ""
    without_markup = "".join(
        " " if not character.isprintable() else character
        for character in value
        if character not in "<>"
    )
    return " ".join(without_markup.split())[:_MAX_UPSTREAM_MESSAGE_LENGTH].strip()


def _get(url: str, *, timeout_s: float) -> httpx.Response:
    """GET ``url`` once, retrying a stalled or refused connection a single time."""

    for attempt in (0, 1):
        try:
            with httpx.Client(
                transport=_transport,
                timeout=timeout_s,
                follow_redirects=False,
            ) as client:
                return client.get(url, headers={"accept": "application/json"})
        except httpx.TimeoutException as exc:
            if attempt == 0:
                time.sleep(_RETRY_BACKOFF_S)
                continue
            raise EvgError("EVG_UNAVAILABLE", "EVG request timed out") from exc
        except httpx.TransportError as exc:
            if attempt == 0:
                time.sleep(_RETRY_BACKOFF_S)
                continue
            raise EvgError("EVG_UNAVAILABLE", "Could not reach EVG") from exc
    raise AssertionError("unreachable")  # pragma: no cover


def fetch_tickets(tcn: str, *, timeout_s: float = 30.0) -> list[EvgTicketRow]:
    """Fetch and normalize every ticket returned for one traffic code."""

    response = _get(_TICKETS_URL.format(quote(tcn, safe="")), timeout_s=timeout_s)

    if response.status_code != 200:
        raise EvgError(
            "EVG_UNAVAILABLE",
            f"EVG returned HTTP status {response.status_code}",
        )

    try:
        payload: object = response.json()
    except (UnicodeDecodeError, ValueError) as exc:
        raise EvgError("EVG_UNAVAILABLE", "EVG returned an invalid JSON response") from exc

    if isinstance(payload, dict) and payload.get("OperationSucceded") is False:
        upstream_message = _sanitize_message(payload.get("ResponseCodeMessage"))
        message = upstream_message or "EVG reported an unsuccessful operation"
        raise EvgError("EVG_UNAVAILABLE", message)

    try:
        return parse_tickets_payload(payload)
    except ValueError as exc:
        raise EvgError("EVG_UNAVAILABLE", "EVG returned an unusable ticket payload") from exc
