# Phase 3 — Capability catalog

Status: not started. Branch: `refactor/p3-capability-catalog`. Release dependency: Phase 2.

Follow [WORKFLOW.md](WORKFLOW.md): prepare tests first, verify current code before every implementation slice, and complete verification before every build.

## Outcome and boundaries

One backend catalog owns capability metadata, including English/Arabic labels and descriptions, sensitivity and role defaults. Any authenticated user can read it. Backend authorization remains authoritative. Frontend request controls require explicitly requestable metadata; loading, errors and unknown entries must not enable a request.

Agreed boundaries: permissions catalog, authenticated catalog HTTP response, permission-request service/API, admin notification and capability gate UI. The richer requestability state is an audit-driven interface amendment; settle its contract before new tests at that boundary.

## Verify current code first

- [ ] Read `core/permissions.py`, `schemas/auth.py`, `api/v1/auth.py`, `perm_service.py`, `permission_request_service.py` and `admin_notify.py`.
- [ ] Read `useCapabilityCatalog` if it now exists, `CapabilityGate`, `RequireCapability`, permissions panels/pages and request tabs; locate providers and all query consumers.
- [ ] Inventory static and dynamic entries and both locale trees. Verify the current count instead of freezing the old plan's count of 56.
- [ ] Identify dynamic entries that have only English names; choose an honest localized fallback or identifier display rather than pretending English text is Arabic.
- [ ] Run existing backend catalog/request tests and frontend gate tests before changing schema or copy.

## Test-first slices

| Slice | Tests before code | Verified implementation task |
| --- | --- | --- |
| 3.1 Catalog data | `test_permissions_catalog.py`: unique IDs, complete static EN/AR labels and descriptions, exact known translations, sensitive set matches users.manage/system.admin, current role behavior | Extend `Capability`; derive sensitive IDs once and migrate service duplicates |
| 3.2 HTTP contract | Non-admin authenticated GET succeeds; unauthenticated denied; expected fields/roles; static and dynamic entries | Extend `CapabilityRead`; use `get_current_user`; preserve privilege checks on writes |
| 3.3 Request safety | Sensitive requests rejected server-side; unknown/malformed IDs follow existing backend validation; valid request remains valid | Keep backend sensitive enforcement regardless of frontend catalog state |
| 3.4 Notifications | `test_admin_notify.py`: actual EN/AR label literals, unknown/dynamic fallback, correct request link | Resolve bilingual labels in the request flow without cycles; preserve recipient selection |
| 3.5 Frontend data | Catalog loading, failure, absent ID and sensitive ID show no request affordance; known eligible ID enables it; locale change updates label; logout/re-auth handles cached state safely | Shared query/hook exposes enough state to distinguish unknown from non-sensitive; keep capability gate outside expensive providers |
| 3.6 Consumer cutover | Gate, RequireCapability, permissions page and requests tab show real EN/AR labels/descriptions and unchanged granted-access behavior | Migrate all consumers, then remove only obsolete locale trees and schema fields |

## Detailed tasks

- [ ] Copy existing approved translations before deleting locale entries; retain domain labels and navigation membership in the frontend.
- [ ] Define query enablement, cache lifetime, error behavior and fallback consistently. Do not implement requestability as merely `!isSensitive(id)` when metadata can be unavailable.
- [ ] Update permission-request response consumers before removing `capability_label`.
- [ ] Run `sync-api-types`; inspect `backend/openapi.json`, generated TypeScript and hand-maintained `frontend/src/lib/api.ts` declarations.
- [ ] Move useful locale assertions to catalog/UI tests before deleting `permissions.i18n.test.ts`; retain unrelated timesheet locale coverage.

## Verification before build and release

- [ ] Run catalog, request, bulk permission, admin-notify, mirror-permissions and capability-description backend tests; run CapabilityGate, RequireCapability, PermissionsPage and PermissionRequestsTab frontend tests.
- [ ] Complete backend and frontend gates sequentially. Run `i18n-rtl-reviewer` and `notification-template-reviewer` before the build.
- [ ] Browser check EN/AR, narrow/wide screens, loading/offline catalog, authorized page and denied page; sensitive request stays unavailable.
- [ ] Rollback: frontend and API metadata changes must roll back together or remain temporarily compatible; verify cached client behavior and server request denial.

## Execution evidence

Pending: metadata/requestability decision, baseline/RED/GREEN results, translation coverage, generated contract review, reviewers, build, browser and release evidence.
