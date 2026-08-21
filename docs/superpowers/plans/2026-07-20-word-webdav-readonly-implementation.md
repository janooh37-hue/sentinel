# Word WebDAV read-only fix — implementation plan

**Source:** `docs/superpowers/plans/2026-07-20-word-webdav-readonly-fix.md`

**Outcome:** A captured, redacted real-Word handshake; one regression reproducing its first failing transition; the smallest proven fix; and a successful office-PC open → save → close → reopen → finish round trip.

## Phase 1 — safe diagnostics (build now)

1. In `backend/app/api/dav.py`, add one module logger event per DAV response with session id, method, collection/file shape, status, `Depth`, body length, requested PROPFIND property names, and boolean `If`/`Lock-Token` presence.
2. Never emit token, URL/path, filename, header values, request XML, or DOCX bytes.
3. Keep Caddy request access logging absent and disable Uvicorn access logging before live capture; DAV URLs contain bearer tokens.
4. Add focused tests proving diagnostic records contain useful shape/status and not the bearer token.

## Phase 2 — lifecycle safety groundwork (build now)

1. Extend focused tests so finished/discarded sessions reject stale DAV PUT/LOCK.
2. Verify reopen produces a fresh bearer token and leaves the finished version unchanged.
3. Run DAV, finish, reopen, preview, route, and service tests plus Ruff.

## Phase 3 — real Word capture (operator checkpoint)

1. Create a disposable `PROOF-*` session with `backend/scripts/word_dav_proof.py`.
2. From the affected operator PC, launch through the exact Caddy hostname and reproduce once.
3. Save only redacted evidence: timestamp, method, collection/file shape, `Depth`, request body length, relevant header presence, response status/header presence, and whether Caddy/FastAPI received it.
4. Discard the proof session and disable diagnostic verbosity.

**Stop:** No lock, XML, PUT, hostname, or SMB fix before this capture identifies the first failing transition.

## Phase 4 — evidence-based fix

1. Encode the captured transition as a failing test using separate request fixtures; tolerate harmless retries/order changes.
2. Change only the implicated shared path:
   - hostname/DNS/TLS configuration, or
   - DAV response/URI/XML semantics, or
   - minimal lock lifecycle proven necessary by Word, or
   - unique atomic PUT temporary files if overlapping retries are observed.
3. If schema is required, use nullable backward-compatible fields and the next migration after current head; test copied-DB upgrade and downgrade/upgrade.
4. Verify stale closed-session traffic cannot modify the final DOCX.

## Phase 5 — acceptance and release

1. On the normal operator account: open editable, save, observe `last_put_at`, close, reopen, save, preview, close, then Finish.
2. Confirm final DOCX/PDF includes the last edit and stale requests are rejected.
3. Deploy through the existing management script only after automated and office-PC gates pass.
4. If one proven DAV fix still yields no PUT, stop and write a separate SMB transport plan.

## Commands

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_dav.py -q
venv\Scripts\python.exe -m pytest backend/tests/test_word_book_routes.py backend/tests/test_word_book_service.py backend/tests/test_word_book_reopen.py backend/tests/test_word_book_preview.py backend/tests/test_word_book_finish.py -q
venv\Scripts\python.exe -m ruff check backend/app/api/dav.py backend/tests/test_dav.py
```
