import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/lib/i18n'

import { ScanBackPage } from './ScanBackPage'

const books = [
  { id: 1, ref_number: 'GS-0410', subject: 'Acknowledgment Form',
    created_at: daysAgo(40), approval_state: 'awaiting_scan' },
  { id: 2, ref_number: 'NAT-0642', subject: 'Warning Form',
    created_at: daysAgo(8), approval_state: 'awaiting_scan' },
]

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

const grantedCapabilities: Record<string, true> = {
  'books.view': true,
  'books.edit': true,
}

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    has: (capability: string) => grantedCapabilities[capability] === true,
    isLoading: false,
  }),
}))
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { listAwaitingScanBooks: vi.fn(async () => books), addBookAttachment: vi.fn() },
  apiErrorMessage: (e: unknown) => String(e),
}))

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ScanBackPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ScanBackPage', () => {
  beforeEach(async () => { await i18n.changeLanguage('en') })

  it('lists stranded records grouped by age', async () => {
    renderPage()
    expect(await screen.findByText('GS-0410')).toBeInTheDocument()
    expect(screen.getByText('NAT-0642')).toBeInTheDocument()
    expect(screen.getByText(/Over a month/i)).toBeInTheDocument()
    expect(screen.getByText(/This month/i)).toBeInTheDocument()
  })

  it('renders the Arabic heading under lng=ar', async () => {
    // An English-only assertion cannot catch an AR leak when the EN label
    // equals the key — that is how the leave-type leak shipped green (c0db9fb).
    await i18n.changeLanguage('ar')
    renderPage()
    expect(await screen.findByText('النسخ الموقّعة')).toBeInTheDocument()
    // Data-dependent (post-fetch) text needs its own async wait: the title
    // above renders unconditionally before the query settles, so its
    // findByText resolves on the initial synchronous check and does not
    // block until the group heading (which needs `books` loaded) exists.
    // The heading also interpolates `· {count}` as a sibling text node, so
    // (like the English `/Over a month/i` assertion above) this needs a
    // substring/regex matcher, not an exact-string one.
    expect(await screen.findByText(/أكثر من شهر/)).toBeInTheDocument()
  })
})
