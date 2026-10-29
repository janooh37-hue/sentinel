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

export interface Column {
  label: string
  num?: boolean
}

export interface TableRow {
  key: string
  cells: ReactNode[]
  total?: boolean
}

/** Rows per unbreakable chunk: small enough that a part-filled page still takes the next one. */
const CHUNK = 8

/**
 * A titled table as body blocks: the heading rides with the first chunk, and
 * every chunk repeats the column header, so a page break between chunks still
 * leaves each page's table labelled.
 */
export function tableBlocks({
  id,
  heading,
  count,
  columns,
  rows,
  emptyText,
}: {
  id: string
  heading: ReactNode
  count?: string
  columns: Column[]
  rows: TableRow[]
  emptyText: string
}): ReactNode[] {
  const head = (
    <thead>
      <tr>
        {columns.map((c, i) => (
          <th key={i} className={c.num ? 'num' : undefined}>
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  )
  const title = (
    <h2>
      {heading}
      {count !== undefined && <span className="c">{count}</span>}
    </h2>
  )
  if (rows.length === 0) {
    return [
      <section className="st-sec" key={id} data-section={id}>
        {title}
        <table className="st-dt">
          {head}
          <tbody>
            <tr>
              <td className="none" colSpan={columns.length}>
                {emptyText}
              </td>
            </tr>
          </tbody>
        </table>
      </section>,
    ]
  }
  const size = Math.ceil(rows.length / Math.ceil(rows.length / CHUNK))
  const blocks: ReactNode[] = []
  for (let start = 0; start < rows.length; start += size) {
    blocks.push(
      <section className="st-sec" key={`${id}-${start}`} data-section={start === 0 ? id : undefined}>
        {start === 0 && title}
        <table className="st-dt">
          {head}
          <tbody>
            {rows.slice(start, start + size).map((row) => (
              <tr key={row.key} className={row.total ? 'tot' : undefined}>
                {row.cells.map((cell, i) => (
                  <td key={i} className={columns[i]?.num ? 'num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>,
    )
  }
  return blocks
}
