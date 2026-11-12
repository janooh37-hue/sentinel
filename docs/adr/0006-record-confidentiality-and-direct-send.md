# Record confidentiality levels and direct send

Status: accepted

Superseded in part by ADR 0007 (record grade, distribution and drafts).

Each record carries one of four levels: General, Personal, Secret and Directed.

- **General** keeps the existing record-type rules.
- **Personal** is visible to its creator only.
- **Secret** is visible to holders of the `books.secret` clearance. Admins and managers grant that clearance per user.
- **Directed** is visible to its creator and to the named recipients of active direct sends.

Two groups see records outside these rules: admins see everything, and assigned approvers and reviewers keep their revision-scoped access (ADR 0002). Admin visibility is a deliberate product decision, not an oversight.

A direct send is an explicit per-record grant. It overrides record-type denial for that one record, but Secret still requires clearance. Recalling a send removes the grant.

Enforcement uses one rule, held both as the SQL visibility clause and as its Python mirror. That rule covers every list, count, search, document, Word and notification path. A hidden record answers the same 404 as a missing record, and push or notification text never carries the subject of a non-General record.

The level is a separate field from the التبويب filing classification code, which remains a filing index and record-type permission.

Migration `0105_record_confidentiality` follows `0104_vehicle_maintenance_requests`;
recipient state and book links continue that single migration chain.

Direct-send purposes are `info`, `action`, `reply`, and `circulate`; signing
belongs to the approval chain. Migration `0106_recipient_state` translates legacy `sign` sends.
Recipients can mark their active sends done or archive them (both undoable).
Done stamps first read; undo preserves it. Archive leaves access unchanged,
excludes the send from received/unread counts, and exposes the record under
`inbox=archived` only when all the caller's active sends are archived.
The inbox summary includes an `archived` record count. Recipient state routes
(`POST`/`DELETE /api/v1/books/{book_id}/inbox/done` and `/inbox/archive`) return
`BookInboxRead` and apply to all the caller's active sends; hidden records or
missing active sends answer 404.

Record person-name responses include nullable Arabic siblings (`*_name_ar`, and
order-aligned `*_names_ar` lists), resolved in batches from the user's linked
employee. Missing Arabic names remain null so clients can fall back to English.
Record screens, recipient/sender panels, approval status sentences and approver
pickers select these siblings with `pickEmployeeName` in the screen language;
reviewer name lists keep their Arabic siblings aligned by index.
Direct-send and approval push text uses the Arabic name in Arabic, falling back
to English; confidential direct-send notifications omit both name variants.

Replies and derived records use a new General Book Word draft and a live
`BookLink` to the original (migration `0107_book_links`). The addressee is the sender of the
caller's newest active direct send, falling back to the original creator;
the printed reference uses the original's reference and date. Create-from
copies a General Book's structured or Word-authored body when available.

Outgoing attached Secret references impose a Secret floor. Reply and
create-from links to any non-General record prohibit General even after the
reference is detached. Derive, attach and level-change endpoints enforce the
same floor (`422 LEVEL_BELOW_FLOOR`). Detaching a reply/create-from reference
keeps the thread relationship; ordinary reference links are deleted.

Thread responses include both directions in record creation order and omit
records the caller cannot fully open. Attaching and detaching require
`books.edit` and write access to the source record; only attached outgoing
links can be detached. Hidden, deleted or missing unlink targets answer
`404 LINK_NOT_FOUND` without changing the link. Direct sends include attached
references by default (`include_references=false` opts out), provided the sender can open
them. Per-reference recipient skips are reported as `not_cleared`, `personal`,
`already_recipient` or `self`; they do not fail the main send.

The records preview starts collapsed on each visit, independently of its
remembered normal/wide width. A row click selects and expands it; double-click
opens the full record with list navigation context. While the desktop preview
is collapsed, hover/focus exposes a row menu also reachable by right-click,
Shift+F10 or the ContextMenu key. Contextual tools reuse record dialogs and
Reply/Inbox action descriptors; printing uses the full record's PDF print mode.
Mobile cards continue to open the full record and its existing More sheet.
Opening a record or its preview stamps first read for its active recipients.
Row menus fetch `GET /api/v1/books/{book_id}?mark_read=false` with a separate
detail-peek cache key, so inspecting contextual actions does not mark a record
read or satisfy the normal record/preview fetch from an unstamped cache.

Generated record DOCX files print `سري` for Secret and `شخصي` for Personal at
the top-center of every page, in black underlined Calibri 9pt Arabic. General
and Directed print no mark. A page-anchored header frame inside the
`gssg-level-mark` content control leaves the letterhead/reference block and
gray submitter footer unchanged. Headerless templates receive a frame-only
header; later sections inherit any missing page-kind header.

Level changes publish a new marked copy of unsigned editable committed DOCX
files and refresh their PDF packages without modifying the previous files.
Rollback removes the new copies. If PDF conversion/publication fails, the
level and marked DOCX still save while the previous PDF remains available.
Active Word working files are left alone until finish/reopen applies the
current level. Signed/finalized artifacts are not restamped; changing the
record's level never rewrites their signed PDF.
