import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import i18n from '@/lib/i18n'
import { NavBellPopover } from '@/components/shell/NavBellPopover'
import { ViolationMonthsWidget } from './ViolationMonthsWidget'


function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

vi.mock('@/lib/api', () => ({
  api: {
    getInmateRegisterAwaitingClose: vi.fn(),
    listAuthUsers: vi.fn().mockResolvedValue([]),
    markAllLedgerRead: vi.fn().mockResolvedValue(undefined),
  },
  apiErrorMessage: (error: unknown) => String(error),
}))
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ isAdmin: false }),
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => false }),
}))
vi.mock('@/pages/leaves/useAwaitingReturnCount', () => ({
  useAwaitingReturnCount: () => 0,
}))
vi.mock('@/pages/ledger/outlook/useFlagCount', () => ({
  useFlagCount: () => 0,
}))
vi.mock('@/pages/scanBack/useScanBack', () => ({
  useScanBack: () => ({ books: [], isLoading: false, count: 0, enabled: false }),
}))
vi.mock('@/pages/scanInbox/useScanInboxCount', () => ({
  useScanInboxCount: () => 0,
}))

function renderWidget(language = 'en') {
  void i18n.changeLanguage(language)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ViolationMonthsWidget />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

function renderWidgetAndBell() {
  void i18n.changeLanguage('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ViolationMonthsWidget />
          <NavBellPopover />
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(api.getInmateRegisterAwaitingClose).mockReset()
})

describe('ViolationMonthsWidget', () => {

  it('distinguishes blocked and closable months in Arabic', async () => {
    vi.mocked(api.getInmateRegisterAwaitingClose).mockResolvedValue({
      months: [
        { year: 2026, month: 7, row_count: 4, pending_count: 0, closable: true, stage: 'approve', assigned: true },
        { year: 2026, month: 8, row_count: 7, pending_count: 2, closable: false, stage: 'prepare', assigned: false },
      ],
      count: 2,
    })

    renderWidget('ar')

    expect(await screen.findByText('جاهز للإغلاق')).toBeInTheDocument()
    expect(screen.getByText('اعتماد التقارير الشهرية')).toBeInTheDocument()
    expect(screen.getByText('اعتماد وإغلاق · 4 سطر')).toBeInTheDocument()
    expect(screen.getByText('إرسال للمراجعة · 7 سطر')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-07',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08',
    ])
  })

  it('shows how many months the five-row preview omits and links to the newest', async () => {
    vi.mocked(api.getInmateRegisterAwaitingClose).mockResolvedValue({
      months: Array.from({ length: 7 }, (_, index) => ({
        year: 2026,
        month: index + 1,
        row_count: index + 1,
        pending_count: 0,
        closable: true,
        stage: 'review' as const,
        assigned: true,
      })),
      count: 7,
    })

    renderWidget()

    expect(await screen.findByText('More months awaiting close: 2')).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-01',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-02',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-03',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-04',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-05',
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-07',
    ])
  })

  it('shares one awaiting-close query and adds its month count to the bell', async () => {
    vi.mocked(api.getInmateRegisterAwaitingClose).mockResolvedValue({
      months: [
        { year: 2026, month: 7, row_count: 4, pending_count: 0, closable: true, stage: 'approve', assigned: true },
        { year: 2026, month: 8, row_count: 7, pending_count: 2, closable: false, stage: 'review', assigned: true },
      ],
      count: 2,
    })

    renderWidgetAndBell()

    expect(
      await screen.findByRole('button', { name: 'Notifications, 2 unread' }),
    ).toBeInTheDocument()
    expect(api.getInmateRegisterAwaitingClose).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: /August 2026/,
      }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/application?form=inmate_conduct_violations&mode=stats&stats_month=2026-08',
    )
  })

  it('shows the empty state when no ended month awaits closing', async () => {
    vi.mocked(api.getInmateRegisterAwaitingClose).mockResolvedValue({ months: [], count: 0 })

    renderWidget()

    expect(await screen.findByText('No ended month is awaiting close.')).toBeInTheDocument()
  })
})
