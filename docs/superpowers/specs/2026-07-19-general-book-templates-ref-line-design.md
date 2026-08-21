# General Book: Arabic ref line + template library — design

**Date:** 2026-07-19
**Status:** Approved (brainstormed 2026-07-18/19; amended after 3-agent review
— i18n/RTL, codebase-accuracy, security)

## Background

`ae99532` (PR #6) unified every General Book — rich-editor (HugeRTE) or
written-in-Word — onto the classified ref register (`1/{tab}/GSSG/{serial}`)
and one render pipeline (fill the canonical template → footer2←footer3 sync →
header `Ref:` stamp → Aztec code). Two gaps remain:

1. The ref only appears as an **English** `Ref: …` header stamp. The office
   convention (seen in all real books in the operator's Desktop
   `book template` folder) is an Arabic `الرقم: …` line in the body, directly
   **above** the `التاريخ:` line.
2. The Word path always opens the one blank canonical template. The office
   actually reuses finished letters as boilerplate (التصاريح الأمنية,
   التكليف, الصيانة, …) — 8 such files sit in `Desktop\book template`. There
   is no way to pick one for the Word path, or to save a Word book for reuse.
   (The **rich editor** already has its own snippet feature —
   `api/v1/editor_templates.py` + Save/Load Template buttons in
   `components/ui/rich-editor.tsx`, i18n namespace `editor.template.*`. This
   design deliberately does not touch it; new names and i18n keys must not
   collide with it — see Section 3.)

## Decisions (operator-confirmed)

- Ref line goes **above** the date (matches the real books, not the literal
  "under the date" phrasing of the request).
- The English `Ref:` **header stamp is dropped** for General Books. The Aztec
  code stays.
- Template picker is **Word-path only**. The rich editor keeps its existing
  snippet feature; no docx→HTML conversion.
- Template creation is **"save book as template" only** — no upload UI, no
  rename/delete/manage UI (non-goal; removing a template = delete the file on
  the server). The 8 Desktop files are imported by a one-time script.
- Architecture: **tokenized template library** (Approach A below).

## Approach

Approaches considered:

- **A — Tokenized library (chosen):** stored templates are `.docx` files with
  the volatile bits swapped back to Jinja tokens at save time. Creating from
  a template is the existing Word-path pipeline with only the template path
  changed. Surgery happens once, at save/import time, and the result is
  validated by a test render before it is stored.
- **B — Plain copy + runtime fix-up:** rejected — moves fragile docx surgery
  to every create, against arbitrary operator-edited text, and forks the
  render pipeline `ae99532` just unified.
- **C — DB-backed template entity:** rejected — a folder of named files needs
  no table, migration, or CRUD. (Precedent exists — `editor_templates` is a
  DB-backed snippet store for the rich editor — but that stores small HTML
  strings queried per-user; a handful of shared docx files doesn't warrant
  it.)

No DB changes anywhere: `Book.classification_code` and the shared serial
register already exist.

**Trust model (security review):** stored library templates are **untrusted
input**, not trusted assets. The canonical templates in `backend/templates/`
are code-reviewed and checked in; library templates derive from free-text
Word content typed by operators. Two consequences run through this design:
foreign Jinja is neutralized at save time (Section 2), and library templates
render under a sandboxed Jinja environment (Section 3).

## Section 1 — Arabic ref line on every General Book

Canonical template `backend/templates/GSSG-GS_300-003_General_Book.docx` gets
a new ref line above the date line, guarded so serial-free previews omit it
(mirrors today's commit-only header stamp). docxtpl `{%p %}` tags each
consume their whole paragraph, so this is **three separate paragraphs**,
exactly mirroring the existing cc guard (`{%p if cc %}` / line / `{%p endif %}`):

```
{%p if ref %}
الرقم: {{ ref }}
{%p endif %}
التاريخ: {{ date }}
```

**Bidi (i18n review, must-fix):** the ref value (`1/5/GSSG/141` — digits,
slashes, Latin) sits inside an RTL Arabic paragraph. The run carrying
`{{ ref }}` must be explicitly LTR (`<w:rPr><w:rtl w:val="0"/></w:rPr>`) or
Word's bidi algorithm reorders its segments. This applies to the canonical
template edit AND to every run the retokenize helper writes (Section 2). This
is the docx equivalent of the frontend's `bidi()` isolation from 5566d9a.

Per call site (all verified against the code):

- **Rich editor** (`document_service.generate_document`): pass
  `data["ref"] = raw_ref` on commit only — `raw_ref` is allocated before
  `_build_template_data`, so one line suffices; previews stay serial-free and
  the ref line is simply absent (`_SilentUndefined` renders a missing key as
  falsy — no throw). Revise reuses `revise_book.ref_number` automatically.
- **Word path** (`word_book_service`): already passes `"ref"` — token works
  with zero changes.
- **Signing re-render** (`document_service` sign path ~1821): pass
  `data["ref"] = book.ref_number`. (Note: signing word-authored books is
  already broken independent of this design — `version.fields` is `{}` for
  them, so a sign would blank the body. Pre-existing; out of scope; this
  bullet meaningfully applies to rich-authored books.)
- **Duty transfer letters**: route through `generate_document`
  (`template_id="General Book"`, classification 12/1) — inherit the line for
  free.
- **Remove `stamp_ref_number`** for General Book at the three call sites:
  `document_service.py:1236` (generate step 9), `:1830` (sign path),
  `word_book_service.py:174`. These are the only three — the fourth
  `stamp_ref_number` site (companion docs, `:1654`) can never be a General
  Book (`_COMPANION_RULES` maps only Resignation Letter and Leave Application
  Form). `stamp_aztec_code` stays everywhere.
- **Scan-back OCR**: Aztec decode remains first-priority, and
  `form_ref._BARE_RE` already matches the classified shape with no `Ref:`
  anchor (test exists: `test_classified_bare_ref_matches_as_fallback`).
  Dropping the header stamp demotes text-OCR hits from the stamped tier to
  the bare fallback tier, so **extend `_STAMPED_RE` to also anchor on
  `الرقم:`** — keeps the confidence tier; add the stamped-tier test variant.

## Section 2 — Template library + save-as-template

**Storage:** flat folder `{data_dir}/book_templates/`. Template name =
filename (Arabic fine on NTFS); listing = folder scan **filtered to
`.docx`**, sorted by mtime descending.

**Filename handling (security review):** reuse the existing sanitizer
(`vault_service._safe_filename` — already strips path components, the
unsafe-char class incl. colon/ADS, bidi controls, trailing dots/spaces) —
do not hand-roll. On top of it:

- Reject Windows reserved device names (`CON`, `PRN`, `NUL`, `AUX`,
  `COM1–9`, `LPT1–9`, with or without extension).
- Force the `.docx` extension on write; filter to `.docx` on list and read.
- Normalize names to NFC before collision checks and writes (visually
  identical Arabic names must not coexist).
- Collision handling is atomic and fail-closed: write to a temp file in the
  same folder, then exclusive-create at the destination
  (`FileExistsError` → 409). No `.exists()` pre-check (TOCTOU); NTFS
  case-insensitivity is thereby handled by the filesystem itself.

**Retokenize helper** (one shared function in `core/`, used by both the save
endpoint and the import script). Operates on the docx **body** for ref/date
(labels in tables or prose are not targets — see validation), plus the named
header/footer parts below. Steps:

1. **Neutralize foreign Jinja** (security blocker): escape every
   `{{`/`}}`/`{%`/`%}`/`{#`/`#}` sequence in the document's existing text
   before injecting our own tokens — operator-typed text must never execute
   as Jinja. Because neutralization lives in the shared helper, the import
   script inherits it.
2. Replace the **first** `الرقم`-labeled body paragraph with the
   three-paragraph guarded block from Section 1 (`{%p if ref %}` /
   `الرقم: {{ ref }}` / `{%p endif %}`), the `{{ ref }}` run marked LTR; if
   no such paragraph exists, insert the block above the `التاريخ` paragraph.
   Label-anchored (regex on paragraph text), keeping the paragraph's
   first-run formatting — legacy files have hand-typed spacing like
   `1/ 5 /GSSG/ 140`, so exact-string matching is not assumed.
3. Replace the **first** `التاريخ`-labeled body paragraph with
   `التاريخ: {{ date }}`. Only the labeled line — dates inside prose are
   untouched.
4. Re-tokenize the footer G-number to `{{ submitter_g }}` in **both**
   footer3 and footer2 (a finished book's footer2 is a synced copy carrying
   the literal G; retokenizing both avoids depending on the create-time
   footer re-sync, though that re-sync does also run and is idempotent).
5. Strip the legacy artifacts from **both header parts**: the English `Ref:`
   stamp text lives in the **default** header (`section.header`), the Aztec
   floating image in the **first-page** header — clear both.
6. **Validate** (strengthened per review): test-render with dummy data under
   `StrictUndefined` and a sandboxed environment, then assert (a) the dummy
   ref and date appear **exactly once each**, on the labeled lines; (b) the
   non-token body text is preserved (diff against the source); (c) no
   unexpected Jinja executed (StrictUndefined turns stray tokens into
   failures instead of silent blanks). Any failure → reject with a
   sanitized, human-readable reason; the template is never stored broken.

**Save-as-template endpoint:** `POST /api/v1/books/{id}/save-as-template`
with `{name}` (defaults client-side to the book's subject). Gated by
`books.manage` — same as every book write endpoint on that router. Available
for **any finished General Book** (word- or rich-authored; the paper is
identical). The source docx is the latest `BookVersion.document_id →
Document.docx_path`, resolved via the codebase idiom for both stored forms
(Word path stores absolute, rich path stores data_dir-relative). Name
collision → 409.

**Sharing semantics (stated explicitly):** a saved template is shared
library content readable by every `books.manage` user. Saving a classified
book's body as a template deliberately republishes that boilerplate to the
library — the confirm dialog says so.

**One-time import:** `backend/scripts/import_book_templates.py` runs the same
helper over the 8 Desktop files (hand-made in Word — the highest-risk
retokenize inputs, which is exactly why they go through the same validation);
each converted file is verified to render before landing in the library.
`generalbookref.jpg` is not imported (it is the register table, already
encoded in `core/classifications.py`).

## Section 3 — Create-from-template + UI

**Backend:** `POST /api/v1/books/word-sessions` gains optional
`template_name`. When present, `word_book_service` sanitizes/resolves it to
the library file and fills THAT file — everything else unchanged: classified
ref allocation, `_postprocess_general_book_footer`, Aztec stamp, WebDAV
hand-off. `DocxEngine` gets a fill-by-path variant (same General Book
adapter `_adapt_general_book` + post_process, different template file).
**Library files render under `jinja2.sandbox.SandboxedEnvironment`**
(defense-in-depth on top of save-time neutralization; the canonical
`backend/templates/` path keeps the plain environment). The create path
opens the file directly and maps `FileNotFoundError` → 409
`TEMPLATE_MISSING` (no exists() pre-check). Baked-in recipient/CC/manager/
subject in the boilerplate stay as saved — the operator edits details in
Word; the form's subject still populates `Book.subject` for the register.

**List endpoint:** `GET /api/v1/books/word-templates` →
`[{name, modified_at}]`, on the existing books router, declared before the
`GET /books/{book_id}` route (the `/classifications` literal route is the
precedent). `books.manage`-gated like the rest of the router.

**Create dialog (Word mode only):** template dropdown in
`TemplateForm.tsx` directly under the body-mode toggle (~lines 434–454),
default **بدون قالب** (blank canonical). When a template is selected, the
recipient/CC/manager fields hide (they are baked and would silently do
nothing); classification + subject remain required. Word-create submit path:
`ApplicationPage.tsx` (~469–481). Rich-editor mode untouched.

**Save action:** "حفظ كقالب" with a name prompt (pre-filled from the
subject) added once inside the shared `components/books/BookWordActions.tsx`
— it is mounted in `RecordPane.tsx` (desktop inline), `BookRecordPage.tsx`
(mobile), and `BooksPage.tsx` (draft rail, active-sessions-only so not
relevant to finished books). One edit satisfies the two-surfaces rule.
Any new name/ref interpolation added to these surfaces uses the established
`bidi()` / `<bdi dir="ltr">` isolation.

**i18n keys (enumerated — the leak-prevention lesson):** new keys land in
BOTH `en.json` and `ar.json`, under `books.word.*` to avoid colliding with
the rich editor's `editor.template.*` namespace:

- `books.word.templatePicker` (label), `books.word.templateNone` = EN
  "No template" / AR "بدون قالب"
- `books.word.saveAsTemplate` = EN "Save as template" / AR "حفظ كقالب"
- `books.word.saveAsTemplateName` (name field label), confirm copy stating
  the shared-library semantics
- `errors.TEMPLATE_MISSING`, `errors.TEMPLATE_INVALID` (or the router's
  established error-key pattern) — Arabic and English both

Run `i18n-rtl-reviewer` before merge. Backend schema changes →
`/sync-api-types` resync (`openapi.json` + `api.types.ts` committed
together).

**Targeted bidi cleanup (in-scope, from i18n review):** classified refs are
now the default everywhere, so fix the pre-existing unisolated ref/name
renders on the surfaces this feature touches: `RecordsList.tsx:134`,
`BooksPage.tsx:832`, `RecordPane.tsx:145` (`ref_number` without
`<bdi dir="ltr">`), `RecordPane.tsx:328` (`signedCopyBody` ref
interpolation), `WordHandoffDialog.tsx:193` (`submitted_by_name`).

## Section 4 — Errors, testing, rollout

**Errors** (existing `AppError` machinery; all reasons are sanitized
human-readable strings — never raw Jinja tracebacks or filesystem paths):

- Chosen template vanished / unreadable at create → 409 `TEMPLATE_MISSING`.
- Save-as-template validation failed → 422 `TEMPLATE_INVALID`.
- Bad template name (traversal, reserved name, empty, wrong extension) → 422.
- Save-as-template name collision → 409 (enforced by exclusive-create).
- Template file size needs no new check — sources are bounded by the
  existing 30 MB body-size limit on the DAV write path.

**Testing** (TDD during implementation):

- Retokenize helper unit tests against fixtures built from the real
  canonical template, plus a legacy-spacing fixture mimicking the Desktop
  files: label-line replacement, insertion when الرقم absent, first-match-
  only when labels repeat, **foreign-Jinja neutralization**
  (`{{ 7*7 }}` in body prose must come out literal, never `49`), both-footer
  G retokenize, both-header stripping, LTR run mark on `{{ ref }}`.
- Validation tests: each failure mode rejects (wrong-paragraph clobber,
  stray Jinja, missing labels) — fail-closed.
- Create-from-template: fresh ref/date rendered, boilerplate body preserved,
  footer G is the new author's, sandboxed render.
- **Rewrite the existing header-stamp assertions** in
  `test_word_book_service.py` (~87–122) — they assert `Ref: …` in the header
  and docstrings claim the template has no `{{ ref }}` token; both flip to
  asserting the body `الرقم` line and an **empty/Aztec-only header** (the
  explicit "English stamp is gone" assertion the i18n review demanded).
- Ref-line render test asserting the **Arabic** `الرقم` string (per the
  i18n-tests-must-assert-arabic lesson).
- `form_ref`: stamped-tier `الرقم:`-anchored test (bare-fallback test
  already exists).
- Endpoint tests: list filtering, permission gates, traversal/reserved-name
  rejection, collision 409, vanished-template 409.
- Frontend: picker rendering/submission, field hiding on template selection,
  save-as-template action via `BookWordActions` on both mounted surfaces.

**Rollout:** the canonical template edit is an intentional template commit
(keep template-churn discipline — revert unrelated churn first); run the
import script once against `Desktop\book template`; deploy via `mng`.

## Non-goals

- Template rename/delete/upload UI (delete the file on the server instead).
- Rich-editor (HugeRTE) template changes — its existing `editor_templates`
  snippet feature is untouched.
- Template versioning or per-template metadata beyond filename + mtime.
- Fixing the pre-existing sign-path hazard for word-authored books
  (`version.fields == {}` would blank the body) — noted in Section 1,
  tracked separately.
- The unrelated `nav.bell.*` plural key asymmetry the i18n review surfaced —
  pre-existing, separate fix.
