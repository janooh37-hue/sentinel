import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
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
    zones: ['red'],
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
        items: [row(1, 'Ahmed Khan', 'pending'), row(2, 'Sara Ali', 'approved'), row(3, 'Omar Zayed', null), row(4, 'Awaiting Scan', 'awaiting_scan')],
        total: 4,
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
  vi.clearAllMocks()
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

  it.each(['red', 'green', 'work_residence'])('passes URL zone %s to the server and preserves it when selecting approval', async (zone) => {
    const user = userEvent.setup()
    renderTab(`/permits?tab=items&zone=${zone}`)
    await screen.findByText('Ahmed Khan')
    expect(api.listItemPermits).toHaveBeenCalledWith({ q: undefined, zone, limit: 500 })
    expect(screen.getByRole('combobox', { name: 'Zone' })).toHaveValue(zone)
    await user.click(screen.getByRole('button', { name: /pending/i }))
    expect(screen.getByTestId('location')).toHaveTextContent(`zone=${zone}`)
    expect(screen.getByTestId('location')).toHaveTextContent('istatus=pending')
    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(api.listItemPermits).toHaveBeenLastCalledWith({ q: undefined, zone: undefined, limit: 500 }))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/permits\?tab=items$/)
  })

  it('opens an awaiting-scan tile URL without losing its zone', async () => {
    renderTab('/permits?tab=items&zone=red&istatus=awaiting_scan')
    expect(await screen.findByText('Awaiting Scan')).toBeInTheDocument()
    expect(screen.queryByText('Ahmed Khan')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Awaiting signed copy/i })).toHaveAttribute('aria-pressed', 'true')
    expect(api.listItemPermits).toHaveBeenCalledWith({ q: undefined, zone: 'red', limit: 500 })
  })

  it('does not cap a summary-linked approval bucket at the first register page', async () => {
    vi.mocked(api.listItemPermits).mockResolvedValueOnce({ items: [{ id: 5, employee_id: 'G5', employee_name: 'First approved', employee_name_en: 'First approved', approval_state: 'approved', items: [], zones: ['red'], created_at: '2026-10-23' }], total: 2 } as never)
    vi.mocked(api.listItemPermits).mockResolvedValueOnce({ items: [{ id: 6, employee_id: 'G6', employee_name: 'Last approved', employee_name_en: 'Last approved', approval_state: 'approved', items: [], zones: ['red'], created_at: '2026-10-23' }], total: 2 } as never)
    renderTab('/permits?tab=items&zone=red&istatus=approved')
    expect(await screen.findByText('Last approved')).toBeInTheDocument()
    expect(api.listItemPermits).toHaveBeenLastCalledWith({ q: undefined, zone: 'red', limit: 500, offset: 1 })
    expect(screen.getByText('2 permits')).toBeInTheDocument()
  })

  it('refetches server-side when changing zone and ignores invalid URL zones', async () => {
    const user = userEvent.setup()
    renderTab('/permits?tab=items&zone=invalid')
    await screen.findByText('Ahmed Khan')
    expect(api.listItemPermits).toHaveBeenLastCalledWith({ q: undefined, zone: undefined, limit: 500 })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Zone' }), 'green')
    await waitFor(() => expect(api.listItemPermits).toHaveBeenLastCalledWith({ q: undefined, zone: 'green', limit: 500 }))
    expect(screen.getByTestId('location')).toHaveTextContent('zone=green')
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
    renderTab('/permits?tab=items&zone=red')
    await screen.findByText('Ahmed Khan')
    const row = screen.getByText('Ahmed Khan').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^view$/i }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('itemPreview=1'))
    expect(screen.getByTestId('location')).toHaveTextContent('zone=red')
    expect(await screen.findByRole('dialog', { name: /GSSG-1/ })).toBeInTheDocument()
  })
})
