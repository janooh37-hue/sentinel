/**
 * Widget behaviour: lists scheduled departures, and Cancel sends the reset
 * PATCH that update_employee interprets as "cancel the pending departure".
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { PendingDeparturesWidget } from './PendingDeparturesWidget'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listEmployees: vi.fn(),
      updateEmployee: vi.fn(),
    },
  }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))

const { api } = await import('@/lib/api')

function renderWidget(lng = 'en') {
  void i18n.changeLanguage(lng)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <PendingDeparturesWidget />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

const ROW = {
  id: 'G9600',
  name_en: 'Ahmed Ali',
  name_ar: 'أحمد علي',
  status: 'Active',
  pending_status: 'Resigned',
  end_date: '2026-08-15',
}

/** Local Y-M-D `days` from today, matching the widget's own local "today" calc. */
function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

beforeEach(() => {
  vi.mocked(api.listEmployees).mockReset()
  vi.mocked(api.updateEmployee).mockReset()
})

describe('PendingDeparturesWidget', () => {
  it('lists a scheduled departure', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [ROW], total: 1 } as never)
    renderWidget()
    expect(await screen.findByText('Ahmed Ali')).toBeInTheDocument()
    expect(screen.getByText('G9600')).toBeInTheDocument()
  })

  it('shows the empty state when nothing is scheduled', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
    renderWidget()
    expect(await screen.findByText('No scheduled departures')).toBeInTheDocument()
  })

  it('shows Arabic copy under lng=ar', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
    renderWidget('ar')
    expect(await screen.findByText('لا توجد مغادرات مجدولة')).toBeInTheDocument()
  })

  it('renders the Arabic status chip, plural days-left, and header under lng=ar', async () => {
    const row = { ...ROW, end_date: isoDaysFromNow(2) }
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [row], total: 1 } as never)
    renderWidget('ar')
    expect(await screen.findByText('أحمد علي')).toBeInTheDocument()
    // employees.status.Resigned in Arabic (canonical wording, not invented here)
    expect(screen.getByText('مستقيل')).toBeInTheDocument()
    // pendingDepartures.daysLeft_two — the dual form English has no equivalent for
    expect(screen.getByText('بقي يومان')).toBeInTheDocument()
    // dashboard.widgetLabels.pending_departures
    expect(screen.getByText('المغادرات المجدولة')).toBeInTheDocument()
  })

  it('Cancel sends the reset patch', async () => {
    vi.mocked(api.listEmployees).mockResolvedValue({ items: [ROW], total: 1 } as never)
    vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
    renderWidget()
    await screen.findByText('Ahmed Ali')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(api.updateEmployee).toHaveBeenCalledWith('G9600', {
        status: 'Active',
        end_date: null,
      }),
    )
  })
})
