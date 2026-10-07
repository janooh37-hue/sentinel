import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { ItemPermitsTab } from './ItemPermitsTab'

const mobileState = vi.hoisted(() => ({ value: false }))

vi.mock('@/lib/useIsMobile', () => ({ useIsMobile: () => mobileState.value }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: new Set(['permits.view', 'permits.create']),
    isLoading: false,
    has: () => true,
  }),
}))
vi.mock('@/pages/application/DocPdfCanvas', () => ({
  default: ({ pdfUrl }: { pdfUrl: string }) => <div data-testid="pdf" data-url={pdfUrl} />,
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api')>()
  const row = (id: number, name: string, approval: string | null) => ({
    id,
    employee_id: `E${id}00`,
    employee_name: name,
    employee_name_en: name,
    employee_title: null,
    recipient: 'Security',
    zone: 'red',
    site: 'Al Wathba',
    items: [{ name: 'Laptop', quantity: 1 }],
    manager_id: null,
    book_id: approval ? 100 + id : null,
    book_ref: approval ? `GSSG-${id}` : null,
    approval_state: approval,
    created_at: '2026-07-01T00:00:00',
    updated_at: null,
  })
  return {
    ...mod,
    api: {
      ...mod.api,
      getBook: vi.fn().mockReturnValue(new Promise<never>(() => {})),
      listItemPermits: vi.fn().mockResolvedValue({
        items: [row(1, 'Ahmed Khan', 'pending'), row(2, 'Sara Ali', 'approved'), row(3, 'Omar Zayed', null)],
        total: 3,
        limit: 500,
        offset: 0,
      }),
    },
  }
})

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function renderTab(url = '/permits?tab=items') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ItemPermitsTab />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  mobileState.value = false
  await i18n.changeLanguage('en')
})

describe('ItemPermitsTab', () => {
  it('filters by approval tile, reflects it in the URL, and Clear filters resets it', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText('Ahmed Khan')

    const tile = screen.getByRole('button', { name: /pending/i })
    expect(tile).toHaveAttribute('aria-pressed', 'false')
    await user.click(tile)

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('istatus=pending'))
    expect(screen.getByRole('button', { name: /pending/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Ahmed Khan')).toBeInTheDocument()
    expect(screen.queryByText('Sara Ali')).not.toBeInTheDocument()
    expect(screen.getByText('1 permit')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?tab=items$/))
    expect(await screen.findByText('Sara Ali')).toBeInTheDocument()
  })

  it('renders cards instead of the table on mobile', async () => {
    mobileState.value = true
    renderTab()
    await screen.findByText('Ahmed Khan')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ahmed Khan/ })).toBeInTheDocument()
  })

  it('opens the quick view from a row and reflects it as itemPreview', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText('Ahmed Khan')
    const row = screen.getByText('Ahmed Khan').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^view$/i }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('itemPreview=1'))
    expect(await screen.findByRole('dialog', { name: /GSSG-1/ })).toBeInTheDocument()
  })
})
