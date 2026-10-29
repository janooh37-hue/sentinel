/**
 * Builders for the statement body. Each block becomes one unbreakable table
 * row of the sheet (see `StatementSheet`), so long tables are cut into chunks
 * that each repeat their column header.
 */

import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { PaperLanguage } from './printSettings'

/** Translation fixed to the paper's language, which may differ from the UI's. */
export function usePaperT(lang: PaperLanguage): TFunction {
  const { i18n } = useTranslation()
  return i18n.getFixedT(lang)
}

/**
 * How a column sets: `date` fixed width, never wraps; `num` end-aligned
 * (right in LTR, left in RTL); `ref` mono, never wraps; `short` never wraps;
 * `text` (default) wraps within the remaining width.
 */
export type ColumnKind = 'date' | 'num' | 'ref' | 'short' | 'text'

export interface Column {
  label: string
  kind?: ColumnKind
}

export interface TableRow {
  key: string
  cells: ReactNode[]
  total?: boolean
}

/** Rows kept with the section title and column header, so neither is stranded at a page foot. */
export const LEAD_ROWS = 2

const isBlank = (cell: ReactNode): boolean => cell === null || cell === undefined || cell === '' || cell === '-'

/**
 * Drop columns that say nothing: blank ('-' or empty) in every data row.
 * Total rows do not count, and column order is kept.
 */
export function dropEmptyColumns(columns: Column[], rows: TableRow[]): { columns: Column[]; rows: TableRow[] } {
  const data = rows.filter((row) => !row.total)
  if (data.length === 0) return { columns, rows }
  const keep = columns.map((_, i) => data.some((row) => !isBlank(row.cells[i])))
  return {
    columns: columns.filter((_, i) => keep[i]),
    rows: rows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => keep[i]) })),
  }
}

/**
 * A titled table as ONE body block that may break between its rows. The
 * column header prints once at the start and again only at the top of a page
 * where the table continues (the inner `thead` is a table-header-group, which
 * Chrome repeats per fragment). Rows never split. The title, header and the
 * first `LEAD_ROWS` rows travel together (`tbody.lead`), so a section never
 * leaves its title or header alone at a page foot.
 */
export function tableBlocks({
  id,
  heading,
  count,
  columns: allColumns,
  rows: allRows,
  emptyText,
}: {
  id: string
  heading: ReactNode
  count?: string
  columns: Column[]
  rows: TableRow[]
  emptyText: string
}): ReactNode[] {
  const title = (
    <h2>
      {heading}
      {count !== undefined && <span className="c">{count}</span>}
    </h2>
  )
  // An empty table says nothing its heading cannot: print one quiet line.
  if (allRows.length === 0) {
    return [
      <section className="st-sec" key={id} data-section={id}>
        {title}
        <p className="st-none">{emptyText}</p>
      </section>,
    ]
  }
  const { columns, rows } = dropEmptyColumns(allColumns, allRows)
  const row = (r: TableRow): ReactNode => (
    <tr key={r.key} className={r.total ? 'tot' : undefined}>
      {r.cells.map((cell, i) => (
        <td key={i} className={`k-${columns[i]?.kind ?? 'text'}`}>
          {cell}
        </td>
      ))}
    </tr>
  )
  return [
    <section className="st-sec st-flow" key={id} data-section={id}>
      {title}
      <table className="st-dt">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} className={`k-${c.kind ?? 'text'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="lead">{rows.slice(0, LEAD_ROWS).map(row)}</tbody>
        {rows.length > LEAD_ROWS && <tbody>{rows.slice(LEAD_ROWS).map(row)}</tbody>}
      </table>
    </section>,
  ]
}

export interface PageUnit {
  /** Height in px at print metrics (1:1 sheet). */
  height: number
  /** A flowing table's header height, re-printed on each page the table continues. */
  header?: number
  /** Part of a flowing table after its lead (title + header + first rows). */
  continues?: boolean
}

/**
 * Pages for a list of unbreakable units, the way print lays them out: a unit
 * that does not fit starts a new page, and a continuing table row that starts
 * a page pays its repeated header first. Pure, so the estimate and its tests
 * share one rule.
 */
export function paginate(units: PageUnit[], pageBody: number): number {
  let pages = 1
  let used = 0
  for (const unit of units) {
    if (used > 0 && used + unit.height > pageBody) {
      pages += 1
      used = unit.continues ? (unit.header ?? 0) : 0
    }
    used += unit.height
  }
  return pages
}
