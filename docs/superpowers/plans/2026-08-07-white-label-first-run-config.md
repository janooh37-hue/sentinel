# White-label first-run configuration — plan

**Mockup:** `docs/first-run-setup-wizard.html`
**Working script:** `scripts/bulk_import_ids.py` (real, tested — not a mockup)

## Outcome

Turn this single-tenant build into a product a second company can stand up
themselves: identity and branding, reference numbering and barcode symbology,
which modules survive, the buyer's own Word templates and the tokens they need,
the services derived from those templates, the employee roster, and a bulk
import of passport / national-ID scans matched by ID number.

## Decisions taken (2026-08-07 review)

| Question | Decision |
| --- | --- |
| Multi-tenant? | **One install per company.** No tenant column on shared tables. |
| Custom tokens | **Extensible by the buyer.** A custom field becomes a token, a form question and a reportable column, with no release from us. |
| Service icons | **Bundled SVG set, not emoji.** Emoji render per-OS and print badly into DOCX. Buyers may upload their own SVG. |
| Module trimming | **Hide, one build.** The flag gates the API router — a disabled module returns 404, not just an empty menu. |
| Re-running setup | **Every step re-openable after go-live**, no data loss, behind a warning naming exactly what it overwrites. Only the reference *pattern* locks, once documents carry numbers. |
| Shipped content | **Clean slate.** No templates, categories, managers or sample data ship. Our internal-only forms and site-specific modules are excluded from the buyer build entirely. |
| Vault retention | **Open.** See below. |

## What is hard-coded today

Each of these becomes a tenant setting or is dropped from the buyer build:

| Today | Where | Becomes |
| --- | --- | --- |
| `COMPANY_NAME`, `WEBSITE`, `PROJECT_LOCATION` | `core/constants.py` | Identity step |
| `"GSSG:"` payload prefix, Aztec-only | `core/qr.py` | Numbering step |
| 21 entries in `TEMPLATE_FILES` | `core/constants.py` | **Dropped.** Buyer uploads their own. |
| 12 entries in `DEFAULT_CATEGORIES` | `core/constants.py` | **Dropped.** Buyer defines their own. |
| `DEFAULT_MANAGER_NAME` / `_TITLE` | `core/constants.py` | **Dropped.** |
| `G`-prefix normaliser on every vault path | `core/vault_manager.py` | Roster step — configurable scheme |
| Emoji per service | `lib/quickActions.ts`, `pages/application/formEmoji.ts` | **Replaced** by the SVG icon library |
| Fixed navigation, every module always present | `components/shell/*` | Modules step |
| `GSSG_` env prefix, `gssg.lan` base URL | `config.py` | Identity / deploy |
| Site-specific modules (inmate violations, duty locations) | various | Excluded from the buyer build |

## Shape

Ten steps, resumable, saved to `setup.draft.json` after each. Templates are
uploaded (step 5) *before* services are configured (step 6), because a service
is now derived from a template rather than picked from a fixed list.

1. Welcome & install check — including an explicit "what ships / what you provide" split
2. Company identity — names, logo, colours, locale
3. Reference numbering & barcode symbology
4. Modules to keep
5. **Your templates & tokens** — upload `.docx`, scan for tokens, define custom fields
6. **Services & icons** — one service per uploaded template
7. Employee roster
8. Bulk passport / ID scan import *(optional)*
9. Communications *(optional)*
10. Administrator account, review, apply

## Bulk importer — as built

`scripts/bulk_import_ids.py` takes one folder per document kind and files each
scan into the employee's vault through the same `Vault` the app writes through.
Dry-run by default; `--apply` copies, `--move` deletes the source afterwards,
`--report` writes a per-file CSV.

Rules are tried in order and the first one resolving to *exactly one* employee
wins. Ambiguous keys are dropped from the index rather than resolved to the
first row:

1. `id` — personnel ID in the file name (`G3082_passport.pdf`), bounded so
   `IMG3082.jpg` does not read as employee G3082.
2. `doc` — document number for that folder's kind, separator-insensitive, so
   `784-1990-1234567-1` and `784199012345671` both match.
3. `dir` — a parent folder named after the personnel ID (`Passports/G3082/…`).

No fuzzy name matching and no OCR guessing: a near-miss files someone's
passport under a colleague and nobody notices until it matters.

Verified end to end against a seeded database — 5 of 8 fixture files filed
across both kinds and all three rules, with the `IMG3082.jpg` decoy rejected.

## Open questions

Ordered by how much they block the build.

1. **Repeating rows in templates.** A single token cannot express "one row per
   employee". Handover lists and register tables need loop syntax
   (`{% for %}`) exposed to buyers, or they stay unavailable. This is the
   largest gap left in the extensible-token decision and it will surface in the
   first week of the first rollout.
2. **Calculated custom fields.** Someone will want gratuity derived from joining
   date and salary rather than typed. Allowing a formula means shipping a small
   expression language; refusing means every value is typed by a human.
3. **Vault retention** *(deferred in review)*. Split into answerable parts:
   is this a PDPL obligation or a product choice; encryption at rest (recommend
   relying on full-disk encryption and documenting that explicitly, rather than
   encrypting the vault and risking key loss); a per-file access log (add
   regardless — cheap now, impossible to reconstruct later); and a configurable
   purge-after-leaving defaulting to never. The same conversation covers the
   messaging-consent question in step 9.
4. **Re-import safety.** Update-by-ID overwrites hand-corrections. A warning is
   not a safeguard — should a re-import show a diff ("42 rows will change, here
   is what") before writing?
5. **Icon set provenance.** 45 marks are drawn in the mockup as a first pass.
   Licensing an open set (Lucide, Phosphor) is faster and more complete — is a
   third-party set acceptable in a product sold on?
6. **Atomic apply.** Database rows roll back; copied scans and generated icons
   do not. Proposal: transactional database, best-effort files, cleanup log.
7. **Second administrator required before finishing?** One admin plus one
   forgotten password equals a dead install, with no recovery on a LAN box that
   has no mail configured.

## Implementation boundary

This pass delivers the mockup, the plan and the working importer. No backend
setting, route or migration is introduced until questions 1–3 are answered —
they change the data model, not just the surface.
