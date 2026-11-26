import { setTimeout as delay } from 'node:timers/promises'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RequireCapability } from '@/components/shell/RequireCapability'
import { api, ApiError, type ArmoryItemDetailRead } from '@/lib/api'
import { ARMORY_VIEW_CAP } from '@/lib/armory'
import i18n from '@/lib/i18n'
import { ArmoryPage } from './ArmoryPage'
import { armoryKeys } from './armoryQueries'
import { candidates, firearm, issue, otherSafe, renderArmory, returnPosting, testDraft, testSafe, testShift } from './shift/shiftFixtures'

const access = vi.hoisted(() => ({ principal: 1, view: true, edit: false }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (cap: string) => (cap === 'armory.view' && access.view) || (cap === 'armory.edit' && access.edit),
    isLoading: false,
  }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({
    user: { id: access.principal, email: 'armorer@example.test', employee_id: `T-000${access.principal}` },
    status: 'authed',
  }),
}))

// Test the Records-to-shell seam without stubbing Ops dialogs or query hooks.
vi.mock('./records/CustodyPane', () => ({
  CustodyPane: ({ safeId, onOpenHandover, onOpenReturn }: {
    safeId: number | null
    onOpenHandover(opener: HTMLElement): void
    onOpenReturn(id: number, opener: HTMLElement): void
  }) => (
    <div>
      <p>Custody scope {safeId ?? 'all'}</p>
      <button type="button" onClick={event => onOpenHandover(event.currentTarget)}>Test custody handover</button>
      <button type="button" onClick={event => onOpenReturn(10, event.currentTarget)}>Test custody return</button>
    </div>
  ),
}))
vi.mock('./records/GuardsPane', () => ({
  GuardsPane: ({ safeId, qualificationEmployeeId, onQualificationDone }: {
    safeId: number | null
    qualificationEmployeeId: string | null
    onQualificationDone(): void
  }) => (
    <div>
      <p>Guards scope {safeId ?? 'all'}</p>
      {qualificationEmployeeId && <>
        <p>Qualification for {qualificationEmployeeId}</p>
        <button type="button" onClick={onQualificationDone}>Finish test qualification</button>
      </>}
    </div>
  ),
}))
vi.mock('./records/AuditPane', () => ({
  AuditPane: ({ safeId }: { safeId: number | null }) => <p>Audit scope {safeId ?? 'all'}</p>,
}))

const emptyDetail: ArmoryItemDetailRead = {
  ...firearm, preset_key: null, stock: [], optional_kit_ids: [], batches: [], serials: [], recent_movements: [],
  totals: {
    opening_qty: null, received_qty: 0, known_in_safe: 0, in_safe: null, available_qty: 0, unrecorded_qty: null,
    out_on_shift: 0, in_custody: 0, in_repair: 0, missing: 0, lost: 0, written_off: 0,
    awaiting_rounds_decision: null, expended_rounds: null, lost_rounds: null, settled_rounds: null, expired_qty: null, book_total: null,
  },
}

function ArmoryRoute() {
  const { search, hash } = useLocation()
  return (
    <>
      <Routes>
        <Route path="/holdings/armory" element={<RequireCapability cap={ARMORY_VIEW_CAP}><ArmoryPage /></RequireCapability>} />
      </Routes>
      <div aria-label="Current route">{search}{hash}</div>
    </>
  )
}

beforeEach(async () => {
  access.principal = 1
  access.view = true
  access.edit = false
  sessionStorage.removeItem('armory.safe')
  await i18n.changeLanguage('en')
  vi.spyOn(api, 'listCapabilities').mockResolvedValue([])
  vi.spyOn(api, 'listArmorySafes').mockResolvedValue([testSafe, otherSafe])
  vi.spyOn(api, 'getArmoryShift').mockResolvedValue(testShift)
  vi.spyOn(api, 'getArmoryIssue').mockResolvedValue(issue)
  vi.spyOn(api, 'getArmoryMovement').mockResolvedValue(returnPosting)
  vi.spyOn(api, 'listArmoryItems').mockResolvedValue([])
  vi.spyOn(api, 'listArmorySiteOptions').mockResolvedValue({ vehicle_sites: [], duty_posts: [] })
})
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.removeItem('armory.safe')
})

describe('Armory route shell', () => {
  it.each([false, true])('denies direct links without view even when edit=%s', async edit => {
    access.view = false
    access.edit = edit
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&issue=10&return=1')
    expect(await screen.findByText(i18n.t('perms.noAccessPage'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Shift handover' })).not.toBeInTheDocument()
    expect(api.listArmorySafes).not.toHaveBeenCalled()
    expect(api.getArmoryIssue).not.toHaveBeenCalled()
  })

  it.each([
    { language: 'en', navigation: 'Armory sections', labels: ['Shift', 'Items', 'Custody', 'Guards', 'Audit'], scope: 'Safe', safeName: testSafe.name_en },
    { language: 'ar', navigation: 'أقسام خزنة السلاح', labels: ['الوردية', 'الأصناف', 'العهد', 'الحراس', 'التدقيق'], scope: 'الخزنة', safeName: testSafe.name_ar },
  ])('names all five destinations and the safe in $language', async ({ language, navigation, labels, scope, safeName }) => {
    await i18n.changeLanguage(language)
    renderArmory(<ArmoryRoute />)
    const nav = screen.getByRole('navigation', { name: navigation })
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(labels)
    expect(within(nav).getByRole('link', { name: labels[0] })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByRole('combobox', { name: scope })).toHaveDisplayValue(safeName)
  })

  it('shows the desk without any write controls or editor reads for a viewer', async () => {
    const settings = vi.spyOn(api, 'getArmorySettings')
    renderArmory(<ArmoryRoute />)
    expect(await screen.findByRole('region', { name: 'Shift activity' })).toBeInTheDocument()
    for (const name of ['Add safe', 'Shift settings', 'Record issues', 'Hand over custody', 'Return']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Find' })).toBeVisible()
    expect(api.listArmorySiteOptions).not.toHaveBeenCalled()
    expect(settings).not.toHaveBeenCalled()
  })

  it.each([
    { edit: true, key: 'noSafesEditor' }, { edit: false, key: 'noSafesViewer' },
  ])('renders the first-run state without panes when edit=$edit', async ({ edit, key }) => {
    access.edit = edit
    vi.mocked(api.listArmorySafes).mockResolvedValue([])
    renderArmory(<ArmoryRoute />)
    expect(await screen.findByText(i18n.t(`assets.armory.${key}`))).toBeInTheDocument()
    expect(screen.getByText('No safes yet')).toBeVisible()
    const add = screen.queryByRole('button', { name: 'Add safe' })
    if (edit) expect(add).toBeVisible()
    else expect(add).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Safe' })).not.toBeInTheDocument()
    expect(api.getArmoryShift).not.toHaveBeenCalled()
  })

  it('waits for safe scope and offers retry when the list cannot be read', async () => {
    const user = userEvent.setup()
    const load = vi.mocked(api.listArmorySafes)
      .mockRejectedValueOnce(new ApiError(403, 'HTTP_403', 'Synthetic detail'))
      .mockResolvedValue([testSafe])
    renderArmory(<ArmoryRoute />)
    expect(screen.getByText(i18n.t('assets.armory.loadingText'))).toBeVisible()
    expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.generic'))
    expect(api.getArmoryShift).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('combobox', { name: 'Safe' })).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it.each([
    { query: 'safe=2', stored: '1', selected: '2', id: 2 },
    { query: '', stored: '2', selected: '2', id: 2 },
    { query: 'safe=all', stored: '2', selected: 'all', id: undefined },
    { query: 'safe=999', stored: '2', selected: 'all', id: undefined },
    { query: '', stored: '999', selected: 'all', id: undefined },
  ])('uses a valid scope for $query with session value $stored', async ({ query, stored, selected, id }) => {
    sessionStorage.setItem('armory.safe', stored)
    renderArmory(<ArmoryRoute />, `/holdings/armory?${query}`)
    expect(await screen.findByRole('combobox', { name: 'Safe' })).toHaveValue(selected)
    await waitFor(() => expect(api.getArmoryShift).toHaveBeenCalledWith(id))
  })

  it('persists scope selection and removes unrelated detail keys on tab change', async () => {
    const user = userEvent.setup()
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=1&item=5&serial=6&guard=T-0002&pane=counts&count=7&movement=8')
    const safe = await screen.findByRole('combobox', { name: 'Safe' })
    await user.selectOptions(safe, '2')
    await waitFor(() => expect(sessionStorage.getItem('armory.safe')).toBe('2'))
    await user.click(within(screen.getByRole('navigation', { name: 'Armory sections' })).getByRole('link', { name: 'Items' }))
    expect(await screen.findByRole('heading', { name: 'Item catalogue', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=items&safe=2$/)
    expect(screen.getByRole('combobox', { name: 'Safe' })).toHaveValue('2')
  })

  it('asks the editor to scope bulk returns rather than guessing a safe', async () => {
    access.edit = true
    const user = userEvent.setup()
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=all')
    await user.click(await screen.findByRole('button', { name: /^Record returns/ }))
    expect(screen.getByRole('combobox', { name: 'Safe' })).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('scopes a check started from All safes and preserves its observations on resume', async () => {
    access.edit = true
    const user = userEvent.setup()
    vi.spyOn(api, 'getArmoryShiftCheckDraft').mockResolvedValue(testDraft)
    const post = vi.spyOn(api, 'createArmoryShiftCheck')
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=all')
    await user.click(await screen.findByRole('button', { name: 'Check the safe: Test Safe A' }))
    const check = await screen.findByRole('dialog', { name: 'Shift check' })
    await user.click(await within(check).findByRole('checkbox', { name: 'TEST-R-0001' }))
    await user.click(within(check).getByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('combobox', { name: 'Safe' })).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: 'Resume paused check' }))
    const resumed = await screen.findByRole('dialog', { name: 'Shift check' })
    expect(await within(resumed).findByRole('checkbox', { name: 'TEST-R-0001' })).toBeChecked()
    expect(post).not.toHaveBeenCalled()
  })

  it('resumes a receipt without dropping its reference when Add item is cancelled', async () => {
    access.edit = true
    const user = userEvent.setup()
    vi.spyOn(api, 'listArmoryKits').mockResolvedValue([])
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=items&safe=1')
    await user.click(await screen.findByRole('button', { name: 'Receive stock' }))
    const receive = await screen.findByRole('dialog', { name: 'Receive stock' })
    await user.type(await within(receive).findByRole('textbox', { name: 'Reference' }), 'TEST-KEEP')
    await user.click(within(receive).getByRole('button', { name: 'Not listed? Add item' }))
    const addItem = await screen.findByRole('dialog', { name: 'Add item' })
    expect(screen.queryByRole('dialog', { name: 'Receive stock' })).not.toBeInTheDocument()
    await user.click(within(addItem).getByRole('button', { name: 'Cancel' }))
    const resumed = await screen.findByRole('dialog', { name: 'Receive stock' })
    expect(within(resumed).getByRole('textbox', { name: 'Reference' })).toHaveValue('TEST-KEEP')
  })

  it.each([
    { status: 503, keepsDraft: true, attempts: 3 },
    { status: 403, keepsDraft: false, attempts: 1 },
  ])('handles a $status safes refetch with a dirty receipt open', async ({ status, keepsDraft, attempts }) => {
    access.edit = true
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    vi.mocked(api.listArmoryItems).mockResolvedValue([{
      ...emptyDetail, id: 100, name_en: 'TEST-COUNTED-ITEM', name_ar: 'صنف معدود للاختبار',
      kind: 'quantity', category: 'accessories', drawing: 'case',
    }])
    render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/holdings/armory?tab=items&safe=1']}><ArmoryRoute /></MemoryRouter>
    </I18nextProvider></QueryClientProvider>)
    await user.click(await screen.findByRole('button', { name: 'Receive stock' }))
    const dialog = await screen.findByRole('dialog', { name: 'Receive stock' })
    const receipt = within(dialog)
    await receipt.findByRole('option', { name: 'TEST-COUNTED-ITEM' })
    await user.selectOptions(receipt.getByRole('combobox', { name: 'Item' }), '100')
    await user.type(receipt.getByRole('textbox', { name: 'Quantity' }), '3')
    await user.type(receipt.getByRole('textbox', { name: 'Reference' }), 'TEST-KEEP')

    const load = vi.mocked(api.listArmorySafes)
    load.mockClear()
    load.mockRejectedValue(new ApiError(status, `HTTP_${status}`, 'Synthetic detail'))
    await act(async () => {
      await client.refetchQueries({ queryKey: armoryKeys.safes(access.principal), exact: true })
      // React Query notifies its observers on the next timer turn.
      await delay(0)
    })
    expect(load).toHaveBeenCalledTimes(attempts)

    if (keepsDraft) {
      expect(dialog).toBeInTheDocument()
      expect(receipt.getByRole('combobox', { name: 'Receiving safe' })).toHaveValue('1')
      expect(receipt.getByRole('textbox', { name: 'Reference' })).toHaveValue('TEST-KEEP')
      expect(receipt.getByRole('textbox', { name: 'Quantity' })).toHaveValue('3')
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('errors.generic'))
      expect(dialog).not.toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: 'Safe' })).not.toBeInTheDocument()
    }
  })

  it.each(['save the next item', 'close the wizard'] as const)('keeps Add another open during a receipt until operators %s', async finish => {
    access.edit = true
    const user = userEvent.setup()
    const created: ArmoryItemDetailRead[] = []
    vi.spyOn(api, 'listArmoryKits').mockResolvedValue([])
    vi.spyOn(api, 'getArmorySummary').mockResolvedValue({
      now_at: '2026-11-01T09:00:00Z', missing_firearm_count: 0, missing_firearms: [], overdue_count: 0, overdue: [],
      decision_count: 0, due_check_count: 0, expired_batch_count: 0, expiring_batch_count: 0,
      licences: { missing: 0, expired: 0, expiring: 0, valid: 0 }, former_open_count: 0,
    })
    vi.mocked(api.listArmoryItems).mockImplementation(async () => [...created])
    vi.spyOn(api, 'createArmoryItem').mockImplementation(async ({ name_en, name_ar, kind, category, drawing }) => {
      const item = { ...emptyDetail, id: 100 + created.length, name_en, name_ar, kind, category, drawing }
      created.push(item)
      return item
    })
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=items&safe=1')
    await user.click(await screen.findByRole('button', { name: 'Receive stock' }))
    const receive = within(await screen.findByRole('dialog', { name: 'Receive stock' }))
    await user.type(receive.getByRole('textbox', { name: 'Reference' }), 'TEST-KEEP')
    await user.click(receive.getByRole('button', { name: 'Not listed? Add item' }))
    const addItem = within(await screen.findByRole('dialog', { name: 'Add item' }))

    async function saveItem(nameEn: string, nameAr: string, addAnother: boolean) {
      await user.click(addItem.getByRole('radio', { name: 'Equipment by count' }))
      await user.click(addItem.getByRole('button', { name: 'Next' }))
      await user.type(addItem.getByRole('textbox', { name: 'Name in English' }), nameEn)
      await user.type(addItem.getByRole('textbox', { name: 'Name in Arabic' }), nameAr)
      await user.click(addItem.getByRole('button', { name: 'Next' }))
      if (addAnother) await user.click(addItem.getByRole('checkbox', { name: 'Add another after saving' }))
      await user.click(addItem.getByRole('button', { name: 'Save item' }))
    }

    await saveItem('TEST-ITEM-A', 'صنف اختبار أ', true)
    await screen.findByText('Item added to the catalogue.')
    expect(screen.queryByRole('dialog', { name: 'Add item' })).toBeInTheDocument()
    expect(addItem.getByRole('heading', { name: 'What are you adding?' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Receive stock' })).not.toBeInTheDocument()

    if (finish === 'save the next item') await saveItem('TEST-ITEM-B', 'صنف اختبار ب', false)
    else await user.click(addItem.getByRole('button', { name: 'Cancel' }))

    const resumed = within(await screen.findByRole('dialog', { name: 'Receive stock' }))
    expect(resumed.getByRole('textbox', { name: 'Reference' })).toHaveValue('TEST-KEEP')
    const items = resumed.getAllByRole('combobox', { name: 'Item' })
    expect(items).toHaveLength(finish === 'save the next item' ? 2 : 1)
    expect(items[0]).toHaveValue('100')
    if (finish === 'save the next item') expect(items[1]).toHaveValue('101')
    await waitFor(() => expect(items.at(-1)).toHaveFocus())
  })

  it('turns a viewer return link into the read-only issue', async () => {
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=1&issue=10&return=1')
    const detail = await screen.findByRole('dialog', { name: 'Issue record' })
    expect(await within(detail).findByText(issue.record_ref)).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Return' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=shift&safe=1&issue=10$/))
  })

  it('opens the editor return from a deep link and removes its flag on dismissal', async () => {
    access.edit = true
    const user = userEvent.setup()
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=1&issue=10&return=1')
    const dialog = await screen.findByRole('dialog', { name: 'Return' })
    expect(await within(dialog).findByText(issue.record_ref)).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'Issue record' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('dialog', { name: 'Issue record' })).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=shift&safe=1&issue=10$/)
  })

  it('cleans up a revoked deep-link return and leaves focus at the page title', async () => {
    access.edit = true
    const tree = renderArmory(<ArmoryRoute />, '/holdings/armory?tab=shift&safe=1&issue=10&return=1')
    await screen.findByRole('dialog', { name: 'Return' })
    access.edit = false
    tree.rerender(<ArmoryRoute />)

    expect(await screen.findByText(i18n.t('assets.armory.accessChanged'))).toBeVisible()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Shift handover' })).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=shift&safe=1$/)
  })

  it('scopes the Records panes and opens the shared return in custody mode', async () => {
    access.edit = true
    const user = userEvent.setup()
    const read = vi.spyOn(api, 'getArmoryCustody').mockResolvedValue({ ...issue, kind: 'custody', safe: otherSafe, due_at: null })
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=custody&safe=2')
    expect(await screen.findByText('Custody scope 2')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Test custody return' }))
    const dialog = await screen.findByRole('dialog', { name: 'Return custody items' })
    expect(await within(dialog).findByText(issue.record_ref)).toBeVisible()
    expect(read).toHaveBeenCalledWith(10)
    expect(api.getArmoryIssue).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(within(screen.getByRole('navigation', { name: 'Armory sections' })).getByRole('link', { name: 'Audit' }))
    expect(await screen.findByText('Audit scope 2')).toBeInTheDocument()
  })

  it.each(['finish', 'leave'] as const)('handles qualification detour when the editor chooses to %s', async outcome => {
    access.edit = true
    const user = userEvent.setup()
    vi.spyOn(api, 'listArmoryKits').mockResolvedValue([
      { id: 1, code: 'rifle', name_en: 'Test kit', name_ar: 'طقم اختبار', firearm_item: firearm, lines: [] },
    ])
    vi.spyOn(api, 'getArmoryItem').mockResolvedValue(emptyDetail)
    vi.spyOn(api, 'listArmoryPeople').mockResolvedValue([{ ...candidates[1], licence_status: 'missing', licence_expires_on: null }])
    renderArmory(<ArmoryRoute />, '/holdings/armory?tab=custody&safe=2#test')
    await user.click(await screen.findByRole('button', { name: 'Test custody handover' }))
    const handover = await screen.findByRole('dialog', { name: 'Hand over custody' })
    await user.click(await within(handover).findByRole('button', { name: /Test Guard One/ }))
    const noteName = i18n.t('assets.armory.conditionNote')
    await user.type(within(handover).getByRole('textbox', { name: noteName }), 'Test draft note')
    await user.click(within(handover).getByRole('checkbox', { name: 'I acknowledge the licence warning on this record.' }))
    await user.click(within(handover).getByRole('button', { name: 'Add licence now' }))

    expect(await screen.findByText('Qualification for T-0002')).toBeInTheDocument()
    expect(screen.getByText('Guards scope 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=guards&safe=2&guard=T-0002$/)
    expect(screen.queryByRole('dialog', { name: 'Hand over custody' })).not.toBeInTheDocument()
    if (outcome === 'finish') {
      await user.click(screen.getByRole('button', { name: 'Finish test qualification' }))
      const resumed = await screen.findByRole('dialog', { name: 'Hand over custody' })
      expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\?tab=custody&safe=2#test$/)
      expect(within(resumed).getByRole('textbox', { name: noteName })).toHaveValue('Test draft note')
      expect(await within(resumed).findByText('Eligibility refreshed. Review the licence warning again.')).toBeInTheDocument()
      expect(within(resumed).getByRole('checkbox', { name: 'I acknowledge the licence warning on this record.' })).not.toBeChecked()
    } else {
      const nav = screen.getByRole('navigation', { name: 'Armory sections' })
      await user.click(within(nav).getByRole('link', { name: 'Items' }))
      await screen.findByRole('heading', { name: 'Item catalogue', level: 1 })
      await user.click(within(nav).getByRole('link', { name: 'Custody' }))
      expect(await screen.findByText('Custody scope 2')).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  })

  it.each(['edit', 'principal'] as const)('discards a write draft and focuses the heading after a change of %s', async boundary => {
    access.edit = true
    const user = userEvent.setup()
    const tree = renderArmory(<ArmoryRoute />)
    const heading = screen.getByRole('heading', { name: 'Shift handover' })
    await user.click(await screen.findByRole('button', { name: 'Add safe' }))
    const draft = screen.getByLabelText(/^Safe name in English/)
    fireEvent.change(draft, { target: { value: 'Unsubmitted Test Safe' } })
    if (boundary === 'edit') access.edit = false
    else access.principal = 2
    tree.rerender(<ArmoryRoute />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('assets.armory.accessChanged'))).toHaveAttribute('role', 'status')
    await waitFor(() => expect(heading).toHaveFocus())
    if (boundary === 'edit') {
      expect(screen.queryByRole('button', { name: 'Shift settings' })).not.toBeInTheDocument()
      access.edit = true
      tree.rerender(<ArmoryRoute />)
    }
    await user.click(await screen.findByRole('button', { name: 'Add safe' }))
    expect(screen.getByLabelText(/^Safe name in English/)).toHaveValue('')
  })

  it('selects and announces the first saved safe', async () => {
    access.edit = true
    const user = userEvent.setup()
    const list = vi.mocked(api.listArmorySafes).mockResolvedValue([])
    vi.spyOn(api, 'createArmorySafe').mockImplementation(async () => {
      list.mockResolvedValue([testSafe])
      return testSafe
    })
    renderArmory(<ArmoryRoute />)
    await user.click(await screen.findByRole('button', { name: 'Add safe' }))
    const form = screen.getByRole('dialog', { name: 'Add safe' })
    await within(form).findByRole('combobox', { name: 'Fleet site (optional)' })
    fireEvent.change(within(form).getByLabelText(/^Safe name in English/), { target: { value: testSafe.name_en } })
    fireEvent.change(within(form).getByLabelText(/^Safe name in Arabic/), { target: { value: testSafe.name_ar } })
    await user.click(within(form).getByRole('button', { name: 'Save safe' }))

    expect(await screen.findByText('Safe added.')).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Safe' })).toHaveValue('1'))
    expect(screen.getByLabelText('Current route')).toHaveTextContent('safe=1')
  })
})
