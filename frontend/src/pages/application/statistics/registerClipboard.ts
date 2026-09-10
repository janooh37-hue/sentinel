import type { TFunction } from 'i18next'

import type { InmatePopulation, InmateRegisterEntry, InmateRegisterMonth } from '@/lib/api'

import {
  formatRegisterDate,
  groupEntries,
  type RegisterGroup,
  UNSPECIFIED,
  visibleGroups,
} from './registerModel'

export type RegisterDocumentLanguage = 'ar' | 'en'
export type RegisterOrientation = 'landscape' | 'portrait'
export type RegisterDetailMode = 'reference' | 'full'

export interface RegisterExportOptions {
  scope: readonly InmatePopulation[]
  language: RegisterDocumentLanguage
  includeCounts: boolean
  orientation: RegisterOrientation
  detailMode: RegisterDetailMode
}

export interface RegisterClipboardPayload {
  html: string
  text: string
}

export const DEFAULT_REGISTER_SCOPE: readonly InmatePopulation[] = [
  'citizens',
  'expats',
  'pending',
]

const HEADER_STYLE =
  'border:1px solid #000000;background:#C00000;color:#ffffff;padding:4px 9px;text-align:center;font-weight:bold'
const CELL_STYLE = 'border:1px solid #000000;padding:4px 9px;text-align:center'
const TABLE_STYLE =
  'border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt;margin:12px 0;width:100%'

export function registerGroupsForScope(
  month: InmateRegisterMonth,
  scope: readonly InmatePopulation[],
): RegisterGroup[] {
  const included = new Set(scope)
  return visibleGroups(groupEntries(month)).filter((group) => included.has(group.key))
}

export function registerColumnKeys(group: InmatePopulation): readonly string[] {
  const columns = [
    'inmateStats.columns.no',
    'inmateStats.columns.name',
    'inmateStats.columns.uid',
  ]
  if (group === 'expats') columns.push('inmateStats.columns.nationality')
  columns.push(
    'inmateStats.columns.date',
    'inmateStats.columns.dutyUnit',
    'inmateStats.columns.details',
  )
  return columns
}

function markedValue(entry: InmateRegisterEntry, field: string, value: string): string {
  return entry.incomplete_marks.includes(field) ? `${value} †` : value
}

export function registerDetailsValue(
  entry: InmateRegisterEntry,
  detailMode: RegisterDetailMode,
  language: RegisterDocumentLanguage,
  t: TFunction,
): string {
  if (detailMode === 'full') return markedValue(entry, 'details', entry.details_text)
  if (entry.source_ref_number) {
    return markedValue(
      entry,
      'details',
      t('inmateStats.export.referenceCell', {
        lng: language,
        ref: entry.source_ref_number,
      }),
    )
  }
  // A manual entry has no filed Record to reference, so reference mode prints
  // its own narrative. It otherwise remains indistinguishable on the artifact.
  return markedValue(entry, 'details', entry.details_text)
}

export function registerEntryValues(
  entry: InmateRegisterEntry,
  group: InmatePopulation,
  options: Pick<RegisterExportOptions, 'language' | 'detailMode'>,
  t: TFunction,
): string[] {
  const name =
    group !== 'expats' && entry.incomplete_marks.includes('nationality')
      ? `${entry.name} †`
      : entry.name
  const values = [String(entry.row_no), name, entry.uid]
  if (group === 'expats') {
    values.push(markedValue(entry, 'nationality', entry.nationality_label))
  }
  values.push(
    formatRegisterDate(entry.violation_date, options.language),
    markedValue(entry, 'duty_unit', entry.duty_unit || UNSPECIFIED),
    registerDetailsValue(entry, options.detailMode, options.language, t),
  )
  return values
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function htmlCell(value: string): string {
  return escapeHtml(value).replace(/[\r\n]+/g, '<br>')
}

function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ')
}

/**
 * Build the rich-table/plain-text clipboard pair without touching browser APIs.
 * The TSV intentionally contains data rows only: exactly one physical line per
 * entry, with no masthead, signature, population band, headers, or count rows.
 */
export function buildRegisterClipboard(
  month: InmateRegisterMonth,
  options: Pick<RegisterExportOptions, 'scope' | 'language' | 'detailMode'>,
  t: TFunction,
): RegisterClipboardPayload {
  const groups = registerGroupsForScope(month, options.scope)
  const html = groups
    .map((group) => {
      const headers = registerColumnKeys(group.key).map((key) => t(key, { lng: options.language }))
      const band = `<tr><th dir="rtl" colspan="${headers.length}" style="${HEADER_STYLE}">${escapeHtml(
        t(`inmateStats.populations.${group.key}`, { lng: options.language }),
      )}</th></tr>`
      const header = `<tr>${headers
        .map((value) => `<th style="${HEADER_STYLE}">${escapeHtml(value)}</th>`)
        .join('')}</tr>`
      const rows = group.entries
        .map((entry) => {
          const values = registerEntryValues(entry, group.key, options, t)
          const dateIndex = group.key === 'expats' ? 4 : 3
          return `<tr>${values
            .map((value, index) => {
              const direction = index === 0 || index === 2 || index === dateIndex ? ' dir="ltr"' : ''
              return `<td${direction} style="${CELL_STYLE}">${htmlCell(value)}</td>`
            })
            .join('')}</tr>`
        })
        .join('')
      return `<table dir="rtl" style="${TABLE_STYLE}"><thead>${band}${header}</thead><tbody>${rows}</tbody></table>`
    })
    .join('')

  const text = groups
    .flatMap((group) =>
      group.entries.map((entry) =>
        registerEntryValues(entry, group.key, options, t).map(tsvCell).join('\t'),
      ),
    )
    .join('\n')

  return { html, text }
}
