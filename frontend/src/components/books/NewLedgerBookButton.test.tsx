import { Fragment, StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'
import { LEDGER_DRAFTS_KEY, ledgerDraftKey } from './ledgerBookKeys'
import { NewLedgerBookButton } from './NewLedgerBookButton'

const DRAFT: LedgerDraftRead = {
  id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
  printed_cc: [], addressed_to: '', subjects: [], body_html: '', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
  external: false, signer_manager_id: null, addressees: [],
  paper_preset: 'normal', reference_book_ids: [], folder_ids: [],
}

function Where(): React.JSX.Element {
  return <output aria-label="Path">{useLocation().pathname}</output>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C1 creates a draft and opens it in the composer', async () => {
  const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ledger?tab=books']}>
        <Routes><Route path="*" element={<><NewLedgerBookButton /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New Ledger Book' }))
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][0]).toMatchObject({ grade: 'unclassified' })
  expect(await screen.findByText('/ledger/compose/12')).toBeInTheDocument()
  // The create response seeds the composer's draft query, so it does not refetch it.
  expect(client.getQueryData(ledgerDraftKey(12))).toEqual(DRAFT)
})

it('refreshes only the drafts list, leaving the seeded draft fresh', async () => {
  vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><NewLedgerBookButton /></MemoryRouter>
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New Ledger Book' }))
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: LEDGER_DRAFTS_KEY, exact: true }))
  expect(client.getQueryState(ledgerDraftKey(12))?.isInvalidated).toBe(false)
})

it.each([false, true])('does not redirect after leaving during creation (StrictMode: %s)', async (strict) => {
  let accept!: (draft: LedgerDraftRead) => void
  const create = vi.spyOn(api, 'createLedgerDraft').mockReturnValue(new Promise((resolve) => { accept = resolve }))
  const client = new QueryClient()
  client.setQueryData(LEDGER_DRAFTS_KEY, [])
  const Wrapper = strict ? StrictMode : Fragment
  render(
    <Wrapper>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/ledger']}>
          <Routes>
            <Route path="/ledger" element={<><NewLedgerBookButton /><Link to="/employees">Employees</Link></>} />
            <Route path="*" element={null} />
          </Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>
    </Wrapper>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New Ledger Book' }))
  expect(create).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('link', { name: 'Employees' }))
  await act(async () => { accept(DRAFT) })
  await waitFor(() => expect(client.getQueryState(LEDGER_DRAFTS_KEY)?.isInvalidated).toBe(true))
  expect(screen.getByLabelText('Path')).toHaveTextContent('/employees')
})

it('still opens an active creation visit after StrictMode effect replay', async () => {
  const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/ledger']}>
          <Routes><Route path="/ledger" element={<NewLedgerBookButton />} /><Route path="*" element={null} /></Routes>
          <Where />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New Ledger Book' }))
  expect(await screen.findByText('/ledger/compose/12')).toBeInTheDocument()
  expect(create).toHaveBeenCalledTimes(1)
})
