# GSSG Manager

A local/LAN web application for HR document generation, approvals, leave tracking,
and correspondence — **FastAPI** (Python) backend + **React** (TypeScript/Vite)
frontend, served same-origin.

This is the **live (production) build** of the app — the clean, deployable
application only. It is pulled to the office server.

## Features

- Document generation from tokenized Word templates (per-form workflows)
- Approvals with reviewer chains and manager routing
- Per-user email mailboxes (IMAP/SMTP) with a private inbox + admin "All mail" view
- Leave tracking and lifecycle management
- Instant in-app notifications (SSE) + installable PWA with Web Push
- Shared vehicle-photo library with reusable named images and lightweight WebP previews
- Runs as an always-on Windows service on the office LAN

Email messages, drafts, attachments, and employee-linked mail metadata are private
to their mailbox owner. Admins can explicitly select **All mail** to read other
mailboxes (including legacy messages without an owner); editing, deleting,
starring, flags, and read-state changes remain limited to their own mailbox.
Opening another owner's message does not mark it read. Non-email correspondence
remains shared, subject to the linked Record's visibility; smart-folder counts
and suggestions respect that same Record visibility.

Material Request is one service in Services. An `English | العربية` tab in its
form picks the paper to preview and save, and opens on the interface language.
Switching keeps the delivery date, items, and manager, which both papers share
with the same in-app manager-signing workflow. The Arabic paper has 17 item
slots and asks only for delivery date, items, and the verifying manager.
English-only delivery location, shipping address, justification, and requester
signature fields are not offered on the Arabic form. Requester name,
designation/contact, and manager signing date do not print because its design
has no slots. The selected manager fills the center-manager approval; the
contract-manager and final approvals stay blank for hand signing.

Employee identity links are assigned by administrators during registration
approval or through user management; accounts cannot claim employee records.
Linked accounts and manager aliases share the employee's canonical signature.
Manager settings editors also need `employees.edit` to assign/change an
employee-linked account or replace/delete its signature; standalone manager
signatures require only `settings.edit`.

## Requirements

- Python 3.12
- Node.js + pnpm
- (Windows) for the always-on service: NSSM (see `deploy/`)

## Run (development)

```bash
# Backend deps
python -m venv venv
venv/Scripts/python -m pip install -r requirements.txt

# DB migrations
venv/Scripts/python -m alembic upgrade head

# Frontend
pnpm -C frontend install
pnpm -C frontend run build      # builds into the backend's static dir

# Serve (headless, binds the LAN)
venv/Scripts/python backend/serve.py
```

Then open `http://<server>/` from any device on the network.

## Employee picker permissions

Service forms can look up employee names with `documents.generate` even when
the Employees page (`employees.view`) is blocked. `GET /api/v1/employees/lookup`
returns only the employee ID, English/Arabic names, department, designation, and
duty unit/post. The selected-employee lookup (`/employees/lookup/{id}`) also
returns nationality and passport number, only to users who can use the Passport
Release service (`books.service.Passport Release List`), for its prefill; those
fields are never included in search results. Employee profiles, photos, vaults, activity,
and HR pages keep their existing permission gates. Announcement recipient and
WhatsApp-mention searches still require `employees.view` because they use
contact numbers rather than only employee identities.

Dashboard sections respect the corresponding employee, leave, violation, and
ledger read capabilities independently: the summary still returns successfully
when a section is denied, with `null` protected counts and empty protected lists.
Dashboard correspondence includes only the caller's email and shared non-email
entries, even for admins; draft counts are owner-scoped. Employee detail and
activity also honor `violations.view`, and linked document metadata inherits the
owning record's exact-revision read policy, including deleted-record restrictions.

## Authorization lifecycle

Temporary capability grants stop at expiry, without waiting for the cleanup
sweep. When the capability belongs to the user's current role defaults (or is
a dynamic capability), expiry restores a deny; an additional non-default grant
simply expires. Single and bulk permission updates follow the same rule, and
role changes during the grant window are evaluated against the current role.

Evaluation-queue listing and retry require organization workforce scope as
well as `workforce.integration.manage`; only terminally failed rows can be retried.

Notification streams revalidate their originating session and current account
eligibility on every polling tick before accessing the per-user counts cache.
Revoking that session, expiry, disabling the account, requiring password setup,
or changing to a role barred from notifications ends the stream, even if another
session for that user remains valid.

## Record category permissions

The Permissions page lists the 15 General Book classifications, then the legacy
record categories. Each legacy category shows the services whose new records it
files (from the form-to-category map in `document_service._FORM_CATEGORY`), so a
deny there also blocks creating and viewing those services' records. Categories
no service writes to are marked "Old records only". Migration `0098` removes the
unused seed categories `1`–`12` that no record references.

Inmate Conduct Violations file under their own category `INV` (Inmate
violations); `NAT` keeps the employee Violation and Warning forms. Migration
`0099` moves existing inmate violation records to `INV` without changing their
ref numbers, and copies every `books.category.NAT` grant/deny, role row, and
`NAT` auto-log rule to `INV`, so access and correspondence filing stay the same.
New inmate violation refs read `INV-NNNN` (same shared counter as other refs).

The 15 classifications (`1/1`–`15/1`) are also real record categories, so they
appear in the Records category filter. Picking one lists the General Books filed
under that classification (`classification_code`), plus any old records whose
category is that code. Leave and resignation papers carry a classification code
too but are not matched, the same as for a classification deny.

## Vehicle maintenance requests

Set the maintenance contractor beside the reminder window in vehicle settings,
using the existing General Book recipient list. On a vehicle, **Request
maintenance** files an official Arabic General Book under classification `11/1`
and opens its record. The book includes the vehicle and driver, the latest
monthly odometer reading (or the latest maintenance reading), the previous
maintenance, and the requested work. The odometer snapshot can be edited before
submission. A contractor must be configured before requests can be generated.

Use **Mark done** in the vehicle's open requests to record the completed work.
The maintenance form starts with the request's type and odometer; saving links
the maintenance record and closes the request. A request cannot be completed
twice or against a different vehicle. Migration
`0104_vehicle_maintenance_requests` adds the request history without changing
existing maintenance records.

## Vehicle photo library

Choose an existing main photo from **Add vehicle**, **Edit vehicle**, or the
vehicle details page. Uploading a named PNG, JPEG, or WebP adds it to the shared
library; saving a selection changes only that vehicle. Gallery promotion copies
the image into the library without changing the vehicle's original attachment.

New uploads produce 160 px thumbnails, 640 px previews, and a full-resolution
WebP. Full images preserve normalized source pixels; smaller metadata-free WebP
sources are retained without another lossy conversion. Originals remain under
the data directory for recovery. Licences, accident evidence, receipts, and
gallery originals are not compressed by this feature.

### Existing installation cutover

1. During a maintenance window, stop the backend and back up the database and
   its complete data directory before upgrading. Install the aligned dependency
   requirements, including `Pillow>=12.2.0,<13.0`.
2. Apply Alembic migrations. Revision `0087_vehicle_photo_library` preserves
   existing main-photo assignments in the independent library.
3. Preview conversion using the **actual installation data directory**, not a
   copied database paired with another installation's files:

   ```powershell
   venv\Scripts\python.exe backend\scripts\convert_vehicle_photos.py --database "<data-dir>\gssg.db" --data-dir "<data-dir>" --seed-starters
   ```

4. Inspect the JSON report, then repeat with `--apply`. Apply creates a SQLite
   backup before writes. `--report "<report-path>.json"` saves the report.
   Repeating the command reuses exact pixel-identical assets rather than adding
   duplicates. Missing or invalid source files are reported, never silently
   reassigned or deleted.
5. Restart the backend and verify the fleet photos. Keep the pre-upgrade backup
   and original files until the installation is accepted.

`--seed-starters` adds the five supplied Hiace, Hilux, Coaster, Everest, and
Fortuner composites. It does not replace existing vehicle selections or guess
which model should use which photo. Choose the desired library entry explicitly.
Omit that flag to convert existing main photos without adding starter entries.
The command is dry-run by default and never runs automatically at startup.

Rollback requires the matching database **and files**. A downgrade preserves
cleared selections and materializes independent vehicle-owned files for changed
shared selections; it refuses unsafe or missing recovery sources rather than
creating broken references. Review the downgrade error before retrying.

## Deploy (LAN service + HTTPS + backups)

See **`deploy/`** for the reverse-proxy (Caddy) config and runbooks, and the
PowerShell installers under `scripts/`:

- `scripts/install-service.ps1` — register the always-on Windows service
- `scripts/firewall-lan.ps1` — open the LAN port
- `scripts/install-backup-task.ps1` — schedule nightly backups
- `scripts/secure_key_acls.ps1` — lock down credential key files

HTTPS (required for PWA install + Web Push) is configured via `deploy/Caddyfile`;
set `GSSG_SECURE_COOKIES=1` once TLS is terminated.

## License

See [LICENSE](LICENSE).
