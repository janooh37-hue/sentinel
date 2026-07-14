/**
 * threadGrouping — pure client-side thread collapse for the message list
 * (Phase 2, D2).
 *
 * Groups CONSECUTIVE rows that share a normalised subject (see
 * `lib/normaliseSubject`) into one expandable thread; a lone row stays a single.
 * "Consecutive" matters: the list is already newest-first within date bands, so
 * a back-and-forth on one subject sits together — we only merge neighbours, so
 * an unrelated email with a coincidentally similar subject far down the list
 * isn't swept in.
 *
 * Pure (no React) so the grouping is unit-tested independently of rendering.
 */

import { normaliseSubject } from '@/lib/normaliseSubject'
import type { LedgerListItem } from '@/lib/api'

/** A single ungrouped row. */
export interface SingleRow {
  kind: 'single'
  entry: LedgerListItem
}

/** A collapsed thread: the newest member is the head, the rest are members. */
export interface ThreadRow {
  kind: 'thread'
  /** Stable, UNIQUE identity for this thread group — the head entry id (`t<id>`).
   * Not the normalised subject: two non-consecutive runs in one band can share a
   * subject, which would collide as a React key + thread open-state token. */
  key: string
  /** Newest member, shown on the collapsed head row. */
  head: LedgerListItem
  /** All members (incl. the head), newest-first. `length` drives the count pill. */
  members: LedgerListItem[]
}

export type GroupedRow = SingleRow | ThreadRow

/**
 * Group an already-ordered (newest-first) list into singles + threads. When
 * `enabled` is false every row is returned as a single (the per-session toggle
 * off state) — order is preserved exactly.
 */
export function groupThreads(items: LedgerListItem[], enabled: boolean): GroupedRow[] {
  if (!enabled) return items.map((entry) => ({ kind: 'single', entry }))

  const out: GroupedRow[] = []
  let i = 0
  while (i < items.length) {
    const key = normaliseSubject(items[i]!.subject)
    // Walk forward while neighbours share the normalised subject. A blank
    // normalised subject never groups (empty subjects aren't "the same thread").
    let j = i + 1
    if (key !== '') {
      while (j < items.length && normaliseSubject(items[j]!.subject) === key) j += 1
    }
    const run = items.slice(i, j)
    if (run.length >= 2) {
      out.push({ kind: 'thread', key: `t${run[0]!.id}`, head: run[0]!, members: run })
    } else {
      out.push({ kind: 'single', entry: run[0]! })
    }
    i = j
  }
  return out
}
