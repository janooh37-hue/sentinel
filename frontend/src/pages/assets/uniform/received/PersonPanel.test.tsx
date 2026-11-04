import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type UniformEmployeeRead, type UniformIssueRead, type UniformItemRead, type UniformRecipient, type UniformReturnRead } from '@/lib/api'
import i18n from '@/lib/i18n'
import { ReceivedTab } from './ReceivedTab'
import { ReturnsTab } from '../returns/ReturnsTab'

const state = vi.hoisted(() => ({ editable: true }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap !== 'uniform.edit' || state.editable }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { name_en: 'Current keeper', name_ar: 'أمين المخزن الحالي', email: 'keeper@example.test' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const SUIT: UniformItemRead = {
  id: 1, name_en: 'Formal suit', name_ar: 'بدلة رسمية', description_en: '', description_ar: '',
  group_key: 'formal', drawing: 'suit', tracking: 'holder', default_qty: 1, sort_order: 0,
  archived_at: null, version: '1', sizes: [], holders: [],
}
const POLO: UniformItemRead = {
  ...SUIT, id: 2, name_en: 'Polo shirt', name_ar: 'قميص بولو', group_key: 'guard', drawing: 'polo', tracking: 'shelf',
  sizes: [{ id: 21, item_id: 2, label: 'M', on_hand: 8, min_qty: null, is_low: false, held_qty: 1, archived_at: null, sort_order: 0 }],
}
const ALI: UniformRecipient = { employee_id: 'G3194', name_en: 'Ali Hassan', name_ar: 'علي حسن', held_total: 3, issued_total: 5, last_issued_on: '2026-10-01' }
const OMAR: UniformRecipient = { employee_id: 'G3200', name_en: 'Omar Returned', name_ar: null, held_total: 0, issued_total: 2, last_issued_on: '2026-09-01' }
const ISSUE: UniformIssueRead = {
  id: 41, created_at: '2026-10-01T08:00:00', created_by_id: 11, voided_at: null, voided_by_id: null, void_reason: null,
  employee_id: 'G3194', issued_on: '2026-10-01', note: 'Initial hand-out',
  given_by_name_en: 'Noor Keeper', given_by_name_ar: 'نور أمين',
  lines: [{ item_id: 1, qty: 2 }, { item_id: 2, size_id: 21, qty: 3 }],
}
const VOID_ISSUE: UniformIssueRead = {
  ...ISSUE, id: 42, issued_on: '2026-10-02', note: 'Misfiled hand-out',
  given_by_name_en: null, given_by_name_ar: null,
  voided_at: '2026-10-02T09:00:00', voided_by_id: 11, void_reason: 'Wrong employee on hand-out',
  lines: [{ item_id: 1, qty: 4 }, { item_id: 2, size_id: 21, qty: 6 }],
}
const REUSABLE_RETURN: UniformReturnRead = {
  id: 51, created_at: '2026-10-03T08:00:00', created_by_id: 12, voided_at: null, voided_by_id: null, void_reason: null,
  employee_id: 'G3194', returned_on: '2026-10-03', note: 'Reusable polo returned',
  received_by_name_en: 'Sara Receiver', received_by_name_ar: 'سارة المستلمة',
  lines: [{ item_id: 2, size_id: 21, qty: 1, condition: 'reusable' }],
}
const DAMAGED_RETURN: UniformReturnRead = {
  ...REUSABLE_RETURN, id: 52, returned_on: '2026-10-04', note: 'Damaged polo returned',
  received_by_name_en: 'English-only receiver', received_by_name_ar: null,
  lines: [{ item_id: 2, size_id: 21, qty: 1, condition: 'damaged' }],
}
const VOID_RETURN: UniformReturnRead = {
  ...REUSABLE_RETURN, id: 53, returned_on: '2026-10-05', note: 'Mistaken suit return',
  received_by_name_en: null, received_by_name_ar: null,
  voided_at: '2026-10-05T09:00:00', voided_by_id: 12, void_reason: 'Duplicate return entry',
  lines: [{ item_id: 1, qty: 1, condition: 'reusable' }],
}
// Five genuinely issued pieces, minus one reusable and one damaged polo. Neither voided posting affects holdings.
const ALI_RECORDS: UniformEmployeeRead = {
  holdings: [{ employee_id: 'G3194', item_id: 1, size_id: null, qty: 2 }, { employee_id: 'G3194', item_id: 2, size_id: 21, qty: 1 }],
  issues: [ISSUE, VOID_ISSUE], returns: [REUSABLE_RETURN, DAMAGED_RETURN, VOID_RETURN],
}
const OMAR_RECORDS: UniformEmployeeRead = {
  holdings: [],
  issues: [{ ...ISSUE, id: 61, employee_id: 'G3200', issued_on: '2026-09-01', note: 'Historical suit hand-out', lines: [{ item_id: 1, qty: 2 }] }],
  returns: [{ ...REUSABLE_RETURN, id: 62, employee_id: 'G3200', returned_on: '2026-09-02', note: 'All suits returned', lines: [{ item_id: 1, qty: 2, condition: 'reusable' }] }],
}

function LocationObserver() {
  return <output data-testid="location">{useLocation().search}</output>
}
function mount(entry = '/holdings/uniform?tab=received', surface: 'received' | 'returns' = 'received') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter initialEntries={[entry]}>
    {surface === 'returns' ? <ReturnsTab /> : <ReceivedTab />}<LocationObserver />
  </MemoryRouter></I18nextProvider></QueryClientProvider>)
}
async function openAli(user = userEvent.setup()) {
  const card = await screen.findByRole('button', { name: /Ali Hassan/ })
  await user.click(card)
  const panel = await screen.findByRole('region', { name: 'Ali Hassan' })
  await within(panel).findByRole('region', { name: 'Currently holds' })
  return panel
}
function historyRow(panel: HTMLElement, text: string) {
  const row = within(panel).getByText(text).closest('li')
  if (!row) throw new Error(`History entry is not a list item: ${text}`)
  return within(row)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  state.editable = true
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listUniformItems').mockResolvedValue([SUIT, POLO])
  vi.spyOn(api, 'listUniformRecipients').mockImplementation(async (query = '') => {
    const needle = query.trim().toLowerCase()
    return [ALI, OMAR].filter(person => [person.employee_id, person.name_en, person.name_ar ?? ''].some(value => value.toLowerCase().includes(needle)))
  })
  vi.spyOn(api, 'getUniformEmployee').mockImplementation(async employeeId => employeeId === 'G3200' ? OMAR_RECORDS : ALI_RECORDS)
  vi.spyOn(api, 'lookupEmployees').mockResolvedValue({ items: [], total: 0, limit: 8, offset: 0 })
  vi.spyOn(api, 'createUniformIssue').mockResolvedValue({ ...ISSUE, id: 70 })
  vi.spyOn(api, 'createUniformReturn').mockResolvedValue({ ...REUSABLE_RETURN, id: 71 })
  vi.spyOn(api, 'voidUniformIssue').mockResolvedValue({ ...ISSUE, voided_at: '2026-11-04T08:00:00', voided_by_id: 11, void_reason: 'Wrong employee' })
  vi.spyOn(api, 'listUniformReturns').mockResolvedValue([REUSABLE_RETURN, DAMAGED_RETURN, VOID_RETURN, ...OMAR_RECORDS.returns])
  vi.spyOn(api, 'voidUniformReturn').mockResolvedValue({ ...REUSABLE_RETURN, voided_at: '2026-11-04T08:00:00', voided_by_id: 11, void_reason: 'Duplicate return' })
})

describe('Received person panel', () => {
  it('leads with three currently held pieces, not five lifetime pieces, after damaged, reusable and voided postings', async () => {
    mount()
    const card = await screen.findByRole('button', { name: /Ali Hassan/ })
    expect(card).toHaveAttribute('data-person-card', 'G3194')
    expect(card).toHaveAccessibleName(/G3194/)
    expect(card).toHaveAccessibleName(/3 pieces held/)
    expect(card).not.toHaveAccessibleName(/5 pieces held/)

    const panel = await openAli()
    const held = within(panel).getByRole('region', { name: 'Currently holds' })
    await within(held).findByText('Formal suit')
    const rows = within(held).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.textContent?.includes('Formal suit'))).toHaveTextContent('× 2')
    const polo = rows.find(row => row.textContent?.includes('Polo shirt'))
    expect(polo).toHaveTextContent('× 1')
    expect(polo).toHaveTextContent('M')
    expect(held).not.toHaveTextContent('× 3')
    expect(held).not.toHaveTextContent('× 6')

    const issueHistory = within(panel).getByRole('heading', { name: 'Hand-out history' })
    const returnHistory = within(panel).getByRole('heading', { name: 'Return history' })
    expect(held.compareDocumentPosition(issueHistory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(issueHistory.compareDocumentPosition(returnHistory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('retains active and voided hand-out and return history with conditions and void reasons', async () => {
    mount()
    const panel = await openAli()
    await within(panel).findByText('Initial hand-out')
    expect(historyRow(panel, 'Initial hand-out').getByRole('button', { name: 'Void record' })).toBeEnabled()
    const voidIssue = historyRow(panel, 'Wrong employee on hand-out')
    expect(voidIssue.getByText('Voided')).toBeInTheDocument()
    expect(voidIssue.queryByRole('button', { name: 'Void record' })).not.toBeInTheDocument()
    expect(historyRow(panel, 'Reusable polo returned').getByText('Reusable')).toBeInTheDocument()
    expect(historyRow(panel, 'Reusable polo returned').getByRole('button', { name: 'Void record' })).toBeEnabled()
    expect(historyRow(panel, 'Damaged polo returned').getByText('Damaged')).toBeInTheDocument()
    const voidReturn = historyRow(panel, 'Duplicate return entry')
    expect(voidReturn.getByText('Voided')).toBeInTheDocument()
    expect(voidReturn.queryByRole('button', { name: 'Void record' })).not.toBeInTheDocument()
  })

  it('opens the real Hand out dialog with this person selected and submits their employee ID', async () => {
    const user = userEvent.setup()
    mount()
    const panel = await openAli(user)
    await user.click(within(panel).getByRole('button', { name: 'Hand out uniform' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Ali Hassan')).toBeInTheDocument()
    expect(dialog.getByText('G3194')).toBeInTheDocument()
    expect(dialog.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Hand out' })).toBeDisabled()
    await user.click(dialog.getByRole('radio', { name: 'Give' }))
    await user.click(dialog.getByRole('button', { name: 'Hand out' }))
    await waitFor(() => expect(api.createUniformIssue).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: 'G3194', lines: [{ item_id: 1, qty: 1 }],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens the real Record return dialog preselected and submits a damaged polo for that employee', async () => {
    const user = userEvent.setup()
    mount()
    const panel = await openAli(user)
    await user.click(within(panel).getByRole('button', { name: 'Record return' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('Ali Hassan')).toBeInTheDocument()
    expect(dialog.getByText('G3194')).toBeInTheDocument()
    expect(dialog.queryByRole('searchbox')).not.toBeInTheDocument()
    const polo = within(await dialog.findByRole('group', { name: 'Polo shirt' }))
    expect(polo.getByRole('spinbutton')).toHaveAttribute('max', '1')
    await user.click(polo.getByRole('button', { name: 'Increase Polo shirt M' }))
    await user.click(polo.getByRole('radio', { name: 'Damaged' }))
    await user.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.createUniformReturn).toHaveBeenCalledWith(expect.objectContaining({
      employee_id: 'G3194', lines: [{ item_id: 2, size_id: 21, qty: 1, condition: 'damaged' }],
    })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('rejects empty and whitespace void reasons and sends the trimmed reason for the chosen hand-out', async () => {
    const user = userEvent.setup()
    mount()
    const panel = await openAli(user)
    await within(panel).findByText('Initial hand-out')
    await user.click(historyRow(panel, 'Initial hand-out').getByRole('button', { name: 'Void record' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('A reason is required.')
    expect(api.voidUniformIssue).not.toHaveBeenCalled()
    const reason = dialog.getByRole('textbox', { name: /Reason for voiding/ })
    await user.type(reason, '   ')
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    expect(dialog.getByRole('alert')).toHaveTextContent('A reason is required.')
    expect(api.voidUniformIssue).not.toHaveBeenCalled()
    await user.clear(reason)
    await user.type(reason, '  Wrong employee  ')
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(api.voidUniformIssue).toHaveBeenCalledWith(41, { reason: 'Wrong employee' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it.each(['Initial hand-out', 'Reusable polo returned'])('restores focus to the exact void opener on cancelling %s', async note => {
    const user = userEvent.setup()
    mount()
    const panel = await openAli(user)
    const opener = historyRow(panel, note).getByRole('button', { name: 'Void record' })
    await user.click(opener)
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('voids an active return from the person panel using the return endpoint', async () => {
    const user = userEvent.setup()
    mount()
    const panel = await openAli(user)
    await user.click(historyRow(panel, 'Reusable polo returned').getByRole('button', { name: 'Void record' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: /Reason for voiding/ }), '  Duplicate return  ')
    await user.click(dialog.getByRole('button', { name: 'Void record' }))
    await waitFor(() => expect(api.voidUniformReturn).toHaveBeenCalledWith(51, { reason: 'Duplicate return' }))
    expect(api.voidUniformIssue).not.toHaveBeenCalled()
  })

  it.each(['Omar Returned', 'G3200'])('keeps zero-held historical recipients searchable by %s without allowing a return', async query => {
    const user = userEvent.setup()
    mount()
    await screen.findByRole('button', { name: /Ali Hassan/ })
    await user.type(screen.getByRole('searchbox', { name: 'Search received' }), query)
    const card = await screen.findByRole('button', { name: /Omar Returned/ })
    expect(card).toHaveAccessibleName(/G3200/)
    expect(card).toHaveAccessibleName(/0 pieces held/)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ali Hassan/ })).not.toBeInTheDocument())
    await user.click(card)
    const panel = await screen.findByRole('region', { name: 'Omar Returned' })
    expect(await within(panel).findByText('No uniform currently held.')).toBeInTheDocument()
    expect(within(panel).getByText('Historical suit hand-out')).toBeInTheDocument()
    expect(within(panel).getByText('All suits returned')).toBeInTheDocument()
    const recordReturn = within(panel).queryByRole('button', { name: 'Record return' })
    if (recordReturn) expect(recordReturn).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Hand out uniform' })).toBeEnabled()
    expect(api.createUniformReturn).not.toHaveBeenCalled()
  })

  it('uses one phone region, focuses the opened detail and restores the selected card on Back without losing other URL state', async () => {
    const user = userEvent.setup()
    mount('/holdings/uniform?tab=received&keep=1')
    const card = await screen.findByRole('button', { name: /Ali Hassan/ })
    const listRegion = card.closest('section')
    expect(listRegion).not.toHaveClass('max-[999px]:hidden')
    await user.click(card)
    const panel = await screen.findByRole('region', { name: 'Ali Hassan' })
    const heading = within(panel).getByRole('heading', { name: 'Ali Hassan' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(listRegion).toHaveClass('max-[999px]:hidden')
    expect(panel).not.toHaveClass('max-[999px]:hidden')
    expect(new URLSearchParams(screen.getByTestId('location').textContent ?? '').get('person')).toBe('G3194')
    const back = within(panel).getByRole('button', { name: 'Back to the list' })
    expect(back).toHaveClass('min-[1000px]:hidden')
    await user.click(back)
    await waitFor(() => expect(card).toHaveFocus())
    expect(document.activeElement).toHaveAttribute('data-person-card', 'G3194')
    const params = new URLSearchParams(screen.getByTestId('location').textContent ?? '')
    expect(params.has('person')).toBe(false)
    expect(params.get('tab')).toBe('received')
    expect(params.get('keep')).toBe('1')
    expect(listRegion).not.toHaveClass('max-[999px]:hidden')
    expect(panel).toHaveClass('max-[999px]:hidden')
  })

  it.each([
    ['en', 'Ali Hassan', 'Noor Keeper', 'Sara Receiver', 'unknown user'],
    ['ar', 'علي حسن', 'نور أمين', 'سارة المستلمة', 'الاسم غير متاح'],
  ])('renders stored actor names and a localized unknown actor in %s, rather than the current keeper', async (language, personName, giver, receiver, unknown) => {
    await i18n.changeLanguage(language)
    mount('/holdings/uniform?tab=received&person=G3194')
    const panel = await screen.findByRole('region', { name: personName })
    await waitFor(() => expect(panel).toHaveTextContent(giver))
    expect(panel).toHaveTextContent(receiver)
    expect(panel).toHaveTextContent('English-only receiver')
    expect(within(panel).getAllByText(new RegExp(unknown))).toHaveLength(2)
    expect(panel).not.toHaveTextContent('Current keeper')
    expect(panel).not.toHaveTextContent('أمين المخزن الحالي')
    if (language === 'ar') {
      expect(panel).not.toHaveTextContent('Noor Keeper')
      expect(panel).not.toHaveTextContent('Sara Receiver')
    }
  })

  it('keeps holdings and audit history visible to a read-only user while hiding every mutation', async () => {
    state.editable = false
    mount()
    const panel = await openAli()
    expect(await within(panel).findByText('Initial hand-out')).toBeInTheDocument()
    expect(within(panel).getByRole('region', { name: 'Currently holds' })).toHaveTextContent('Formal suit')
    expect(within(panel).getByRole('heading', { name: 'Return history' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: /Hand out|Record return|Void record/ })).not.toBeInTheDocument()
  })
})

describe('Uniform returns list', () => {
  it.each([
    ['en', 'علي', 'Ali Hassan', 'Search returns'],
    ['ar', 'Ali Hassan', 'علي حسن', 'البحث في المرتجعات'],
    ['en', 'G3194', 'Ali Hassan', 'Search returns'],
  ])('matches both language names and employee ID in %s when searching %s', async (language, query, displayName, searchLabel) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    mount('/holdings/uniform?tab=returns', 'returns')
    await screen.findAllByRole('button', { name: new RegExp(displayName) })
    await user.type(screen.getByRole('searchbox', { name: searchLabel }), query)
    await waitFor(() => expect(screen.getAllByRole('button', { name: new RegExp(displayName) })).toHaveLength(3))
    expect(screen.queryByRole('button', { name: /Omar Returned/ })).not.toBeInTheDocument()
  })

  it('restores focus to the return-detail void opener after cancellation', async () => {
    const user = userEvent.setup()
    mount('/holdings/uniform?tab=returns&return=51', 'returns')
    const opener = await screen.findByRole('button', { name: 'Void record' })
    await user.click(opener)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
