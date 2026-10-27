---
status: proposed
---

# Records carry a fixed Grade and a Distribution; Ledger Books are drafted privately and numbered at Save & Send

ADR 0006 gave each record one of four levels (General, Personal, Secret,
Directed) and let admins see everything. Two problems followed. Personal let
the creator, any manager, or any admin hide a record from everyone else
(`can_change_confidentiality`, `backend/app/services/book_send_service.py:83`).
And the levels mixed two questions: how sensitive the content is, and who it
is addressed to. The new Ledger Book, an HTML-authored record, also needs a
private place to write before a number exists, which `books` cannot hold
because `Book.ref_number` is NOT NULL and unique
(`backend/app/db/models.py:241`, `:310`).

We decided to split the level into a fixed **Grade** and a **Distribution**,
to remove Personal, to limit admins on the two highest grades, and to give
Ledger Books private Drafts that receive their number, paper date and barcode
only at Save & Send.

## Superseded parts of ADR 0006

This ADR replaces these parts of ADR 0006. The rest of ADR 0006 (direct send,
recipient state, Arabic name siblings, links and threads, the records preview)
still holds, read with Grade in place of level.

- The four levels: "Each record carries one of four levels: General, Personal,
  Secret and Directed."
- Personal: "**Personal** is visible to its creator only."
- Admins: "Two groups see records outside these rules: admins see everything,
  and assigned approvers and reviewers keep their revision-scoped access
  (ADR 0002). Admin visibility is a deliberate product decision, not an
  oversight." Admins no longer see everything; see the access rule below.
  Retained revision access (ADR 0002) is unchanged.
- The floors: "Outgoing attached Secret references impose a Secret floor.
  Reply and create-from links to any non-General record prohibit General even
  after the reference is detached. Derive, attach and level-change endpoints
  enforce the same floor (`422 LEVEL_BELOW_FLOOR`)." The floor from attached
  Secret references stays; the reply and create-from floor and the hard
  `LEVEL_BELOW_FLOOR` block on them go away.
- The DOCX marks: "Generated record DOCX files print `سري` for Secret and
  `شخصي` for Personal at the top-center of every page". The marks now come
  from the Grade table below.
- Level-change republishing: "Level changes publish a new marked copy of
  unsigned editable committed DOCX files and refresh their PDF packages without
  modifying the previous files." This paragraph is superseded as written;
  how a Grade change reaches Word artifacts is decided with the Grade work.

## Grade

Grades are fixed code constants in `core/grades.py` (code, English label,
Arabic label, rank, paper mark). The database check constraint, the API
literal and the paper marks all derive from that file. There is no management
screen, table or setting.

| Code | Label | Arabic | Paper mark |
|---|---|---|---|
| `unclassified` | Unclassified | غير سري | none |
| `secret` | Secret | سري | سري |
| `top_secret` | Top Secret | سري للغاية | سري للغاية |
| `addressee_only` | Addressee Only | لعنايته فقط | سري للغاية — لعنايته فقط |

The Grade stays separate from the التبويب filing classification code.

## Distribution

Distribution is `organization` or `named`, following the form kind. An
organization record opens under the record-type rules; a named record opens
only for the people named on it. Top Secret forces `named`.

## Access rule

One rule decides access. It is written as the SQL visibility clause with a
Python mirror, as before (today `_confidentiality_clause` and `_allows` in
`backend/app/services/book_service.py`).

```
admin, grade in (top_secret, addressee_only):
    metadata only, unless the admin holds an active break-glass grant

unclassified:   distribution = organization ? type_ok OR named_rel : named_rel
secret:         has(books.secret) AND (same as unclassified)
top_secret:     creator OR To OR CC OR chain assignee OR active break-glass
addressee_only: creator OR To OR chain assignee OR active break-glass   (no CC, no forward)
inmate reporter: unclassified only (organization records, or named records it created)
```

`type_ok` is the record-type permission; `named_rel` is being the creator, a
recipient, or a chain assignee. Retained revision access (ADR 0002) is
unchanged. A record the caller cannot open answers 404.

**Admin.** Admin is the security-authorized role; no new capability is added.
For Unclassified and Secret, admins keep today's access. For Top Secret and
Addressee Only, an admin sees list metadata only (ref, tab, grade, dates); the
body, paper and attachments answer 404. Break-glass is the only way in:

- the admin must give a reason;
- the grant expires after 24 hours;
- every content read under the grant writes an audit row: who, when, why, and
  which document.

**Top Secret.** It opens only for people named on the record: creator, To, CC
and chain assignees. After issue, only the writer may add recipients or
forward, and each addition is audited.

**Addressee Only.** Like Top Secret, but without CC and without forwarding.

## Personal is removed

Migration maps every `personal` record to Unclassified + `named` with no
recipients, so only its creator can open it and nothing becomes more visible.
A review report lists every legacy Personal record with its creator, who set
it to Personal (from `book_confidentiality_changed` audit rows), and a flag
when that person was not the creator. An audited admin action restores
`organization` distribution to the records the review picks. Private Drafts
are now the only private space.

## Grade on create, reply and create-from

The creator chooses the Grade. A reply inherits the source Grade; create-from
defaults to it. After that, only the creator or an admin may change the
Grade, and each change is audited. Managers lose this right.

## Drafts and Save & Send (Ledger Books only)

- Drafts live in a **Drafts (المسودات)** folder, in a new `book_drafts` table
  outside `books`. Only the owner sees a draft, and can reopen and edit it any
  number of times.
- A draft has no official number, only an internal draft number shown as
  `مسودة-000123` / `DRAFT-000123`. It has no barcode and carries a DRAFT
  watermark.
- **Save & Send** does all of this in one step: allocates `1/{tab}/{serial}`,
  fixes the paper date, generates the barcode, applies the Grade and metadata,
  creates the `books` row with `source_draft_id`, and submits the book into the
  approval chain.
- To/CC receive the book after the final approval.
- A returned book gives the writer a new revision of the **numbered** book; it
  does not go back to Drafts. A rejected book keeps its number.
- Word General Books are unchanged.

## Ledger Book barcode

The Ledger Book carries the same barcode the General Book uses today: Libre
Barcode 39 (Code 39) with the payload from `qr.barcode_payload(ref,
paper_date)` (`backend/app/core/qr.py:52`). The human-readable payload is
printed under the barcode on the HTML paper only. There is no Aztec/QR square
on Ledger Book paper. The barcode is generated at Save & Send, when the book
gets its number. A site code (for example `0331`) is left out for now and
will be added later. Word General Book rendering, `qr.py` and the scan-back
decoder do not change.

## Correction to ADR 0003

ADR 0003 describes the General Book barcode as `<REF>+<YYYYMMDD>`. The code
emits `*GSSG+DD/MM/YYYY+REF*`:

```python
def barcode_payload(ref: str, paper_date: date) -> str:
    return f"*GSSG+{paper_date:%d/%m/%Y}+{ref.upper()}*"
```

The Word letterhead uses the same function (`backend/app/core/docx_engine.py:1144`).
`*GSSG+DD/MM/YYYY+REF*` is the current payload for both papers. The site
code will be added to it later.

## Urgency

Priority is renamed **Urgency (الاستعجال)** in the UI, forms, filters, reports
and printed documents. Stored values keep their meaning, with one new value:

| Stored value | English | Arabic |
|---|---|---|
| `Normal` | Normal | عادي |
| `High` | Urgent | عاجل |
| `Very High` (new) | Very Urgent | عاجل جداً |

The column `priority` becomes `urgency`, and the JSON key
`approval_context.priority` becomes `urgency`.

## Considered options

- **A `books.top_secret` clearance capability.** Rejected: Top Secret should
  open only for named people, not for a cleared group, and sensitive
  capabilities cannot be granted per user anyway
  (`backend/app/services/perm_service.py:231`).
- **Keep Personal.** Rejected: any creator, manager or admin could use it to
  hide a record from everyone. Private Drafts cover the real need for a
  private space.
- **Number the Ledger Book at draft creation, or add a Reserve action.**
  Rejected: abandoned drafts would burn official numbers and leave gaps, and
  drafts would have to live in `books`, whose `ref_number` is NOT NULL and
  unique. Numbering at Save & Send keeps the number, paper date and barcode
  together.
- **Admins see everything, as in ADR 0006.** Rejected for Top Secret and
  Addressee Only: the content must stay with the named people. Admins keep
  metadata so they can administer the records, and break-glass gives an
  audited route for emergencies.
- **Rename the stored Urgency values (`High` → `Urgent`).** Rejected: the
  values are frozen in `BookVersion.approval_context`; renaming only the
  labels keeps old revisions readable without rewriting them.

## Consequences

- The old level names hardcoded outside the access rule (notification
  redaction, link floors, `LEVEL_MARKS` in `backend/app/core/level_mark.py:21`)
  must move to shared Grade helpers.
- `user_visibility_clause` keeps its signature, so its many consumers do not
  change; the access matrix test pins SQL and Python mirror together.
- Admins lose content access to Top Secret and Addressee Only records unless
  they use break-glass, and every such read is audited.
- Downgrading the migration loses information: Top Secret and Addressee Only
  become Secret, and Very High becomes High.
- Ledger Book approvals cannot reuse the DOCX/PDF signing path; they need
  their own path.
- The ADR 0003 payload wording is stale and is corrected here, not in ADR 0003's body.
