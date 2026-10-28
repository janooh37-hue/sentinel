import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'
import { LedgerDraftsList } from './LedgerDraftsList'

const draft = (over: Partial<LedgerDraftRead>): LedgerDraftRead => ({
  id: 12, draft_number: '000012', tab: 2, grade: 'unclassified', importance: null,
  subjects: ['Leave plan', 'Annex A'], body_html: '<p>x</p>',
  created_at: '2026-10-27T08:00:00Z', updated_at: '2026-10-28T09:30:00Z', ...over,
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('T-C6 lists my drafts with label, first subject and updated date; delete asks first', async () => {
  const list = vi.spyOn(api, 'listLedgerDrafts')
    .mockResolvedValueOnce([draft({}), draft({ id: 13, draft_number: '000013', subjects: [] })])
    .mockResolvedValue([draft({ id: 13, draft_number: '000013', subjects: [] })])
  const remove = vi.spyOn(api, 'deleteLedgerDraft').mockResolvedValue(undefined)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><LedgerDraftsList /></MemoryRouter>
    </QueryClientProvider>,
  )
  const first = await screen.findByRole('link', { name: /DRAFT 000012/ })
  expect(first).toHaveAttribute('href', '/ledger/compose/12')
  expect(first).toHaveTextContent('Leave plan')
  expect(first).not.toHaveTextContent('Annex A')
  expect(first.closest('li')).toHaveTextContent(/Updated .*2026/)
  expect(first.closest('li')).toHaveTextContent(/Updated .28\/10\/2026/)

  await userEvent.click(screen.getByRole('button', { name: 'Delete DRAFT 000012' }))
  const dialog = await screen.findByRole('dialog', { name: 'Delete this draft?' })
  expect(remove).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete draft' }))
  await waitFor(() => expect(remove).toHaveBeenCalledWith(12))
  await waitFor(() => expect(screen.queryByRole('link', { name: /DRAFT 000012/ })).not.toBeInTheDocument())
  expect(list).toHaveBeenCalledTimes(2)
})
