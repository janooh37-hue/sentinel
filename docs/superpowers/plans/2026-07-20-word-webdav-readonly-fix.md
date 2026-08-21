# Word WebDAV read-only failure — corrective plan

**Goal:** Make **Open in Word** open the generated General Book as an editable server document, save with Ctrl+S, update `BookEditSession.last_put_at`, and reopen with the saved changes.

**Parent plan:** `docs/superpowers/plans/2026-07-17-classified-books-edit-in-word.md`, Tasks 3–4 (WebDAV router and mandatory M0 real-Word proof).

**Why this plan exists:** The parent plan required stopping after a real office-PC proof if Word could not open, save, close, and reopen the document. Production currently has active sessions with `last_put_at = NULL`; Word reports the server/file is unavailable or in use and offers copy/read-only. The automated tests exercise hand-picked verbs but do not prove Word's real handshake.

## Scope

- Diagnose and fix the Word ↔ server transport only.
- Reuse `BookEditSession`, token URLs, Caddy, and the existing working DOCX.
- No frontend redesign, document-rendering changes, new abstraction, dependency, or SMB implementation in this plan.

## Task 1 — capture the real failing handshake

**Files:**

- Modify: `backend/app/api/dav.py`
- Test: `backend/tests/test_dav.py`

1. Before capture, verify that Caddy/Uvicorn access logs suppress or redact `/dav/{token}/...`; the URL token is the sole credential. Limit capture duration and delete the raw capture after producing redacted evidence.
2. Add one module-level structured event using session id/correlation hash, method, collection/file path shape, response status, `Depth`, requested PROPFIND property names, body length, and presence—not values—of `If`/`Lock-Token`. Never log request URL, token/header values, owner XML, filename content, or document body.
3. Reproduce with `backend/scripts/word_dav_proof.py` from the affected office PC first; discard the PROOF session afterward. Use an agreed disposable General Book only for final acceptance.
4. Record timestamp, last successful verb, first failing/missing verb, response `DAV`/`Lock-Token`/`Content-Type` presence, and whether Caddy and FastAPI saw it. Capture harmless retries and collection/file requests rather than assuming one linear order.
5. Compare the generated URL with DNS, certificate SAN/chain, Caddy route, and certificate trust in the operator's normal Windows account. Only if mismatch is proven, set `GSSG_PUBLIC_BASE_URL=https://<tested-hostname>` in the service-loaded `.env`, restart through the existing deployment mechanism, and create a fresh session; old sessions retain their materialized URL.

**Stop condition:** Do not implement speculative lock persistence until the captured sequence identifies the protocol failure.

## Task 2 — add the failing sequence as one regression test

**Files:**

- Modify: `backend/tests/test_dav.py`

1. Replay the captured collection/file requests and exact relevant bodies/headers as separate request fixtures; allow harmless retries or ordering variation.
2. Assert semantics at the failing transition: status, required DAV headers, parsed XML properties, `Depth`, initial/refresh LOCK distinction, and URI/XML encoding implicated by the trace.
3. If the trace implicates names/paths, add a filename case containing a space, `&`, and Unicode and assert XML escaping plus canonical percent-encoded hrefs.
4. Run:

   `venv\Scripts\python.exe -m pytest backend/tests/test_dav.py -q`

Expected before the fix: the new test fails at the same handshake step as Word.

## Task 3 — apply the smallest root-cause fix

**Files (expected):**

- Modify: `backend/app/api/dav.py`
- Modify only if captured evidence requires it: `backend/app/services/word_session_repo.py`, `backend/app/db/models.py`, and one Alembic migration

Choose only the branch supported by Task 1:

- Missing/incomplete DAV response: correct the relevant `OPTIONS`, collection/file `PROPFIND`, `LOCK` refresh, `UNLOCK`, `HEAD`, or `PUT` behavior in the shared DAV handler.
- Lost lock state: only if the capture proves stateless locking is rejected, store the minimum demonstrated fields—do not persist/echo owner XML unless required. Specify and test initial LOCK, empty-body refresh with the captured `If` grammar, same-lock `PROPFIND`, timeout/expiry and crash recovery, competing/wrong token response, captured Word-compatible PUT behavior, UNLOCK, and finish/discard cleanup. Do not unconditionally require an `If` header unless the captured client sends it.
- Host/certificate failure: correct `GSSG_PUBLIC_BASE_URL` and deployment validation; do not change DAV logic.

Preserve token authentication and the atomic same-directory `os.replace` invariant. If capture shows overlapping retries, a unique temporary file with failure cleanup may replace the shared `.tmp` name.

If schema changes are proven necessary, use nullable/backward-compatible columns in the next migration after current head, treat null/expired state as unlocked, do not rewrite existing sessions, and smoke-test upgrade plus downgrade/upgrade on a copied development database.

## Task 4 — automated verification

1. Run the focused DAV test file.
2. Run the Word-session route/service tests:

   `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_routes.py backend/tests/test_word_book_service.py backend/tests/test_word_book_reopen.py backend/tests/test_word_book_preview.py backend/tests/test_word_book_finish.py -q`

3. Add lifecycle assertions that a stale DAV PUT/LOCK after finish or discard returns 404, reopen uses a fresh token/lock, and the prior finished version is unchanged. Include `backend/tests/test_word_books_models.py` only if the schema changes.
4. Run `venv\Scripts\python.exe -m ruff check <changed Python files>`.

## Task 5 — mandatory M0 office-PC acceptance gate

Use a fresh book and verify all of the following through Caddy, not localhost:

1. **Open in Word** opens the server document editable, with no copy/read-only prompt.
2. Type a unique line and press Ctrl+S; the UI detects the save and `last_put_at` becomes non-null.
3. Close Word and wait for its final save/UNLOCK before Finish; verify the unique line remains in the working file.
4. Reopen the same active session, edit and save again; the preview refreshes.
5. Close Word and wait again, then Finish; the final DOCX/PDF contains the last saved text.
6. Confirm stale requests against the closed session cannot alter the final DOCX.
7. Repeat once from the operator's normal Windows account to catch certificate/WebClient differences.

This task is not complete until all seven checks pass. If the product must support Finish while Word remains open, stop and make PUT/Finish serialization a separate explicit design change; do not silently accept the data-loss race here.

## Fallback decision

After one evidence-based fix and one captured before/after retry, if the same first failing step remains or Word still never PUTs, stop and write a separate SMB transport revision. Do not implement SMB inside this plan. The revision keeps the session lifecycle, working file, Finish flow, and frontend handoff and replaces only transport/launch URL.

## Completion evidence

- Captured before/after DAV sequence with tokens redacted.
- Regression test fails before and passes after the fix.
- Focused backend tests pass.
- Real office-PC open → save → close → reopen → finish checklist passes.
