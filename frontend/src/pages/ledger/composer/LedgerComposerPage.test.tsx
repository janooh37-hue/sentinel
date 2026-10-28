import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { api, ApiError, type LedgerBookRead, type LedgerDraftRead } from '@/lib/api'

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
          <Route path="/ledger/compose" element={<LedgerComposerPage autosaveMs={10} />} />
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
    expect(dialog).toHaveTextContent('A reference number is allocated now. After that, the book can only change through a correction.')
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

  it('T-C7 Preview shows the draft paper in the sandboxed frame', async () => {
    mountComposer()
    const toggle = await screen.findByRole('button', { name: 'Preview' })
    expect(screen.queryByTitle('Ledger Book paper')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.getByTitle('Ledger Book paper')).toHaveAttribute('src', '/api/v1/ledger/drafts/12/paper')
    expect(screen.getByRole('button', { name: 'Hide preview' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('T-C1 /ledger/compose creates one draft and replaces the URL with it', async () => {
    const create = vi.spyOn(api, 'createLedgerDraft').mockResolvedValue(DRAFT)
    mountComposer('/ledger/compose')
    expect(await screen.findByRole('heading', { name: /DRAFT 000012/ })).toBeInTheDocument()
    expect(screen.getByLabelText('URL')).toHaveTextContent('/ledger/compose/12')
    expect(create).toHaveBeenCalledTimes(1)
  })
})
