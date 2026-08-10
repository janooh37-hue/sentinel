# Employee activity lookup and exact record deep links

**Date:** 2026-08-10  
**Status:** UI and workflow approved  
**Branch:** `feature/employee-activity`

## Goal

Improve the Employee page in two related ways:

1. replace the search input's unattractive dark focus stroke with a calm,
   accessible focus treatment around the complete white search pill; and
2. add a full-width, same-page activity section where staff can browse recent
   activity across all employees, narrow it by activity type, quickly find an
   employee by name or G-number, open that employee's profile explicitly, and
   open each activity's exact source record.

The Employee page remains the search-first employee hub. The new activity feed
is reached by scrolling; it is not a separate route or dashboard widget.

## Current problems

### Search focus is visually broken

`EmployeeSearchHero` removes the input's local outline with a Tailwind utility,
but the unlayered global `:focus-visible` rule in `frontend/src/index.css`
still wins in the cascade. On the white pill this produces the reported dark
stroke around the input text area. Removing focus visibility entirely would
violate the product's WCAG AA contract.

### Recent activity is not available across employees

The employee-detail aggregate builds a 20-item activity snapshot for one
employee. It cannot answer "what happened recently across all employees?" The
Dashboard exposes global recent documents and correspondence only; it omits
leave and violation records and its document rows currently open a general
employee profile rather than the exact record.

### Existing record links are inconsistent

Exact URL handoffs already exist for Books, Leaves, and Ledger:

- `/books?open=<book_id>`;
- `/leaves?open=<leave_id>`; and
- `/ledger?open=<ledger_entry_id>`.

Violations have no equivalent URL handoff. They live inside the employee-detail
Violations tab, and that tab is currently local React state rather than URL
state.

## Approved scope

### Included

- The existing Employee lookup route, `/employees`.
- A corrected focus treatment for the main employee search pill.
- The three existing hero windows, unchanged in purpose:
  - Recently opened files;
  - Documents expiring soon; and
  - Files with missing data.
- A new full-width **Recent activity** section below the navy hero.
- Four activity types tied to employees:
  - generated documents;
  - leave records;
  - violation records; and
  - correspondence/ledger entries.
- Default view: all recent activity, newest first.
- One activity-type selector whose default is **All activity**.
- Employee quick lookup by English name, Arabic name, or G-number, using the
  same employee search behavior as the hero search.
- Separate actions from an employee search result:
  - **Show activity** filters the feed to that employee;
  - **Open profile** navigates to the employee's general profile.
- Exact source-record navigation from every activity row.
- Incremental **Load more activity** pagination on the same page.
- Desktop and phone layouts, English/LTR and Arabic/RTL, light and dark themes.
- Generated FastAPI/OpenAPI/TypeScript contract updates.

### Excluded

- A new Activity route or a second activity page.
- Profile-edit, status-change, photo-change, deletion, or general audit history.
  The current database does not store immutable events for those changes.
- Treating record edits as new activity events. This feed represents record
  creation, not a full audit log.
- SMS/WhatsApp delivery activity.
- Global free-text search across activity summaries or correspondence bodies.
- Date-range controls, saved filters, export, realtime streaming, or polling.
- Database or Alembic changes.
- Replacing the existing per-employee Activity tab.
- Refactoring the Dashboard's recent sections.

## Locked product decisions

1. **Same page, full width.** The activity section sits below the hero and uses
   the Employee page's full content container. Staff scroll to it; no route
   change is required.
2. **Keep the hero stable.** The three current glass windows stay in the navy
   band. Activity does not become a fourth hero card.
3. **All recent activity is the default.** With no employee or type selected,
   the feed shows all supported employee activity newest first.
4. **One type filter.** A single selector starts at **All activity** and offers
   Documents, Leave, Violations, and Correspondence.
5. **Name or G-number lookup.** Quick lookup reuses the employee roster search,
   including English/Arabic names and G-number matching. It is not restricted
   to G-numbers.
6. **Profile navigation is explicit.** **Open profile** exists only in the
   employee match row/selected-employee control. Selecting an activity never
   falls back to the general profile.
7. **Every activity opens its source.** The complete activity row is a link to
   the exact document/book, leave, violation, or ledger entry represented by
   that row.
8. **Creation time defines recency.** Documents, leaves, violations, and ledger
   entries are ordered by their `created_at` timestamp. A leave's start date or
   a violation's effective date is record content, not the time the activity
   happened in the system.
9. **Load more, not page numbers.** The first 25 entries render initially. Each
   load appends the next 25 while keeping the current employee/type filters.
10. **No black input stroke.** The focused input itself has no outline. The
    entire search pill receives a visible soft ring so keyboard focus remains
    obvious and WCAG-compliant.
11. **No fabricated references.** Documents show their stored reference number.
    Other activity types show their stable record number (`#<id>`) unless the
    source already owns a real reference.

## User experience

### Page structure

The page remains one vertical scroll container:

1. navy Employee search hero;
2. Recently opened, Expiry, and Missing data windows;
3. light page background;
4. full-width Recent activity heading, controls, and feed.

The activity section uses the same maximum page width as the rest of the app,
not the narrower hero-card grid. It is visually separate from the glass cards:
a quiet light surface, hairline borders, restrained navy actions, and red only
for genuine warning semantics.

### Main employee search focus

When the hero search input receives keyboard or pointer focus:

- the input has no independent browser/global outline;
- the complete rounded white pill receives the focus treatment;
- the ring contrasts against both the white pill and navy hero;
- the search icon, text, and button do not shift; and
- results behavior is unchanged.

The implementation adds a component-specific unlayered CSS selector for the
input rather than weakening the global focus rule. The pill uses
`:focus-within` for its visible ring.

### Activity heading

The heading contains:

- **Recent activity / النشاط الأخير**;
- concise text explaining that the feed covers all employee records; and
- the current result count for the active filters.

The count is the server-reported total, not the number currently loaded.

### Quick employee lookup

The activity lookup is independent of the hero search because it filters the
feed instead of immediately navigating away.

- Placeholder: **Search by employee name or G-number**.
- Input is debounced by the existing 250 ms employee-search behavior.
- Matches show localized employee name, G-number, position, and status.
- Each match row contains two sibling controls:
  - **Show activity** selects the employee and refreshes the feed;
  - **Open profile** navigates to `/employees/<employee_id>`.
- The popup uses an accessible list of grouped controls; it does not nest
  buttons inside a `role="option"`.
- Arrow keys move through result rows, Escape closes the popup, and focus
  remains predictable when either action is chosen.

After **Show activity** is selected, the control displays the chosen employee
and a clear action. Clearing restores all-employee activity without changing
the activity-type filter. Changing the text after a selection starts a new
lookup; it does not filter by partial text server-side.

### Activity-type filter

A single labelled selector contains:

- All activity;
- Documents;
- Leave;
- Violations; and
- Correspondence.

Changing the type resets the loaded offset and requests the first 25 matching
entries. Changing or clearing the selected employee does the same.

### Feed

Desktop renders one full-width table-like list with these columns:

1. Employee — localized name and G-number;
2. Activity — localized structural action plus source title/summary;
3. Type — localized type badge;
4. Reference — stored document reference or stable record number;
5. Date and time — localized display of `created_at`;
6. Destination — explicit label such as **Open document**.

Rows are grouped by localized calendar day. Structural action text is
translated in the frontend; stored user content such as a correspondence
subject or violation description uses `dir="auto"` and is not machine
translated.

The whole row is one keyboard-focusable link. The visible destination label and
accessible name identify the exact target. There is no second profile link
inside the activity row.

### Exact destinations

- Document: `/books?open=<book_id>`.
- Leave: `/leaves?open=<leave_id>`.
- Correspondence: `/ledger?open=<ledger_entry_id>`.
- Violation:
  `/employees/<employee_id>?tab=violations&open=<violation_id>`.

Books, Leaves, and Ledger reuse their existing URL handoffs. Employee Detail
adds URL hydration for `tab=violations`, and the Violations tab scrolls to and
briefly highlights the exact violation identified by `open`. It does not
silently enter edit mode. Both manage-capable and read-only violation lists
support the highlight.

If a target is removed after the activity feed loads, the destination page owns
its existing not-found/error treatment. The activity page does not redirect to
a different record.

### Pagination and states

- Initial request: 25 rows.
- **Load more activity** appends 25 rows.
- The button is hidden when loaded count equals total.
- A loading skeleton preserves the table width.
- Empty all-activity state: no recent employee activity exists.
- Empty filtered state: no activity matches the selected employee/type, with
  clear actions for those filters.
- Request failure: inline error and Retry; the hero and its three windows remain
  usable.
- Employee-search failure: inline lookup error only; existing activity rows stay
  visible.

### Responsive and RTL behavior

At phone widths:

- heading and result count stack;
- employee lookup and type selector stack;
- each activity becomes one full-width record card;
- employee and time remain the first line;
- activity, type, reference, and exact destination follow in reading order;
- **Load more activity** is full width.

All spacing and alignment use logical properties. Arabic mirrors control order
and aligns text to the inline start. Dates, G-numbers, record IDs, and reference
numbers retain tabular/monospace treatment without reversing their characters.
The employee match popup and selected-employee state are verified at the same
viewport in LTR and RTL.

## Backend architecture

### API route

Add a static route before `/{employee_id}` in the existing employees router:

`GET /api/v1/employees/activity`

Query parameters:

- `employee_id: str | None` — exact employee selected by the frontend;
- `kind: document | leave | violation | ledger | None`;
- `limit: int` — default 25, minimum 1, maximum 100;
- `offset: int` — default 0, minimum 0.

The route requires `employees.view`, matching the Employee page and current
employee-detail aggregate. Ledger rows additionally obey the caller's existing
mail visibility rule: the caller sees their own email rows and shared non-email
correspondence, never another user's private email through this feed. Draft and
deleted ledger rows are excluded.

The static route must be declared before `/employees/{employee_id}` so FastAPI
does not parse `activity` as an employee ID.

### Response contract

Add generated Pydantic/OpenAPI types equivalent to:

```text
EmployeeActivityItemRead
  kind: document | leave | violation | ledger
  source_id: int
  target_id: int
  occurred_at: datetime
  employee_id: str
  employee_name_en: str
  employee_name_ar: str | null
  title: str
  detail: str | null
  status: str | null
  days: int | null
  direction: str | null
  channel: str | null
  reference: str

EmployeeActivityListRead
  items: EmployeeActivityItemRead[]
  total: int
  limit: int
  offset: int
```

`source_id` identifies the source table row. `target_id` is the ID required by
the destination route: the live Book ID for a document and `source_id` for the
other three kinds. Document activity includes committed employee documents that
resolve to a live Book; draft documents and deleted Books are excluded because
they cannot satisfy the exact-link contract.

`title` and `detail` carry source content, not precomposed English sentences.
The frontend owns translated action grammar. Source-specific optional fields are
`null` when they do not apply.

### Source rules

- Documents:
  - `employee_id IS NOT NULL`;
  - `ref_number != 'DRAFT'`;
  - join Employee;
  - join the live Book by stored reference;
  - timestamp: `Document.created_at`;
  - title: `template_id`;
  - detail: null;
  - reference: `ref_number`.
- Leave:
  - `deleted_at IS NULL`;
  - join Employee;
  - timestamp: `Leave.created_at`;
  - title: `leave_type`;
  - detail: null;
  - status: stored leave status;
  - days: stored leave days;
  - reference: `#<leave_id>`.
- Violation:
  - join Employee;
  - timestamp: `Violation.created_at`;
  - title: `violation_type`;
  - detail: description when present;
  - reference: `#<violation_id>`.
- Correspondence:
  - `related_employee_id IS NOT NULL`;
  - `deleted_at IS NULL`;
  - exclude draft-tagged entries;
  - apply caller mail visibility;
  - join Employee;
  - timestamp: `LedgerEntry.created_at`;
  - title: subject;
  - detail: counterparty when present;
  - direction/channel: stored correspondence values;
  - reference: `#<ledger_entry_id>`.

### Merge and pagination

Keep the service focused and dependency-free:

1. apply the active employee/type filters to each relevant source query;
2. count each relevant source and sum those counts for `total`;
3. fetch up to `offset + limit` newest rows from each relevant source;
4. merge the already-sorted lists by
   `(occurred_at DESC, kind ASC, source_id DESC)`;
5. return the global slice `[offset:offset + limit]`.

Fetching `offset + limit` per source is sufficient for an exact global slice:
an item ranked below that bound in its own source cannot enter the requested
global prefix. This avoids a brittle SQL `UNION` across heterogeneous source
columns while keeping the query count fixed at four or fewer. No new dependency
or database index is required for the initial 25-row feed.

## Frontend architecture

### Activity section

Add one focused `EmployeeActivitySection` under
`frontend/src/components/employees/` and render it below `EmployeeSearchHero` in
`EmployeeLookupPage`.

Responsibilities:

- activity query and incremental pagination;
- activity-type selection;
- selected-employee state;
- name/G-number lookup through `api.listEmployees`;
- explicit Open profile navigation;
- localized desktop/mobile activity rows;
- exact route construction by activity kind;
- loading, empty, filtered-empty, and error states.

Do not fold this logic into `LookupHeroCards`; the hero cards remain synchronous
or small summary queries, while the activity section owns a paginated feed.

Use React Query's infinite-query pattern with a query key containing
`employee_id` and `kind`. The next offset is the number of items already loaded.
Changing either filter creates a new query key and naturally resets pagination.
Use a short stale time consistent with existing employee/dashboard summaries;
no polling is added.

### API and generated types

Add the typed API wrapper to `frontend/src/lib/api.ts`, regenerate
`backend/openapi.json`, and regenerate `frontend/src/lib/api.types.ts` through
the project `sync-api-types` workflow. Do not hand-maintain a second response
interface.

### Violation deep-link hydration

`EmployeeDetailPage` reads `tab` and `open` from `useSearchParams` on initial
navigation. Only known tab values are accepted. For the approved violation
route:

- activate the Violations tab;
- pass the parsed `open` ID to `ViolationsTab`;
- both `ViolationsReadOnly` and `ViolationsTable` expose row IDs;
- once rows load, scroll the matching row into view and apply the existing
  short-lived highlight language used by Books/Leaves;
- consume `open` after the row is targeted so refresh does not repeat the
  animation;
- preserve `tab=violations` so browser history returns to the intended tab.

Invalid or missing IDs show the Violations tab normally; they do not open a
different record.

### Focus fix

Give the hero input a stable component class/data attribute. In the same
unlayered stylesheet that defines the global focus rule, add a more specific
rule that removes only this input's outline. Add a `focus-within` ring to the
white pill. The global `:focus-visible` behavior remains untouched for every
other interactive control.

## Security and privacy

- The endpoint requires authenticated `employees.view` access.
- Employee filtering is exact after the user selects a server-returned employee;
  no client-provided display name is trusted.
- Deleted/draft records are excluded as defined above.
- Private mailbox ownership is applied before ledger rows are counted or
  returned, so totals cannot reveal another user's email activity.
- Activity titles and descriptions render as text, never as HTML.
- Exact destination pages retain their own capability and not-found checks.

## Error handling

- Invalid `kind`, negative offsets, and out-of-range limits are rejected by
  FastAPI validation.
- A selected employee with no matching activity returns `200` with an empty list
  and `total=0`; this is a normal filter result.
- A missing exact destination remains a destination-page 404/error, not an
  activity API failure.
- Partial source-query failures fail the complete activity request. The service
  never returns a plausible-looking incomplete feed or incorrect total.

## Testing and verification

### Backend contracts

Add service/API coverage proving:

1. all four source types are merged by `created_at` newest first;
2. equal timestamps use the deterministic kind/source-ID tie-break;
3. employee filtering returns only the selected employee;
4. kind filtering returns only the selected type;
5. `total`, `limit`, `offset`, and successive pages are globally correct when
   one source dominates the feed;
6. deleted leaves/ledger rows, draft documents/ledger rows, unrelated ledger
   rows, and documents without a live Book are excluded;
7. foreign private email activity is absent from rows and totals;
8. each item carries the correct employee identity, content, reference, source
   ID, and exact target ID;
9. the route is resolved as `/employees/activity`, not `employee_id='activity'`;
10. `employees.view` is required.

### Frontend contracts

Add focused component/page coverage proving:

1. all-activity is the initial request;
2. employee lookup matches by name and G-number;
3. Show activity filters the query while Open profile navigates separately;
4. clearing an employee restores all-employee activity;
5. changing the type resets pagination;
6. Load more appends the next page and disappears at `total`;
7. document, leave, violation, and correspondence rows build the exact approved
   routes;
8. row activation never navigates to the general employee profile;
9. loading, empty, filtered-empty, and error/retry states are distinct;
10. the hero input has no local dark outline while the whole pill gains a
    visible focus ring;
11. the violation URL activates the tab and targets the exact row in manage and
    read-only modes.

### UI verification

After implementation:

- run the focused backend and frontend contracts;
- regenerate and validate the API types;
- run frontend TypeScript and lint checks narrowly enough for this workstation;
- launch the app and exercise the changed route rather than relying on tests
  alone;
- verify the hero focus treatment by keyboard and pointer;
- verify name and G-number lookup;
- verify each activity-type filter and Load more;
- open one real item of every kind and confirm the exact destination;
- verify desktop and phone surfaces in English/LTR and Arabic/RTL, light and dark
  themes;
- run the required i18n/RTL review after strings and layouts are final.

## Delivery constraints

- No new dependency.
- No migration or schema change.
- No notification-template change.
- No generated static assets committed.
- Implementation, validation, commit, and push occur from the isolated feature
  worktree. Production deployment is outside this design approval and must use
  the repository's `deploy` workflow only after the implementation is committed
  and pushed to `origin/main`.
