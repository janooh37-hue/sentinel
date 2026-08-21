"""Read-only discovery probe for an installed ZKTeco BioTime instance.

Why this exists
---------------
`app/services/attendance_provider.py` defines the vendor-neutral provider
contract, and `scheduler_service._resolve_verified_attendance_provider()`
returns ``None`` on purpose: no BioTime adapter may be written from a guessed
endpoint, token type, field name, pagination rule, or time-filter semantic.
The design document names twelve facts that must be recorded first
(``docs/superpowers/specs/2026-08-17-workforce-attendance-dashboard-design.md``
section "Installed BioTime discovery prerequisite").

This script collects those facts from the real installed build. It only ever
issues the auth POST and ``GET`` reads, never a write, and it redacts personal
data before printing or persisting anything.

It also answers the operational question that decides how much data Sentinel
has to move: **which request filters does this build actually honour?** A filter
parameter an installed build silently ignores fails *open* — the response still
contains every site. The probe proves honoured/ignored/rejected empirically by
comparing the unfiltered and filtered ``count`` rather than trusting a manual.

Usage
-----
    # password is read from BIOTIME_PROBE_PASSWORD or prompted; never on argv
    python backend/scripts/biotime_probe.py \
        --base-url https://biotime.internal:8098 \
        --username sentinel_readonly

    # once the inventory shows your site's identifiers, measure filter efficacy
    python backend/scripts/biotime_probe.py \
        --base-url https://biotime.internal:8098 \
        --username sentinel_readonly \
        --site-value 3 --site-value "Head Office" \
        --out backend/data/biotime_probe.json

Attach the resulting sanitized JSON to the adapter work. Nothing in ``app/``
imports this module.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - operator environment guard
    sys.exit("httpx is required: pip install -r requirements.txt")

# The application resolves its env file as ``PROJECT_ROOT / ".env"`` where
# PROJECT_ROOT is ``backend/app/config.py``'s ``parents[2]`` — the repository
# root, NOT ``backend/``. The probe reads the same file so an operator has
# exactly one place to put these values.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_env_file(path: Path) -> dict[str, str]:
    """Parse a minimal KEY=VALUE env file; unquote, ignore comments and blanks."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _warn_about_stray_env_files(selected: Path) -> None:
    """Fail loudly on an env file the application will never read.

    ``backend/.env`` is a natural place to put these values and is silently
    ignored by ``app/config.py``. Silence there would surface much later as a
    provider that mysteriously stays unconfigured.
    """
    for candidate in (_PROJECT_ROOT / "backend" / ".env",):
        if candidate.is_file() and candidate.resolve() != selected.resolve():
            print(
                f"warning: {candidate} exists but the application reads "
                f"{_PROJECT_ROOT / '.env'} — move it or the adapter will not see these values",
                file=sys.stderr,
            )


# Candidate auth endpoints. BioTime historically exposes a DRF token endpoint
# and a JWT endpoint; which one an installed build enables is a fact to record,
# not to assume. The header scheme differs per endpoint.
_AUTH_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("/jwt-api-token-auth/", "JWT"),
    ("/api-token-auth/", "Token"),
)

# Candidate resource paths. Both singular and plural spellings are probed: on
# this installation a restricted account reaches `/personnel/api/department/`
# while `/personnel/api/departments/` returns 403, so the two spellings are
# governed by different permission nodes and must be measured separately.
_ENDPOINT_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("people", "/personnel/api/employees/"),
    ("people_singular", "/personnel/api/employee/"),
    ("departments", "/personnel/api/departments/"),
    ("departments_singular", "/personnel/api/department/"),
    ("areas", "/personnel/api/areas/"),
    ("areas_singular", "/personnel/api/area/"),
    ("positions", "/personnel/api/positions/"),
    ("positions_singular", "/personnel/api/position/"),
    ("transactions", "/iclock/api/transactions/"),
    ("transactions_singular", "/iclock/api/transaction/"),
    ("terminals", "/iclock/api/terminals/"),
    ("terminals_singular", "/iclock/api/terminal/"),
    ("devices", "/iclock/api/devices/"),
)

# Self-describing surfaces. A router root enumerates this build's real routes;
# a user/permission endpoint reports what the presented token may reach. Both
# beat guessing which permission node gates a 403.
_API_ROOT_CANDIDATES: tuple[str, ...] = (
    "/api/",
    "/api/docs/",
    "/personnel/api/",
    "/iclock/api/",
    "/att/api/",
    "/base/api/",
    "/base/api/user/",
    "/base/api/roles/",
    "/base/api/permissions/",
    "/personnel/api/api_permission/",
)

# Filter parameter names to test on each stream, applied with the operator's
# site value. Alias spellings are tested because the honoured name differs
# between builds and must be measured.
_PEOPLE_FILTER_CANDIDATES: tuple[str, ...] = (
    "area",
    "area_id",
    "area_name",
    "department",
    "department_id",
    "department_name",
    "company",
)
_PUNCH_FILTER_CANDIDATES: tuple[str, ...] = (
    "area",
    "area_id",
    "area_alias",
    "department",
    "department_id",
    "terminal",
    "terminal_id",
    "terminal_sn",
    "terminal_alias",
)

# Envelope keys a DRF-style list response may use for its item array.
_ITEM_KEYS: tuple[str, ...] = ("data", "results", "items")

# Any value under a key matching this pattern is masked before it leaves the
# process. Device/area/department names are organizational metadata and are
# deliberately preserved: the operator needs them to choose a site scope.
_PII_KEY = re.compile(
    r"name|nick|email|mobile|phone|photo|card|passport|national|address|birth"
    r"|gender|religion|ssn|emp_?code|pin|self_?password|contact|remark|verify",
    re.IGNORECASE,
)
_ORG_KEY_ALLOWLIST = frozenset(
    {"area_name", "dept_name", "department_name", "company_name", "terminal_alias", "position_name"}
)


def _mask(value: Any) -> Any:
    """Preserve a value's shape for contract analysis without leaking content."""
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        if not value:
            return ""
        # Keep the character classes so a code format like "G-1042" stays legible
        # as "A-9999" while the identity itself does not survive.
        return re.sub(r"\d", "9", re.sub(r"[^\W\d_]", "A", value, flags=re.UNICODE))
    if isinstance(value, list):
        return [_mask(item) for item in value[:2]]
    if isinstance(value, dict):
        return {key: _mask(item) for key, item in list(value.items())[:8]}
    return f"<{type(value).__name__}>"


def _sanitize_record(record: Any) -> dict[str, Any]:
    """Describe one provider record as field name -> {type, sample}."""
    if not isinstance(record, dict):
        return {"<non-object>": {"type": type(record).__name__, "sample": _mask(record)}}
    described: dict[str, Any] = {}
    for key, value in record.items():
        keep_plain = key in _ORG_KEY_ALLOWLIST or not _PII_KEY.search(key)
        described[key] = {
            "type": type(value).__name__,
            "sample": value if keep_plain and not isinstance(value, dict | list) else _mask(value),
            "masked": not keep_plain,
        }
    return described


def _items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in _ITEM_KEYS:
            value = payload.get(key)
            if isinstance(value, list):
                return value
    return []


def _count(payload: Any) -> int | None:
    if isinstance(payload, dict):
        for key in ("count", "total", "totalCount"):
            value = payload.get(key)
            if isinstance(value, int):
                return value
    items = _items(payload)
    return len(items) if items else None


def _response_detail(response: httpx.Response, payload: Any) -> str | None:
    """Extract a bounded framework message explaining a non-2xx response.

    DRF and BioTime both answer failures with a short machine-authored string
    ("You do not have permission to perform this action."). That text names the
    exact remediation, contains no personal data, and is the difference between
    a useful report and a wall of bare ``403``s.
    """
    if 200 <= response.status_code < 300 and isinstance(payload, dict):
        message = payload.get("msg")
        return str(message)[:300] if isinstance(message, str) and message else None
    if isinstance(payload, dict):
        for key in ("detail", "msg", "message", "error", "non_field_errors"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value[:300]
            if isinstance(value, list) and value and isinstance(value[0], str):
                return value[0][:300]
        return f"<json object keys: {sorted(payload)[:8]}>"
    if payload is not None:
        return f"<json {type(payload).__name__}, {len(payload) if isinstance(payload, list) else '?'} items>"
    text = (response.text or "").strip()
    return " ".join(text.split())[:300] or None


@dataclass
class Call:
    """One recorded read, kept so the report shows exactly what was asked."""

    path: str
    params: dict[str, Any]
    status: int | None
    error: str | None = None
    count: int | None = None
    returned: int | None = None
    envelope_keys: list[str] = field(default_factory=list)
    # A bare status code cannot distinguish "no permission for this endpoint"
    # from "wrong auth header for this endpoint"; the framework detail string
    # can, and carries no personal data.
    detail: str | None = None
    content_type: str | None = None
    payload_kind: str | None = None


def _roll_up_param_verdicts(
    results: list[dict[str, Any]], baseline: int | None
) -> dict[str, dict[str, Any]]:
    """Judge each parameter across its whole value sweep, not value by value.

    A single observation cannot separate "the server ignored this parameter"
    from "the server honoured it and every row matched" — both return the
    baseline count. That distinction matters enormously when the account is
    already scoped server-side, because then a working filter legitimately
    changes nothing.

    Sweeping several values resolves it. A parameter that returns the baseline
    even for a value that cannot possibly match (a terminal serial passed as an
    area, say) is being discarded by the server and fails open. A parameter that
    returns zero for wrong values and the baseline for the right one is working.
    """
    per_param: dict[str, dict[str, Any]] = {}
    for row in results:
        bucket = per_param.setdefault(
            row["param"], {"observations": [], "verdict": "indeterminate"}
        )
        bucket["observations"].append(
            {"value": row["value"], "status": row["status"], "count": row["filtered_count"]}
        )

    for param, bucket in per_param.items():
        observations = bucket["observations"]
        statuses = {obs["status"] for obs in observations}
        counts = [obs["count"] for obs in observations if obs["status"] == 200]
        rejected = sum(1 for obs in observations if (obs["status"] or 0) >= 400)

        if not counts:
            bucket["verdict"] = "rejected" if rejected else "unreachable"
        elif baseline is None:
            bucket["verdict"] = "indeterminate_no_baseline"
        elif all(count == baseline for count in counts):
            # Even a deliberately wrong value returned everything.
            bucket["verdict"] = "IGNORED_FAILS_OPEN"
        elif any(count == 0 for count in counts):
            bucket["verdict"] = "honoured"
        else:
            bucket["verdict"] = "honoured_partial"
        bucket["rejected_values"] = rejected
        bucket["distinct_statuses"] = sorted(s for s in statuses if s is not None)
        bucket["matching_values"] = [
            obs["value"] for obs in observations if obs["status"] == 200 and obs["count"]
        ]
    return per_param


class Probe:
    """Bounded, read-only interrogation of one BioTime base URL."""

    def __init__(
        self,
        *,
        base_url: str,
        verify: bool | str,
        timeout: float,
        max_requests: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(
            base_url=self.base_url,
            verify=verify,
            timeout=timeout,
            follow_redirects=False,
            headers={"Accept": "application/json"},
        )
        self.max_requests = max_requests
        self.requests_made = 0
        self.calls: list[Call] = []
        self.auth_header: dict[str, str] = {}
        self.auth_scheme: str | None = None
        self.auth_path: str | None = None

    def close(self) -> None:
        self.client.close()

    # -- transport ---------------------------------------------------------

    def get(self, path: str, params: dict[str, Any] | None = None) -> tuple[Call, Any]:
        params = params or {}
        if self.requests_made >= self.max_requests:
            call = Call(path=path, params=params, status=None, error="request budget exhausted")
            self.calls.append(call)
            return call, None
        self.requests_made += 1
        try:
            response = self.client.get(path, params=params, headers=self.auth_header)
        except httpx.HTTPError as exc:
            call = Call(path=path, params=params, status=None, error=type(exc).__name__)
            self.calls.append(call)
            return call, None
        payload: Any = None
        content_type = response.headers.get("content-type", "")
        if "json" in content_type:
            try:
                payload = response.json()
            except ValueError:
                payload = None
        call = Call(
            path=path,
            params=params,
            status=response.status_code,
            count=_count(payload),
            returned=len(_items(payload)) or None,
            envelope_keys=sorted(payload)[:12] if isinstance(payload, dict) else [],
            detail=_response_detail(response, payload),
            content_type=content_type.split(";")[0] or None,
            payload_kind=type(payload).__name__ if payload is not None else "none",
        )
        self.calls.append(call)
        return call, payload

    # -- fact 2, 3: auth ---------------------------------------------------

    def discover_auth(self, username: str, password: str) -> dict[str, Any]:
        attempts: list[dict[str, Any]] = []
        for path, scheme in _AUTH_CANDIDATES:
            self.requests_made += 1
            try:
                response = self.client.post(path, json={"username": username, "password": password})
            except httpx.HTTPError as exc:
                attempts.append({"path": path, "scheme": scheme, "status": None, "error": type(exc).__name__})
                continue
            token: str | None = None
            token_field: str | None = None
            if response.status_code == 200 and "json" in response.headers.get("content-type", ""):
                try:
                    body = response.json()
                except ValueError:
                    body = {}
                for candidate in ("token", "access", "access_token", "jwt"):
                    value = body.get(candidate) if isinstance(body, dict) else None
                    if isinstance(value, str) and value:
                        token, token_field = value, candidate
                        break
            attempts.append(
                {
                    "path": path,
                    "scheme": scheme,
                    "status": response.status_code,
                    "token_field": token_field,
                    "usable": token is not None,
                }
            )
            if token is not None and self.auth_scheme is None:
                self.auth_scheme = scheme
                self.auth_path = path
                self.auth_header = {"Authorization": f"{scheme} {token}"}
        return {"attempts": attempts, "selected": {"path": self.auth_path, "scheme": self.auth_scheme}}

    # -- facts 5, 6, 8: endpoints, envelope, fields ------------------------

    def discover_endpoints(self) -> dict[str, Any]:
        found: dict[str, Any] = {}
        for label, path in _ENDPOINT_CANDIDATES:
            call, payload = self.get(path, {"page_size": 1})
            entry: dict[str, Any] = {
                "path": path,
                "status": call.status,
                "error": call.error,
                "detail": call.detail,
                "content_type": call.content_type,
                "payload_kind": call.payload_kind,
                "returned": call.returned,
            }
            # This build answers "no permission, or no such page" with HTTP 200
            # and an HTML body. A status code alone therefore proves nothing:
            # an endpoint is only usable if it returned a JSON document.
            entry["soft_404"] = call.status == 200 and call.payload_kind == "none"
            entry["usable"] = call.status == 200 and call.payload_kind in {"dict", "list"}
            if entry["soft_404"]:
                entry["detail"] = "HTTP 200 with HTML body — no permission, or the path does not exist"
            if entry["usable"]:
                entry["envelope_keys"] = call.envelope_keys
                entry["count"] = call.count
                items = _items(payload)
                entry["fields"] = _sanitize_record(items[0]) if items else {}
                if isinstance(payload, dict):
                    next_link = payload.get("next")
                    entry["pagination"] = {
                        "style": "drf-page" if "next" in payload else "unknown",
                        "next_is_absolute_url": isinstance(next_link, str) and next_link.startswith("http"),
                    }
            found[label] = entry
        return found

    def discover_api_roots(self) -> dict[str, Any]:
        """Ask the build to describe its own routes and the token's permissions.

        Guessing which permission node governs an endpoint is unproductive when
        the server can be asked. A DRF router root enumerates the real route
        names, and a self-describing user endpoint reports what the presented
        token is actually allowed to do — which is the difference between
        "grant something and re-probe" and knowing what to grant.
        """
        found: dict[str, Any] = {}
        for path in _API_ROOT_CANDIDATES:
            call, payload = self.get(path)
            entry: dict[str, Any] = {
                "status": call.status,
                "content_type": call.content_type,
                "payload_kind": call.payload_kind,
                "error": call.error,
            }
            if isinstance(payload, dict):
                # A DRF router root is {route_name: absolute_url}; keep it whole,
                # it is the authoritative route list for this build.
                entry["keys"] = sorted(payload)[:60]
                entry["routes"] = {
                    key: value
                    for key, value in list(payload.items())[:60]
                    if isinstance(value, str)
                }
            elif isinstance(payload, list):
                entry["list_length"] = len(payload)
                entry["first_item_keys"] = (
                    sorted(payload[0])[:30] if payload and isinstance(payload[0], dict) else None
                )
            else:
                entry["snippet"] = call.detail
            found[path] = entry
        return found

    # -- site inventory: what identifiers exist to scope by -----------------

    def inventory(self, path: str, *, limit_pages: int = 4) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page = 1
        while page <= limit_pages:
            _, payload = self.get(path, {"page": page, "page_size": 100})
            items = _items(payload)
            if not items:
                break
            for item in items:
                if not isinstance(item, dict):
                    continue
                rows.append(
                    {
                        key: item.get(key)
                        for key in ("id", "area_code", "area_name", "dept_code", "dept_name", "sn", "alias", "ip_address", "state")
                        if key in item
                    }
                )
            if not (isinstance(payload, dict) and payload.get("next")):
                break
            page += 1
        return rows

    # -- the operational question: is a filter honoured? -------------------

    def filter_efficacy(
        self,
        *,
        path: str,
        candidates: tuple[str, ...],
        site_values: list[str],
        baseline_params: dict[str, Any],
    ) -> dict[str, Any]:
        base_call, _ = self.get(path, {**baseline_params, "page_size": 1})
        baseline = base_call.count
        results: list[dict[str, Any]] = []
        for param in candidates:
            for value in site_values:
                call, _ = self.get(path, {**baseline_params, "page_size": 1, param: value})
                if call.status is None:
                    verdict = "unreachable"
                elif call.status >= 500:
                    verdict = "server_error"
                elif call.status >= 400:
                    verdict = "rejected"
                elif baseline is None or call.count is None:
                    verdict = "indeterminate_no_count"
                elif call.count == 0:
                    verdict = "honoured_empty"
                elif call.count < baseline:
                    verdict = "honoured"
                else:
                    verdict = "IGNORED_FAILS_OPEN"
                results.append(
                    {
                        "param": param,
                        "value": value,
                        "status": call.status,
                        "baseline_count": baseline,
                        "filtered_count": call.count,
                        "verdict": verdict,
                    }
                )
        return {
            "path": path,
            "baseline_count": baseline,
            "results": results,
            "per_param": _roll_up_param_verdicts(results, baseline),
        }

    # -- facts 8, 9, 11: time filter, ordering, page ceiling ---------------

    def probe_transaction_semantics(self, path: str, *, days: int) -> dict[str, Any]:
        now = datetime.now(UTC)
        since = now - timedelta(days=days)
        fmt = "%Y-%m-%d %H:%M:%S"
        window = {"start_time": since.strftime(fmt), "end_time": now.strftime(fmt)}

        unfiltered, _ = self.get(path, {"page_size": 1})
        windowed, payload = self.get(path, {**window, "page_size": 5})
        ceiling, _ = self.get(path, {"page_size": 1000})

        timestamps: list[str] = []
        punch_state_values: list[Any] = []
        for item in _items(payload)[:5]:
            if not isinstance(item, dict):
                continue
            for key in ("punch_time", "upload_time", "event_time", "time"):
                value = item.get(key)
                if isinstance(value, str):
                    timestamps.append(f"{key}={value}")
            for key in ("punch_state", "punch_state_display", "verify_type", "verify_type_display"):
                if key in item:
                    punch_state_values.append({key: item[key]})

        census = self._vocabulary_census(path, window)
        ordering = self._ordering_behaviour(path, window)

        return {
            "window_params": window,
            "unfiltered_count": unfiltered.count,
            "windowed_count": windowed.count,
            "window_status": windowed.status,
            "time_filter_effective": (
                None
                if unfiltered.count is None or windowed.count is None
                else windowed.count < unfiltered.count
            ),
            "max_page_size_requested": 1000,
            "max_page_size_returned": ceiling.returned,
            "timestamp_samples": timestamps,
            "timestamp_carries_offset": any(("+" in t[-6:] or t.endswith("Z")) for t in timestamps),
            "direction_vocabulary_samples": punch_state_values,
            "vocabulary_census": census,
            "ordering": ordering,
        }

    def _vocabulary_census(self, path: str, window: dict[str, str]) -> dict[str, Any]:
        """Count every distinct direction/verify value over a whole page.

        Five sampled rows cannot prove that a build never reports a usable
        direction. If `punch_state` is uniformly "unknown" across a full page,
        the evaluator must allocate punches by time alone and must never infer
        a check-in/check-out pair from the vendor's direction field.
        """
        _, payload = self.get(path, {**window, "page_size": 1000})
        rows = _items(payload)
        census: dict[str, dict[str, int]] = {}
        earliest: str | None = None
        latest: str | None = None
        for item in rows:
            if not isinstance(item, dict):
                continue
            for key in ("punch_state", "punch_state_display", "verify_type_display", "work_code"):
                value = item.get(key)
                if value is not None:
                    bucket = census.setdefault(key, {})
                    token = str(value)
                    bucket[token] = bucket.get(token, 0) + 1
            stamp = item.get("punch_time")
            if isinstance(stamp, str):
                earliest = stamp if earliest is None or stamp < earliest else earliest
                latest = stamp if latest is None or stamp > latest else latest
        return {
            "rows_examined": len(rows),
            "distinct_values": census,
            "punch_time_min": earliest,
            "punch_time_max": latest,
        }

    def _ordering_behaviour(self, path: str, window: dict[str, str]) -> dict[str, Any]:
        """Determine default row order and whether an explicit ordering is honoured.

        The importer replays a frozen window and hashes normalized rows to prove
        immutability; unstable ordering would make that replay look like drift.
        """
        _, default_payload = self.get(path, {**window, "page_size": 20})
        _, ordered_payload = self.get(path, {**window, "page_size": 20, "ordering": "punch_time"})

        def _stamps(payload: Any) -> list[str]:
            return [
                item["punch_time"]
                for item in _items(payload)
                if isinstance(item, dict) and isinstance(item.get("punch_time"), str)
            ]

        default_stamps = _stamps(default_payload)
        ordered_stamps = _stamps(ordered_payload)
        return {
            "default_is_ascending": default_stamps == sorted(default_stamps) if default_stamps else None,
            "default_is_descending": (
                default_stamps == sorted(default_stamps, reverse=True) if default_stamps else None
            ),
            "ordering_param_changed_result": (
                None if not default_stamps or not ordered_stamps else default_stamps != ordered_stamps
            ),
            "ordering_param_ascending": (
                ordered_stamps == sorted(ordered_stamps) if ordered_stamps else None
            ),
            "default_first": default_stamps[0] if default_stamps else None,
            "default_last": default_stamps[-1] if default_stamps else None,
        }


def _build_report(probe: Probe, args: argparse.Namespace, auth: dict[str, Any]) -> dict[str, Any]:
    endpoints = probe.discover_endpoints()
    reachable = {label: entry for label, entry in endpoints.items() if entry.get("usable")}

    def _path_for(*labels: str) -> str | None:
        for label in labels:
            entry = reachable.get(label)
            if entry:
                return str(entry["path"])
        return None

    people_path = _path_for("people")
    punch_path = _path_for("transactions")
    area_path = _path_for("areas", "areas_singular")
    dept_path = _path_for("departments", "departments_singular")
    terminal_path = _path_for("terminals", "devices")

    report: dict[str, Any] = {
        "probed_at": datetime.now(UTC).isoformat(),
        "base_url": probe.base_url,
        "tls_verify": args.ca_bundle or (not args.insecure),
        "authentication": auth,
        "endpoints": endpoints,
        "api_roots": probe.discover_api_roots(),
        "site_inventory": {},
        "filter_efficacy": {},
        "transaction_semantics": None,
        "requests_made": 0,
    }

    if area_path:
        report["site_inventory"]["areas"] = probe.inventory(area_path)
    if dept_path:
        report["site_inventory"]["departments"] = probe.inventory(dept_path)
    if terminal_path:
        report["site_inventory"]["terminals"] = probe.inventory(terminal_path)

    if args.site_value:
        if people_path:
            report["filter_efficacy"]["people"] = probe.filter_efficacy(
                path=people_path,
                candidates=_PEOPLE_FILTER_CANDIDATES,
                site_values=args.site_value,
                baseline_params={},
            )
        if punch_path:
            now = datetime.now(UTC)
            since = now - timedelta(days=args.window_days)
            fmt = "%Y-%m-%d %H:%M:%S"
            report["filter_efficacy"]["punches"] = probe.filter_efficacy(
                path=punch_path,
                candidates=_PUNCH_FILTER_CANDIDATES,
                site_values=args.site_value,
                baseline_params={
                    "start_time": since.strftime(fmt),
                    "end_time": now.strftime(fmt),
                },
            )

    if punch_path:
        report["transaction_semantics"] = probe.probe_transaction_semantics(
            punch_path, days=args.window_days
        )

    report["requests_made"] = probe.requests_made
    report["calls"] = [
        {
            "path": call.path,
            "params": {k: v for k, v in call.params.items()},
            "status": call.status,
            "error": call.error,
            "count": call.count,
        }
        for call in probe.calls
    ]
    return report


def _print_summary(report: dict[str, Any]) -> None:
    out = sys.stdout.write
    out(f"\nBioTime probe — {report['base_url']}\n")
    selected = report["authentication"]["selected"]
    out(f"  auth: {selected['scheme'] or 'NONE WORKED'} via {selected['path'] or '-'}\n")

    out("  endpoints:\n")
    for entry in report["endpoints"].values():
        marker = "ok " if entry.get("usable") else ("!! " if entry.get("soft_404") else "-- ")
        detail = entry.get("detail")
        suffix = f"  {detail}" if detail else ""
        out(f"    {marker}{entry['path']:<34} {entry.get('status')}{suffix}\n")

    roots = report.get("api_roots") or {}
    described = {
        path: entry
        for path, entry in roots.items()
        if entry.get("routes") or entry.get("first_item_keys") or entry.get("list_length")
    }
    if described:
        out("  self-described routes:\n")
        for path, entry in described.items():
            out(f"    {path} ({entry.get('status')}):\n")
            for name, url in (entry.get("routes") or {}).items():
                out(f"      {name:28} {url}\n")
            if entry.get("list_length") is not None:
                out(f"      list of {entry['list_length']}, item keys={entry.get('first_item_keys')}\n")
    else:
        reachable_roots = [p for p, e in roots.items() if e.get("status") == 200]
        out(f"  self-described routes: none readable (probed {len(roots)}, 200s: {reachable_roots})\n")
    for label, rows in report["site_inventory"].items():
        out(f"  {label} ({len(rows)}):\n")
        for row in rows[:20]:
            out(f"    {row}\n")
        if len(rows) > 20:
            out(f"    ... {len(rows) - 20} more\n")

    for stream, block in report["filter_efficacy"].items():
        out(f"  filter efficacy — {stream} (baseline count={block['baseline_count']}):\n")
        for param, bucket in (block.get("per_param") or {}).items():
            counts = ", ".join(
                f"{obs['value']!r}->{obs['count'] if obs['status'] == 200 else obs['status']}"
                for obs in bucket["observations"]
            )
            out(f"    {param:<16} {bucket['verdict']:<18} {counts}\n")

    semantics = report.get("transaction_semantics")
    if semantics:
        out("  transaction semantics:\n")
        out(f"    time filter narrows result: {semantics['time_filter_effective']}\n")
        out(f"    page_size=1000 returned:    {semantics['max_page_size_returned']}\n")
        out(f"    timestamp carries offset:   {semantics['timestamp_carries_offset']}\n")
        for sample in semantics["timestamp_samples"][:4]:
            out(f"    sample: {sample}\n")
        census = semantics.get("vocabulary_census", {})
        if census:
            out(f"    vocabulary census over {census.get('rows_examined')} rows:\n")
            for key, values in census.get("distinct_values", {}).items():
                rendered = ", ".join(f"{token}={n}" for token, n in sorted(values.items(), key=lambda kv: -kv[1])[:6])
                out(f"      {key:22} {rendered}\n")
            out(f"      punch_time range      {census.get('punch_time_min')} .. {census.get('punch_time_max')}\n")
        ordering = semantics.get("ordering", {})
        if ordering:
            out(
                f"    default order: ascending={ordering.get('default_is_ascending')} "
                f"descending={ordering.get('default_is_descending')}; "
                f"ordering param changed result={ordering.get('ordering_param_changed_result')}\n"
            )
    out(f"  requests made: {report['requests_made']}\n\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--env-file",
        default=str(_PROJECT_ROOT / ".env"),
        help="env file supplying GSSG_BIOTIME_* (defaults to the file the app itself reads)",
    )
    parser.add_argument("--base-url", default=None, help="overrides GSSG_BIOTIME_BASE_URL")
    parser.add_argument("--username", default=None, help="overrides GSSG_BIOTIME_USERNAME")
    parser.add_argument(
        "--site-value",
        action="append",
        default=[],
        help="site identifier to test filters with (id or name); repeatable",
    )
    parser.add_argument(
        "--window-days",
        type=float,
        default=1.0,
        help="punch window used for probing; fractions allowed (0.25 = 6 hours)",
    )
    parser.add_argument("--ca-bundle", default=None, help="path to the CA bundle trusting the server")
    parser.add_argument("--insecure", action="store_true", help="skip TLS verification (lab only)")
    parser.add_argument("--timeout", type=float, default=20.0)
    # A full sweep is ~2 auth + 9 discovery + inventory + 5 semantics +
    # (people params x values) + (punch params x values); 64 filter probes
    # alone exceed a 120 budget once four site values are supplied.
    parser.add_argument("--max-requests", type=int, default=250)
    parser.add_argument("--out", default=None, help="write the sanitized JSON report here")
    args = parser.parse_args(argv)

    env = _load_env_file(Path(args.env_file))
    _warn_about_stray_env_files(Path(args.env_file))

    base_url = args.base_url or env.get("GSSG_BIOTIME_BASE_URL") or os.environ.get("GSSG_BIOTIME_BASE_URL")
    username = args.username or env.get("GSSG_BIOTIME_USERNAME") or os.environ.get("GSSG_BIOTIME_USERNAME")
    if not base_url or not username:
        print(
            f"no base URL/username: pass --base-url/--username or set "
            f"GSSG_BIOTIME_BASE_URL and GSSG_BIOTIME_USERNAME in {args.env_file}",
            file=sys.stderr,
        )
        return 2

    # A stored password belongs to the stored username. Overriding the account
    # on the command line must never silently reuse the other one's secret and
    # report the resulting failure as that account's permissions.
    stored_username = env.get("GSSG_BIOTIME_USERNAME") or os.environ.get("GSSG_BIOTIME_USERNAME")
    if args.username and args.username != stored_username:
        password = None
    else:
        # Precedence keeps secrets off argv and out of shell history entirely.
        password = (
            env.get("GSSG_BIOTIME_PASSWORD")
            or os.environ.get("GSSG_BIOTIME_PASSWORD")
            or os.environ.get("BIOTIME_PROBE_PASSWORD")
        )
    if not password:
        password = getpass.getpass(f"BioTime password for {username}: ")
    if not password:
        print("no password supplied", file=sys.stderr)
        return 2

    ca_bundle = args.ca_bundle or env.get("GSSG_BIOTIME_CA_BUNDLE")
    # The report records the TLS trust actually used, so keep args in sync.
    args.ca_bundle = ca_bundle
    verify: bool | str = ca_bundle if ca_bundle else not args.insecure
    probe = Probe(
        base_url=base_url,
        verify=verify,
        timeout=args.timeout,
        max_requests=args.max_requests,
    )

    try:
        auth = probe.discover_auth(username, password)
        if probe.auth_scheme is None:
            print(json.dumps({"authentication": auth}, indent=2))
            print("\nNo auth endpoint returned a usable token. Record this and stop.", file=sys.stderr)
            return 1
        report = _build_report(probe, args, auth)
    finally:
        probe.close()

    if args.out:
        destination = Path(args.out)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"wrote {destination}")
    _print_summary(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
