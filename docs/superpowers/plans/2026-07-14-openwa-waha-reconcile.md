# OpenWA → WAHA Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the dormant WhatsApp client (`openwa_client.py`) at a real WAHA gateway running under the office's existing Podman-in-WSL, so the channel works once the operator scans a QR and flips `GSSG_OPENWA_ENABLED=1`.

**Architecture:** Transport-only reconciliation. Every public function in `openwa_client.py` keeps its name and signature (except `get_ack`, which gains a required `chat_id`); only the HTTP paths/payloads/response-parsing change to match WAHA's REST contract. No DB migration, no router/dispatch changes, no frontend changes. Delivery status keeps the existing 5-minute poller.

**Tech Stack:** Python 3.12, httpx (with `MockTransport` for tests), pytest, mypy strict, ruff. Gateway: `devlikeapro/waha` (Core) via rootless Podman in the `podman-uosserver` WSL2 distro.

## Global Constraints

- mypy is `strict`; pytest runs with `filterwarnings=error`. Both must stay green.
- Keep the `GSSG_OPENWA_*` setting names and the `openwa_client` module name — no renames.
- The channel must stay dormant: all network calls are already gated by `openwa_enabled`; do not remove that gating. No behavior change when the flag is off.
- No DB schema change. `OutboundMessage.phone` supplies the chatId for acks.
- No frontend / `api.types.ts` / route changes (transport code only).
- WAHA auth header is `X-Api-Key`; the current `X-API-Key` string is fine (HTTP headers are case-insensitive) — leave it.
- Session name travels in the JSON **body** (`"session"`) for send endpoints, and in the **URL** for session/chat-scoped GETs, per WAHA.
- Host↔container port mapping is `127.0.0.1:2785:3000` so `GSSG_OPENWA_API_BASE=http://localhost:2785` stays unchanged.
- Run under the existing distro: `wsl -d podman-uosserver -- podman ...` (rootless). No Docker Desktop.

---

### Task 1: Pin the WAHA contract against live Swagger

Verification task — the image is already pulled. Confirm the exact paths/fields this plan assumes for the installed WAHA tag before writing code; correct this plan + the spec table if anything differs. Run WAHA **keyless** locally (no `WAHA_API_KEY` ⇒ no auth) purely to read Swagger, then remove it.

**Files:**
- Modify (only if Swagger differs): `docs/superpowers/plans/2026-07-14-openwa-waha-reconcile.md`, `docs/superpowers/specs/2026-07-14-openwa-waha-reconcile-design.md`

- [ ] **Step 1: Start a throwaway WAHA for inspection**

```powershell
wsl.exe -d podman-uosserver -- podman run -d --name waha-inspect -p 127.0.0.1:2785:3000 docker.io/devlikeapro/waha:latest
```

- [ ] **Step 2: Read the OpenAPI spec and confirm the six paths**

```bash
curl -s http://localhost:2785/api/docs-json | python -c "import sys,json; d=json.load(sys.stdin); print('\n'.join(sorted(d['paths'])))"
```
Expected: paths include `/api/sendText`, `/api/sendFile`, `/api/contacts/check-exists`, `/api/{session}/groups`, `/api/sessions/{session}`, `/api/{session}/chats/{chatId}/messages/{messageId}`, `/api/{session}/auth/qr`. Note any deviations (e.g. a different QR format param or send-file field name) and edit the affected task(s) below.

- [ ] **Step 3: Capture the sendText and ack response shapes**

Open `http://localhost:2785/api/docs` in a browser and record, for `POST /api/sendText`, whether the returned message `id` is a string or an object with `_serialized`; and for the chat-message GET, the `ack` field type. These confirm the `_msg_id` helper (Task 2) and the ack map (Task 6).

- [ ] **Step 4: Tear down the inspection container**

```powershell
wsl.exe -d podman-uosserver -- podman rm -f waha-inspect
```

- [ ] **Step 5: Commit any plan/spec corrections (skip if none)**

```bash
git add docs/superpowers/
git commit -m "docs(openwa): pin WAHA contract against live swagger"
```

---

### Task 2: Repoint `send_to_chat` at `POST /api/sendText`

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`send_to_chat`, add `_msg_id` helper)
- Test: `backend/tests/test_openwa_client.py`

**Interfaces:**
- Produces: `send_to_chat(chat_id: str, text: str) -> SendResult` (unchanged signature); `send(phone, text)` still wraps it via `_chat_id`. New private `_msg_id(data: dict) -> str | None`.

- [ ] **Step 1: Update the failing tests to the WAHA contract**

Replace `test_send_ok_returns_message_id` and add an id-object test in `backend/tests/test_openwa_client.py`:

```python
def test_send_ok_posts_sendtext_with_session_body():
    def handler(req):
        assert req.headers["X-API-Key"] == "k"
        assert req.url.path == "/api/sendText"
        import json
        body = json.loads(req.content)
        assert body == {"session": "default", "chatId": "971500000000@c.us", "text": "hi"}
        return httpx.Response(201, json={"id": "true_971500000000@c.us_3EB0"})
    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert r.ok and r.message_id == "true_971500000000@c.us_3EB0"


def test_send_extracts_serialized_id_object():
    def handler(req):
        return httpx.Response(201, json={"id": {"_serialized": "true_x@c.us_9F"}})
    _mock(handler)
    r = openwa_client.send("971500000000", "hi")
    assert r.ok and r.message_id == "true_x@c.us_9F"
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_send_ok_posts_sendtext_with_session_body -v`
Expected: FAIL (path is `/api/sessions/default/messages/send-text`, body has no `session`).

- [ ] **Step 3: Implement the WAHA send + id helper**

Add helper and rewrite `send_to_chat` body in `openwa_client.py`:

```python
def _msg_id(data: dict) -> str | None:
    mid = data.get("id")
    if isinstance(mid, dict):
        return mid.get("_serialized") or mid.get("id")
    return mid or (data.get("key") or {}).get("id")
```

In `send_to_chat`, replace the url/payload/success lines:

```python
    cfg = get_settings()
    url = f"{_base()}/api/sendText"
    payload = {"session": cfg.openwa_session, "chatId": chat_id, "text": text}
```
and in the 2xx branch:
```python
            data = resp.json() if resp.content else {}
            return SendResult(ok=True, message_id=_msg_id(data))
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS (all, including the not-registered/retry tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "fix(openwa): send_to_chat -> WAHA POST /api/sendText"
```

---

### Task 3: Repoint `send_file` at `POST /api/sendFile` (+ mimetype)

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`send_file`)
- Test: `backend/tests/test_openwa_client.py`

**Interfaces:**
- Produces: `send_file(chat_id: str, *, data: bytes, filename: str, caption: str, mimetype: str = "application/pdf") -> SendResult`. Callers that omit `mimetype` (book-PDF announcements) keep working.

- [ ] **Step 1: Write the failing test**

```python
def test_send_file_posts_sendfile_with_file_object():
    import base64, json
    def handler(req):
        assert req.url.path == "/api/sendFile"
        body = json.loads(req.content)
        assert body["session"] == "default"
        assert body["chatId"] == "123@g.us"
        assert body["file"] == {
            "mimetype": "application/pdf",
            "filename": "book.pdf",
            "data": base64.b64encode(b"PDFDATA").decode("ascii"),
        }
        assert body["caption"] == "cap"
        return httpx.Response(201, json={"id": "true_123@g.us_AA"})
    _mock(handler)
    r = openwa_client.send_file("123@g.us", data=b"PDFDATA", filename="book.pdf", caption="cap")
    assert r.ok and r.message_id == "true_123@g.us_AA"
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_send_file_posts_sendfile_with_file_object -v`
Expected: FAIL (old path, `file` is a bare base64 string).

- [ ] **Step 3: Implement**

Rewrite `send_file` signature and body/url in `openwa_client.py`:

```python
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
```
and in the 2xx branch use `message_id=_msg_id(resp.json() if resp.content else {})`.

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "fix(openwa): send_file -> WAHA POST /api/sendFile with file object"
```

---

### Task 4: Repoint `is_registered` at `GET /api/contacts/check-exists`

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`is_registered`)
- Test: `backend/tests/test_openwa_client.py`

- [ ] **Step 1: Update the test to assert the WAHA path + query**

```python
def test_is_registered_true():
    def handler(req):
        assert req.url.path == "/api/contacts/check-exists"
        assert req.url.params["phone"] == "971500000000"
        assert req.url.params["session"] == "default"
        return httpx.Response(200, json={"numberExists": True, "chatId": "971500000000@c.us"})
    _mock(handler)
    assert openwa_client.is_registered("971500000000") is True
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_is_registered_true -v`
Expected: FAIL (old path, no `session` param).

- [ ] **Step 3: Implement**

In `is_registered`, replace url/params:

```python
    cfg = get_settings()
    url = f"{_base()}/api/contacts/check-exists"
    ...
            resp = c.get(
                url,
                headers=_headers(),
                params={"phone": phone.removeprefix("+"), "session": cfg.openwa_session},
            )
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS (incl. `test_is_registered_unknown_on_error`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "fix(openwa): is_registered -> WAHA GET /api/contacts/check-exists"
```

---

### Task 5: Repoint `list_groups` at `GET /api/{session}/groups`

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`list_groups`)
- Test: `backend/tests/test_openwa_client.py`

- [ ] **Step 1: Write the failing test (nested id object)**

```python
def test_list_groups_parses_waha_shape():
    def handler(req):
        assert req.url.path == "/api/default/groups"
        return httpx.Response(200, json=[
            {"id": {"_serialized": "123@g.us"}, "name": "Ops"},
            {"id": "456@g.us", "name": "HR"},
        ])
    _mock(handler)
    groups = openwa_client.list_groups()
    assert [(g.id, g.name) for g in groups] == [("123@g.us", "Ops"), ("456@g.us", "HR")]
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_list_groups_parses_waha_shape -v`
Expected: FAIL (old path; nested `id` dict stringified).

- [ ] **Step 3: Implement**

In `list_groups`, change the url and the id extraction:

```python
    url = f"{_base()}/api/{cfg.openwa_session}/groups"
```
and inside the row loop, replace the `gid = ...` line:
```python
        raw_id = r.get("id") or r.get("chatId") or r.get("_serialized")
        gid = raw_id.get("_serialized") if isinstance(raw_id, dict) else raw_id
        name = r.get("name") or r.get("subject") or gid
```

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "fix(openwa): list_groups -> WAHA GET /api/{session}/groups"
```

---

### Task 6: `get_ack(message_id, chat_id)` + ack map + call sites

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`get_ack`, add `_ACK_STATE`)
- Modify: `backend/app/services/notify_dispatch.py:412`, `:438` (pass chatId)
- Test: `backend/tests/test_openwa_client.py`, `backend/tests/test_notify_dispatch.py:197-201`

**Interfaces:**
- Produces: `get_ack(message_id: str, chat_id: str) -> DeliveryResult`. Callers pass `openwa_client._chat_id(row.phone)`.

- [ ] **Step 1: Update the client tests for the new signature + path + mapping**

Replace `test_get_ack_retries_on_transport_error` and add a mapping test:

```python
def test_get_ack_retries_on_transport_error():
    calls = {"n": 0}
    def handler(req):
        calls["n"] += 1
        raise httpx.ConnectError("boom")
    _mock(handler)
    r = openwa_client.get_ack("m1", "971500000000@c.us")
    assert not r.ok and calls["n"] == 2


def test_get_ack_maps_ack_int_to_state():
    def handler(req):
        assert req.url.path == "/api/default/chats/971500000000@c.us/messages/m1"
        return httpx.Response(200, json={"ack": 3})
    _mock(handler)
    r = openwa_client.get_ack("m1", "971500000000@c.us")
    assert r.ok and r.state == "read"
```

- [ ] **Step 2: Update the notify_dispatch poll test mock to two args**

In `backend/tests/test_notify_dispatch.py`, change the `get_ack` mock lambda:

```python
    monkeypatch.setattr(
        openwa_client,
        "get_ack",
        lambda mid, chat_id: openwa_client.DeliveryResult(ok=True, state="read"),
    )
```

- [ ] **Step 3: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_get_ack_maps_ack_int_to_state backend/tests/test_notify_dispatch.py -v`
Expected: FAIL (old single-arg signature / old path).

- [ ] **Step 4: Implement the mapping + new signature**

Add near the top of `openwa_client.py`:

```python
_ACK_STATE = {-1: "failed", 0: "sent", 1: "sent", 2: "delivered", 3: "read", 4: "read"}
```

Rewrite `get_ack`:

```python
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
```

- [ ] **Step 5: Update the two call sites in `notify_dispatch.py`**

Line ~412 (in `poll_deliveries`) and line ~438 (in `refresh_delivery`), change:
```python
            res_wa = openwa_client.get_ack(row.provider_msg_id)
```
to:
```python
            res_wa = openwa_client.get_ack(row.provider_msg_id, openwa_client._chat_id(row.phone))
```

- [ ] **Step 6: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py backend/tests/test_notify_dispatch.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/openwa_client.py backend/app/services/notify_dispatch.py backend/tests/test_openwa_client.py backend/tests/test_notify_dispatch.py
git commit -m "fix(openwa): get_ack uses WAHA chat-scoped path + ack->state map"
```

---

### Task 7: Repoint `fetch_qr` at `GET /api/{session}/auth/qr`

**Files:**
- Modify: `backend/app/services/openwa_client.py` (`fetch_qr`)
- Test: `backend/tests/test_openwa_client.py`

**Interfaces:**
- Produces: `fetch_qr() -> str | None` returning a `data:image/png;base64,...` URL (or None on error). The in-app QR dialog already renders this string as an image `src`.

- [ ] **Step 1: Write the failing test**

```python
def test_fetch_qr_returns_data_url_from_png():
    import base64
    png = b"\x89PNG\r\n\x1a\nDEADBEEF"
    def handler(req):
        assert req.url.path == "/api/default/auth/qr"
        return httpx.Response(200, content=png, headers={"content-type": "image/png"})
    _mock(handler)
    out = openwa_client.fetch_qr()
    assert out == "data:image/png;base64," + base64.b64encode(png).decode("ascii")
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py::test_fetch_qr_returns_data_url_from_png -v`
Expected: FAIL (old path; returns JSON `qr`/`data`).

- [ ] **Step 3: Implement**

Rewrite `fetch_qr` body:

```python
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
```

> If Task 1 found the installed tag returns JSON `{value}` instead of a PNG, adjust this to build the data URL from `resp.json()["value"]` and update the test accordingly.

- [ ] **Step 4: Run to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "fix(openwa): fetch_qr -> WAHA /api/{session}/auth/qr data-url"
```

---

### Task 8: WAHA runtime files (compose, run script, README)

**Files:**
- Modify: `deploy/openwa/docker-compose.yml`
- Create: `deploy/openwa/run-waha.ps1`
- Modify: `deploy/openwa/README.md`

No unit test; verified by running the script and hitting `/api/docs`.

- [ ] **Step 1: Rewrite `docker-compose.yml` for WAHA**

```yaml
services:
  waha:
    # Pin to a digest before production: docker.io/devlikeapro/waha@sha256:...
    image: docker.io/devlikeapro/waha:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:2785:3000"
    environment:
      WAHA_API_KEY: "${OPENWA_API_KEY}"
      WHATSAPP_START_SESSION: "gssg"
      WHATSAPP_RESTART_ALL_SESSIONS: "True"
    volumes:
      - waha_sessions:/app/.sessions

volumes:
  waha_sessions:
```

- [ ] **Step 2: Create `run-waha.ps1` (the actual bring-up on this box)**

```powershell
# Bring up WAHA under the existing podman-uosserver WSL distro (no compose provider).
# Reads deploy/openwa/.env for OPENWA_API_KEY. Idempotent.
$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot '.env'
$key = (Select-String -Path $envFile -Pattern '^\s*OPENWA_API_KEY\s*=\s*(.+)$').Matches[0].Groups[1].Value.Trim()
if (-not $key) { throw "OPENWA_API_KEY is empty in $envFile — fill it first." }

$distro = 'podman-uosserver'
wsl.exe -d $distro -- podman rm -f waha 2>$null | Out-Null
wsl.exe -d $distro -- podman run -d --name waha --restart unless-stopped `
  -p 127.0.0.1:2785:3000 `
  -e WAHA_API_KEY="$key" -e WHATSAPP_START_SESSION=gssg -e WHATSAPP_RESTART_ALL_SESSIONS=True `
  -v waha_sessions:/app/.sessions `
  docker.io/devlikeapro/waha:latest
Write-Host "WAHA started. Swagger: http://localhost:2785/api/docs"
```

- [ ] **Step 3: Verify the script brings WAHA up (needs a key in deploy/openwa/.env)**

Run (only if the operator has filled the key; otherwise leave to go-live):
```powershell
powershell -ExecutionPolicy Bypass -File deploy/openwa/run-waha.ps1
```
Then: `curl -s -o /dev/null -w "%{http_code}" http://localhost:2785/api/docs` → expect `200`.

- [ ] **Step 4: Rewrite `README.md`**

Replace the OpenWA-specific bring-up with WAHA reality: image `devlikeapro/waha`, port `2785→3000`, env `WAHA_API_KEY`/`WHATSAPP_START_SESSION=gssg`, session start `POST /api/sessions {"name":"gssg"}`, QR at `GET /api/gssg/auth/qr`, status `WORKING`, the `run-waha.ps1` path, the boot Scheduled Task (`wsl -d podman-uosserver -- podman start waha`), and the two-`.env`/matching-key note. Keep the "pin the digest" and "session down → falls back to SMS" sections.

- [ ] **Step 5: Commit**

```bash
git add deploy/openwa/docker-compose.yml deploy/openwa/run-waha.ps1 deploy/openwa/README.md
git commit -m "deploy(openwa): WAHA compose + podman run script + README"
```

---

### Task 9: Full gates + finish the branch

**Files:** none (verification + integration).

- [ ] **Step 1: Run the full backend gates**

```bash
venv\Scripts\python.exe -m pytest
venv\Scripts\mypy.exe
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
```
Expected: pytest all pass (no new failures vs baseline), mypy clean, ruff clean.

- [ ] **Step 2: Confirm no frontend contract drift**

No Pydantic schema or route changed, so `api.types.ts` is untouched. Sanity check:
```bash
git diff --name-only main -- backend/openapi.json frontend/src/lib/api.types.ts
```
Expected: empty output.

- [ ] **Step 3: Finish the branch**

Invoke `superpowers:finishing-a-development-branch` to merge `feat/openwa-waha-reconcile` into `main` and push to `origin/main` (live checkout). The channel stays off (`GSSG_OPENWA_ENABLED=0`) after merge; operator go-live steps are in the README.

---

## Self-Review

- **Spec coverage:** runtime files (Task 8) ✓; every client function repoint — send_to_chat (2), send_file (3), is_registered (4), list_groups (5), get_ack+mapping+call sites (6), fetch_qr (7) ✓; tests updated in each ✓; pin-the-contract (1) ✓; gates + merge (9) ✓. session_state/health need no change (already accept WORKING) — intentionally no task.
- **Placeholder scan:** none — every code step shows the code; the only conditional ("if Swagger differs") points at a concrete alternative.
- **Type consistency:** `_msg_id(data)` defined in Task 2 and reused in Task 3; `get_ack(message_id, chat_id)` defined in Task 6 matches both call sites and both test mocks; `send_file(..., mimetype=...)` default keeps existing callers valid; `_chat_id` is the existing helper.
