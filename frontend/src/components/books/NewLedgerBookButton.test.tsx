import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'
import { NewLedgerBookButton } from './NewLedgerBookButton'

const DRAFT: LedgerDraftRead = {
  id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
  subjects: [], body_html: '', created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
}

function Where(): React.JSX.Element {
  return <output aria-label="Path">{useLocation().pathname}</output>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C1 creates a draft and opens it in the composer', async () => {
  const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/ledger?tab=books']}>
        <Routes><Route path="*" element={<><NewLedgerBookButton /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'New Ledger Book' }))
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][0]).toMatchObject({ grade: 'unclassified' })
  expect(await screen.findByText('/ledger/compose/12')).toBeInTheDocument()
})
