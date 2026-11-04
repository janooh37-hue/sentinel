import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type UniformItemRead, type UniformReturnRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { UniformPage } from '../UniformPage'
import { ReturnDialog } from './ReturnDialog'

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
