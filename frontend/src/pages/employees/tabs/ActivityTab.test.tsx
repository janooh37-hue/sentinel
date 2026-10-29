import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18n from 'i18next'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type * as ApiModule from '@/lib/api'

import ar from '@/locales/ar.json'
import type { Tab } from '../EmployeeTabChips'
import type { ActivityStatement, ActivityStatementItem } from '../statement/statementTypes'
import { ActivityTab } from './ActivityTab'

const hasCapability = vi.hoisted(() => vi.fn<(cap: string) => boolean>(() => true))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: hasCapability }),
}))
vi.mock('@/components/employees/useAttendanceAttention', () => ({ siteToday: () => '2026-10-27' }))
const getActivityStatement = vi.hoisted(() => vi.fn())
const listTemplates = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return { ...actual, api: { ...actual.api, getActivityStatement, listTemplates } }
})

if (!i18n.hasResourceBundle('ar', 'translation')) i18n.addResourceBundle('ar', 'translation', ar)

const EMPLOYEE = {
  status: 'Active' as const,
  department: 'Operations',
  duty_unit: 'Control Room',
  duty_post: 'Supervisor',
  doj_company: '2019-03-04',
  doj: null,
}

beforeEach(async () => {
  hasCapability.mockReturnValue(true)
  getActivityStatement.mockReset()
  listTemplates.mockResolvedValue({
    items: [
      { id: 'leave_application', name_en: 'Leave Application', name_ar: 'طلب إجازة' },
      { id: 'duty_resumption', name_en: 'Duty Resumption', name_ar: 'مباشرة عمل' },
      { id: 'violation_notice', name_en: 'Violation Notice', name_ar: 'إشعار مخالفة' },
    ],
  })
  await i18n.changeLanguage('en')
})
afterEach(async () => {
  await i18n.changeLanguage('en')
})

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function item(kind: ActivityStatementItem['kind'], sourceId: number, extra: Partial<ActivityStatementItem> = {}): ActivityStatementItem {
  return {
    kind,
    source_id: sourceId,
    occurred_at: '2026-08-10T09:30:00',
    date_only: false,
    actor_name: 'Mariam Al Kaabi',
    reference: null,
    template_id: null,
    template_name_en: null,
    template_name_ar: null,
    leave_type: null,
    start_date: null,
    end_date: null,
    days: null,
    leave_status: null,
    violation_type: null,
    description: null,
    action_taken: null,
    deduction_days: null,
    violation_status: null,
    subject: null,
    direction: null,
    channel: null,
    counterparty: null,
    note: null,
    event_type: null,
    from_department: null,
    from_unit: null,
    from_post: null,
    to_department: null,
    to_unit: null,
    to_post: null,
    reason: null,
    from_status: null,
    to_status: null,
    effective_date: null,
    site: null,
    return_date: null,
    status_event_kind: null,
    status_source: null,
    linked_documents: [],
    ...extra,
  }
}

function statement(items: ActivityStatementItem[], truncated = false): ActivityStatement {
  return { employee_id: 'G100', from_date: null, to_date: null, items, truncated }
}

interface Callbacks {
  onPreviewDocs: Mock
  onOpenViolation: Mock
  onOpenTab: Mock
}

function renderActivity(items: ActivityStatementItem[], search = '?tab=activity'): Callbacks {
  getActivityStatement.mockResolvedValue(statement(items))
  const callbacks: Callbacks = { onPreviewDocs: vi.fn(), onOpenViolation: vi.fn(), onOpenTab: vi.fn() }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/employees/G100${search}`]}>
        <ActivityTab
          employeeId="G100"
          employee={EMPLOYEE}
          onPreviewDocs={callbacks.onPreviewDocs as (docs: { id: number; name: string }[], index?: number) => void}
          onOpenViolation={callbacks.onOpenViolation as (id: number) => void}
          onOpenTab={callbacks.onOpenTab as (tab: Tab) => void}
        />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return callbacks
}

async function expandEntry(testId: string): Promise<HTMLElement> {
  const row = await screen.findByTestId(testId)
  fireEvent.click(within(row).getByRole('button', { expanded: false }))
  return row
}

describe('ActivityTab period', () => {
  it('queries this year to today by default and shows the range', async () => {
    renderActivity([item('document', 1, { template_name_en: 'Salary Certificate' })])
    await screen.findByTestId('activity-summary')
    expect(getActivityStatement).toHaveBeenCalledWith('G100', { from_date: '2026-01-01', to_date: '2026-10-27' })
    expect(screen.getByTestId('activity-period-range')).toHaveTextContent('1 Jan to 27 Oct 2026')
  })

  it('refetches with the right bounds when the period changes and keeps it in the URL', async () => {
    renderActivity([item('document', 1, { template_name_en: 'Salary Certificate' })])
    await screen.findByTestId('activity-summary')

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'month' } })
    await waitFor(() =>
      expect(getActivityStatement).toHaveBeenLastCalledWith('G100', { from_date: '2026-10-01', to_date: '2026-10-27' }),
    )
    expect(screen.getByTestId('location')).toHaveTextContent('period=month')

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'all' } })
    await waitFor(() => expect(getActivityStatement).toHaveBeenLastCalledWith('G100', { to_date: '2026-10-27' }))
  })

  it('restores a custom range from the URL and refetches when an end date is edited', async () => {
    renderActivity([item('document', 1, { template_name_en: 'Salary Certificate' })], '?tab=activity&period=custom&from=2026-03-01&to=2026-04-30')
    await screen.findByTestId('activity-summary')
    expect(getActivityStatement).toHaveBeenCalledWith('G100', { from_date: '2026-03-01', to_date: '2026-04-30' })

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-05-31' } })
    await waitFor(() =>
      expect(getActivityStatement).toHaveBeenLastCalledWith('G100', { from_date: '2026-03-01', to_date: '2026-05-31' }),
    )
  })

  it('falls back to this year for an impossible or reversed custom date', async () => {
    renderActivity([item('document', 1, { template_name_en: 'Salary Certificate' })], '?tab=activity&period=custom&from=2026-02-30&to=2026-04-30')
    await screen.findByTestId('activity-summary')
    expect(getActivityStatement).toHaveBeenCalledWith('G100', { from_date: '2026-01-01', to_date: '2026-10-27' })
    expect(screen.getByLabelText('Period')).toHaveValue('year')
  })

  it('opens the print setup with the current period', async () => {
    renderActivity([item('document', 1, { template_name_en: 'Salary Certificate' })], '?tab=activity&period=last3')
    await screen.findByTestId('activity-summary')
    fireEvent.click(screen.getByRole('button', { name: 'Print activity statement' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/employees/G100/activity/print?period=last3')
  })
})

describe('ActivityTab summary and filter', () => {
  const mixed = [
    item('leave', 1, { leave_type: 'Annual Leave', days: 28, start_date: '2026-09-01', end_date: '2026-09-28', date_only: true, occurred_at: '2026-09-01T00:00:00' }),
    item('leave', 2, { leave_type: 'Sick Leave', days: 2, start_date: '2026-08-03', end_date: '2026-08-04', date_only: true, occurred_at: '2026-08-03T00:00:00' }),
    item('violation', 3, { violation_type: 'Late arrival', date_only: true }),
    item('document', 4, { template_name_en: 'Salary Certificate' }),
    item('duty_location', 5, { event_type: 'transfer', to_unit: 'Operations' }),
  ]

  it('writes one sentence from the counts and omits zero categories', async () => {
    renderActivity(mixed)
    expect(await screen.findByTestId('activity-summary')).toHaveTextContent(
      '2 leaves totalling 30 days, 1 violation, 1 document issued and 1 transfer.',
    )
  })

  it('states an empty period', async () => {
    renderActivity([])
    expect(await screen.findByTestId('activity-summary')).toHaveTextContent('No activity in this period.')
  })

  it('hides and shows a category and updates the showing line', async () => {
    renderActivity(mixed)
    await screen.findByTestId('activity-summary')
    expect(screen.getByTestId('activity-showing')).toHaveTextContent('Showing 5 of 5 entries')

    const leave = screen.getByRole('button', { name: /^Leave/ })
    expect(leave).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(leave)
    expect(leave).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('activity-showing')).toHaveTextContent('Showing 3 of 5 entries')
    expect(screen.queryByTestId('activity-entry-leave-1')).not.toBeInTheDocument()

    fireEvent.click(leave)
    expect(screen.getByTestId('activity-showing')).toHaveTextContent('Showing 5 of 5 entries')
    expect(screen.getByTestId('activity-entry-leave-1')).toBeInTheDocument()
  })

  it('groups entries by month with an entry count', async () => {
    renderActivity(mixed)
    const august = await screen.findByRole('region', { name: 'August 2026' })
    expect(within(august).getByText('4 entries')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'September 2026' })).toBeInTheDocument()
  })

  it('does not offer leave and absence categories without leaves.view', async () => {
    hasCapability.mockImplementation((cap) => cap !== 'leaves.view')
    renderActivity([item('document', 4, { template_name_en: 'Salary Certificate' })])
    await screen.findByTestId('activity-summary')
    expect(screen.queryByRole('button', { name: /^Leave/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Absence/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Document/ })).toBeInTheDocument()
  })

  it('uses English plural forms', async () => {
    renderActivity([item('violation', 3, { violation_type: 'Late arrival' }), item('absence', 6, { note: 'No call' })])
    expect(await screen.findByTestId('activity-summary')).toHaveTextContent('1 violation and 1 absence.')
  })

  it('writes the Arabic summary with the dual and Western digits', async () => {
    await i18n.changeLanguage('ar')
    renderActivity([
      item('violation', 1, { violation_type: 'Late arrival' }),
      item('violation', 2, { violation_type: 'Late arrival' }),
      item('document', 3, { template_name_ar: 'شهادة راتب' }),
      item('leave', 4, { leave_type: 'Annual Leave', days: 11, start_date: '2026-09-01', end_date: '2026-09-11' }),
      item('leave', 5, { leave_type: 'Annual Leave', days: 11, start_date: '2026-09-12', end_date: '2026-09-22' }),
      item('leave', 6, { leave_type: 'Annual Leave', days: 11, start_date: '2026-10-01', end_date: '2026-10-11' }),
    ])
    const summary = (await screen.findByTestId('activity-summary')).textContent ?? ''
    expect(summary).toContain('3 إجازات بإجمالي 33 يومًا')
    expect(summary).toContain('مخالفتان')
    expect(summary).toContain('مستند واحد صادر')
    expect(summary).not.toMatch(/[٠-٩]/)
    expect(screen.getByTestId('activity-period-range').textContent).not.toMatch(/[٠-٩]/)
    expect(screen.getByTestId('activity-period-range').textContent).toContain('1 يناير')
  })
})

describe('ActivityTab entries', () => {
  it('builds a bold-actor sentence from real fields with date, time and reference', async () => {
    renderActivity([
      item('document', 1, { template_name_en: 'Salary Certificate', reference: 'G100/1/12/7', occurred_at: '2026-10-12T10:42:00' }),
    ])
    const row = await screen.findByTestId('activity-entry-document-1')
    expect(row).toHaveTextContent('Mariam Al Kaabi issued a Salary Certificate')
    expect(within(row).getByText('Mariam Al Kaabi').tagName).toBe('BDI')
    expect(within(row).getByText('Salary Certificate').closest('b')).not.toBeNull()
    expect(row).toHaveTextContent('12 Oct 2026')
    expect(row).toHaveTextContent('10:42')
    expect(within(row).getByText('G100/1/12/7')).toHaveAttribute('dir', 'ltr')
  })

  it('writes the sentence without an actor when none is recorded and omits the time for date-only kinds', async () => {
    renderActivity([
      item('leave', 1, {
        actor_name: null,
        leave_type: 'Annual Leave',
        days: 28,
        start_date: '2026-09-01',
        end_date: '2026-09-28',
        date_only: true,
        occurred_at: '2026-09-01T00:00:00',
      }),
    ])
    const row = await screen.findByTestId('activity-entry-leave-1')
    expect(row).toHaveTextContent('Annual Leave, 28 days, 1 Sept to 28 Sept 2026')
    expect(row).not.toHaveTextContent('00:00')
    expect(row).not.toHaveTextContent('recorded')
  })

  it('shows correspondence direction, subject and counterparty', async () => {
    renderActivity([item('ledger', 7, { direction: 'incoming', subject: 'Contract renewal', counterparty: 'HR Authority' })])
    expect(await screen.findByTestId('activity-entry-ledger-7')).toHaveTextContent(
      'Mariam Al Kaabi logged incoming letter Contract renewal from HR Authority',
    )
  })

  it('translates the correspondence channel and falls back to the raw value for unknown ones', async () => {
    renderActivity([
      item('ledger', 8, { direction: 'incoming', subject: 'A', channel: 'in_person' }),
      item('ledger', 9, { direction: 'incoming', subject: 'B', channel: 'carrier_pigeon' }),
    ])
    const known = await expandEntry('activity-entry-ledger-8')
    expect(known).toHaveTextContent('In person')
    expect(known).not.toHaveTextContent('in_person')
    const unknown = await expandEntry('activity-entry-ledger-9')
    expect(unknown).toHaveTextContent('carrier_pigeon')
  })

  it('expands in place with facts, recorded by and reference', async () => {
    renderActivity([item('violation', 3, { violation_type: 'Late arrival', description: 'Arrived 40 minutes late', reference: 'V-3' })])
    const row = await expandEntry('activity-entry-violation-3')
    expect(within(row).getByRole('button', { expanded: true })).toBeInTheDocument()
    expect(row).toHaveTextContent('Arrived 40 minutes late')
    expect(row).toHaveTextContent('Recorded by')
  })

  it('previews a document from its expanded entry', async () => {
    const callbacks = renderActivity([item('document', 73, { template_name_en: 'Leave application' })])
    const row = await expandEntry('activity-entry-document-73')
    fireEvent.click(within(row).getByRole('button', { name: 'Preview document' }))
    expect(callbacks.onPreviewDocs).toHaveBeenCalledWith([{ id: 73, name: 'Leave application' }])
  })

  it('previews linked leave documents in order', async () => {
    const callbacks = renderActivity([
      item('leave', 18, {
        leave_type: 'Annual Leave',
        linked_documents: [
          { id: 81, template_id: 'leave_application', created_at: '2026-08-01T09:00:00Z' },
          { id: 82, template_id: 'duty_resumption', created_at: '2026-08-13T09:00:00Z' },
        ],
      }),
    ])
    const row = await expandEntry('activity-entry-leave-18')
    fireEvent.click(within(row).getByRole('button', { name: 'Duty Resumption' }))
    expect(callbacks.onPreviewDocs).toHaveBeenCalledWith(
      [
        { id: 81, name: 'Leave Application' },
        { id: 82, name: 'Duty Resumption' },
      ],
      1,
    )
    expect(callbacks.onOpenTab).not.toHaveBeenCalled()
  })

  it('opens the leaves tab for a leave with no linked document', async () => {
    const callbacks = renderActivity([item('leave', 19, { leave_type: 'National Service' })])
    const row = await expandEntry('activity-entry-leave-19')
    fireEvent.click(within(row).getByRole('button', { name: 'Open in Leaves' }))
    expect(callbacks.onOpenTab).toHaveBeenCalledWith('leaves')
    expect(callbacks.onPreviewDocs).not.toHaveBeenCalled()
  })

  it('previews linked violation documents and deep-links an unlinked violation', async () => {
    const linked = renderActivity([
      item('violation', 31, {
        violation_type: 'Late arrival',
        linked_documents: [{ id: 91, template_id: 'violation_notice', created_at: '2026-08-10T09:00:00Z' }],
      }),
    ])
    const row = await expandEntry('activity-entry-violation-31')
    fireEvent.click(within(row).getByRole('button', { name: 'Violation Notice' }))
    expect(linked.onPreviewDocs).toHaveBeenCalledWith([{ id: 91, name: 'Violation Notice' }], 0)
    expect(linked.onOpenViolation).not.toHaveBeenCalled()
  })

  it('deep-links an unlinked violation through the page callback', async () => {
    const callbacks = renderActivity([item('violation', 32, { violation_type: 'Late arrival' })])
    const row = await expandEntry('activity-entry-violation-32')
    fireEvent.click(within(row).getByRole('button', { name: 'Open violation' }))
    expect(callbacks.onOpenViolation).toHaveBeenCalledWith(32)
  })

  it('navigates correspondence to the ledger record', async () => {
    renderActivity([item('ledger', 44, { subject: 'Notice', direction: 'outgoing' })])
    const row = await expandEntry('activity-entry-ledger-44')
    fireEvent.click(within(row).getByRole('button', { name: 'Open in Ledger' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/ledger?mail=44')
  })

  it('opens the absences tab for an absence', async () => {
    const callbacks = renderActivity([item('absence', 55, { note: 'No call' })])
    const row = await expandEntry('activity-entry-absence-55')
    fireEvent.click(within(row).getByRole('button', { name: 'Open in Absences' }))
    expect(callbacks.onOpenTab).toHaveBeenCalledWith('absences')
  })

  it('renders placement and status history with their existing wording and no action', async () => {
    renderActivity([
      item('duty_location', 18, { event_type: 'transfer', from_unit: 'Administration', from_post: 'Main Gate', to_unit: 'Operations', to_post: 'Control Room', reason: 'Operational coverage' }),
      item('status', 19, { from_status: 'Active', to_status: 'Transferred', site: 'Port A', effective_date: '2026-08-15', status_event_kind: 'changed', status_source: 'manual' }),
    ])
    expect(await screen.findByText('Administration / Main Gate')).toBeInTheDocument()
    expect(screen.getByText('Operations / Control Room')).toBeInTheDocument()
    expect(screen.getByText('Operational coverage')).toBeInTheDocument()
    expect(screen.getByTestId('status-activity-title')).toHaveTextContent('Active → Transferred')
    const row = await expandEntry('activity-entry-status-19')
    expect(within(row).queryByRole('button', { name: /^Open/ })).not.toBeInTheDocument()
  })

  it('writes Arabic entry dates and times with Western digits', async () => {
    await i18n.changeLanguage('ar')
    renderActivity([item('document', 1, { template_name_ar: 'شهادة راتب', reference: 'G100/1/12/7', occurred_at: '2026-10-12T10:42:00' })])
    const row = await screen.findByTestId('activity-entry-document-1')
    expect(row.textContent).toContain('12 أكتوبر 2026')
    expect(row.textContent).toContain('10:42')
    expect(row.textContent).not.toMatch(/[٠-٩]/)
    expect(row).toHaveTextContent('شهادة راتب')
  })
})

describe('ActivityTab states and access', () => {
  it('shows skeleton rows while loading', () => {
    getActivityStatement.mockReturnValue(new Promise(() => undefined))
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActivityTab employeeId="G100" employee={EMPLOYEE} onPreviewDocs={vi.fn()} onOpenViolation={vi.fn()} onOpenTab={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('activity-loading')).toBeInTheDocument()
  })

  it('shows the error with a retry that refetches', async () => {
    getActivityStatement.mockRejectedValueOnce(new TypeError('offline'))
    getActivityStatement.mockResolvedValueOnce(statement([]))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActivityTab employeeId="G100" employee={EMPLOYEE} onPreviewDocs={vi.fn()} onOpenViolation={vi.fn()} onOpenTab={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('activity-summary')).toHaveTextContent('No activity in this period.')
  })

  it('does not request or show history when employee viewing is denied', () => {
    hasCapability.mockImplementation((cap) => cap !== 'employees.view')
    renderActivity([item('document', 3, { template_name_en: 'Employment certificate' })])
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission')
    expect(getActivityStatement).not.toHaveBeenCalled()
  })
})
