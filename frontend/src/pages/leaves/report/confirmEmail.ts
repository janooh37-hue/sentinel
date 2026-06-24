/**
 * Pure builder for the batch-confirmation compose prefill — kept free of
 * React so it unit-tests without the ledger tree.
 *
 * Produces a `ComposePrefill` ready to be passed as `location.state.composePrefill`
 * when navigating to `/ledger`.
 */
import type { LeaveListItem } from '@/lib/api'

import { leaveEmployeeName } from '../leaveEmployeeName'

export interface ConfirmEmailLabels {
  subject: string
  intro: string
  colName: string
  colPeriod: string
  colDays: string
  lang: string
}

export interface ComposePrefill {
  subject: string
  bodyHtml: string
  to?: string[]
  cc?: string[]
}

/** Minimal HTML escape — names are operator-entered and can contain `<>&"`. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Format an ISO date string as DD/MM/YYYY. */
function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function buildConfirmationEmail(
  rows: LeaveListItem[],
  labels: ConfirmEmailLabels,
): ComposePrefill {
  const trs = rows
    .map((r) => {
      const name = esc(leaveEmployeeName(r, labels.lang))
      const period = `${dmy(r.start_date)} → ${dmy(r.end_date)}`
      return (
        `<tr>` +
        `<td style="padding:4px 12px 4px 0">${name}</td>` +
        `<td style="padding:4px 12px 4px 0" dir="ltr">${period}</td>` +
        `<td style="padding:4px 0">${r.days}</td>` +
        `</tr>`
      )
    })
    .join('')

  const bodyHtml =
    `<p>${esc(labels.intro)}</p>` +
    `<table style="border-collapse:collapse">` +
    `<thead><tr>` +
    `<th align="left" style="padding:4px 12px 4px 0">${esc(labels.colName)}</th>` +
    `<th align="left" style="padding:4px 12px 4px 0">${esc(labels.colPeriod)}</th>` +
    `<th align="left" style="padding:4px 0">${esc(labels.colDays)}</th>` +
    `</tr></thead>` +
    `<tbody>${trs}</tbody>` +
    `</table>`

  return { subject: labels.subject, bodyHtml }
}
