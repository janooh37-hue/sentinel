# White-label first-run configuration — plan

**Mockup:** `docs/first-run-setup-wizard.html` (11 steps)
**Working script:** `scripts/bulk_import_ids.py` (real, tested — not a mockup)

## Outcome

Turn this single-tenant build into a product a second company can stand up
themselves: identity and branding, reference numbering and barcode symbology,
their own Word templates and the fields behind them, the services those
templates become, which modules survive, the employee roster, signatories and
accounts, and a bulk import of passport / national-ID scans.

## Decisions taken

| Question | Decision |
| --- | --- |
| Multi-tenant? | **One install per company.** No tenant column on shared tables. |
| Custom tokens | **Extensible by the buyer**, in their own namespace so a future core token cannot collide. |
| Service icons | **Lucide** — already a dependency, already draws the navigation. Uploaded marks are rasterised to PNG, not inlined as SVG. |
| Module trimming | **Hide, one build.** The flag gates the API router — a disabled module returns 404. |
| Re-running setup | **Every step re-openable**, no data loss, behind a warning naming what it overwrites. Reference pattern and personnel-ID scheme lock once data exists. |
| Shipped content | **Clean slate.** No templates, categories, managers or sample data. |
| Atomic apply | **No apply.** Each step writes as it goes; the last step is a test document, not a commit. |
| Vault retention | Access logging moved into step 8 as default-on. Encryption at rest: rely on full-disk, verified in step 1. Purge rule: configurable, default never. |

## What the three-reviewer pass changed

A product/UX, a security/data, and a deployment/support reviewer read the
mockup, the plan and the importer against the real codebase. Every claim cited
below was independently verified before acting on it.

**A real bug in the importer, with a proof of failure.** Rule 2 matched
document numbers by substring containment, so a roster row whose passport
column read `N/A` squashed to `NA` and claimed every file with "na" anywhere in
its name — reported as a confident match, indistinguishable in the report from a
correct one. A passport numbered `123456` also claimed scans of `1234567`.
Fixed by whole-token matching plus an unusable-key filter; verified that all
three proven misfiles now fail and every legitimate match survives.

Also fixed in the same pass: path traversal via a crafted employee ID (guard
added to `Vault.normalize_g_number`, which the importer reached past); symlinks
being dereferenced and copied (a link named `*.pdf` pointing at the database was
copied into the vault as a passport scan); a `--move` run with a typo in the
second folder deleting sources and then dying before writing its report;
re-runs silently duplicating every file; rule 3 walking above the scan root;
rule 1 being dead for any non-`G` ID scheme; and the report being world-readable
plaintext mapping names to passport numbers.

**Three gaps in the wizard that were not small.**

1. *"A template becomes a service" had no path behind it.* Services are five
   parallel hard-coded registries today, and `DocxEngine.fill()` raises
   `KeyError` for anything not in them. Token names alone cannot yield field
   types, Arabic labels, required flags or option lists. Step 4 is now a field
   designer and is openly the longest step.
2. *Uploaded forms recorded nothing.* Whether a document creates a leave or
   violation row is decided by frozensets of **our** template names, so a
   buyer's own leave form would generate a DOCX and leave the Leave module
   permanently empty while switched on. Step 4 now asks what each document
   *does*, and step 6 (modules) moved after it and pre-ticks from the answers.
3. *Nothing configured who signs or who logs in.* The token dictionary
   advertised `{{ manager_name }}` / `{{ manager_title }}` / `{{ manager_sig }}`
   and nothing created a signatory, so day one printed blank signature blocks;
   and the wizard created exactly one account for 318 people. New step 8 covers
   signatories, approvers, per-record document access, view logging, and
   accounts — with two administrators required to finish.

**Also corrected:** the install check verified Python and Word but not the
hostname, TLS, backups or disk encryption — the four things a buyer discovers
the hard way; setup had no access control at all before the first admin existed,
while account registration promotes the first caller to administrator (now a
one-time setup token); "twenty minutes" became "an afternoon"; a hand-drawn
45-icon set was dropped for Lucide; the SVG "sanitiser" was replaced with
server-side rasterisation; and the manager heuristic that infers authority from
English job-title substrings was removed from the buyer build.

## Blocking work, in order

The previous version of this plan deferred all backend work behind the
token-loop question. That was wrong: the questions it waited on are
product-surface questions, while the items below are substrate and are
independent of every answer.

1. **Move templates out of the code tree.** `settings.templates_dir` resolves to
   git-tracked `backend/templates/`, including `_fields.json` — the exact file
   the field designer writes — and `mng.ps1` upgrades via `git pull --ff-only`.
   As designed, every upgrade after the first template edit is a merge conflict
   on a customer's production server. Move to `data_dir/templates/` (the
   precedent already exists in `book_template_service`) and resolve templates
   through a database row rather than the frozen `TEMPLATE_FILES` mapping.
   This is the largest single code change the white-label needs.
2. **Stop shipping as a git clone.** Delivering the repo hands customer two the
   full history — customer one's forms, constants and internal plans. Ship the
   PyInstaller build `scripts/build.ps1` already produces.
3. **Clean slate is a migration, not a constant.** `0004` seeds twelve GSSG
   categories into every fresh database and `0032` seeds correspondence
   categories as undeletable system rows.
4. **A scripted install that writes `.env` before registering the service.**
   `config.py` defaults port to 0 and `serve.py` raises on 0, so a
   correctly-followed install with no `.env` crash-loops silently. Nothing
   copies `.env.example`; no installer sets NSSM environment.
5. **Backup coverage and a restore script.** `backup_service` copies six
   subtrees and misses `.email_key` and `.vapid_key` (both at data-dir root),
   `book_templates/`, `.env` and the Caddy CA. There is no restore path at all.
6. **A tenant profile with a `schema_version`,** stored in the database so it
   lands in backups, with the export allow-list enforced in the schema.
7. **The existing customer's migration.** This repo *is* one company's live
   install, and the wizard assumes an empty database — so they could never run
   it and would stay permanently on a different path from every buyer. A
   backfill that synthesises their profile from the current constants is the
   honest test of the design: if it cannot describe an install that exists, it
   will not describe the third one either.
8. **Module gating at router registration,** with a test asserting 404 for every
   route of every disabled module. Built in the natural order this ships
   nav-hidden-but-API-live, which is the hole the design explicitly warns about.

## Open questions

1. **Repeating rows.** A single token cannot express "one row per employee".
   Loop syntax exposed to buyers, or multi-row documents stay unavailable.
2. **Calculated fields.** Gratuity derived from joining date and salary, or
   typed by a human? A formula means shipping a small expression language.
3. **Leave policy is hard-coded UAE labour law** — probation, accrual, caps,
   sick days, and a leave-type vocabulary including "National Service". A buyer
   in another country silently inherits it. Also: day counting is calendar days,
   so the weekend setting in step 2 currently does nothing.
4. **Per-unit document access, or per-record rules?** Per-unit fits the existing
   capability model; per-record is a permissions engine.
5. **Batch id on imports.** The importer writes no database rows for what it
   files, so there is nothing to attach an undo to. Change before the first
   real handover.
6. **Support ceiling.** Realistically three to five installs before upgrades and
   diagnosis consume a person; fifteen to twenty with a scripted install, a real
   restore, a support bundle and a working update check (`check_for_updates` is
   a stub that returns "no update" forever).

## Not fixed, deliberately

`Vault.normalize_g_number` still force-prefixes `G` onto every path, so an
employee whose ID is `3300` files to disk under `G3300`. Changing it would move
the live install's vault paths, so it needs a decision and a migration rather
than a quiet edit. It is the reason step 7 warns that "free text" IDs weaken
scan matching.
