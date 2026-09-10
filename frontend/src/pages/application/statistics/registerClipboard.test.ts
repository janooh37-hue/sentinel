import { createElement } from 'react'
import type { TFunction } from 'i18next'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { InmateRegisterEntry, InmateRegisterMonth } from '@/lib/api'

import { RegisterDocument } from './RegisterDocument'
import { buildRegisterClipboard, DEFAULT_REGISTER_SCOPE } from './registerClipboard'

const labels: Record<string, string> = {
  'inmateStats.populations.citizens': 'Citizens',
  'inmateStats.populations.expats': 'Expats',
  'inmateStats.populations.pending': 'Pending completion',
  'inmateStats.columns.no': 'No.',
  'inmateStats.columns.name': 'Name',
  'inmateStats.columns.uid': 'UID',
  'inmateStats.columns.nationality': 'Nationality',
  'inmateStats.columns.date': 'Violation date',
  'inmateStats.columns.dutyUnit': 'Duty unit',
  'inmateStats.columns.details': 'Details',
  'inmateStats.counts.perTable': 'Violation count',
}

const t = ((key: string, options?: { ref?: string }) => {
  if (key === 'inmateStats.export.referenceCell') return `See Record ${options?.ref ?? ''}`
  return labels[key] ?? key
}) as TFunction

function entry(
  id: string,
  population: 'citizens' | 'expats' | 'pending',
  detailsText = 'Filed narrative',
): InmateRegisterEntry {
  return {
    id,
    origin: 'derived',
    row_no: 1,
    population,
    name: `Name ${id}`,
    uid: `UID-${id}`,
    nationality_label: population === 'expats' ? 'Jordanian' : '',
    nationality_code: population === 'expats' ? 'JO' : null,
    violation_date: '2026-09-06',
    duty_unit: 'السرية الأولى',
    details_text: detailsText,
    wing: '',
    holding_no: '',
    reporter_id: null,
    reporter_name: null,
    source_book_id: 10,
    source_version_no: 1,
    source_row_index: 0,
    source_ref_number: 'IV-10',
    incomplete_marks: [],
    missing: [],
    duplicate_of: null,
    completion_book_id: null,
    manual: null,
  }
}

function month(entries: InmateRegisterEntry[]): InmateRegisterMonth {
  const citizens = entries.filter((item) => item.population === 'citizens').length
  const expats = entries.filter((item) => item.population === 'expats').length
  const pending = entries.filter((item) => item.population === 'pending').length
  return {
    year: 2026,
    month: 9,
    closed: false,
    closed_at: null,
    closed_by: null,
    closed_by_name: null,
    reopened_at: null,
    reopened_by: null,
    reopened_by_name: null,
    force_reason: null,
    force_closed: false,
    can_close: false,
    first_closable_date: '2026-10-01',
    export_ready: false,
    counts: { citizens, expats, pending, total: citizens + expats + pending },
    entries,
    uncounted: [],
    arrived_after_close: [],
    blocking: [],
  }
}

const options = {
  scope: DEFAULT_REGISTER_SCOPE,
  language: 'en' as const,
  detailMode: 'full' as const,
}

describe('RegisterDocument', () => {
  it('renders the fixed RTL six- and seven-column paper geometry', () => {
    const registerMonth = month([
      entry('citizen', 'citizens'),
      entry('expat', 'expats'),
      entry('pending', 'pending'),
    ])
    const { container } = render(
      createElement(RegisterDocument, {
        month: registerMonth,
        options: {
          ...options,
          includeCounts: true,
          orientation: 'landscape',
        },
      }),
    )
    const tables = Array.from(container.querySelectorAll('table'))

    expect(tables).toHaveLength(3)
    expect(tables.every((table) => table.dir === 'rtl')).toBe(true)
    expect(tables.map((table) => table.querySelectorAll('col').length)).toEqual([6, 7, 6])
    expect(tables.map((table) => table.querySelector('th')?.colSpan)).toEqual([6, 7, 6])
    expect(container.querySelector('td[dir="ltr"]')).not.toBeNull()
  })
})

describe('buildRegisterClipboard', () => {
  it('builds RTL HTML tables with merged population bands', () => {
    const payload = buildRegisterClipboard(
      month([entry('citizen', 'citizens'), entry('expat', 'expats')]),
      options,
      t,
    )

    expect(payload.html).toContain('<table dir="rtl"')
    expect(payload.html).toContain('<th dir="rtl" colspan="6"')
    expect(payload.html).toContain('<th dir="rtl" colspan="7"')
    expect(payload.html).toContain('background:#C00000')
  })

  it('emits exactly one newline-free TSV line per entry and no count row', () => {
    const payload = buildRegisterClipboard(
      month([
        entry('citizen', 'citizens', 'First line\nSecond line'),
        entry('expat', 'expats'),
      ]),
      options,
      t,
    )
    const lines = payload.text.split('\n')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('First line Second line')
    expect(payload.text).not.toContain('\r')
    expect(payload.text).not.toContain('Violation count')
  })

  it('includes the pending block only when pending entries exist', () => {
    const withoutPending = buildRegisterClipboard(
      month([entry('citizen', 'citizens')]),
      options,
      t,
    )
    const withPending = buildRegisterClipboard(
      month([entry('citizen', 'citizens'), entry('pending', 'pending')]),
      options,
      t,
    )

    expect(withoutPending.html).not.toContain('Pending completion')
    expect(withPending.html).toContain('Pending completion')
  })
})
