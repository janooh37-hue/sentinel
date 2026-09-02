"""Serialized synchronous Playwright client for Emirates Vehicle Gate fines."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from contextlib import suppress
from typing import Any, Never
from urllib.parse import quote

os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "0")

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - exercised only by incomplete deployments
    sync_playwright = None  # type: ignore[assignment]

from app.api.errors import EvgError
from app.core.evg_fines import (
    EvgTicketDetails,
    EvgTicketRow,
    has_next_page,
    parse_ticket_details,
    parse_tickets_page,
)

_SEARCH_URL = "https://evg.ae/_layouts/EVG/finepayment0.aspx?language=en"
_DETAILS_URL = (
    "https://evg.ae/_layouts/EVG/ticketdetails.aspx?language=en&Type=Tickets&Page=0&TicketNo={}"
)
_TCF_INPUT = "#ctl00_cphScrollMenu_ctl00_ctl00_txtSearchTcfNo"
_SEARCH_BUTTON = "#ctl00_cphScrollMenu_ctl00_ctl00_btnSearchTCF"
_TICKETS_GRID = "#ctl00_cphScrollMenu_gettickets1_ctl00_gvTickets"
_POSTBACK_TARGET = "ctl00$cphScrollMenu$gettickets1$ctl00$gvTickets"
_DRIVER_MESSAGE = (
    "Playwright/Chromium not installed — run: "
    r"venv\Scripts\playwright.exe install chromium"
)
_FETCH_LOCK = threading.Lock()


def _visible_text(page: Any | None) -> str:
    if page is None:
        return ""
    try:
        text = page.evaluate("document.body ? document.body.innerText : ''")
    except Exception:
        return ""
    return str(text).strip()[:300]


def _looks_like_missing_driver(exc: Exception) -> bool:
    message = str(exc).casefold()
    return "executable doesn't exist" in message or "playwright install" in message


def _raise_evg_error(exc: Exception, page: Any | None) -> Never:
    if _looks_like_missing_driver(exc):
        raise EvgError("EVG_DRIVER_MISSING", _DRIVER_MESSAGE) from exc
    visible_text = _visible_text(page)
    raise EvgError(
        "EVG_UNAVAILABLE",
        visible_text or str(exc)[:300] or "EVG did not return the fines table",
    ) from exc


def _detail_for_ticket(
    context: Any,
    ticket: EvgTicketRow,
    *,
    timeout_ms: int,
) -> EvgTicketDetails | None:
    page: Any | None = None
    try:
        page = context.new_page()
        page.goto(
            _DETAILS_URL.format(quote(ticket.ticket_no, safe="")),
            wait_until="load",
            timeout=timeout_ms,
        )
        details = parse_ticket_details(page.content())
        if details.ticket_no != ticket.ticket_no:
            return None
        return details
    except Exception:
        return None
    finally:
        if page is not None:
            with suppress(Exception):
                page.close()


def _fetch_locked(
    tcn: str,
    *,
    details_for: Callable[[str], bool],
    timeout_s: int,
) -> list[tuple[EvgTicketRow, EvgTicketDetails | None]]:
    timeout_ms = max(1, int(timeout_s * 1000))
    browser: Any | None = None
    page: Any | None = None

    try:
        assert sync_playwright is not None
        with sync_playwright() as playwright:
            try:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(locale="en-US")
                page = context.new_page()
                page.set_default_timeout(timeout_ms)
                page.goto(_SEARCH_URL, wait_until="load", timeout=timeout_ms)
                page.fill(_TCF_INPUT, tcn)
                page.evaluate(
                    "document.getElementById("
                    "'ctl00_cphScrollMenu_ctl00_ctl00_btnSearchTCF'"
                    ").disabled = false"
                )
                page.click(_SEARCH_BUTTON)
                page.wait_for_selector(_TICKETS_GRID, timeout=60_000)
            except Exception as exc:
                _raise_evg_error(exc, page)

            tickets: list[EvgTicketRow] = []
            seen_tickets: set[str] = set()
            seen_postbacks: set[str] = set()
            while True:
                html = page.content()
                for ticket in parse_tickets_page(html):
                    if ticket.ticket_no not in seen_tickets:
                        tickets.append(ticket)
                        seen_tickets.add(ticket.ticket_no)

                next_page = has_next_page(html)
                if next_page is None or next_page in seen_postbacks:
                    break
                seen_postbacks.add(next_page)
                try:
                    with page.expect_navigation(wait_until="load", timeout=60_000):
                        page.evaluate(
                            f"pageArgument => __doPostBack('{_POSTBACK_TARGET}', pageArgument)",
                            next_page,
                        )
                    page.wait_for_selector(_TICKETS_GRID, timeout=60_000)
                except Exception as exc:
                    _raise_evg_error(exc, page)

            results: list[tuple[EvgTicketRow, EvgTicketDetails | None]] = []
            for ticket in tickets:
                details = None
                if details_for(ticket.ticket_no):
                    details = _detail_for_ticket(
                        context,
                        ticket,
                        timeout_ms=timeout_ms,
                    )
                results.append((ticket, details))
            return results
    except EvgError:
        raise
    except Exception as exc:
        if _looks_like_missing_driver(exc):
            raise EvgError("EVG_DRIVER_MISSING", _DRIVER_MESSAGE) from exc
        visible_text = _visible_text(page)
        raise EvgError(
            "EVG_UNAVAILABLE",
            visible_text or str(exc)[:300] or "EVG did not return the fines table",
        ) from exc
    finally:
        if browser is not None:
            with suppress(Exception):
                browser.close()


def fetch_tickets(
    tcn: str,
    *,
    details_for: Callable[[str], bool],
    timeout_s: int = 120,
) -> list[tuple[EvgTicketRow, EvgTicketDetails | None]]:
    """Fetch every EVG ticket page and best-effort details for selected rows."""

    if sync_playwright is None:
        raise EvgError("EVG_DRIVER_MISSING", _DRIVER_MESSAGE)
    with _FETCH_LOCK:
        return _fetch_locked(tcn, details_for=details_for, timeout_s=timeout_s)
