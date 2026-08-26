import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DutyLocationActivity } from './DutyLocationActivity'

const language = vi.hoisted(() => ({ value: 'en' }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: language.value },
    t: (key: string) => ({
      en: {
        'employees.activity.dutyLocation.initial_placement': 'Initial placement',
        'employees.activity.dutyLocation.transfer': 'Transferred',
        'employees.activity.dutyLocation.unassigned': 'Unassigned',
        'employees.activity.dutyLocation.historyBegins': 'History begins at',
      },
      ar: {
        'employees.activity.dutyLocation.initial_placement': 'التعيين الأولي',
        'employees.activity.dutyLocation.transfer': 'تم النقل',
        'employees.activity.dutyLocation.unassigned': 'غير محدد',
        'employees.activity.dutyLocation.historyBegins': 'يبدأ السجل من',
      },
    })[language.value][key] ?? key,
  }),
}))

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
})
