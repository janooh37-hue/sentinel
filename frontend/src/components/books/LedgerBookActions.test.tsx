import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerBookRead, type LedgerRevisionRead } from '@/lib/api'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))

import { LedgerBookActions } from './LedgerBookActions'

const rev = (n: number, locked: boolean): LedgerRevisionRead => ({
  version_id: 70 + n, version_no: n, trigger: n === 1 ? 'initial' : 'correction',
  created_at: '2026-10-28T08:00:00Z', signed_at: locked ? '2026-10-28T09:00:00Z' : null, superseded: false, locked,
})

const book = (revisions: LedgerRevisionRead[], over: Partial<LedgerBookRead> = {}): LedgerBookRead => ({
  id: 40, ref_number: '1/2/7', grade: 'unclassified', importance: null, tab: 2, classification_code: '2/1',
  paper_date: '28-10-2026', approval_state: 'none', created_by_user_id: 1, voided: false, revisions,
  selected_version_id: revisions.at(-1)!.version_id, subjects: ['Leave plan'], body_html: '<p>x</p>', content_sha256: 'abc', ...over,
})

function Where(): React.JSX.Element {
  return <output aria-label="URL">{useLocation().pathname}</output>
}

function mount(onRevisionChange = vi.fn()): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/ledger']}>
        <Routes><Route path="*" element={<><LedgerBookActions bookId={40} onRevisionChange={onRevisionChange} /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C8 Start correction on a signed Revision opens the content editor', async () => {
  vi.spyOn(api, 'getLedgerBook').mockResolvedValue(book([rev(1, true)]))
  const start = vi.spyOn(api, 'startLedgerCorrection').mockResolvedValue(book([rev(1, true), rev(2, false)]))
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Start correction' }))
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
