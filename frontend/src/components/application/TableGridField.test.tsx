/**
 * TableGridField — RTL add-row grid for General Book table templates.
 *
 * Tests run under lng=ar. Rather than importing the full ar.json (OOM risk),
 * we seed only the keys this component touches.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'
import { useForm, FormProvider, useWatch } from 'react-hook-form'

import { TableGridField } from './TableGridField'

// ── minimal AR bundle — only keys this component uses ─────────────────────
const AR_BUNDLE = {
  application: {
    itemsTable: {
      addRow: '+ إضافة سطر',
    },
  },
  books: {
    word: {
      tableGrid: {
        empty: 'لا صفوف بعد — أضف صفاً للبدء.',
        columnLabel: 'عمود {{n}}',
      },
    },
  },
}

// AR control strings that must NOT appear (from itemsTable.empty)
const ITEMS_TABLE_EMPTY_AR = 'لا توجد بنود — أضف سطراً للبدء.'

beforeAll(async () => {
  i18n.addResourceBundle('ar', 'translation', AR_BUNDLE, true, true)
  await i18n.changeLanguage('ar')
})
afterAll(async () => {
  await i18n.changeLanguage('en')
})

// ── host helpers ─────────────────────────────────────────────────────────────
type Row = Record<string, string>

function ValueSpy({ name }: { name: string }) {
  const v = useWatch({ name }) as Row[] | undefined
  return <pre data-testid="value">{JSON.stringify(v ?? [])}</pre>
}

function Host({ columns, name = 'table_rows' }: { columns: string[]; name?: string }) {
  const methods = useForm<{ table_rows: Row[] }>({ defaultValues: { table_rows: [] } })
  return (
    <FormProvider {...methods}>
      <TableGridField name={name} columns={columns} />
      <ValueSpy name={name} />
    </FormProvider>
  )
}

function readValue(): Row[] {
  return JSON.parse(screen.getByTestId('value').textContent ?? '[]') as Row[]
}

// ── tests ────────────────────────────────────────────────────────────────────
const COLS = ['العمود أ', 'العمود ب', 'العمود ج']

describe('TableGridField — column headers', () => {
  it('renders supplied column headers', () => {
    render(<Host columns={COLS} />)
    expect(screen.getByText('العمود أ')).toBeInTheDocument()
    expect(screen.getByText('العمود ب')).toBeInTheDocument()
    expect(screen.getByText('العمود ج')).toBeInTheDocument()
  })

  it('uses columnLabel fallback for empty-string headers', () => {
    render(<Host columns={['', '']} />)
    // Arabic: "عمود {{n}}" → "عمود 1", "عمود 2"
    expect(screen.getByText('عمود 1')).toBeInTheDocument()
    expect(screen.getByText('عمود 2')).toBeInTheDocument()
  })
})

describe('TableGridField — RTL', () => {
  it('table wrapper has dir="rtl"', () => {
    render(<Host columns={COLS} />)
    const table = screen.getByRole('table')
    const wrapper = table.closest('[dir="rtl"]')
    expect(wrapper).not.toBeNull()
  })
})

describe('TableGridField — empty state', () => {
  it('shows tableGrid.empty Arabic string when no rows', () => {
    render(<Host columns={COLS} />)
    expect(screen.getByText('لا صفوف بعد — أضف صفاً للبدء.')).toBeInTheDocument()
  })

  it('does NOT show itemsTable.empty wording', () => {
    render(<Host columns={COLS} />)
    expect(screen.queryByText(ITEMS_TABLE_EMPTY_AR)).toBeNull()
  })
})

describe('TableGridField — add row', () => {
  it('clicking add-row appends one row with one input per column', () => {
    render(<Host columns={COLS} />)
    fireEvent.click(screen.getByRole('button', { name: /إضافة سطر/ }))
    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(COLS.length)
  })

  it('form value shape after add-row is [{c0, c1, c2}]', () => {
    render(<Host columns={COLS} />)
    fireEvent.click(screen.getByRole('button', { name: /إضافة سطر/ }))
    const rows = readValue()
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual(['c0', 'c1', 'c2'])
  })

  it('second add-row appends a second independent row', () => {
    render(<Host columns={COLS} />)
    const addBtn = screen.getByRole('button', { name: /إضافة سطر/ })
    fireEvent.click(addBtn)
    fireEvent.click(addBtn)
    expect(readValue()).toHaveLength(2)
    expect(screen.getAllByRole('textbox')).toHaveLength(COLS.length * 2)
  })
})
