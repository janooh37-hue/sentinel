import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type * as RouterModule from 'react-router-dom'
import type { ReactNode } from 'react'
import { toast } from '@/lib/toast'

import { api, ApiError, type BookRead, type BookThreadItem } from '@/lib/api'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import { DeriveRecordDialog } from './DeriveRecordDialog'
import { LinkRecordDialog } from './LinkRecordDialog'
import { RecordThreadSection } from './RecordThreadSection'
import { SendRecordDialog } from './SendRecordDialog'
import { useReplyActions } from './useReplyActions'
import { RecordInboxStrip } from './RecordRecipientsPanel'

const { navigate, auth } = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: { role: 'operator', authenticated: true, denied: new Set<string>() },
}))
vi.mock('react-router-dom', async (original) => ({
  ...await original<typeof RouterModule>(),
  useNavigate: () => navigate,
}))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: auth.authenticated ? { id: 1, role: auth.role } : null }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => !auth.denied.has(cap) }) }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }))

const BOOK: BookRead = {
  id: 7, ref_number: '1/1/196', category_id: 'GS',
  category: { id: 'GS', name_ar: 'عام', name_en: 'General', requires_approval: false, prefix: 'G' },
  subject: 'Original subject', direction: null, stamp_style: null, approval_state: 'none',
  created_at: '2026-07-01T00:00:00Z', deleted_at: null, urgency: 'Normal', is_draft: false,
  voided_at: null, edit_session: null, classification_code: '1/1', is_word_book: false,
  service_id: 'General Book', versions: [], doc_manager_has_signature: false, current_template_id: null,
  included_papers_revision: 0, included_papers_fixed_page_count: 0, included_papers_total_page_count: 0,
  access_scope: 'full', can_write: true, can_sign: false, can_review: false,
  grade: 'unclassified', distribution: 'named', metadata_only: false, can_send: true, can_change_grade: true,
}
const REFERENCE: BookThreadItem = {
  book_id: 8, ref_number: 'REF-8', subject: 'Reference subject', grade: 'secret', distribution: 'named',
  created_at: '2026-07-01T00:00:00Z', approval_state: 'none', direction: 'outgoing',
  kind: 'reply', attached: true, can_unlink: true, addressee_user_id: 12, current_document_id: 80,
}

function mount(node: ReactNode): { qc: QueryClient; view: RenderResult } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  )
  return { qc, view: render(node, { wrapper }) }
}

function Actions({ book = BOOK, openOverlay }: { book?: BookRead; openOverlay?: (key: string) => void }): React.JSX.Element {
  const reply = useReplyActions(book, openOverlay)
  return <>{reply.actions.map((action) => <button key={action.key} onClick={action.onSelect}>{action.label}</button>)}{reply.dialog}</>
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  auth.role = 'operator'
  auth.authenticated = true
  auth.denied.clear()
  vi.spyOn(api, 'getBookThread').mockResolvedValue([])
})
afterEach(cleanup)

describe('derive and reply actions', () => {
  it('inherits the original grade for replies without a grade picker and opens the created Word draft', async () => {
    const derive = vi.spyOn(api, 'deriveBook').mockResolvedValue({
      book_id: 99, ref_number: 'NEW-99', token: 'token', filename: 'reply.docx', word_url: '/word', dav_url: '/dav',
    })
    const { qc } = mount(<DeriveRecordDialog book={{ ...BOOK, grade: 'secret' }} kind="reply" open onOpenChange={vi.fn()} />)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    expect(screen.queryByRole('combobox', { name: 'Grade' })).toBeNull()
    expect(screen.getByRole('checkbox', { name: 'Attach the original as reference' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(derive).toHaveBeenCalledWith(7, {
      kind: 'reply', attach_reference: true, classification_code: '1/1',
    }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/books/99/word'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
  })

  it('requires the shared General Book classification picker only when the original lacks one', async () => {
    vi.spyOn(api, 'listBookClassifications').mockResolvedValue({
      items: [{ code: '2/1', tab: 2, name_ar: 'شؤون الموظفين', name_en: 'Personnel', unit_ar: '' }],
    })
    const derive = vi.spyOn(api, 'deriveBook').mockResolvedValue({
      book_id: 99, ref_number: 'NEW-99', token: 'token', filename: 'copy.docx', word_url: '/word', dav_url: '/dav',
    })
    mount(<DeriveRecordDialog book={{ ...BOOK, classification_code: null }} kind="based_on" open onOpenChange={vi.fn()} />)
    const submit = screen.getByRole('button', { name: 'Create from' })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('combobox', { name: /Classification/ }))
    await userEvent.click(await screen.findByRole('option', { name: /2\/1/ }))
    await userEvent.click(submit)
    await waitFor(() => expect(derive).toHaveBeenCalledWith(7, {
      kind: 'based_on', grade: 'unclassified', attach_reference: true, classification_code: '2/1',
    }))
  })

  it.each([
    ['GRADE_BELOW_FLOOR', en.books.thread.errors.levelFloor],
    ['CLASSIFICATION_REQUIRED', en.books.thread.errors.classificationRequired],
    ['SECRET_CLEARANCE_REQUIRED', en.books.thread.errors.secretClearance],
    ['FORBIDDEN', en.books.thread.errors.forbidden],
  ])('maps derive error %s', async (code, message) => {
    vi.spyOn(api, 'deriveBook').mockRejectedValue(new ApiError(422, code, 'Server error'))
    mount(<DeriveRecordDialog book={BOOK} kind="reply" open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: /Classification/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, expect.anything()))
  })

  it('exports read-only reply actions and never carries an open dialog to a different record', async () => {
    const { view } = mount(<Actions book={{ ...BOOK, can_write: false }} />)
    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Create from' }))
    expect(screen.getByRole('dialog', { name: 'Create from' })).toBeVisible()
    view.rerender(<Actions book={{ ...BOOK, id: 9 }} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['inmate_reporter', 'anonymous', 'assigned_revision', 'books.create', 'books.view'])(
    'hides actions and the derive dialog for %s',
    (denial) => {
      if (denial === 'inmate_reporter') auth.role = denial
      if (denial === 'anonymous') auth.authenticated = false
      if (denial.startsWith('books.')) auth.denied.add(denial)
      const book: BookRead = denial === 'assigned_revision' ? { ...BOOK, access_scope: 'assigned_revision' } : BOOK
      const { view } = mount(<><Actions book={book} /><DeriveRecordDialog book={book} kind="reply" open onOpenChange={vi.fn()} /></>)
      expect(view.container).toBeEmptyDOMElement()
    },
  )

  it('delegates both descriptor actions to the shared overlay without mounting another dialog', async () => {
    const openOverlay = vi.fn()
    mount(<Actions openOverlay={openOverlay} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create from' }))
    expect(openOverlay.mock.calls).toEqual([['reply'], ['createFrom']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it.each(['books.service.General Book', 'books.category.1/1'])('hides Reply and Create from without %s, which the server requires to create the draft', (cap) => {
    auth.denied.add(cap)
    mount(<Actions />)
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create from' })).toBeNull()
  })

  it('resets grade and attachment choices when reopening, and obeys a changed original floor', async () => {
    const derive = vi.spyOn(api, 'deriveBook').mockResolvedValue({
      book_id: 99, ref_number: 'NEW-99', token: 'token', filename: 'copy.docx', word_url: '/word', dav_url: '/dav',
    })
    const close = vi.fn()
    const { view } = mount(<DeriveRecordDialog book={BOOK} kind="based_on" open onOpenChange={close} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grade' }), 'addressee_only')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Attach the original as reference' }))
    view.rerender(<DeriveRecordDialog book={BOOK} kind="based_on" open={false} onOpenChange={close} />)
    view.rerender(<DeriveRecordDialog book={BOOK} kind="based_on" open onOpenChange={close} />)
    expect(screen.getByRole('combobox', { name: 'Grade' })).toHaveValue('unclassified')
    expect(screen.getByRole('checkbox', { name: 'Attach the original as reference' })).toBeChecked()
    view.rerender(<DeriveRecordDialog book={{ ...BOOK, grade: 'secret' }} kind="based_on" open onOpenChange={close} />)
    expect(screen.getByRole('combobox', { name: 'Grade' })).toHaveValue('secret')
    await userEvent.click(screen.getByRole('button', { name: 'Create from' }))
    await waitFor(() => expect(derive).toHaveBeenCalledWith(7, {
      kind: 'based_on', grade: 'secret', attach_reference: true, classification_code: '1/1',
    }))
  })

  it('offers Reply and Create from on a received strip without losing the inbox tools', async () => {
    mount(<RecordInboxStrip book={{
      ...BOOK, can_write: false,
      my_inbox: {
        id: 1, sent_by_user_id: 12, sent_by_name: 'Sender', sent_by_name_ar: 'المرسل',
        purpose: 'reply', note: null, sent_at: '2026-07-01T00:00:00Z',
        read_at: null, done_at: null, archived_at: null,
      },
    }} />)
    const strip = screen.getByTestId('record-inbox-strip')
    expect(within(strip).getByRole('button', { name: 'Create from' })).toBeEnabled()
    expect(within(strip).getByRole('button', { name: en.books.inbox.done })).toBeEnabled()
    expect(within(strip).getByRole('button', { name: en.books.inbox.archive })).toBeEnabled()
    await userEvent.click(within(strip).getByRole('button', { name: 'Reply' }))
    expect(screen.getByRole('dialog', { name: 'Reply' })).toBeVisible()
  })
})

describe('reference picker and thread', () => {
  it('excludes the current record, debounces search and invalidates thread and detail when linking', async () => {
    const list = vi.spyOn(api, 'listBooks').mockResolvedValue({
      items: [BOOK, { ...BOOK, id: 8, ref_number: 'REF-8' }, { ...BOOK, id: 9, ref_number: 'LIMITED-9', access_scope: 'assigned_revision' }],
      total: 3,
      limit: 20, offset: 0,
    })
    const link = vi.spyOn(api, 'linkBook').mockResolvedValue(REFERENCE)
    const close = vi.fn()
    const { qc } = mount(<LinkRecordDialog book={BOOK} open onOpenChange={close} />)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    expect(await screen.findByRole('button', { name: /REF-8/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /1\/1\/196/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /LIMITED-9/ })).toBeNull()
    const calls = list.mock.calls.length
    await userEvent.type(screen.getByRole('searchbox'), 'needle')
    expect(list).toHaveBeenCalledTimes(calls)
    await waitFor(() => expect(list).toHaveBeenCalledWith({ q: 'needle', limit: 20 }))
    await userEvent.click(await screen.findByRole('button', { name: /REF-8/ }))
    await waitFor(() => expect(link).toHaveBeenCalledWith(7, { target_book_id: 8 }))
    await waitFor(() => expect(close).toHaveBeenCalledWith(false))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'thread', 7] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'detail', 7] })
  })

  it.each([
    ['LINK_EXISTS', en.books.thread.errors.linkExists],
    ['LINK_SELF', en.books.thread.errors.linkSelf],
    ['GRADE_BELOW_FLOOR', en.books.thread.errors.levelBelowFloor],
    ['BOOK_NOT_FOUND', en.books.thread.errors.bookNotFound],
  ])('maps link error %s', async (code, message) => {
    vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [{ ...BOOK, id: 8, ref_number: 'REF-8' }], total: 1, limit: 20, offset: 0 })
    vi.spyOn(api, 'linkBook').mockRejectedValue(new ApiError(422, code, 'Server error'))
    mount(<LinkRecordDialog book={BOOK} open onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /REF-8/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
  })

  it('shows attached outgoing references, preserves thread order and unlinks with both invalidations', async () => {
    vi.mocked(api.getBookThread).mockResolvedValue([
      REFERENCE,
      { ...REFERENCE, book_id: 9, ref_number: 'REF-9', kind: 'based_on', attached: false, can_unlink: false },
      { ...REFERENCE, book_id: 10, ref_number: 'REF-10', direction: 'incoming', can_unlink: false },
    ])
    const unlink = vi.spyOn(api, 'unlinkBook').mockResolvedValue(undefined)
    const { qc } = mount(<RecordThreadSection book={BOOK} />)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const refs = await screen.findByRole('region', { name: 'References' })
    expect(within(refs).getAllByRole('listitem')).toHaveLength(1)
    expect(within(refs).getByRole('link', { name: /REF-8/ })).toHaveAttribute('href', '/books/8')
    expect(within(refs).getByText('REF-8')).toHaveAttribute('dir', 'ltr')
    expect(within(refs).getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', api.documentDownloadUrl(80, 'pdf'))
    const thread = screen.getByRole('region', { name: 'Thread' })
    expect(within(thread).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/books/8', '/books/9', '/books/10'])
    expect(within(thread).getByText('Reply to')).toBeVisible()
    expect(within(thread).getByText('Created from')).toBeVisible()
    expect(within(thread).getByText('Replied by')).toBeVisible()
    vi.mocked(api.getBookThread).mockResolvedValue([
      { ...REFERENCE, attached: false, can_unlink: false },
      { ...REFERENCE, book_id: 9, ref_number: 'REF-9', kind: 'based_on', attached: false, can_unlink: false },
      { ...REFERENCE, book_id: 10, ref_number: 'REF-10', direction: 'incoming', can_unlink: false },
    ])
    await userEvent.click(within(refs).getByRole('button', { name: 'Remove reference' }))
    await waitFor(() => expect(unlink).toHaveBeenCalledWith(7, 8))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'thread', 7] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'detail', 7] })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'References' })).toBeNull())
    expect(within(screen.getByRole('region', { name: 'Thread' })).getByRole('link', { name: /REF-8/ })).toBeVisible()
  })

  it('does not search or expose linking when the current record is read-only or revision-scoped', () => {
    const list = vi.spyOn(api, 'listBooks')
    const readonly = mount(<LinkRecordDialog book={{ ...BOOK, can_write: false }} open onOpenChange={vi.fn()} />)
    expect(readonly.view.container).toBeEmptyDOMElement()
    readonly.view.unmount()
    const limited = mount(<LinkRecordDialog book={{ ...BOOK, access_scope: 'assigned_revision' }} open onOpenChange={vi.fn()} />)
    expect(limited.view.container).toBeEmptyDOMElement()
    expect(list).not.toHaveBeenCalled()
  })

  it('denies linking and unlinking without books.edit even when can_write is true, without denying derivation', async () => {
    auth.denied.add('books.edit')
    vi.mocked(api.getBookThread).mockResolvedValue([REFERENCE])
    const list = vi.spyOn(api, 'listBooks')
    const link = vi.spyOn(api, 'linkBook')
    const unlink = vi.spyOn(api, 'unlinkBook')
    mount(<><Actions /><LinkRecordDialog book={BOOK} open onOpenChange={vi.fn()} /><RecordThreadSection book={BOOK} /></>)
    const refs = await screen.findByRole('region', { name: 'References' })
    expect(within(refs).getByRole('link', { name: /REF-8/ })).toBeVisible()
    expect(within(refs).queryByRole('button', { name: 'Remove reference' })).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reply' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Create from' })).toBeEnabled()
    expect(list).not.toHaveBeenCalled()
    expect(link).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('does not fetch or display cached thread data for revision-scoped access', () => {
    const limitedBook: BookRead = { ...BOOK, access_scope: 'assigned_revision' }
    const { qc, view } = mount(<RecordThreadSection book={limitedBook} />)
    qc.setQueryData(['books', 'thread', BOOK.id], [REFERENCE])
    view.rerender(<RecordThreadSection book={limitedBook} />)
    expect(api.getBookThread).not.toHaveBeenCalled()
    expect(view.container).toBeEmptyDOMElement()
  })

  it('allows opening a reference without a PDF and hides unlink after write access is lost', async () => {
    vi.mocked(api.getBookThread).mockResolvedValue([{ ...REFERENCE, current_document_id: null }])
    mount(<RecordThreadSection book={{ ...BOOK, can_write: false }} />)
    const refs = await screen.findByRole('region', { name: 'References' })
    expect(within(refs).getByRole('link', { name: /REF-8/ })).toHaveAttribute('href', '/books/8')
    expect(within(refs).queryByRole('link', { name: 'Open PDF' })).toBeNull()
    expect(within(refs).queryByRole('button', { name: 'Remove reference' })).toBeNull()
  })

  it('retains references and reports an unlink failure', async () => {
    vi.mocked(api.getBookThread).mockResolvedValue([REFERENCE])
    vi.spyOn(api, 'unlinkBook').mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Cannot unlink'))
    mount(<RecordThreadSection book={BOOK} />)
    const refs = await screen.findByRole('region', { name: 'References' })
    await userEvent.click(within(refs).getByRole('button', { name: 'Remove reference' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(within(refs).getByRole('link', { name: /REF-8/ })).toBeVisible()
  })

  it('renders nothing for an empty thread', async () => {
    const { view } = mount(<RecordThreadSection book={BOOK} />)
    await waitFor(() => expect(api.getBookThread).toHaveBeenCalledWith(7))
    expect(view.container).toBeEmptyDOMElement()
  })
})

describe('send with references', () => {

  it.each(['top_secret', 'addressee_only'] as const)(
    'hides %s distribution and disables queries for a non-writer',
    (grade) => {
      const candidates = vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([])
      const { view } = mount(<SendRecordDialog book={{ ...BOOK, grade, created_by_user_id: 2 }} open onOpenChange={vi.fn()} />)
      expect(view.container).toBeEmptyDOMElement()
      expect(candidates).not.toHaveBeenCalled()
      expect(api.getBookThread).not.toHaveBeenCalled()
    },
  )

  it.each(['top_secret', 'addressee_only'] as const)(
    'allows the writer to distribute a %s record',
    async (grade) => {
      vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
        { id: 12, name: 'Recipient', role: 'operator', has_secret_clearance: false },
      ])
      mount(<SendRecordDialog book={{ ...BOOK, grade, created_by_user_id: 1 }} open onOpenChange={vi.fn()} />)
      expect(await screen.findByRole('checkbox', { name: 'Recipient' })).toBeVisible()
    },
  )
  it('initializes reply defaults on opening, defaults references on, sends opt-out and reports skip reasons', async () => {
    vi.mocked(toast.loading).mockReturnValueOnce('send-toast')
    vi.mocked(api.getBookThread).mockResolvedValue([REFERENCE])
    vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
      { id: 12, name: 'Recipient', name_ar: 'المستلم', role: 'operator', has_secret_clearance: false },
    ])
    const send = vi.spyOn(api, 'sendBook').mockResolvedValue({
      sent: [], skipped: [], references: [{ book_id: 8, ref_number: 'REF-8', sent_user_ids: [12], skipped: [
        { user_id: 12, reason: 'not_cleared' }, { user_id: 12, reason: 'writer_only' },
      ] }],
    })
    const { view } = mount(<SendRecordDialog book={BOOK} open onOpenChange={vi.fn()} />)
    expect(await screen.findByRole('checkbox', { name: 'Recipient' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'For reply' })).toBeChecked()
    const references = await screen.findByRole('checkbox', { name: 'Also send referenced records (1)' })
    expect(references).toBeChecked()
    await userEvent.click(references)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(7, {
      user_ids: [12], purpose: 'reply', note: null, include_references: false,
    }))
    expect(toast.loading).toHaveBeenCalledWith('Sending record…')
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Nothing new was sent', {
      id: 'send-toast',
      reference: BOOK.ref_number,
      description: expect.stringContaining('Reference deliveries: 1 sent, 2 skipped.'),
    }))
    const description = vi.mocked(toast.info).mock.calls[0]?.[1]?.description
    expect(description).toEqual(expect.stringContaining('does not have the required grade clearance'))
    expect(description).toEqual(expect.stringContaining('Only the writer can distribute this record'))
    view.rerender(<SendRecordDialog book={BOOK} open={false} onOpenChange={vi.fn()} />)
    vi.mocked(api.getBookThread).mockResolvedValue([])
    view.rerender(<SendRecordDialog book={{ ...BOOK, id: 9 }} open onOpenChange={vi.fn()} />)
    expect(await screen.findByRole('radio', { name: 'For information' })).toBeChecked()
    expect(await screen.findByRole('checkbox', { name: 'Recipient' })).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /Also send referenced records/ })).toBeNull()
  })

  it('includes live references by default without inventing reply defaults for ordinary references', async () => {
    vi.mocked(api.getBookThread).mockResolvedValue([{ ...REFERENCE, kind: 'reference', addressee_user_id: null }])
    vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue([
      { id: 12, name: 'Recipient', role: 'operator', has_secret_clearance: false },
    ])
    const send = vi.spyOn(api, 'sendBook').mockResolvedValue({ sent: [], skipped: [], references: [] })
    mount(<SendRecordDialog book={BOOK} open onOpenChange={vi.fn()} />)
    const recipient = await screen.findByRole('checkbox', { name: 'Recipient' })
    expect(recipient).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'For information' })).toBeChecked()
    await userEvent.click(recipient)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(7, {
      user_ids: [12], purpose: 'info', note: null, include_references: true,
    }))
  })

  it.each(['missing', 'uncleared'])('does not preselect a reply sender unavailable to the %s directory', async (kind) => {
    vi.mocked(api.getBookThread).mockResolvedValue([REFERENCE])
    const eligible = { id: 13, name: 'Eligible recipient', role: 'operator', has_secret_clearance: true }
    vi.spyOn(api, 'listRecipientCandidates').mockResolvedValue(kind === 'uncleared'
      ? [{ id: 12, name: 'Original sender', role: 'operator', has_secret_clearance: false }, eligible]
      : [eligible])
    const send = vi.spyOn(api, 'sendBook').mockResolvedValue({ sent: [], skipped: [], references: [] })
    mount(<SendRecordDialog book={{ ...BOOK, grade: kind === 'uncleared' ? 'secret' : 'unclassified' }} open onOpenChange={vi.fn()} />)
    const recipient = await screen.findByRole('checkbox', { name: 'Eligible recipient' })
    expect(recipient).not.toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Original sender' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'For reply' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(recipient)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(send).toHaveBeenCalledWith(7, {
      user_ids: [13], purpose: 'reply', note: null, include_references: true,
    }))
  })
})

it('keeps every thread translation and interpolation in Arabic and English', () => {
  function leaves(value: object, prefix = ''): Record<string, string> {
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      const path = `${prefix}${key}`
      return typeof child === 'string' ? [[path, child]] : Object.entries(leaves(child, `${path}.`))
    }))
  }
  const english = leaves(en.books.thread)
  const arabic = leaves(ar.books.thread)
  expect(Object.keys(arabic).sort()).toEqual(Object.keys(english).sort())
  for (const key of Object.keys(english)) {
    expect(arabic[key]?.trim()).toBeTruthy()
    expect(arabic[key]?.match(/\{\{\w+\}\}/g) ?? []).toEqual(english[key]?.match(/\{\{\w+\}\}/g) ?? [])
  }
})
