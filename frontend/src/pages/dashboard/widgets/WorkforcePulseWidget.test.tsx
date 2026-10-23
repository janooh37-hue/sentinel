import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'
import type { WorkforceAccess, WorkforceSnapshot } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { WorkforcePulseWidget } from './WorkforcePulseWidget'
import { useDashboardRuntime } from './dashboardWidgetContext'
import type * as DashboardWidgetContext from './dashboardWidgetContext'
import type { WidgetProps } from './types'

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
vi.mock('./dashboardWidgetContext', async (importOriginal) => ({
  ...await importOriginal<typeof DashboardWidgetContext>(),
  useDashboardRuntime: vi.fn(),
}))

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
function selfSnapshot(): WorkforceSnapshot {
  return snapshot({
    sync_health: null,
    readiness: null,
    current_shift: {
      scheduled: 0,
      excused: 0,
      evaluated_count: 0,
      pending_or_error_excluded_count: 0,
      working: null,
    },
    self: {
      employee_id: 'G100',
      presence_state: 'on_duty',
      reason_code: 'PUNCH_IN_ACTIVE',
      scheduled_start_at: '2026-08-24T08:00:00',
      scheduled_end_at: '2026-08-24T16:00:00',
    },
    aggregate: undefined,
  })
}


function renderWidget(onOpenCoverage = vi.fn(), props: WidgetProps = { tier: 'summary', rows: 0 }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(useDashboardRuntime).mockReturnValue({
    onOpenCoverage,
    onNavigate: vi.fn(),
    has: () => true,
    layout: { widgets: [], quick_actions: [], canvas_width: 'compact' },
    box: { w: 2, h: 1, cols: 4 },
    editing: false,
  })
  return {
    onOpenCoverage,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <WorkforcePulseWidget {...props} />
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
    ['self', SELF_ACCESS, selfSnapshot(), /My shift/],
    ['aggregate', AGGREGATE_ACCESS, snapshot({ aggregate: { scheduled: 8, working: 7 } }), /100%/],
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

  it('renders self presence, reason, and scheduled timestamps without aggregate metrics', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(SELF_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(selfSnapshot())

    renderWidget()

    expect(await screen.findByText('On duty')).toBeInTheDocument()
    expect(screen.getByText('On-duty punch')).toBeInTheDocument()
    expect(screen.getByText('8:00 AM')).toBeInTheDocument()
    expect(screen.getByText('4:00 PM')).toBeInTheDocument()
    expect(screen.queryByText('Scheduled')).not.toBeInTheDocument()
  })

  it('states that no Workforce scope is assigned without requesting a snapshot', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue({ workforce_access_tier: 'none', scopes: [] })

    renderWidget()

    expect(await screen.findByText('No Workforce scope assigned')).toBeInTheDocument()
    expect(api.getWorkforceSnapshot).not.toHaveBeenCalled()
  })

  it('keeps an instructive frame without requesting data when workforce capability is absent', async () => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(), isLoading: false, has: () => false })

    renderWidget()

    expect(await screen.findByText('No Workforce scope assigned')).toBeInTheDocument()
    expect(api.getWorkforceAccess).not.toHaveBeenCalled()
    expect(api.getWorkforceSnapshot).not.toHaveBeenCalled()
  })

  it('omits an unverified aggregate working count instead of rendering zero', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(AGGREGATE_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(
      snapshot({
        aggregate: { scheduled: 0 },
        current_shift: {
          scheduled: 0,
          excused: 0,
          evaluated_count: 0,
          pending_or_error_excluded_count: 0,
          working: null,
        },
      }),
    )

    renderWidget()

    expect(await screen.findByText('Scheduled')).toBeInTheDocument()
    expect(screen.getByText('On duty')).toBeInTheDocument()
    expect(screen.getAllByText('Not yet verified')).toHaveLength(2)
  })

  it('shows an access error instead of a disabled snapshot skeleton', async () => {
    vi.mocked(api.getWorkforceAccess).mockRejectedValue(new Error('access unavailable'))

    renderWidget()

    expect(await screen.findByText("Couldn't load this. Check your connection and try again.")).toBeInTheDocument()
    expect(api.getWorkforceSnapshot).not.toHaveBeenCalled()
  })

  it('renders glance coverage and on-duty-of-scheduled with a percent suffix', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(AGGREGATE_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(
      snapshot({ aggregate: { scheduled: 8, working: 7 }, current_shift: {
        scheduled: 8, excused: 0, evaluated_count: 8,
        pending_or_error_excluded_count: 0, working: 7, verified_coverage_percent: 87.5,
      } }),
    )

    renderWidget(vi.fn(), { tier: 'glance', rows: 0 })

    expect(await screen.findByText('87.5%')).toBeInTheDocument()
    expect(screen.getByText('7 of 8 on duty')).toBeInTheDocument()
  })

  it('retries a failed access request inside the frame', async () => {
    vi.mocked(api.getWorkforceAccess)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(SELF_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(selfSnapshot())
    renderWidget()

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('On-duty punch')).toBeInTheDocument()
  })

  it.each([
    ['PUNCH_OUT_RECORDED', 'Exit recorded'],
    ['NO_IN_AFTER_THRESHOLD', 'No arrival after threshold'],
    ['SCHEDULED_BEFORE_ABSENCE_BOUNDARY', 'Awaiting absence threshold'],
    ['PUNCH_RECORDED_DIRECTIONLESS', 'Punch recorded'],
    ['PUNCH_IN_ACTIVE', 'On-duty punch'],
    ['SHIFT_ENDED', 'Shift ended'],
    ['SYNC_STALE', 'Sync data is stale'],
    ['POLICY_MISSING', 'Policy is missing'],
    ['PUNCH_SEQUENCE_INVALID', 'Punch sequence is invalid'],
    ['IDENTITY_CONFLICT', 'Identity conflict'],
    ['IDENTITY_UNVERIFIED', 'Identity is unverified'],
    ['EMPLOYMENT_STATUS_UNKNOWN', 'Employment status is unknown'],
    ['PUNCH_OUT_ONLY_INFERRED', 'Exit-only punch inferred'],
    ['PUNCH_ORDER_INFERRED', 'Punch order inferred'],
    ['LEAVE_NATIONAL_SERVICE', 'National service leave'],
    ['LEAVE_SICK', 'Sick leave'],
    ['LEAVE_ANNUAL', 'Annual leave'],
    ['SHIFT_OVERRIDE_OFF', 'Off duty by shift override'],
    ['SHIFT_OVERRIDE_WORK', 'Scheduled by shift override'],
    ['NO_CREW_MEMBERSHIP', 'No crew assignment'],
    ['NO_CREW_SCHEDULE', 'No crew schedule'],
    ['CREW_SCHEDULE_OFF', 'Off duty on the crew schedule'],
    ['NO_SCHEDULED_OCCURRENCE', 'Scheduled shift is not available'],
    ['verified_punch', 'Verified attendance punch'],
    ['ATTENDANCE_ADJUSTMENT_CHANGED', 'Attendance adjustment changed'],
    ['UNRECOGNIZED_REASON', 'Attendance reason is not yet available.'],
  ])('translates self reason %s without leaking raw codes', async (reason, label) => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(SELF_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(
      snapshot({ ...selfSnapshot(), self: { employee_id: 'G100', presence_state: 'on_duty', reason_code: reason } }),
    )
    renderWidget(vi.fn(), { tier: 'glance', rows: 0 })

    expect(await screen.findByText(label)).toBeInTheDocument()
    expect(screen.queryByText(reason)).not.toBeInTheDocument()
  })

  it('translates self reasons in Arabic', async () => {
    vi.mocked(api.getWorkforceAccess).mockResolvedValue(SELF_ACCESS)
    vi.mocked(api.getWorkforceSnapshot).mockResolvedValue(selfSnapshot())
    await i18n.changeLanguage('ar')
    renderWidget(vi.fn(), { tier: 'glance', rows: 0 })

    expect(await screen.findByText('بصمة أثناء الدوام')).toBeInTheDocument()
  })

  it('shows an in-frame skeleton while capabilities are loading', () => {
    mockUseCapabilities.mockReturnValue({ capabilities: new Set(), isLoading: true, has: () => false })
    renderWidget()
    expect(screen.getByRole('region', { name: 'Workforce pulse' })).toBeInTheDocument()
    expect(screen.getByLabelText('Loading…')).toBeInTheDocument()
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
