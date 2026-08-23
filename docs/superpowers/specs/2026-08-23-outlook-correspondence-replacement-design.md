# Outlook correspondence replacement — design

**Date:** 2026-08-23  
**Area:** Outlook desktop integration, correspondence indexing, employee profiles, email basket, navigation, settings  
**External systems:** Classic Microsoft Outlook for Windows, IONOS IMAP, Windows Credential Manager/DPAPI  
**Status:** Approved in design review

## Problem

Operators do not use Sentinel's Ledger as their mailbox because it does not have Outlook's familiar feel or ease. The current implementation is already a substantial Outlook imitation: a three-pane shell, folders, search, reading pane, attachment previews, drafts, compose, smart folders, flags, recipient lists, SMTP sending, and IMAP synchronization. Reworking that duplicate mailbox again would preserve the core adoption problem while increasing maintenance.

The useful Sentinel-specific behavior is different from mailbox work:

1. detect an employee G-number in an email and show the matching employee;
2. record that email on the employee profile; and
3. prepare generated-document email baskets with the correct subject, body, recipients, and attachments.

Those capabilities should augment Outlook rather than compete with it.

Production evidence captured during design:

- six enabled operator mailboxes use `imap.ionos.com` and `smtp.ionos.com`;
- the current workstation has both classic Outlook COM registration and new Outlook installed;
- `ledger_entries` contains 1,700 rows: 786 email rows and 914 document-history rows;
- one existing Sentinel email draft requires cutover handling; and
- current email rows have no employee links, while 876 document-history rows already link to employees.

Microsoft's supported extension boundary determines the implementation. Outlook web add-ins do not support non-Microsoft mailboxes in Outlook on Windows. New Outlook also does not support COM or VSTO add-ins. Therefore the selected foundation is classic Outlook plus a Windows COM/VSTO integration while the mailboxes remain on IONOS.

Primary compatibility references:

- [Outlook add-ins overview — supported accounts](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/outlook-add-ins-overview)
- [Develop Outlook add-ins for the new Outlook on Windows — COM/VSTO impact](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/one-outlook)

## Goal

Make classic Outlook the only mailbox interface while retaining Sentinel's automatic multi-employee G-number linking from message text and existing attachment OCR, employee-profile correspondence history, generated-document email basket, and Scan Inbox ingestion.

Success means an operator reads, searches, drafts, edits, signs, sends, replies, forwards, flags, and files mail entirely in Outlook. Sentinel appears only where it adds HR context: an Outlook employee pane, profile correspondence history, and prepared Outlook drafts from Sentinel records.

## Approved decisions

- Use the actual classic Outlook desktop application; do not rebuild an Outlook-like mailbox in Sentinel.
- Keep the six IONOS mailboxes; do not make Microsoft 365 mailbox migration part of this project.
- Require classic Outlook on every operator PC. New Outlook is unsupported for this integration.
- Install a signed Outlook add-in and protocol launcher on every operator PC.
- Show employees in a read-only Sentinel side pane; never modify stored email bodies to create links.
- Detect every valid G-number in the selected email's subject/body and in OCR text already produced for PDF, PNG, JPG/JPEG, TIF/TIFF, WebP, BMP, or HEIC email attachments.
- Link a message to every detected real employee, not only one primary employee.
- Allow an operator to add a missing employee or dismiss an incorrect detected link.
- Record matching incoming and sent mail automatically in the background even if nobody opens it in Outlook.
- Keep IMAP synchronization as hidden indexing infrastructure, not as a mailbox UI.
- Preserve and migrate existing ledger history. Do not delete correspondence or attachments.
- Open the exact Outlook item when a user selects correspondence from an employee profile.
- Preserve the existing email-basket grouping and template output, but hand the result to a real Outlook draft.
- Stop supporting creation of new phone, in-person, fax, letter, or other manual ledger entries.
- Keep historical non-email/document rows read-only on employee profiles.
- Remove the old Ledger page, Sentinel composer, SMTP send, drafts, smart folders, recipient lists, and mailbox interaction state after cutover.
- Do not keep a compatibility mailbox route or a second compose path.
- Reuse existing Scan Inbox OCR output for attachment G-number detection; do not add a second attachment extraction pipeline.

## Non-goals

- Migrating IONOS mailboxes to Microsoft 365 or Exchange Online.
- Supporting Sentinel integration in new Outlook, Outlook on the web, Outlook for Mac, or mobile Outlook. Operators may use those clients normally for mail, but the Sentinel pane, basket handoff, and exact-open guarantees are classic-Windows-only while mailboxes remain on IONOS.
- Extracting text from attachment formats outside the existing Scan Inbox set (PDF, PNG, JPG/JPEG, TIF/TIFF, WebP, BMP, and HEIC), or running another OCR pass solely for correspondence linking.
- Creating a general Outlook automation framework or supporting other Office products.
- Replacing Outlook search, folders, rules, contacts, signatures, drafts, flags, spellcheck, or send behavior.
- Rendering full email bodies or attachments inside Sentinel after cutover.
- Rewriting incoming or stored messages to insert hyperlinks.
- Preserving creation of new non-email ledger entries.

## Product terminology

User-facing copy must use **Outlook**, **Email**, or **Correspondence** as appropriate. **Ledger** remains only in historical database/table names where renaming would add migration risk without changing behavior.

- Main navigation action: **Open Outlook** / Arabic peer copy.
- Employee section: **Correspondence**.
- Settings group: **Outlook connection** and **Email recording**.
- Background health state: **Recording current**, **Recording delayed**, or **Connection required**.

No user-facing screen, route, toast, notification, or help text should describe the replacement as a ledger.

## System boundary

Outlook becomes the only mailbox. Sentinel no longer displays inboxes, folders, search results, message bodies, attachment previews, drafts, flags, or a composer.

The replacement has three runtime pieces.

### Classic Outlook add-in

A signed C# VSTO/COM add-in supplies a right-side Sentinel task pane in Outlook Explorer and Inspector windows. It listens for selection changes without blocking Outlook, detects canonical G-numbers locally, asks Sentinel for matching employee cards, and records the Outlook location cache.

The pane shows each matching employee's:

- photo when available;
- bilingual name according to the Sentinel user's locale;
- G-number;
- position;
- employment status; and
- actions to open the Sentinel profile or remove an incorrect link.

A compact employee search adds a manual link when the message contains no usable G-number. Removed auto-links are durable decisions, not temporary visual hiding.

The add-in never sends the selected message body to Sentinel. It sends only the Internet Message-ID, detected normalized G-numbers, Outlook Store/Entry IDs, and the authenticated bridge/device identity. Background IMAP indexing remains the source of stored message content and metadata.
Employee summaries returned by Sentinel include durable matches previously found in attachment OCR. The add-in does not open, download, or OCR attachments itself.

Selection processing must be asynchronous, cancellable, and keyed to the current Outlook item. A stale response from the previously selected message must never replace the current pane. Employee summaries and resolved message locations may be cached briefly per message.

### Outlook launcher

A signed Windows executable registers the `gssg-outlook://` protocol. It handles three commands:

- pair this Windows device with the signed-in Sentinel user;
- create an Outlook draft from a one-time Sentinel handoff; and
- open an exact Outlook message from employee correspondence history.

The installer pins the approved Sentinel HTTPS origin in the current-user bridge configuration. Protocol URLs contain only an operation and short-lived opaque token. They never contain or override the server origin, recipients, subject, body, G-numbers, employee data, attachment paths, Outlook IDs, or device credentials.

For compose, the launcher redeems the token and downloads every authorized attachment to a private temporary directory before it creates an Outlook `MailItem`. It displays the item so Outlook inserts the configured signature, prepends the prepared body, adds recipients and attachments, saves the draft, and leaves its Inspector open for the operator. If any Outlook step fails, the launcher closes the partial item without saving and reports failure. Temporary files are deleted after Outlook has copied them into the saved draft.

The launcher must not report success or clear the Sentinel basket when Outlook creation, attachment retrieval, save, or display fails.

For exact-open, the launcher first tries the cached Outlook Store/Entry IDs for this device. If Outlook reports that location as stale, it searches the paired mailbox by Internet Message-ID, opens the result, and updates the cache. It never searches or opens another Outlook mailbox.

### Sentinel correspondence indexer

The existing per-user IONOS IMAP synchronization remains server-side. Its responsibilities narrow to:

- import and deduplicate incoming and sent messages;
- store sanitized message metadata/body and authorized attachment files for audit and Scan Inbox processing;
- detect canonical G-numbers in subject and body during import;
- resolve only IDs that exist in the employee roster;
- create or update employee link decisions;
- preserve an operator's manual dismissal;
- feed supported email attachments into Scan Inbox and reuse its stored OCR text to add links; and
- expose last-success/error health in Settings.

The indexer does not provide mailbox folders, read/unread state, flags, drafts, compose, SMTP send, contact lists, or smart folders to the product.

Outlook remains usable when the indexer is delayed. Sentinel profile history catches up when IMAP synchronization resumes.

## Native Windows packaging

Add one Windows solution under `outlook-bridge/` containing the smallest useful separation:

- `Gssg.Outlook.AddIn`: VSTO/COM Outlook task pane and selection/send event integration;
- `Gssg.Outlook.Launcher`: registered protocol handler and Outlook Object Model draft/open commands;
- `Gssg.Outlook.Shared`: API DTOs, device credential access, G-number normalization, and shared Outlook-location helpers; and
- focused tests for shared logic and command validation.

Target .NET Framework 4.8 and classic Outlook 2016 or later on supported Windows. Produce signed x86 and x64 installer packages; preflight selects the package matching Office bitness. The installer must:

- verify classic Outlook is installed;
- install the matching add-in registration and protocol handler;
- pin the approved Sentinel HTTPS origin so protocol input cannot redirect bridge data to another server;
- install prerequisites without downloading code at runtime;
- register an uninstall entry;
- leave new Outlook untouched but clearly mark it unsupported;
- support repair and clean uninstall; and
- verify the publisher signature before installation.

A deployment inventory must record Windows version, classic Outlook version/build, and Office bitness for every operator PC before final package selection. Unsupported PCs block rollout rather than receiving a partial launcher without the employee pane.

## Pairing and device identity

Pairing starts from authenticated Sentinel Settings.

1. Sentinel creates a random, five-minute, single-use pairing token and stores only its hash.
2. The browser invokes `gssg-outlook://pair/<token>`; the launcher contacts only its installer-pinned Sentinel origin.
3. The launcher reads the active classic Outlook profile's primary SMTP address and sends it with a generated device ID and machine label while redeeming the token.
4. Sentinel requires that address to match the signed-in user's configured email account.
5. Sentinel returns a random bridge device credential once.
6. The launcher stores that credential in Windows Credential Manager protected by DPAPI for the current Windows user.
7. The add-in and launcher use the device credential only in an authorization header to the paired Sentinel origin.

The server stores only the credential hash. An administrator or the owning user can revoke a device. Revocation takes effect on the next bridge call. Re-pairing rotates the credential. A paired device cannot change its owner, mailbox, or server origin in place.

The Outlook task pane displays the paired Sentinel identity and mailbox. A mailbox mismatch blocks employee results and handoffs; it is never treated as an empty result.

## Data model

### `correspondence_employee_links`

One row per indexed correspondence row and employee:

```text
id                    integer primary key
ledger_entry_id       FK ledger_entries.id, CASCADE, not null
employee_id           FK employees.id, CASCADE, not null
state                  linked | dismissed
source                 detected | manual | legacy
acted_by_user_id       users.id, nullable for automatic/background work
created_at             UTC datetime
updated_at             UTC datetime
```

Constraints and indexes:

- unique `(ledger_entry_id, employee_id)`;
- index `(employee_id, state, ledger_entry_id)` for profile history;
- index `(ledger_entry_id, state)` for Outlook pane resolution.

State transition rules:

- a new real G-number creates `linked/detected`;
- another sync leaves an existing `dismissed` row unchanged;
- operator removal changes the row to `dismissed` and records the actor;
- operator add changes or creates `linked/manual` and records the actor;
- automatic detection never downgrades `manual` to `detected`;
- historical `related_employee_id` backfill creates `linked/legacy`;
- deleting an employee removes only links, never correspondence history.

`LedgerEntry.related_employee_id` remains during the migration window only to support backfill and rollback. All application reads and writes move to the join table before the old field is removed from code. The physical database column may remain unused if dropping it would force a high-risk SQLite table rebuild solely for cleanup.

### `outlook_bridge_devices`

```text
id                    UUID/string primary key
owner_user_id         FK users.id, not null
mailbox_address       normalized email, not null
device_label          bounded display string
device_credential_hash fixed hash, unique, not null
created_at             UTC datetime
last_seen_at           UTC datetime
revoked_at             UTC datetime, nullable
```


### `outlook_pairings`

A short-lived record containing token hash, owner, expected mailbox, expiry, redeemed time, and creation time. Redeeming is atomic and succeeds once.

### `outlook_handoffs`

A short-lived compose/open envelope:

```text
id                    integer primary key
token_hash             fixed hash, unique, not null
owner_user_id          users.id, not null
kind                   compose | open
payload                validated JSON
created_at             UTC datetime
expires_at             UTC datetime
redeemed_at             UTC datetime, nullable
completed_at            UTC datetime, nullable
failure_code            bounded string, nullable
```

Compose payload contains normalized recipients, bounded subject and HTML body, the originating basket key, and typed attachment references such as book/document IDs. It never accepts arbitrary server or client file paths. The server rechecks the owner user's access before each attachment download.

The raw token exists only in the protocol URL and process memory. Redemption is atomic. On successful draft creation, the payload is erased and only status/timestamps remain. Expired and completed rows are removed by bounded opportunistic cleanup; no new scheduler exists solely for handoffs.

### `outlook_item_locations`

Per-device cache keyed by device and indexed correspondence row, containing Outlook Store ID, Entry ID, Internet Message-ID, and last verification time. Failure to open a cached location deletes it before Message-ID search. These IDs are location hints, never the audit identity.

## API boundary

The generated OpenAPI contract must expose narrow Outlook-bridge and employee-correspondence operations rather than the old general mailbox API.

Authenticated browser/session operations:

- create/revoke/list device pairings;
- create a compose or open handoff;
- list an employee's correspondence history; and
- read indexer health/settings.

Pairing-token operation:

- redeem one unexpired pairing token with the detected mailbox and generated device identity; return the device credential once.

Device-credential operations:

- resolve a selected message from Internet Message-ID plus detected G-numbers;
- add or dismiss an employee link for an indexed message;
- save/refresh Outlook location hints;
- redeem a handoff and fetch its authorized attachments; and
- mark handoff completion or a bounded failure code.

Selection resolution returns employee-summary DTOs only. It does not return stored message HTML or attachment contents to the task pane.

Every operation enforces owner/mailbox scope. Administrator all-mail access in the old Ledger does not transfer to an Outlook bridge device: a device can access only its paired mailbox and employee summaries permitted to its Sentinel user.

Route/schema changes require regeneration of `backend/openapi.json` and `frontend/src/lib/api.types.ts` through the project `sync-api-types` workflow.

## Operator workflows

### Read an email in Outlook

1. Operator selects a message.
2. Add-in cancels any previous selection request.
3. It reads the Internet Message-ID and Outlook location and detects canonical `G` plus three or four digits in subject and body.
4. It normalizes and deduplicates the detected IDs.
5. Device-authenticated selection resolution returns the union of real local matches and durable matches already found by message indexing or attachment OCR.
6. Pane renders the current message's cards only.
7. Background services record subject/body and supported-attachment matches whether or not the message was opened.

If the message is not indexed yet, cards still display from roster lookup, with recording shown as pending. Manual link changes become available once indexing creates the correspondence row. The pane refreshes after the next index success without blocking Outlook.

Drafts and unsent messages may show detected employee cards locally, but they do not create employee-profile history until Outlook sends them and IMAP imports the sent item.

### Correct employee links

- **Remove incorrect link:** set `dismissed`; remove the message from that employee's active correspondence history; preserve the decision across sync.
- **Add employee:** search by name or G-number; set `linked/manual`; show the message on that profile even if the G-number is absent.
- **Open profile:** invoke the configured Sentinel employee URL in the existing desktop shell/browser behavior without exposing a device credential in the URL.

### Prepare an email basket in Outlook

1. Operator adds generated records/documents to the existing basket.
2. Current basket grouping and template logic builds one message per basket group, preserving subject, bilingual body, recipient suggestions, document order, and selected PDF attachments.
3. Operator chooses **Prepare in Outlook**.
4. Sentinel validates the composition and typed document references, writes a five-minute handoff, and invokes the protocol.
5. Launcher redeems the handoff once and stages all attachments.
6. Launcher creates and displays one saved Outlook draft with the Outlook signature preserved.
7. Launcher reports completion.
8. Sentinel clears only that basket group after confirmed completion.

If the operator discards the resulting Outlook draft, Outlook owns that decision. Sentinel does not reconstruct or track Outlook drafts.

### Email an employee

The employee profile's **Email** action creates a handoff with the employee's known email address and G-number reference. Outlook opens a normal draft. Any existing record/reference attachment choice uses the same typed handoff mechanism as the basket.

### Open correspondence from an employee profile

1. Profile lists linked email metadata and historical non-email/document rows.
2. Selecting an email creates a short-lived `open` handoff and invokes the launcher.
3. Launcher validates the paired mailbox, tries cached Store/Entry IDs, then falls back to Internet Message-ID search.
4. Outlook opens the exact message and the add-in pane resolves the same employee set.
5. Selecting historical non-email/document rows opens the existing record/document destination where available; otherwise the row remains a read-only history entry.

Sentinel never falls back to rendering the email body.

## User-interface cutover

### Remove

- `/ledger` route and lazy page host;
- all `frontend/src/pages/ledger/` mailbox/compose/search code;
- all ledger-only attachment/body/thread/recipient components not used elsewhere;
- old Ledger navigation entries and keyboard actions;
- dashboard recent-ledger and mailbox interaction widgets;
- email read/unread, flag, delete, draft, send, smart-folder, recipient-list, and mailbox-search client methods;
- user-facing SMTP compose/signature controls that Outlook now owns;
- employee activity links targeting `/ledger?open=...`; and
- English/Arabic Ledger mailbox strings after replacements have landed.

Before deletion, each file and API callsite must be checked because attachment preview and Scan Inbox share some renderer/service patterns. Shared utilities still used outside Ledger remain in their neutral location.

### Keep or reshape

- email account IMAP credentials and sync interval required by the hidden indexer;
- Email Sync status, renamed and moved into Settings as recording health;
- existing `ScanInbox.raw_text` as the only attachment-content source for correspondence linking;
- Scan Inbox email-attachment ingestion;
- email basket storage, grouping, templates, recipient learning, and document selection;
- employee activity/profile correspondence metadata;
- existing stored email/document history and attachments; and
- background sync scheduling and Message-ID deduplication.

The top navigation **Open Outlook** action invokes the launcher directly. It is not a React route pretending to be a mailbox. On an unsupported/unpaired PC it routes the user to the exact Settings remediation.

Record actions have desktop and mobile surfaces today. Because actual classic Outlook is a Windows desktop requirement, mobile surfaces must not expose a broken protocol action. They show a concise desktop-required state and retain no internal compose fallback.

All changed strings must have Arabic and English peers. Sentinel layout changes use logical CSS properties and receive the required i18n/RTL review. The Outlook pane itself mirrors card text/alignment for Arabic while retaining Outlook's pane placement.

## Background indexing and link semantics

The canonical detector remains `G` plus three or four digits, case-insensitive, with word boundaries. Frontend/TypeScript, backend/Python, and add-in/C# implementations share contract fixtures containing valid, invalid, Arabic-context, HTML, quoted-thread, attachment-OCR, and multiple-ID examples. Each runtime may implement the small regex natively; the fixture file prevents drift without adding a cross-language runtime dependency.

Import order for an incoming or sent email:

1. normalize and persist Internet Message-ID;
2. sanitize and store body/attachments using the existing security boundary;
3. extract unique canonical G-numbers from decoded subject and body text;
4. resolve IDs against employees in one bounded query;
5. upsert missing `linked/detected` rows;
6. leave `dismissed` and `linked/manual` rows unchanged;
7. enqueue supported attachments in Scan Inbox; and
8. commit message and links atomically.

Attachment detection runs later inside the existing Scan Inbox drain. When a row has `source == "email_attachment"`, a parent `ledger_entry_id`, and nonempty `raw_text`, the drain runs the same detector/resolver against that stored OCR output and upserts `linked/detected` rows in the OCR transaction. It does not reopen the attachment or run another extractor. Unsupported formats, empty OCR, and OCR failure create no automatic link; manual linking remains available.

Detection never links a syntactically valid but nonexistent G-number. Multiple real G-numbers across message text and supported attachment OCR link all employees. Later sync/OCR work never erases a manual link or dismissal. Automatic links remain as auditable history unless an operator dismisses them.

## Error behavior

### Unsupported Outlook client

- Classic Outlook not installed: **Classic Outlook is required on this PC. Install or repair it, then try again.**
- New Outlook active: **This Sentinel connection works with classic Outlook only. Open classic Outlook and retry.**
- Unsupported Office bitness/build: installer blocks with the detected version and approved package requirement.

No mailto fallback is provided because it cannot preserve attachment authorization, exact Outlook open, or employee pane behavior.

### Pairing and authorization

- Expired/redeemed pairing token: request a new pairing from Settings.
- Revoked device: pane hides employee data, launcher blocks handoffs, and Settings offers re-pairing.
- Mailbox mismatch: show expected and detected mailbox addresses only to the signed-in user; do not attempt another store.
- Sentinel unavailable: Outlook remains usable; pane states that employee context is temporarily unavailable.

### Compose handoff

- Expired/reused token: basket remains and the operator prepares again.
- Any recipient/body validation failure: no protocol launch.
- Any attachment authorization/download failure: no draft is created; staged files are removed; basket remains.
- Outlook save/display failure: draft is not marked complete; basket remains.
- Completion callback failure after a saved draft: launcher retries a bounded number of times and records a local receipt. Sentinel may leave the basket until reconciliation, but must never create a second draft automatically.

### Indexing

- IMAP failure: Outlook work continues; Settings reports delayed recording and last successful timestamp.
- Sync recovery: existing Message-ID deduplication catches up without duplicate profile rows.
- Message without Internet Message-ID: may be indexed and linked, but exact Outlook open is unavailable; profile states **Outlook message ID unavailable** rather than opening a possibly wrong message.
- Cached Outlook location stale: invalidate, search by Message-ID, refresh cache.
- Message absent from paired mailbox: **This email is no longer available in the paired Outlook mailbox.** No Sentinel reader fallback.

## Security and privacy constraints

- Device credentials and handoff tokens are at least 32 random bytes.
- Server stores hashes, not raw credentials/tokens.
- Device secrets stay in Windows Credential Manager/DPAPI for the current Windows user.
- Protocol URLs contain no PII or mail composition.
- Add-in selection sends detected IDs and message/location identifiers, not the body.
- Handoff payload access is single-use, short-lived, owner-scoped, and mailbox-scoped.
- Attachment references are typed server records; arbitrary paths and URLs are rejected.
- Existing document access checks run again when the launcher downloads attachments.
- Temporary attachment staging uses a private per-user directory and guaranteed cleanup.
- Logs exclude message body, recipients, employee names/G-numbers, tokens, device credentials, Outlook Entry/Store IDs, and attachment contents. Logs may contain bounded failure codes and correlation IDs.
- Installer, launcher, and add-in binaries are publisher-signed. Unsigned or modified packages do not receive production pairing support.
- The Outlook add-in does no network or database work on Outlook's UI thread.

## Migration and rollout

This checkout is production. Implementation and packaging occur in an isolated worktree. Deployment follows the project rule: committed and pushed to `origin/main` before `mng update`/deploy.

### Preflight

1. Inventory classic Outlook version/build and Office bitness on every operator PC.
2. Confirm each Outlook primary mailbox matches the Sentinel user's configured IONOS mailbox.
3. Back up the SQLite database and `data/ledger_attachments` through the existing backup process.
4. Confirm exactly one Alembic head.
5. Export the one current Sentinel draft into classic Outlook and obtain operator confirmation before composer removal.
6. Capture current IMAP index health and Scan Inbox ingestion as baseline evidence.

### Server-compatible rollout

1. Add reversible SQLite-safe schema for links, bridge devices, pairing/handoffs, and item locations.
2. Backfill legacy employee relationships without changing existing history.
3. Add bridge/profile APIs and automatic multi-link indexing.
4. Keep the old UI temporarily reachable only during the same controlled rollout window while real Outlook integration is installed and smoke-tested.
5. Install, pair, and smoke-test the signed bridge on every operator PC.

### Clean cutover

1. Switch navigation, basket, employee email, and profile-open actions to Outlook.
2. Remove old mailbox UI/API code and regenerate the API contract.
3. Remove Sentinel SMTP send/draft behavior and obsolete settings/copy.
4. Verify automatic indexing, Scan Inbox, profile history, and exact Outlook open in production.
5. Remove temporary rollout gates/scaffolding before the feature branch is considered complete.

Rollback reverts the application/installer release and disables bridge device credentials. The additive link/device/handoff tables are reversible, and original correspondence rows remain untouched. No rollback step deletes mail or attachments.

Schema changes require the project Alembic migration review and confirmation of exactly one head.

## Verification strategy

### Backend contract tests

Tests must defend observable behavior:

- one message links every real G-number detected across subject, body, and existing supported-attachment OCR;
- nonexistent and malformed IDs do not link;
- unsupported attachment formats, empty OCR, and OCR failure create no automatic link;
- manual dismissal survives repeated sync;
- manual add survives detector runs;
- legacy relationship backfill is complete and idempotent;
- employee profile history has no duplicate message/employee rows;
- pairing and handoff tokens expire, redeem once, and reject another user/device/mailbox;
- attachment download rechecks record access;
- device revocation blocks selection and handoff calls;
- Message-ID deduplication still prevents duplicate import; and
- IMAP email attachments still enter Scan Inbox.

### Frontend contract tests

- navigation invokes Outlook and has no `/ledger` route;
- unsupported/mobile clients receive remediation without an internal compose fallback;
- employee correspondence metadata renders and exact-open creates one handoff;
- basket remains after failed handoff and clears only after confirmed Outlook draft creation;
- Arabic and English keys remain structurally equal for every changed surface; and
- removed Ledger widgets/actions are absent from customization and keyboard navigation.

### Native bridge tests

Shared/native tests cover:

- canonical G-number fixtures in C#;
- protocol command parsing rejects malformed operations/tokens, unexpected arguments, and every attempt to override the pinned origin;
- DPAPI credential load/rotation/revocation behavior;
- stale selection cancellation;
- Outlook HTML body insertion preserves an existing signature marker/content;
- attachment staging cleanup on every failure path;
- exact-open cache miss falls back to Message-ID search; and
- wrong Store/mailbox results never open.

COM-specific behavior must be behind the thinnest practical Outlook boundary so deterministic command/data logic runs without Outlook. This boundary exists for testability, not future provider abstraction.

### Real Outlook acceptance

Use a non-production IONOS test mailbox on representative operator hardware, then repeat the smoke path on every supported Office bitness:

1. install and pair;
2. select mail containing one real G-number;
3. select mail containing multiple real G-numbers;
4. select mail whose only real G-number is in a supported PDF/image attachment, let Scan Inbox OCR it, and confirm the pane/profile gains the link without a second OCR pass;
5. confirm Arabic and English employee cards;
6. add and dismiss a link, sync twice, and confirm persistence;
7. prepare a basket containing multiple authorized PDFs and bilingual body;
8. confirm recipients, ordering, Outlook signature, attachment names, editable draft, and saved Drafts copy;
9. send and wait for automatic IMAP indexing;
10. confirm the sent message appears once on every linked employee profile;
11. open it from a profile;
12. move it to another Outlook folder and open it again through Message-ID fallback;
13. revoke the device and confirm both pane and launcher stop exposing Sentinel data;
14. test an intentionally wrong Outlook mailbox; and
15. stop IMAP temporarily, confirm Outlook remains usable, restore it, and confirm indexing catches up without duplicates.

Final project checks use the narrowest relevant backend/frontend commands, API type synchronization, migration review, and required i18n/RTL review. A real Outlook smoke test is mandatory; mocked COM tests alone cannot complete this feature.

## Risks and controls

| Risk | Control |
|---|---|
| Operators switch to new Outlook | Installer/settings state classic Outlook requirement; no misleading partial support. |
| Outlook disables a slow add-in | No network work on UI thread; cancel stale requests; bound caches and payloads. |
| Wrong mailbox exposes employee context | Device credential bound to owner and normalized mailbox; mismatch blocks. |
| Duplicate drafts after uncertain callback | Launcher never auto-retries draft creation; local completion receipt reconciles status only. |
| Email moved after location cache | Internet Message-ID fallback and cache refresh. |
| IMAP outage delays profile history | Outlook remains primary; delayed-recording health and catch-up dedup. |
| Auto-detection creates noise | Resolve real roster IDs only; all links visible; durable dismissal/manual correction. |
| Attachment OCR creates a false match | Reuse existing OCR only, resolve real roster IDs, and apply the same durable dismissal control. |
| Basket attachment authorization bypass | Typed references and access recheck at download. |
| Existing history lost during removal | Additive backfill, database/files backup, no row or attachment deletion. |
| Native installer drift across Office bitness | Preflight inventory and signed package per supported bitness. |

## Final acceptance

The replacement is complete only when:

- operators perform all mailbox work in classic Outlook;
- Sentinel contains no mailbox page or composer;
- employee context appears in the Outlook side pane without modifying messages;
- every valid employee detected in message text or supported existing attachment OCR is recorded automatically and remains correctable;
- employee profiles open exact Outlook mail and never render an internal email preview;
- the email basket creates a complete saved Outlook draft and fails without clearing the basket;
- historical correspondence and document rows remain available;
- Scan Inbox continues receiving indexed email attachments and supplies their existing OCR text to correspondence linking;
- all operator PCs pass the signed installer/pairing/real-mail smoke test; and
- old mailbox code, rollout scaffolding, obsolete API types, and stale bilingual copy are removed.
