import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActivityItemRead } from '@/lib/api'
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

describe('ActivityTab', () => {
  it('renders structured duty location history with the shared presentation', () => {
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

    render(<ActivityTab activity={activity} />)

    expect(screen.getByText('Transferred')).toBeInTheDocument()
    expect(screen.getByText('Administration / Main Gate')).toBeInTheDocument()
    expect(screen.getByText('Operations / Control Room')).toBeInTheDocument()
    expect(screen.getByText('Operational coverage')).toBeInTheDocument()
  })
})
