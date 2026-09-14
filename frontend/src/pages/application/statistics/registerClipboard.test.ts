import { createElement } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import i18n from '@/lib/i18n'
import type { InmateRegisterEntry } from '@/lib/api'
import { RegisterDocument } from './RegisterDocument'
import { buildRegisterClipboard, DEFAULT_REGISTER_SCOPE } from './registerClipboard'
import { workflowMonth } from './workflowFixtures'

function reportEntry(id: string, population: InmateRegisterEntry['population'], details = 'تفاصيل تجريبية'): InmateRegisterEntry {
  return {
    id, origin: 'derived', row_no: 1, population, name: `اسم تجريبي ${id}`,
    uid: `UID-${id}`, nationality_label: 'الأردن', nationality_code: 'JO',
    violation_date: '2026-08-06', duty_unit: 'السرية الأولى', details_text: details,
    wing: '1A', holding_no: '', reporter_id: null, reporter_name: null,
    source_book_id: 10, source_version_no: 1, source_row_index: 0, source_ref_number: 'IV-10',
    incomplete_marks: [], missing: [], duplicate_of: null, completion_book_id: null, manual: null,
  }
}

const options = { scope: DEFAULT_REGISTER_SCOPE, detailMode: 'full' as const, includeCounts: true }
const actor = { user_id: 7, name_ar: 'مُعِدّ تجريبي', employee_id: 'G700', acted_at: '2026-08-21T04:00:00Z' }
const draftIssuedAt = '2026-09-02T04:00:00Z'

function sampleMonth() {
  return workflowMonth({
    entries: [reportEntry('citizen', 'citizens'), reportEntry('expat', 'expats')],
    counts: { citizens: 1, expats: 1, pending: 0, total: 2 },
    wing_summary: { counts: [], most: ['1A', '2B'], most_count: 8, least: ['3A'], least_count: 2, zero: ['4A', '5B'], unassigned_count: 0 },
  })
}

function htmlDocument(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function tableText(table: Element): string[][] {
  return Array.from(table.querySelectorAll('tr'), (row) => Array.from(row.children, (cell) => cell.textContent ?? ''))
}

describe('monthly report and clipboard', () => {
  it('uses the same Arabic table values, widths, styles and eight-row whole-month summary', () => {
    const month = sampleMonth()
    const { container } = render(createElement(RegisterDocument, { month, options, draftIssuedAt }))
    const copied = htmlDocument(buildRegisterClipboard(month, options, i18n.t).html)
    const paperTables = Array.from(container.querySelectorAll('table'))
    const copyTables = Array.from(copied.querySelectorAll('table'))

    expect(paperTables).toHaveLength(3)
    expect(copyTables.map(tableText)).toEqual(paperTables.map(tableText))
    expect(paperTables[2].querySelectorAll('tr')).toHaveLength(8)
    expect(tableText(paperTables[2]).flat().join(' ')).toContain('1A – 2B (8)')
    expect(copyTables.map((table) => Array.from(table.querySelectorAll('col'), (col) => col.style.width)))
      .toEqual(paperTables.map((table) => Array.from(table.querySelectorAll('col'), (col) => col.style.width)))
    const styleDeclarations = (cell: HTMLTableCellElement | null) => cell?.style.cssText.split(';').map((declaration) => declaration.trim()).sort()
    expect(styleDeclarations(copyTables[0].querySelector('td'))).toEqual(styleDeclarations(paperTables[0].querySelector('td')))
    expect(styleDeclarations(copyTables[0].querySelector('th'))).toEqual(styleDeclarations(paperTables[0].querySelector('th')))
    expect(copied.querySelector('thead')?.textContent).toContain('المواطن')
    expect(container.querySelector('[data-inmate-register-document]')).toHaveAttribute('lang', 'ar')
    expect(container.querySelector('[data-inmate-register-document]')).toHaveAttribute('dir', 'rtl')
    expect(container.querySelector('dl[data-report-metadata]')?.children).toHaveLength(8)
    expect(container.querySelector('tfoot')).toBeNull()
  })

  it('uses one compact physical table contract in the report DOM and escaped rich HTML', () => {
    const month = sampleMonth()
    const { container } = render(createElement(RegisterDocument, { month, options, draftIssuedAt, forPrint: true }))
    const copied = htmlDocument(buildRegisterClipboard(month, options, i18n.t).html)
    const paper = container.querySelector('table') as HTMLTableElement
    const rich = copied.querySelector('table') as HTMLTableElement
    const paperBand = paper.querySelector('thead tr:first-child th') as HTMLTableCellElement
    const richBand = rich.querySelector('thead tr:first-child th') as HTMLTableCellElement
    const paperHeader = paper.querySelector('thead tr:nth-child(2) th') as HTMLTableCellElement
    const richHeader = rich.querySelector('thead tr:nth-child(2) th') as HTMLTableCellElement
    const paperCell = paper.querySelector('tbody td') as HTMLTableCellElement
    const richCell = rich.querySelector('tbody td') as HTMLTableCellElement

    expect([paper.style.fontSize, paper.style.lineHeight, paper.style.width, paper.style.borderCollapse, paper.style.backgroundColor, paper.style.color])
      .toEqual(['9pt', '1.05', '178.1mm', 'collapse', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'])
    expect([rich.style.fontSize, rich.style.lineHeight, rich.style.width, rich.style.borderCollapse, rich.style.backgroundColor, rich.style.color])
      .toEqual([paper.style.fontSize, paper.style.lineHeight, paper.style.width, paper.style.borderCollapse, paper.style.backgroundColor, paper.style.color])
    for (const [paperNode, richNode, expected] of [
      [paperBand, richBand, ['1.2pt 1.5pt', '0.5pt solid rgb(0, 0, 0)', 'rgb(192, 0, 0)', 'rgb(255, 255, 255)', '10pt', 'bold']],
      [paperHeader, richHeader, ['1.2pt 1.5pt', '0.5pt solid rgb(0, 0, 0)', 'rgb(192, 0, 0)', 'rgb(255, 255, 255)', '9pt', 'bold']],
      [paperCell, richCell, ['0.65pt 1.5pt', '0.5pt solid rgb(0, 0, 0)', '', '', '', '']],
    ] as const) {
      const physical = (node: HTMLTableCellElement) => [node.style.padding, node.style.border, node.style.backgroundColor, node.style.color, node.style.fontSize, node.style.fontWeight]
      expect(physical(paperNode)).toEqual(expected)
      expect(physical(richNode)).toEqual(physical(paperNode))
    }
    expect(Array.from(rich.querySelectorAll('col'), (col) => col.style.width))
      .toEqual(Array.from(paper.querySelectorAll('col'), (col) => col.style.width))

    const paperSummary = container.querySelectorAll('table')[2] as HTMLTableElement
    const richSummary = copied.querySelectorAll('table')[2] as HTMLTableElement
    expect([paperSummary.style.width, paperSummary.style.fontSize, paperSummary.style.lineHeight])
      .toEqual(['179.3mm', '9pt', '1.05'])
    expect([richSummary.style.width, richSummary.style.fontSize, richSummary.style.lineHeight])
      .toEqual([paperSummary.style.width, paperSummary.style.fontSize, paperSummary.style.lineHeight])
    const paperSummaryCell = paperSummary.querySelector('tbody th') as HTMLTableCellElement
    const richSummaryCell = richSummary.querySelector('tbody th') as HTMLTableCellElement
    expect([paperSummaryCell.style.padding, paperSummaryCell.style.border, paperSummaryCell.style.fontWeight])
      .toEqual(['0.65pt 1.5pt', '0.5pt solid rgb(128, 128, 128)', 'bold'])
    expect([richSummaryCell.style.padding, richSummaryCell.style.border, richSummaryCell.style.fontWeight])
      .toEqual([paperSummaryCell.style.padding, paperSummaryCell.style.border, paperSummaryCell.style.fontWeight])
  })

  it('keeps a partial extract caption in paper, HTML and TSV with summary disabled', () => {
    const month = sampleMonth()
    const partial = { ...options, scope: ['citizens'] as const, includeCounts: false }
    const { container } = render(createElement(RegisterDocument, { month, options: partial, draftIssuedAt }))
    const payload = buildRegisterClipboard(month, partial, i18n.t)
    const caption = container.querySelector('caption')?.textContent
    expect(caption).toBeTruthy()
    expect(htmlDocument(payload.html).querySelector('caption')?.textContent).toBe(caption)
    expect(payload.text).toContain(caption)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(payload.html).not.toContain('expat')
  })

  it('labels an empty pending-only extract even with no summary', () => {
    const partial = { ...options, scope: ['pending'] as const, includeCounts: false }
    const payload = buildRegisterClipboard(sampleMonth(), partial, i18n.t)
    expect(htmlDocument(payload.html).querySelector('caption')?.textContent).toBeTruthy()
    expect(payload.text).toContain(htmlDocument(payload.html).querySelector('caption')?.textContent)
  })

  it('retains the whole-month totals when only citizens are copied', () => {
    const payload = buildRegisterClipboard(sampleMonth(), { ...options, scope: ['citizens'] }, i18n.t)
    const tables = htmlDocument(payload.html).querySelectorAll('table')
    expect(tables).toHaveLength(2)
    const summary = tableText(tables[1])
    expect(summary[1][1]).toBe('1')
    expect(summary[2][1]).toBe('1')
    expect(summary[3][1]).toBe('2')
    expect(summary[6][1]).toBe('1A – 2B (8)')
  })

  it('escapes rich copy, preserves line breaks, and sanitizes TSV before the two-column summary', () => {
    const month = sampleMonth()
    month.entries[0].details_text = '<img src=x onerror="alert(1)">\nsecond\tline & end'
    const payload = buildRegisterClipboard(month, options, i18n.t)
    const copied = htmlDocument(payload.html)
    expect(copied.querySelector('img')).toBeNull()
    expect(copied.querySelector('br')).not.toBeNull()
    expect(payload.text).toContain('<img src=x onerror="alert(1)"> second line & end')
    expect(payload.text).toContain('1A – 2B (8)')
    expect(payload.text.split('\n').slice(-7).every((line) => line.split('\t').length === 2)).toBe(true)
    expect(copied.querySelector('h2, dl')).toBeNull()
    expect(payload.html).not.toContain('G700')
  })

  it('uses only performed actors and their persisted times', () => {
    const month = sampleMonth()
    month.workflow = { ...month.workflow, prepared: actor, reviewer: { ...actor, name_ar: 'مُعيّن لم يعمل', eligible: true }, state: 'awaiting_review' }
    const { container } = render(createElement(RegisterDocument, { month, options, draftIssuedAt }))
    expect(container).toHaveTextContent(actor.name_ar)
    expect(container).toHaveTextContent('G700')
    expect(container).not.toHaveTextContent('مُعيّن لم يعمل')
    expect(container.querySelector('[data-report-issued-at]')).toHaveAttribute('data-report-issued-at', actor.acted_at)
    expect(container.querySelector('[data-report-closed-at]')).toHaveAttribute('data-report-closed-at', '')
  })

  it('preserves pending rows and uses dashes for unavailable pre-feature actor facts', () => {
    const month = sampleMonth()
    month.entries.push(reportEntry('prefeature-pending', 'pending'))
    month.workflow = { ...month.workflow, state: 'closed' }
    month.closed = true
    month.closed_at = '2026-09-01T04:00:00Z'
    const { container } = render(createElement(RegisterDocument, { month, options, draftIssuedAt }))
    expect(container).toHaveTextContent('prefeature-pending')
    expect(container.querySelector('[data-report-issued-at]')).toHaveAttribute('data-report-issued-at', '')
    expect(container.querySelector('[data-report-closed-at]')).toHaveAttribute('data-report-closed-at', month.closed_at)
    expect(Array.from(container.querySelectorAll('[data-report-stage] dd'), (item) => item.textContent)).toEqual(['—', '—', '—'])
  })

  it('switches reference/full detail consistently and keeps explicit empty wing values', () => {
    const month = sampleMonth()
    month.wing_summary = { ...month.wing_summary, most: [], most_count: 0, least: [], least_count: 0 }
    const reference = { ...options, detailMode: 'reference' as const }
    const { container } = render(createElement(RegisterDocument, { month, options: reference, draftIssuedAt }))
    const payload = buildRegisterClipboard(month, reference, i18n.t)
    expect(payload.text).toContain('IV-10')
    expect(payload.text).not.toContain('تفاصيل تجريبية')
    expect(Array.from(htmlDocument(payload.html).querySelectorAll('table')).map(tableText))
      .toEqual(Array.from(container.querySelectorAll('table')).map(tableText))
    expect(payload.text).not.toContain('(0)')
  })
})
