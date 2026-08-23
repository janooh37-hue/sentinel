# Outlook Correspondence Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Sentinel's unused mailbox UI with classic Outlook while retaining automatic employee linking, existing attachment OCR linking, employee correspondence history, and generated-document basket handoff.

**Architecture:** Keep `ledger_entries` and IONOS IMAP synchronization as a hidden correspondence index. Add a many-to-many employee link model and narrow Outlook bridge APIs. A signed .NET Framework 4.8 VSTO add-in shows employee context; a signed protocol launcher creates Outlook drafts and opens exact messages. Sentinel removes its inbox, composer, unread state, smart folders, and SMTP send paths.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic/SQLite, React 19, React Query, TypeScript, classic Outlook Object Model/VSTO, C#/.NET Framework 4.8, WinForms, WiX MSI, Windows Credential Manager/DPAPI.

## Global Constraints

- Work only in an isolated Git worktree; the main checkout is live production.
- Deploy only committed code pushed to `origin/main`.
- Keep IONOS mailboxes and server-side IMAP indexing.
- Support classic Outlook 2016 or later on Windows only; do not add new Outlook, web, mobile, Mac, or `mailto:` fallbacks.
- Reuse `ScanInbox.raw_text` for PDF, PNG, JPG/JPEG, TIF/TIFF, WebP, BMP, and HEIC attachment detection. Never add another OCR pass or attachment parser.
- Preserve every `ledger_entries` row and attachment. Existing non-email/document rows remain read-only.
- Do not rename the physical `ledger_entries` table solely for cosmetics.
- Do not create a general Outlook/Office automation framework.
- Outlook owns drafts, signatures, spellcheck, send, reply, forward, folders, flags, search, and notifications.
- Sentinel user-facing copy uses **Outlook**, **Email**, or **Correspondence**, never **Ledger**.
- Arabic and English are peers; run the required i18n/RTL review for UI changes.
- Schema work uses the project `new-migration` skill, SQLite-safe operations, revision `0078_outlook_correspondence`, and exactly one Alembic head.
- Route/schema changes use the project `sync-api-types` skill.
- The production installer is signed with the certificate selected by `%GSSG_CODESIGN_THUMBPRINT%`; never commit a certificate or secret.

## File Map

### Shared contract

- Create `shared/contracts/gnumber_cases.json`: valid/invalid canonical detection fixtures consumed by Python, TypeScript, and C# tests.

### Backend

- Create `backend/app/core/gnumber.py`: canonical detector.
- Create `backend/app/services/correspondence_link_service.py`: link upsert, dismissal, manual-link, profile list.
- Create `backend/app/services/outlook_bridge_service.py`: pairing, device auth, handoffs, location cache, selection resolution.
- Create `backend/app/schemas/outlook_bridge.py`: browser/device DTOs.
- Create `backend/app/api/v1/outlook_bridge.py`: session and device routers.
- Create `backend/app/db/migrations/versions/0078_outlook_correspondence.py`.
- Modify `backend/app/db/models.py`, `backend/app/main.py`, `backend/app/services/email_service.py`, `backend/app/services/scan_inbox_service.py`, `backend/app/services/employee_activity_service.py`, `backend/app/services/employee_detail_service.py`, `backend/app/api/v1/employees.py`, `backend/app/schemas/correspondence.py`, `backend/app/schemas/email.py`, `backend/app/services/notification_service.py`, `backend/app/services/scheduler_service.py`, and `backend/app/services/dashboard_service.py`.
- Delete mailbox-only routers/services/schemas in the final cutover task after all callers migrate.

### Frontend

- Create `frontend/src/lib/outlookBridge.ts` and `outlookBridge.test.ts`.
- Create `frontend/src/pages/settings/OutlookConnectionSection.tsx` and test.
- Create `frontend/src/pages/employees/tabs/CorrespondenceTab.tsx` and test.
- Create `frontend/src/lib/composeReference.ts` for the basket's neutral attachment-reference type.
- Modify employee detail/activity surfaces, settings, basket tray, navigation, dashboard layout, `App.tsx`, API client/types, and locales.
- Move shared PDF/file renderers out of `components/ledger` before deleting that directory.

### Native Windows bridge

- Create `outlook-bridge/Gssg.Outlook.sln`.
- Create `outlook-bridge/src/Gssg.Outlook.Shared/` for contracts, API client, credential store, protocol parsing, and pure Outlook helpers.
- Create `outlook-bridge/src/Gssg.Outlook.Launcher/` for protocol registration commands and Outlook automation.
- Create `outlook-bridge/src/Gssg.Outlook.AddIn/` for Explorer/Inspector events and the WinForms task pane.
- Create `outlook-bridge/tests/Gssg.Outlook.Tests/`.
- Create `outlook-bridge/installer/` with x86/x64 WiX configurations.

---

### Task 1: Correspondence persistence, detector, and backfill

**Files:**
- Create: `shared/contracts/gnumber_cases.json`
- Create: `backend/app/core/gnumber.py`
- Create: `backend/app/services/correspondence_link_service.py`
- Create: `backend/app/db/migrations/versions/0078_outlook_correspondence.py`
- Create: `backend/tests/test_gnumber_contract.py`
- Create: `frontend/src/lib/gnumber.contract.test.ts`
- Create: `backend/tests/test_correspondence_link_service.py`
- Create: `backend/tests/test_migration_outlook_correspondence.py`
- Modify: `backend/app/db/models.py:873-960,1435-1522,1780-1820`

**Interfaces:**
- Produces: `detect_g_numbers(text: str) -> tuple[str, ...]`.
- Produces: `sync_detected_links(db: Session, *, entry_id: int, employee_ids: Collection[str]) -> list[CorrespondenceEmployeeLink]`.
- Produces: `set_manual_link(db: Session, *, entry_id: int, employee_id: str, actor_user_id: int) -> CorrespondenceEmployeeLink`.
- Produces: `dismiss_link(db: Session, *, entry_id: int, employee_id: str, actor_user_id: int) -> CorrespondenceEmployeeLink`.
- Produces ORM models `CorrespondenceEmployeeLink`, `OutlookBridgeDevice`, `OutlookPairing`, `OutlookHandoff`, and `OutlookItemLocation` for later tasks.

- [ ] **Step 1: Add the cross-language detector fixture**

```json
{
  "valid": [
    { "text": "Employee G123 is assigned", "matches": ["G123"] },
    { "text": "G1234 و g3082", "matches": ["G1234", "G3082"] },
    { "text": "G3082, G3082", "matches": ["G3082"] }
  ],
  "invalid": [
    { "text": "AG1234X", "matches": [] },
    { "text": "G12 G12345", "matches": [] }
  ]
}
```

- [ ] **Step 2: Write failing detector and link-state tests**

```python
from app.core.gnumber import detect_g_numbers
from app.services import correspondence_link_service as links


def test_detector_normalizes_and_deduplicates() -> None:
    assert detect_g_numbers("g3082 / G3082 / G123") == ("G3082", "G123")


def test_dismissal_survives_detection(db_session, ledger_email, employees) -> None:
    links.sync_detected_links(db_session, entry_id=ledger_email.id, employee_ids={"G3082"})
    links.dismiss_link(
        db_session,
        entry_id=ledger_email.id,
        employee_id="G3082",
        actor_user_id=employees.user.id,
    )
    links.sync_detected_links(db_session, entry_id=ledger_email.id, employee_ids={"G3082"})
    row = links.get_link(db_session, entry_id=ledger_email.id, employee_id="G3082")
    assert row.state == "dismissed"
```

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_gnumber_contract.py backend/tests/test_correspondence_link_service.py -q
pnpm -C frontend exec vitest run src/lib/gnumber.contract.test.ts
```

Expected: import failures for the new module/service.

- [ ] **Step 4: Implement the canonical detector and link service**

```python
G_NUMBER_RE = re.compile(r"\bG\d{3,4}\b", re.IGNORECASE)


def detect_g_numbers(text: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys(match.group(0).upper() for match in G_NUMBER_RE.finditer(text)))
```

Add a TypeScript contract test that loads the same JSON fixture and checks the existing `gNumberRegex()` output. Do not add another frontend detector.

`sync_detected_links` must query existing employees once, insert only real IDs, preserve `dismissed` and `manual`, and flush without committing so callers own transaction boundaries.

- [ ] **Step 5: Add ORM models and migration tests**

The migration creates:

```text
correspondence_employee_links
outlook_bridge_devices
outlook_pairings
outlook_handoffs
outlook_item_locations
```

Use unique constraints from the design. Store only token/device hashes. Keep `LedgerEntry.related_employee_id` physically present.

The migration data backfill must:

1. insert `linked/legacy` for every non-null `related_employee_id`;
2. parse stored email `subject + notes_html`, resolve against existing employee IDs, and insert `linked/detected`;
3. parse existing `scan_inbox.raw_text` only where `source='email_attachment'` and `ledger_entry_id IS NOT NULL`; and
4. use `INSERT OR IGNORE` so re-running is idempotent.

The migration test must upgrade a temporary DB from revision `0077_timesheet_roster_assignments`, seed one legacy link, one body-only G-number, and one attachment-OCR-only G-number, then upgrade to head and assert all three links.

- [ ] **Step 6: Run migration and model checks**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_gnumber_contract.py backend/tests/test_correspondence_link_service.py backend/tests/test_migration_outlook_correspondence.py -q
pnpm -C frontend exec vitest run src/lib/gnumber.contract.test.ts
venv\Scripts\python.exe -m alembic heads
```

Expected: tests pass; exactly `0078_outlook_correspondence (head)`.

- [ ] **Step 7: Run the required migration review and commit**

Use the project `alembic-migration-reviewer`; confirm SQLite safety, downgrade shape, backfill idempotence, and one head.

```powershell
git add shared/contracts/gnumber_cases.json backend/app/core/gnumber.py backend/app/services/correspondence_link_service.py backend/app/db/models.py backend/app/db/migrations/versions/0078_outlook_correspondence.py backend/tests/test_gnumber_contract.py backend/tests/test_correspondence_link_service.py backend/tests/test_migration_outlook_correspondence.py frontend/src/lib/gnumber.contract.test.ts
git commit -m "feat(correspondence): add employee link persistence"
```

---

### Task 2: Runtime message and attachment linking

**Files:**
- Create: `backend/tests/test_email_correspondence_links.py`
- Create: `backend/tests/test_scan_inbox_correspondence_links.py`
- Modify: `backend/app/services/email_service.py:1048-1123`
- Modify: `backend/app/services/scan_inbox_service.py:108-173`

**Interfaces:**
- Consumes: Task 1 `detect_g_numbers` and `sync_detected_links`.
- Produces: automatic links for new/resynced messages and existing Scan Inbox OCR output.

- [ ] **Step 1: Write failing message-index tests**

```python
def test_email_text_links_every_real_employee(db_session, email_entry, employees) -> None:
    index_entry_text(db_session, email_entry, "G3082 and G1234 and G9999")
    assert active_employee_ids(db_session, email_entry.id) == {"G3082", "G1234"}


def test_resync_does_not_restore_dismissed_link(db_session, email_entry, employees) -> None:
    dismiss_link(db_session, entry_id=email_entry.id, employee_id="G3082", actor_user_id=1)
    index_entry_text(db_session, email_entry, "G3082")
    assert active_employee_ids(db_session, email_entry.id) == set()
```

- [ ] **Step 2: Write the failing Scan Inbox OCR contract**

Mock the existing OCR call to return `"Document for G3082 and G1234"`, create `ScanInbox(source="email_attachment", ledger_entry_id=email_entry.id)`, call `_process_one`, and assert both links. Add sibling cases for empty OCR, invalid image, and a non-email attachment source; none may create correspondence links.

- [ ] **Step 3: Run focused tests and confirm failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_email_correspondence_links.py backend/tests/test_scan_inbox_correspondence_links.py -q
```

- [ ] **Step 4: Wire detection into IMAP import and resync**

Add a small service entry point:

```python
def index_entry_text(db: Session, entry: LedgerEntry, text: str) -> None:
    sync_detected_links(
        db,
        entry_id=entry.id,
        employee_ids=detect_g_numbers(text),
    )
```

Call it after `db.flush()` and before the per-row commit using `f"{entry.subject}\n{entry.notes_html or ''}"`. On duplicate Message-ID rows, call it after loading the existing entry so historical resyncs repair links without creating duplicate mail.

- [ ] **Step 5: Reuse Scan Inbox `raw_text` in the existing OCR transaction**

Immediately after `item.raw_text = text`, call the same detector only when:

```python
item.source == "email_attachment" and item.ledger_entry_id is not None and bool(text)
```

Do not read the file again. Do not add formats to `SCANNABLE_EXTS`. Let `_process_one`'s existing commit persist OCR state and links together.

- [ ] **Step 6: Run focused and existing Scan Inbox tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_email_correspondence_links.py backend/tests/test_scan_inbox_correspondence_links.py backend/tests/test_scan_inbox_document.py backend/tests/test_scan_inbox_nplus1.py -q
```

- [ ] **Step 7: Commit**

```powershell
git add backend/app/services/email_service.py backend/app/services/scan_inbox_service.py backend/tests/test_email_correspondence_links.py backend/tests/test_scan_inbox_correspondence_links.py
git commit -m "feat(correspondence): link email and attachment G-numbers"
```

---

### Task 3: Employee correspondence API and profile query contract

**Files:**
- Create: `backend/tests/test_employee_correspondence_api.py`
- Modify: `backend/app/schemas/correspondence.py`
- Modify: `backend/app/services/correspondence_link_service.py`
- Modify: `backend/app/api/v1/employees.py:206-245`
- Modify: `backend/app/services/employee_activity_service.py:155-206`
- Modify: `backend/app/services/employee_detail_service.py:70-165`
- Modify: `backend/tests/test_employee_activity_service.py`
- Modify: `backend/tests/test_employee_activity_api.py`

**Interfaces:**
- Produces: `GET /api/v1/employees/{employee_id}/correspondence?limit=&offset=`.
- Produces: `CorrespondenceItemRead` and `CorrespondenceListRead`.
- Consumes: active rows from `correspondence_employee_links`.

- [ ] **Step 1: Define and test the response contract**

```python
class CorrespondenceAddress(BaseModel):
    name: str = ""
    address: str


class CorrespondenceItemRead(BaseModel):
    entry_id: int
    channel: str
    entry_date: date
    direction: str
    counterparty: str
    subject: str
    to_recipients: list[CorrespondenceAddress]
    cc_recipients: list[CorrespondenceAddress]
    attachment_count: int
    link_source: Literal["detected", "manual", "legacy"]
    can_open_in_outlook: bool


class CorrespondenceListRead(BaseModel):
    items: list[CorrespondenceItemRead]
    total: int
```

The failing API test must prove one email linked to two employees appears once on each profile, a dismissed link is absent, another owner's email is not leaked, and a legacy non-email row remains visible but `can_open_in_outlook=False`.

- [ ] **Step 2: Run the API/service tests and confirm failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_employee_correspondence_api.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py -q
```

- [ ] **Step 3: Implement the profile query**

Join `CorrespondenceEmployeeLink -> LedgerEntry`; filter `state == "linked"`, `deleted_at IS NULL`, and mailbox ownership for email rows. Order by `created_at DESC, id DESC`. Count before applying `limit/offset`. `attachment_count` is `len(attachment_paths or [])`; do not expose body HTML or attachment paths.

- [ ] **Step 4: Migrate existing employee-detail/activity queries**

Replace `LedgerEntry.related_employee_id == Employee.id` joins with `CorrespondenceEmployeeLink.employee_id`. Keep the internal activity discriminator `"ledger"` to avoid an unrelated generated-contract rename, but all copy becomes **Correspondence**. Exclude draft-tag rows until the final draft removal task.

- [ ] **Step 5: Run tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_employee_correspondence_api.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py -q
```

- [ ] **Step 6: Commit**

```powershell
git add backend/app/schemas/correspondence.py backend/app/services/correspondence_link_service.py backend/app/api/v1/employees.py backend/app/services/employee_activity_service.py backend/app/services/employee_detail_service.py backend/tests/test_employee_correspondence_api.py backend/tests/test_employee_activity_service.py backend/tests/test_employee_activity_api.py
git commit -m "feat(employees): expose linked correspondence history"
```

---

### Task 4: Pairing, device authentication, and one-time handoff API

**Files:**
- Create: `backend/app/schemas/outlook_bridge.py`
- Create: `backend/app/services/outlook_bridge_service.py`
- Create: `backend/app/api/v1/outlook_bridge.py`
- Create: `backend/tests/test_outlook_bridge_service.py`
- Create: `backend/tests/test_outlook_bridge_api.py`
- Modify: `backend/app/main.py:181-215`
- Modify: `backend/app/services/document_service.py` only to expose the existing access-checked PDF resolver used by handoff downloads.

**Interfaces:**
- Browser/session router prefix: `/outlook`.
- Device router prefix: `/outlook/device`, mounted without the session gate and protected by its own bearer dependency.
- Pairing lifetime: 5 minutes, single use.
- Handoff lifetime: 5 minutes, single use.

Browser endpoints:

```text
POST   /api/v1/outlook/pairings
GET    /api/v1/outlook/devices
DELETE /api/v1/outlook/devices/{device_id}
POST   /api/v1/outlook/handoffs
GET    /api/v1/outlook/handoffs/{handoff_id}
```

Device endpoints:

```text
POST   /api/v1/outlook/device/pair
POST   /api/v1/outlook/device/selection
GET    /api/v1/outlook/device/employees?q={query}&limit={limit}
GET    /api/v1/outlook/device/employees/{employee_id}/photo
PUT    /api/v1/outlook/device/messages/{entry_id}/employees/{employee_id}
DELETE /api/v1/outlook/device/messages/{entry_id}/employees/{employee_id}
POST   /api/v1/outlook/device/handoffs/redeem
GET    /api/v1/outlook/device/handoffs/{handoff_id}/attachments/{index}
POST   /api/v1/outlook/device/handoffs/{handoff_id}/complete
POST   /api/v1/outlook/device/handoffs/{handoff_id}/fail
```

- [ ] **Step 1: Write failing token/device tests**

```python
def test_pairing_redeems_once_and_hashes_secret(db_session, user, email_account) -> None:
    raw = create_pairing(db_session, owner_user_id=user.id)
    device, credential = redeem_pairing(
        db_session,
        raw_token=raw,
        device_id="pc-1",
        device_label="HR-01",
        mailbox_address=email_account.email,
    )
    assert credential not in device.device_credential_hash
    with pytest.raises(PairingInvalid):
        redeem_pairing(db_session, raw_token=raw, device_id="pc-2", device_label="HR-02", mailbox_address=email_account.email)


def test_revoked_device_cannot_redeem_handoff(client, paired_device) -> None:
    client.delete(
        f"/api/v1/outlook/devices/{paired_device.id}",
        headers=paired_device.user_headers,
    )
    response = client.post(
        "/api/v1/outlook/device/handoffs/redeem",
        headers=paired_device.device_headers,
        json={"token": "expired-or-revoked"},
    )
    assert response.status_code == 401
```

Also test expiry, mailbox mismatch, another user's handoff, typed-attachment access denial, payload erasure after completion, and failure status without automatic draft retry.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_service.py backend/tests/test_outlook_bridge_api.py -q
```

- [ ] **Step 3: Implement token hashing and device bearer dependency**

```python
def _issue_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode("ascii")).hexdigest()


def require_outlook_device(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> OutlookBridgeDevice:
    raw = parse_bearer(authorization)
    return authenticate_device(db, raw)
```

Use constant-time hash comparison. Update `last_seen_at` without logging the credential. Pair redeem is authorized only by the short-lived pairing token and expected mailbox; every other device endpoint requires bearer authentication.

- [ ] **Step 4: Implement selection resolution**

`OutlookSelectionRequest` carries `internet_message_id`, `outlook_store_id`, `outlook_entry_id`, and normalized `g_numbers`. Resolve only the paired owner mailbox. If the message is indexed, apply detected links and save the per-device location; return all active durable employee summaries. If not indexed, return roster summaries for the submitted IDs with `recording_pending=True` and do not create a partial `LedgerEntry`. Add a bounded device-authenticated employee search for manual linking and a device-authenticated photo stream; both reuse existing employee visibility/photo services and never expose vault paths.

- [ ] **Step 5: Implement typed compose/open handoffs**

```python
class OutlookAttachmentRef(BaseModel):
    kind: Literal["document_pdf"]
    document_id: int
    filename: str = Field(min_length=1, max_length=200)


class OutlookComposePayload(BaseModel):
    to: list[str]
    cc: list[str] = Field(default_factory=list)
    subject: str = Field(max_length=255)
    body_html: str = Field(max_length=500_000)
    basket_key: str = Field(max_length=160)
    attachments: list[OutlookAttachmentRef] = Field(max_length=50)
```

The attachment endpoint resolves `document_id` through existing document access checks and returns bytes with the validated filename. It accepts no path or arbitrary URL. An open handoff stores only `ledger_entry_id` and the paired owner.

- [ ] **Step 6: Mount both routers and run tests**

Mount the browser router with `auth_gate`; mount the device router without `auth_gate` because its own dependency is authoritative.

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_service.py backend/tests/test_outlook_bridge_api.py backend/tests/test_employee_correspondence_api.py -q
```

- [ ] **Step 7: Commit**

```powershell
git add backend/app/schemas/outlook_bridge.py backend/app/services/outlook_bridge_service.py backend/app/api/v1/outlook_bridge.py backend/app/main.py backend/app/services/document_service.py backend/tests/test_outlook_bridge_service.py backend/tests/test_outlook_bridge_api.py
git commit -m "feat(outlook): add secure bridge handoffs"
```

---

### Task 5: Native shared library, protocol launcher, and installer

**Files:**
- Create: `outlook-bridge/Gssg.Outlook.sln`
- Create: `outlook-bridge/Directory.Build.props`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/Gssg.Outlook.Shared.csproj`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/ProtocolCommand.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/SentinelApiClient.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/CredentialStore.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/GNumberDetector.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Shared/OutlookBody.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Launcher/Gssg.Outlook.Launcher.csproj`
- Create: `outlook-bridge/src/Gssg.Outlook.Launcher/Program.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.Launcher/OutlookClient.cs`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/Gssg.Outlook.Tests.csproj`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/ProtocolCommandTests.cs`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/OutlookBodyTests.cs`
- Create: `outlook-bridge/installer/Product.wxs`
- Create: `outlook-bridge/installer/Gssg.Outlook.Installer.wixproj`

**Interfaces:**
- Consumes Task 4 device/pairing/handoff endpoints.
- Registers `gssg-outlook://pair/<token>`, `compose/<token>`, and `open/<token>`.
- Uses installer-pinned `SentinelOrigin`; protocol input cannot override it.
- Stores one device credential in Windows Credential Manager under `GSSG Manager Outlook Bridge`.

- [ ] **Step 1: Create the minimal solution and failing pure tests**

Target `net48`; use framework `HttpClient`, `DataContractJsonSerializer`, WinCred P/Invoke, and Outlook COM references. Do not add a DI container or provider abstraction.

```csharp
[TestMethod]
public void ParseRejectsOriginOverride()
{
    Assert.ThrowsException<ProtocolException>(() =>
        ProtocolCommand.Parse("gssg-outlook://compose/token?origin=https://evil.example"));
}

[TestMethod]
public void PrependPreservesOutlookSignature()
{
    Assert.AreEqual("<p>Prepared</p><div>Signature</div>",
        OutlookBody.Prepend("<p>Prepared</p>", "<div>Signature</div>"));
}
```

- [ ] **Step 2: Run native tests and confirm failure**

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
```

- [ ] **Step 3: Implement protocol parsing, API client, and credential store**

```csharp
internal sealed class ProtocolCommand
{
    private ProtocolCommand(CommandKind kind, string token)
    {
        Kind = kind;
        Token = token;
    }

    internal CommandKind Kind { get; }
    internal string Token { get; }

    internal static ProtocolCommand Parse(string value)
    {
        var uri = new Uri(value);
        if (uri.Scheme != "gssg-outlook" || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new ProtocolException("Invalid Outlook bridge URI.");

        CommandKind kind;
        switch (uri.Host)
        {
            case "pair": kind = CommandKind.Pair; break;
            case "compose": kind = CommandKind.Compose; break;
            case "open": kind = CommandKind.Open; break;
            default: throw new ProtocolException("Unknown Outlook bridge command.");
        }

        var token = uri.AbsolutePath.Trim('/');
        if (token.Length == 0 || token.Contains("/"))
            throw new ProtocolException("Invalid Outlook bridge token.");
        return new ProtocolCommand(kind, token);
    }
}
```

Allowed command hosts are exactly `pair`, `compose`, and `open`; token is one nonempty path segment; query and fragment are rejected. `SentinelApiClient` receives the pinned origin from installer configuration and device bearer from `CredentialStore`.

- [ ] **Step 4: Implement Outlook draft creation and exact-open**

`OutlookClient.CreateDraft` must:

1. download every attachment before creating a `MailItem`;
2. call `Display(false)` to let Outlook load its signature;
3. prepend prepared HTML to the current `HTMLBody`;
4. set To/Cc/Subject and add attachments;
5. `Save()` and leave the Inspector open;
6. close with `OlInspectorClose.olDiscard` on failure; and
7. remove staged files in `finally` after Outlook copies them.

`OpenMessage` first calls `Session.GetItemFromID(entryId, storeId)`. On COM failure it searches only the paired store using `PR_INTERNET_MESSAGE_ID` (`0x1035001F`), opens the result, and posts the refreshed location.

- [ ] **Step 5: Implement launcher command flow**

- Pair: read active Outlook profile SMTP address; redeem pairing; save returned credential.
- Compose: authenticate device; redeem handoff; create draft; report complete. Never recreate a draft when completion callback alone fails; write one local completion receipt and retry status only.
- Open: authenticate/redeem; open exact message; report refreshed location.

Return user-visible native errors for missing classic Outlook, new Outlook active without classic, pairing required, mailbox mismatch, expired token, attachment failure, and message absent.

- [ ] **Step 6: Build the launcher MSI base for x86/x64**

At this task boundary the MSI installs the launcher, protocol handler, uninstall entry, and pinned Sentinel HTTPS origin. Build both configurations and verify signatures; Task 6 adds the VSTO add-in registration to the same product. Do not deploy this launcher-only package to operators and do not download prerequisites at runtime.

```powershell
msbuild outlook-bridge\Gssg.Outlook.sln /m /p:Configuration=Release /p:Platform=x64
msbuild outlook-bridge\Gssg.Outlook.sln /m /p:Configuration=Release /p:Platform=x86
signtool verify /pa /all outlook-bridge\dist\x64\*.msi
signtool verify /pa /all outlook-bridge\dist\x86\*.msi
```

- [ ] **Step 7: Run native tests and a launcher smoke test**

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
outlook-bridge\dist\x64\Gssg.Outlook.Launcher.exe --self-test
```

`--self-test` verifies pinned origin, credential store access, classic Outlook COM activation, active mailbox discovery, and protocol registration without opening or sending mail.

- [ ] **Step 8: Commit**

```powershell
git add outlook-bridge
git commit -m "feat(outlook): add signed launcher and installer base"
```

---

### Task 6: Classic Outlook employee task pane

**Files:**
- Create: `outlook-bridge/src/Gssg.Outlook.AddIn/Gssg.Outlook.AddIn.csproj`
- Create: `outlook-bridge/src/Gssg.Outlook.AddIn/ThisAddIn.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.AddIn/EmployeeTaskPane.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.AddIn/SelectionController.cs`
- Create: `outlook-bridge/src/Gssg.Outlook.AddIn/EmployeeCardControl.cs`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/SelectionControllerTests.cs`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/GNumberContractTests.cs`
- Modify: `outlook-bridge/installer/Product.wxs`

**Interfaces:**
- Consumes Task 4 `selection`, manual-link, dismissal, employee photo, and location APIs.
- Consumes Task 5 shared detector/API/credential classes.
- Produces one task pane per Outlook Explorer/Inspector context.

- [ ] **Step 1: Write failing selection-order and fixture tests**

```csharp
[TestMethod]
public async Task StaleSelectionCannotReplaceCurrentCards()
{
    var controller = new SelectionController(fakeApi);
    var first = controller.SelectAsync(message1);
    var second = controller.SelectAsync(message2);
    await Task.WhenAll(first, second);
    Assert.AreEqual(message2.MessageId, controller.State.MessageId);
}
```

Load `shared/contracts/gnumber_cases.json` from the repository and assert the C# detector matches every fixture.

- [ ] **Step 2: Run native tests and confirm failure**

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
```

- [ ] **Step 3: Implement selection extraction without blocking Outlook**

Listen to `Explorer.SelectionChange` and `Inspectors.NewInspector`. Read:

```text
MailItem.EntryID
MailItem.Parent.StoreID
PR_INTERNET_MESSAGE_ID = http://schemas.microsoft.com/mapi/proptag/0x1035001F
MailItem.Subject
MailItem.Body
```

Run network work asynchronously. Use a monotonically increasing selection generation plus `CancellationTokenSource`; apply a response only when its generation is still current. Do not download attachments.

- [ ] **Step 4: Implement the bilingual WinForms pane**

Render paired identity/mailbox, loading/error states, employee photo/name/G-number/position/status, **Open profile**, **Remove link**, and a compact manual employee search. Apply `RightToLeft.Yes` and right alignment for Arabic strings while leaving Outlook pane placement unchanged.

The API response union must include durable attachment-OCR links even when their G-number is absent from the message body.

- [ ] **Step 5: Implement add/dismiss/open actions**

Manual add/dismiss is enabled only when the message has an indexed `entry_id`. If indexing is pending, show **Recording pending** and refresh after the next successful sync response. Open profile uses the ordinary authenticated Sentinel employee URL; never place the device credential in a URL.

- [ ] **Step 6: Run tests, build both bitnesses, and smoke Outlook**

Complete `Product.wxs` with the VSTO registration and matching Office-bitness checks before building. These are the first deployable bridge packages.

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
msbuild outlook-bridge\Gssg.Outlook.sln /m /p:Configuration=Release /p:Platform=x64
msbuild outlook-bridge\Gssg.Outlook.sln /m /p:Configuration=Release /p:Platform=x86
signtool verify /pa /all outlook-bridge\dist\x64\*.msi
signtool verify /pa /all outlook-bridge\dist\x86\*.msi
```

Manual smoke on a non-production IONOS mailbox: one G-number, multiple G-numbers, attachment-only link after existing OCR, rapid selection changes, manual add/dismiss, Arabic pane, revoked credential, and wrong mailbox.

- [ ] **Step 7: Commit**

```powershell
git add outlook-bridge/src/Gssg.Outlook.AddIn outlook-bridge/tests/Gssg.Outlook.Tests outlook-bridge/installer/Product.wxs
git commit -m "feat(outlook): show employee context pane"
```

---

### Task 7: Sentinel pairing, basket handoff, and profile correspondence UI

**Files:**
- Create: `frontend/src/lib/outlookBridge.ts`
- Create: `frontend/src/lib/outlookBridge.test.ts`
- Create: `frontend/src/lib/composeReference.ts`
- Create: `frontend/src/pages/settings/OutlookConnectionSection.tsx`
- Create: `frontend/src/pages/settings/OutlookConnectionSection.test.tsx`
- Create: `frontend/src/pages/employees/tabs/CorrespondenceTab.tsx`
- Create: `frontend/src/pages/employees/tabs/CorrespondenceTab.test.tsx`
- Modify: `frontend/src/lib/basketEmail.ts:18-20,377-403`
- Modify: `frontend/src/components/shell/EmailBasketTray.tsx`
- Modify: `frontend/src/pages/settings/EmailSection.tsx`
- Modify: `frontend/src/pages/settings/SettingsPage.tsx`
- Modify: `frontend/src/pages/employees/EmployeeTabChips.tsx`
- Modify: `frontend/src/pages/employees/EmployeeDetailPage.tsx`
- Modify: `frontend/src/pages/employees/tabs/ActivityTab.tsx`
- Modify: `frontend/src/components/employees/EmployeeActivitySection.tsx`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/locales/en.json`
- Modify: `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes Task 3 correspondence list and Task 4 browser APIs.
- Produces: `launchOutlook(protocolUrl: string)`, `prepareBasketInOutlook`, and `openCorrespondenceInOutlook`.

- [ ] **Step 1: Write failing launcher/basket tests**

```typescript
it('clears only after the bridge confirms draft creation', async () => {
  api.createOutlookHandoff.mockResolvedValue({ id: 7, protocol_url: 'gssg-outlook://compose/token' })
  api.getOutlookHandoff.mockResolvedValueOnce({ status: 'redeemed' }).mockResolvedValueOnce({ status: 'completed' })
  await prepareBasketInOutlook(prefill)
  expect(clearBasket).toHaveBeenCalledWith(prefill.basketKey)
})

it('keeps the basket when handoff fails', async () => {
  api.getOutlookHandoff.mockResolvedValue({ status: 'failed', failure_code: 'ATTACHMENT_DOWNLOAD_FAILED' })
  await expect(prepareBasketInOutlook(prefill)).rejects.toThrow()
  expect(clearBasket).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Write failing profile/settings component tests**

Prove device pairing/revocation, index health copy, correspondence metadata, attachment indicator, legacy non-email disabled-open state, exact-open protocol invocation, and desktop-required mobile state.

- [ ] **Step 3: Run focused frontend tests and confirm failure**

```powershell
pnpm -C frontend exec vitest run src/lib/outlookBridge.test.ts src/pages/settings/OutlookConnectionSection.test.tsx src/pages/employees/tabs/CorrespondenceTab.test.tsx
```

- [ ] **Step 4: Implement the protocol helper and handoff polling**

Use a temporary hidden anchor with the `gssg-outlook://` URL and remove it immediately. Poll authenticated handoff status for at most five minutes with bounded intervals. Clear the originating basket group only on `completed`; keep it for `failed`, expiry, timeout, or launch error.
Use the existing `gNumberRegex()` when validating the employee ID placed in an employee-email handoff; this keeps the TypeScript contract live after Ledger-only detectors are deleted.

Convert basket references to typed attachments:

```typescript
attachments: prefill.references.map((ref) => ({
  kind: 'document_pdf' as const,
  document_id: ref.docId,
  filename: ref.fileName,
}))
```

Move `ComposeReference` to `lib/composeReference.ts`; do not retain a dependency on the deleted Ledger picker.

- [ ] **Step 5: Implement Settings sections**

- `OutlookConnectionSection`: list paired devices, pair this PC, revoke device, classic-only explanation.
- `EmailSection`: retain IONOS IMAP address/username/password/folders/sync interval, manual sync, and recording health. Remove SMTP controls and the HTML email `SignatureSection`; Outlook owns sending/signatures.
- Keep the user-to-employee identity link; it remains required by forms and pairing identity.

- [ ] **Step 6: Implement employee correspondence tab and actions**

Add `correspondence` to `EmployeeTabChips`; use the existing `ledger_count` statistic only as an internal count until generated schemas are cleaned. Render date, direction, counterparty/recipients, subject, attachment count, and link source. Clicking an email creates/open handoff; historical non-email rows remain read-only or follow their existing record destination.

Update `ActivityTab` and `EmployeeActivitySection` so internal kind `ledger` displays **Correspondence** and invokes exact-open instead of `/ledger?open=`.

- [ ] **Step 7: Add bilingual copy and run required review**

Add matching English/Arabic keys for Outlook connection, recording health, correspondence, bridge errors, desktop requirement, and basket states. Remove no old Ledger keys yet; final deletion is Task 8.

Run `i18n-rtl-reviewer`; fix logical alignment, focus order, and Arabic correspondence card layout.

- [ ] **Step 8: Run focused checks**

```powershell
pnpm -C frontend exec vitest run src/lib/outlookBridge.test.ts src/pages/settings/OutlookConnectionSection.test.tsx src/pages/employees/tabs/CorrespondenceTab.test.tsx src/pages/employees/EmployeeDetailPage.test.tsx src/components/employees/EmployeeActivitySection.test.tsx
pnpm -C frontend exec tsc -b --noEmit
```

- [ ] **Step 9: Commit**

```powershell
git add frontend/src/lib/outlookBridge.ts frontend/src/lib/outlookBridge.test.ts frontend/src/lib/composeReference.ts frontend/src/lib/basketEmail.ts frontend/src/components/shell/EmailBasketTray.tsx frontend/src/pages/settings frontend/src/pages/employees frontend/src/components/employees/EmployeeActivitySection.tsx frontend/src/lib/api.ts frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(outlook): wire Sentinel handoffs and correspondence"
```

---

### Task 8: Remove the duplicate mailbox and complete the clean cutover

**Files:**
- Delete: `frontend/src/pages/ledger/`
- Delete: ledger-only files under `frontend/src/components/ledger/`
- Move: `frontend/src/components/ledger/FileTypeIcon.tsx` -> `frontend/src/components/ui/file-type-icon.tsx`
- Move: `frontend/src/components/ledger/PdfViewer.tsx` -> `frontend/src/components/ui/pdf-viewer.tsx`
- Delete: `frontend/src/lib/employeeDetection.ts`, `smartLinks.ts`, `recipientLists.ts`, `refPdfAttachments.ts`, and other ledger-only helpers after references reach zero.
- Modify: `frontend/src/App.tsx`, shell navigation/bell files, dashboard files/layout tests, `document-viewer-dialog.tsx`, `api.ts`, locales.
- Delete: `backend/app/api/v1/ledger.py`, `backend/app/api/v1/smart_folders.py`, `backend/app/services/ledger_service.py`, `backend/app/services/mail_scope.py`, `backend/app/services/smart_folder_service.py`, `backend/app/services/search_service.py`, `backend/app/services/contacts_service.py`, `backend/app/services/recipient_lists_service.py`, and mailbox-only schemas.
- Modify: `backend/app/api/v1/email.py`, `backend/app/schemas/email.py`, `backend/app/services/email_service.py`, `backend/app/main.py`, `backend/app/services/notification_service.py`, `backend/app/services/scheduler_service.py`, `backend/app/services/dashboard_service.py`, `backend/app/schemas/dashboard.py`, `backend/app/services/vault_service.py`, and affected tests.
- Regenerate: `backend/openapi.json`, `frontend/src/lib/api.types.ts`.

**Interfaces:**
- Keeps: IMAP account CRUD/test/sync/status; correspondence link/profile APIs; Outlook bridge APIs; Scan Inbox.
- Removes: `/api/v1/ledger/**`, `/api/v1/email/send`, smart folders, contacts, recipient lists, unread/read state, flags, drafts, SMTP send, internal mailbox preview/search/download endpoints.

- [ ] **Step 1: Write failing cutover assertions**

Frontend tests must assert:

```typescript
expect(screen.queryByRole('link', { name: /ledger/i })).not.toBeInTheDocument()
expect(screen.getByRole('button', { name: /open outlook/i })).toBeInTheDocument()
```

Backend route tests must assert `/api/v1/ledger` and `/api/v1/email/send` return 404 while `/api/v1/email/sync/status` and employee correspondence remain available.

- [ ] **Step 2: Move genuinely shared renderers with LSP-aware file rename**

Use `lsp rename_file` for `FileTypeIcon.tsx` and `PdfViewer.tsx`, then update `document-viewer-dialog.tsx`. Delete `XlsxViewer` if no non-ledger references remain. Before every deletion, use LSP references where available; preserve shared utilities only when a real caller remains.

- [ ] **Step 3: Remove frontend mailbox routes and surfaces**

- Delete `/ledger` route/lazy import and page/component trees.
- Replace primary nav item with an **Open Outlook** button/action, not a React route.
- Remove unread-mail bell preview, follow-up flags, ledger waiting signal, dashboard `drafts`, `ledger`, `email_sync_status`, and `recent_ledger` widgets.
- Remove stale dashboard layout IDs using existing layout normalization so saved layouts discard them safely.
- Remove Ledger locale branches and tests; keep new Correspondence/Outlook keys.
- Remove `SignatureSection.tsx` and Sentinel email-signature UI.

- [ ] **Step 4: Remove backend mailbox interaction code**

- Delete Ledger and smart-folder routers and router registrations.
- Delete SMTP `/email/send`, send schemas, `_get_signature`, `_apply_signature`, and SMTP send implementation.
- Keep IMAP model columns physically intact; stop exposing/editing SMTP fields in the API and use existing/default stored values only for backward-compatible row construction.
- Remove unread-email/actionable notification generation and `/ledger` push destinations; Outlook owns mail notifications.
- Remove dashboard ledger/draft counts and recent rows.
- Remove mailbox-only service/schema modules and `vault_service.import_from_ledger_attachment` after references reach zero.
- Keep `LedgerEntry`, `correspondence_service`, stored history, attachments, and dormant historical columns/tables. Do not add a destructive cleanup migration.

- [ ] **Step 5: Preserve the one existing Sentinel draft before deployment cutover**

Before deploying the final cutover, open the single existing draft in the current production Ledger, copy its recipients/subject/body/attachments into a classic Outlook draft, save it, and obtain operator confirmation. Write no temporary export endpoint or script; this is one manual record and does not justify implementation code.

- [ ] **Step 6: Regenerate the API contract**

Use the project `sync-api-types` skill:

```powershell
venv\Scripts\python.exe backend/scripts/dump_openapi.py
pnpm -C frontend run gen:api
```

Remove hand-maintained Ledger types/methods from `frontend/src/lib/api.ts`; generated types are authoritative.

- [ ] **Step 7: Run narrow cutover tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_api.py backend/tests/test_employee_correspondence_api.py backend/tests/test_employee_activity_api.py backend/tests/test_scan_inbox_document.py backend/tests/test_push_copy.py backend/tests/test_dashboard_layout_read.py -q
pnpm -C frontend exec vitest run src/components/shell src/pages/dashboard src/pages/settings src/pages/employees src/lib/dashboardLayout.test.ts src/lib/outlookBridge.test.ts
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
```

- [ ] **Step 8: Verify no obsolete runtime references remain**

Search source/tests/locales for `/ledger`, `LedgerPage`, `LedgerEmailCompose`, `listLedger`, `sendEmail`, `SmartFolder`, recipient-list APIs, unread-ledger queries, and user-facing `Ledger`. Every remaining match must be an intentional historical database/model/migration reference or this plan/spec.

- [ ] **Step 9: Run full behavioral acceptance**

On representative x64 and x86 classic Outlook/IONOS setups:

1. install and pair;
2. select one/multiple G-number mail;
3. confirm attachment-only link after existing Scan Inbox OCR;
4. add/dismiss and resync;
5. prepare a multi-PDF bilingual basket; verify Outlook signature and saved draft;
6. send; confirm each employee profile records one row;
7. open from profile, move folders, and open again;
8. revoke and verify denial;
9. test wrong mailbox;
10. interrupt IMAP, verify Outlook remains usable, restore, and confirm deduplicated catch-up; and
11. verify mobile Sentinel shows desktop-required copy without an internal composer.

- [ ] **Step 10: Final project checks and review**

```powershell
venv\Scripts\ruff.exe check .
venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
venv\Scripts\python.exe -m pytest
pnpm -C frontend test
pnpm -C frontend exec tsc -b --noEmit
pnpm -C frontend run lint
pnpm -C frontend run build
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
```

Run the required i18n/RTL review again after final copy deletion, the Alembic reviewer, exactly-one-head check, and code review. Inspect the final installer signatures and real Outlook smoke evidence.

- [ ] **Step 11: Commit the clean cutover**

```powershell
git add -A
git commit -m "feat(outlook): replace Sentinel mailbox with Outlook"
```

## Deployment Gate

Before production deploy:

1. inventory every operator PC's Windows version, classic Outlook build, and Office bitness;
2. build/sign matching MSI packages;
3. back up SQLite and `data/ledger_attachments`;
4. confirm the existing draft is in Outlook;
5. install/pair every PC while the old production version remains available;
6. push the merged commit to `origin/main`;
7. deploy the server/frontend clean cutover;
8. run the real-mail acceptance path; and
9. remove temporary local installer/output files, never production correspondence data.

Rollback reverts the application/installer release and revokes bridge devices. Additive tables may remain; original correspondence rows and attachments are never deleted.
