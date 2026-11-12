import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api, ApiError, type LedgerBookRead, type LedgerRevisionRead } from '@/lib/api'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('./LedgerBodyEditor', () => ({
  LedgerBodyEditor: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/books/LedgerPaperPdf', () => ({
  LedgerPaperPdf: ({ url }: { url: string | null }) => <div title="Ledger Book paper" data-url={url} />,
}))

import { LedgerContentEditorPage } from './LedgerContentEditorPage'

const rev = (n: number, locked: boolean): LedgerRevisionRead => ({
  version_id: 70 + n, version_no: n, trigger: n === 1 ? 'initial' : 'correction',
  created_at: '2026-10-28T08:00:00Z', signed_at: locked ? '2026-10-28T09:00:00Z' : null, superseded: false, locked,
})

const BOOK: LedgerBookRead = {
  id: 40, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
  paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false,
  revisions: [rev(1, true), rev(2, false)], selected_version_id: 72,
  printed_cc: [], addressed_to: 'HR director', subjects: ['Leave plan'], body_html: '<p>Hello</p>', content_sha256: 'abc',
  external: false, addressees: [], signer: null, can_sign: false, can_return: false, can_change_signer: false, can_resubmit: false, can_create_outlook_draft: false, return_note: null,
  paper_preset: 'normal', references: [], folders: [],
}

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output aria-label="URL">{location.pathname + location.search}</output>
}

const EDIT_URL = '/ledger/books/40/edit'
const DESK_URL = '/ledger?tab=books&book=40'
const DISCARD_TITLE = 'Discard unsaved changes?'

/** Opens the editor one step after `/records`, so history Back has somewhere to go. */
function mount(): { router: ReturnType<typeof createMemoryRouter>; qc: QueryClient } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [{
      element: <><Outlet /><Where /></>,
      children: [
        { path: '/ledger/books/:bookId/edit', element: <LedgerContentEditorPage /> },
        { path: '*', element: null },
      ],
    }],
    { initialEntries: ['/records', EDIT_URL], initialIndex: 1 },
  )
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>)
  return { router, qc }
}

async function openAndRevise(): Promise<void> {
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Subject line 1'), ' (revised)')
}

beforeEach(() => { vi.spyOn(api, 'listRecipients').mockResolvedValue([]) })

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('requires a printed salutation when saving a legacy correction and sends it with the content snapshot', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue({ ...BOOK, addressed_to: null })
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue(BOOK)
  mount()
  const salutation = await screen.findByRole('combobox', { name: 'Addressed to' })
  expect(salutation).toHaveValue('')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter the printed salutation.')
  expect(put).not.toHaveBeenCalled()
  await userEvent.type(salutation, 'مدير إدارة الموارد البشرية')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, {
    printed_cc: [], addressed_to: 'مدير إدارة الموارد البشرية', subjects: BOOK.subjects, body_html: BOOK.body_html,
    expected_version_id: 72, expected_content_sha256: 'abc',
  }))
})

it.each(['locked', 'replaced'] as const)('preserves a dirty correction when its revision is %s during refresh', async (change) => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent')
  const { qc } = mount()
  await openAndRevise()
  await userEvent.clear(screen.getByLabelText('Body'))
  await userEvent.type(screen.getByLabelText('Body'), '<p>Recover this body</p>')
  get.mockResolvedValue({ ...BOOK, subjects: ['New server subject'], body_html: '<p>New server body</p>',
    revisions: change === 'locked' ? [rev(1, true), rev(2, true)] : [...BOOK.revisions, rev(3, false)],
  })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Copy any text you need')
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  expect(screen.getByLabelText('Body')).toHaveValue('<p>Recover this body</p>')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  const form = screen.getByLabelText('Body').closest('form')!
  await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(put).not.toHaveBeenCalled()
  const unload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(unload)
  expect(unload.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(screen.getByLabelText('Body')).toHaveValue('<p>Recover this body</p>')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
  expect(await screen.findByText(DESK_URL)).toBeInTheDocument()
})

it('keeps the edit session when a pending save completes after a revision is locked', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  let resolveSave!: (book: LedgerBookRead) => void
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
  const { qc } = mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  get.mockResolvedValue({ ...BOOK, revisions: [rev(1, true), rev(2, true)] })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  await screen.findByRole('alert')
  await act(async () => resolveSave({ ...BOOK, subjects: ['Leave plan (revised)'] }))
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it('T-C8 saving the content editor PUTs subjects and body, then returns to the desk', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue(BOOK)
  mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Subject line 1'), ' (revised)')
  await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
  await userEvent.type(screen.getByLabelText('Subject line 2'), 'Annex')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, { printed_cc: [], addressed_to: 'HR director', subjects: ['Leave plan (revised)', 'Annex'], body_html: '<p>Hello</p>', expected_version_id: 72, expected_content_sha256: 'abc' }))
  expect(await screen.findByText('/ledger?tab=books&book=40')).toBeInTheDocument()
})

it('T-C8 a locked Revision shows read-only', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue({ ...BOOK, revisions: [rev(1, true)], selected_version_id: 71 })
  const put = vi.spyOn(api, 'updateLedgerBookContent')
  mount()
  expect(await screen.findByText('This Revision is signed and locked. Start a correction to change it.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Subject line 1')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('data-url', '/api/v1/ledger/books/40/paper.pdf?revision=71&v=abc')
  expect(screen.getByRole('button', { name: 'Start correction' })).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
})

it('a dirty edit blocks the header Back link until the writer discards it', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)

  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  expect(screen.getByRole('link', { name: 'Back to Ledger' })).toHaveFocus()

  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
  expect(await screen.findByText(DESK_URL)).toBeInTheDocument()
})

it('a dirty edit blocks Cancel and browser Back; Escape keeps the edit', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const { router } = mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

  await act(() => router.navigate(-1))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(await screen.findByText('/records')).toBeInTheDocument()
})

it('an untouched editor leaves without asking', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByText(DESK_URL)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('warns on reload only while the edit is dirty', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  const clean = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)

  await userEvent.type(screen.getByLabelText('Subject line 1'), ' (revised)')
  const dirty = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(dirty)
  expect(dirty.defaultPrevented).toBe(true)
})

it('a failed save keeps the form, and leaving still asks', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockRejectedValue(new Error('boom'))
  mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
})

it('a saved correction marks the desk queries stale and returns without asking', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'def' })
  const { qc } = mount()
  const routing = ['books', 'routing', { tab: 2 }]
  const detail = ['books', 'detail', 40]
  qc.setQueryData(routing, { items: [{ id: 40, subject: 'Leave plan' }] })
  qc.setQueryData(detail, { id: 40, subject: 'Leave plan' })
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(DESK_URL)).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(qc.getQueryState(routing)?.isInvalidated).toBe(true)
  expect(qc.getQueryState(detail)?.isInvalidated).toBe(true)
})

it('a background refetch with new content does not drop what the writer typed', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const { qc } = mount()
  await openAndRevise()
  get.mockResolvedValue({ ...BOOK, subjects: ['Changed elsewhere'], content_sha256: 'def' })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
})

it('a background refetch refreshes an untouched form', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue(BOOK)
  const { qc } = mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  get.mockResolvedValue({ ...BOOK, subjects: ['Changed elsewhere'], content_sha256: 'def' })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  expect(await screen.findByDisplayValue('Changed elsewhere')).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Subject line 1'), ' edited')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, expect.objectContaining({ expected_content_sha256: 'def' })))
})

it('keeps edits typed while an earlier save is in flight', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  let resolveSave!: (book: LedgerBookRead) => void
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
  mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  await userEvent.type(screen.getByLabelText('Subject line 1'), ' more')
  await userEvent.type(screen.getByLabelText('Addressed to'), ' amended')
  await act(async () => resolveSave({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'saved' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised) more')
  expect(screen.getByLabelText('Addressed to')).toHaveValue('HR director amended')
  put.mockResolvedValue({ ...BOOK, subjects: ['Leave plan (revised) more'], content_sha256: 'saved-again' })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenLastCalledWith(40, expect.objectContaining({ expected_version_id: 72, expected_content_sha256: 'saved' })))
  expect(await screen.findByText(DESK_URL)).toBeInTheDocument()
})

it('retains the edited baseline after a dirty refetch and preserves text on conflict', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockRejectedValue(new ApiError(409, 'CONTENT_CONFLICT', 'Content changed'))
  const { qc } = mount()
  await openAndRevise()
  get.mockResolvedValue({ ...BOOK, subjects: ['Changed elsewhere'], content_sha256: 'newer' })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, expect.objectContaining({ expected_version_id: 72, expected_content_sha256: 'abc' })))
  expect(await screen.findByRole('alert')).toHaveTextContent('Copy any text you need')
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
})

it.each(['success', 'error'])('protects a revert across a refresh while the pending save ends in %s', async (outcome) => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  let resolveSave!: (book: LedgerBookRead) => void
  let rejectSave!: (error: Error) => void
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockReturnValue(new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject }))
  const { qc } = mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  await userEvent.clear(screen.getByLabelText('Subject line 1'))
  await userEvent.type(screen.getByLabelText('Subject line 1'), 'Leave plan')
  get.mockResolvedValue({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'saved' })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan')
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  await act(async () => {
    if (outcome === 'success') resolveSave({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'saved' })
    else rejectSave(new Error('Response lost after persistence'))
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan')
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
})

it('does not redirect after the writer discards and a pending save completes', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  let resolveSave!: (book: LedgerBookRead) => void
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockReturnValue(new Promise((resolve) => { resolveSave = resolve }))
  const { router } = mount()
  await openAndRevise()
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  await act(() => router.navigate(-1))
  await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }))
  expect(await screen.findByText('/records')).toBeInTheDocument()
  await act(async () => resolveSave({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'saved' }))
  expect(screen.getByLabelText('URL')).toHaveTextContent('/records')
})

it('retains dirty corrections through a failed background refresh and retry', async () => {
  const get = vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const { qc } = mount()
  await openAndRevise()
  get.mockRejectedValueOnce(new Error('Refresh unavailable'))
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised)')
})

it('maps legacy printed CC from its Arabic snapshot and permits an explicit clear in a correction', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue({ ...BOOK, printed_cc: null, addressees: [{ role: 'cc', user_id: 8, contact_id: null, name: 'HR director', name_ar: 'مدير الموارد البشرية', email: null, g_number: null }] })
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue({ ...BOOK, printed_cc: [] })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: /Remove.*مدير الموارد البشرية/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, expect.objectContaining({ printed_cc: [] })))
})

it('preserves printed CC typed after submitting a correction', async () => {
  vi.mocked(api.listRecipients).mockResolvedValue([{ id: 91, name: 'HR director', name_ar: null }, { id: 92, name: 'Office', name_ar: null }])
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  let resolve!: (value: LedgerBookRead) => void
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockImplementationOnce(() => new Promise((accept) => { resolve = accept }))
  mount()
  await userEvent.click(await screen.findByRole('combobox', { name: 'Printed CC' }))
  await userEvent.click(await screen.findByRole('option', { name: 'HR director' }))
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, expect.objectContaining({ printed_cc: ['HR director'] })))
  await userEvent.click(screen.getByRole('combobox', { name: 'Printed CC' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Office' }))
  await act(async () => resolve({ ...BOOK, printed_cc: ['HR director'], content_sha256: 'saved' }))
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  put.mockResolvedValue({ ...BOOK, printed_cc: ['HR director', 'Office'] })
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenLastCalledWith(40, expect.objectContaining({ printed_cc: ['HR director', 'Office'], expected_content_sha256: 'saved' })))
})
