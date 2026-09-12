import type { CSSProperties } from 'react'
import type { TFunction } from 'i18next'

import type { InmatePopulation, InmateRegisterEntry, InmateRegisterMonth } from '@/lib/api'
import { formatRegisterDate, formatRegisterMonth, groupEntries, UNSPECIFIED, visibleGroups } from './registerModel'

export interface RegisterExportOptions {
  scope: readonly InmatePopulation[]
  includeCounts: boolean
  detailMode: 'reference' | 'full'
}

export const DEFAULT_REGISTER_SCOPE: readonly InmatePopulation[] = ['citizens', 'expats', 'pending']
export const REPORT_LOCALE = 'ar-u-nu-latn'

// Physical values measured from preview1's read-only Word PDF. These are
// document styles: neither shell font scale nor dark mode should alter them.
const PAGE = { width: '210mm', height: '297mm', top: '14mm', side: '15.95mm', bottom: '7mm' }
const FONT = 'Calibri, Arial, "Noto Sans Arabic", sans-serif'
const HEADER_COLOR = '#C00000'
const PAPER_COLOR = '#ffffff'
const INK_COLOR = '#000000'
const PRINT_PROPERTIES = {
  '--inmate-report-header': HEADER_COLOR,
  '--inmate-report-paper': PAPER_COLOR,
  '--inmate-report-ink': INK_COLOR,
  // Chromium rounds an exact 276mm named-page content height fractionally
  // over the A4 box and emits a blank trailing sheet. Keep 1mm tolerance.
  '--inmate-report-print-height': '275mm',
} as CSSProperties
export const REPORT_PAGE_RULE = `@media print { @page inmate-register-portrait { size: A4 portrait; margin: ${PAGE.top} ${PAGE.side} ${PAGE.bottom}; } }`
export const REPORT_STYLES = {
  paper: { ...PRINT_PROPERTIES, boxSizing: 'border-box', width: PAGE.width, minHeight: PAGE.height, padding: `${PAGE.top} ${PAGE.side} ${PAGE.bottom}`, color: INK_COLOR, background: PAPER_COLOR, fontFamily: FONT, fontSize: '11.04pt', lineHeight: '1.16', direction: 'rtl' },
  content: { minHeight: '253mm' },
  masthead: { display: 'flex', alignItems: 'center', gap: '6mm', minHeight: '15mm', marginBottom: '3mm' },
  logo: { width: '18mm', height: '18mm', objectFit: 'contain', flexShrink: '0' },
  heading: { margin: '0', fontSize: '15.96pt', fontWeight: 'bold', lineHeight: '1.2' },
  authority: { margin: '1mm 0 0', fontSize: '8.04pt', color: '#666666' },
  metadata: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', margin: '0', borderTop: '0.5pt solid #dddddd', borderInlineStart: '0.5pt solid #dddddd' },
  metaCell: { minWidth: '0', minHeight: '10.5mm', padding: '1mm 1.4mm', borderBottom: '0.5pt solid #dddddd', borderInlineEnd: '0.5pt solid #dddddd' },
  metaLabel: { margin: '0', fontSize: '6pt', color: '#555555', textAlign: 'start' },
  metaValue: { margin: '2mm 0 0', fontSize: '8.04pt', fontWeight: 'bold', unicodeBidi: 'isolate', overflowWrap: 'anywhere' },
  table: { width: '178.1mm', tableLayout: 'fixed', borderCollapse: 'collapse', fontFamily: FONT, fontSize: '11.04pt', lineHeight: '1.16', color: '#000000', background: '#ffffff', direction: 'rtl', margin: '0' },
  band: { border: '0.5pt solid #000000', background: HEADER_COLOR, color: PAPER_COLOR, padding: '2.4pt 2pt', textAlign: 'center', fontWeight: 'bold', fontSize: '12pt', printColorAdjust: 'exact' },
  header: { border: '0.5pt solid #000000', background: HEADER_COLOR, color: PAPER_COLOR, padding: '2.4pt 2pt', textAlign: 'center', fontWeight: 'bold', fontSize: '11.04pt', printColorAdjust: 'exact' },
  cell: { border: '0.5pt solid #000000', padding: '1.5pt 2pt', textAlign: 'start', verticalAlign: 'top', whiteSpace: 'pre-line', overflowWrap: 'anywhere', unicodeBidi: 'isolate' },
  caption: { padding: '2mm 0', fontFamily: FONT, fontSize: '9pt', fontWeight: 'bold', textAlign: 'start', color: '#000000', background: '#ffffff' },
  summary: { width: '179.3mm', margin: '1.5mm 0 0', marginInlineStart: '-0.6mm', breakInside: 'avoid' },
  // Both summary columns align to the physical right in the reference,
  // including the separately LTR-isolated counts and canonical wing codes.
  summaryCell: { border: '0.5pt solid #808080', padding: '0.9pt 4pt', textAlign: 'right', verticalAlign: 'top', unicodeBidi: 'isolate', overflowWrap: 'anywhere' },
  signatures: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '2.5mm', margin: '4mm 0 0', breakInside: 'avoid' },
  signature: { minHeight: '19mm', minWidth: '0', border: '0.5pt solid #dddddd', padding: '1.4mm 2mm' },
  role: { fontSize: '8.04pt', fontWeight: 'bold', margin: '0 0 3mm' },
  identity: { textAlign: 'center', margin: '0', fontSize: '11.04pt', overflowWrap: 'anywhere' },
  pending: { textAlign: 'center', margin: '2mm 0', fontSize: '8.04pt', color: '#C00000' },
} satisfies Record<string, CSSProperties>

export interface ReportColumn {
  label: string
  width: string
  direction: 'rtl' | 'ltr' | 'auto'
  style: CSSProperties
}
export interface ReportTable {
  key: InmatePopulation
  label: string
  columns: ReportColumn[]
  rows: { id: string; values: string[] }[]
}
export interface ReportSummaryRow { label: string; value: string; direction: 'rtl' | 'ltr' }

export function registerGroupsForScope(month: InmateRegisterMonth, scope: readonly InmatePopulation[]) {
  const included = new Set(scope)
  const groups = groupEntries(month)
  // A specifically requested empty pending extract still needs a data-table
  // caption. The default full report retains its conditional pending table.
  return (scope.length === 1 && scope[0] === 'pending' ? groups : visibleGroups(groups))
    .filter((group) => included.has(group.key))
}

const WIDTHS = {
  citizens: [605, 1693, 2853, 1506, 1348, 2092],
  expats: [327, 2405, 1260, 1159, 1699, 1301, 1946],
  pending: [605, 1693, 2853, 1506, 1348, 2092],
} satisfies Record<InmatePopulation, number[]>

function marked(entry: InmateRegisterEntry, field: string, value: string): string {
  return entry.incomplete_marks.includes(field) ? `${value} †` : value
}

function entryValues(entry: InmateRegisterEntry, key: InmatePopulation, options: RegisterExportOptions, t: TFunction): string[] {
  const values = [String(entry.row_no), key === 'expats' ? entry.name : marked(entry, 'nationality', entry.name), entry.uid]
  if (key === 'expats') values.push(marked(entry, 'nationality', entry.nationality_label))
  const details = options.detailMode === 'reference' && entry.source_ref_number
    ? t('inmateStats.export.referenceCell', { lng: 'ar', ref: entry.source_ref_number })
    : entry.details_text
  values.push(formatRegisterDate(entry.violation_date, REPORT_LOCALE), marked(entry, 'duty_unit', entry.duty_unit || UNSPECIFIED), marked(entry, 'details', details))
  return values
}

/** Selected rows plus the server's whole-month summary; never aggregate wings here. */
export function buildRegisterPresentation(month: InmateRegisterMonth, options: RegisterExportOptions, t: TFunction, submissionId?: number) {
  const ar = (key: string) => t(key, { lng: 'ar' })
  const groups = registerGroupsForScope(month, options.scope)
  const tables: ReportTable[] = groups.map((group) => {
    const keys = ['no', 'name', 'uid', ...(group.key === 'expats' ? ['nationality'] : []), 'date', 'dutyUnit', 'details']
    const totalWidth = WIDTHS[group.key].reduce((sum, width) => sum + width, 0)
    return {
      key: group.key,
      label: ar(`inmateStats.populations.${group.key}`),
      columns: keys.map((key, index) => {
        const numeric = ['no', 'uid', 'date'].includes(key)
        return { label: ar(`inmateStats.columns.${key}`), width: `${(WIDTHS[group.key][index] / totalWidth * 100).toFixed(5)}%`, direction: numeric ? 'ltr' : 'auto', style: { ...REPORT_STYLES.cell, textAlign: numeric ? 'center' : 'start' } }
      }),
      rows: group.entries.map((entry) => ({ id: entry.id, values: entryValues(entry, group.key, options, t) })),
    }
  })
  const wingValue = (wings: string[], count: number): string => wings.length > 0 && count > 0
    ? `${wings.join(' – ')} (${count})` : ar('inmateStats.document.noPositiveWings')
  const workflowState = submissionId === undefined ? 'draft' : month.workflow.state
  const summaryRows: ReportSummaryRow[] = [
    { label: ar('inmateStats.populations.citizens'), value: String(month.counts.citizens), direction: 'ltr' },
    { label: ar('inmateStats.populations.expats'), value: String(month.counts.expats), direction: 'ltr' },
    { label: ar('inmateStats.counts.documentTotal'), value: String(month.counts.total), direction: 'ltr' },
    { label: ar('inmateStats.document.state'), value: ar(`inmateStats.workflow.states.${workflowState}`), direction: 'rtl' },
    { label: ar('inmateStats.document.leastWings'), value: wingValue(month.wing_summary.least, month.wing_summary.least_count), direction: month.wing_summary.least.length ? 'ltr' : 'rtl' },
    { label: ar('inmateStats.document.mostWings'), value: wingValue(month.wing_summary.most, month.wing_summary.most_count), direction: month.wing_summary.most.length ? 'ltr' : 'rtl' },
    { label: ar('inmateStats.document.zeroWings'), value: month.wing_summary.zero.join(' – ') || ar('inmateStats.document.noZeroWings'), direction: month.wing_summary.zero.length ? 'ltr' : 'rtl' },
  ]
  return {
    tables,
    caption: DEFAULT_REGISTER_SCOPE.some((key) => !options.scope.includes(key))
      ? t('inmateStats.document.extractCaption', { lng: 'ar', groups: options.scope.map((key) => ar(`inmateStats.populations.${key}`)).join('، '), displayed: groups.reduce((sum, group) => sum + group.count, 0), total: month.counts.total })
      : null,
    summaryTitle: t('inmateStats.document.summaryTitle', { lng: 'ar', month: formatRegisterMonth(month.year, month.month, REPORT_LOCALE) }),
    summaryRows: options.includeCounts ? summaryRows : [],
  }
}
