# Scan-back reminder — push, dock, and a page to clear them from

**Date:** 2026-08-05
**Surfaces:** app shell (new modal + dock), new route `/scan-back`, bell counts, Web Push
**Reported by:** operator ("operators often forget to scan back to the app — they scan to their computer but never add it")

## Problem

A form printed for wet-ink signature parks its record in `approval_state='awaiting_scan'`.
Uploading the signed scan is what closes it: `book_service.add_attachment` with
`as_signed=true` flips the record to `approved` (`book_service.py:1414-1421`).
Nothing anywhere reminds anyone to do that upload.

Measured against the live database (`data/gssg.db`, 2026-08-05):

| Symptom | Measured evidence |
|---|---|
| Records stranded in `awaiting_scan` | **29** (vs 525 `none`, 279 `approved`, 3 `pending`, 1 `returned`) |
| How long the ones that *do* get filed take | **same day** — 25 of the last 30 signed within 0–1 day of creation |
| So anything past a day is genuinely forgotten | **25 of the 29** are older than 24h |
| Oldest | **40 days** — `GS-0410`, `GS-0411`, both Acknowledgment Forms from 2026-06-25 |
| Shape of the backlog | 4 over a month, 6 at 3–4 weeks, 5 at 1–2 weeks, 10 under 3 days |
| Kind of paper | Almost all NAT Violation / Warning forms |
| Who generated them | Hamdan (manager) **19** · Ahmed (admin) **6** · Abdullah (operator) **4** |

The existing surfaces do not reach anyone:

- The Books page has an `awaiting_scan` facet with a live count
  (`serviceLabels.ts:109`, `StatusSpine.tsx:25`) — passive, and 40-day-old
  records prove nobody reads it.
- `submitted_by_user_id` is NULL on all 29, so no existing per-user query finds them.
- The Scan Inbox pipeline (`scan_inbox_service.py`) only ingests **email
  attachments**. It never sees a file scanned to someone's own PC.

## Root cause

Scan-to-email used to be the office method and it is currently broken; scanning
is now USB-drive-to-own-PC. The app used to receive scans automatically through
the mailbox poll → OCR triage → Scan Inbox path. That pipe died and the habit
died with it.

**Restoring scan-to-email is an MFP/IT fix outside this app, and it is the real
cure.** This spec covers the in-app half: getting the file off the operator's
PC and into the record once it is already there.

## Decisions

Confirmed with the operator:

1. **All three surfaces ship**, wired as one system: A interrupts, D sits there
   all day, E is where both point.
2. **A fires once a day**, first load, and is dismissible.
3. **E has a Mine / Everyone toggle**, Everyone gated on `books.manage`.
4. **Threshold is 24 hours.** Anything printed more than a day ago nags.
5. Targeting is **per person — whoever generated the paper**, not per role.
   Two-thirds of the backlog belongs to a manager, not an operator; a
   role-based rule would miss it.

Accepted risk on (4): a paper printed Thursday afternoon and legitimately still
with the manager will nag on Friday. `SCANBACK_STALE_HOURS` is a module
constant — raising it is a one-line change if the false alarms annoy people.

## Explicitly out of scope

- **No new table and no migration.** Every piece of state this needs already
  exists (`books.approval_state`, `book_versions.created_by_user_id`,
  `push_sent`) or belongs in `localStorage` (A's daily dismissal, D's
  open/closed).
- **No new scheduler job.** The 5-minute push notifier
  (`scheduler_service._run_push_notifier`) already walks every active user; this
  rides it as one more `kind`.
- **No changes to the upload path.** `api.addBookAttachment(id, file, true)` and
  the `awaiting_scan` flip behind it are correct and stay untouched. Every new
  surface calls the same thing `useAddScan.fileSignedCopy` already calls.
- **No dashboard widget.** `BooksAwaitingWidget` returns `null` without
  `books.approve`, which operators do not hold — copying that pattern would
  build something invisible to the people who need it.

---

## Section 0 — The shared query

Everything below reads from one function.

```python
# backend/app/services/book_service.py
SCANBACK_STALE_HOURS = 24

def list_awaiting_scan(
    db: Session, *, user_id: int | None, stale_hours: int = SCANBACK_STALE_HOURS
) -> list[Book]:
    """Books stuck at `awaiting_scan` past the stale line.

    `user_id=None` returns every user's (the Everyone tab); otherwise only books
    whose CURRENT version was created by `user_id`.
    """
```

Three things this must get right:

**Attribution is the current version's `created_by_user_id`.** All 29 live rows
have exactly one version with `trigger='initial'`, so today that is simply the
person who generated the paper. It stays correct after a revision: a revised
Violation goes back to `awaiting_scan` (`document_service.py:1518-1519`) and
stamps a new version — the reviser is the one now holding the paper.
`submitted_by_user_id` is NULL on this path and must not be used.

**The cutoff compares against local time, not UTC.** `Book.created_at` is
stamped with a naive local `datetime.now()` by `document_service`, unlike
`Document.created_at` — this is the +4h bug fixed in `f111177` and it is easy to
reintroduce. Compare against `datetime.now()`, never `datetime.now(UTC)`.

**Filter `deleted_at IS NULL`**, mirroring `list_awaiting` (`book_service.py:955`).

Mirror the existing route pattern with `GET /api/v1/books/awaiting-scan`
(`scope=mine|all`, `all` gated on `books.manage` in `api/v1/books.py`).

## Section 1 — Bell and push

**Bell.** `NotificationCounts` (`backend/app/schemas/notifications.py`) gains
`scanback: int`; `notification_service.relevant_counts` fills it from
`list_awaiting_scan(db, user_id=user.id)`. The SSE stream and the
`['notifications','counts']` query already carry whatever this schema holds, so
the count reaches the client for free.

**Push.** `notification_service.actionable_items` appends one item per stale
record:

```python
ActionableItem("scanback", f"book:{b.id}", f"/books/{b.id}", b.ref_number,
               subject=b.subject)
```

`scheduler_service` gains `_KIND_META["scanback"] = "/scan-back"` and a
`_scanback_push` alongside `_scan_push`/`_doc_push`:

> **1 record** — `Signed copy not filed · NAT-0612 — Violation Form` / `Scan it into the record`
> **N records** — `25 records waiting for their signed copy`
> **AR, 1** — `لم تُرفع النسخة الموقّعة · NAT-0612 — نموذج مخالفة` / `امسحها وأرفقها بالسجل`
> **AR, N** — `٢٥ سجلاً بانتظار نسختها الموقّعة`

**The first run will not spam.** `_notify_user` (`scheduler_service.py:293-312`)
groups new items by kind and sends **one** push per kind. The existing 25-record
backlog produces a single notification each to Hamdan, Ahmed and Abdullah — not
25 pings. After that, `push_sent` dedup fires once per newly-stale record and
`prune_sent` forgets records once they are filed.

## Section 2 — A · the daily gate

A Radix dialog in the app shell, on first load of the day when the user has ≥1
stale record.

- **Shows the three oldest, not all of them.** A wall of 25 rows reads as
  unfixable; three reads as a task.
- Header: *"25 records are waiting for their signed copy"* / *"You printed these
  but the scan never made it back. The three oldest:"*
- Each row: ref chip · subject · age (red ≥30d, amber ≥14d, grey under) · **Upload**.
- Footer: **View all 25** → `/scan-back`, and **Not now** → dismiss. A `×` in the
  corner does the same as Not now.
- Dismissal: `localStorage['scanback-gate-dismissed'] = '<user_id>:<YYYY-MM-DD>'`.
  Per-user so a shared browser does not silence the next person; per-day so it
  returns tomorrow.
- Uploading the last stale record closes the dialog and it does not return.

## Section 3 — D · the dock

Rendered by the shell whenever the count is above zero; nothing at zero.

- **Collapsed:** a pill anchored bottom-end — pulse dot, count, `to scan back`,
  caret. `inset-inline-end` so it flips in RTL.
- **Expanded:** a 322px panel above the pill — header with **View all N →**, then
  the six oldest, each a row (ref · subject · age) over a full-width drop target.
  Scrolls at 236px.
- Open/closed persists in `localStorage['scanback-dock-open']`.
- **Mobile:** `BottomTabBar` is `fixed inset-x-0 bottom-0 z-40`
  (`BottomTabBar.tsx:15`). The dock must sit above it — `bottom` offset by the
  tab-bar height plus `env(safe-area-inset-bottom)`, and below `z-40`.
- Hidden entirely on `/scan-back` — the page is the dock, expanded.

## Section 4 — E · the scan-back page

New route `/scan-back` in `App.tsx`, and a `NAV_ITEMS` entry
(`navItems.ts`) with a live count badge — icon `Printer` or `ScanLine`, key
`nav.scanBack`. No `cap` gate: anyone who can create a record can strand one.

- Header: title + count chip, one line of copy, then controls — a scope toggle
  **Mine** (default) / **Everyone** (`books.manage` only), and a sort toggle
  **Oldest first** (default) / **Newest first**. Scope and sort are independent;
  sort reorders within each age group, it does not dissolve the grouping.
- **Grouped by age**, so the 40-day items cannot hide behind the 5-day ones:
  *Over a month* / *Two to four weeks* / *This month*. Group header carries its
  own count.
- Each row: ref chip · subject · age · drop target. Rows ≥30 days get a
  `border-inline-start` accent.
- Dropping or picking a file calls `api.addBookAttachment(id, file, true)` — the
  same call as `useAddScan.fileSignedCopy` (`useAddScan.ts:86-98`). No OCR ref
  matching: the operator opened this record deliberately, and the code already
  documents that OCR cannot re-read a stamped ref off a gov-form scan
  (`GS-0333` → `"65-3"`, `useAddScan.ts:80-85`).
- On success the row leaves the list and every count updates —
  invalidate `['books']`, `['books','awaiting-scan']`, `['notifications','counts']`.
- Empty state: *"Nothing waiting — every signed copy is filed."*

## i18n

Every string in both `frontend/src/locales/en.json` and `ar.json` under
`scanBack.*`, plus `nav.scanBack`. Logical CSS only (`ms-`/`me-`,
`text-start`, `inset-inline-end`) — the dock and both panels are position-anchored
and will land on the wrong side in Arabic otherwise.

Push copy lives in `scheduler_service._scanback_push`, matching how
`_scan_push`/`_doc_push` already hold their EN/AR pairs.

## Testing

**Backend**
- `list_awaiting_scan` boundary: a record 23h old is absent, 25h old is present.
- Attribution: another user's stale record is absent for `user_id`, present for
  `user_id=None`.
- Local-time cutoff: a `Book.created_at` written as naive local is not shifted
  4h — this is the regression that `f111177` fixed.
- Filing the signed copy removes the record from the list.
- `scope=all` is rejected without `books.manage`.

**Frontend**
- Gate renders with ≥1 stale record and not at zero; dismissal writes the
  per-user per-day key and suppresses a re-mount the same day but not the next.
- Dock hidden at zero; expand/collapse persists.
- `/scan-back` groups by age and hides Everyone without `books.manage`.
- **Assert the Arabic string under `lng=ar`, not just the English.** An
  English-only i18n test cannot catch an AR leak when the EN label equals the
  key — that is exactly how the leave-type leak shipped green (`c0db9fb`).

## Files

**Backend** — `services/book_service.py` (new query + constant),
`services/notification_service.py` (both functions), `schemas/notifications.py`
(one field), `api/v1/books.py` (one route), `services/scheduler_service.py`
(`_KIND_META` + `_scanback_push`), plus tests.

**Frontend** — new `pages/scanBack/ScanBackPage.tsx`, `ScanBackGate.tsx`,
`ScanBackDock.tsx`, `useScanBack.ts`; edits to `App.tsx`,
`components/shell/navItems.ts`, `components/shell/NavBellPopover.tsx`,
`lib/api.ts`, both locale files, plus tests.

**Contract** — re-sync `backend/openapi.json` + `frontend/src/lib/api.types.ts`
after the schema and route change (`/sync-api-types`), and commit them together.
`mng build` uses the committed types and does not regenerate.

## Mockups

- `docs/scanback-reminder-mockups.html` — the five surfaces considered, with the
  trade-offs that led here.
- `docs/scanback-reminder-flow.html` — A → D → E wired together, EN and AR.
  Layout and copy in this spec match it. **The counts do not**: the mockup was
  built against a 2-day threshold (19 records) before the 24h decision (25).
  Nothing in the build should hardcode either number.
