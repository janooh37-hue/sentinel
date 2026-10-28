# Permission Studio redesign

Status: build-ready design, not implemented. Operate mode; preserve PRODUCT.md and DESIGN.md.
Scope: one-account access discovery, explained outcomes and reviewed personal changes, with truthful consumer guards.

## 1. Job, problem and measurable success

“I keep looking at the screen for a long time to find what I want to give.”
“I turned the notification-template setting OFF, but the user could still see it. Only saving failed.”
“I should not have to log in as someone else to learn what they can actually do.”
About 20 accounts today, with a 200-account design fixture. The job is **find person → find thing → understand effect → change → confirmed result**.

Release targets, not measured claims:
- From a ready Accounts register, locate the correct control for a named person in ≤10 seconds, with zero wrong-account selections in each EN/AR desktop/mobile acceptance task.
- From the correct action row, change one independent personal setting in ≤3 activations (setting, Save, optional consequence acknowledgment); search typing and network time are measured separately.
- Complete the ready-register-to-confirmed-single-save task in ≤20 seconds on the dev LAN, excluding deliberate reading pauses; report median and slowest of five tasks per locale/device.
- Explain current view/create/edit outcomes without target credentials, session switching or business writes. Every manageable catalog entry has a stable searchable destination.
- Zero unqualified “Hidden/OFF” outcomes where content remains available. Show residual access, unsupported visibility policy or missing context beside the control, not only in a tooltip.
- Search response ≤100 ms for 200 synthetic accounts plus the full catalog on the reference dev laptop; ≤2 seconds for a warm summary request. Measure rather than assume.

## 2. Chosen direction and conflict resolution

**Accounts register → one full-width account workspace → grouped outcome rows with inline editing.** No persistent names rail, permission rail or phone mirror. Effective result and editable personal setting occupy the same row, avoiding a second editor to reconcile.

| Report tension | Decision and reason |
|---|---|
| Audit/matrix compact rail vs roster full-page register | Choose register and full-page workspace. Identity remains pinned without consuming two catalog-width columns; scales to phones and 200 accounts. |
| Effective separate primary/secondary tabs vs matrix integrated editor | One Access workspace with All / Personal exceptions / Needs attention filters. Why and personal controls expand inline; no duplicated capability presentation. |
| Find global mixed search vs account-first clarity | Two scoped uses of one search component: account search in register, resource/action search within selected account. Ctrl/Cmd+K focuses the visible field. No cross-person command execution or natural-language parser. |
| Scale live presets/copy/bulk onboarding vs other reports' bounded scope | Defer new assignment semantics. Existing role baseline and personal exceptions solve current pain without inventing precedence, migrations or activation orchestration. Exact selected-action bulk for ONE account is included. |
| Hide templates vs preserve intentional read-only behavior | Preserve existing enforcement, explain it explicitly. True per-template hiding is a separate, material policy decision; no cosmetic hide switch. |
| Stale department prose vs current implementation | Current fetched branch code wins over historical plan sections; verify merge seams again at integration, never recreate a membership model from an old mockup. |

Visual authority: existing quiet navy, cream/near-black surfaces, Inter/Noto Sans Arabic, semantic status tokens and calm reduced-motion-aware feedback. Preserve meaningful service glyphs. No side-stripe borders, gradient text, metric-card landing, giant matrix or modal-first task.
Reference rationale: [Shopify grouped actions](https://mobbin.com/screens/8a478eef-4fda-457e-90ea-77218ede07ef) for expandable action families; [Retool person access](https://mobbin.com/flows/776c4a2f-47af-4b2e-bbc7-f78ba03115ca) for named-account resource discovery; [GCP troubleshooting](https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access) for reasoned decisions and Unknown. Borrow presentation, never vendor precedence. Research references remain in [the shared collection](https://mobbin.com/collections/cb70d20a-225a-4053-a486-f6a6f055774d).

### Accounts and workspace IA
- Register: Accounts heading, existing account-management link, name/email/employee-number search; Role and Status filters; semantic desktop table, stacked phone rows. Columns: Account, Role, Status, Last sign-in, Edit access. Include disabled/locked accounts, not active-only; no automatic first-account selection.
- Search all authorized returned accounts before client pagination (25/page). Match stored bilingual identity when available; never invent Arabic names or fetch the whole employee directory. Enrich the admin account projection with linked Arabic name in backend slice.
- Existing create/reset/approve/disable/change-role workflows remain in account management. Pending approval gets a Review account link, not an active permission editor. Read-only configured access for disabled targets is marked unusable until activation. Admin settings are locked; self-change is unavailable.
- Selected header: Back to accounts, name + unique email/employee number, role, status, evaluation time, pending-request count/link. Role links to existing reviewed management flow, not a second inline role mutation.
- Access groups: People & attendance; Services & Records; Correspondence; Templates & notifications; Administration. Labels are product tasks; catalog IDs are secondary. Expand search matches and retain previous expansions when cleared.
- Each applicable action row: label/description → saved outcome + short reason → role baseline → personal setting → Why. Only supported actions appear; do not fabricate a universal CRUD grid. View wording can be a locked policy row.
- Personal radio choices: Follow role / Allow / Deny map to null / grant / deny. Baseline is actual resolved role + implicit defaults, not catalog `default_roles`. Same-result overrides remain identifiable.
- Service rows separately show Create documents and Browse records. Optional presets: Create + browse records, Browse records only, Remove ordinary service access; stage the exact two-ID patch. Create-only is Custom, never Hidden. No silent prerequisite grants or destructive cascades.
- Filtered bulk requires explicit action-row selection; “Apply to N selected actions” enumerates all IDs and exclusions. Header mixed means Mixed, never Follow role. Selection cannot silently expand to hidden results.

### Desktop wireframe (reading order; mirror inline topology for RTL)
```text
PERMISSION STUDIO / Accounts                         [Manage accounts]
[Search name, email or employee number____________] [Role] [Status]
Account                    Role       Status       Last sign-in   Action
Ahmed / G123 / a@local      Operator   Active       28/10/2026     Edit access

< Accounts    Ahmed / G123 / a@local    Operator · Active   Requests (2)
Access                   Evaluated 14:32                 [Check access]
[Find a page, service or action____________________________ Ctrl+K]
[All] [Personal exceptions] [Needs attention]
v Templates & notifications
  Message wording       View: Allowed · Signed-in policy (locked)
  Edit/reset wording    Not allowed · Personal deny       [Why?]
    Role: Not granted   Personal: (Follow role) (Allow) (Deny*)
    Templates remain visible. Editing and resetting are not allowed.
  > Why: decisive deny; other sources; expiry; prerequisites; scope
2 changes not saved          [Review consequences] [Discard] [Save]
```

### Phone wireframe and navigation
```text
Accounts                   [Manage]
[Search accounts_________________]
[Filters (2)]
Ahmed · Operator
G123 · a@local · Active
Last sign-in 28/10/2026   [Edit access]

< Accounts
Ahmed · G123 · Operator · Active
Access / Templates & notifications
[Find a page, service or action___]
Edit/reset message wording
Not allowed · Personal deny [Why?]
Role: Not granted
(Follow role) (Allow) (Deny*)
Templates remain visible.
[2 unsaved] [Discard] [Save]
```
Phone is list → account → resource/check detail, not stacked rails or drawers. Back preserves register filters/page/scroll/focus. Safe-area-aware action region wraps; scroll padding and dynamic viewport keep focused controls clear of keyboard and chrome. Do not autofocus the phone keyboard on page entry.

### Search, keyboard, RTL and accessibility
- Index both languages, descriptions, canonical IDs, service names and curated aliases in either UI locale; “notification/email wording” must not confuse Word/editor templates. Exact identifier, strict normalized text, prefix/token, alias, relaxed spelling, then typo suggestion. Numeric identifiers never fuzzy-select a person.
- Extend the existing recipientMatch normalization seam through a separate search-specific export, preserving current recipient behavior. Search-only: NFKC, trim/collapse whitespace, Latin case fold, Arabic marks/tatweel removal, alef variants→ا, ى→ي, Arabic digit→ASCII; secondary ة→ه ranks below strict. Preserve originals; no transliteration assumption.
- Search Enter navigates/focuses a stable destination only. Expand the containing group and focus its heading; maintain Back to results. Stale IDs show unavailable, never select a similar replacement. No authorization mutation from search.
- Use existing focusSearch shortcut registration, not a second global listener; guard composition, AltGraph, lock and unrelated overlays. Test physical Arabic layout and KeyK fallback. Up/Down changes active result; Enter opens; Escape closes results only; Tab remains native. No permission-changing hotkeys.
- Logical CSS only; mirror directional arrows, not vertical result order or DOM sequence. Names use bdi, mixed query dir=auto; isolate email/IDs/chords LTR. Western digits in both languages, including announcements. Wrap identifying fields and Arabic labels.
- 44px minimum touch targets at 16px root, visible focus, named radios/accordion buttons, native table/list semantics, result combobox with manual selection, polite result/save status and inline alerts. No hover-only explanations or hue-only state.
- Verify 1280×900 and 390×844 EN/AR, light/dark, all font stops, 200% zoom, keyboard-only and screen-reader status/focus paths. At 320px there is no page-level horizontal scrolling.

### State and save contract
| State | Required behavior |
|---|---|
| Loading | Identity skeleton and unavailable controls; no temporary Deny or zero-account assertion. Reject late results from a previously selected subject. |
| Empty | No accounts: account-management action. No selection: register. No matches: clear search/filters. No exceptions: follows role, with All access link. |
| Read/evaluation error | Named source failure + Retry; preserve identity and draft; Unknown is not Denied. Incomplete affected outcomes disable Save. |
| Dirty | Account-scoped in-memory draft; Current and Proposed explicitly separate. Single independent change saves directly; multi-action, expiry and dependency impacts require inline review. |
| Dependency conflict | Show newly blocked actions and residual access; offer exact reviewed prerequisite patch or acknowledge deliberate blocked configuration. Never auto-cascade. |
| Saving | aria-busy, disable duplicate submit and account switch; retain reviewed target. Filter changes do not discard draft. |
| Saved | Server-confirmed receipt naming account, refreshed Current snapshot; announce Saved on server, not all sessions refreshed. |
| Failed | Keep draft and prior saved results; linked validation errors, Retry. On permission-denied mutation refetch self capabilities and remove invalid controls without dropping draft. |
| Concurrent | 412 means no changes applied; refresh and show old/new baseline plus draft rebase. Require renewed review; never blind overwrite. |
| Leave dirty | Save / Discard / Stay. During auth loss retain draft only in memory and explain that nothing was saved. |

### Main copy (localize plurals; native Arabic review before shipping)
| EN | AR |
|---|---|
| Accounts / Edit access | الحسابات / تعديل صلاحيات الوصول |
| Search name, email or employee number | ابحث بالاسم أو البريد الإلكتروني أو الرقم الوظيفي |
| Find a page, service or action | ابحث عن صفحة أو خدمة أو إجراء |
| Effective access / Personal exceptions | الصلاحيات الفعلية / الاستثناءات الفردية |
| Role baseline / Follow role | الصلاحيات الأساسية للدور / اتّباع الدور |
| Allow / Deny / Mixed | سماح / منع / مختلط |
| Allowed / Not allowed / Needs context | مسموح / غير مسموح / يتطلب سياقًا |
| Why this access? / Check access | سبب هذا الوصول / التحقق من الوصول |
| View / Create / Edit / Browse records | عرض / إنشاء / تعديل / تصفّح السجلات |
| Templates remain visible. Editing and resetting are not allowed. | تبقى القوالب ظاهرة. لا يُسمح بتعديلها أو إعادتها إلى الافتراضي. |
| Visibility control is not available for this template. | لا يتوفر تحكم في ظهور هذا القالب. |
| Review changes / Discard / Save | مراجعة التغييرات / تجاهل التغييرات / حفظ |
| Saving permissions… / Saved on server | جارٍ حفظ الصلاحيات… / تم الحفظ على الخادم |
| Not saved. Your changes are still here. | لم يتم الحفظ. ما زالت تغييراتك موجودة. |
| Access changed. Review again. | تغيّرت الصلاحيات. راجعها مجددًا. |
| Current access / Configured with limits on | الوصول الحالي / النطاق المُعدّ عند تفعيل القيود |
| Last sign-in / Account disabled | آخر تسجيل دخول / الحساب معطّل |

## 3. Effective-access authority and backend contract

### Verified current truth and incident boundary
Parent inspection: `backend/app/api/v1/notify.py:95-132` reads/sample-renders for signed-in users, writes/reset require `messages.templates`; email matches at `api/v1/email.py:47-84`. Capability description is edit/reset, not hide (`core/permissions.py:517-524`). Current MessageTemplateEditor already hides inputs/tokens/Save without the capability (`frontend/src/components/templates/MessageTemplateEditor.tsx:26,65-103`).
Thus the established root of **visible while OFF** is a policy-intent mismatch, not failed deny precedence. The historical **editable then save-denied** incident is accepted; its exact deployed cause is unproven. Stale capabilities are a supported hypothesis only (`useCapabilities.ts:23-30`, five-minute staleTime, not polling).
Parent ran the existing authenticated-read/write-gate regression: **1 passed**; synthetic in-memory SQLite resolver probe confirmed template deny removes the capability. Neither claims a production replay.
Existing admin GET `/api/v1/auth/users/{id}/permissions` returns only user_id, role, is_admin, effective, role_defaults, effect-only overrides (`api/v1/auth.py:478-493`; `schemas/auth.py:190-225`). Existing bulk is 1–200 capability changes for ONE account, not multi-account assignment.

### Model: capability ≠ complete action ≠ scope
- Resolve persisted role rows (whole-role fallback to code), implicit dynamic defaults, personal grant/deny and expiry once. Admin overrides are ignored; reporter ceiling narrows; expired grants may suppress defaults. Preserve these semantics (`services/perm_service.py:42-165`). null deletes the override, not denial.
- Then evaluate account eligibility, role/route restrictions, actual action prerequisites, resource/revision/grade/assignment rules and workflow readiness. A nominal grant blocked by a prerequisite is not executable access.
- Direct-send/revision/approval read alternatives remain legitimate. Service-record denial is not “cannot open any record”; admin is not universal resource clearance. Without an exact record/context return Needs context, not an invented Yes.
- Why shows decision first, decisive reason, contributing and shadowed sources, expiry, blockers, alternate read paths, scope and evaluation time. Read-only intentional splits are information, not conflict alarms.

### Proposed wire contract (all paths include /api/v1)
Retain existing public consumers; the new studio uses these admin-only additive reads/checks plus the existing bulk mutation extended with concurrency. Authenticate the operator, never substitute the target for get_current_user.
```text
GET /auth/users/{user_id}/effective-access
  -> AccessSnapshot; complete account action/catalog summary, no record scan
POST /auth/users/{user_id}/check-access
  { resource: Resource, action: Action, context: Context, proposed: Patch[] = [], expected_revision?: string }
  -> { snapshot: AccessSnapshot, current: Decision, proposed: Decision|null, impacts: Impact[] }
POST /auth/users/{user_id}/effective-access/preview
  { expected_revision: string, items: Patch[1..200] }
  -> { current: AccessSnapshot, proposed: AccessSnapshot, impacts: Impact[], validation: Issue[] }
PUT /auth/users/{user_id}/permissions/bulk
  If-Match: <revision>; existing {items: Patch[1..200]}
  -> existing UserPermissionRead; ETag: <new revision>; refetch AccessSnapshot
```
```text
Patch = { capability:string, effect:"grant"|"deny"|null, expires_at:ISO8601|null }
Resource = { kind:"capability"|"service"|"book"|"notification_template"|"email_template"|"word_template"|"editor_template",
             id:string, revision_id?:int }
Action = "view"|"create"|"read"|"edit"|"reset"|"delete"|"send"|"manage"
Context = { category_id?:int, classification_id?:int, grade?:string }
AccessSnapshot = { subject:{user_id:int,role:string,status:string,authentication_eligible:bool},
  revision:string, evaluated_at:ISO8601, valid_until:ISO8601|null,
  effective:string[], role_defaults:string[], overrides:Override[], items:AccessItem[],
  subject_facts:{has_approval_assignments:bool}, scope:Scope }
Override = { capability:string,effect:"grant"|"deny",expires_at:ISO8601|null,state:"active"|"expired" }
AccessItem = { resource:Resource,group_id:string,label:{en:string,ar:string},
  description:{en:string,ar:string},aliases:{en:string[],ar:string[]},actions:Decision[] }
Decision = { action:Action, authorization:"allowed"|"denied"|"unknown"|"needs_context"|"not_applicable",
  executable_now:bool|null, configurable:bool, setting_capabilities:string[], editable_effects:("grant"|"deny"|null)[],
  rule_id:string, reasons:Reason[], reason_tree:ReasonNode, required_context:string[], warnings:Issue[] }
ReasonNode = { op:"all"|"any",children:(ReasonNode|{reason_index:int})[] }
Reason = { code:string,source:AssignmentSource,capability?:string,applied:bool,decisive:bool,params:object }
AssignmentSource = { kind:"role"|"personal"|"policy"|"resource"|"department",
  id:string,label:{en:string,ar:string},contribution:"grant"|"deny"|"ceiling"|"eligibility"|"scope",
  expires_at:ISO8601|null,edit_destination:string|null }
Scope = { mode:"current"|"configured_limits_on",limits_enabled:bool|null,kind:string,reason_codes:string[] }
Impact = {resource:Resource,action:Action,before:Decision,after:Decision}
Issue = {code:string,severity:"info"|"warning"|"error",capabilities:string[],params:object}
```
setting_capabilities explicitly binds an editable action to its canonical override IDs; empty means policy-only/read-only. Multi-ID controls stage all listed IDs and preview the exact patch. The server catalog defines bindings; do not derive them from label text or rule_id.
Only allowlisted resource/action/context combinations; reject unknown capability IDs before admin bypass. Unsupported combinations yield 422, missing subject 404, unauthorized operator 403; unavailable protected record returns non-disclosing 404. No record bodies, recipient names, credentials or template wording in diagnostics. Responses `Cache-Control: no-store`; query keys include operator + target + resource/context. Check is non-mutating, including no read receipts or generated files.

Revision is an opaque hash of relevant canonical policy inputs: target role/status/link, persisted role/override rows including expiry, catalog/rule version and consulted resource/assignment/scope state. valid_until is earliest applicable expiry. Under a SQLite write transaction, bulk re-reads inputs, validates If-Match and expiry, then validates/mutates/audits atomically; absent token for new studio is an error, mismatch/expired evaluation is 412. Existing callers migrate to token reads in the integration slice. No check-then-commit race or schema migration is needed for a content token. Transaction owner refactors existing service commits; audit must not commit separately for this path.

### Cannot-drift implementation rule
1. Add structured resolution to existing perm_service; effective_caps/has_capability project the same result, preserving request cache and admin guard behavior. No frontend resolver from `default_roles`.
2. Extract side-effect-free action decisions from current enforcement into focused service helpers. Existing guards consume those decisions and preserve current 403/404 behavior; diagnostics serialize redacted reasons from those exact helpers. Cover capability, service generation, ordinary record visibility, exact-revision read/write, workflow readiness and all template families.
3. Reuse book_service visibility builders and alternative-path checks, not parallel diagnostic SQL. Existing can_write is resource write authority, not a full edit verdict; combine action cap and workflow gates.
4. Navigation remains frontend presentation: use the SAME NAV_ITEMS/isNavEntryAllowed path as the shell with target role/caps/assignment facts. Do not translate its boolean tree into Python or keep PAGE_BLUEPRINT predictions. Personal menu hiding is not authorization.
5. Preview patches overlay resolver input without persisting. Expiry and self/sensitive/admin/reporter restrictions are validated identically to commit. Batch summary loads defaults/overrides/catalog once; individual records are evaluated only on explicit Check access.

### See-but-cannot-edit remediation: BOTH truthful UI and enforcement alignment
No universal “edit implies all view” ladder. Actual dependencies are reviewed, intentional read-only remains supported. This is the complete established mismatch inventory from the audit, not a claim every unexamined resource is defect-free:
| Affected capability / boundary | Required change |
|---|---|
| messages.templates | Explicit locked signed-in View row plus Edit/reset controls across notification and email wording. No hide claim; refresh capabilities on denied mutations and focus/visibility return. Backend keeps read/write split pending hide-policy decision. |
| employees.edit | Gate missing-field Add/requested-field editor, not only Fix All and normal edit; no inline edit entry when denied. |
| ledger.edit | Gate star/unstar, flags/due dates, bulk Flag, suggestion dismissal and smart-folder rename/delete. Folder delete uses edit, not ledger.delete. |
| ledger.delete | Gate single/bulk trash and delayed Undo scheduling before mutation. |
| ledger.send | Gate New email, Reply/all, Forward and handoff submit; do not substitute ledger.create. |
| ledger.create | Gate save-recipient contact and create-smart-folder suggestion paths. |
| employees.vault.manage | Gate attachment Send to vault and its submission. |
| editor_templates.manage | Gate rich-editor Save AND Load library tools; current backend requires manage even for reads. |
| documents.duty_transfer, documents.generate, books.service.*, books.category.*; employees.edit for silent PATCH only | Letter route currently requires generation + duty-transfer, not employees.edit/books.view; initial unassigned placement bypasses General Book checks. Evaluate that exact path, including GS/General Book/classification 12/1 for existing assignments. Keep silent employee PATCH separately gated by employees.edit; do not add an invented books.view prerequisite. |
| documents.generate + books.view | Services nav and destination share both prerequisites; service-specific create and classification checks remain separate from books.servicerecords.* browsing. |
| leaves.view + employees.view | Chosen alignment: leaves.view protects leave/absence facts across surfaces, not only dedicated pages. Gate employee leave history AND leave-balance endpoints; mask totals/recent lists/activity/timeline and tab counts when denied; hide Leaves/Absences tabs and suppress their queries. Preserve unrelated employee data and distinguish forbidden from empty. |
| ledger.view OR books.view | Replace studio's divergent Ledger prediction with shared shell predicate; include assignment-aware approval navigation facts. |
| books.edit / books.templates | Preserve Word-template read vs author distinction and show both reasons; no generic template switch. |
| employees.notify / employees.view | Preserve send/status vs employee message-history split; explain history remains readable under employees.view. Do not silently recast a send capability as history privacy. |
| books.servicerecords.*, books.service.*, books.category.*, books.secret | Show separate create/browse outcomes, grade/revision/direct-send exceptions and true prerequisite warnings; never label the two-bit preset Hidden everywhere. |

Ledger read/unread remains ledger.view, not ledger.edit. Preserve this intentional mutation boundary rather than blanket-disabling every action.

## 4. Department-ready seams

Use AssignmentSource above now for role/personal/policy/resource; department is a reserved reader variant only, not a new grant mechanism. Keep **what actions**, **eligible services**, **whose rows**, and **record-specific authority** separate. Department restrictions narrow action/service access; personal Allow cannot override scope. No preset/group precedence is introduced.
Fetched tip: `origin/feat/department-scoping@7a2de5c8d910f78cd167c5e61f41bc4135f6277c`. Conflict resolved in favor of scale: Employees tree IS editable for employees.edit holders (`frontend/src/pages/employees/orgTree/EmployeesOrgTreePage.tsx:71-73` on that tip, directly checked with git show). Audit/matrix's claim that ADR editability is stale is wrong; old plan/handoff read-only prose is superseded by implementation. Do not remove supervisor editing.
Integrate the fetched branch's people/org shell, preserving `?tab=org` and existing `user`; new people state uses `psResource`, `psFilter`, not org-owned `q,view,step,dept,section,employee`. One selected-account ID can link to its org Accounts inspector, not a second org register or hierarchy.
Use branch `/departments/account-access` through an adapter only after integration: it computes configured limits-on scope, not actual impersonated access. Label Current vs Configured with limits on when limits are disabled; empty department service list means none, not failed loading.
Accounts-first on that branch means the org subsection, not the whole outer Permissions page. Its account-access API requires departments.manage (`backend/app/api/v1/departments.py:30-32,54-56`), excludes inactive/reporter accounts and counts working employees, not records. Join authorized projections by user_id; do not treat this as the lifecycle roster or bypass org-entry gates. Keep existing two-way department/user-permissions invalidation, especially for departments.all.
Avoid editing `pages/access/orgDepartments/**`, `lib/departments.ts`, `pages/employees/orgTree/**`, department pickers/inbox, department backend models/schemas/routes/services, recompute, distribution/recall, ownership/label synchronization and migrations. No primary-department picker, manual membership graph, editable department parent or Workforce-scope rewrite.
Shared hotspots need one integration owner: PermissionsPage, AccessRequestsPage, locales, auth schemas, perm_service and generated types. Backend slice rebases preserving department final service intersection; frontend integration preserves PeoplePermissionsPanel/outer people-org boundary rather than replacing branch shell. Re-fetch and compare branch tip before applying implementation.

## 5. Explicit non-goals

No true impersonation or pixel-exact live preview; Check access and outcome rows replace the misleading mirror. No record export/content fetching for diagnostics. No named preset library, groups, custom roles, role editor, copy-user access, multi-account batch, onboarding orchestration, undo/history restoration, saved views, CSV imports or new credential delivery. Existing management/requests/history remain linked and operational, not rewritten. No new department enforcement, migration, org canvas or production deployment. No per-template hide policy until the material boundary below is approved; unsupported hiding is visible in the shipped design, never represented as done.

## 6. Four parallel implementation slices with exclusive file ownership

Start all four worktrees from the same freshly fetched implementation base. New modules use the frozen contracts above, not handwritten shadow API schemas. Each slice can implement independently; D's final integration and A's real-contract verification are true downstream gates. No file belongs to two slices. A alone generates API types after all route/schema work; B/C use type-only imports from those eventual generated schema names, never generate their own.

### A. Backend authority, contracts and read-boundary alignment
- Goal: authoritative, non-mutating explanation/preview/check and conditional atomic save; real guards share decisions.
- Own ALL `backend/**` changes needed here, including `app/services/perm_service.py`, action-decision helpers (new `app/services/access_decision_service.py`), book/document/duty/employee detail/activity services, `api/deps.py`, auth/notify/email/books/employees routes, auth + new access schemas, catalog projection and backend tests; `scripts/dump_openapi.py` only if needed; generated `backend/openapi.json` and `frontend/src/lib/api.types.ts`. JSON is currently gitignored: generate as intermediate, do not force-add unless repository policy changes.
- No other slice edits any backend file or generated contract. No migrations needed. Respect department evaluator additions during rebase.
- Acceptance: schemas above, Arabic account projection, per-source expiry, protected admin/reporter/self/sensitive rules, transaction-safe stale-save rejection, no diagnostic business writes; leave/absence subprojection leakage removed; guard/diagnostic parity for each supported action including record alternatives and template families.
- Add `backend/tests/test_effective_access_api.py` for semantic resolver/actual-operation parity and concurrent/expiry rejection, not a mocked simulator. Extend existing template and employee privacy tests only for consumer-visible boundaries. Preserve create-only and direct-recipient exceptions.
- Narrow checks: `~/.venvs/sentinel/bin/python -m pytest backend/tests/test_effective_access_api.py backend/tests/test_notify_templates_api.py backend/tests/test_email_draft_templates.py backend/tests/test_employee_projection_authorization.py backend/tests/test_employee_activity_api.py backend/tests/test_employee_detail_activity.py`; record/service guard checks: `~/.venvs/sentinel/bin/python -m pytest backend/tests/test_mirror_permissions_backend.py backend/tests/test_book_grade_access.py backend/tests/test_book_revision_access_routes.py backend/tests/test_duty_transfer_service.py backend/tests/test_perm_expiry.py backend/tests/test_perm_sweep.py backend/tests/test_permissions_bulk_api.py`. Extend the corresponding semantic boundary tests, not catalog-count assertions.
- Smoke: isolated fixture operator/admin/reporter/disabled targets, deny/reset/expired grant, opt-in service, blocked classification, direct recipient, restricted grade, retained revision and signed edit. Compare Check response to real protected operation; no sends or production records. Run sync-api-types skill; generated types are this slice's sole frontend ownership.

### B. Outcome editor and diagnostic UI (new isolated module only)
- Own new `frontend/src/components/access/studio/` EXCEPT `search/` and `contracts.ts`; no existing page, locales, hook, generated file or action-consumer edits.
- Components: `AccessWorkspace.tsx`, `AccessGroups.tsx`, `ActionRow.tsx`, `WhyAccess.tsx`, `CheckAccess.tsx`, `ChangeReview.tsx`, account-scoped draft hook, adjacent tests. All copy arrives through existing i18n keys delivered by D; no private translation engine.
- Frozen public props: `AccessWorkspace({subjectId:number, initialResource?:Resource, onNavigate:(destination:StudioDestination)=>void, renderSearch:(props:ResourceSearchProps)=>ReactNode})`. Use transport/query hooks exported by D; no direct duplicate API client. Each access item has a deterministic `type:id:action` focus destination.
- Acceptance: one saved/proposed presentation; exact mixed/expiry/locked/custom service states; inline Why and Check; no silent cascade; review names all changed IDs; failed saves retain draft; subject changes cannot mix identity/results; phone/RTL same state model.
- Add/run `pnpm -C frontend test src/components/access/studio/AccessWorkspace.test.tsx` covering denied-edit-but-visible, create-only, filtered explicit selection, expiry, stale response and conflict recovery. No source-string or mock-echo tests.
- Smoke after D integration: search wording → deny edit → read-only warning → save receipt; blocked prerequisite and 412 preserve draft. Exercise desktop/phone EN/AR.

### C. Shared scoped find and keyboard/search correctness
- Own new `frontend/src/components/access/studio/search/**`, existing `frontend/src/lib/recipientMatch.ts` and its adjacent tests, existing `frontend/src/lib/keyboardShortcuts.tsx` and adjacent tests. No pages, locales, B modules or transport files.
- Export `StudioSearch` accepting `ResourceSearchProps` in resource mode or `{mode:"accounts",accounts:AdminUserRead[],onNavigate:(d:StudioDestination)=>void}` in account mode; C owns this discriminated props union via its exported `StudioSearchProps`, while D contracts owns the resource branch. Build index helpers from supplied authorized metadata. No fetching, implicit target selection or mutation hidden inside search.
- Acceptance: both locales searched in either UI language, exact ID and duplicate-person disambiguation, recipient behavior unchanged, strict before relaxed Arabic matching, numeric no-fuzzy, focusSearch obeys IME/lock/overlay guards, Enter navigates only, stale destination unavailable. No command parser or durable recents.
- Add/run `pnpm -C frontend test src/components/access/studio/search/StudioSearch.test.tsx src/lib/recipientMatch.test.ts src/lib/keyboardShortcuts.test.tsx` for matching, modifier/overlay/composition and non-mutating selection behavior.
- Smoke integrated search with Arabic keyboard, mixed script and repeated names; keyboard input→result→focused destination→Back, plus touch without automatic keyboard opening.

### D. Register, transport, integration and consumer affordance alignment
- Own `frontend/src/pages/access/PermissionsPage.tsx`, `AccessRequestsPage.tsx`, `frontend/src/App.tsx` if route wiring is needed, `components/access/AdvancedPermissionsPanel.tsx` removal and its obsolete tests, `frontend/src/lib/permissionStudioApi.ts` (new), `components/access/studio/contracts.ts` (new), `lib/useCapabilities.ts`, `locales/en.json`, `locales/ar.json`, and frontend integration/e2e files. Also own ALL affected EXISTING frontend consumer files from the remediation table: employee gaps/profile/transfer/leaves/absences/detail; Ledger outlook shell/FolderRail/rows/panes/selection/flags/suggestions/folders/rename-create dialogs/handoff; components/ledger StarButton/RecipientChips/attachments/vault dialogs; ui/rich-editor; templates editors; shell navigation predicates/items. No B/C module edits or generated types.
- Implement one Accounts register and transport/query hooks; remove old mirror/Advanced caller path completely. Preserve existing management/request/history links and branch org shell. Migrate all existing bulk permission callers to conditional tokens; direct single mutation callers must refresh equivalent snapshot preconditions or move to bulk. Do not leave an unversioned studio save path.
- Contracts file exports `StudioDestination={userId?:number,resource?:Resource,action?:Action}`; `ResourceSearchProps={subjectId?:number,items:AccessItem[],onNavigate:(d:StudioDestination)=>void}`. API types Resource/Action/AccessItem come from A's generated schemas. Transport exports `useAccessSnapshot(id)`, `usePreviewAccess(id)`, `useSaveAccess(id)`, `useCheckAccess(id)` with typed endpoint bodies above and shared query invalidation; B consumes these. D injects C search into B workspace.
- Hook signatures: `useAccessSnapshot(id:number):UseQueryResult<AccessSnapshot>`; `usePreviewAccess(id:number):UseMutationResult<PreviewResponse,Error,{expected_revision:string,items:Patch[]}>`; `useSaveAccess(id:number):UseMutationResult<UserPermissionRead,Error,{revision:string,items:Patch[]}>`; `useCheckAccess(id:number):UseMutationResult<CheckResponse,Error,CheckRequest>`. Names AccessSnapshot/PreviewResponse/CheckResponse/CheckRequest/Patch/Resource/Action/AccessItem are the public generated schema names A must export. PreviewResponse is the preview response object specified above; CheckResponse is the check response object. D maps revision to If-Match and exposes 412 distinctly; no hidden follow-up save.
- Acceptance: complete cutover, named account continuity, scoped URL merge, disabled/admin/pending states, no new lifecycle implementation, guard fixes across every audited consumer. Invalidate target summary/preview/check after accepted saves; refresh self capabilities on window focus/visibility and capability-denied errors. Do not claim instantaneous background-session revocation.
- Add/run `pnpm -C frontend test src/pages/access/PermissionsPage.test.tsx` and affected existing consumer behavior tests. Keep server errors authoritative. Add `frontend/e2e/permission-studio.spec.ts` for EN/AR register→edit→explain→save→Back plus keyboard and phone flows; run `pnpm -C frontend exec playwright test e2e/permission-studio.spec.ts` on dev only.
- Consumer checks: `pnpm -C frontend test src/pages/employees/tabs/ProfileTab.test.tsx src/pages/employees/tabs/LeavesTab.test.tsx src/pages/employees/tabs/AbsencesTab.test.tsx src/pages/ledger/outlook/LedgerOutlookShell.test.tsx src/components/shell/navPermissions.test.ts src/components/shell/navCustomization.test.ts src/components/templates/MessageTemplateEditor.test.tsx src/App.permissions.test.tsx`. Delete obsolete geometry/source-wording assertions; replace the old create-only-is-Hidden expectation with actual independent outcomes, never re-pin it.
- D owns integration docs: update this spec with exercised outcomes, existing product/UI docs only if conventions changed; no gratuitous new docs. Run i18n-rtl-reviewer using repository reviewer definition and final diff; apply its fixes within ownership. No notification formatting changes are planned; invoke notification-template reviewer if implementation changes that content.

### Dependency and release gate
A/B/C/D code in parallel against this spec; D imports B/C exports, A supplies final generated contract. Integrate A, then B/C/D without concurrent shared-file edits; one final owner resolves imports/types. No production promotion or merge without user approval.
After integration run narrow tests above once, TypeScript check `pnpm -C frontend exec tsc -b --noEmit`, then dev URL smoke with synthetic fixtures and actual protected operations. Browser proof includes every row in remediation inventory, network denial/read checks, desktop/mobile EN/AR, focus/error/empty/loading/save/conflict and largest/smallest font. Record measured task/search/summary timings and limitations. Tests alone do not certify the surface. Department integration additionally proves configured-vs-current scope labeling and preserved org deep links; do not simulate a merged branch when it is not present.

## 7. Material questions for the admin (recommended defaults do not block this bounded build)

1. Does hiding notification wording mean all configuration wording, one named event, or also preventing its operational use? **Recommend per-event configuration read policy**, separate from edit and sending; apply to list/direct read/sample-render and every embedded configuration consumer. Until approved, show unsupported visibility and read-only outcomes; no hiding promise. This answer determines a separate security-policy slice, not a renamed switch.
2. Should direct-sent/reviewer records remain readable after ordinary service browsing is removed? **Recommend preserve current exceptions and explain them.** An absolute ban would change resource authorization and requires a separately reviewed policy.
3. Should employee message history require a distinct read permission rather than employees.view? **Recommend retain current behavior for this build**, with explicit explanation. A new privacy boundary needs agreement on history, body/provider fields and aggregate surfaces.
4. Are reusable job presets already a recurring need beyond the 20-account workflow? **Recommend defer until task vocabulary is validated**, then design publish/assignment semantics separately rather than copying effective sets into personal grants.

## Evidence and limits
All six `.tmp/handoff-perm-{audit,roster,matrix,effective,scale,find}.md` research inputs were read fully. Parent inspected key template guards/editor, effective read/write schemas, resolver and expiry rules; independent read-only scouts cross-checked enforcement and department conflicts. This is a design deliverable: usability targets and proposed endpoints are not shipped or certified. Existing template gate regression and synthetic resolver/schema probe are current executable evidence; no UI implementation, production incident replay or deployment is claimed.
Cross-check refinement: preserve pre/post-sweep expiry behavior rather than claiming equivalence. An expired opt-in dynamic grant ceases granting before cleanup, while sweep may convert it to a lasting deny affecting future default rollout (`perm_service.py:142-148,413-425`). Include both states in explanations and tests; changing this policy is not part of the redesign.
