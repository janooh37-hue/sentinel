import type { CSSProperties } from 'react'
import type { TFunction } from 'i18next'
import type { InmateRegisterMonth } from '@/lib/api'
import { buildRegisterPresentation, REPORT_STYLES as styles, type RegisterExportOptions } from './registerPresentation'

export { DEFAULT_REGISTER_SCOPE, registerGroupsForScope } from './registerPresentation'
export type { RegisterExportOptions } from './registerPresentation'

export interface RegisterClipboardPayload { html: string; text: string }

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}
function htmlCell(value: string): string { return escapeHtml(value).replace(/[\r\n]+/g, '<br>') }
function tsvCell(value: string): string { return value.replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ') }
function inlineStyle(style: CSSProperties): string {
  return escapeHtml(Object.entries(style).map(([key, value]) => `${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`).join(' '))
}

/** Escaped HTML and TSV share report values and inline styles, never DOM HTML. */
export function buildRegisterClipboard(month: InmateRegisterMonth, options: RegisterExportOptions, t: TFunction): RegisterClipboardPayload {
  const report = buildRegisterPresentation(month, options, t)
  const html = report.tables.map((table, index) => {
    const caption = index === 0 && report.caption ? `<caption dir="rtl" style="${inlineStyle(styles.caption)}">${escapeHtml(report.caption)}</caption>` : ''
    const columns = table.columns.map((column) => `<col style="width: ${column.width};">`).join('')
    const band = `<tr><th dir="rtl" colspan="${table.columns.length}" scope="colgroup" style="${inlineStyle(styles.band)}">${escapeHtml(table.label)}</th></tr>`
    const headers = `<tr>${table.columns.map((column) => `<th scope="col" dir="rtl" style="${inlineStyle(styles.header)}">${escapeHtml(column.label)}</th>`).join('')}</tr>`
    const rows = table.rows.map((row) => `<tr>${row.values.map((value, cell) => `<td dir="${table.columns[cell].direction}" style="${inlineStyle(table.columns[cell].style)}">${htmlCell(value)}</td>`).join('')}</tr>`).join('')
    return `<table dir="rtl" lang="ar" style="${inlineStyle(styles.table)}">${caption}<colgroup>${columns}</colgroup><thead>${band}${headers}</thead><tbody>${rows}</tbody></table>`
  })
  const sections = report.tables.map((table, index) => [
    ...(index === 0 && report.caption ? [tsvCell(report.caption)] : []),
    tsvCell(table.label),
    table.columns.map((column) => tsvCell(column.label)).join('\t'),
    ...table.rows.map((row) => row.values.map(tsvCell).join('\t')),
  ].join('\n'))
  if (report.summaryRows.length) {
    html.push(`<table dir="rtl" lang="ar" style="${inlineStyle({ ...styles.table, ...styles.summary })}"><colgroup><col style="width: 48.5%;"><col style="width: 51.5%;"></colgroup><thead><tr><th dir="rtl" colspan="2" style="${inlineStyle(styles.band)}">${escapeHtml(report.summaryTitle)}</th></tr></thead><tbody>${report.summaryRows.map((row) => `<tr><th scope="row" dir="rtl" style="${inlineStyle({ ...styles.summaryCell, fontWeight: 'bold' })}">${escapeHtml(row.label)}</th><td dir="${row.direction}" style="${inlineStyle(styles.summaryCell)}">${htmlCell(row.value)}</td></tr>`).join('')}</tbody></table>`)
    sections.push([tsvCell(report.summaryTitle), ...report.summaryRows.map((row) => `${tsvCell(row.label)}\t${tsvCell(row.value)}`)].join('\n'))
  }
  return { html: html.join(''), text: sections.join('\n\n') }
}
