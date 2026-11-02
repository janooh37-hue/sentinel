import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { StoreItemPicker } from './StoreItemPicker'
import type * as StoreUtils from '../storeUtils'

const items = [
  { id: 1, code: 'ST-1', name_en: 'Official long tea carton name', name_ar: 'الاسم الرسمي للشاي', short_name_en: 'Yellow tea', short_name_ar: 'شاي أصفر', pack_description_en: '100 bags', pack_description_ar: '١٠٠ كيس', art_kind: 'box', brand_label: 'LIPTON' },
  { id: 2, code: 'ST-2', name_en: 'Water', name_ar: 'ماء', art_kind: 'water', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 12, contains_unit_en: 'Bottle', contains_unit_ar: null },
]
vi.mock('../storeUtils', async importOriginal => ({
  ...(await importOriginal<typeof StoreUtils>()),
  useStorePickerItems: () => ({ data: items, isPending: false, error: null }),
}))
beforeEach(async () => { await i18n.changeLanguage('en') })

it('selects the recognized drawing card without substituting its official document name', async () => {
  const onChange = vi.fn()
  render(<I18nextProvider i18n={i18n}><StoreItemPicker id="item" value={null} onChange={onChange} /></I18nextProvider>)
  await userEvent.setup().click(screen.getByRole('button', { name: /Yellow tea.*100 bags.*ST-1/ }))
  expect(onChange).toHaveBeenCalledWith(items[0])
})

it('uses Arabic shelf identity while keeping the printed Latin brand', async () => {
  await i18n.changeLanguage('ar')
  render(<I18nextProvider i18n={i18n}><StoreItemPicker id="item" value={1} onChange={vi.fn()} /></I18nextProvider>)
  expect(screen.getByRole('button', { name: /شاي أصفر.*١٠٠ كيس.*ST-1/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('LIPTON')).toBeInTheDocument()
})

it('formats structured pack contents with shared plural rules without leaking an English unit into Arabic', async () => {
  const view = render(<I18nextProvider i18n={i18n}><StoreItemPicker id="item" value={2} onChange={vi.fn()} /></I18nextProvider>)
  expect(screen.getByText('1 Carton = 12 bottles')).toBeInTheDocument()
  view.unmount()
  await i18n.changeLanguage('ar')
  render(<I18nextProvider i18n={i18n}><StoreItemPicker id="item" value={2} onChange={vi.fn()} /></I18nextProvider>)
  expect(screen.getByRole('button', { name: /ماء/ })).not.toHaveTextContent(/Bottle/i)
  expect(screen.getByText(/^1 كرتون =/)).toBeInTheDocument()
})
