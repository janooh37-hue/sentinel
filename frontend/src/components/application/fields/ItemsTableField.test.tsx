import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError } from '@/lib/api'
import type { StorePickerItem } from '@/lib/api'
import ar from '@/locales/ar.json'
import { ItemsTableField } from './ItemsTableField'

vi.spyOn(api, 'listStorePickerItems')

const ITEMS: StorePickerItem[] = [
  {
    id: 1, code: 'ST-0001', name_en: 'Black tea', name_ar: 'شاي أسود',
    counting_unit_en: 'Carton', counting_unit_ar: 'كرتون',
    contains_qty: 12, contains_unit_en: 'Box', contains_unit_ar: 'علبة',
  },
  {
    id: 2, code: 'ST-0002', name_en: 'Water', name_ar: null,
    counting_unit_en: 'Case', counting_unit_ar: 'صندوق',
    contains_qty: null, contains_unit_en: null, contains_unit_ar: null,
  },
]
const INITIAL_ROW = {
  sno: '1', code: '', description: '', unit: '', qty: '3', quantity: '3', remarks: 'Keep dry',
}
type Row = typeof INITIAL_ROW

function ValueSpy() {
  const rows = useWatch<{ items: Row[] }>({ name: 'items' })
  return <pre data-testid="rows">{JSON.stringify(rows)}</pre>
}

function Host({ catalog = true }: { catalog?: boolean }) {
  const form = useForm({ defaultValues: { items: [{ ...INITIAL_ROW }] } })
  return (
    <FormProvider {...form}>
      <ItemsTableField name="items" label_en="Items" label_ar="الأصناف" itemCatalog={catalog ? 'store' : undefined} />
      <ValueSpy />
    </FormProvider>
  )
}

function renderTable(catalog = true) {
  const client = new QueryClient()
  render(<QueryClientProvider client={client}><Host catalog={catalog} /></QueryClientProvider>)
  return client
}

function rows(): Row[] {
  return JSON.parse(screen.getByTestId('rows').textContent ?? '[]') as Row[]
}

beforeEach(async () => {
  vi.mocked(api.listStorePickerItems).mockReset().mockResolvedValue(ITEMS)
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ItemsTableField store picker', () => {
  it('picks with the keyboard, filling only legacy code, description and counting unit', async () => {
    const user = userEvent.setup()
    renderTable()
    const code = await screen.findByRole('combobox', { name: 'Item code, row 1' })
    await user.click(code)
    expect(screen.getByRole('listbox', { name: 'Store items' })).toHaveAttribute('id', code.getAttribute('aria-controls'))
    await user.type(code, 'TEA')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{ArrowDown}')
    const option = screen.getByRole('option')
    expect(code).toHaveAttribute('aria-activedescendant', option.id)
    expect(option).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(rows()).toEqual([{ ...INITIAL_ROW, code: 'ST-0001', description: 'Black tea', unit: 'Carton' }])
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(code).toHaveFocus()
  })

  it('searches by code and Arabic name and supports pointer selection', async () => {
    const user = userEvent.setup()
    renderTable()
    const code = await screen.findByRole('combobox')
    await user.type(code, 'st-0002')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option')).toHaveTextContent('Water')
    await user.clear(code)
    await user.type(code, 'أسود')
    await user.click(screen.getByRole('option'))
    expect(rows()[0]).toMatchObject({ code: 'ST-0001', description: 'Black tea', unit: 'Carton' })
  })

  it('allows free text in every cell, including edits after a selection', async () => {
    const user = userEvent.setup()
    renderTable()
    const code = await screen.findByRole('combobox')
    await user.click(code)
    await user.click(screen.getByRole('option', { name: /ST-0001/ }))
    await user.clear(code)
    await user.type(code, 'CUSTOM-9')
    expect(screen.getByRole('status')).toHaveTextContent('You may enter the item details manually.')
    await user.keyboard('{Escape}')
    expect(code).toHaveValue('CUSTOM-9')
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell')
    const values: [number, string][] = [[0, '7'], [2, 'Custom material'], [3, 'Packet'], [4, '9'], [5, 'Urgent']]
    for (const [index, value] of values) {
      const input = within(cells[index]).getByRole('textbox')
      await user.clear(input)
      await user.type(input, value)
    }
    expect(rows()).toEqual([{
      sno: '7', code: 'CUSTOM-9', description: 'Custom material', unit: 'Packet', qty: '9', quantity: '9', remarks: 'Urgent',
    }])
  })

  it('silently degrades a 403 to the original plain inputs and never retries on focus or a new row', async () => {
    vi.mocked(api.listStorePickerItems).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Forbidden'))
    const client = renderTable()
    await waitFor(() => expect(client.getQueryState(['store-picker-items'])?.status).toBe('error'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const code = screen.getAllByRole('textbox')[1]
    expect(code).not.toHaveAttribute('placeholder')
    fireEvent.change(code, { target: { value: 'MANUAL' } })
    fireEvent.focus(code)
    fireEvent.keyDown(code, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('button', { name: '+ Add row' }))
    expect(rows()[0].code).toBe('MANUAL')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(api.listStorePickerItems).toHaveBeenCalledTimes(1)
  })

  it('does not load a catalogue for ordinary items tables', () => {
    renderTable(false)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(api.listStorePickerItems).not.toHaveBeenCalled()
    expect(rows()).toEqual([INITIAL_ROW])
  })

  it('navigates the complete list with arrows, Home and End, and closes on Tab', async () => {
    const user = userEvent.setup()
    renderTable()
    const code = await screen.findByRole('combobox')
    await user.click(code)
    await user.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await user.tab()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(rows()).toEqual([INITIAL_ROW])
  })

  it('shows Arabic labels and names but fills the English HQ paper in English', async () => {
    i18n.addResourceBundle('ar', 'translation', { application: { itemsTable: ar.application.itemsTable } }, true, true)
    await act(async () => { await i18n.changeLanguage('ar') })
    const user = userEvent.setup()
    renderTable()
    const code = await screen.findByRole('combobox', { name: 'رمز الصنف، السطر 1' })
    expect(code).toHaveAttribute('placeholder', 'ابحث بالرمز أو الاسم')
    await user.click(code)
    const list = screen.getByRole('listbox', { name: 'أصناف المخزن' })
    expect(list.closest('[dir]')).toHaveAttribute('dir', 'rtl')
    const option = screen.getByRole('option', { name: /شاي أسود/ })
    expect(within(option).getByText('ST-0001')).toHaveAttribute('dir', 'ltr')
    expect(within(option).getByText('شاي أسود')).toHaveAttribute('dir', 'auto')
    await user.click(option)
    expect(rows()[0]).toMatchObject({ code: 'ST-0001', description: 'Black tea', unit: 'Carton' })
    await user.clear(code)
    await user.type(code, 'water')
    await user.click(screen.getByRole('option', { name: /Water/ }))
    expect(rows()[0]).toMatchObject({ code: 'ST-0002', description: 'Water', unit: 'Case' })
    await user.clear(code)
    await user.type(code, 'غير موجود')
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد أصناف مطابقة في المخزن. يمكنك إدخال تفاصيل الصنف يدوياً.')
  })
})
