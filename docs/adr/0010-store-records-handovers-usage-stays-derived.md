---
status: accepted
---

# Store records Handovers; Monthly usage stays derived from Stock counts

ADR 0009 decided nobody records handouts. The user now wants to know who took
what from the store, so Handovers are recorded: the Store items and quantities,
the free-text name of the person who took them, the user who recorded them and
when. This supersedes the "nobody records individual handouts" part of 0009;
the rest of 0009 stands.

## Decision

- Handovers are recorded. The server takes each line from the item's
  earliest-expiring non-expired Batch first and refuses a line larger than what
  is on the shelf.
- **Monthly usage is still derived from Stock counts**, unchanged: the earlier
  count plus the Monthly delivery in between, minus Disposals in between, minus
  the later count. Handovers are not summed into usage.
- Handovers reduce on-hand between counts, so the dashboard is current between
  the monthly counts.
- Stock counts stay blank, never pre-filled (0009's rule stands).

## Considered options

- Derive usage from Handovers instead of counts: exact per-person usage, but
  stock taken without a Handover would vanish from usage, and the usage series
  would break against the count-derived history 0009 warned about.
- Record Handovers but keep usage derived from counts: the option taken.

## Consequences

- Stock taken without a Handover is still counted as usage at the next Stock
  count, and usage history stays comparable across the change.
- Between counts, on-hand reflects Handovers; the next count overrides it.
- A wrong Handover is deleted and recorded again; Handovers are not edited.
