# Organization & departments: first-time admin critique and task-first redesign

## Recommendation

**Make departments the workspace, not the org chart.** The default screen should answer “What departments do we have, who belongs to each, and what needs attention?” A short setup path helps the admin choose heads from the existing reporting tree. The tree remains available as a read-only explanation of a department and as a separate, explicit reporting-line maintenance tool inside Permissions.

This is an interaction redesign, not a different department model. Do not reintroduce manual membership lists, a parent-department picker, a new permission hierarchy, or 300 employee-by-employee setup tasks.

### Context and evidence boundaries

- Product register: an operational HR/admin application, not a diagramming tool. The intended scene is an HR administrator at an office desktop, in normal office light, completing a specific administrative task between other record work. Retain the existing cream surfaces, navy emphasis, standard form controls, and restrained warnings. No visual rebrand is needed. [Product principles](../PRODUCT.md#product-principles), [design reference](../DESIGN.md).
- Supplied dataset facts: 304 employees, eight units, 296 supervisor links, up to eight levels, 174 supervisors, roughly ten user accounts. These are assignment context, not counts independently queried during this review. Eight unit roots are useful starting candidates; 174 supervisors are not 174 proposed departments.
- Visually inspected: [English desktop](smoke-shots/permissions-org-en-desktop.png), [English action menu](smoke-shots/permissions-org-en-actions.png), [Arabic desktop](smoke-shots/permissions-org-ar-desktop.png), [English phone capture](smoke-shots/permissions-org-en-phone-full.png), [Arabic phone capture](smoke-shots/permissions-org-ar-phone-full.png), and [read-only Employees tree](smoke-shots/employees-org-tree-admin-readonly.png).
- Read the editor, dialogs, activation card, shared workspace, and tree interaction code. Sources below refer to the current worktree. Screenshots contain test department names, so their names and warning counts are not proposed production configuration.
- This is a heuristic design assessment, not observed usability testing or an accessibility conformance certification. Findings about likely hesitation are design inferences. The phone clipping is directly visible in the supplied images; its CSS root cause was not diagnosed.

## Critique: what the first-time admin experiences

### Overall impression and anti-pattern verdict

The visual language is appropriately formal. The failure is not decorative “AI slop.” It is **engineering-shaped information architecture**: the shared tree renderer is the largest surface, and the admin must discover the department workflow through its controls. The admin has come to create perhaps a modest set of departments, but is first asked to learn a mini diagram editor.

Likely emotional sequence, inferred from the interface: “Which person do I start with?” → “Why are the cards so small?” → “Will dragging this change access?” → “Have I finished?” The design should replace that with a visible first action, a concrete preview, and a clear completion/review state.

### What is already working

1. **The underlying model eliminates roster maintenance.** Picking a head covers their branch, and nested department boundaries follow reporting lines. Keep this; it is the main simplification. [Approved model, lines 8–24](../mockups/plan/department-orgtree-rework.md#user-decisions-verbatim-intent).
2. **Viewing and structural editing are partly separated already.** Employees has a read-only tree; Permissions opts into link editing and checks `employees.edit`. Keep the permission split and the Employees view. [Workspace](../frontend/src/pages/employees/orgTree/OrgTreeWorkspace.tsx#L1-L9), [tree edit control](../frontend/src/pages/employees/orgTree/OrgTreeView.tsx#L375-L380).
3. **Important safeguards exist.** Supervisor changes offer Undo; activation refetches the current preflight and shows missing-department accounts, unreachable departments, and service configuration warnings. Preserve these rather than replacing them with a decorative onboarding tour. [Undo](../frontend/src/pages/employees/orgTree/OrgTreeView.tsx#L144-L172), [preflight](../frontend/src/pages/access/orgDepartments/DepartmentScopingCard.tsx#L51-L93).

### Top five problems, ordered by impact

| Priority | Problem and observed evidence | Effect on this admin | Concrete redesign |
|---|---|---|---|
| P1 | **No obvious first job.** The primary surface is a unit rail and canvas; there is no visible “Add department” button in the main layout. Instructions teach drag mode and building-button menus. [Editor layout](../frontend/src/pages/access/orgDepartments/OrgDepartmentsTab.tsx#L219-L242). | “Create departments” looks like “repair the entire hierarchy.” A pre-existing reporting tree becomes a prerequisite the user thinks they must reconstruct. | Lead with a departments list and explicit `Set up departments` / `Add department`. Explain the head-plus-branch rule in one sentence with a preview. |
| P1 | **Essential actions are hidden on tiny employee cards.** Creation is a per-person menu item behind a building icon; existing departments also use a separate ellipsis menu. [Person menu](../frontend/src/pages/access/orgDepartments/OrgDepartmentsTab.tsx#L133-L199), [desktop menu screenshot](smoke-shots/permissions-org-en-actions.png). | The admin must locate the right employee before discovering that creating a department is possible. The same screen mixes tracing, drill-in, collapse, menu opening, and edit dragging. | A text-labeled create action opens a searchable head picker with suggested managers and branch sizes. Department name opens a full detail view with visible edit actions. Keep only infrequent destructive actions in overflow. |
| P1 | **Too many simultaneous concepts and competing panels.** Units, reporting levels, posts, supervisor counts, legends, navigation tools, departments, grants, services, unassigned groups, exceptions, and the global switch all appear in one composition. The right column independently scrolls on desktop. [Main grid and aside](../frontend/src/pages/access/orgDepartments/OrgDepartmentsTab.tsx#L219-L340), [tree toolbar/stats](../frontend/src/pages/employees/orgTree/OrgTreeView.tsx#L362-L402). | The admin cannot tell which counts matter for setup. “Assigned 304/304” in the unit rail can be mistaken for departmental coverage even while “Outside every department” contains people. | Remove the canvas, unit rail, and structural statistics from the default page. Show one coverage sentence with a labeled `Review people outside departments` link. Put services/grants within the selected department, and overrides in a dedicated task view. |
| P1 | **Internal vocabulary hides consequences.** “Scoping,” “viewer,” “exception,” and “Edit links” require translation into a business action. Warnings identify missing services/receivers but do not give a visible next step beside each issue. [Scoping card](../frontend/src/pages/access/orgDepartments/DepartmentScopingCard.tsx#L35-L93), [side warnings](../frontend/src/pages/access/orgDepartments/OrgDepartmentsTab.tsx#L262-L265). | The user may confuse a department viewer with a read-only application role, think an exception affects only one person, or assume a department head needs an account to exist. | Use outcome-first labels and contextual explanations. Add issue-specific actions: `Choose services`, `Add deputy`, `Review account`. State that overrides may affect the selected person's branch, and that reporting-line visibility is retained. |
| P1 | **Canvas navigation and mobile are a poor foundation for the core job.** Fit-to-view makes text and controls tiny on desktop. The EN phone capture shows clipped cards and partially offscreen controls; the AR phone capture has much of the page outside the viewport. [EN phone](smoke-shots/permissions-org-en-phone-full.png), [AR phone](smoke-shots/permissions-org-ar-phone-full.png), [fit scaling](../frontend/src/pages/employees/orgTree/OrgTreeView.tsx#L182-L193). | The user must choose between seeing the structure and reading names. On a phone, scrolling the page, panning the canvas, and tapping miniature actions compete. | Use a single-column department list and full-page detail on phones. Offer an expandable text hierarchy by default for previews; graphical tree is optional. All core jobs must work without panning, dragging, or precision targets. |

These are major usability problems, not proof that tasks are impossible. No P0 is assigned from screenshots alone.

### Cognitive-load assessment

The Impeccable checklist has six clear failures: single focus, visual hierarchy, one decision at a time, minimal competing choices, working-memory burden, and progressive disclosure. Grouping is partially successful because panels have headings; chunking individual unit choices is not itself the problem. The problem is that every group asks a different kind of question at once.

The admin currently has to distinguish at least these concepts: unit, reporting line, department head, department boundary, deputy, additional viewer, service eligibility, branch override, and global access restriction. The toolbar adds depth, search, edit mode, centering, zoom, fit, and fullscreen. This is an inventory of competing concepts, not a claim that “four options” is a universal numerical limit for menus or lists. [NN/g: recognition rather than recall, minimalist design, and real-world language](https://www.nngroup.com/articles/ten-usability-heuristics/).

### Heuristic health score

Scores are review judgments on a 0–4 scale, not measured user performance. Source code can establish available safeguards, but cannot prove their discoverability in a live session.

| Heuristic | Score | Key reason |
|---|---:|---|
| Visibility of system status | 2 | Global state and save toasts exist; setup completion is not legible. |
| Match with the real world | 1 | Diagram mechanics and access jargon precede the department task. |
| User control and freedom | 2 | Explicit edit mode, cancel, and supervisor Undo exist; branch consequences remain hard to anticipate. |
| Consistency and standards | 3 | Familiar application components and bilingual styling; diagram controls add a separate interaction model. |
| Error prevention | 2 | Preflight and cycle prevention exist; no visible before/after audience preview in the reviewed forms. |
| Recognition rather than recall | 1 | Creation and edits depend on remembering tiny card menus. |
| Flexibility and efficiency | 2 | Search and tree navigation exist; creating/configuring many departments remains repetitive. |
| Aesthetic and minimalist design | 1 | Quiet styling but several competing workspaces at once. |
| Error recovery | 2 | Retry, save errors, and Undo exist; warning-to-remedy paths are indirect. |
| Help and documentation | 2 | Useful model sentence and gesture instructions; missing task sequence and contextual guidance. |
| **Total** | **18/40** | **Poor first-run usability; restructure before cosmetic polish.** |

### Persona red flags

- **First-time non-technical admin (Jordan):** Reads “use the building button” but first has to find the intended manager on an automatically scaled chart. No visible “first department” action or “next department” continuation reinforces success.
- **Keyboard/low-vision admin (Sam):** Buttons have useful accessible labels and cards support keyboard interaction; do not falsely describe the implementation as drag-only. However, transformed offscreen cards, numerous nested controls, and small visual targets still make the core task harder than a labeled list/form. A semantic list must provide an equivalent route, not just a screenshot of the tree.
- **Interrupted phone admin (Casey):** A department list is below the canvas, and the AR capture loses most page content horizontally. Returning after an interruption requires rediscovering both page position and chart position.

## The admin's five core jobs

1. **Create the departments:** choose the manager whose team forms a department, enter its Arabic and English names, and understand the resulting coverage.
2. **Check who is in each:** search a person, review membership and sub-departments, and explain why the person belongs there.
3. **Set access and services:** configure only the accounts that need deputy or additional department access, and choose allowed services. This is roughly a ten-account task, not a 304-account enrollment task.
4. **Fix the few odd cases:** correct a real supervisor error, or explicitly override department placement when reporting is already correct. Keep these two operations separate.
5. **Turn on the access restrictions, then maintain them:** review the actual account impact and warnings, confirm activation, and revisit focused issues when managers or staff change.

## Proposed screen flow

### 1. Default landing: Departments

Keep this within Permissions → Organization & departments. Use `Departments` as the dominant in-page heading. The top-level page is not another dashboard.

- One compact state line: `Department access limits: Off` or `On`. A short explanation states that department setup and enforcement are different. Existing administrators and organization-wide access remain unaffected by activation.
- When no departments exist: one sentence, `Choose a manager to create a department. Their reporting team is included automatically.` Primary action: `Set up departments`. Secondary text link: `Add one department`.
- Once departments exist: a conventional table with **Department / Head / People / Needs attention / Open**. Indent derived child departments modestly with expandable rows. Display full parent path in details, not eight levels of deep indentation on a phone.
- Unit is a filter, not the first navigation rail. Search departments or people. A person result shows their department and a direct route to its people view, including an explicit “outside all departments” result.
- Above the list, a coverage sentence: `X of 304 employees belong to a department; Y are outside all departments [Review]`. These are mutually exclusive employee totals, not a sum of overlapping parent/child branch sizes. “Outside” is not automatically an error.
- One setup/review action when enforcement is off; when on, one `Review access` action and a quieter `Manage access limits` entry. Do not put a prominent “Turn off” button ahead of the department-maintenance task.
- `Reporting lines` is a secondary labeled link within this same Permissions area. No duplicate department controls are added to Employees.

### 2. Guided setup: choose → review → configure → activate

Use a short, resumable page flow, not a modal stack or a mandatory tutorial. Experienced admins can use the ordinary list. Existing configured departments open the list, not step one.

**Step 1: Choose department heads.**

- Read existing tree data. Present the eight unit roots as **suggestions**, each with manager name, unit, and `Manager + reporting team: N people`.
- No automatic acceptance. Unit roots are not necessarily the desired department heads, and “end of service” is not automatically an operational department. Allow leaving a unit outside departments intentionally.
- Expand a root to show its direct-report managers and branch sizes. This is especially useful for the 69-person admin office. Label this `Split this unit into departments` or `Choose managers within this unit`, not “increase depth.”
- Show initially a manageable root list grouped by unit; do not flood the page with all 174 supervisors or all eight levels. `Find another manager` searches the full tree. A selected suggestion can be deselected before save.
- Do not recommend a head merely because they have a login. An employee can head a department without an account; a reachable account/deputy matters later for receiving department work.
- The admin can select a parent head and one or more subordinate heads. Explain that subordinate selections become sub-departments automatically. A parent and child selection is not duplicate assignment.

**Step 2: Review names and people.**

- For each selected head, collect the existing required English and Arabic department names. Offer editable suggestions from available unit/position labels, never fabricate a translation.
- Show head, derived parent, direct department membership, and the inclusive reporting branch separately. Parent labels are derived and cannot be edited independently.
- Preview the people affected before committing. Existing exceptions and already-created department boundaries participate in the calculation; a simple raw descendant count must not be labeled “final members.”
- Batch action: `Create selected departments`. The UI can call existing create operations and clearly show per-department successes/errors; no new bulk endpoint or transactional promise is implied. Prevent duplicate head/name submissions using existing rules.
- After saving, state `Created X departments` and return to the list/review flow. Persisted departments are the resume state. Do not introduce a new durable “draft department” model. Leaving before create discards only clearly marked unsaved selections/names.

**Step 3: Configure what is needed.**

- Show only departments needing attention plus a link to all departments. Use outcome labels such as `No account can receive department work [Add deputy]` and `No services selected [Choose services]`.
- Services: provide department selection and `Apply service selection to selected departments`, with a preview of the exact resulting selection and a clear replace-vs-add label. Reuse existing per-department service saves with visible partial outcomes. Do not silently grant every service as a default; the approved rule is that no services means no services.
- Deputies: optional account picker over eligible accounts, not employees. Explain that a deputy can access the whole department and its sub-departments and receive department work, subject to existing application permissions.
- Additional department access: optional and collapsed until requested. Explain that the grant is for this department, does not automatically include child departments, and does not grant new service/action capabilities or security clearance. Do not call it “read-only” unless the existing authorization rules actually make it read-only.
- Do not require a deputy/viewer in every department. Do not create accounts for all employees as an onboarding prerequisite.

**Step 4: Review access and turn it on.**

- Reuse and refetch the real preflight immediately before activation. Keep the existing warning semantics; do not invent hard blockers simply to force every department to look “complete.”
- Show three short sections with remedial links: accounts without a department; departments without a receiving head/deputy account; departments with no services. Provide `Review account`, `Add deputy`, and `Choose services` in context.
- State what activation changes and what it does not: admins/organization-wide access are unchanged; staff retain their own work; supervisors retain reporting-branch visibility; historical records are not re-stamped by changing a department.
- “Account without department” is not synonymous with “will lose all access.” Do not turn an absence report into a fabricated per-user visibility simulation. If an exact before/after audience preview is desired, it must be computed from the real scope rules, not guessed from membership.
- Final explicit action: `Turn on department access limits`. Then a durable success state, `Department access limits are on [Return to departments]`.
- If restrictions are already on, department edits take effect on save. Say this in impactful edit screens. Do not imply setup is a sandbox, batch changes are atomic, or leaving the wizard postpones enforcement.

### 3. Ongoing maintenance: one department at a time

A department name opens a full detail page with three sections/tabs:

- **People** (default): head, derived parent, sub-departments, searchable employee list, and `Why included` details. Distinguish `This department` from `Including sub-departments` explicitly. Never add inclusive counts together as if they were disjoint.
- **Access & services:** optional deputies, additional accounts with department access, and service selection. Reuse the current dialogs/forms where appropriate, but expose labeled entry points rather than a building-icon scavenger hunt.
- **Settings:** bilingual name, head, active state, and infrequent destructive actions. Head changes use a searchable employee picker and explain recalculated boundaries. Deactivating/removing a department explains the resulting placement and preserves existing “in use” restrictions; never silently delete records.

`View reporting structure` opens a read-only branch preview anchored on this head. Default preview can be an expandable text hierarchy with names and team sizes; a `Diagram` option reuses the graphical tree. It is an explanation, not the department editor's required control surface. Graphical previews need explicit non-drag navigation alternatives if panning remains necessary. [W3C dragging guidance](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

### 4. Focused corrections: two distinct tools

**Correct a reporting line:** `Reporting lines` within Permissions offers employee search and `Change supervisor`. Reuse the existing supervisor picker and `employees.edit` checks. Show the selected employee, old/new supervisor, affected branch, and department impact before save. Keep the optional drag chart for experienced users and its Undo, but never require it. Department management alone must not grant reporting-edit permission.

**Override department placement:** `Department placement overrides` is reached from an employee row or the people-outside-departments review. Offer `Use reporting structure` (clear override), `Place in another department`, or `Outside all departments` with a concrete before/after summary. The override follows the approved model: it affects that employee and inheriting descendants, stopping at nested department heads or other overrides. Active heads cannot receive an override. An override does **not** change the supervisor, and it does **not** remove a supervisor's existing visibility of their reporting descendants. [Derivation rules](../mockups/plan/department-orgtree-rework.md#derivation-backendappservicesdepartment_tree_servicepy-new), [scope rules](../mockups/plan/department-orgtree-rework.md#scope-department_scope_service).

For bulk placement, keep it deliberately narrow: allow selecting a small set of employees from a list, preview each affected branch, and reject/conflict-report overlapping ancestor/descendant selections rather than applying order-dependent changes invisibly. This is secondary to bulk department creation and services, not a requirement for ordinary setup. Never introduce arbitrary manual membership assignment as a “simplification.”

## Rough low-fidelity layouts

All counts below marked N/X/Y are placeholders, not calculated production results.

### Desktop: default maintenance surface

```text
Permissions / Organization & departments

Departments                                  [+ Add department]
Access limits: Off                          [Review and turn on]
X of 304 employees in departments · Y outside [Review]

[Search departments or people................] [Unit: All v]
-----------------------------------------------------------------------
Department               Head                People       Attention
v Administration         [full name]         N here       1 issue [Open]
    Operations           [full name]         N here       Ready   [Open]
    General services     [full name]         N here       Ready   [Open]
  First company          [full name]         N here       1 issue [Open]
-----------------------------------------------------------------------
People column: direct membership; child rows counted separately.

[Review placement overrides]                 [Reporting lines]
```

No persistent right-hand control column, no miniature chart, no four-stat strip. “Ready” means no listed configuration warnings, not a security certification.

### Desktop: guided head selection

```text
Set up departments                         Step 1 of 4: Choose heads
A department includes its head and reporting team.

[Unit: Administration v]   [Find another manager................]
[ ] [Unit manager name]       Manager + reporting team: 69 people
    [Choose managers within this unit v]
    [ ] [Manager A name]      Manager + reporting team: N people
    [ ] [Manager B name]      Manager + reporting team: N people

Selected heads: X
Selecting both a manager and their manager creates a sub-department.
[Cancel]                                           [Review X selections]
```

### Desktop: department detail

```text
< Departments
Operations                       Head: [name]       [Edit details]
Part of: Administration          Access limits: On, edits apply on save

[People]  [Access & services]  [Settings]

[This department (N)] [Including sub-departments (M)]
[Search people...............................] [View reporting structure]
-----------------------------------------------------------------------
Employee name           Supervisor        Why included          Action
[full bilingual name]   [full name]        Reporting structure   [Review]
[full bilingual name]   [full name]        Placement override    [Review]
-----------------------------------------------------------------------
```

### Phone: list, then a full-page task

```text
+-----------------------------------+
| < Permissions                     |
| Departments                       |
| Access limits: Off                |
| [Review and turn on]              |
| [ + Add department ]              |
| [Search........................]  |
| [Unit: All v]                     |
| X of 304 in departments           |
| Y outside departments [Review]    |
|-----------------------------------|
| Administration                >   |
| Head: [full name wraps]            |
| N people here · 2 sub-departments  |
| 1 issue: choose services          |
|-----------------------------------|
| First company                 >   |
| Head: [full name wraps]            |
| N people · Ready                  |
+-----------------------------------+

+-----------------------------------+
| < Departments                     |
| Operations                        |
| Head: [name wraps]                |
| [People] [Access] [Settings]       |
| [Search people.................]  |
| [This dept v]                     |
| [Full employee name]              |
| Supervisor: [name]                |
| Included by reporting structure   |
| [Review placement]                |
|-----------------------------------|
| [View reporting structure]        |
+-----------------------------------+
```

Setup uses the same one-column list, explicit checkboxes, and a bottom action bar above the existing app navigation and safe area. Add sufficient bottom padding so neither app navigation nor task actions cover the last row or focused input. The on-screen keyboard must not hide validation or the save action. No sideways scrolling is needed for headings, form fields, or department rows.

## Arabic and RTL requirements

- Arabic is a peer interface, not a mirrored English screenshot. Preserve the formal instructional register from PRODUCT.md. Proposed labels should receive fluent operational review, especially the distinction between department placement and access rights.
- Suggested outcome-first labels: `الأقسام` (Departments), `إضافة قسم` (Add department), `إعداد الأقسام` (Set up departments), `الموظفون` (People), `التبعية الإدارية` (Reporting lines), `تغيير المشرف` (Change supervisor), `تخصيص الانتماء إلى قسم` (Override department placement), `تقييد الوصول حسب الأقسام` (Department access limits). Use explanatory text rather than relying on the label alone.
- For additional access, a phrase such as `مستخدمون إضافيون لديهم وصول إلى القسم` is clearer than an isolated `متابعون`; explain existing permissions and exclusion of automatic child-department access. Do not translate “viewer” into a promise that the application is read-only.
- Mirror reading order, row hierarchy, leading checkbox, disclosure/back arrows, and breadcrumb progression. Use logical `start`/`end` spacing and alignment. Do not mirror non-directional symbols such as search, building, or a plus sign.
- Keep mixed names, G-numbers, and email addresses directionally isolated. Preserve the explicit RTL Arabic-name field and LTR English-name field already in the form. Long Arabic names wrap to two or more lines rather than being reduced to tiny chart labels. [W3C internationalization techniques](https://www.w3.org/International/techniques/authoring-html#direction).
- Localize complete count phrases with Arabic plural categories, as the current tree comments correctly require. Do not concatenate a number and an English-style noun. Keep numbers internally consistent with the application's locale convention.
- Nested departments need textual parent context as well as indentation; phones use a short path/“Part of” line rather than losing most of the viewport to indentation.
- The supplied AR phone clipping is a release-level design concern. Correct page-level overflow separately from optional diagram overflow. W3C's two-dimensional diagram exception does not permit unrelated headings, forms, or controls to remain offscreen. [W3C Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Accessibility and safe simplification

- Use semantic table headers on desktop and meaningful list/heading structure on phones. A normal table does not need custom spreadsheet keyboard behavior. If tabs are used, use the project's accessible tabs primitive rather than inventing one.
- All create, review, save, change-supervisor, and override actions have text labels and keyboard routes. Preserve visible focus, announced errors/status, explicit cancellation, pending state, and existing capability checks.
- Aim for 44px comfortable phone controls. WCAG 2.2 AA's minimum target criterion is 24×24 CSS px subject to its exceptions, not a universal 44px AA requirement. Do not measure a 12px icon alone as the hit target, but do not assume CSS-sized targets remain easy after their entire canvas is scaled down. [W3C Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Keep access rules explicit even while reducing chrome. Department counts are not the same as account counts, employee membership is not the same as visible audience, and moving department placement is not the same as moving a reporting line.
- Keep inherited child-department visibility for heads/deputies and branch visibility for supervisors. Additional viewer grants and exceptions retain the exact approved semantics. Historical record ownership stays unchanged. [Approved scope and record rules](../mockups/plan/department-orgtree-rework.md#scope-department_scope_service).
- Reuse existing tree, supervisor picker, department mutation APIs, service picker, translated names, errors, and preflight. Prefer removing default chrome and moving entry points over building a new diagramming system, new role taxonomy, or new backend membership system.
- Do not add AI-generated org structures, drag/drop department sorting, a mandatory tour, a dashboard of metrics, permission templates, or an import wizard to solve this problem. None is needed to choose a few managers from an already populated tree.

## Evidence-informed design rationale

1. **Visible list + labeled actions:** NN/g recommends real-world language, recognition rather than recall, and removing irrelevant competing information. This supports putting departments and their actions ahead of spatial chart mechanics. [10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
2. **Optional setup path + secondary details:** NN/g distinguishes progressive disclosure (defer specialized functions) from staged disclosure (sequence a task). Use a short staged setup for initial choices, then ordinary list/detail navigation for repeat maintenance; do not make returning admins repeat a wizard. [Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
3. **Non-drag equivalent:** W3C requires simple-pointer alternatives for authored dragging functionality; keyboard equivalence alone is not the entire requirement. The current supervisor picker is worth preserving, and a searchable list gives a discoverable route. [Dragging movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).
4. **Phone restructuring, not shrinking:** W3C requires non-excepted content to reflow at an equivalent 320 CSS px width. A diagram can keep necessary two-dimensional layout without forcing department management forms and page headings offscreen. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

## Review method and limitations

Applied Impeccable's product-register critique: independent manual design assessment recorded before the detector attempt, cognitive-load checklist, all ten heuristics, first-timer/keyboard/phone personas, strengths, and five prioritized issues. Assessment independence is degraded because separate assessment agents were not available via `spawn_agent` in this worker session; this was sequential review, not two independently blinded reviewers.

The deterministic scan was actually attempted against both source directories with the bundled `detect.mjs`. It exited with `Error: bundled detector not found.` No deterministic finding count or clean scan is claimed. Supplied screenshots and source inspection are the fallback evidence. No live application URL was supplied for this slice, so no browser overlay, browser accessibility check, or live interaction claim is made; no local server was started. The resolved target slug was `pages-access-orgdepartments-orgdepartmentstab-tsx`; no critique ignore file was found. This report is written only to the explicitly requested gitignored `.tmp` destination, not an additional tracked skill archive. No build, tests, lint, formatter, or source edits were performed.

Questions skipped: the assignment already fixes the target persona, model, and need for a task-first redesign. The remaining design choice should be tested with a real admin, not deferred back as a request to restate the brief. Suggested future task checks, not checks run here: create departments for the admin office, find a named employee's department, fix one genuine supervisor error versus one placement override, configure services/deputy access, and explain the effect of activation without opening the diagram. Test the same tasks in Arabic and English on desktop and phone.
