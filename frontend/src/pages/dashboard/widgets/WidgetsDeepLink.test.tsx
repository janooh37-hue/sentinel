import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { api } from '@/lib/api'
import type { ApprovalLogItem, ApprovalSummaryResponse, BookRead, DashboardSummary } from '@/lib/api'
import { approvalQueueUrl, approvalRecordUrl } from '@/lib/approvals'
import { MyDocumentsWidget } from './MyDocumentsWidget'
import { WaitingApprovalsWidget } from './WaitingApprovalsWidget'
import { SentApprovalsWidget } from './SentApprovalsWidget'
import { InboxWidget } from './InboxWidget'
import { MyDraftsWidget } from './MyDraftsWidget'
import { UnreadMailWidget } from './UnreadMailWidget'
import { widgetRegistry } from '../widgetRegistry'
import { recordAge } from './recordWidgetTime'
import type { WidgetTier } from './types'

const state = vi.hoisted(() => ({ denied: new Set<string>(), pendingIds: new Set<number>() }))
vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 42 }, status: 'authed' }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => !state.denied.has(cap) }) }))
vi.mock('@/pages/books/RecordDeleteProvider', () => ({ useRecordDelete: () => ({ pendingIds: state.pendingIds }) }))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, getDashboardSummary: vi.fn(), getApprovalSummary: vi.fn(), listApprovalLog: vi.fn(), getInboxSummary: vi.fn(), listBooks: vi.fn(), syncEmail: vi.fn() } }
})

const APPROVAL_ROW: ApprovalLogItem = {
  book_id: 10, version_id: 81, ref_number: 'HR-0010', subject: 'Transfer letter',
  priority: 'High', status: 'pending', record_status: 'pending', access_scope: 'assigned_revision',
  submitted_by_name: 'Ahmed', submitted_by_name_ar: 'أحمد', approver_name: 'Khalid', approver_name_ar: 'خالد',
  submitted_at: '2026-10-20T08:00:00',
}
const APPROVALS: ApprovalSummaryResponse = {
  can_view_sent: true, available_received_kinds: ['approver', 'reviewer'],
  signature: { count: 6, oldest: APPROVAL_ROW }, review: { count: 2, oldest: APPROVAL_ROW },
  sent: { count: 5, oldest: APPROVAL_ROW }, returned_count: 2, actionable_count: 8,
}
const APPROVAL_ROWS = Array.from({ length: 5 }, (_, i) => ({ ...APPROVAL_ROW, book_id: 10 + i, ref_number: `HR-00${10 + i}`, subject: `Approval ${i}` }))
const BOOK: BookRead = {
  id: 50, ref_number: 'HR-0050', category_id: null, subject: 'Received letter', direction: 'incoming',
  stamp_style: null, created_at: '2026-10-20T08:00:00', deleted_at: null, priority: 'Normal',
  approval_state: 'approved', access_scope: 'full', confidentiality: 'general', can_write: false,
  can_send: false, can_change_confidentiality: false, can_sign: false, can_review: false,
  is_draft: false, doc_manager_has_signature: false, is_word_book: false,
  included_papers_revision: 0, included_papers_fixed_page_count: 0, included_papers_total_page_count: 0,
  current_template_id: null, service_id: 'General Book',
  my_inbox: { id: 1, purpose: 'action', sent_by_user_id: 3, sent_by_name: 'Yousef', sent_by_name_ar: 'يوسف', sent_at: '2026-10-20T08:00:00' },
}
const BOOKS = Array.from({ length: 5 }, (_, i) => ({ ...BOOK, id: 50 + i, subject: `Received ${i}` }))
const SUMMARY: DashboardSummary = {
  totals: { employees_active: 10, our_staff: 8, loaned: 2, on_leave_today: 1, present_today: 7, forms_this_month: 99, open_violations_count: 4, book_draft_count: 99 },
  on_leave_today: [], upcoming_leave_ends: [], open_violations: null,
  my_records: {
    month: '2026-10', from_date: '2026-10-01', to_date: '2026-10-31', approved: 7, pending: 3,
    awaiting_scan: 2, returned: 1, rejected: 2, not_submitted: 4, drafts: 8,
    latest_approved: Array.from({ length: 5 }, (_, i) => ({ book_id: 100 + i, ref_number: `DOC-${i}`, subject: `Document ${i}`, employee_id: null, employee_name_en: null, employee_name_ar: null, created_at: '2026-10-20T08:00:00' })),
  },
  unread_mail: { count: 9, latest: Array.from({ length: 5 }, (_, i) => ({ id: 200 + i, subject: `Mail ${i}`, counterparty: 'MOHRE', entry_date: '2026-10-20', created_at: '2026-10-20T08:00:00' })) },
  email_sync: { enabled: true, last_synced_at: '2026-10-20T08:00:00', interval_minutes: 5, incoming_today: 12 },
}
const INBOX = { unread: 3, received: 7, sent: 4, archived: 0, by_purpose: { action: 2, info: 3, reply: 1, circulate: 1 } }
const TIERS: WidgetTier[] = ['glance', 'summary', 'tall', 'list']
const WIDGETS = [
  { Component: MyDocumentsWidget, title: 'My documents · October', metric: '7', row: 'Document 0', more: '+4 more' },
  { Component: WaitingApprovalsWidget, title: 'Needs your signature', metric: '6', row: 'Approval 0', more: '+3 more' },
  { Component: SentApprovalsWidget, title: 'Sent for approval', metric: '5', row: 'Approval 0', more: '+2 more' },
  { Component: InboxWidget, title: 'Sent to me', metric: '3', row: 'Received 0', more: '+4 more' },
  { Component: MyDraftsWidget, title: 'My drafts', metric: '8', row: null, more: null },
  { Component: UnreadMailWidget, title: 'Unread mail', metric: '9', row: 'Mail 0', more: '+6 more' },
]

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return { qc, ...render(<QueryClientProvider client={qc}><I18nextProvider i18n={i18n}><MemoryRouter>{ui}</MemoryRouter></I18nextProvider></QueryClientProvider>) }
}
beforeEach(async () => {
  vi.resetAllMocks()
  state.denied.clear()
  state.pendingIds.clear()
  await i18n.changeLanguage('en')
  vi.mocked(api.getDashboardSummary).mockResolvedValue(SUMMARY)
  vi.mocked(api.getApprovalSummary).mockResolvedValue(APPROVALS)
  vi.mocked(api.getInboxSummary).mockResolvedValue(INBOX)
  vi.mocked(api.listApprovalLog).mockResolvedValue({ items: APPROVAL_ROWS, total: 6, limit: 5, offset: 0 })
  vi.mocked(api.listBooks).mockResolvedValue({ items: BOOKS, total: 7, limit: 5, offset: 0 })
  vi.mocked(api.syncEmail).mockResolvedValue({ imported: 1, skipped_duplicate: 0, last_synced_at: '2026-10-23T08:00:00Z' })
})

for (const widget of WIDGETS) {
  describe(widget.title, () => {
    it.each(TIERS)('renders honest %s content inside one frame', async (tier) => {
      const { Component } = widget
      mount(<Component tier={tier} rows={3} />)
      const frame = await screen.findByRole('region', { name: widget.title })
      await waitFor(() => expect(within(frame).queryByRole('status')).not.toBeInTheDocument())
      expect(within(frame).getAllByText(widget.metric).length).toBeGreaterThan(0)
      expect(within(frame).getByRole('link', { name: /view all/i })).toBeInTheDocument()
      if (widget.row && (tier === 'list' || tier === 'tall')) {
        expect(await within(frame).findByRole('link', { name: new RegExp(widget.row) })).toBeInTheDocument()
        expect(within(frame).getByRole('link', { name: widget.more! })).toBeInTheDocument()
        expect(within(frame).getAllByRole('listitem')).toHaveLength(widget.title === 'Sent to me' ? 7 : 3)
      } else if (widget.row) expect(within(frame).queryByText(widget.row)).not.toBeInTheDocument()
      if (widget.title === 'My drafts') expect(api.listBooks).not.toHaveBeenCalled()
    })
  })
}

it('links every nonzero monthly state and approved row to matching Records filters', async () => {
  mount(<MyDocumentsWidget tier="list" rows={2} />)
  await screen.findByRole('link', { name: /Document 0/ })
  for (const state of ['approved', 'pending', 'awaiting_scan', 'returned', 'rejected', 'none']) {
    const url = `/books?mine=1&status=${state}&from=2026-10-01&to=2026-10-31`
    expect(screen.getAllByRole('link').some((link) => link.getAttribute('href') === url)).toBe(true)
  }
  expect(screen.getByRole('link', { name: /DOC-0/ })).toHaveAttribute('href', '/books?open=100')
  expect(screen.getByRole('link', { name: '+5 more' })).toHaveAttribute('href', '/books?mine=1&status=approved&from=2026-10-01&to=2026-10-31')
  expect(screen.getAllByText('General record')).toHaveLength(2)
  expect(screen.queryByText('99')).not.toBeInTheDocument()
})

it('omits zero segments and offers a record-creation action', async () => {
  vi.mocked(api.getDashboardSummary).mockResolvedValue({ ...SUMMARY, my_records: { ...SUMMARY.my_records!, approved: 0, pending: 0, awaiting_scan: 0, returned: 0, rejected: 0, not_submitted: 0, latest_approved: [] } })
  mount(<MyDocumentsWidget tier="summary" rows={3} />)
  expect(await screen.findByRole('link', { name: 'Start a record' })).toHaveAttribute('href', '/services')
  expect(screen.queryByText('in approval')).not.toBeInTheDocument()
})

it.each(['glance', 'summary'] as const)('keeps the %s legend bounded with a full-breakdown destination', async (tier) => {
  mount(<MyDocumentsWidget tier={tier} rows={0} />)
  const remainder = await screen.findByRole('link', { name: '+4 more' })
  expect(remainder).toHaveTextContent('+4')
  expect(remainder).toHaveAttribute('href', '/books?mine=1&from=2026-10-01&to=2026-10-31')
  expect(screen.getByTitle('3 in approval')).toHaveAttribute('href', '/books?mine=1&status=pending&from=2026-10-01&to=2026-10-31')
  expect(screen.queryByText('not submitted')).not.toBeInTheDocument()
})

it('retains the complete compact draft description as a tooltip', async () => {
  mount(<MyDraftsWidget tier="glance" rows={0} />)
  const description = await screen.findByText(i18n.t('dashboard.widgets.drafts.continue'))
  expect(description).toHaveAttribute('title', description.textContent)
})

it('uses pending sent scope for the metric, View all and remainder, with a distinct returned chip', async () => {
  const { unmount } = mount(<SentApprovalsWidget tier="summary" rows={2} />)
  const to = approvalQueueUrl({ tab: 'sent', status: 'pending', sort: 'newest', page: 1 })
  expect(await screen.findByRole('link', { name: '5 pending' })).toHaveAttribute('href', to)
  expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', to)
  expect(screen.getByRole('link', { name: '2 need changes' })).toHaveAttribute('href', approvalQueueUrl({ tab: 'sent', status: 'returned', sort: 'newest', page: 1 }))
  expect(screen.getByText(/Oldest: Transfer letter/)).toHaveTextContent('Waiting on Khalid')
  unmount()
  mount(<SentApprovalsWidget tier="list" rows={2} />)
  expect(await screen.findByRole('link', { name: '+3 more' })).toHaveAttribute('href', to)
  expect(api.listApprovalLog).toHaveBeenCalledWith({ scope: 'sent', status: 'pending', sort: 'newest', limit: 2 })
})

it('preserves signature/review queue and assigned revision deep links', async () => {
  mount(<WaitingApprovalsWidget tier="list" rows={2} />)
  const context = { tab: 'received', kind: 'sign', status: 'pending', sort: 'newest', page: 1 } as const
  expect(await screen.findByRole('link', { name: /Approval 0/ })).toHaveAttribute('href', approvalRecordUrl(10, 81, context))
  expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', approvalQueueUrl(context))
  expect(screen.getByRole('link', { name: '+2 to review' })).toHaveAttribute('href', approvalQueueUrl({ ...context, kind: 'review' }))
  expect(api.listApprovalLog).toHaveBeenCalledWith({ scope: 'received', kind: 'approver', status: 'pending', sort: 'newest', limit: 2 })
  expect(screen.getByText('HR-0010')).toHaveAttribute('dir', 'ltr')
})

it.each(TIERS)('uses the review bucket for review-only staff at %s tier', async (tier) => {
  vi.mocked(api.getApprovalSummary).mockResolvedValue({ ...APPROVALS, available_received_kinds: ['reviewer'], signature: { count: 0 }, review: { count: 2, oldest: APPROVAL_ROW } })
  mount(<WaitingApprovalsWidget tier={tier} rows={2} />)
  expect(await screen.findByRole('heading', { name: /To review/ })).toBeInTheDocument()
  const to = approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'newest', page: 1 })
  expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', to)
  if (tier === 'summary') expect(await screen.findByText(/Oldest: Transfer letter/)).toBeInTheDocument()
  if (tier === 'glance') expect(await screen.findByText(/Oldest:/)).not.toHaveTextContent('Transfer letter')
})

it('keeps idle review-only staff in an empty received queue instead of sent', async () => {
  vi.mocked(api.getApprovalSummary).mockResolvedValue({ ...APPROVALS, available_received_kinds: ['reviewer'], signature: { count: 0 }, review: { count: 0 } })
  mount(<WaitingApprovalsWidget tier="list" rows={3} />)
  expect(await screen.findByRole('link', { name: 'Open approvals' })).toHaveAttribute('href', approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'newest', page: 1 }))
  expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'newest', page: 1 }))
  expect(api.listApprovalLog).not.toHaveBeenCalled()
})

it('removes undo-pending records from previews', async () => {
  state.pendingIds.add(10)
  mount(<WaitingApprovalsWidget tier="list" rows={2} />)
  expect(await screen.findByText('Approval 1')).toBeInTheDocument()
  expect(screen.queryByText('Approval 0')).not.toBeInTheDocument()
})

it('keeps incoming/outgoing routing links, real purposes and supported record overlay', async () => {
  mount(<InboxWidget tier="list" rows={2} />)
  expect(await screen.findByRole('link', { name: /Received 0/ })).toHaveAttribute('href', '/ledger?tab=books&scope=incoming&book=50')
  expect(screen.getByRole('link', { name: 'Sent: 4' })).toHaveAttribute('href', '/ledger?tab=books&scope=outgoing')
  expect(screen.getByRole('list', { name: 'Received by purpose' })).toHaveTextContent('2')
  expect(api.listBooks).toHaveBeenCalledWith({ inbox: 'received', sort: '-date', limit: 2 })
})

it('uses the own-drafts count and same filtered destination at every tier', async () => {
  mount(<MyDraftsWidget tier="list" rows={7} />)
  expect(await screen.findByRole('link', { name: '8' })).toHaveAttribute('href', '/books?mine=1&drafts=1')
  expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/books?mine=1&drafts=1')
  expect(api.listBooks).not.toHaveBeenCalled()
})

it.each(['en', 'ar'])('links empty record widgets directly to their destinations in %s', async (language) => {
  await i18n.changeLanguage(language)
  vi.mocked(api.getDashboardSummary).mockResolvedValue({
    ...SUMMARY, my_records: { ...SUMMARY.my_records!, drafts: 0 }, unread_mail: { count: 0, latest: [] },
  })
  vi.mocked(api.getInboxSummary).mockResolvedValue({ ...INBOX, unread: 0, received: 0 })
  vi.mocked(api.getApprovalSummary).mockResolvedValue({ ...APPROVALS, sent: { count: 0 }, returned_count: 0 })
  for (const [Component, key, to] of [
    [MyDraftsWidget, 'drafts', '/services'],
    [InboxWidget, 'inbox', '/ledger?tab=books&scope=incoming'],
    [SentApprovalsWidget, 'sent_approvals', approvalQueueUrl({ tab: 'sent', status: 'pending', sort: 'newest', page: 1 })],
    [UnreadMailWidget, 'ledger', '/ledger?tab=email'],
  ] as const) {
    const { unmount } = mount(<Component tier="glance" rows={0} />)
    expect(await screen.findByRole('link', { name: i18n.t(`dashboard.widgets.${key}.emptyAction`) })).toHaveAttribute('href', to)
    unmount()
  }
})

it('keeps empty-state actions in accessible Records scopes without document-generation permission', async () => {
  state.denied.add('documents.generate')
  vi.mocked(api.getDashboardSummary).mockResolvedValue({
    ...SUMMARY, my_records: { ...SUMMARY.my_records!, approved: 0, pending: 0, awaiting_scan: 0, returned: 0, rejected: 0, not_submitted: 0, drafts: 0, latest_approved: [] },
  })
  for (const [Component, to] of [[MyDocumentsWidget, '/books?mine=1'], [MyDraftsWidget, '/books?mine=1&drafts=1']] as const) {
    const { unmount } = mount(<Component tier="glance" rows={0} />)
    expect(await screen.findByRole('link', { name: 'Open records' })).toHaveAttribute('href', to)
    unmount()
  }
})

it('uses unread summary count, email list and supported mail overlay, not incoming-today count', async () => {
  mount(<UnreadMailWidget tier="list" rows={2} />)
  expect(await screen.findByRole('link', { name: '9 unread' })).toHaveAttribute('href', '/ledger?tab=email')
  expect(screen.getByRole('link', { name: /Mail 0/ })).toHaveAttribute('href', '/ledger?mail=200')
  expect(screen.getByRole('link', { name: '+7 more' })).toHaveAttribute('href', '/ledger?tab=email')
  expect(screen.queryByText('12')).not.toBeInTheDocument()
})

it('syncs email and invalidates every original sync cache', async () => {
  const { qc } = mount(<UnreadMailWidget tier="glance" rows={2} />)
  const invalidate = vi.spyOn(qc, 'invalidateQueries')
  await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
  await waitFor(() => expect(api.syncEmail).toHaveBeenCalledTimes(1))
  for (const key of ['dashboard', 'email-account', 'ledger']) expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] })
})

it.each([true, false])('gates Configure with settings.view=%s when sync is off', async (allowed) => {
  if (!allowed) state.denied.add('settings.view')
  vi.mocked(api.getDashboardSummary).mockResolvedValue({ ...SUMMARY, email_sync: { ...SUMMARY.email_sync, enabled: false } })
  mount(<UnreadMailWidget tier="summary" rows={3} />)
  await screen.findByText('Email sync is off')
  expect(screen.queryByRole('link', { name: 'Configure' }) !== null).toBe(allowed)
  expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
})

it('never exposes Sync now without ledger.view, even if mounted directly', async () => {
  state.denied.add('ledger.view')
  mount(<UnreadMailWidget tier="list" rows={2} />)
  await screen.findByText('Mail 0')
  expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
})

it('reports sync failure inside its frame with a retry', async () => {
  vi.mocked(api.syncEmail).mockRejectedValueOnce(new Error('Offline'))
  mount(<UnreadMailWidget tier="summary" rows={2} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Sync now' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Email sync failed.')
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(api.syncEmail).toHaveBeenCalledTimes(2))
})

it.each(WIDGETS)('keeps loading and retry inside $title', async ({ Component }) => {
  const failure = new Error('Offline')
  vi.mocked(api.getDashboardSummary).mockRejectedValueOnce(failure)
  vi.mocked(api.getApprovalSummary).mockRejectedValueOnce(failure)
  vi.mocked(api.getInboxSummary).mockRejectedValueOnce(failure)
  mount(<Component tier="glance" rows={3} />)
  expect(screen.getByRole('status')).toBeInTheDocument()
  expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load")
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('keeps approval preview errors and retries inside the list frame', async () => {
  vi.mocked(api.listApprovalLog).mockRejectedValueOnce(new Error('Offline'))
  mount(<WaitingApprovalsWidget tier="list" rows={3} />)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('Approval 0')).toBeInTheDocument()
})

it('decides widget availability in the registry before layout', () => {
  const noCaps = { has: () => false, approvalSummary: { ...APPROVALS, available_received_kinds: [] } }
  for (const id of ['pending', 'sent_approvals', 'inbox', 'drafts', 'ledger', 'waiting_approvals'] as const) expect(widgetRegistry[id].available(noCaps)).toBe(false)
  expect(widgetRegistry.waiting_approvals.available({ ...noCaps, approvalSummary: APPROVALS })).toBe(true)
})

it.each(WIDGETS)('renders peer Arabic copy for $title without translation keys or Latin headings', async ({ Component }) => {
  await i18n.changeLanguage('ar')
  mount(<Component tier="list" rows={2} />)
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  expect(screen.getByRole('heading')).not.toHaveTextContent('dashboard.')
  expect(screen.getByRole('heading').textContent).toMatch(/[\u0600-\u06ff]/)
  expect(document.body.textContent).not.toContain('dashboard.widgets.')
})

it('interprets backend naive timestamps as UTC', () => {
  expect(recordAge('2026-10-20T08:00:00', false)).toBe(recordAge('2026-10-20T08:00:00Z', false))
})
