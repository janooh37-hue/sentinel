import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import type { WorkforceAccess, WorkforceSnapshot } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { WorkforcePulseWidget } from './WorkforcePulseWidget'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getWorkforceAccess: vi.fn(),
      getWorkforceSnapshot: vi.fn(),
    },
  }
})

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: vi.fn() }))

const { api } = await import('@/lib/api')
const mockUseCapabilities = vi.mocked(useCapabilities)

const SELF_ACCESS: WorkforceAccess = { workforce_access_tier: 'self', scopes: [] }
const AGGREGATE_ACCESS: WorkforceAccess = {
  workforce_access_tier: 'organization',
  scopes: [{ scope_kind: 'organization' }],
}

function snapshot(overrides: Partial<WorkforceSnapshot> = {}): WorkforceSnapshot {
  return {
    as_of: '2026-08-24T09:00:00Z',
    operational_date: '2026-08-24',
    timezone: 'Asia/Dubai',
    sync_health: { punches: { state: 'healthy' } },
    evaluation_health: { pending_count: 0, error_count: 0 },
    readiness: {
      schedules_ready: true,
      policy_ready: true,
      mappings_ready: true,
      integration_ready: true,
    },
    current_shift: {
      scheduled: 8,
      excused: 1,
      evaluated_count: 8,
      pending_or_error_excluded_count: 0,
      working: 7,
      verified_roster_gap: 0,
      verified_coverage_percent: 100,
      staffing_status: 'adequate',
    },
    next_shift: { scheduled: 5 },
    leave_today: { annual: 1, sick: 0, national_service: 0, other: 0 },
    mapping_completeness: {},
    schedule_completeness: {},
    self: { employee_id: 'G100', presence_state: 'on_duty' },
    aggregate: null,
    ...overrides,
  }
}

function renderWidget(onOpenCoverage = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    onOpenCoverage,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <WorkforcePulseWidget onOpenCoverage={onOpenCoverage} />
        </I18nextProvider>
      </QueryClientProvider>,
    ),
  }
}

beforeEach(() => {
  void i18n.changeLanguage('en')
  vi.mocked(api.getWorkforceAccess).mockReset()
  vi.mocked(api.getWorkforceSnapshot).mockReset()
  mockUseCapabilities.mockReturnValue({
    capabilities: new Set(['workforce.self.view', 'workforce.dashboard.view']),
    isLoading: false,
    has: (capability: string) => capability === 'workforce.self.view' || capability === 'workforce.dashboard.view',
  })
})

describe('WorkforcePulseWidget', () => {
  it.each([
    ['self', SELF_ACCESS, snapshot(), /My shift/],
    ['aggregate', AGGREGATE_ACCESS, snapshot({ aggregate: { scheduled: 8, working: 7 } }), /Current shift/],
    [
      'schedules missing',
      AGGREGATE_ACCESS,
      snapshot({ readiness: { schedules_ready: false, policy_ready: true, mappings_ready: true, integration_ready: true } }),
      /Schedule setup required/,
    ],
    ['stale', AGGREGATE_ACCESS, snapshot({ sync_health: { punches: { state: 'stale' } } }), /Attendance source is stale/],
    ['withheld', AGGREGATE_ACCESS, snapshot({ current_shift: { scheduled: 8, excused: 0, evaluated_count: 0, pending_or_error_excluded_count: 8, working: null } }), /Pending verification/],
  ])('renders %s truthfully', async (_name, access, payload, expected) => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(access)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(payload)

    renderWidget()

    expect(await screen.findByText(expected)).toBeInTheDocument()
  })

  it('states that no Workforce scope is assigned without requesting a snapshot', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue({ workforce_access_tier: 'none', scopes: [] })

    renderWidget()

    expect(await screen.findByText('No Workforce scope assigned')).toBeInTheDocument()
    expect(api.getWorkforceSnapshot).not.toHaveBeenCalled()
  })

  it('does not request or render without either workforce capability', async () => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(), isLoading: false, has: () => false })

    const { container } = renderWidget()

    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(api.getWorkforceAccess).not.toHaveBeenCalled()
    expect(api.getWorkforceSnapshot).not.toHaveBeenCalled()
  })

  it('exposes Coverage only for aggregate access', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(AGGREGATE_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(snapshot({ aggregate: { scheduled: 8, working: 7 } }))
    const aggregate = renderWidget()

    await userEvent.click(await screen.findByRole('button', { name: 'Open coverage' }))
    expect(aggregate.onOpenCoverage).toHaveBeenCalledOnce()
    aggregate.unmount()

    vi.mocked(api.getWorkforceAccess).mockResolvedValue(SELF_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(snapshot())
    renderWidget()

    expect(await screen.findByText('My shift')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open coverage' })).not.toBeInTheDocument()
  })
})
