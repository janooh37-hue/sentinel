import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type UniformItemRead, type UniformReturnRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UniformPage } from '../UniformPage'
import { ReturnDialog } from './ReturnDialog'
import { uniformKeys } from '../uniformQueries'

const state = vi.hoisted(() => ({ editable: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap !== 'uniform.edit' || state.editable }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { name_en: 'Store keeper', email: 'keeper@example.test' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SUIT: UniformItemRead = { id: 1, name_en: 'Formal suit', name_ar: 'بدلة رسمية', description_en: '', description_ar: '', group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 1, sort_order: 0, archived_at: null, version: '1', sizes: [], holders: [] }
const POLO: UniformItemRead = { ...SUIT, id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', group_key: 'guard', drawing: 'polo', tracking: 'shelf', sizes: [
  { id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 3, archived_at: null, sort_order: 0 },
] }
const ALI = { employee_id: 'G3194', name_en: 'Ali Hassan', name_ar: 'علي حسن', held_total: 5, issued_total: 5, last_issued_on: '2026-10-01' }
const OMAR = { employee_id: 'G3200', name_en: 'Omar Returned', name_ar: null, held_total: 0, issued_total: 2, last_issued_on: '2026-09-01' }
const RECORD: UniformReturnRead = { id: 7, created_at: '2026-11-01T08:00:00', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, employee_id: 'G3194', returned_on: '2026-11-01', note: null, lines: [{ item_id: 2, size_id: 21, qty: 1, condition: 'damaged' }] }

function mount(node: React.ReactNode, entry = '/holdings/uniform') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter></I18nextProvider></QueryClientProvider>)
  return { client }
}
async function chooseAli(user = userEvent.setup()) {
  await user.type(await screen.findByRole('searchbox'), 'G31')
  await screen.findByRole('button', { name: /Ali Hassan/ })
  await user.keyboard('{Enter}')
  await screen.findByRole('group', { name: 'Polo shirt' })
  return user
}

beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([SUIT, POLO])
  vi.spyOn(api, 'listUniformRecipients').mockResolvedValue([ALI, OMAR])
  vi.spyOn(api, 'getUniformEmployee').mockResolvedValue({ holdings: [
    { employee_id: 'G3194', item_id: 1, size_id: null, qty: 2 },
    { employee_id: 'G3194', item_id: 2, size_id: 21, qty: 3 },
  ], issues: [], returns: [] })
  vi.spyOn(api, 'createUniformReturn').mockResolvedValue({ ...RECORD, id: 8 })
  vi.spyOn(api, 'listUniformReturns').mockResolvedValue([RECORD])
  vi.spyOn(api, 'getUniformSummary').mockResolvedValue({ shelf_total: 8, holder_count: 1, suits_issued: 2, out_of_stock: 0, low_sizes: 0 })
})

describe('Record return', () => {
  it('offers only employees who still hold uniform', async () => {
    const user = userEvent.setup()
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    await user.type(await screen.findByRole('searchbox'), 'G3')
    await screen.findByRole('button', { name: /Ali Hassan/ })
    expect(screen.queryByRole('button', { name: /Omar Returned/ })).not.toBeInTheDocument()
  })

  it('supports result arrows for cached current-holder searches without clearing result refs', async () => {
    const second = { ...ALI, employee_id: 'G3201', name_en: 'Second holder' }
    vi.mocked(api.listUniformRecipients).mockResolvedValue([ALI, second])
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    client.setQueryDefaults(uniformKeys.recipients('G3'), { staleTime: Infinity })
    client.setQueryData(uniformKeys.recipients('G3'), [ALI, second])
    const user = userEvent.setup()
    const input = await screen.findByRole('searchbox')
    await user.type(input, 'G3')
    const first = await screen.findByRole('button', { name: /Ali Hassan/ })
    const last = screen.getByRole('button', { name: /Second holder/ })
    await user.keyboard('{ArrowDown}')
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(last).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(first).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.getByText('Ali Hassan')).toBeInTheDocument()
    expect(api.createUniformReturn).not.toHaveBeenCalled()
  })

  it('retains cached holder search results through refresh failure and retry', async () => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = userEvent.setup()
    const input = await screen.findByRole('searchbox')
    await user.type(input, 'G31')
    const employee = await screen.findByRole('button', { name: /Ali Hassan/ })
    vi.mocked(api.listUniformRecipients).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.recipients('G31') }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.lookupError'))
    expect(screen.getByRole('searchbox')).toBe(input)
    expect(input).toHaveValue('G31')
    expect(screen.getByRole('button', { name: /Ali Hassan/ })).toBe(employee)
    expect(employee).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Ali Hassan/ })).toBe(employee)
    await user.click(input)
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('group', { name: 'Polo shirt' })).toBeInTheDocument()
  })

  it('retains the cached no-holder notice when the unfiltered recipient refresh fails', async () => {
    vi.mocked(api.listUniformRecipients).mockResolvedValue([OMAR])
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const notice = await screen.findByText(i18n.t('assets.uniform.returnEmpty'))
    const input = screen.getByRole('searchbox')
    vi.mocked(api.listUniformRecipients).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.recipients('') }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.lookupError'))
    expect(screen.getByText(i18n.t('assets.uniform.returnEmpty'))).toBe(notice)
    expect(screen.getByRole('searchbox')).toBe(input)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByText(i18n.t('assets.uniform.returnEmpty'))).toBe(notice)
  })

  it('discards the previous employee quantities and conditions when the employee changes', async () => {
    const second = { ...ALI, employee_id: 'G3201', name_en: 'Second holder' }
    vi.mocked(api.listUniformRecipients).mockResolvedValue([ALI, second])
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('searchbox'), 'G31')
    await user.click(await screen.findByRole('button', { name: /Ali Hassan/ }))
    let polo = within(await screen.findByRole('group', { name: 'Polo shirt' }))
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    await user.click(polo.getByRole('radio', { name: 'Damaged' }))
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.type(await screen.findByRole('searchbox'), 'G32')
    await user.click(await screen.findByRole('button', { name: /Second holder/ }))
    polo = within(await screen.findByRole('group', { name: 'Polo shirt' }))
    expect(polo.getByRole('spinbutton')).toHaveValue(0)
    expect(polo.getByRole('radio', { name: 'Reusable' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: second.employee_id,
      lines: [{ item_id: 2, size_id: 21, qty: 1, condition: 'reusable' }],
    })))
  })

  it('explains why Save is disabled until a quantity is chosen', async () => {
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const save = await screen.findByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose the employee returning uniform.')
    await chooseAli()
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription('Choose at least one quantity to return.')
  })

  it('bounds each line between 0 and the held quantity, flooring typed values', async () => {
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const polo = within(screen.getByRole('group', { name: 'Polo shirt' }))
    const input = polo.getByRole('spinbutton')
    expect(input).toHaveValue(0)
    expect(polo.getByRole('button', { name: 'Decrease Polo shirt M' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(3)
    expect(polo.getByRole('button', { name: 'Increase Polo shirt M' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '1.8' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(1)
    fireEvent.change(input, { target: { value: '-4' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(0)
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    expect(input).toHaveValue(1)
  })

  it('sends the chosen condition per line, defaults to reusable, and omits size for suits', async () => {
    const onOpenChange = vi.fn()
    mount(<ReturnDialog open onOpenChange={onOpenChange} />)
    const user = await chooseAli()
    const suit = within(screen.getByRole('group', { name: 'Formal suit' }))
    const polo = within(screen.getByRole('group', { name: 'Polo shirt' }))
    expect(suit.queryByText('M')).not.toBeInTheDocument()
    expect(polo.getByRole('radio', { name: 'Reusable' })).toBeChecked()
    const marker = polo.getByRole('radio', { name: 'Reusable' }).closest('label')?.querySelector('[aria-hidden="true"]')
    expect(marker).toHaveTextContent('✓')
    expect(marker).toHaveClass('peer-checked:block')
    await user.click(suit.getByRole('button', { name: 'Increase Formal suit' }))
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    await user.click(polo.getByRole('radio', { name: 'Damaged' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalled())
    const body = vi.mocked(api.createUniformReturn).mock.calls[0][0]
    expect(body.employee_id).toBe('G3194')
    expect(body.lines).toEqual([
      { item_id: 1, qty: 1, condition: 'reusable' },
      { item_id: 2, size_id: 21, qty: 2, condition: 'damaged' },
    ])
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('commits a typed quantity on Enter without submitting or losing its condition', async () => {
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const polo = within(screen.getByRole('group', { name: 'Polo shirt' }))
    const input = polo.getByRole('spinbutton')
    await user.click(polo.getByRole('radio', { name: 'Damaged' }))
    await user.click(input)
    fireEvent.change(input, { target: { value: '2.9' } })
    await user.keyboard('{Enter}')
    expect(input).toHaveValue(2)
    expect(api.createUniformReturn).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: 2, size_id: 21, qty: 2, condition: 'damaged' }],
    })))
  })

  it('keeps the dialog open and shows the over-return error from the server', async () => {
    vi.mocked(api.createUniformReturn).mockRejectedValue(new ApiError(422, 'uniform_over_return', 'over'))
    const onOpenChange = vi.fn()
    mount(<ReturnDialog open onOpenChange={onOpenChange} />)
    const user = await chooseAli()
    await user.click(within(screen.getByRole('group', { name: 'Formal suit' })).getByRole('button', { name: 'Increase Formal suit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The return exceeds the quantity held by the employee.')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it.each(['items', 'employee'] as const)('keeps return controls mounted when the cached %s query fails and retries successfully', async dependency => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const suit = screen.getByRole('group', { name: 'Formal suit' })
    const polo = screen.getByRole('group', { name: 'Polo shirt' })
    const suitQty = within(suit).getByRole('spinbutton')
    const poloQty = within(polo).getByRole('spinbutton')
    const damaged = within(polo).getByRole('radio', { name: 'Damaged' })
    const employee = screen.getByText('Ali Hassan')
    fireEvent.change(suitQty, { target: { value: '1' } })
    fireEvent.change(poloQty, { target: { value: '2' } })
    await user.click(damaged)
    const queryKey = dependency === 'items' ? uniformKeys.items(true) : uniformKeys.employee(ALI.employee_id)
    if (dependency === 'items') vi.mocked(api.listUniformItems).mockRejectedValueOnce(new Error('offline'))
    else vi.mocked(api.getUniformEmployee).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await client.invalidateQueries({ queryKey }) })
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t(dependency === 'items' ? 'assets.uniform.refreshError' : 'assets.uniform.refreshRecordsError'))
    expect(client.getQueryState(queryKey)?.status).toBe('error')
    expect(client.getQueryData(queryKey)).toBeDefined()
    const expectDraft = (quantity: number) => {
      expect(screen.getByText('Ali Hassan')).toBe(employee)
      expect(screen.getByRole('group', { name: 'Formal suit' })).toBe(suit)
      expect(screen.getByRole('group', { name: 'Polo shirt' })).toBe(polo)
      expect(within(suit).getByRole('spinbutton')).toBe(suitQty)
      expect(within(polo).getByRole('spinbutton')).toBe(poloQty)
      expect(within(polo).getByRole('radio', { name: 'Damaged' })).toBe(damaged)
      expect(suitQty).toHaveValue(1)
      expect(poloQty).toHaveValue(quantity)
      expect(damaged).toBeChecked()
      expect(suitQty).toBeEnabled()
      expect(poloQty).toBeEnabled()
      expect(damaged).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    }
    expectDraft(2)
    await user.click(within(polo).getByRole('button', { name: 'Increase Polo shirt M' }))
    expectDraft(3)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(client.getQueryState(queryKey)?.status).toBe('success')
    expectDraft(3)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: ALI.employee_id,
      lines: [{ item_id: 1, qty: 1, condition: 'reusable' }, { item_id: 2, size_id: 21, qty: 3, condition: 'damaged' }],
    })))
  })

  it('keeps keyed return quantities and conditions while successful refreshes reorder and add live holdings', async () => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const suitQty = screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })
    const poloQty = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    const damaged = within(screen.getByRole('group', { name: 'Polo shirt' })).getByRole('radio', { name: 'Damaged' })
    fireEvent.change(suitQty, { target: { value: '1' } })
    fireEvent.change(poloQty, { target: { value: '2' } })
    await user.click(damaged)
    const belt: UniformItemRead = { ...POLO, id: 3, name_en: 'Belt', drawing: 'belt', sizes: [{ ...POLO.sizes[0], id: 31, item_id: 3, label: 'one' }] }
    vi.mocked(api.listUniformItems).mockResolvedValue([belt, POLO, SUIT])
    vi.mocked(api.getUniformEmployee).mockResolvedValue({ holdings: [
      { employee_id: ALI.employee_id, item_id: 3, size_id: 31, qty: 1 },
      { employee_id: ALI.employee_id, item_id: 2, size_id: 21, qty: 3 },
      { employee_id: ALI.employee_id, item_id: 1, size_id: null, qty: 2 },
    ], issues: [], returns: [] })
    await act(async () => { await client.invalidateQueries({ queryKey: ['uniform'] }) })
    await screen.findByRole('spinbutton', { name: 'Quantity of Belt One size' })
    expect(client.getQueryState(uniformKeys.employee(ALI.employee_id))?.status).toBe('success')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Belt One size' })).toHaveValue(0)
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })).toBe(suitQty)
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })).toBe(poloQty)
    expect(suitQty).toHaveValue(1)
    expect(poloQty).toHaveValue(2)
    expect(within(screen.getByRole('group', { name: 'Polo shirt' })).getByRole('radio', { name: 'Damaged' })).toBe(damaged)
    expect(damaged).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: 2, size_id: 21, qty: 2, condition: 'damaged' }, { item_id: 1, qty: 1, condition: 'reusable' }],
    })))
  })

  it.each(['decreased', 'removed'] as const)('preserves a requested return after holdings are %s until the user revises it', async change => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const suitQty = screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })
    const poloQty = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    const damaged = within(screen.getByRole('group', { name: 'Polo shirt' })).getByRole('radio', { name: 'Damaged' })
    fireEvent.change(suitQty, { target: { value: '1' } })
    fireEvent.change(poloQty, { target: { value: '3' } })
    fireEvent.blur(poloQty)
    await user.click(damaged)
    await user.click(poloQty)
    vi.mocked(api.getUniformEmployee).mockResolvedValue({ holdings: [
      { employee_id: ALI.employee_id, item_id: 1, size_id: null, qty: 2 },
      ...(change === 'decreased' ? [{ employee_id: ALI.employee_id, item_id: 2, size_id: 21, qty: 1 }] : []),
    ], issues: [], returns: [] })
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.employee(ALI.employee_id) }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(i18n.t('assets.uniform.selectionChanged')))
    expect(client.getQueryState(uniformKeys.employee(ALI.employee_id))?.status).toBe('success')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })).toBe(poloQty)
    expect(poloQty).toHaveFocus()
    expect(poloQty).toHaveValue(3)
    expect(damaged).toBeChecked()
    expect(poloQty).toHaveAccessibleDescription(i18n.t('assets.uniform.heldAvailable', { count: change === 'decreased' ? 1 : 0 }))
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(i18n.t('assets.uniform.selectionChanged'))
    await user.click(save)
    fireEvent.blur(poloQty)
    fireEvent.submit(save.closest('form')!)
    expect(poloQty).toHaveValue(3)
    expect(api.createUniformReturn).not.toHaveBeenCalled()
    fireEvent.change(poloQty, { target: { value: change === 'decreased' ? '1' : '0' } })
    fireEvent.blur(poloQty)
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { item_id: 1, qty: 1, condition: 'reusable' },
        ...(change === 'decreased' ? [{ item_id: 2, size_id: 21, qty: 1, condition: 'damaged' }] : []),
      ],
    })))
  })

  it('does not apply a refreshed held limit when committing a quantity edited before the refresh', async () => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const qty = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    await user.click(qty)
    fireEvent.change(qty, { target: { value: '3' } })
    vi.mocked(api.getUniformEmployee).mockResolvedValue({ holdings: [
      { employee_id: ALI.employee_id, item_id: 2, size_id: 21, qty: 1 },
    ], issues: [], returns: [] })
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.employee(ALI.employee_id) }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(i18n.t('assets.uniform.selectionChanged')))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.blur(qty)
    expect(qty).toHaveValue(3)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.createUniformReturn).not.toHaveBeenCalled()
  })

  it.each(['item removed', 'item archived', 'size removed', 'size archived'] as const)('retains an unavailable return line when its catalogue %s and never saves only the valid subset', async change => {
    const { client } = mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    const user = await chooseAli()
    const suitQty = screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })
    const poloQty = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })
    const damaged = within(screen.getByRole('group', { name: 'Polo shirt' })).getByRole('radio', { name: 'Damaged' })
    fireEvent.change(suitQty, { target: { value: '1' } })
    fireEvent.change(poloQty, { target: { value: '2' } })
    fireEvent.blur(poloQty)
    await user.click(damaged)
    const refreshedPolo = change === 'item archived' ? { ...POLO, archived_at: '2026-11-04T09:00:00' }
      : change === 'size removed' ? { ...POLO, sizes: [] }
      : { ...POLO, sizes: POLO.sizes.map(size => ({ ...size, archived_at: '2026-11-04T09:00:00' })) }
    vi.mocked(api.listUniformItems).mockResolvedValue(change === 'item removed' ? [SUIT] : [SUIT, refreshedPolo])
    await act(async () => { await client.invalidateQueries({ queryKey: uniformKeys.items(true) }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(i18n.t('assets.uniform.selectionChanged')))
    expect(client.getQueryState(uniformKeys.items(true))?.status).toBe('success')
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt M' })).toBe(poloQty)
    expect(poloQty).toHaveValue(2)
    expect(poloQty).toHaveAccessibleDescription(i18n.t('assets.uniform.lineUnavailable'))
    expect(damaged).toBeChecked()
    expect(suitQty).toHaveValue(1)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformReturn).not.toHaveBeenCalled()
    fireEvent.change(poloQty, { target: { value: '0' } })
    fireEvent.blur(poloQty)
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      lines: [{ item_id: 1, qty: 1, condition: 'reusable' }],
    })))
  })

  it.each(['items', 'employee'] as const)('blocks the initial %s failure until required data loads on Retry', async dependency => {
    if (dependency === 'items') vi.mocked(api.listUniformItems).mockRejectedValueOnce(new Error('offline'))
    else vi.mocked(api.getUniformEmployee).mockRejectedValueOnce(new Error('offline'))
    mount(<ReturnDialog open onOpenChange={vi.fn()} employee={{ id: ALI.employee_id, name_en: ALI.name_en, name_ar: ALI.name_ar }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.error'))
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('group', { name: 'Polo shirt' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription(i18n.t('assets.uniform.needReturnQty'))
  })

  it('renders nothing for read-only users', async () => {
    state.editable = false
    mount(<ReturnDialog open onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Returns tab', () => {
  it('requires a reason before voiding a return', async () => {
    const voided = vi.spyOn(api, 'voidUniformReturn').mockResolvedValue({ ...RECORD, voided_at: '2026-11-04T09:00:00', void_reason: 'Wrong person' })
    const user = userEvent.setup()
    mount(<UniformPage />, '/holdings/uniform?tab=returns&return=7')
    await user.click(await screen.findByRole('button', { name: 'Void record' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('A reason is required.')
    await user.type(dialog.getByRole('textbox'), '   ')
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    expect(voided).not.toHaveBeenCalled()
    await user.type(dialog.getByRole('textbox'), 'Wrong person')
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(voided).toHaveBeenCalledWith(7, { reason: 'Wrong person' }))
  })

  it('shows the void reason and hides Void on a voided return', async () => {
    vi.mocked(api.listUniformReturns).mockResolvedValue([{ ...RECORD, voided_at: '2026-11-02T09:00:00', void_reason: 'Duplicate' }])
    mount(<UniformPage />, '/holdings/uniform?tab=returns&return=7')
    expect(await screen.findByText('Duplicate')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void record' })).not.toBeInTheDocument()
  })

  it('returns focus to the selected card on Back', async () => {
    const user = userEvent.setup()
    mount(<UniformPage />, '/holdings/uniform?tab=returns&return=7')
    await user.click(await screen.findByRole('button', { name: 'Back to the list' }))
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-return-card', '7'))
  })
})
