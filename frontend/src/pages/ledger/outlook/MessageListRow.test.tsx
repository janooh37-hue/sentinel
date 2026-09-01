/**
 * The pending-handoff chip. A row tagged `outlook-pending` was handed to the
 * operator's Outlook but hasn't been seen in the Sent folder yet, and the row
 * must say so in words — the list already tints rows for overdue follow-ups, so
 * colour alone would be ambiguous.
 *
 * Asserted under lng=ar as well as en (see BookRecordPage.queueNav.test.tsx for
 * the same pattern): an English-only assertion cannot catch an AR leak.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import type { LedgerListItem } from '@/lib/api'
import { MessageListRow } from './MessageListRow'
import { OUTLOOK_PENDING_TAG } from './mailboxTypes'

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

function item(tags: string[]): LedgerListItem {
  return {
    id: 12,
    entry_date: '2026-08-10',
    direction: 'outgoing',
    channel: 'email',
    counterparty: 'hr@gssg.ae',
    subject: 'كتاب رقم GS-0048',
    tags,
    attachment_count: 0,
    related_book_id: null,
    related_employee_id: null,
    created_at: '2026-08-10T09:00:00Z',
    updated_at: '2026-08-10T09:00:00Z',
    deleted_at: null,
    read_at: '2026-08-10T09:00:00Z',
    flagged: false,
    snippet: '',
  } as unknown as LedgerListItem
}

function renderRow(tags: string[]): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MessageListRow entry={item(tags)} selected={false} onSelect={vi.fn()} />
    </QueryClientProvider>,
  )
}

describe('MessageListRow pending handoff (English)', () => {
  it('labels a row that is still waiting for Outlook to send it', () => {
    renderRow(['email', OUTLOOK_PENDING_TAG])
    expect(screen.getByText('Awaiting Outlook send')).toBeInTheDocument()
  })

  it('stays silent for a confirmed sent row', () => {
    renderRow(['email'])
    expect(screen.queryByText('Awaiting Outlook send')).not.toBeInTheDocument()
  })
})

describe('MessageListRow pending handoff (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('reads Arabic, not the English peer', () => {
    renderRow(['email', OUTLOOK_PENDING_TAG])
    expect(screen.getByText('بانتظار الإرسال من Outlook')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting Outlook send')).not.toBeInTheDocument()
  })
})
