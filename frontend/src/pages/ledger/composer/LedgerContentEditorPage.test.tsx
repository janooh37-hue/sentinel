import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerBookRead, type LedgerRevisionRead } from '@/lib/api'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('./LedgerBodyEditor', () => ({
  LedgerBodyEditor: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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
}

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output aria-label="URL">{location.pathname + location.search}</output>
}

function mount(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/ledger/books/40/edit']}>
        <Routes>
          <Route path="/ledger/books/:bookId/edit" element={<LedgerContentEditorPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
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
  expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('src', '/api/v1/ledger/books/40/paper?revision=71')
  expect(screen.getByRole('button', { name: 'Start correction' })).toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
})
