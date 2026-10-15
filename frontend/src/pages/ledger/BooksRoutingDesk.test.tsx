import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRead } from '@/lib/api'

vi.mock('@/lib/authContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'employee' } }) }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => false }) }))
vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => false }))

import { api } from '@/lib/api'
import { BooksRoutingDesk } from './BooksRoutingDesk'

const BOOK: BookRead = {
  id: 7, ref_number: 'GS-7', subject: 'Staff instruction', category_id: null,
  direction: 'incoming', stamp_style: null, created_at: '2026-10-12T09:00:00Z',
  deleted_at: null, priority: null, approval_state: 'none', access_scope: 'full',
  confidentiality: 'general', can_write: false, can_send: false,
  can_change_confidentiality: false, can_sign: false, can_review: false, is_draft: false,
  doc_manager_has_signature: false, is_word_book: false,
  included_papers_revision: 0, included_papers_fixed_page_count: 0,
  included_papers_total_page_count: 0, current_template_id: null, service_id: 'General Book',
  my_inbox: { id: 9, purpose: 'action', sent_by_user_id: 2, sent_by_name: 'Khalid', sent_at: '2026-10-12T09:00:00Z', read_at: null },
}

function mount(url = '/ledger?tab=books'): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}><BooksRoutingDesk /></MemoryRouter></QueryClientProvider>)
  return qc
}
beforeEach(() => {
  vi.spyOn(api, 'listBooks').mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
  vi.spyOn(api, 'getInboxSummary').mockResolvedValue({ unread: 0, received: 0, sent: 0, archived: 0, by_purpose: { info: 0, action: 0, reply: 0, circulate: 0 } })
  vi.spyOn(api, 'listBookRecipients').mockResolvedValue([])
  vi.spyOn(api, 'getBookThread').mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Books routing desk', () => {
  it.each([
    ['incoming', 'received'], ['outgoing', 'sent'], ['archived', 'archived'],
  ])('maps the %s URL scope to inbox=%s', async (scope, inbox) => {
    mount(`/ledger?tab=books&scope=${scope}`)
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox })))
  })

  it('switches scope without mixing recipient inbox with record direction', async () => {
    mount()
    await waitFor(() => expect(api.listBooks).toHaveBeenCalledWith(expect.objectContaining({ inbox: 'received' })))
    await userEvent.click(screen.getByRole('tab', { name: 'Outgoing' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'sent' })))
    await userEvent.click(screen.getByRole('tab', { name: 'Archived' }))
    await waitFor(() => expect(api.listBooks).toHaveBeenLastCalledWith(expect.objectContaining({ inbox: 'archived' })))
  })

  it('opens the selected book with default mark-read behavior and refreshes unread projections', async () => {
    vi.mocked(api.listBooks).mockResolvedValue({ items: [BOOK], total: 1, limit: 50, offset: 0 })
    vi.spyOn(api, 'getBook').mockResolvedValue({ ...BOOK, my_inbox: { ...BOOK.my_inbox!, read_at: '2026-10-15T09:00:00Z' } })
    const qc = mount()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    await userEvent.click(await screen.findByRole('button', { name: /GS-7/ }))
    await waitFor(() => expect(api.getBook).toHaveBeenCalledWith(7))
    expect(await screen.findByRole('link', { name: 'Open record' })).toHaveAttribute('href', '/books/7')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'inbox-summary'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books', 'routing'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications', 'counts'] })
  })
})
