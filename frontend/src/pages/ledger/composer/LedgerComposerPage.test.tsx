import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import i18n from 'i18next'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

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
  external: false, signer_manager_id: 3, addressees: [{ role: 'to', user_id: 8 }],
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
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await i18n.changeLanguage('en') })

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
