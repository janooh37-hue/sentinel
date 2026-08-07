# White-label first-run configuration — plan

**Mockup:** `docs/first-run-setup-wizard.html`
**Working script:** `scripts/bulk_import_ids.py` (real, tested — not a mockup)

## Outcome

Turn this single-tenant build into an install that a second company can stand up
themselves in about twenty minutes: identity and branding, reference numbering
and barcode symbology, which modules survive, which services appear and with
what emoji, the token dictionary their Word templates are written against, the
employee roster, and a bulk import of passport / national-ID scans matched by ID
number.

## What is hard-coded today

Every one of these is a constant that has to become a tenant setting:

| Today | Where | Becomes |
| --- | --- | --- |
| `COMPANY_NAME`, `WEBSITE`, `PROJECT_LOCATION` | `core/constants.py` | Identity step |
| `"GSSG:"` barcode payload prefix, Aztec-only | `core/qr.py` | Numbering step |
| 21 entries in `TEMPLATE_FILES` | `core/constants.py` | Templates step |
| 12 entries in `DEFAULT_CATEGORIES` | `core/constants.py` | Numbering step |
| `DEFAULT_MANAGER_NAME` / `_TITLE` | `core/constants.py` | Managers (existing UI) |
| `G`-prefix normaliser on every vault path | `core/vault_manager.py` | Roster step |
| Emoji per service | `frontend/src/lib/quickActions.ts`, `pages/application/formEmoji.ts` | Services step |
| Fixed navigation with every module always present | `components/shell/*` | Modules step |
| `GSSG_` env prefix, `gssg.lan` public base URL | `config.py` | Identity / deploy |

## Shape

Ten steps, resumable, with a saved draft (`setup.draft.json`) after each one.
The app is locked until the wizard finishes. Steps 8 and 9 are skippable.

1. Welcome & install check — fail on a broken host before anything is written
2. Company identity — names, logo, colours, locale
3. Reference numbering & barcode symbology
4. Modules to keep
5. Services & emoji
6. Templates & the token dictionary
7. Employee roster
8. Bulk passport / ID scan import *(optional)*
9. Communications *(optional)*
10. Administrator account, review, apply

## Recommendations going in

- **One install per company.** Multi-tenancy on shared tables is roughly ten
  times the work and buys nothing for a LAN product that already ships as a
  Windows service.
- **Hide modules, do not fork the build.** One artefact, one test matrix. The
  flag must gate the API router, not just the menu — a hidden route that still
  answers is a security hole, not a cosmetic one.
- **Lock the company code after the first document is generated.** It is baked
  into every reference number and barcode payload; a live install cannot
  renumber its history.
- **Never guess on identity documents.** The bulk importer matches on ID number
  or filing folder only. Fuzzy name matching and OCR are deliberately absent
  from the shipped script — filing a passport under the wrong person is worse
  than not filing it.
- **Ship Aztec and QR only.** Every extra symbology is another encoder
  dependency, another print-quality test and another scanner failure mode.

## Bulk importer — as built

`scripts/bulk_import_ids.py` takes one folder per document kind and files each
scan into the employee's vault through the same `Vault` the app writes through.
Dry-run by default; `--apply` copies, `--move` deletes the source afterwards,
`--report` writes a per-file CSV.

Rules are tried in order and the first one resolving to *exactly one* employee
wins. Ambiguous keys are dropped from the index entirely rather than resolved to
the first row:

1. `id` — personnel ID in the file name (`G3082_passport.pdf`). Bounded so
   `IMG3082.jpg` does not read as employee G3082.
2. `doc` — document number for that folder's kind, separator-insensitive, so
   `784-1990-1234567-1` and `784199012345671` both match.
3. `dir` — a parent folder named after the personnel ID (`Passports/G3082/…`).

Verified end to end against a seeded database: 5 of 8 fixture files filed across
both kinds and all three rules, with the `IMG3082.jpg` decoy correctly rejected.

## Open decisions

These need answers before implementation. The mockup carries them per step; the
five that actually block work:

1. **Are tokens extensible by the buyer?** If a company needing
   `{{ gratuity_amount }}` has to wait for a release, this is not a white-label
   product. Making setup define custom fields that appear as form questions is
   the single largest item on this plan and probably decides whether it sells.
2. **Emoji or a bundled SVG icon set?** Emoji render differently on Windows 10,
   Windows 11, Android and iOS — the same tile does not look the same on the
   office PC and the guard's phone, and they print badly into DOCX.
3. **Does the wizard have an edit mode?** Re-running any step on an install that
   already holds data roughly doubles the work. Create-only is much cheaper and
   means a rebrand is a support job.
4. **How atomic is Apply?** Database rows roll back; copied scans and generated
   icons do not. Proposal: transactional database, best-effort files, cleanup
   log — needs sign-off.
5. **Retention on the vault.** Passport scans on an office server may need
   at-rest encryption, a per-file access log and automatic purge after an
   employee leaves. That is likely a legal requirement, not a feature.

## Implementation boundary

This pass delivers the mockup, the plan and the working importer. No backend
setting, route or migration is introduced until the five decisions above are
answered.
