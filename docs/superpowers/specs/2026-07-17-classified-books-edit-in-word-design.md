# Classified Books + Edit-in-Word — Design

**Date:** 2026-07-17
**Status:** Approved by user (brainstorming session)
**Feature:** General Book gains government-classified sub-templates (التبويب) whose
body is written in real desktop Word via WebDAV + the `ms-word:` protocol. The
docx is the source of truth — no HTML↔DOCX conversion ever happens on this path.

## Problem

The HugeRTE → `html_to_docx()` → docxtpl → Word-COM pipeline re-implements Word's
layout in HTML and hand-translates it to OOXML. Every fidelity bug (tall tables,
merged cells, page-break calibration) lives in that translation layer, and it can
never be finished because HTML and OOXML are not equivalent. Meanwhile the office
writes classified government letters by hand-editing old Word files, which has
drifted their formatting apart (inconsistent ref-line font sizes, wandering
alignment, a 2025 date typo) and requires manually tracking the shared serial.

**Principle:** the engine that edits must be the engine that prints. Word edits
the body; Word (COM) prints the PDF; the app owns everything around the body.

## Goals

- One-click "write it in Word" for classified letters: create in the app, Word
  opens with the letterhead/tokens already stamped, user types the body, Ctrl+S
  saves straight to the server, Finish produces the version + PDF.
- Government classification index (التبويب, codes 1/1 … 15/1) as a picker on the
  General Book form; the picked code drives the ref.
- Auto-allocated shared ref serial: `الرقم: 1/{tab}/GSSG/{serial}` — clean
  canonical form, 13pt bold, always.
- Everything General Book already does is preserved: ref stamping, signing
  manager picked in the UI, author-G footer, PDF via Word COM, Book/BookVersion
  rows, vault storage.
- Government formatting is baked into the templates. No server-side inspection
  or normalization of the docx (user decision: "baked into the template").
- Classified books are ordinary records: they appear in the Records list
  (searchable by subject and ref) and follow the existing
  approval / signed-copy-scan lifecycle unchanged.
- Drafts: a created-but-never-finished book is a visible Draft holding its
  reserved ref — findable in BOTH a dedicated drafts group and the records
  list (clearly badged so drafts never mix with saved books).
- Plain (unclassified) General Book keeps both paths: HugeRTE body (today's
  flow) or write-in-Word.

## Non-goals

- No in-browser Word engine (OnlyOffice/Collabora) — RAM budget rejected it.
- No download/re-upload flow — rejected as inconvenient.
- No server-side validation of fonts/margins after Word edits.
- No changes to the 17 existing tokenized forms or the approval/signing chains.
- No retirement of HugeRTE — it remains for plain General Book and short content.

## Classification registry & ref scheme

Static registry in the backend (the government index is stable), one entry per
تبويب code from the official table:

| field | example |
|---|---|
| `code` | `5/1` (stamped in the ref as `1/5`) |
| `name_ar` | التصاريح الأمنية |
| `unit_ar` | الشؤون الإدارية والمالية |
| `template` | which layout docx this classification uses |

All 15 codes ship in the registry. The frontend gets the list from a small GET
endpoint (bilingual labels; Arabic names are the canonical ones from the photo
of the government index).

**Ref:** `الرقم: 1/{tab}/GSSG/{serial}` — e.g. `الرقم: 1/5/GSSG/141`.

- One shared serial counter across **all** classifications (confirmed against
  real letters: 69 → 84 → 89 → 111 → 135 → 139 → 140, monotonic across
  different codes; no yearly reset). Separate from the plain General Book
  counter.
- Allocated at creation, atomically in the same transaction as the Book row
  (matches paper practice: the number is taken even while the letter is being
  written).
- Counter seeded once by migration to match the paper register (next number
  provided by the user at build time, ≈141). Corrections, if ever needed, are a
  one-line SQL fix — no admin UI (YAGNI).

## Templates (layouts)

Committed docx files in `backend/templates/` — same handling as the existing 17
forms (registry entry in `docx_engine.py`, `_fields.json` meta, template-churn
rule applies).

Analysis of the user's 8 real sample letters showed **one shared skeleton**
(identical A4 page, 1.27/1.25cm margins, letterhead header, same paragraph
sequence) differing only in body content. So the layouts are: **one standard
classified-letter skeleton, cloned into a few starter-body variants** (prose-only,
items-table `المادة/العدد`, personnel-table `الرقم الوظيفي/المسمى/الاسم`, …).
The user authors each variant docx once; the registry maps classifications to
variants; most map to the standard prose variant.

Every classified layout carries, app-stamped via the existing docxtpl token
system (NO body sentinel, NO HTML injection):

- `الرقم:` ref line — canonical form, 13pt bold
- `التاريخ:` — auto (dd/mm/yyyy, creation date)
- `السيد / {{ recipient }}` line
- `الموضوع: {{ subject }}`
- Guide/starter body content (typed over in Word)
- Closing courtesy lines (fixed text in the template)
- Signing-manager block: name (16pt bold) + title (14pt) — manager picked in
  the app UI, same picker and rendering style as today
- CC lines (`نسخة – …`) from the form's CC field
- Author-G footer token (the mechanic introduced in General Book; the sample
  letters' footers are empty — the layouts add it, including the page-2+ footer
  sync postprocess)

If a classification's template file is missing on disk, creation for that
classification is blocked with a clear bilingual message naming the file.

## Data model

- `Book.classification_code` — nullable string; set for classified books.
- New shared-counter storage for the classified serial (new counter row/table
  keyed by scheme, incremented in the Book-creation transaction; plan reuses the
  existing ref-allocation mechanism if one generalizes).
- New `book_edit_sessions` table: `id`, `book_id` (one **active** session per
  book), `user_id` (owner), `token` (unguessable, in the DAV URL),
  `working_path`, `created_at`, `last_put_at`, `state`
  (`active`/`finished`/`discarded`). DB-backed so sessions survive service
  restarts.
- `BookVersion` is reused unchanged: **version 1 = the first finished edit**
  (never the empty template). Each Finish appends version N+1 with its own docx
  + PDF. v1 is preserved forever.
- Draft = classified book with zero versions. Voided = draft that was discarded
  (book kept, marked `ملغي`, preserving the serial trail like striking through
  a paper-register entry — never hard-deleted).

## Edit session flow

**Create (classified):** form (classification, recipient, subject, CC, signing
manager) → transaction: allocate serial + Book row → render working docx from
the classification's template (all tokens stamped) into the session working
area → create session → response includes
`ms-word:ofe|u|https://gssg.lan/dav/{token}/{ref-slug}.docx` → browser opens it
→ Word launches with the letter ready.

**Re-edit:** copies the latest version's docx into a fresh session (new token),
same launch. Blocked (409 + "قيد التحرير بواسطة فلان") while another session is
active.

**Save:** every Ctrl+S in Word is a DAV PUT → atomic replace of the working
file, `last_put_at` updated. PUTs do NOT create versions.

**Finish (button in the app):** working docx → vault as `BookVersion` N+1 +
Document row → PDF rendered via the existing Word-COM chain → session closed →
queries invalidated so the UI shows the new PDF. Finishing with zero PUTs is
blocked ("nothing saved from Word yet"). Owner or `books.manage` may finish.

**Discard:** confirm dialog → working copy deleted → if the book has versions,
it simply reverts to the latest version; if it was a draft, the book becomes
Voided (see Data model).

Sessions never expire silently and nothing is auto-deleted; a stale session is
visible on the record and anyone with rights can resume, finish, or discard it.

## WebDAV endpoint

Small FastAPI router at `/dav/{token}/{filename}` — no new dependency —
implementing exactly the verbs desktop Word needs:

- `OPTIONS` — advertises `DAV: 1,2`, `MS-Author-Via: DAV`, `Allow` list.
- `HEAD` / `GET` — serve the working file.
- `PUT` — atomic write (temp file + replace); 401/404 on bad or closed token.
- `LOCK` / `UNLOCK` — minimal implementation returning a lock token (we enforce
  one editor at the session layer anyway).
- `PROPFIND` — minimal multistatus XML for the single file.

Auth = the unguessable token path segment (Word does not send browser cookies);
the token dies when the session closes. TLS via the existing Caddy `gssg.lan`
internal CA, already trusted on office PCs. Body-size-limit middleware must
admit docx-sized PUTs on this path.

## Records integration

The Word-edit flow only changes how the CONTENT is authored. Everything around
it is the normal record lifecycle, unchanged:

- A classified book is a `Book` row like today's General Book — it appears in
  the Records list alongside everything else, searchable by **subject and ref**
  (`1/5/GSSG/141`), never isolated under a separate service page.
- After Finish it follows the existing approval path: send for approval and/or
  scan back the signed copy (اعتماد — نسخة موقعة), exactly like current books.
  No changes to those mechanics.
- Versions (v1, v2, …) render inside the record's detail surfaces with
  per-version PDF/DOCX download — the existing `BookVersion` backbone.
- **Drafts appear in BOTH places:** a dedicated drafts group (for follow-up:
  continue writing / finish / discard) AND inline in the records list with a
  distinct background + "مسودة — رقم محجوز" badge — searchable by ref, but
  visually unmistakable from saved books. A draft joins the normal record
  lifecycle when its first version is finished.

## Body search (find a book without remembering subject or ref)

Follows the proven house pattern (mail ledger, migration `0014_ledger_fts5`):
SQLite **FTS5** — no new infrastructure, verified available on this install.

- **Extract at Finish:** when a version is finished, extract plain text from
  the docx (paragraphs + table cells, python-docx walk) into a new
  `BookVersion.body_text` column. Plain General Book HTML bodies are stripped
  to text (lxml, existing tooling) into the same column. One extraction per
  version — cheap, no live-parse at query time.
- **Normalization (Arabic):** a shared normalizer applied to BOTH the indexed
  text and the search query — strip tatweel, unify alef variants (أ إ آ → ا),
  ى → ي, ة → ه. Diacritics are handled by the tokenizer
  (`unicode61 remove_diacritics 2`, same as the ledger).
- **Index:** `books_fts` FTS5 external-content table over subject + ref +
  `body_text` with ai/ad/au sync triggers (the exact `0014` pattern, including
  the delete+insert update trigger).
- **Search UX:** the existing records search box also matches body text; body
  hits show a highlighted snippet (FTS5 `snippet()`) under the subject line so
  the user sees WHY the record matched.
- **Backfill:** one-time step extracts text for existing books' docx/HTML
  bodies (missing files skipped gracefully, logged).
- **Non-goal:** OCR of scanned signed copies is out of scope (the
  `OcrRun.raw_text` seed exists for that as a future feature); this indexes
  the typed body, which is the authored source of truth.

Rejected alternatives: plain `LIKE` scans (no ranking, weak Arabic matching,
no snippets — and FTS5 costs the same to build here); external engines
(Elasticsearch/Meilisearch — absurd overhead for a LAN office app on SQLite).

## Frontend UX

**General Book form:** optional classification picker (default "بدون تبويب" =
today's behavior). With a classification picked, the HugeRTE editor is hidden
and the form shrinks to recipient / subject / CC / signing manager; submit
becomes **"إنشاء وفتح في Word"**, with a toast: Word is opening — press Finish
when done. Plain General Book gets a body-mode toggle: "اكتب هنا" (HugeRTE) vs
"اكتب في Word" (same session flow on the General Book layout with guide text).

**Record surfaces — wired into BOTH** the desktop inline expansion and the
mobile modal (standing rule): editing-in-progress chip naming the session
owner; actions فتح في Word / إنهاء التحرير / تجاهل; classification chip
(code + Arabic name); ref rendered with bidi isolation so
`الرقم: 1/5/GSSG/141` never scrambles in RTL context. On phones the edit action
is disabled with a hint (needs a PC with Word); PDF viewing works everywhere.

**Drafts:** a drafts group sits above the records list gathering open drafts
(continue-in-Word / finish / discard), and the same drafts also render inline
in the records list with a tinted background + "مسودة — رقم محجوز" chip, plus
a "المسودات" filter. Voided books render struck-through/ملغي and stay in the
list (number sequence preserved).

**i18n:** all strings in `en.json`/`ar.json`; tests assert the **Arabic**
strings under `lng=ar` (standing lesson); `i18n-rtl-reviewer` runs over the
diff. Backend schema changes end with `/sync-api-types`, committed together.

## Errors & edge cases

- Template file missing → 409 at creation, bilingual message naming the file.
- Word closed without Finish → last Ctrl+S is safe in the working file; session
  stays open; resume/finish/discard anytime.
- PDF render failure → version still saves (docx is the truth); existing
  "PDF pending" state + the chain's three-method fallback/retry.
- Concurrent finish/discard/edit → single-active-session constraint; friendly
  409.
- Invalid/expired DAV token → 401/404; Word shows its standard error.
- Ref counter under concurrent creates → serialized by the DB transaction.

## Testing

- **pytest:** DAV verb sequence as Word performs it (OPTIONS → LOCK → GET → PUT
  → UNLOCK, via httpx); token auth (bad/closed token); atomic PUT; ref
  allocation under concurrent creates (shared counter, no gaps/dupes); session
  lifecycle (create/re-edit/finish/discard, draft→voided); version+PDF creation
  on finish; template-missing 409; body-text extraction (paragraphs + table
  cells, Arabic normalization) and FTS matching (query with alef/ya variants
  finds the body; snippet returned).
- **vitest:** classification picker (options, optional default), body-mode
  toggle, record actions + chips on both surfaces, drafts filter, Arabic string
  assertions under `lng=ar`.
- **Manual (Milestone 0 checklist):** real desktop Word on an office PC —
  open via `ms-word:` link, type, Ctrl+S, verify PUT landed, close, reopen.
  This is the one part automation cannot cover.
- Strict gates as always: mypy strict, ruff, `filterwarnings=error`, eslint,
  tsc.

## Milestones

1. **M0 — Word↔WebDAV proof (de-risk first).** Bare DAV endpoint + a throwaway
   token; manual checklist with real Word on an office PC. If Word's DAV client
   misbehaves → fall back to SMB share + same session model (only the transport
   changes; nothing else in this design moves).
2. **M1 — Classified creation pipeline.** Registry + layouts + ref counter +
   create-and-open-in-Word + Finish → version 1 + PDF. Drafts/voided states.
3. **M2 — Re-edit + polish.** Re-edit sessions (vN+1), both record surfaces,
   drafts group + filter, plain-General-Book Word option, i18n review, deploy.
4. **M3 — Body search.** `body_text` extraction on finish, `books_fts` FTS5
   table + triggers (house `0014` pattern), search endpoint + snippet UI,
   backfill for existing books.

## Open items (resolved at build time)

- Exact next serial for the counter seed (user provides; ≈141 as of 2026-07-17).
- The starter-body variant docx files themselves (user authors them; M1 ships
  with the standard prose variant + however many variants exist by then; the
  registry maps unauthored classifications to the standard variant until their
  file lands).
