import { Fragment, StrictMode, type Ref } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

import { LEDGER_DRAFTS_KEY, ledgerDraftKey } from '@/components/books/ledgerBookKeys'
import { api, ApiError, type LedgerBookRead, type LedgerDraftRead } from '@/lib/api'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
// HugeRTE can't mount in jsdom: a plain textarea stands in for the body editor.
vi.mock('./LedgerBodyEditor', () => ({
  LedgerBodyEditor: ({ value, onChange, label, height, ref, disabled }: { disabled?: boolean; ref?: Ref<{ focus(): void }>; value: string; onChange: (v: string) => void; label: string; height: number }) => (
    <textarea disabled={disabled} ref={(node) => { const handle = node ? { focus: () => node.focus() } : null; if (typeof ref === 'function') ref(handle); else if (ref) ref.current = handle }} aria-label={label} data-editor-height={height} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/books/LedgerPaperPdf', () => ({
  LedgerPaperPdf: ({ url, title }: { url: string | null; title: string }) => <div title={title} data-url={url} />,
}))

vi.mock('./LedgerAddresseesPicker', async (original) => {
  const actual = await original<typeof import('./LedgerAddresseesPicker')>()
  return { ...actual, LedgerAddresseesPicker: vi.fn(actual.LedgerAddresseesPicker) }
})
import { LedgerAddresseesPicker } from './LedgerAddresseesPicker'
import { LedgerComposerPage } from './LedgerComposerPage'

const DRAFT: LedgerDraftRead = {
  id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
  subjects: ['Leave plan'], body_html: '<p>Hello</p>',
  external: false, signer_manager_id: 3, addressees: [{ role: 'to', user_id: 8 }],
  paper_preset: 'normal', reference_book_ids: [], folder_ids: [],
  created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
}

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output aria-label="URL">{location.pathname + location.search}</output>
}

let router: ReturnType<typeof createMemoryRouter>
function mountComposer(url = '/ledger/compose/12', autosaveMs = 10, strict = false): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = strict ? StrictMode : Fragment
  render(
    <Wrapper>
    <QueryClientProvider client={client}>
      <RouterProvider router={router = createMemoryRouter([{ path: '*', element: <>
        <Routes>
          <Route path="/ledger/compose" element={<LedgerComposerPage autosaveMs={autosaveMs} />} />
          <Route path="/ledger/compose/:draftId" element={<LedgerComposerPage autosaveMs={autosaveMs} />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </> }], { initialEntries: ['/employees', url] })} />
    </QueryClientProvider>
    </Wrapper>,
  )
  return client
}

let update: MockInstance<typeof api.updateLedgerDraft>
beforeEach(() => {
  vi.spyOn(api, 'getLedgerDraft').mockResolvedValue(DRAFT)
  vi.spyOn(api, 'listBookFolders').mockResolvedValue([])
  vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [], total: 0, limit: 8, offset: 0 })
  vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
    { id: 8, name: 'Ali', name_ar: 'علي', g_number: 'G008', role: 'employee', has_secret_clearance: true },
    { id: 9, name: 'Sara', name_ar: 'سارة', g_number: 'G009', role: 'employee', has_secret_clearance: true },
  ])
  vi.spyOn(api, 'listLedgerContacts').mockResolvedValue([{ id: 5, display_name: 'Partner', address: 'partner@example.com', created_at: DRAFT.created_at }])
  vi.spyOn(api, 'listManagers').mockResolvedValue([
    { id: 3, name_en: 'Manager', name_ar: 'المدير', user_id: 10, active: true, title: 'Director', has_signature: true },
    { id: 4, name_en: 'Unlinked', name_ar: '', user_id: null, active: true, title: '', has_signature: false },
  ])
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({
    items: [
      { code: '1/1', tab: 1, name_ar: 'الغيابات', name_en: 'Unexcused absences', unit_ar: '' },
      { code: '2/1', tab: 2, name_ar: 'محاضر الاجتماع', name_en: 'Meeting minutes', unit_ar: '' },
    ],
  })
  update = vi.spyOn(api, 'updateLedgerDraft').mockImplementation(async (_id, body) => ({ ...DRAFT, ...body } as LedgerDraftRead))
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await i18n.changeLanguage('en') })

describe('Ledger Book composer', () => {
  it.each([
    ['send', false], ['send', true], ['delete', false], ['delete', true],
  ] as const)('preserves the destination after departing pending %s (StrictMode: %s)', async (operation, strict) => {
    let accept!: () => void
    const mutation = operation === 'send'
      ? vi.spyOn(api, 'saveAndSendLedgerDraft').mockImplementation(() => new Promise((resolve) => { accept = () => resolve({ id: 40, ref_number: '1/2/7' } as LedgerBookRead) }))
      : vi.spyOn(api, 'deleteLedgerDraft').mockImplementation(() => new Promise((resolve) => { accept = () => resolve(undefined) }))
    const client = mountComposer('/ledger/compose/12', 10, strict)
    client.setQueryData(LEDGER_DRAFTS_KEY, [])
    const label = operation === 'send' ? 'Save & Send' : 'Delete draft'
    await userEvent.click(await screen.findByRole('button', { name: label }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }))
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(1))
    await act(() => router.navigate('/employees'))
    expect(screen.getByLabelText('URL')).toHaveTextContent('/employees')
    await act(async () => { accept() })
    await waitFor(() => expect(client.getQueryData(ledgerDraftKey(12))).toBeUndefined())
    expect(client.getQueryState(LEDGER_DRAFTS_KEY)?.isInvalidated).toBe(true)
    expect(screen.getByLabelText('URL')).toHaveTextContent('/employees')
  })

  it('freezes every editing surface through the final flush and issuance, then unlocks on failure', async () => {
    let accept!: (draft: LedgerDraftRead) => void
    let rejectIssue!: (error: Error) => void
    update.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    const issue = vi.spyOn(api, 'saveAndSendLedgerDraft').mockReturnValue(new Promise((_resolve, reject) => { rejectIssue = reject }))
    mountComposer('/ledger/compose/12', 60000)
    const body = await screen.findByLabelText('Body')
    fireEvent.change(body, { target: { value: 'Final body' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save & Send' }))
    await userEvent.dblClick(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save & Send' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const assertLocked = () => {
      for (const control of ['Body', 'Subject line 1', 'Tab', 'Grade', 'To', 'CC', 'Signing manager', 'References']) expect(screen.getByLabelText(control)).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Add line' })).toBeDisabled()
      expect(body.closest('fieldset')).toHaveAttribute('inert')
    }
    assertLocked()
    // A previously opened portaled picker can still deliver its callback.
    const picker = vi.mocked(LedgerAddresseesPicker).mock.calls.at(-1)![0]
    act(() => picker.onChange([]))
    fireEvent.change(body, { target: { value: 'Too late' } })
    expect(body).toHaveValue('Final body')
    await act(async () => { accept({ ...DRAFT, body_html: 'Final body' }) })
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1))
    assertLocked()
    await act(async () => { rejectIssue(new Error('offline')) })
    await waitFor(() => expect(body).toBeEnabled())
    expect(screen.getByLabelText('Subject line 1')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove Ali from To' })).toBeInTheDocument()
    fireEvent.change(body, { target: { value: 'Editable again' } })
    expect(body).toHaveValue('Editable again')
  })

  it('restores editing when the final flush fails before issuance', async () => {
    update.mockRejectedValueOnce(new Error('offline'))
    const issue = vi.spyOn(api, 'saveAndSendLedgerDraft')
    mountComposer('/ledger/compose/12', 60000)
    const body = await screen.findByLabelText('Body')
    fireEvent.change(body, { target: { value: 'Unsaved final body' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save & Send' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save & Send' }))
    await screen.findByText('Not saved. Your next change tries again.')
    expect(body).toBeEnabled()
    expect(issue).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not redirect a departed creation visit (StrictMode: %s)', async (strict) => {
    let accept!: (draft: LedgerDraftRead) => void
    const create = vi.spyOn(api, 'createLedgerDraft').mockReturnValue(new Promise((resolve) => { accept = resolve }))
    const client = mountComposer('/ledger/compose', 10, strict)
    client.setQueryData(LEDGER_DRAFTS_KEY, [])
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await act(() => router.navigate('/employees'))
    await act(async () => { accept(DRAFT) })
    await waitFor(() => expect(client.getQueryData(ledgerDraftKey(DRAFT.id))).toEqual(DRAFT))
    expect(client.getQueryState(LEDGER_DRAFTS_KEY)?.isInvalidated).toBe(true)
    expect(screen.getByLabelText('URL')).toHaveTextContent('/employees')
  })

  it('creates once and redirects an active visit after StrictMode effect replay', async () => {
    let accept!: (draft: LedgerDraftRead) => void
    const create = vi.spyOn(api, 'createLedgerDraft').mockReturnValue(new Promise((resolve) => { accept = resolve }))
    mountComposer('/ledger/compose', 10, true)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await act(async () => { accept(DRAFT) })
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12'))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('protects browser Back and preserves its original destination', async () => {
    mountComposer('/ledger/compose/12', 60000)
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'Back edit' } })
    await act(() => router.navigate(-1))
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/employees'))
    expect(update).toHaveBeenCalledWith(12, { body_html: 'Back edit' })
  })

  it('saves edits made while a blocked exit waits for its first request', async () => {
    let accept!: (draft: LedgerDraftRead) => void
    update.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    mountComposer('/ledger/compose/12', 60000)
    const body = await screen.findByLabelText('Body')
    fireEvent.change(body, { target: { value: 'First exit edit' } })
    await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    fireEvent.change(body, { target: { value: 'Later exit edit' } })
    accept({ ...DRAFT, body_html: 'First exit edit' })
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger?tab=books'))
    expect(update).toHaveBeenLastCalledWith(12, { body_html: 'Later exit edit' })
  })

  it('allows clean navigation without PATCH or reload warning', async () => {
    mountComposer()
    await screen.findByLabelText('Body')
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(false)
    await act(() => router.navigate('/employees'))
    expect(screen.getByLabelText('URL')).toHaveTextContent('/employees')
    expect(update).not.toHaveBeenCalled()
  })

  it('flushes an immediate Back exit before the debounce expires', async () => {
    mountComposer('/ledger/compose/12', 60000)
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'Immediate' } })
    await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger?tab=books'))
    expect(update).toHaveBeenCalledWith(12, { body_html: 'Immediate' })
  })

  it('waits for an in-flight save before leaving, and warns on reload', async () => {
    let accept!: (draft: LedgerDraftRead) => void
    update.mockReturnValueOnce(new Promise((resolve) => { accept = resolve }))
    mountComposer()
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'In flight' } })
    await waitFor(() => expect(update).toHaveBeenCalled())
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(true)
    await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
    accept({ ...DRAFT, body_html: 'In flight' })
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger?tab=books'))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps failed exit edits available and retries the exit', async () => {
    mountComposer('/ledger/compose/12', 60000)
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'Offline' } })
    update.mockRejectedValueOnce(new Error('offline'))
    await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save changes before leaving' })
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger?tab=books'))
    expect(update).toHaveBeenCalledTimes(2)
  })

  it.each(['cancel', 'escape'])('returns focus to Back after dismissing a failed-exit dialog with %s', async (dismiss) => {
    mountComposer('/ledger/compose/12', 60000)
    const body = await screen.findByLabelText('Body')
    update.mockRejectedValue(new TypeError('offline'))
    fireEvent.change(body, { target: { value: 'Unsaved text' } })
    const back = screen.getByRole('link', { name: 'Back to Ledger' })
    await userEvent.click(back)
    const dialog = await screen.findByRole('dialog', { name: 'Save changes before leaving' })
    if (dismiss === 'cancel') await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    else await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(back).toHaveFocus())
    expect(body).toHaveValue('Unsaved text')
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
  })

  it('does not restore a deleted draft cache when an earlier save response arrives late', async () => {
    let accept!: (value: LedgerDraftRead) => void
    update.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve }))
    vi.spyOn(api, 'deleteLedgerDraft').mockResolvedValue(undefined)
    const client = mountComposer()
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'Last save' } })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger?tab=books'))
    await act(async () => { accept({ ...DRAFT, body_html: 'Last save' }) })
    expect(client.getQueryData(ledgerDraftKey(DRAFT.id))).toBeUndefined()
  })

  it('clears a failed status when edits are reverted to the saved content', async () => {
    mountComposer()
    const body = await screen.findByLabelText('Body')
    update.mockRejectedValueOnce(new TypeError('offline'))
    fireEvent.change(body, { target: { value: 'Unsaved text' } })
    await screen.findByText('Not saved. Your next change tries again.')
    fireEvent.change(body, { target: { value: DRAFT.body_html } })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('keeps unrelated recipient controls stable during successive body keystrokes', async () => {
    mountComposer('/ledger/compose/12', 60000)
    const body = await screen.findByLabelText('Body')
    fireEvent.change(body, { target: { value: 'First' } })
    const renders = vi.mocked(LedgerAddresseesPicker).mock.calls.length
    fireEvent.change(body, { target: { value: 'Second' } })
    fireEvent.change(body, { target: { value: 'Latest' } })
    expect(vi.mocked(LedgerAddresseesPicker).mock.calls.length).toBe(renders)
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { body_html: 'Latest' }))
  })

  it.each(['en', 'ar'])('focuses subject and body validation after confirmation closes in %s', async (language) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    const send = vi.spyOn(api, 'saveAndSendLedgerDraft').mockRejectedValueOnce(new ApiError(422, 'DRAFT_SUBJECT_REQUIRED', 'Subject required'))
    mountComposer()
    const label = language === 'ar' ? ar.ledgerBook.composer.send.button : en.ledgerBook.composer.send.button
    await userEvent.click(await screen.findByRole('button', { name: label }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }))
    await waitFor(() => expect(screen.getByLabelText(i18n.t('ledgerBook.composer.subjects.line', { n: 1 }))).toHaveFocus())
    send.mockRejectedValueOnce(new ApiError(422, 'DRAFT_BODY_REQUIRED', 'Body required'))
    await userEvent.click(screen.getByRole('button', { name: label }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: label }))
    await waitFor(() => expect(screen.getByLabelText(i18n.t('ledgerBook.composer.body.label'))).toHaveFocus())
  })

  it('caches the accepted PATCH snapshot for reopening the same draft', async () => {
    const client = mountComposer()
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: '<p>Latest</p>' } })
    await waitFor(() => expect(client.getQueryData<LedgerDraftRead>(ledgerDraftKey(12))?.body_html).toBe('<p>Latest</p>'))
    await act(() => router.navigate('/employees'))
    await act(() => router.navigate('/ledger/compose/12'))
    expect(await screen.findByLabelText('Body')).toHaveValue('<p>Latest</p>')
    expect(api.getLedgerDraft).toHaveBeenCalledTimes(1)
  })

  it('stops claiming Saved immediately when another edit is pending', async () => {
    mountComposer()
    fireEvent.change(await screen.findByLabelText('Body'), { target: { value: 'First' } })
    await screen.findByText('Saved')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Second' } })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('gives the body editor the viewport column height with a 600px minimum', async () => {
    mountComposer()
    const body = await screen.findByLabelText('Body')
    expect(Number(body.getAttribute('data-editor-height'))).toBe(Math.max(600, Math.round(window.innerHeight * 0.85)))
  })

  it.each([
    ['en', 'Paper format', 'Book', 'Report', 'To recipients appear in the paper opening.'],
    ['ar', 'نوع الورقة', 'كتاب', 'تقرير', 'يظهر مستلمو «إلى» في افتتاحية الكتاب.'],
  ])('autosaves the paper preset in %s while keeping To available for Report', async (language, label, book, report, hint) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    mountComposer()
    const presets = await screen.findByRole('group', { name: label })
    expect(within(presets).getByRole('radio', { name: book })).toBeChecked()
    expect(screen.getByText(hint)).toBeInTheDocument()
    await userEvent.click(within(presets).getByRole('radio', { name: report }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { paper_preset: 'report' }))
    expect(screen.queryByText(hint)).not.toBeInTheDocument()
    expect(screen.getByLabelText(language === 'ar' ? 'إلى' : 'To')).toBeInTheDocument()
  })
  it('autosaves reference removal and outgoing folder selections independently', async () => {
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, reference_book_ids: [40] })
    vi.spyOn(api, 'getBook').mockReturnValue(Promise.race([]))
    vi.mocked(api.listBookFolders).mockResolvedValue([{ id: 1, name: 'Personnel', box: 'outgoing', team: false, count: 0, can_manage: true, created_by_name: 'Writer', created_by_name_ar: null, everyone: false, shared_users: [], shared_departments: [] }])
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Remove reference #40' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { reference_book_ids: [] }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Personnel' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { folder_ids: [1] }))
  })


  it('T-C2 autosaves only the changed fields and shows the saved state', async () => {
    mountComposer()
    expect(await screen.findByRole('heading', { name: /DRAFT 000012/ })).toBeInTheDocument()
    await userEvent.selectOptions(await screen.findByLabelText('Tab'), '2')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { tab: 2 }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Subject line 1'), '!')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { subjects: ['Leave plan!'] }))

    await userEvent.selectOptions(screen.getByLabelText('Grade'), 'secret')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { grade: 'secret' }))

    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { importance: 'high' }))
  })

  it('T-C2 a failed save shows an error and retries with the next edit', async () => {
    mountComposer()
    const body = await screen.findByLabelText('Body')
    update.mockRejectedValueOnce(new TypeError('offline'))
    fireEvent.change(body, { target: { value: '<p>Hello there</p>' } })
    expect(await screen.findByText('Not saved. Your next change tries again.')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Tab'), '1')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { tab: 1, body_html: '<p>Hello there</p>' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('T-C3 offers None, Medium and High; None clears importance with null', async () => {
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, importance: 'medium' })
    mountComposer()
    const group = await screen.findByRole('group', { name: 'Importance' })
    expect(within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['None', 'Medium', 'High'])
    expect(within(group).getByRole('radio', { name: 'Medium' })).toBeChecked()
    await userEvent.click(within(group).getByRole('radio', { name: 'None' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { importance: null }))
  })

  it('T-C4 adds, removes and reorders subject lines; the first is the subject; at most 20', async () => {
    mountComposer()
    const lines = (): string[] => screen.getAllByRole('textbox', { name: /^Subject line/ }).map((el) => (el as HTMLInputElement).value)
    expect(await screen.findByLabelText('Subject line 1')).toHaveAccessibleDescription(/The first line is the subject/)
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    await userEvent.type(screen.getByLabelText('Subject line 2'), 'Annex')
    await userEvent.click(screen.getByRole('button', { name: 'Move line 2 up' }))
    expect(lines()).toEqual(['Annex', 'Leave plan'])
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { subjects: ['Annex', 'Leave plan'] }))
    expect(screen.getByRole('button', { name: 'Move line 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move line 2 down' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Move line 1 down' }))
    expect(lines()).toEqual(['Leave plan', 'Annex'])
    await userEvent.click(screen.getByRole('button', { name: 'Remove line 1' }))
    expect(lines()).toEqual(['Annex'])
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { subjects: ['Annex'] }))
    // The last line cannot be removed: a book always has a subject line.
    expect(screen.getByRole('button', { name: 'Remove line 1' })).toBeDisabled()

    for (let i = 1; i < 20; i++) await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    expect(lines()).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'Add line' })).toBeDisabled()
  })

  it('T-C5 Save & Send asks first, then opens the issued book on the desk', async () => {
    const send = vi.spyOn(api, 'saveAndSendLedgerDraft').mockResolvedValue({ id: 40, ref_number: '1/2/7' } as LedgerBookRead)
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save & Send this Ledger Book?' })
    expect(dialog).toHaveTextContent('A reference number is allocated now. The manager signs first, then To and CC receive the book.')
    expect(send).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save & Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(12))
    expect(await screen.findByText('/ledger?tab=books&book=40')).toBeInTheDocument()
  })

  it('T-C5 DRAFT_TAB_REQUIRED shows its message at the Tab field', async () => {
    vi.spyOn(api, 'saveAndSendLedgerDraft').mockRejectedValue(new ApiError(422, 'DRAFT_TAB_REQUIRED', 'Choose the tab (التبويب) first.'))
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save & Send' }))
    await waitFor(() => expect(screen.getByLabelText('Tab')).toHaveAccessibleDescription('Choose the tab (classification) first.'))
    expect(screen.getByLabelText('Tab')).toBeInvalid()
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
  })

  it('shows the PDF preview and refreshes only after the latest edit is saved and quiet', async () => {
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    const paper = await screen.findByTitle('Ledger Book paper')
    await waitFor(() => expect(paper).toHaveAttribute('data-url', '/api/v1/ledger/drafts/12/paper.pdf?ts=2026-10-28T08%3A00%3A00Z'))
    const initialUrl = paper.getAttribute('data-url')
    let accept!: (value: LedgerDraftRead) => void
    update.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve }))
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: '<p>Changed</p>' } })
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(paper).toHaveAttribute('data-url', initialUrl)
    accept({ ...DRAFT, body_html: '<p>Changed</p>' })
    await waitFor(() => expect(paper.getAttribute('data-url')).not.toBe(initialUrl))
    expect(paper.getAttribute('data-url')).toMatch(/paper\.pdf\?ts=/)
    expect(screen.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Hide preview' }))
    expect(screen.queryByTitle('Ledger Book paper')).not.toBeInTheDocument()
  })

  it.each([['en', 'Preview', 'Hide preview', 'Ledger Book paper'], ['ar', 'معاينة', 'إخفاء المعاينة', 'ورقة كتاب السجل']])('uses a full-screen preview sheet at 390px in %s and restores focus', async (language, show, hide, title) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    vi.stubGlobal('innerWidth', 390)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)' && window.innerWidth <= 767, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    mountComposer()
    const trigger = await screen.findByRole('button', { name: show })
    await userEvent.click(trigger)
    const sheet = await screen.findByRole('dialog', { name: title })
    expect(sheet).toHaveClass('w-full', 'h-dvh')
    expect(within(sheet).getByTitle(title)).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: hide }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('blocks Save & Send until stale Addressee Only CC rows are removed', async () => {
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, grade: 'addressee_only', addressees: [...DRAFT.addressees, { role: 'cc', user_id: 9 }] })
    mountComposer()
    expect(await screen.findByRole('button', { name: 'Save & Send' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove all CC recipients' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { addressees: DRAFT.addressees }))
    expect(screen.getByRole('button', { name: 'Save & Send' })).toBeEnabled()
  })

  it('T-C1 /ledger/compose creates one draft and replaces the URL with it', async () => {
    const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
    mountComposer('/ledger/compose')
    expect(await screen.findByRole('heading', { name: /DRAFT 000012/ })).toBeInTheDocument()
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('T-F1 picks ordered internal To/CC, linked signer and saved external contacts, patching only changes', async () => {
    mountComposer()
    const to = await screen.findByLabelText('To')
    await within(to).findByRole('option', { name: /Sara/ })
    await userEvent.selectOptions(to, '9')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { addressees: [{ role: 'to', user_id: 8 }, { role: 'to', user_id: 9 }] }))
    await userEvent.selectOptions(screen.getByLabelText('CC'), '8')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { addressees: [{ role: 'to', user_id: 8 }, { role: 'to', user_id: 9 }, { role: 'cc', user_id: 8 }] }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Ali from To' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { addressees: [{ role: 'to', user_id: 9 }, { role: 'cc', user_id: 8 }] }))
    expect(screen.getByLabelText('Signing manager')).not.toHaveTextContent('Unlinked')
    await userEvent.selectOptions(screen.getByLabelText('Signing manager'), '')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { signer_manager_id: null }))
    await userEvent.click(screen.getByRole('radio', { name: 'External' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { external: true, addressees: [] }))
    await within(screen.getByLabelText('To')).findByRole('option', { name: /Partner/ })
    await userEvent.selectOptions(screen.getByLabelText('To'), '5')
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(12, { addressees: [{ role: 'to', contact_id: 5 }] }))
    expect(api.listLedgerContacts).toHaveBeenCalled()
  })

  it('T-F2 refuses missing To and signer at the field with focus and no confirmation', async () => {
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, addressees: [], signer_manager_id: null })
    const send = vi.spyOn(api, 'saveAndSendLedgerDraft')
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('To')).toHaveAccessibleDescription('Choose at least one To recipient.')
    expect(screen.getByLabelText('To')).toHaveFocus()
    await within(screen.getByLabelText('To')).findByRole('option', { name: /Ali/ })
    await userEvent.selectOptions(screen.getByLabelText('To'), '8')
    await userEvent.click(screen.getByRole('button', { name: 'Save & Send' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Signing manager')).toHaveAccessibleDescription('Choose a signing manager.')
    expect(screen.getByLabelText('Signing manager')).toHaveFocus()
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['DRAFT_TO_REQUIRED', 'To', 'Choose at least one To recipient.'],
    ['DRAFT_SIGNER_REQUIRED', 'Signing manager', 'Choose a signing manager.'],
    ['ADDRESSEE_INVALID', 'To', 'One or more recipients are unavailable or not cleared for this grade. Choose the recipients again.'],
    ['SIGNER_INVALID', 'Signing manager', 'Choose an active manager linked to a user account.'],
  ])('T-F2 maps %s to the matching field', async (code, field, message) => {
    vi.spyOn(api, 'saveAndSendLedgerDraft').mockRejectedValue(new ApiError(422, code, 'Server detail'))
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save & Send' }))
    await waitFor(() => expect(screen.getByLabelText(field)).toHaveAccessibleDescription(message))
    expect(screen.getByLabelText(field)).toBeInvalid()
  })
  it.each(['REFERENCE_INVALID', 'FOLDER_INVALID', 'GRADE_BELOW_FLOOR'])('shows %s beside the bottom-block field with focus', async (code) => {
    vi.spyOn(api, 'saveAndSendLedgerDraft').mockRejectedValue(new ApiError(422, code, 'Server detail', { min: 'secret' }))
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save & Send' }))
    const field = code === 'FOLDER_INVALID' ? screen.getByRole('group', { name: 'Copy to folder' }) : screen.getByLabelText('References')
    await waitFor(() => expect(field).toBeInvalid())
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription(expect.stringContaining(code === 'FOLDER_INVALID' ? en.ledgerBook.composer.errors.folderInvalid : code === 'REFERENCE_INVALID' ? en.ledgerBook.composer.errors.referenceInvalid : 'Secret'))
  })


  it('T-F2 autosave validation errors also appear at the recipient field', async () => {
    update.mockRejectedValueOnce(new ApiError(422, 'ADDRESSEE_INVALID', 'Invalid'))
    mountComposer()
    const to = await screen.findByLabelText('To')
    await within(to).findByRole('option', { name: /Sara/ })
    await userEvent.selectOptions(to, '9')
    await waitFor(() => expect(to).toHaveAccessibleDescription(en.ledgerBook.composer.errors.addresseeInvalid))
  })

  it('T-F7 Arabic composer labels, errors and action keys are peers of English', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, addressees: [], signer_manager_id: null })
    mountComposer()
    expect(await screen.findByLabelText('المدير الموقّع')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'داخلي' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'خارجي' })).toBeInTheDocument()
    expect(screen.getByLabelText('نسخة إلى')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'حفظ وإرسال' }))
    expect(screen.getByLabelText('إلى')).toHaveAccessibleDescription(ar.ledgerBook.composer.errors.toRequired)
    expect(Object.keys(ar.ledgerBook.actions).sort()).toEqual(Object.keys(en.ledgerBook.actions).sort())
    expect(Object.keys(ar.ledgerBook.composer.fields).sort()).toEqual(Object.keys(en.ledgerBook.composer.fields).sort())
    for (const text of Object.values(ar.ledgerBook.actions)) expect(text).toMatch(/[ء-ي]/)
  })

  it('T-F2 focuses missing To even while recipient choices are loading', async () => {
    vi.mocked(api.getLedgerDraft).mockResolvedValue({ ...DRAFT, addressees: [] })
    vi.mocked(api.listRecipientCandidates).mockReturnValue(Promise.race([]))
    mountComposer()
    await userEvent.click(await screen.findByRole('button', { name: 'Save & Send' }))
    expect(screen.getByLabelText('To')).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
