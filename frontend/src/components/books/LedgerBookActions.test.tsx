import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, MemoryRouter, Outlet, Route, RouterProvider, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, ApiError, type LedgerBookRead, type LedgerRevisionRead } from '@/lib/api'
import { toast } from '@/lib/toast'
import i18n from '@/lib/i18n'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { LedgerBookActions, type LedgerReviewedPaper } from './LedgerBookActions'
import { ledgerBookKey } from './ledgerBookKeys'

const rev = (n: number, locked: boolean): LedgerRevisionRead => ({
  version_id: 70 + n, version_no: n, trigger: n === 1 ? 'initial' : 'correction',
  created_at: '2026-10-28T08:00:00Z', signed_at: locked ? '2026-10-28T09:00:00Z' : null, superseded: false, locked,
})

const book = (revisions: LedgerRevisionRead[], over: Partial<LedgerBookRead> = {}): LedgerBookRead => ({
  id: 40, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
  paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false, revisions,
  selected_version_id: revisions.at(-1)!.version_id, subjects: ['Leave plan'], body_html: '<p>x</p>', content_sha256: 'abc',
  external: false, addressees: [], signer: null, can_sign: false, can_return: false, can_change_signer: false,
  paper_preset: 'normal', references: [], folders: [],
  can_resubmit: false, can_create_outlook_draft: false, return_note: null, ...over,
})

function Where(): React.JSX.Element {
  return <output aria-label="URL">{useLocation().pathname}</output>
}

const newClient = (): QueryClient => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function mount(onRevisionChange = vi.fn(), client = newClient(), revision?: number): { rerenderWith: (rev?: number) => void } {
  const tree = (rev?: number): React.JSX.Element => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ledger']}>
        <Routes><Route path="*" element={<><LedgerBookActions bookId={40} revision={rev} reviewedPaper={{ versionId: 71, contentHash: 'abc' }} onRevisionChange={onRevisionChange} /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree(revision))
  return { rerenderWith: (rev) => view.rerender(tree(rev)) }
}

const confirmIn = async (title: string, action: string): Promise<void> => {
  const dialog = await screen.findByRole('dialog', { name: title })
  await userEvent.click(within(dialog).getByRole('button', { name: action }))
}

afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); await i18n.changeLanguage('en') })

function mountCorrectionVisit(strict: boolean, reviewedPaper: LedgerReviewedPaper | null = { versionId: 71, contentHash: 'abc' }): { router: ReturnType<typeof createMemoryRouter>; qc: QueryClient } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([{
    element: <><Outlet /><Where /></>,
    children: [
      { path: '/ledger', element: <CorrectionVisitActions initialPaper={reviewedPaper} /> },
      { path: '*', element: null },
    ],
  }], { initialEntries: ['/ledger'] })
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>, { reactStrictMode: strict })
  return { router, qc }
}

function CorrectionVisitActions({ initialPaper }: { initialPaper: LedgerReviewedPaper | null }): React.JSX.Element {
  const bookId = Number(new URLSearchParams(useLocation().search).get('book') ?? 40)
  const qc = useQueryClient()
  const [reviewedPaper, setReviewedPaper] = useState(initialPaper)
  return <>
    <LedgerBookActions bookId={bookId} reviewedPaper={reviewedPaper} />
    <button onClick={() => {
      const current = qc.getQueryData<LedgerBookRead>(ledgerBookKey(bookId))!
      setReviewedPaper({ versionId: current.selected_version_id, contentHash: current.content_sha256 })
    }}>Paper loaded</button>
  </>
}

it.each([false, true])('does not redirect a departed correction visit; StrictMode=%s', async (strict) => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
  let resolveCorrection!: (book: LedgerBookRead) => void
  const start = vi.spyOn(api, 'startLedgerCorrection').mockReturnValue(new Promise((resolve) => { resolveCorrection = resolve }))
  const { router, qc } = mountCorrectionVisit(strict)
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
  await confirmIn('Start a correction?', 'Start correction')
  await waitFor(() => expect(start).toHaveBeenCalledWith(40))
  await act(() => router.navigate('/employees'))
  await act(async () => resolveCorrection(book([rev(1, true), rev(2, false)])))
  expect(screen.getByLabelText('URL')).toHaveTextContent('/employees')
  expect(qc.getQueryState(ledgerBookKey(40))?.isInvalidated).toBe(true)
})

it.each([false, true])('opens the correction editor for an active visit; StrictMode=%s', async (strict) => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
  let resolveCorrection!: (book: LedgerBookRead) => void
  const start = vi.spyOn(api, 'startLedgerCorrection').mockReturnValue(new Promise((resolve) => { resolveCorrection = resolve }))
  mountCorrectionVisit(strict)
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
  await confirmIn('Start a correction?', 'Start correction')
  await waitFor(() => expect(start).toHaveBeenCalledWith(40))
  await act(async () => resolveCorrection(book([rev(1, true), rev(2, false)])))
  expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/books/40/edit')
})

it('does not redirect an old correction after the selected book changes', async () => {
  vi.spyOn(api, 'getLedgerBook').mockImplementation(async (id) => ({ ...book([rev(1, true)]), id }))
  let resolveCorrection!: (book: LedgerBookRead) => void
  const start = vi.spyOn(api, 'startLedgerCorrection').mockReturnValue(new Promise((resolve) => { resolveCorrection = resolve }))
  const { router, qc } = mountCorrectionVisit(false)
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
  await confirmIn('Start a correction?', 'Start correction')
  await waitFor(() => expect(start).toHaveBeenCalledWith(40))
  await act(() => router.navigate('/ledger?book=41'))
  await act(async () => resolveCorrection(book([rev(1, true), rev(2, false)])))
  expect(router.state.location).toMatchObject({ pathname: '/ledger', search: '?book=41' })
  expect(qc.getQueryState(ledgerBookKey(40))?.isInvalidated).toBe(true)
})

it('signs the snapshot reviewed when confirmation opened despite a background refresh', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  const sign = vi.spyOn(api, 'signLedgerBook').mockResolvedValue(book([rev(1, true)]))
  const { qc } = mountCorrectionVisit(false)
  await userEvent.click(await screen.findByRole('button', { name: 'Sign' }))
  act(() => qc.setQueryData(ledgerBookKey(40), book([rev(1, false), rev(2, false)], { can_sign: true, content_sha256: 'changed' })))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign' }))
  await waitFor(() => expect(sign).toHaveBeenCalledWith(40, { expected_version_id: 71, expected_content_sha256: 'abc' }))
})

it.each([null, { versionId: 71, contentHash: 'old-paper' }, { versionId: 72, contentHash: 'abc' }])('disables signing until the shown paper snapshot is ready: %j', async (reviewedPaper) => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  const sign = vi.spyOn(api, 'signLedgerBook')
  mountCorrectionVisit(false, reviewedPaper)
  expect(await screen.findByRole('button', { name: 'Sign' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Sign' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sign).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Paper loaded' }))
  expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled()
})

it.each(['Sign', 'Return', 'Change signer'])('closes the old %s dialog and resets its inputs when the selected book changes', async (action) => {
  vi.spyOn(api, 'getLedgerBook').mockImplementation(async (id) => ({ ...book([rev(1, false)], {
    can_sign: true, can_return: true, can_change_signer: true,
  }), id }))
  vi.spyOn(api, 'listManagers').mockResolvedValue([
    { id: 3, name_en: 'New manager', name_ar: 'المدير الجديد', user_id: 10, active: true, title: 'Director', has_signature: true },
  ])
  const sign = vi.spyOn(api, 'signLedgerBook').mockResolvedValue(book([rev(1, true)], { id: 41 }))
  const sendBack = vi.spyOn(api, 'returnLedgerBook')
  const changeSigner = vi.spyOn(api, 'changeLedgerSigner')
  const { router } = mountCorrectionVisit(false)
  await userEvent.click(await screen.findByRole('button', { name: action }))
  if (action === 'Return') await userEvent.type(screen.getByRole('textbox', { name: 'Return note' }), 'Note for book 40')
  if (action === 'Change signer') {
    await screen.findByRole('option', { name: 'New manager · Director' })
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Signing manager' }), '3')
  }
  await act(() => router.navigate('/ledger?book=41'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(sign).not.toHaveBeenCalled()
  expect(sendBack).not.toHaveBeenCalled()
  expect(changeSigner).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole('button', { name: action }))
  if (action === 'Return') expect(screen.getByRole('textbox', { name: 'Return note' })).toHaveValue('')
  else if (action === 'Change signer') expect(screen.getByRole('combobox', { name: 'Signing manager' })).toHaveValue('')
  else {
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign' }))
    await waitFor(() => expect(sign).toHaveBeenCalledWith(41, { expected_version_id: 71, expected_content_sha256: 'abc' }))
  }
})

it('refreshes a signing conflict and requires a new explicit confirmation for the latest snapshot', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  const sign = vi.spyOn(api, 'signLedgerBook').mockRejectedValueOnce(new ApiError(409, 'SIGNING_CONTENT_CONFLICT', 'Review latest content'))
    .mockResolvedValue(book([rev(1, true)]))
  mountCorrectionVisit(false)
  await userEvent.click(await screen.findByRole('button', { name: 'Sign' }))
  get.mockResolvedValue(book([rev(1, false)], { can_sign: true, content_sha256: 'latest' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(sign).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Sign' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Paper loaded' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Sign' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign' }))
  await waitFor(() => expect(sign).toHaveBeenLastCalledWith(40, { expected_version_id: 71, expected_content_sha256: 'latest' }))
})

it('T-C8 Start correction on a signed Revision opens the content editor', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
  const start = vi.spyOn(api, 'startLedgerCorrection').mockResolvedValue(book([rev(1, true), rev(2, false)]))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
  expect(start).not.toHaveBeenCalled()
  await confirmIn('Start a correction?', 'Start correction')
  await waitFor(() => expect(start).toHaveBeenCalledWith(40))
  expect(await screen.findByText('/ledger/books/40/edit')).toBeInTheDocument()
})

it('T-C8 an unsigned Revision is edited directly; the revision picker reports the chosen Revision', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true), rev(2, false)]))
  const start = vi.spyOn(api, 'startLedgerCorrection')
  const onRevisionChange = vi.fn()
  mount(onRevisionChange)
  expect(await screen.findByRole('link', { name: 'Edit content' })).toHaveAttribute('href', '/ledger/books/40/edit')
  expect(screen.queryByRole('button', { name: 'Start correction' })).not.toBeInTheDocument()
  const picker = screen.getByLabelText('Revision')
  expect([...(picker as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Revision 1 (signed)', 'Revision 2'])
  await userEvent.selectOptions(picker, '71')
  expect(onRevisionChange).toHaveBeenCalledWith(71)
  expect(start).not.toHaveBeenCalled()
})

it('T-C8 only the writer gets edit and correction actions', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)], { created_by_user_id: 9 }))
  mount()
  expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Start correction' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Edit content' })).not.toBeInTheDocument()
})

it('T-F3 manager confirms Sign on the Ledger API, never the generic book API', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
    .mockResolvedValueOnce(book([rev(1, false)], { created_by_user_id: 9, can_sign: true }))
  const genericSign = vi.spyOn(api, 'signBook')
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Sign' }))
  const sign = vi.spyOn(api, 'signLedgerBook').mockResolvedValue(book([rev(1, true)]))
  expect(sign).not.toHaveBeenCalled()
  const confirm = screen.getByRole('dialog', { name: 'Sign this Ledger Book?' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Sign' }))
  await waitFor(() => expect(sign).toHaveBeenCalledWith(40, { expected_version_id: 71, expected_content_sha256: 'abc' }))
  expect(genericSign).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument())
})

it('T-F3 manager Return requires a nonblank note and sends it to the Ledger API', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_return: true, created_by_user_id: 9 }))
  const sendBack = vi.spyOn(api, 'returnLedgerBook').mockResolvedValue(book([rev(1, false)], { return_note: 'Fix the addressees.' }))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Return' }))
  const dialog = screen.getByRole('dialog', { name: 'Return to writer' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Return' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a return note.')
  expect(sendBack).not.toHaveBeenCalled()
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Return note' }), '   ')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Return' }))
  expect(sendBack).not.toHaveBeenCalled()
  await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Return note' }))
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Return note' }), 'Fix the addressees.')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Return' }))
  await waitFor(() => expect(sendBack).toHaveBeenCalledWith(40, 'Fix the addressees.'))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('T-F3 writer changes the signer using linked active managers before signing', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_change_signer: true }))
  vi.spyOn(api, 'listManagers').mockResolvedValue([
    { id: 3, name_en: 'New manager', name_ar: 'المدير الجديد', user_id: 10, active: true, title: 'Director', has_signature: true },
    { id: 4, name_en: 'Unlinked', name_ar: '', user_id: null, active: true, title: '', has_signature: false },
    { id: 5, name_en: 'Inactive', name_ar: '', user_id: 11, active: false, title: '', has_signature: false },
  ])
  const change = vi.spyOn(api, 'changeLedgerSigner').mockResolvedValue(book([rev(1, false)]))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Change signer' }))
  const dialog = screen.getByRole('dialog', { name: 'Change signing manager' })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a signing manager.')
  expect(change).not.toHaveBeenCalled()
  const picker = within(dialog).getByRole('combobox', { name: 'Signing manager' })
  await screen.findByRole('option', { name: 'New manager · Director' })
  expect(within(dialog).queryByRole('option', { name: 'Unlinked' })).not.toBeInTheDocument()
  expect(within(dialog).queryByRole('option', { name: 'Inactive' })).not.toBeInTheDocument()
  await userEvent.selectOptions(picker, '3')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(change).toHaveBeenCalledWith(40, 3))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('T-F3 writer sees the return note and resubmits the same book for signature', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], {
    approval_state: 'returned', return_note: 'Correct the subject.', can_resubmit: true,
  }))
  const resubmit = vi.spyOn(api, 'resubmitLedgerBook').mockResolvedValue(book([rev(1, false)], { approval_state: 'pending' }))
  mount()
  expect(await screen.findByText('Correct the subject.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Edit content' })).toHaveAttribute('href', '/ledger/books/40/edit')
  await userEvent.click(screen.getByRole('button', { name: 'Resubmit for signature' }))
  expect(resubmit).not.toHaveBeenCalled()
  await confirmIn('Resubmit for signature?', 'Resubmit for signature')
  await waitFor(() => expect(resubmit).toHaveBeenCalledWith(40))
})

it('T-F3 writer creates an Outlook draft from signed external paper and is directed to Outlook Drafts', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)], {
    external: true, can_create_outlook_draft: true,
  }))
  const draft = vi.spyOn(api, 'createLedgerOutlookDraft').mockResolvedValue({ id: 40 })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Create Outlook draft' }))
  expect(draft).not.toHaveBeenCalled()
  await confirmIn('Create an Outlook draft?', 'Create Outlook draft')
  await waitFor(() => expect(draft).toHaveBeenCalledWith(40))
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Draft created. Open Outlook Drafts to review and send it.'))
})

it.each([
  { locked: false, external: false, approval_state: 'pending' },
  { locked: false, external: true, approval_state: 'returned' },
  { locked: true, external: true, approval_state: 'approved' },
])('T-F3 denied flags hide all signing/delivery actions despite record state $approval_state', async ({ locked, ...state }) => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, locked)], state))
  mount()
  expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument()
  for (const name of ['Sign', 'Return', 'Change signer', 'Resubmit for signature', 'Create Outlook draft']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  }
})

it.each([
  ['en', 'Sign', 'Add your profile signature in Settings or on your employee profile before approving.'],
  ['ar', 'توقيع', 'أضف توقيع ملفك الشخصي في الإعدادات أو في ملف الموظف قبل الموافقة.'],
])('T-F3 sign errors use the bilingual API error message (%s)', async (language, signLabel, message) => {
  await i18n.changeLanguage(language)
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  vi.spyOn(api, 'signLedgerBook').mockRejectedValue(new ApiError(422, 'NO_SIGNATURE', 'No signature'))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: signLabel }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: signLabel }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  expect(toast.success).not.toHaveBeenCalled()
})

it('T-F3 cancelling Sign never calls either signing API', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  const sign = vi.spyOn(api, 'signLedgerBook')
  const genericSign = vi.spyOn(api, 'signBook')
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Sign' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(sign).not.toHaveBeenCalled()
  expect(genericSign).not.toHaveBeenCalled()
})

it.each([['en', 'Print'], ['ar', 'طباعة']])('preserves Print of the selected revision and opens the native print dialog on load (%s)', async (lng, label) => {
  await i18n.changeLanguage(lng)
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false), rev(2, false)], { selected_version_id: 71 }))
  const print = vi.fn()
  const printWindow = new EventTarget()
  const open = vi.spyOn(window, 'open').mockReturnValue(Object.assign(printWindow, { print }) as unknown as Window)
  mount()
  await userEvent.click(await screen.findByRole('button', { name: label }))
  expect(open).toHaveBeenCalledWith('/api/v1/ledger/books/40/paper?revision=71', 'ledger-book-40')
  printWindow.dispatchEvent(new Event('load'))
  expect(print).toHaveBeenCalledTimes(1)
})

it('declining a confirmation leaves the book untouched', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)], { can_resubmit: true, can_create_outlook_draft: true }))
  const start = vi.spyOn(api, 'startLedgerCorrection')
  const resubmit = vi.spyOn(api, 'resubmitLedgerBook')
  const draft = vi.spyOn(api, 'createLedgerOutlookDraft')
  mount()
  for (const name of ['Start correction', 'Resubmit for signature', 'Create Outlook draft']) {
    await userEvent.click(await screen.findByRole('button', { name }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
  expect([start, resubmit, draft].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0])
})

it('Start correction also refreshes the Books lists', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
  vi.spyOn(api, 'startLedgerCorrection').mockResolvedValue(book([rev(1, true), rev(2, false)]))
  const client = newClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  mount(vi.fn(), client)
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
  await confirmIn('Start a correction?', 'Start correction')
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] }))
})

it('a mutation result is written once: the latest key is not refetched straight after', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, false)], { can_sign: true }))
  vi.spyOn(api, 'signLedgerBook').mockResolvedValue(book([rev(1, true)]))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Sign' }))
  await confirmIn('Sign this Ledger Book?', 'Sign')
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign' })).not.toBeInTheDocument())
  expect(get).toHaveBeenCalledTimes(1)
})

it('asking for the newest Revision by number reuses the latest entry; other Revisions keep the toolbar mounted while they load', async () => {
  const two = book([rev(1, true), rev(2, false)])
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(two)
  const client = newClient()
  const view = mount(vi.fn(), client)
  await screen.findByRole('button', { name: 'Print' })
  expect(get).toHaveBeenCalledTimes(1)
  view.rerenderWith(72) // the newest, by number
  expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
  expect(get).toHaveBeenCalledTimes(1)

  let finish: (value: LedgerBookRead) => void = () => undefined
  get.mockReturnValueOnce(new Promise<LedgerBookRead>((resolve) => { finish = resolve }))
  view.rerenderWith(71) // an older one: fetched, but the toolbar stays while it loads
  expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
  expect(get).toHaveBeenLastCalledWith(40, 71)
  finish(two)
})
