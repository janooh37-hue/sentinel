---
status: accepted
---

# Ledger Books follow the branch and project hierarchy; the Branch Manager's signature locks the Revision

Records today have one signing approver chosen from anyone holding
`books.approve`, advisory reviewers, and direct send to any user
(`backend/app/services/book_service.py:1928`, `book_send_service.py:431`). There
is no project or branch model, no delegation, and a signed Word book can be
reopened into a new unsigned revision (`word_book_service.py:~930`). ADR 0007
sketched the Ledger Book chain as Auditor, then Branch Manager, then an
optional approving Project Manager, with the last step issuing.

The product owner confirmed a different rule on 2026-10-27: correspondence
follows the administrative hierarchy, the Branch Manager's signature is final,
and the Project Manager routes rather than signs. This ADR records that rule
for **Ledger Books only**; Word General Books and service forms keep today's
flow.

## Organization

The hierarchy reuses the **Departments** of PR #258 (its ADR "Departments
scope what users see, and a book sent to a department lands with its head");
there is no second org model.

- A **Project** is a top-level Department; its head is the Project Manager.
- A **Branch** is a sub-department of a Project; its head is the Branch
  Manager.
- A user's Branch is their linked employee's derived Department: supervisor
  links place them, and an admin Department exception overrides that. Each
  employee has exactly one derived Department, so a user is in at most one
  Branch. Membership is what lets a user write Ledger Books, and the Branch
  decides who audits and who signs.
- The Project Manager is the top of the hierarchy for now; no Director level
  takes part. Today there is one Project; nothing assumes that.
- Auditor pools, Clerk links and Acting appointments are new grants beside
  #258's deputy and viewer grants.
- The free-text `Employee.department` / `duty_unit` and the timesheet
  designations are not used for routing.

## Roles

| Role | Who | May |
|---|---|---|
| Writer | any Branch member | draft, Save & Send, edit until signature, start a correction Revision |
| Auditor | admin-assigned pool per Branch | claim from the Branch queue, edit (typos and mistakes), pass, return |
| Branch Manager | the Branch's manager or its current Acting manager | edit, sign, return, reject |
| Project Manager | the Project's manager | forward or send back letters leaving the Project; receives a copy of letters between Branches; reject |
| Correspondence clerk | a user holding a Clerk link to a manager | the link's powers only; never sign |

Signing authority for a Ledger Book comes only from being the Branch's
manager or its current Acting manager. No capability, admin role or Clerk
link confers it. An Auditor never audits a letter they wrote.

## Addressing

To and CC name **units** (a Branch, the Project Manager) or **external
parties** from the address book. Inside the writer's own Branch, To and CC may
name members. A writer can never address a person in another Branch; the
system computes the route from the units.

## Chain

1. **Save & Send** (ADR 0007) numbers the Record and puts it in the writer's
   Branch audit queue.
2. **Audit.** The first pool Auditor to claim it owns the step. When the
   Branch Manager is the writer, the Branch Manager chooses: send it to the
   pool, or check it themselves.
3. **Sign.** The Branch Manager (or Acting manager) signs.
4. **Delivery** after signature:
   - same Branch: to the named members;
   - another Branch in the Project: to that Branch's manager, with a copy to
     the Project Manager;
   - outside the Project: to the Project Manager, who forwards it to dispatch
     or sends it back.

Before the signature the writer, the Auditor and the Branch Manager may edit
the text. Every save is kept with its author and time, and the chain
continues; an edit does not restart it. A **return** goes to the writer with a
note; after the writer's fix the letter resumes at the step that returned it.
The Auditor may only return. The Branch Manager and the Project Manager may
also **reject**; a rejected Record keeps its number.

This replaces ADR 0007's "A returned book gives the writer a new revision of
the numbered book": pre-signature edits are tracked saves inside one Revision.

## Signature locks the Revision

The signature makes that Revision immutable: no text, metadata, addressee or
attachment changes, and no state override reopens it. A correction, and a
Project Manager's send-back of a signed letter, is a **new Revision under the
same reference**: the writer starts it and it runs the full chain again
(audit, then sign). The earlier Revision stays readable, marked superseded,
and the people it reached are notified when the new one is issued.

## Receiving

The receiving Branch Manager, or their clerk with the matching power, may:
refer the letter to a member of their Branch (إحالة) with a note; reply, which
starts a new linked Ledger Book through their own chain; mark it done or
archive it; or forward it to another Branch under the same routing rules.

## Correspondence clerks

A **Clerk link** joins one clerk to one manager with a set of powers, each
granted separately:

- see the manager's inbox and queues;
- forward and route internally;
- dispatch externally (print, PDF, email) and record the dispatch;
- register incoming paper mail;
- return a letter to its writer;
- draft letters for the manager.

Admins create links, and a manager may choose their own clerks; both are
audited and revocable. The clerk always acts as themselves, and every action
records whom it was done for. A Clerk link never includes signing, passing an
audit, or rejecting.

A clerk never sees the manager's **Addressee Only** letters. **Top Secret**
needs the link to allow it explicitly. **Secret** follows the clerk's own
`books.secret` clearance.

## Acting manager

The Project Manager or an admin appoints an **Acting manager** for a Branch
for a date range. The Acting manager signs with their own signature. The paper
prints «عن» before the absent manager's title and name; the audit records who
actually signed.

## Interface

One correspondence desk inside Ledger → Books, with folders shown only to
people who hold the role: Drafts, To audit, To sign, To route, Dispatch,
Incoming, Outgoing. Desktop and mobile behave the same.

## Importance

Ledger Books carry **Importance** (الأهمية) instead of Urgency:

- Three levels: Medium (متوسطة), High (عالية), or none (بدون, stored NULL,
  the default). Codes and labels live in `app.core.grades`.
- The writer sets it on the private Draft (`book_drafts.importance`); Save &
  Send copies it to the Book (`books.importance`), and a Correction Revision
  keeps it. It belongs to the Book, not to one Revision.
- Ledger Books do not use Urgency: the Draft has no urgency (migration 0112
  drops `book_drafts.urgency`) and the Book keeps the stored default `Normal`.
- Importance is a desk mark only. Neither the Draft paper nor the issued paper
  prints Importance or Urgency.
- Every other Record stores no Importance. The desk shows one derived from its
  Urgency (Normal and Urgent as Medium, Very Urgent as High); that mapping is a
  frontend display rule, and the API returns the stored value only.

## Considered options

- **Top tabs per role (Writer | Reviewer | Branch Manager | Dispatch).**
  Rejected: one person often holds several roles, and folders with counts
  avoid switching.
- **Project Manager countersigns.** Rejected: the Branch Manager's signature
  is final; the Project Manager only routes.
- **Void and reissue on correction.** Rejected in favour of a new Revision
  under the same reference, as the app already does for Records.
- **Restart the chain on every edit.** Rejected: edits are tracked and the
  chain continues.
- **Separate Projects and Branches tables with explicit member lists.**
  Rejected after review: PR #258 already models head-anchored Departments,
  sub-departments and a department inbox; a second org model would need
  admins to keep both in sync. Free-text department and duty unit are rejected
  for the reasons #258 gives.
- **A clerk mirrors the manager.** Rejected: it would open Addressee Only
  letters and blur who acted.

## Consequences

- New grants for Auditor pools, Acting appointments and Clerk links on
  #258's Departments, plus the Ledger Book chain tables from ADR 0007 phase 2.
  `BookApprovalStep` is not reused for the Ledger Book chain unless its
  semantics fit unchanged.
- The hierarchy half of this ADR depends on PR #258. Drafts, Save & Send,
  the sanitizer, tracked edits, the signature lock and correction Revisions do
  not, and come first.
- Users with no derived Department cannot write Ledger Books until an admin
  places them in the org tree or adds an exception.
- Receiving a letter reuses #258's department send: it lands with the Branch
  head and deputies, and referral to staff is #258's hand-down.
- The Ledger Book access rule adds clerk visibility under the limits above;
  the access matrix test pins it.
