import { describe, expect, it } from 'vitest'

import { dropEmptyColumns, paginate, rowGroups, type Column, type TableRow } from './paperBlocks'

describe('paginate', () => {
  it('re-prints the header only on the page a table continues', () => {
    // Page body 100: lead (title + header 10 + 2 rows) 40, then rows of 20.
    const units = [
      { height: 40 },
      { height: 20, header: 10, continues: true },
      { height: 20, header: 10, continues: true },
      { height: 20, header: 10, continues: true }, // 100: fills page 1 exactly
      { height: 20, header: 10, continues: true }, // page 2 starts with header 10 + 20
      { height: 20, header: 10, continues: true },
      { height: 20, header: 10, continues: true },
      { height: 20, header: 10, continues: true }, // 10 + 80 = 90
      { height: 20, header: 10, continues: true }, // 110 > 100: page 3
    ]
    expect(paginate(units, 100)).toBe(3)
  })

  it('moves a section lead (title, header, first rows) whole to the next page', () => {
    // 70 used; a 40-high lead does not fit in the remaining 30, so it starts page 2
    // without paying a repeated header (it carries its own).
    expect(paginate([{ height: 70 }, { height: 40 }, { height: 20, header: 10, continues: true }], 100)).toBe(2)
    expect(paginate([{ height: 70 }, { height: 30 }], 100)).toBe(1)
  })
})

describe('dropEmptyColumns', () => {
  const columns: Column[] = [{ label: 'Date' }, { label: 'Subject' }, { label: 'Reference' }, { label: 'Recorded by' }]

  it('drops columns blank in every data row and keeps the order of the rest', () => {
    const rows: TableRow[] = [
      { key: 'a', cells: ['1 Jul', 'Memo', '-', ''] },
      { key: 'b', cells: ['2 Jul', 'Letter', '-', '-'] },
    ]
    const out = dropEmptyColumns(columns, rows)
    expect(out.columns.map((c) => c.label)).toEqual(['Date', 'Subject'])
    expect(out.rows.map((r) => r.cells)).toEqual([
      ['1 Jul', 'Memo'],
      ['2 Jul', 'Letter'],
    ])
  })

  it('keeps a column with a value in any row, and ignores total rows when judging', () => {
    const rows: TableRow[] = [
      { key: 'a', cells: ['1 Jul', 'Memo', 'OUT/1', '-'] },
      { key: 'b', cells: ['2 Jul', 'Letter', '-', '-'] },
      { key: 't', total: true, cells: ['Total', '', '', '9'] },
    ]
    const out = dropEmptyColumns(columns, rows)
    expect(out.columns.map((c) => c.label)).toEqual(['Date', 'Subject', 'Reference'])
    expect(out.rows[2].cells).toEqual(['Total', '', ''])
  })
})

describe('rowGroups', () => {
  const data = (n: number): TableRow[] => Array.from({ length: n }, (_, i) => ({ key: `r${i}`, cells: [String(i)] }))
  const total: TableRow = { key: 'total', total: true, cells: ['Total'] }
  const keys = (rows: TableRow[]): string[] => rows.map((r) => r.key)

  it('keeps a total row with the last two data rows', () => {
    const groups = rowGroups([...data(10), total])
    expect(keys(groups.lead)).toEqual(['r0', 'r1'])
    expect(keys(groups.tail)).toEqual(['r8', 'r9', 'total'])
    expect(groups.body).toHaveLength(6)
  })

  it('never leaves a total row to open a group on its own when the table is short', () => {
    for (const n of [1, 2, 3, 4]) {
      const groups = rowGroups([...data(n), total])
      const last = groups.tail.length > 0 ? groups.tail : groups.lead
      expect(last.at(-1)?.key).toBe('total')
      expect(last.filter((r) => !r.total).length).toBeGreaterThanOrEqual(Math.min(n, 2))
    }
  })

  it('has no tail without a total row', () => {
    const groups = rowGroups(data(10))
    expect(groups.tail).toEqual([])
    expect(keys(groups.body)).toHaveLength(8)
  })
})
