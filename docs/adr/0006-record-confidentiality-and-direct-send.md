# Record confidentiality levels and direct send

Status: accepted

Each record carries one of four levels: General, Personal, Secret and Directed.

- **General** keeps the existing record-type rules.
- **Personal** is visible to its creator only.
- **Secret** is visible to holders of the `books.secret` clearance. Admins and managers grant that clearance per user.
- **Directed** is visible to its creator and to the named recipients of active direct sends.

Two groups see records outside these rules: admins see everything, and assigned approvers and reviewers keep their revision-scoped access (ADR 0002). Admin visibility is a deliberate product decision, not an oversight.

A direct send is an explicit per-record grant. It overrides record-type denial for that one record, but Secret still requires clearance. Recalling a send removes the grant.

Enforcement uses one rule, held both as the SQL visibility clause and as its Python mirror. That rule covers every list, count, search, document, Word and notification path. A hidden record answers the same 404 as a missing record, and push or notification text never carries the subject of a non-General record.

The level is a separate field from the التبويب filing classification code, which remains a filing index and record-type permission.
