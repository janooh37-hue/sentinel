import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type {
  ActivityItemRead,
  RecentLeaveRead,
  RecentViolationRead,
} from '@/lib/api'
import type { Tab } from '../EmployeeTabChips'
import { ActivityTab } from './ActivityTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => ({
      'employees.activity.dutyLocation.initial_placement': 'Initial placement',
      'employees.activity.dutyLocation.transfer': 'Transferred',
      'employees.activity.dutyLocation.unassigned': 'Unassigned',
      'employees.activity.dutyLocation.historyBegins': 'History begins at',
      'employee.activity.empty': 'No activity',
    })[key] ?? key,
  }),
}))

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

interface RenderOptions {
  leaves?: RecentLeaveRead[]
  violations?: RecentViolationRead[]
  onPreviewDocs?: (docs: { id: number; name: string }[]) => void
  onOpenViolation?: (id: number) => void
  onOpenTab?: (tab: Tab) => void
}

function renderActivity(activity: ActivityItemRead[], options: RenderOptions = {}) {
  const onPreviewDocs = options.onPreviewDocs ?? vi.fn()
  const onOpenViolation = options.onOpenViolation ?? vi.fn()
  const onOpenTab = options.onOpenTab ?? vi.fn()

  render(
    <MemoryRouter initialEntries={['/employees/G100?tab=activity']}>
      <ActivityTab
        activity={activity}
        leaves={options.leaves ?? []}
        violations={options.violations ?? []}
        onPreviewDocs={onPreviewDocs}
        onOpenViolation={onOpenViolation}
        onOpenTab={onOpenTab}
      />
      <LocationProbe />
    </MemoryRouter>,
  )

  return { onPreviewDocs, onOpenViolation, onOpenTab }
}

function item(
  kind: ActivityItemRead['kind'],
  refId: number,
  summary: string,
): ActivityItemRead {
  return {
    kind,
    ref_id: refId,
    summary,
    when: '2026-08-10T09:00:00Z',
  }
}

describe('ActivityTab', () => {
  it('previews a document activity by ref id and summary', () => {
    const callbacks = renderActivity([item('document', 73, 'Leave application')])

    fireEvent.click(screen.getByRole('button', { name: 'Leave application' }))

    expect(callbacks.onPreviewDocs).toHaveBeenCalledWith([
      { id: 73, name: 'Leave application' },
    ])
  })

  it('previews linked leave documents in backend order', () => {
    const leave: RecentLeaveRead = {
      id: 18,
      leave_type: 'Annual Leave',
      start_date: '2026-08-10',
      end_date: '2026-08-12',
      days: 3,
      status: 'Approved',
      linked_documents: [
        { id: 81, template_id: 'leave_application', created_at: '2026-08-01T09:00:00Z' },
        { id: 82, template_id: 'duty_resumption', created_at: '2026-08-13T09:00:00Z' },
      ],
    }
    const callbacks = renderActivity(
      [item('leave', leave.id, 'Annual leave')],
      { leaves: [leave] },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Annual leave' }))

    expect(callbacks.onPreviewDocs).toHaveBeenCalledWith([
      { id: 81, name: 'leave_application' },
      { id: 82, name: 'duty_resumption' },
    ])
    expect(callbacks.onOpenTab).not.toHaveBeenCalled()
  })

  it('opens the leaves tab when leave activity has no linked document', () => {
    const leave: RecentLeaveRead = {
      id: 19,
      leave_type: 'National Service',
      start_date: '2026-08-10',
      end_date: '2026-08-12',
      days: 3,
      status: 'Approved',
      linked_documents: [],
    }
    const callbacks = renderActivity(
      [item('leave', leave.id, 'National service leave')],
      { leaves: [leave] },
    )

    fireEvent.click(screen.getByRole('button', { name: 'National service leave' }))

    expect(callbacks.onOpenTab).toHaveBeenCalledWith('leaves')
    expect(callbacks.onPreviewDocs).not.toHaveBeenCalled()
  })

  it('previews linked violation documents', () => {
    const violation: RecentViolationRead = {
      id: 31,
      date: '2026-08-10',
      violation_type: 'Late arrival',
      status: 'Open',
      description: null,
      linked_documents: [
        { id: 91, template_id: 'violation_notice', created_at: '2026-08-10T09:00:00Z' },
      ],
    }
    const callbacks = renderActivity(
      [item('violation', violation.id, 'Late arrival')],
      { violations: [violation] },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Late arrival' }))

    expect(callbacks.onPreviewDocs).toHaveBeenCalledWith([
      { id: 91, name: 'violation_notice' },
    ])
    expect(callbacks.onOpenViolation).not.toHaveBeenCalled()
  })

  it('deep-links an unlinked violation through the employee page callback', () => {
    const callbacks = renderActivity([item('violation', 32, 'Manual violation')])

    fireEvent.click(screen.getByRole('button', { name: 'Manual violation' }))

    expect(callbacks.onOpenViolation).toHaveBeenCalledWith(32)
    expect(callbacks.onPreviewDocs).not.toHaveBeenCalled()
  })

  it('navigates ledger activity to the established record deep link', () => {
    renderActivity([item('ledger', 44, 'Ledger entry')])

    fireEvent.click(screen.getByRole('button', { name: 'Ledger entry' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/ledger?open=44')
  })

  it('opens the absences tab for an absence activity', () => {
    const callbacks = renderActivity([item('absence', 55, 'Absent')])

    fireEvent.click(screen.getByRole('button', { name: 'Absent' }))

    expect(callbacks.onOpenTab).toHaveBeenCalledWith('absences')
  })

  it('keeps structured duty location history rendered and non-interactive', () => {
    const activity: ActivityItemRead[] = [{
      kind: 'duty_location',
      ref_id: 18,
      when: '2026-08-10T09:00:00Z',
      summary: 'Transferred',
      event_type: 'transfer',
      from_unit: 'Administration',
      from_post: 'Main Gate',
      to_unit: 'Operations',
      to_post: 'Control Room',
      reason: 'Operational coverage',
    }]

    renderActivity(activity)

    expect(screen.getByText('Transferred')).toBeInTheDocument()
    expect(screen.getByText('Administration / Main Gate')).toBeInTheDocument()
    expect(screen.getByText('Operations / Control Room')).toBeInTheDocument()
    expect(screen.getByText('Operational coverage')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transferred' })).not.toBeInTheDocument()
  })
})
