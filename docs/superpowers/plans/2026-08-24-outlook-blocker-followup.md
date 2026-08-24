# Outlook Blocker Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the three final-review regressions, then build, sign, and verify the Outlook launcher, VSTO add-in, and x86/x64 installers on a separate Windows execution PC.

**Architecture:** Keep the completed Outlook replacement intact. Apply three narrow root-cause fixes at the existing API boundary, native failure-policy boundary, and role-preset definition; add one behavioral regression per boundary. Prepare the execution PC with the exact .NET Framework 4.8, VSTO, Windows SDK, and WiX 3 toolchain already required by the repository, then run native and release gates without adding product dependencies.

**Tech Stack:** FastAPI/Python 3.12, pytest, C# 7.3/.NET Framework 4.8, MSTest, classic Outlook/VSTO, Visual Studio 2022 Build Tools/MSBuild, WiX 3.14, Windows SDK SignTool, PowerShell, Git worktrees.

## Global Constraints

- Execute on a separate Windows PC in an isolated Git worktree; the live production checkout must not change.
- Start from feature branch `docs/outlook-replacement-design` containing commits `7c2bd83`, `3f8a3c6`, `5f21175`, and this plan commit.
- Do not rewrite or squash the completed Outlook implementation commits.
- Fix only the three regressions named by this plan; unrelated deferred minors remain out of scope.
- Keep IMAP indexing, every `ledger_entries` row, every attachment, correspondence links, Scan Inbox, and Outlook bridge APIs.
- Keep obsolete `ledger.view`, `ledger.edit`, and `ledger.send` capabilities removed.
- Never commit a certificate, private key, thumbprint, secret, signed build output, `data/`, or generated static assets.
- Production signing uses the certificate selected by `%GSSG_CODESIGN_THUMBPRINT%`.
- Support classic Outlook 2016 or later on Windows only; no New Outlook, web, mobile, Mac, or `mailto:` fallback.
- Do not deploy until the production draft is manually preserved and both required classic Outlook bitness acceptance paths pass.

## Execution-PC Preflight

These steps configure the execution PC. They do not change repository source and do not create a Git commit.

- [ ] **Step 1: Publish the feature branch from the source PC**

Run from the existing isolated worktree after this plan is committed:

```powershell
git status --short
git push -u origin docs/outlook-replacement-design
```

Expected: `git status --short` prints nothing; the feature branch and this plan are available on `origin`.

- [ ] **Step 2: Create an isolated execution worktree on the target PC**

From a non-production clone on the execution PC:

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
git worktree add .worktrees/outlook-blocker-followup -b fix/outlook-blocker-followup origin/docs/outlook-replacement-design
git -C .worktrees/outlook-blocker-followup log -4 --oneline
```

Expected: the log includes the design and implementation-plan commits. Never create the worktree inside the live production checkout.

- [ ] **Step 3: Install project runtimes, Visual Studio Build Tools, and Office targets**

Open an elevated PowerShell window and run:

```powershell
winget source update
winget install --id Python.Python.3.12 --exact `
  --accept-package-agreements --accept-source-agreements
winget install --id OpenJS.NodeJS.LTS --exact `
  --accept-package-agreements --accept-source-agreements
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact `
  --override "--wait --passive --norestart --add Microsoft.VisualStudio.Workload.ManagedDesktopBuildTools --add Microsoft.VisualStudio.Workload.OfficeBuildTools --includeRecommended" `
  --accept-package-agreements --accept-source-agreements
```

Expected: every command exits `0`. If an installer returns `3010`, restart Windows before Step 4. Do not continue after any other nonzero code. The frontend pins `pnpm@11.6.0`; Step 6 activates that exact package-manager version through Corepack.

- [ ] **Step 4: Install WiX 3.14**

Run in elevated PowerShell:

```powershell
winget install --id WiXToolset.WiXToolset --exact --version 3.14.1.8722 `
  --accept-package-agreements --accept-source-agreements
```

Expected: WiX 3.14 installs successfully. If this exact v3 package is unavailable, stop; do not install WiX 4 because `Gssg.Outlook.Installer.wixproj` imports WiX v3 targets.

- [ ] **Step 5: Resolve and verify tool paths**

Open a new ordinary PowerShell window after any restart:

```powershell
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) { throw "vswhere.exe is missing" }
$vs = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
if (-not $vs) { throw "Visual Studio Build Tools with MSBuild are missing" }
$msbuild = Join-Path $vs "MSBuild\Current\Bin\MSBuild.exe"
$officeTargets = Join-Path $vs "MSBuild\Microsoft\VisualStudio\v17.0\OfficeTools\Microsoft.VisualStudio.Tools.Office.targets"
$wixTargets = "${env:ProgramFiles(x86)}\MSBuild\Microsoft\WiX\v3.x\Wix.targets"
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -Recurse |
  Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
@($msbuild, $officeTargets, $wixTargets, $signtool) | ForEach-Object {
  if (-not $_ -or -not (Test-Path $_)) { throw "Required build tool is missing: $_" }
  Write-Host $_
}
& $msbuild -version
```

Expected: four existing paths print and MSBuild reports version 17.x. Missing Office targets require modifying the Build Tools installation to add the Office/VSTO workload before continuing.

- [ ] **Step 6: Install project dependencies and establish a baseline**

From `.worktrees/outlook-blocker-followup`:

```powershell
python --version
node --version
corepack enable
corepack prepare pnpm@11.6.0 --activate
python -m venv venv
venv\Scripts\python.exe -m pip install -r requirements.txt
pnpm -C frontend install --frozen-lockfile
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_api.py -q
pnpm -C frontend exec tsc -b --noEmit
```

Expected: the focused backend baseline and TypeScript check pass. If baseline failures occur before source changes, record them and stop for adjudication.

---

### Task 1: Restore Handoff Attachment Bounds

**Files:**
- Modify: `backend/app/api/v1/outlook_bridge.py:355-389`
- Modify: `backend/tests/test_outlook_bridge_api.py`

**Interfaces:**
- Consumes: redeemed compose `OutlookHandoff.payload["attachments"]`.
- Preserves: `GET /api/v1/outlook/device/handoffs/{handoff_id}/attachments/{index}` and the existing `OUTLOOK_ATTACHMENT_NOT_FOUND` 404 contract.
- Produces: no uncaught `IndexError` or `TypeError` for untrusted indices/payloads.

- [ ] **Step 1: Add the failing out-of-range API test helper and test**

Add to `backend/tests/test_outlook_bridge_api.py`:

```python
def _redeem_compose(
    client: TestClient,
    attachments: list[dict[str, object]],
) -> tuple[int, dict[str, str]]:
    handoff = client.post(
        "/api/v1/outlook/handoffs",
        json={
            "kind": "compose",
            "payload": {
                "to": ["recipient@example.test"],
                "subject": "Bounds",
                "body_html": "<p>Bounds</p>",
                "basket_key": "bounds",
                "attachments": attachments,
            },
        },
    ).json()
    pairing = client.post("/api/v1/outlook/pairings", json={}).json()["token"]
    credential = client.post(
        "/api/v1/outlook/device/pair",
        json={
            "token": pairing,
            "device_id": "pc-bounds",
            "device_label": "Bounds PC",
            "mailbox_address": "owner@example.test",
        },
    ).json()["credential"]
    headers = {"Authorization": f"Bearer {credential}"}
    redeemed = client.post(
        "/api/v1/outlook/device/handoffs/redeem",
        headers=headers,
        json={"token": handoff["token"], "mailbox_address": "owner@example.test"},
    )
    assert redeemed.status_code == 200, redeemed.text
    return handoff["id"], headers


def test_attachment_index_outside_payload_returns_404(
    outlook_client: tuple[TestClient, User],
) -> None:
    client, _ = outlook_client
    handoff_id, headers = _redeem_compose(client, [])

    response = client.get(
        f"/api/v1/outlook/device/handoffs/{handoff_id}/attachments/0",
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "OUTLOOK_ATTACHMENT_NOT_FOUND"
```

- [ ] **Step 2: Run the test and confirm the regression**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_api.py::test_attachment_index_outside_payload_returns_404 -q
```

Expected before the fix: FAIL because the endpoint raises `IndexError` and returns 500/test-client exception.

- [ ] **Step 3: Add malformed-payload coverage**

Add `OutlookHandoff` and `flag_modified` imports, then add:

```python
from sqlalchemy.orm.attributes import flag_modified

from app.db.models import OutlookHandoff


@pytest.mark.parametrize("attachments", [None, {}])
def test_malformed_attachment_payload_returns_404(
    outlook_client: tuple[TestClient, User],
    api_db: Session,
    attachments: object,
) -> None:
    client, _ = outlook_client
    handoff_id, headers = _redeem_compose(client, [])
    row = api_db.get(OutlookHandoff, handoff_id)
    assert row is not None
    row.payload["attachments"] = attachments
    flag_modified(row, "payload")
    api_db.commit()

    response = client.get(
        f"/api/v1/outlook/device/handoffs/{handoff_id}/attachments/0",
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "OUTLOOK_ATTACHMENT_NOT_FOUND"
```

- [ ] **Step 4: Preserve valid access-checked downloads**

Add:

```python
def test_valid_redeemed_attachment_still_downloads(
    outlook_client: tuple[TestClient, User],
    api_db: Session,
    tmp_path,
    monkeypatch,
) -> None:
    client, _ = outlook_client
    document = Document(
        employee_id=None,
        template_id="General Book",
        ref_number="R-download",
        pdf_path="download.pdf",
        submission_id="submission-download",
    )
    api_db.add(document)
    api_db.commit()
    api_db.refresh(document)
    (tmp_path / "download.pdf").write_bytes(b"%PDF-download")
    monkeypatch.setattr(
        document_service, "get_settings", lambda: SimpleNamespace(data_dir=tmp_path)
    )
    monkeypatch.setattr(
        book_service,
        "is_document_signed_locked",
        lambda _db, document_id: (document_id == document.id, "download.pdf"),
    )
    handoff_id, headers = _redeem_compose(
        client,
        [
            {
                "kind": "document_pdf",
                "document_id": document.id,
                "filename": "download.pdf",
            }
        ],
    )

    response = client.get(
        f"/api/v1/outlook/device/handoffs/{handoff_id}/attachments/0",
        headers=headers,
    )

    assert response.status_code == 200, response.text
    assert response.content == b"%PDF-download"
```

- [ ] **Step 5: Restore the minimal bounds guard**

In `download_handoff_attachment`, immediately after reading `refs`, add:

```python
refs = row.payload.get("attachments")
if not isinstance(refs, list) or index >= len(refs):
    raise NotFoundError("OUTLOOK_ATTACHMENT_NOT_FOUND", "Attachment was not found")
```

Keep the existing negative-index guard and existing access-checked PDF resolver unchanged.

- [ ] **Step 6: Run focused bridge tests**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_api.py backend/tests/test_outlook_bridge_service.py -q
venv\Scripts\ruff.exe check backend/app/api/v1/outlook_bridge.py backend/tests/test_outlook_bridge_api.py
venv\Scripts\ruff.exe format --check backend/app/api/v1/outlook_bridge.py backend/tests/test_outlook_bridge_api.py
```

Expected: all tests and Ruff checks pass.

- [ ] **Step 7: Commit Task 1**

```powershell
git add backend/app/api/v1/outlook_bridge.py backend/tests/test_outlook_bridge_api.py
git commit -m "fix(outlook): validate handoff attachment indices"
```

---

### Task 2: Preserve Successful Native Completion

**Files:**
- Modify: `outlook-bridge/src/Gssg.Outlook.Shared/FailureCodeMessages.cs`
- Modify: `outlook-bridge/src/Gssg.Outlook.Launcher/Program.cs:74-129`
- Create: `outlook-bridge/tests/Gssg.Outlook.Tests/FailureCodeMessagesTests.cs`

**Interfaces:**
- Produces: `FailureCodeMessages.ShouldReportToServer(string code) -> bool`.
- Consumes: launcher `FailureCode(Exception)` output.
- Preserves: local completion receipts and status-only retry after `COMPLETION_RETRY_REQUIRED`.

- [ ] **Step 1: Add the failing native policy test**

Create `outlook-bridge/tests/Gssg.Outlook.Tests/FailureCodeMessagesTests.cs`:

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting;

namespace Gssg.Outlook.Tests
{
    [TestClass]
    public sealed class FailureCodeMessagesTests
    {
        [DataTestMethod]
        [DataRow("COMPLETION_RETRY_REQUIRED", false)]
        [DataRow("completion_retry_required", false)]
        [DataRow("ATTACHMENT_FAILURE", true)]
        [DataRow("MESSAGE_NOT_FOUND", true)]
        public void ShouldReportToServerPreservesCompletedActions(string code, bool expected)
        {
            Assert.AreEqual(expected, FailureCodeMessages.ShouldReportToServer(code));
        }
    }
}
```

- [ ] **Step 2: Run the native test and confirm failure**

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release --filter FailureCodeMessagesTests
```

Expected before the fix: compile failure because `ShouldReportToServer` does not exist.

- [ ] **Step 3: Implement the minimal shared policy**

Add to `FailureCodeMessages`:

```csharp
internal static bool ShouldReportToServer(string code)
{
    return !string.Equals(code, "COMPLETION_RETRY_REQUIRED", StringComparison.OrdinalIgnoreCase);
}
```

No new class, dependency, or failure-code registry is needed.

- [ ] **Step 4: Use the policy in compose and open catches**

Replace each unconditional catch-body failure report in `RunCompose` and `RunOpen` with:

```csharp
var failureCode = FailureCode(ex);
if (handoff != null && FailureCodeMessages.ShouldReportToServer(failureCode))
    TryFail(api, handoff.HandoffId, failureCode);
throw;
```

Do not move `CompleteOrRecord`, delete completion receipts, or retry the Outlook action.

- [ ] **Step 5: Run native tests and both launcher builds**

```powershell
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
& $msbuild outlook-bridge\Gssg.Outlook.sln /m /restore /p:Configuration=Release /p:Platform=x64 /p:SentinelOrigin=https://sentinel.invalid /p:ProductVersion=1.0.0.1 /p:ManifestCertificateThumbprint=$env:GSSG_CODESIGN_THUMBPRINT
& $msbuild outlook-bridge\Gssg.Outlook.sln /m /restore /p:Configuration=Release /p:Platform=x86 /p:SentinelOrigin=https://sentinel.invalid /p:ProductVersion=1.0.0.1 /p:ManifestCertificateThumbprint=$env:GSSG_CODESIGN_THUMBPRINT
```

Expected: native tests pass and both solution configurations build. `https://sentinel.invalid` is build-only for this test; production artifacts must use the real HTTPS origin in Task 4.

- [ ] **Step 6: Commit Task 2**

```powershell
git add outlook-bridge/src/Gssg.Outlook.Shared/FailureCodeMessages.cs outlook-bridge/src/Gssg.Outlook.Launcher/Program.cs outlook-bridge/tests/Gssg.Outlook.Tests/FailureCodeMessagesTests.cs
git commit -m "fix(outlook): preserve completion retry receipts"
```

---

### Task 3: Restore Email Management Role Defaults

**Files:**
- Modify: `backend/app/core/permissions.py:215-252`
- Create: `backend/tests/test_outlook_cutover_permissions.py`

**Interfaces:**
- Consumes: active capability `email.manage`.
- Produces: operator and manager default access to IMAP settings and Outlook pairing.
- Preserves: removal of `ledger.view`, `ledger.edit`, and `ledger.send`.

- [ ] **Step 1: Add the failing role-default test**

Create `backend/tests/test_outlook_cutover_permissions.py`:

```python
from app.core import permissions


def test_outlook_cutover_role_defaults_keep_email_management() -> None:
    assert "email.manage" in permissions._OPERATOR_CAPS
    assert "email.manage" in permissions._MANAGER_CAPS


def test_outlook_cutover_role_defaults_remove_ledger_capabilities() -> None:
    removed = {"ledger.view", "ledger.edit", "ledger.send"}
    assert removed.isdisjoint(permissions.CAPABILITY_IDS)
    assert removed.isdisjoint(permissions._OPERATOR_CAPS)
    assert removed.isdisjoint(permissions._MANAGER_CAPS)
```

- [ ] **Step 2: Run the test and confirm failure**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_cutover_permissions.py -q
```

Expected before the fix: first test fails because `email.manage` is absent from `_OPERATOR_CAPS` and `_MANAGER_CAPS`.

- [ ] **Step 3: Restore only the active capability**

Add this entry to `_OPERATOR_CAPS` next to `settings.view`:

```python
"email.manage",
```

Do not restore any `ledger.*` capability. `_MANAGER_CAPS` inherits `email.manage` through `_OPERATOR_CAPS`; do not duplicate it.

- [ ] **Step 4: Run permission and settings regressions**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_cutover_permissions.py backend/tests/test_outlook_bridge_api.py -q
pnpm -C frontend exec vitest run src/pages/settings
pnpm -C frontend exec tsc -b --noEmit
venv\Scripts\ruff.exe check backend/app/core/permissions.py backend/tests/test_outlook_cutover_permissions.py
venv\Scripts\ruff.exe format --check backend/app/core/permissions.py backend/tests/test_outlook_cutover_permissions.py
```

Expected: all checks pass; operator bridge API fixtures still pair and use their mailbox.

- [ ] **Step 5: Commit Task 3**

```powershell
git add backend/app/core/permissions.py backend/tests/test_outlook_cutover_permissions.py
git commit -m "fix(auth): retain Outlook email management access"
```

---

### Task 4: Release Verification and Branch Review

**Files:**
- Verify only; source changes require a new reviewed fix commit.
- Do not commit `outlook-bridge/dist/`, certificates, logs, or local environment files.

**Interfaces:**
- Consumes: Tasks 1-3 and the completed Outlook replacement branch.
- Produces: reviewed source commits plus signed x86/x64 release evidence.

- [ ] **Step 1: Run the complete focused blocker suite**

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_outlook_bridge_api.py backend/tests/test_outlook_bridge_service.py backend/tests/test_outlook_cutover_permissions.py -q
dotnet test outlook-bridge\tests\Gssg.Outlook.Tests\Gssg.Outlook.Tests.csproj -c Release
pnpm -C frontend exec vitest run src/pages/settings src/lib/outlookBridge.test.ts
pnpm -C frontend exec tsc -b --noEmit
venv\Scripts\python.exe -m alembic heads
```

Expected: all tests pass and Alembic prints exactly `0078_outlook_correspondence (head)`.

- [ ] **Step 2: Configure release-only environment values**

In the same PowerShell process used for the release build:

```powershell
if (-not $env:GSSG_SENTINEL_ORIGIN -or $env:GSSG_SENTINEL_ORIGIN -notmatch '^https://') {
  throw "GSSG_SENTINEL_ORIGIN must be the production HTTPS origin"
}
if (-not $env:GSSG_OUTLOOK_PRODUCT_VERSION -or $env:GSSG_OUTLOOK_PRODUCT_VERSION -notmatch '^\d+\.\d+\.\d+\.\d+$') {
  throw "GSSG_OUTLOOK_PRODUCT_VERSION must be x.y.z.w"
}
if (-not $env:GSSG_CODESIGN_THUMBPRINT) { throw "GSSG_CODESIGN_THUMBPRINT is required" }
$certificate = Get-Item "Cert:\CurrentUser\My\$env:GSSG_CODESIGN_THUMBPRINT"
if (-not $certificate.HasPrivateKey) { throw "The signing certificate has no private key" }
```

Expected: all checks succeed without printing or committing secret key material.

- [ ] **Step 3: Build clean x64 and x86 release outputs**

```powershell
Remove-Item outlook-bridge\dist -Recurse -Force -ErrorAction SilentlyContinue
& $msbuild outlook-bridge\Gssg.Outlook.sln /m /restore /t:Rebuild /p:Configuration=Release /p:Platform=x64 /p:SentinelOrigin=$env:GSSG_SENTINEL_ORIGIN /p:ProductVersion=$env:GSSG_OUTLOOK_PRODUCT_VERSION /p:ManifestCertificateThumbprint=$env:GSSG_CODESIGN_THUMBPRINT
if ($LASTEXITCODE -ne 0) { throw "x64 build failed" }
& $msbuild outlook-bridge\Gssg.Outlook.sln /m /restore /t:Rebuild /p:Configuration=Release /p:Platform=x86 /p:SentinelOrigin=$env:GSSG_SENTINEL_ORIGIN /p:ProductVersion=$env:GSSG_OUTLOOK_PRODUCT_VERSION /p:ManifestCertificateThumbprint=$env:GSSG_CODESIGN_THUMBPRINT
if ($LASTEXITCODE -ne 0) { throw "x86 build failed" }
```

Expected: each `outlook-bridge\dist\<platform>\` contains the launcher, shared DLL, add-in DLL, generated VSTO/application manifests, and MSI.

- [ ] **Step 4: Authenticode-sign production binaries and installers**

```powershell
$artifacts = @(
  "outlook-bridge\dist\x64\Gssg.Outlook.Launcher.exe",
  "outlook-bridge\dist\x64\Gssg.Outlook.Shared.dll",
  "outlook-bridge\dist\x64\Gssg.Outlook.AddIn.dll",
  "outlook-bridge\dist\x64\Gssg.Outlook.Launcher.msi",
  "outlook-bridge\dist\x86\Gssg.Outlook.Launcher.exe",
  "outlook-bridge\dist\x86\Gssg.Outlook.Shared.dll",
  "outlook-bridge\dist\x86\Gssg.Outlook.AddIn.dll",
  "outlook-bridge\dist\x86\Gssg.Outlook.Launcher.msi"
)
foreach ($artifact in $artifacts) {
  if (-not (Test-Path $artifact)) { throw "Missing release artifact: $artifact" }
  & $signtool sign /sha1 $env:GSSG_CODESIGN_THUMBPRINT /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $artifact
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $artifact" }
  & $signtool verify /pa /all $artifact
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $artifact" }
}
```

Expected: every artifact signs and verifies against the selected certificate. If organizational policy requires a different RFC 3161 timestamp server, replace only the timestamp URL with the approved server.

- [ ] **Step 5: Verify VSTO manifests**

Locate Mage with the installed Windows SDK/Visual Studio tools and run:

```powershell
$mage = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft SDKs" -Filter mage.exe -Recurse |
  Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
if (-not $mage) { throw "mage.exe is missing" }
Get-ChildItem outlook-bridge\dist -Recurse -Include *.vsto,*.manifest | ForEach-Object {
  & $mage -Verify $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Manifest verification failed: $($_.FullName)" }
}
```

Expected: every deployment/application manifest verifies successfully.

- [ ] **Step 6: Install and run the launcher self-test for the execution PC's Office bitness**

Run elevated, choosing the MSI matching installed classic Outlook bitness:

```powershell
msiexec.exe /i outlook-bridge\dist\x64\Gssg.Outlook.Launcher.msi /l*v outlook-bridge-x64-install.log
& "$env:ProgramFiles\GSSG Manager\Outlook Bridge\Gssg.Outlook.Launcher.exe" --self-test
```

For 32-bit Office on 64-bit Windows, use the x86 MSI and `${env:ProgramFiles(x86)}`. Expected: MSI exit code `0`; self-test verifies pinned origin, credential store access, classic Outlook COM activation, active mailbox discovery, and protocol registration. Do not commit the install log.

- [ ] **Step 7: Exercise completion-callback failure without duplicate drafts**

On a non-production paired IONOS mailbox:

1. prepare a basket with one PDF;
2. block only the completion callback after the launcher redeems the handoff;
3. confirm Outlook creates and keeps exactly one draft;
4. confirm the local completion receipt exists;
5. restore connectivity;
6. run the launcher again so pending receipts retry status only; and
7. confirm the basket clears after `completed` and no second draft appears.

Expected: no `/fail` transition with code `COMPLETION_RETRY_REQUIRED`, one Outlook draft, one completed handoff.

- [ ] **Step 8: Run the remaining classic Outlook acceptance path**

On representative x64 and x86 classic Outlook setups, verify:

1. install and pair with the expected mailbox;
2. wrong active mailbox is rejected;
3. one, multiple, and attachment-only G-number links render;
4. rapid selections never replace the current cards with stale cards;
5. manual add/dismiss survives IMAP resync;
6. Arabic pane layout and copy are correct;
7. revoked and inactive users/devices are denied;
8. prepared bilingual multi-PDF drafts preserve the Outlook signature;
9. profile exact-open survives folder moves;
10. IMAP interruption leaves Outlook usable and catch-up deduplicates; and
11. mobile Sentinel shows desktop-required copy without a composer.

Expected: all cases pass on both Office bitnesses. A single PC can build both packages but cannot validate both installed Office bitnesses simultaneously; use a second representative PC or VM for the other runtime bitness.

- [ ] **Step 9: Preserve the existing production draft before deployment**

Using the old production Ledger and classic Outlook, manually copy the single existing draft's recipients, subject, body, and attachments into an Outlook draft. Save it and obtain operator confirmation. Do not create an export script or endpoint.

- [ ] **Step 10: Run final whole-branch checks sequentially**

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
git status --short
```

Expected: every command passes and `git status --short` prints nothing. Run sequentially because this host can exhaust memory when frontend checks overlap.

- [ ] **Step 11: Run final code review and finish the branch**

Use `superpowers:requesting-code-review` over the original branch base through the new head. Fix every Critical or Important finding through a reviewed follow-up commit. When the review is clean and all verification gates above pass, use `superpowers:finishing-a-development-branch` and choose whether to push a PR or preserve the branch. Do not merge or deploy merely because source tests pass.
