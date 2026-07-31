# Records — a category per service

**Date:** 2026-07-30
**Branch:** `feature/records-service-categories`
**Worktree:** `.claude/worktrees/records-service-categories`

## Problem

The Records page's left rail claims to filter by form, but it filters by a
guess. `frontend/src/pages/books/formKind.ts` matches the first characters of
each record's `subject` string against six hard-coded English prefixes.

The office runs 19 services. Seven of them hit a prefix. The other twelve —
Administrative Leave, Violation, Warning, Clearance, Resignation, Leave Permit,
Salary Deduction, Report, Acknowledgment, and the rest — all collapse into
📄 "Other records", 131 rows of undifferentiated noise. There is no way to
filter to a Warning or a Violation at all.

Two defects ride along:

- **The page loads only the newest 500 of 629 records** (`BooksPage.tsx:92`
  requests `limit: 500`; `LIST_MAX_LIMIT = 500`). Every rail count and every
  status count is computed client-side over that truncated window, so they
  already disagree with the true total the page itself displays. Split into 17
  categories, this stops being cosmetic: a service whose records are all older
  than the newest 500 would show an empty list.
- **A Report shows the 📊 badge but files under Other.** `RecordsList.tsx:83`
  passes `template_id` into `formKindOf`; `BooksPage.tsx:276/320/333` does not.
  Same function, two answers.

Separately: the drafts card at `BooksPage.tsx:515` renders unconditionally
above the list whenever drafts exist, and cannot be dismissed.

## Decisions

### 1. A record's service is the template it came from

`template_id` on the record's version is the authoritative signal, and it
already ships to the frontend as `BookRead.current_template_id`
(`backend/app/schemas/book.py:281`). The rail simply ignores it today.

Verified on the live database: **no book has more than one distinct
`template_id` across its versions**, so "the book's template" is well-defined
without a newest-version subquery.

### 2. Version-less records resolve by an explicit alias table

365 of 629 live records are v3 imports with no `book_versions` row at all, so
they have no template id. Their subjects were machine-written and hold exactly
**13 distinct heads**. Ten are already verbatim `TEMPLATE_FILES` keys. Three
need an alias:

| Legacy subject head | Rows | Resolves to |
|---|---:|---|
| `Resignation Form` | 8 | `Resignation Letter` |
| `كتاب عام` | 1 | `General Book` |
| `تصاريح الامنية` | 1 | *(none — Other)* |

`Resignation Form` is the dead key in `FORM_TYPE_SUBFOLDER`
(`constants.py:138`); it is not a real template.

An explicit alias map is both smaller and more correct than a generic prefix
scan — a generic scan gets all three of these wrong.

**The subject fallback applies only to records with no versions.** A record
that has a version whose `template_id` is unknown resolves to Other; it does
not fall back to subject text. This keeps modern records off the guessing path
permanently.

Prefixes are matched **longest-first**, so `Passport Release List` wins over
`Passport Release Form` for a subject that starts with both.

### 3. The rail shows 17 services + All + Other, hiding empties

The two companion templates — `Resignation Declaration` and `Leave Undertaking`
— are excluded. They are never standalone papers; they auto-attach to a parent.
`COMPANION_TEMPLATE_IDS` (`constants.py:167`) already encodes this and
`list_templates()` already filters on it. `resolve_service` maps a companion
template id to Other, so no special-casing is needed downstream.

A service with zero records is not rendered, matching today's behaviour.

Projected rail on current live data (628 of 629 records land in a named
service):

| Service | Count | | Service | Count |
|---|---:|---|---|---:|
| Leave Application Form | 275 | | Resignation Letter | 10 |
| Duty Resumption Form | 88 | | Salary Transfer Request | 9 |
| Violation Form | 62 | | Material Request Form | 9 |
| HR Request Form | 61 | | Warning Form | 7 |
| General Book | 32 | | Report | 6 |
| Administrative Leave Form | 27 | | Leave Permit Form | 6 |
| Employee Clearance Form | 18 | | Salary Deduction Form | 3 |
| Passport Release Form | 12 | | Acknowledgment Form | 3 |
| | | | **Other** | **1** |

`Passport Release List` has no records and stays hidden.

### 4. Counts come from the whole table; the status spine scopes to the service

The rail's per-service counts are global — over every non-deleted record, never
a page window. The status counters (Draft / Pending / Approved / Returned /
Rejected) scope to the selected service: picking Leave Application answers "how
many leave requests are waiting" in one click. With All selected they are
global, which also fixes their current 500-row truncation.

The "All" rail count and the page's existing `books.pageMeta` total must be the
same number.

### 5. Selecting a service filters on the server

`GET /books` gains a `service_id` parameter. The current unfiltered 500-row
fetch stays for the All view; picking a service issues a scoped request, so the
list is complete regardless of how many years of records accumulate.

## Architecture

### Backend

**`backend/app/core/form_kind.py`** (new) — the single definition of the rule.

```
OTHER_SERVICE_ID = "other"
LEGACY_SUBJECT_ALIASES: dict[str, str]   # legacy head -> template id
SERVICE_IDS: list[str]                    # TEMPLATE_FILES keys minus companions
resolve_service(subject: str | None, template_id: str | None) -> str
```

Pure functions over `TEMPLATE_FILES` and `COMPANION_TEMPLATE_IDS`. No I/O, no
session.

**`BookRead.service_id`** — a computed field beside the existing
`current_template_id`, so the frontend never re-derives the rule. Resolution
uses the newest version's `template_id`, falling back to the record's stored
subject only when the record has no versions.

**`GET /api/v1/books?service_id=…`** — `book_service.list_books` gains the
parameter. The SQL clause is generated from the same alias table that drives
`resolve_service`:

```
named(X)  :=  book has a version with template_id == X
              OR (book has no versions AND subject LIKE '<any alias of X>%')
other     :=  AND(NOT named(X) for every X in SERVICE_IDS)
```

Expressing `other` as the literal negation of the generated named clauses makes
the two buckets provably complementary — no record can fall into both or
neither.

**`GET /api/v1/books/facets`** (new) — one query, one payload, no parameters:

```
{
  "all":      { "count": 629, "states": { "none": n, "pending": n, … } },
  "services": [ { "id": "Leave Application Form", "name_en": …, "name_ar": …,
                  "count": 275, "states": { … } }, … ]
}
```

Services are ordered by `TEMPLATE_FILES` order with Other last, and carry the
`name_en` / `name_ar` already in `_fields.json` so the frontend needs no second
request. Implemented as a single grouped select over `books` left-joined to
`book_versions`, bucketed through `resolve_service`.

Because the whole payload is per-service *and* per-state, switching rail
selection needs no refetch — the frontend derives both the rail and the spine
from it.

### Frontend

**`formKind.ts` shrinks to a label/glyph helper.** The `FORM_KINDS` prefix
table, `OTHER_KIND`, `GENERAL_BOOK_KIND`, `REPORT_KIND` and `formKindOf` are
deleted. Rows read `row.service_id`. Glyphs come from the existing
`emojiForTemplate()` (`pages/application/formEmoji.ts`), which already covers
all 19 templates — no new icons. `subjectEmployeePart` is unchanged and stays.

**`FormRail`** renders from `/books/facets`. `RailItem.labelKey` becomes a
resolved `label` string (the facets payload carries both languages); the
`states` mini-dots keep working, sourced from the payload's state map rather
than a client scan.

**`BooksPage`** derives `railItems` and `spineCounts` from facets instead of
`allRows`, and passes `service_id` to the list query when a service is
selected.

**Locale keys:** only `books.formKind.all` and `books.formKind.other` remain
needed; the 17 service labels come from `_fields.json`. The per-form keys
`books.formKind.{leave,salary,duty,hr,passport,material,generalBook,report}`
are removed from `en.json` and `ar.json` together.

**Mobile** (`BooksFilterBar`) gains a **Service** popover mirroring the rail.
It is deliberately not called "Category": that word is already taken in the
same bar by `categoryIds`, which means the 12 ref-number buckets in
`book_categories` — an unrelated concept. New keys `books.filters.service` /
`النموذج`.

### Drafts card — collapsible

`BooksPage.tsx:515-556` becomes a native `<details>` element, **collapsed by
default**. Collapsed it is a single `<summary>` line showing the count; expanded
it is today's card unchanged, including the "+N more" link. No new state, no
persistence, keyboard and screen-reader behaviour for free.

The drafts *filter pill* at `BooksPage.tsx:478` is unaffected.

## Behaviour changes to expect

- Unclassified General Books move from Other into General Book. The old
  `general_book` kind was selected by `classification_code`; template identity
  supersedes it, and both classified and unclassified General Books now share
  one entry.
- Reports get their own rail entry instead of hiding in Other, and the badge /
  rail disagreement disappears.
- Other drops from 131 records to 1.
- Status counters change when the rail selection changes.
- Drafts start collapsed.

## Testing

Backend:

- `resolve_service` unit table: each of the 17 templates by `template_id`; each
  of the 13 legacy subject heads; both companions → Other; versioned record
  with unknown template → Other (not subject fallback); longest-prefix
  disambiguation of the two Passport templates; empty and NULL subject.
- **Agreement test** — the SQL filter and the Python resolver are two
  expressions of one rule, so a test asserts they agree: for a fixture set
  covering every service plus legacy and unknown shapes, the set of ids
  returned by `list_books(service_id=X)` equals the set of ids whose
  `resolve_service` is `X`, for every X including Other.
- Facets: counts sum to the total; every record lands in exactly one bucket;
  state maps agree with a direct query.
- `list_books(service_id=…)` returns rows past the 500 window.

Frontend:

- Rail renders one item per non-empty service, All first, Other last, empties
  hidden.
- Selecting a service issues a `service_id`-scoped list request.
- Status counters reflect the selected service.
- Drafts card is collapsed on mount and expands on click.
- **Arabic assertions under `lng=ar`** for every new label, not English —
  English-only i18n tests cannot catch an AR leak when the English label equals
  the key.

## Out of scope

- `LIST_MAX_LIMIT` and pagination of the All view stay as they are. Server-side
  service filtering removes the truncation where it now matters; paging the
  full register is a separate change.
- The 12 `book_categories` ref-number buckets are untouched.
- The `FORM_TYPE_SUBFOLDER` dead `Resignation Form` key and the
  `ADMIN_TYPES` / `_fields.json` category drift are noted but not fixed here.

## Gates

- `/sync-api-types` after the schema and route changes — a new field, a new
  parameter and a new endpoint all cross the contract.
- `i18n-rtl-reviewer` after the label work.
- Backend `pytest` + `ruff` + `mypy --strict`; frontend `vitest` + `eslint` +
  `tsc -b`.
