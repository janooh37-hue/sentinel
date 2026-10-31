import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type StorePickerItem } from '@/lib/api'
import i18n from '@/lib/i18n'
import { DeliveryLines } from './DeliveryLines'
import { createDeliveryLines, type DeliveryLineInit, type DeliveryLinesCheck, validateDeliveryLines } from './deliveryLineModel'

const COFFEE: StorePickerItem = {
  id: 4, code: 'ST-0004', name_en: 'Coffee', name_ar: 'قهوة', counting_unit_en: 'Carton', counting_unit_ar: 'كرتون', contains_qty: 24, contains_unit_en: 'Jar', contains_unit_ar: 'علبة', art_kind: null, art_color: null,
}

function Harness({ initial }: { initial: DeliveryLineInit[] }) {
  const [lines, setLines] = useState(() => createDeliveryLines(initial))
  const result = validateDeliveryLines(lines, i18n.t)
  return <>
    <DeliveryLines idPrefix="d" lines={lines} onChange={setLines} errors={{}} alertId="d-alert" renderLineFields={(line) => <p>Slot {line.key}</p>} />
    <output data-testid="keys">{lines.map((line) => line.key).join(',')}</output>
    <output data-testid="result">{JSON.stringify(result)}</output>
  </>
}

const result = () => JSON.parse(screen.getByTestId('result').textContent ?? '{}') as DeliveryLinesCheck

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listStorePickerItems').mockResolvedValue([COFFEE])
})

describe('DeliveryLines', () => {
  it('renders prefilled lines that validate without edits and numbers added lines after them', async () => {
    const user = userEvent.setup()
    render(<QueryClientProvider client={new QueryClient()}><I18nextProvider i18n={i18n}><Harness initial={[
      { item: COFFEE, quantity: { units: '2', loose: '5' }, expiry: { mode: 'month', date: '', month: '2028-09' } },
      { item: COFFEE, quantity: { units: '1', loose: '' }, expiry: { mode: 'none', date: '', month: '' } },
    ]} /></I18nextProvider></QueryClientProvider>)
    const lines = await screen.findAllByRole('group', { name: /Line/ })
    expect(lines).toHaveLength(2)
    expect(within(lines[0]).getByRole('textbox', { name: 'Coffee: Carton' })).toHaveValue('2')
    expect(within(lines[0]).getByText('Slot 0')).toBeInTheDocument()
    expect(result()).toEqual({ errors: {}, payload: [
      { item_id: 4, expiry: '2028-09', quantity: 53 }, { item_id: 4, expiry: null, quantity: 24 },
    ] })
    await user.click(screen.getByRole('button', { name: 'Add line' }))
    expect(screen.getByTestId('keys')).toHaveTextContent('0,1,2')
    expect(Object.keys(result().errors[2])).toEqual(['item', 'expiry', 'quantity'])
  })

  it('rejects undated scan lines while allowing them in manual delivery entry', () => {
    const lines = createDeliveryLines([{ item: COFFEE, quantity: { units: '1', loose: '' }, expiry: { mode: 'none', date: '', month: '' } }])
    expect(validateDeliveryLines(lines, i18n.t).errors).toEqual({})
    expect(validateDeliveryLines(lines, (key) => key, { allowUndated: false }).errors).toEqual({ 0: { expiry: 'assets.store.scan.expiryRequired' } })
  })
})
