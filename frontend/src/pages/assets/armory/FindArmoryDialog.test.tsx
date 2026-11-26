import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, ApiError, type ArmoryFindRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { FindArmoryDialog } from './FindArmoryDialog'
import { useArmoryFindShortcut } from './useArmoryFindShortcut'

const capabilities = vi.hoisted(() => ({ edit: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || (cap === 'armory.edit' && capabilities.edit), isLoading: false }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 1, email: 'armorer@example.test', employee_id: 'T-0001' }, status: 'authed' }),
}))

const SAFE = { id: 9, name_en: 'Test Safe A', name_ar: 'خزنة اختبار أ', vehicle_site: null, duty_post: null, created_at: '2025-02-04T08:00:00Z' }
const ITEM = { id: 12, name_en: 'Test Scanner', name_ar: 'ماسح اختباري', kind: 'serial', category: 'comms', drawing: 'radio' } as const
const PERSON = { employee_id: 'T-0002', name_en: 'Test Guard One', name_ar: 'حارس اختبار', employee_status: 'active', is_former: false }
const HOLDER = { kind: 'person', employee: PERSON, site_safe: null, supervisor: null } as const
const SERIAL: ArmoryFindRead['serials'][number] = {
  id: 43, item: ITEM, serial_code: 'TEST-R-001', safe: SAFE, state: 'signed_out', state_at: null,
  last_posting_id: 28, assignment_id: 28, holder: HOLDER, overdue_minutes: null,
}
const CUSTODY: ArmoryFindRead['custody'][number] = {
  id: 17, record_ref: 'TEST-C-017', kind: 'custody', state: 'active', safe: SAFE, holder: HOLDER,
  issuer: { user_id: 1, employee: null, display_name: 'Test Clerk' },
  issued_at: '2025-02-04T12:00:00Z', due_at: null, overdue_minutes: null, licence_warning_acknowledged: false, changed_kit: false, lines: [],
}
const EMPTY: ArmoryFindRead = { serials: [], guards: [], items: [], custody: [], postings: [] }
const RECENT: ArmoryFindRead = { ...EMPTY, serials: [SERIAL] }
const MATCHES: ArmoryFindRead = {
  ...RECENT, guards: [PERSON], items: [ITEM],
  custody: [CUSTODY, { ...CUSTODY, id: 28, record_ref: 'TEST-S-028', kind: 'shift', state: 'ended' }],
  postings: [{ id: 105, record_ref: 'TEST-P-105', kind: 'receipt', safe_id: 9, occurred_on: '2025-02-04', occurred_at: null, voided_at: null }],
}

function mount({ startsOpen = true, safeId = 9 }: { startsOpen?: boolean; safeId?: number | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onReturn = vi.fn()
  const onReceiveSerial = vi.fn()
  function Harness() {
    const [open, setOpen] = useState(startsOpen)
    const opener = useRef<HTMLButtonElement>(null)
    const { search } = useLocation()
    useArmoryFindShortcut(() => setOpen(true), !open)
    return <>
      <button ref={opener} onClick={() => setOpen(true)}>Open finder</button>
      <output aria-label="Current route">{search}</output>
      <FindArmoryDialog open={open} onOpenChange={setOpen} safeId={safeId}
        returnFocusRef={opener} onReturn={onReturn} onReceiveSerial={onReceiveSerial} />
    </>
  }
  render(<I18nextProvider i18n={i18n}><QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/holdings/armory?tab=audit&safe=9&pane=counts&count=10']}><Harness /></MemoryRouter>
  </QueryClientProvider></I18nextProvider>)
  return { user: userEvent.setup(), onReturn, onReceiveSerial }
}

beforeEach(async () => {
  capabilities.edit = false
  await i18n.changeLanguage('en')
})
afterEach(() => vi.restoreAllMocks())

describe('Find in Armory', () => {
  it('opens on a blank field and displays the active safe’s recent serials', async () => {
    const find = vi.spyOn(api, 'findArmoryRecords').mockResolvedValue(RECENT)
    const { user } = mount({ startsOpen: false })
    expect(find).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open finder' }))
    expect(screen.getByRole('dialog', { name: 'Find in Armory' })).toBeVisible()
    expect(screen.getByRole('searchbox')).toHaveFocus()
    const group = await screen.findByRole('region', { name: 'Recent serials' })
    expect(find).toHaveBeenCalledExactlyOnceWith({ recent_safe_id: 9 })
    expect(within(group).getByText('TEST-R-001')).toHaveAttribute('dir', 'ltr')
    expect(within(group).getByText('Signed out')).toBeVisible()
    expect(within(group).getByText('Test Safe A')).toBeVisible()
    expect(within(group).getByText('Test Guard One')).toBeVisible()
    expect(within(group).queryByRole('button', { name: 'Return' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open finder' })).toHaveFocus())
    await user.keyboard('/')
    expect(screen.getByRole('searchbox')).toHaveValue('')
  })

  it('debounces and trims a search without sending the safe, then traverses result groups with the keyboard', async () => {
    const find = vi.spyOn(api, 'findArmoryRecords').mockResolvedValueOnce(RECENT).mockResolvedValue(MATCHES)
    const { user } = mount()
    await screen.findByRole('region', { name: 'Recent serials' })
    const field = screen.getByRole('searchbox')
    await user.type(field, '  Test  ')
    const serial = await screen.findByRole('button', { name: /TEST-R-001/ })
    const person = screen.getByRole('button', { name: /T-0002/ })
    const item = within(screen.getByRole('region', { name: 'Items' })).getByRole('button', { name: /Test Scanner/ })
    const custody = screen.getByRole('button', { name: /TEST-C-017/ })
    const movement = screen.getByRole('button', { name: /TEST-P-105/ })
    expect(find.mock.calls).toEqual([[{ recent_safe_id: 9 }], [{ q: 'Test' }]])
    expect(screen.queryByRole('region', { name: 'Recent serials' })).not.toBeInTheDocument()
    expect(screen.getByText('Stock received')).toBeVisible()

    await user.keyboard('{ArrowDown}')
    expect(serial).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(person).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(item).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(custody).toHaveFocus()
    await user.keyboard('{End}')
    expect(movement).toHaveFocus()
    await user.keyboard('{Home}')
    expect(serial).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(field).toHaveFocus()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByLabelText('Current route')).toHaveTextContent('?tab=items&safe=9&item=12&serial=43')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each([
    [/T-0002/, { tab: 'guards', safe: '9', guard: 'T-0002' }],
    [/Open item/, { tab: 'items', safe: '9', item: '12' }],
    [/TEST-C-017/, { tab: 'custody', safe: '9', custody: '17' }],
    [/TEST-S-028/, { tab: 'shift', safe: '9', issue: '28' }],
    [/TEST-P-105/, { tab: 'audit', safe: '9', pane: 'movements', movement: '105' }],
  ])('opens the matching detail for %s without stale detail params', async (name, expected) => {
    vi.spyOn(api, 'findArmoryRecords').mockResolvedValueOnce(EMPTY).mockResolvedValue(MATCHES)
    const { user } = mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Test' } })
    await user.click(await screen.findByRole('button', { name }))
    expect(Object.fromEntries(new URLSearchParams(screen.getByLabelText('Current route').textContent ?? ''))).toEqual(expected)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gates Return to editors and active assignments and opens the selected return task', async () => {
    capabilities.edit = true
    vi.spyOn(api, 'findArmoryRecords').mockResolvedValueOnce(EMPTY).mockResolvedValue(MATCHES)
    const { user, onReturn } = mount()
    await user.type(screen.getByRole('searchbox'), 'Test')
    const custodyResults = await screen.findByRole('region', { name: 'Custody' })
    expect(within(custodyResults).getAllByRole('button', { name: 'Return' })).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Serials' })).getByRole('button', { name: 'Return' })).toBeVisible()
    await user.click(within(custodyResults).getByRole('button', { name: 'Return' }))
    expect(onReturn).toHaveBeenCalledExactlyOnceWith(17, 'custody')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('isolates unmatched queries and does not offer Receive to a viewer', async () => {
    vi.spyOn(api, 'findArmoryRecords').mockResolvedValue(EMPTY)
    const { user } = mount()
    await user.type(screen.getByRole('searchbox'), 'test-z-09')
    const query = await screen.findByText('test-z-09')
    expect(query.tagName).toBe('BDI')
    expect(query.parentElement).toHaveTextContent('No records match test-z-09.')
    expect(screen.queryByRole('button', { name: 'Receive an unregistered serial' })).not.toBeInTheDocument()
  })

  it('localizes the result labels and keeps mixed Arabic search text isolated', async () => {
    await i18n.changeLanguage('ar')
    vi.spyOn(api, 'findArmoryRecords').mockResolvedValueOnce(RECENT).mockResolvedValue(EMPTY)
    mount()
    const recent = await screen.findByRole('region', { name: 'أرقام تسلسلية حديثة' })
    expect(within(recent).getByText('TEST-R-001')).toHaveAttribute('dir', 'ltr')
    expect(within(recent).getByText('ماسح اختباري').tagName).toBe('BDI')
    expect(within(recent).getByText('خزنة اختبار أ')).toBeVisible()
    const mixedQuery = 'اختبار T-09'
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: mixedQuery } })
    const query = await screen.findByText(mixedQuery)
    expect(query.tagName).toBe('BDI')
    expect(query.parentElement).toHaveTextContent('لا توجد سجلات تطابق «اختبار T-09».')
  })

  it('offers Receive to an editor only for an unknown, valid code and passes the normalized code', async () => {
    capabilities.edit = true
    const find = vi.spyOn(api, 'findArmoryRecords').mockResolvedValue(EMPTY)
    const { user, onReceiveSerial } = mount()
    const field = screen.getByRole('searchbox')
    await user.type(field, 'Test unmatched name')
    await screen.findByText('Test unmatched name')
    expect(screen.queryByRole('button', { name: 'Receive an unregistered serial' })).not.toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'tst-٠۹')
    const receive = await screen.findByRole('button', { name: 'Receive an unregistered serial' })
    expect(find).toHaveBeenLastCalledWith({ q: 'tst-٠۹' })
    expect(onReceiveSerial).not.toHaveBeenCalled()
    await user.click(receive)
    expect(onReceiveSerial).toHaveBeenCalledExactlyOnceWith('TST-09')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('clears the field with the in-field button, refocuses it and restores scoped recents', async () => {
    vi.spyOn(api, 'findArmoryRecords').mockImplementation(async filters => filters?.q ? EMPTY : RECENT)
    const { user } = mount()
    const field = screen.getByRole('searchbox')
    await screen.findByRole('region', { name: 'Recent serials' })
    await user.type(field, 'test-900')
    await screen.findByText('test-900')
    await user.click(screen.getByRole('button', { name: 'Clear search filter' }))
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Clear search filter' })).not.toBeInTheDocument()
    expect(await screen.findByRole('region', { name: 'Recent serials' })).toBeVisible()
  })

  it('sends a bounded query and omits scope for recents with All safes selected', async () => {
    const find = vi.spyOn(api, 'findArmoryRecords').mockResolvedValue(EMPTY)
    mount({ safeId: null })
    const field = screen.getByRole('searchbox')
    expect(field).toHaveAttribute('maxlength', '120')
    await waitFor(() => expect(find).toHaveBeenCalledExactlyOnceWith({}))
    fireEvent.change(field, { target: { value: `  ${'x'.repeat(140)}  ` } })
    await waitFor(() => expect(find).toHaveBeenLastCalledWith({ q: 'x'.repeat(120) }))
  })

  it('shows a localized load error instead of results or Receive and retries the read', async () => {
    const find = vi.spyOn(api, 'findArmoryRecords').mockRejectedValueOnce(new ApiError(403, 'HTTP_403', 'Test server detail')).mockResolvedValueOnce(RECENT)
    const { user } = mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this armory section.')
    expect(screen.queryByText('Test server detail')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recent serials' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('region', { name: 'Recent serials' })).toBeVisible()
    expect(find).toHaveBeenCalledTimes(2)
  })
})

describe('slash shortcut', () => {
  it('prevents default and opens only without an editable target, modifiers or another dialog', () => {
    const onOpen = vi.fn()
    function Harness({ enabled, dialogOpen }: { enabled: boolean; dialogOpen?: boolean }) {
      useArmoryFindShortcut(onOpen, enabled)
      return <>
        <button>Shortcut target</button>
        <input aria-label="Input" />
        <textarea aria-label="Textarea" />
        <select aria-label="Select" />
        <div contentEditable="plaintext-only"><span>Editor text</span></div>
        {dialogOpen && <div role="dialog" aria-label="Another dialog" />}
      </>
    }
    const { rerender } = render(<Harness enabled />)
    for (const target of [screen.getByLabelText('Input'), screen.getByLabelText('Textarea'), screen.getByLabelText('Select'), screen.getByText('Editor text')]) {
      expect(fireEvent.keyDown(target, { key: '/' })).toBe(true)
    }
    const target = screen.getByRole('button', { name: 'Shortcut target' })
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(fireEvent.keyDown(target, { key: '/', [modifier]: true })).toBe(true)
    }
    rerender(<Harness enabled dialogOpen />)
    expect(fireEvent.keyDown(target, { key: '/' })).toBe(true)
    rerender(<Harness enabled={false} />)
    expect(fireEvent.keyDown(target, { key: '/' })).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    rerender(<Harness enabled />)
    expect(fireEvent.keyDown(target, { key: '/' })).toBe(false)
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
