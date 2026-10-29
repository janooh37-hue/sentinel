---
status: accepted
---

# Store Monthly usage is derived from Stock counts, not logged per handout

The Store needs to know how much of each Store item is used per month so the
next HQ material request asks for the right quantities. HQ delivers once a
month and handles all money, so the Store tracks only quantity and expiry. We
decided Monthly usage is derived: the earlier Stock count plus the Monthly
delivery in between, minus Disposals in between, minus the later Stock count.
Nobody records individual handouts.

## Considered options

- Record every handout (who took what, when): exact per-person and per-post
  usage, but a typing burden on every withdrawal that a small store with one
  monthly delivery does not carry in practice.
- Track Monthly deliveries only: lightest, but cannot say what is left on the
  shelf or what is about to expire there.
- Derive usage from a monthly Stock count, recorded per Batch: one short task
  per month that matches the delivery rhythm. This is the option taken.

## Consequences

- The Store cannot answer "who took it". Adding handout logging later starts a
  new usage series that is not comparable with the derived history before it.
- Usage exists only between two Stock counts; the first count yields none.
- Stock thrown away must be recorded as a Disposal, otherwise it inflates usage.
- Stock counts are entered blank, never pre-filled with the expected
  quantity: a confirmed pre-fill would silently report zero usage.
