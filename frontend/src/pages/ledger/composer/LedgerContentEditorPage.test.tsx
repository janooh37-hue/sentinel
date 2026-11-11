import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerBookRead, type LedgerRevisionRead } from '@/lib/api'

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
  subjects: ['Leave plan'], body_html: '<p>Hello</p>', content_sha256: 'abc',
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

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C8 saving the content editor PUTs subjects and body, then returns to the desk', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(BOOK)
  const put = vi.spyOn(api, 'updateLedgerBookContent').mockResolvedValue(BOOK)
  mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Subject line 1'), ' (revised)')
  await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
  await userEvent.type(screen.getByLabelText('Subject line 2'), 'Annex')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(put).toHaveBeenCalledWith(40, { subjects: ['Leave plan (revised)', 'Annex'], body_html: '<p>Hello</p>' }))
  expect(await screen.findByText('/ledger?tab=books&book=40')).toBeInTheDocument()
})

it('T-C8 a locked Revision shows read-only', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue({ ...BOOK, revisions: [rev(1, true)], selected_version_id: 71 })
  const put = vi.spyOn(api, 'updateLedgerBookContent')
  mount()
  expect(await screen.findByText('This Revision is signed and locked. Start a correction to change it.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Subject line 1')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('data-url', '/api/v1/ledger/books/40/paper.pdf?revision=71')
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
  const { qc } = mount()
  expect(await screen.findByRole('heading', { name: /Edit .1\/2\/7/ })).toBeInTheDocument()
  get.mockResolvedValue({ ...BOOK, subjects: ['Changed elsewhere'], content_sha256: 'def' })
  await act(() => qc.invalidateQueries({ queryKey: ['ledger', 'books', 40] }))
  expect(await screen.findByDisplayValue('Changed elsewhere')).toBeInTheDocument()
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
  await act(async () => resolveSave({ ...BOOK, subjects: ['Leave plan (revised)'], content_sha256: 'saved' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  expect(screen.getByLabelText('URL')).toHaveTextContent(EDIT_URL)
  expect(screen.getByLabelText('Subject line 1')).toHaveValue('Leave plan (revised) more')
  await userEvent.click(screen.getByRole('link', { name: 'Back to Ledger' }))
  expect(await screen.findByRole('dialog', { name: DISCARD_TITLE })).toBeInTheDocument()
})
