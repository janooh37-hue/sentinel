import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type UniformItemRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { HandOutDialog } from './HandOutDialog'
import { uniformKeys } from './uniformQueries'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { name_en: 'Keeper', email: 'keeper@example.test' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }))

const EMPLOYEE = { id: 'G3194', name_en: 'Ali Hassan', name_ar: 'علي حسن' }
const SUIT: UniformItemRead = {
  id: 1, name_en: 'Formal suit', name_ar: 'بدلة رسمية', description_en: '', description_ar: '',
  group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 2, sort_order: 0,
  archived_at: null, version: '1', sizes: [], holders: [],
}
const POLO: UniformItemRead = {
  ...SUIT, id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', group_key: 'guard', drawing: 'polo', tracking: 'shelf',
  sizes: [{ id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 0, archived_at: null, sort_order: 0 }],
}

function mount(itemId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
    <HandOutDialog open employee={EMPLOYEE} itemId={itemId} onOpenChange={vi.fn()} />
  </I18nextProvider></QueryClientProvider>)
  return client
}

async function refresh(client: QueryClient, items: UniformItemRead[]) {
  vi.mocked(api.listUniformItems).mockResolvedValue(items)
  await act(async () => { await client.refetchQueries({ queryKey: uniformKeys.items(), exact: true }) })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([SUIT, POLO])
  vi.spyOn(api, 'createUniformIssue').mockResolvedValue({
    id: 1, employee_id: EMPLOYEE.id, issued_on: '2026-11-04', note: null,
    created_at: '2026-11-04T08:00:00Z', created_by_id: 1, voided_at: null, voided_by_id: null, void_reason: null, lines: [],
  })
})

describe('Hand-out requested-line identity', () => {
  it('does not lower a requested quantity after stock drops, including untouched focus, blur and submit', async () => {
    const client = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'M 8 left' }))
    await user.click(screen.getByRole('radio', { name: 'Give' }))
    const input = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    fireEvent.focus(input)
    await refresh(client, [SUIT, { ...POLO, sizes: [{ ...POLO.sizes[0], on_hand: 2 }] }])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled())
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })).toBe(input)
    expect(input).toHaveValue(5)
    expect(screen.getByRole('button', { name: 'Hand out' })).toHaveAccessibleDescription(i18n.t('assets.uniform.selectionChanged'))
    fireEvent.blur(input)
    expect(input).toHaveValue(5)
    const save = screen.getByRole('button', { name: 'Hand out' })
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformIssue).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input)
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: EMPLOYEE.id, lines: [{ item_id: 1, qty: 2 }, { item_id: 2, size_id: 21, qty: 2 }],
    })))
  })

  it('normalizes an edited value against the bound at the edit, not a later refreshed bound', async () => {
    const client = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'M 8 left' }))
    const input = screen.getByRole('spinbutton', { name: 'Quantity of Polo shirt' })
    fireEvent.change(input, { target: { value: '5' } })
    await refresh(client, [SUIT, { ...POLO, sizes: [{ ...POLO.sizes[0], on_hand: 2 }] }])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled())
    fireEvent.blur(input)
    expect(input).toHaveValue(5)
    expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled()
    expect(api.createUniformIssue).not.toHaveBeenCalled()
  })

  it.each(['exhausted', 'size removed', 'size archived', 'item removed', 'item archived'] as const)('keeps an %s line visible and blocks subset submission until it is explicitly cleared', async change => {
    const client = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'M 8 left' }))
    await user.click(screen.getByRole('radio', { name: 'Give' }))
    const group = screen.getByRole('group', { name: 'Polo shirt' })
    const input = within(group).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    const changed = change === 'item removed' ? [SUIT] : [SUIT, {
      ...POLO,
      archived_at: change === 'item archived' ? '2026-11-04T08:00:00Z' : null,
      sizes: change === 'size removed' ? [] : [{
        ...POLO.sizes[0], on_hand: change === 'exhausted' ? 0 : 8,
        archived_at: change === 'size archived' ? '2026-11-04T08:00:00Z' : null,
      }],
    }]
    await refresh(client, changed)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled())
    expect(screen.getByRole('group', { name: 'Polo shirt' })).toBe(group)
    expect(within(group).getByRole('spinbutton')).toBe(input)
    expect(input).toHaveValue(3)
    const save = screen.getByRole('button', { name: 'Hand out' })
    expect(save).toBeDisabled()
    fireEvent.submit(save.closest('form')!)
    expect(api.createUniformIssue).not.toHaveBeenCalled()
    await user.click(within(group).getByRole('radio', { name: 'None' }))
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 1, qty: 2 }] })))
  })

  it('keeps selected item identity across metadata reordering while offering new sizes and items', async () => {
    const client = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'M 8 left' }))
    const group = screen.getByRole('group', { name: 'Polo shirt' })
    const input = within(group).getByRole('spinbutton')
    fireEvent.change(input, { target: { value: '3' } })
    fireEvent.blur(input)
    const renamed: UniformItemRead = { ...POLO, name_en: 'Renamed shirt', group_key: 'winter', sizes: [
      { ...POLO.sizes[0], id: 24, label: 'XS', on_hand: 9 }, POLO.sizes[0],
    ] }
    const belt: UniformItemRead = { ...POLO, id: 3, drawing: 'belt', name_en: 'Belt', sizes: [{ ...POLO.sizes[0], id: 31, item_id: 3, label: 'one', on_hand: 9 }] }
    await refresh(client, [belt, renamed, SUIT])
    await screen.findByRole('group', { name: 'Belt' })
    expect(screen.getByRole('group', { name: 'Polo shirt' })).toBe(group)
    expect(within(group).getByRole('spinbutton')).toBe(input)
    expect(input).toHaveValue(3)
    expect(screen.getByRole('group', { name: 'Belt' })).toBeInTheDocument()
    await user.click(within(group).getByRole('radio', { name: 'XS 9 left' }))
    await user.click(screen.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 2, size_id: 24, qty: 3 }] })))
  })

  it('retains a preselected holder shortcut if its item disappears', async () => {
    const client = mount(SUIT.id)
    const input = await screen.findByRole('spinbutton', { name: 'Quantity of Formal suit' })
    await refresh(client, [POLO])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled())
    expect(screen.getByRole('spinbutton', { name: 'Quantity of Formal suit' })).toBe(input)
    expect(input).toHaveValue(2)
    expect(screen.getByRole('button', { name: 'Hand out' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('assets.uniform.lineUnavailable'))
  })
})
