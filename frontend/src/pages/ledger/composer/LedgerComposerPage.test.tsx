import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { api, type LedgerDraftRead } from '@/lib/api'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
// HugeRTE can't mount in jsdom: a plain textarea stands in for the body editor.
vi.mock('./LedgerBodyEditor', () => ({
  LedgerBodyEditor: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { LedgerComposerPage } from './LedgerComposerPage'

const DRAFT: LedgerDraftRead = {
  id: 12, draft_number: '000012', tab: null, grade: 'unclassified', importance: null,
  subjects: ['Leave plan'], body_html: '<p>Hello</p>',
  created_at: '2026-10-28T08:00:00Z', updated_at: '2026-10-28T08:00:00Z',
}

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output aria-label="URL">{location.pathname + location.search}</output>
}

function mountComposer(url = '/ledger/compose/12'): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/ledger/compose/:draftId" element={<LedgerComposerPage autosaveMs={10} />} />
          <Route path="*" element={null} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

let update: MockInstance<typeof api.updateLedgerDraft>
beforeEach(() => {
  vi.spyOn(api, 'getLedgerDraft').mockResolvedValue(DRAFT)
  vi.spyOn(api, 'listBookClassifications').mockResolvedValue({
    items: [
      { code: '1/1', tab: 1, name_ar: 'الغيابات', name_en: 'Unexcused absences', unit_ar: '' },
      { code: '2/1', tab: 2, name_ar: 'محاضر الاجتماع', name_en: 'Meeting minutes', unit_ar: '' },
    ],
  })
  update = vi.spyOn(api, 'updateLedgerDraft').mockImplementation(async (_id, body) => ({ ...DRAFT, ...body } as LedgerDraftRead))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Ledger Book composer', () => {
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
})
