# Phase 3 — Capability catalog

Status: complete; merged and deployed at `d255072ca67f5a53b3a908f44d7c325c2d451909`, verified 2026-09-05 08:09 Asia/Dubai. PR: #76. Branch: `refactor/p3-capability-catalog`. Release dependency: Phase 2.

Follow [WORKFLOW.md](WORKFLOW.md): prepare tests first, verify current code before every implementation slice, and complete verification before every build.

## Outcome and boundaries

One backend catalog owns capability metadata, including English/Arabic labels and descriptions, sensitivity and role defaults. Any authenticated user can read it. Backend authorization remains authoritative. Frontend request controls require explicitly requestable metadata; loading, errors and unknown entries must not enable a request.

Agreed boundaries: permissions catalog, authenticated catalog HTTP response, permission-request service/API, admin notification and capability gate UI. The richer requestability state is an audit-driven interface amendment; settle its contract before new tests at that boundary.

## Verify current code first

- [x] Read `core/permissions.py`, `schemas/auth.py`, `api/v1/auth.py`, `perm_service.py`, `permission_request_service.py` and `admin_notify.py`.
- [x] Read `useCapabilityCatalog` if it now exists, `CapabilityGate`, `RequireCapability`, permissions panels/pages and request tabs; locate providers and all query consumers.
- [x] Inventory static and dynamic entries and both locale trees. Verify the current count instead of freezing the old plan's count of 56.
- [x] Identify dynamic entries that have only English names; choose an honest localized fallback or identifier display rather than pretending English text is Arabic.
- [x] Run existing backend catalog/request tests and frontend gate tests before changing schema or copy.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 3.1 Catalog data | `test_permissions_catalog.py`: unique IDs, complete static EN/AR labels and descriptions, exact known translations, sensitive set matches users.manage/system.admin, current role behavior | Extend `Capability`; derive sensitive IDs once and migrate service duplicates |
| 3.2 HTTP contract | Non-admin authenticated GET succeeds; unauthenticated denied; expected fields/roles; static and dynamic entries | Extend `CapabilityRead`; use `get_current_user`; preserve privilege checks on writes |
| 3.3 Request safety | Sensitive requests rejected server-side; unknown/malformed IDs follow existing backend validation; valid request remains valid | Keep backend sensitive enforcement regardless of frontend catalog state |
| 3.4 Notifications | `test_admin_notify.py`: actual EN/AR label literals, unknown/dynamic fallback, correct request link | Resolve bilingual labels in the request flow without cycles; preserve recipient selection |
| 3.5 Frontend data | Catalog loading, failure, absent ID and sensitive ID show no request affordance; known eligible ID enables it; locale change updates label; logout/re-auth handles cached state safely | Shared query/hook exposes enough state to distinguish unknown from non-sensitive; keep capability gate outside expensive providers |
| 3.6 Consumer cutover | Gate, RequireCapability, permissions page and requests tab show real EN/AR labels/descriptions and unchanged granted-access behavior | Migrate all consumers, then remove obsolete locale trees while retaining derived legacy response aliases during rollout |

## Detailed tasks

- [x] Copy existing approved translations before deleting locale entries; retain domain labels and navigation membership in the frontend.
- [x] Define query enablement, cache lifetime, error behavior and fallback consistently. Do not implement requestability as merely `!isSensitive(id)` when metadata can be unavailable.
- [x] Migrate current permission-request response consumers to the catalog; retain the deprecated derived `capability_label` during rollout for already-open older clients.
- [x] Run `sync-api-types`; inspect `backend/openapi.json`, generated TypeScript and hand-maintained `frontend/src/lib/api.ts` declarations.
- [x] Move useful locale assertions to catalog/UI tests before deleting `permissions.i18n.test.ts`; retain unrelated timesheet locale coverage.

## Verification before build and release

- [x] Run catalog, request, bulk permission, admin-notify, mirror-permissions and capability-description backend tests; run CapabilityGate, RequireCapability, PermissionsPage and PermissionRequestsTab frontend tests.
- [x] Complete backend and frontend gates sequentially. Run `i18n-rtl-reviewer` and `notification-template-reviewer` before the build.
- [x] Browser check EN/AR, narrow/wide screens, loading/offline catalog, authorized page and denied page; sensitive request stays unavailable.
- [x] Rollback: frontend and API metadata changes must roll back together or remain temporarily compatible; verify cached client behavior and server request denial.

## Execution evidence

Starting commit: `ef67bd851754014a520b06304f90d52cbf0158b6`. This phase uses a
fresh clean worktree created only after Phase 2 merged, deployed, passed health
checks and reported that exact production commit. Two Sol builders own disjoint
backend and frontend modules. A third agent owns independent reviews and the
later browser spec; the coordinator owns phase evidence and release operations.

The metadata/requestability interface amendment is settled before executable
boundary tests. The catalog item contains ID, domain, EN/AR label and description,
explicit `sensitive` and `requestable` booleans, and ordered role defaults. Static
Arabic text is complete; dynamic Arabic text may be null when its source is
missing. Current inventory is 56 static entries, 42 fixed service-derived entries
and one entry per category. Dynamic defaults remain implicit and authorization
IDs and role behavior remain unchanged. Catalog GET explicitly requires an
authenticated user; write-route authority is preserved.

Only `users.manage` and `system.admin` are sensitive and non-requestable. The
request service still rejects unknown, non-requestable and already-held
capabilities in the existing order, preserving error codes, duplicate handling,
transactions and notification recipients. Notification display uses localized
catalog metadata with Arabic-to-English-to-ID fallback.

The frontend shares one query per authenticated identity and distinguishes
loading, error, unknown, non-requestable and requestable states. Only the last
may open a request dialog. Runtime malformed data fails closed. Already-granted
content remains visible independently of catalog state. The dialog receives the
known requestable entry; consumers share localization and identifier isolation.
Logout/re-auth and identity changes must not reuse another identity's catalog.

Existing static locale copy is transferred before removing obsolete locale trees,
with two narrow English corrections from “books” to “records” required by the
Phase 0 domain vocabulary. General Book remains the specific form name. Required
i18n/RTL review settles generated Arabic descriptions before literal assertions,
and final notification and i18n reviews run before build. Browser verification
will cover authorized/denied surfaces in EN and AR at both 375 and 1280 pixels,
plus representative loading/error/malformed catalog cases.

The backend builder freezes the final response schema before the frontend builder
runs `sync-api-types` and migrates the generated and hand-maintained contracts.
Both sides preserve unique current tests, baseline first, then execute one
behavior at a time.

Initial focused baselines on the unchanged application:

- Backend catalog/request/permission/notification matrix: 70 passed in 96.08
  seconds. The separate capability-description route regression was accidentally
  omitted from this initial command; it was read before the static change and
  passed in the post-change 20-test matrix. No pre-change run is claimed for
  that file; its unique coverage is retained for the final integrated gate.
- Frontend nine-file gate/request/permissions/auth/locale matrix: 153 passed in
  16.08 seconds. An initial command omitted the isolated pnpm environment; it
  was corrected before recording the passing baseline and before application edits.
- Full ESLint on the identical frozen pre-phase frontend: 8 existing errors and
  10 warnings. Final comparison uses file, rule, severity and message signatures,
  so moved line numbers cannot disguise a new diagnostic.

Early i18n review approved generated Arabic descriptions `إنشاء سجلات …`,
`عرض سجلات …` and `عرض السجلات ضمن …`, with `أخرى` for Other. It clarified
`ledger.view` as `عرض سجل المراسلات`, retaining its existing description.
Missing Arabic metadata stays null; display fallback remains explicit. HTML
isolates variable text with `bdi dir="auto"`; plain-text interpolations use
FSI/PDI where needed to preserve mixed-direction reading.

Backend candidate `64605fd7f1aae3d32b9456de78c8ab8d79776300` is committed and
pushed in draft PR #76. The first frozen eight-file matrix passed 99 tests in
58.54 seconds. Independent review and HTTP smoke then caught two missed agreed
copy requirements: the Ledger Arabic label and FSI/PDI around requester and
capability names in plain-text notifications. Both received actual failing
regressions before fixes; the affected final selection passed 5 tests. Affected
Ruff check/format and diff checks passed after those fixes.

Final isolated real-cookie HTTP smoke passed: 115 rich entries for the synthetic
inventory; anonymous 401 and admin/operator/manager 200; unchanged 400/422 error
semantics; duplicate refresh and denied dynamic requests; removal of the obsolete
response label; six denied write gates with unchanged row counts; positive admin
writes; and five correctly localized notification calls captured at the fake
push boundary. The isolated server stopped cleanly. Backend standards/spec,
i18n/RTL and notification-template reviews have no remaining material findings.

Full local Ruff reports 24 existing diagnostics, down from 26, with no new
normalized signatures. Full mypy reports the same 31 errors in 11 files as
Phase 2, with identical normalized signatures. These full checks preceded the
two final copy-only fixes; the affected files were checked again afterward.
At the first schema freeze, runtime OpenAPI retained all 275 paths; structural changes were limited to
`CapabilityRead`, `PermissionRequestRead`, and the catalog route docstring.
Generated JSON matched runtime at schema freeze; integrated frontend/generated
contract review was pending at this first freeze and completed below.

The full Windows backend gate started against the committed candidate in a fresh
isolated worktree at 06:38 Dubai on 2026-09-05. Its result, final frontend checks,
whole-change review, build, browser and release evidence were pending at that checkpoint; final results follow below.


### Cached-client compatibility amendment

The coordinator and independent reviewer found an actual rollout defect in the
original field-removal proposal. An already-open Phase 2 permissions panel can
fetch the new catalog and then call `label.toLowerCase()` and
`description.toLowerCase()` while searching. Removing those fields crashes that
client. The old request list also uses `capability_label` for dynamic label
fallback. The application does not automatically reload open tabs when deployed;
HTML cache revalidation applies on reload and cannot prevent this failure.

Retain deprecated response-only `label` and `description` aliases derived from
the canonical English catalog values, and deprecated `capability_label` derived
from the same owner when serializing requests. New UI consumers use only the
rich bilingual catalog. This compatibility projection does not restore separate
metadata ownership or duplicated locale trees. Removing these aliases is deferred
until a versioned client-retirement mechanism can make that safe; it is not an
unfulfilled part of this phase's consolidation.

The amendment is tested against the old serialized-response consumer contract
before implementation. It requires regenerated API artifacts, focused regression
checks, a narrow independent re-review, and a new full Windows backend candidate
run. Earlier Windows evidence remains scoped to the earlier candidate.


### Final UI and compatibility verification

The first frontend freeze passed an 11-file, 647-test focused matrix and a full
225-file, 2,250-test Vitest run (193.63 seconds). Chromium exposed a real focus
return failure that jsdom had not covered: a controlled dialog without a trigger
association returned focus to the document body after closing. Both the route
request button and the inline lock now pass their concrete element refs to the
dialog, which explicitly restores focus on close. Route Escape and inline Close
received actual failing regressions before the fix; the final three-file matrix
passed 27 tests, including success-close focus and keyboard trapping. The inline
visual subtree is inert, retaining exactly one Tab stop.

The cached-client amendment received two actual failing HTTP regressions for
missing legacy catalog/search and dynamic-request fallback fields. After deriving
the deprecated aliases from the shared owner, the affected HTTP matrix passed
15 tests. The relevant UI matrix passed 14 tests. The combined final TypeScript
check passed with zero diagnostics, and affected-file ESLint is clean.

Full ESLint contains exactly the existing 18 diagnostics (8 errors, 10 warnings).
Cross-host comparison normalizes only embedded file paths, location numbers and
code-frame gutters, preserving rules, severity, message prose, source snippets
and caret lines. The canonical baseline and candidate signatures match exactly.
Full backend Ruff remains at 24 existing diagnostics. Final full mypy after the
compatibility amendment remains at 31 errors in 11 files with exactly the same
normalized signatures as the previous phase.

The first Windows backend candidate `64605fd7` passed 1,980 tests with 9 existing
skips in 1,222.96 seconds. Windows Ruff reported 24 existing diagnostics, format
139 existing unformatted files (486 formatted), and mypy the same 31 errors in
11 files. The compatible backend candidate
`bd9fd15021a8f5cac727e4cfef6187535d14b8f2` received a new full Windows
run in a separate GUID worktree with unique synthetic data and logs, reported below.

Final source standards/spec, notification-template and i18n/RTL reviews are
clear. The local production build passed after these checks and the focused
amendment regressions. Built-browser, full browser, legacy-client and final
Windows evidence were pending at that checkpoint; final results follow below.


Final browser verification passed after the two keyboard fixes and compatibility
amendment: the focused six-test spec passed in development (33.3 seconds) and
against the reviewed build served same-origin by FastAPI (23.7 seconds). It covers
English and Arabic at 375 and 1280 pixels, real requests, unavailable/malformed
catalog states, sensitive denial, identity changes, focus trapping/return, and
inline single-stop keyboard access. Independent screenshot review found no
clipping, direction error or horizontal overflow. The entire existing-plus-new
browser suite passed 35 tests in 1.7 minutes.

The actual frozen pre-phase frontend, whose Git tree equals the Phase 3 starting
frontend, also passed against the new backend: advanced-permission search does
not crash, and a pending dynamic request keeps its label through the compatibility
projection. The final real HTTP smoke passed with exact alias equality and a
historical removed-capability ID fallback while preserving all prior policy
assertions. All synthetic servers stopped; no external messages were delivered.
The permanent browser spec passes lint, standalone TypeScript and diff checks.

Rollback is a paired frontend/API revert merged and pushed before updating the
service. An already-open new client fails request controls closed against the old
metadata shape and needs a reload to regain full UI functionality; forward
rollout compatibility does not claim transparent reverse rollback. Preserve
request rows and decisions, and keep write authorization enforced throughout.


Final Windows backend validation of compatibility candidate `bd9fd150` passed
1,981 tests with 9 existing skips in 1,246.91 seconds. Ruff remains at 24 existing
diagnostics, format at 139 existing unformatted files (486 formatted), and mypy
at the same 31 errors in 11 files. Full local normalized diagnostic comparison
confirms no new mypy signatures. The Windows frontend gate runs sequentially
after this completion, against `16a792fd` with all product code, generated
contracts and the permanent browser spec committed.


The final Windows frontend test run against `16a792fd` passed all 2,252 tests
in 225 files in 458.89 seconds. The runner then stopped at its lint comparison:
Windows PowerShell 5 decoded the BOM-less UTF-8 JSON with its default legacy
encoding, corrupting the ellipsis in one existing diagnostic. A read-only
on-host comparison proved explicit UTF-8 decoding reproduced the exact reviewed
18-signature hash; CR counts were zero and no diagnostic was changed or waived.
The reviewed resume script verifies the same retained worktree's full commit and
tracked-clean status, then reruns lint followed by type-check and build. The
already-passing full test run is retained as evidence, not claimed as rerun.

The resumed Windows gate completed successfully at 08:04 Dubai on 2026-09-05:
ESLint exactly matches the reviewed 18 diagnostics, TypeScript passes, and the
production build exits zero (only the existing bundle-size warning). The final
completion marker identifies the full `16a792fd0698f0fed06c1c85562c486f3692ed69`
candidate. All source, generated-contract, backend/frontend, browser, specialty
review and Windows release checks are complete. Merge and production update
follow; deployment evidence will be attached to PR #76.

Production release completed through `mng update`: build and import smoke passed,
GSSG Manager restarted with Running / health OK on port 8765, and a separate
`git rev-parse HEAD` confirmed the full merge commit above. PR #76 records the
release evidence. Phase 4 starts from a fresh worktree at this verified merge.
