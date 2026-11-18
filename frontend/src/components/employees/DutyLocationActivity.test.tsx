import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DutyLocationActivity } from './DutyLocationActivity'

const language = vi.hoisted(() => ({ value: 'en' }))

vi.mock('react-i18next', () => {
  const messages: Record<string, Record<string, string> | undefined> = {
      en: {
        'employees.activity.dutyLocation.initial_placement': 'Initial placement',
        'employees.activity.dutyLocation.transfer': 'Transferred',
        'employees.activity.dutyLocation.unassigned': 'Unassigned',
        'employees.activity.dutyLocation.historyBegins': 'History begins at',
        'employees.activity.dutyLocation.service_end': 'Service ended',
        'employees.activity.dutyLocation.transfer_out': 'Transferred out',
        'employees.activity.dutyLocation.reinstatement': 'Reinstated',
        'employees.activity.dutyLocation.toEndedService': 'Ended service',
        'employees.activity.dutyLocation.toTransferred': 'Transferred',
        'employees.activity.dutyLocation.returnedTo': 'Returned to',
      },
      ar: {
        'employees.activity.dutyLocation.initial_placement': 'التعيين الأولي',
        'employees.activity.dutyLocation.transfer': 'تم النقل',
        'employees.activity.dutyLocation.unassigned': 'غير محدد',
        'employees.activity.dutyLocation.historyBegins': 'يبدأ السجل من',
        'employees.activity.dutyLocation.service_end': 'انتهاء الخدمة',
        'employees.activity.dutyLocation.toEndedService': 'منتهي الخدمة',
      },
  }
  return {
    useTranslation: () => ({
      i18n: { language: language.value },
      t: (key: string) => messages[language.value]?.[key] ?? key,
    }),
  }
})

describe('DutyLocationActivity', () => {
  afterEach(() => {
    language.value = 'en'
    document.documentElement.dir = ''
  })

  it('renders a transfer from the historical origin to the destination', () => {
    render(
      <DutyLocationActivity
        item={{
          event_type: 'transfer',
          from_unit: 'Administration',
          from_post: 'Main Gate',
          to_unit: 'Operations',
          to_post: 'Control Room',
          reason: 'Operational coverage',
        }}
      />,
    )

    expect(screen.getByText('Transferred')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement).toHaveTextContent('Administration / Main Gate')
    expect(movement).toHaveTextContent('Operations / Control Room')
    expect(movement.textContent?.indexOf('Administration')).toBeLessThan(movement.textContent?.indexOf('Operations') ?? -1)
    expect(screen.getByText('Operational coverage')).toBeInTheDocument()
  })

  it('identifies an initial placement when no historical origin was recorded', () => {
    render(<DutyLocationActivity item={{ event_type: 'initial_placement', to_unit: 'Security', to_post: 'North Gate' }} />)

    expect(screen.getByText('Initial placement')).toBeInTheDocument()
    expect(screen.getByText('History begins at')).toBeInTheDocument()
    expect(screen.getByText('Security / North Gate')).toBeInTheDocument()
  })

  it('inherits RTL direction and isolates Latin location labels in origin-to-destination order', () => {
    language.value = 'ar'
    document.documentElement.dir = 'rtl'
    render(<DutyLocationActivity item={{ event_type: 'transfer', from_unit: 'Administration', to_unit: 'Operations' }} />)

    expect(screen.getByText('تم النقل')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement).not.toHaveAttribute('dir')
    expect(movement.querySelectorAll('bdi')).toHaveLength(2)
    expect(movement.textContent?.indexOf('Administration')).toBeLessThan(movement.textContent?.indexOf('Operations') ?? -1)
    expect(movement.querySelector('svg')).toHaveClass('rtl:rotate-180')
  })

  it('shows a service end as a move from the post to Ended service', () => {
    render(<DutyLocationActivity item={{ event_type: 'service_end', from_unit: 'Security', from_post: 'North Gate' }} />)

    expect(screen.getByText('Service ended')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement).toHaveTextContent('Security / North Gate')
    expect(movement).toHaveTextContent('Ended service')
    expect(movement.textContent?.indexOf('Security')).toBeLessThan(movement.textContent?.indexOf('Ended service') ?? -1)
    expect(movement).not.toHaveTextContent('Unassigned')
  })

  it('shows a transfer out leaving for the Transferred group, from Unassigned when there was no post', () => {
    render(<DutyLocationActivity item={{ event_type: 'transfer_out' }} />)

    expect(screen.getByText('Transferred out')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement).toHaveTextContent('Unassigned')
    expect(movement).toHaveTextContent('Transferred')
    expect(movement).not.toHaveTextContent('History begins at')
  })

  it('reads a reinstatement as a return to the restored post', () => {
    render(<DutyLocationActivity item={{ event_type: 'reinstatement', to_unit: 'Security', to_post: 'North Gate' }} />)

    expect(screen.getByText('Reinstated')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement.firstElementChild).toHaveTextContent('Returned to')
    expect(movement.querySelector('bdi')).toHaveTextContent('Security / North Gate')
    expect(screen.queryByText('History begins at')).not.toBeInTheDocument()
  })

  it('mirrors the service-end arrow in Arabic and isolates the origin', () => {
    language.value = 'ar'
    document.documentElement.dir = 'rtl'
    render(<DutyLocationActivity item={{ event_type: 'service_end', from_unit: 'السرية الأولى' }} />)

    expect(screen.getByText('انتهاء الخدمة')).toBeInTheDocument()
    const movement = screen.getByTestId('duty-location-movement')
    expect(movement.querySelector('bdi')).toHaveTextContent('السرية الأولى')
    expect(movement).toHaveTextContent('منتهي الخدمة')
    expect(movement.querySelector('svg')).toHaveClass('rtl:rotate-180')
  })
})
