import { render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { expect, it } from 'vitest'

import type { CompanyStats, CompanyStatsTotals } from '@/lib/api'
import ar from '@/locales/ar.json'

import { NationalServiceCard } from './NationalServiceCard'

const zero = { days: 0, count: 0 }
const totals: CompanyStatsTotals = {
  strength: 0, duties_scheduled: 0, duties_excused: 0, duties_due: 0, duties_pending: 0,
  absence: { days: 0, episodes: 0 }, single_punch: 0, late: { count: 0, minutes: 0 }, absence_rate: null,
  leaves: {
    annual: zero, administrative: zero, sick: zero, duty: zero, national_service: { days: 12, count: 1 }, other: zero,
    exit_permits: { count: 0, hours: null, with_hours: 0 },
  },
}
const period = { from_date: '2026-10-01', to_date: '2026-10-31', requested_to_date: '2026-10-31', days: 31, clamped: false }
const data: CompanyStats = {
  period, previous_period: period, closed_through: period.to_date, coverage_from: null, previous_comparable: false,
  duty_unit: null, granularity: 'week', summary: { current: totals, previous: totals }, companies: [], overall: totals,
  series: [], ranking: { total: 0, average_score: 0, order: { score: [], absence: [], late: [], single_punch: [] }, rows: [] },
  national_service: {
    absence_days: 12,
    enrolled: [{
      employee_id: 'G136', name_en: 'Sultan Al Shamsi', name_ar: 'سلطان الشامسي', duty_unit: null,
      start_date: '2026-09-01', end_date: '2026-12-16', return_date: '2026-12-17', days_remaining: 2, progress: 0.981,
    }],
  },
}

it('renders the live progress, return date and digit-less Arabic dual in RTL', async () => {
  const direction = document.documentElement.dir
  const language = i18n.language
  i18n.addResourceBundle('ar', 'translation', ar)
  document.documentElement.dir = 'rtl'
  await i18n.changeLanguage('ar')
  try {
    render(<NationalServiceCard data={data} />)
    const employee = screen.getByRole('listitem')
    expect(within(employee).getByText('سلطان الشامسي')).toHaveAttribute('dir', 'auto')
    expect(within(employee).getByText('المتبقي:')).toHaveTextContent('المتبقي: يومان')
    expect(within(employee).getByText('غير محدد')).toBeInTheDocument()
    expect(within(employee).getByText(/17 ديسمبر 2026/)).toHaveAttribute('datetime', '2026-12-17')
    expect(within(employee).getByRole('progressbar', { name: 'تقدم الخدمة الوطنية: سلطان الشامسي' }))
      .toHaveAttribute('aria-valuenow', '98')
    expect(screen.getByText('12')).toBeInTheDocument()
  } finally {
    document.documentElement.dir = direction
    await i18n.changeLanguage(language)
  }
})

it('keeps the period total visible when no one is currently enrolled', () => {
  render(<NationalServiceCard data={{ ...data, national_service: { ...data.national_service, enrolled: [] } }} />)
  expect(screen.getByText('No one in this scope is currently enrolled.')).toBeInTheDocument()
  expect(screen.getByText('National Service absence days in the period')).toBeInTheDocument()
  expect(screen.getByText('12')).toBeInTheDocument()
})
