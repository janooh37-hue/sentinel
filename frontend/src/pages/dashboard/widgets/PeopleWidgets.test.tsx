import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { computeEndDate } from '@/lib/leaveDateMath'
import { WorkforceWidget } from './WorkforceWidget'
import { OnLeaveTodayWidget } from './OnLeaveTodayWidget'
import { ReturningWidget } from './ReturningWidget'
import { OpenViolationsWidget } from './OpenViolationsWidget'
import type { WidgetTier } from './types'

const capabilities = vi.hoisted(() => ({ denied: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => !capabilities.denied.has(cap) }) }))

const today = siteToday()
const tomorrow = computeEndDate(today, 2)
const leaves = [
  { employee_id: 'G1', employee_name_en: 'Aisha Noor', employee_name_ar: 'عائشة نور', leave_id: 10, leave_type: 'Annual Leave', start_date: computeEndDate(today, 1), end_date: today, days_remaining: 0 },
  { employee_id: 'G2', employee_name_en: 'Sara Ali', employee_name_ar: 'سارة علي', leave_id: 11, leave_type: 'Sick Leave', start_date: today, end_date: tomorrow, days_remaining: 1 },
]
const summary = {
  totals: { employees_active: 12, our_staff: 10, present_today: 8, on_leave_today: 2, loaned: 2 },
  on_leave_today: leaves, upcoming_leave_ends: leaves,
  open_violations: { count: 4, latest: [
    { id: 50, employee_id: 'G1', employee_name_en: 'Aisha Noor', employee_name_ar: 'عائشة نور', title: 'Late arrival', date: today },
    { id: 51, employee_id: 'G2', employee_name_en: 'Sara Ali', employee_name_ar: 'سارة علي', title: 'Uniform', date: today },
  ] },
}
function setup(widget: React.ReactElement, data = summary) {
  const client = new QueryClient()
  client.setQueryData(['dashboard'], data)
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter>{widget}</MemoryRouter></I18nextProvider></QueryClientProvider>)
}
beforeEach(() => { capabilities.denied.clear(); void i18n.changeLanguage('en') })

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders Workforce at %s without My and keeps each count in its own scope', (tier) => {
  setup(<WorkforceWidget tier={tier} rows={1} />)
  expect(screen.getByRole('region', { name: 'Workforce' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /12.*working/ })).toHaveAttribute('href', '/employees?working=true')
  expect(screen.getByRole('link', { name: /8.*on site/ })).toHaveAttribute('href', '/employees?present=true')
  if (tier !== 'glance') {
    expect(screen.getByRole('link', { name: /10.*our staff/ })).toHaveAttribute('href', '/employees?status=Active')
    expect(screen.getByRole('link', { name: /2.*loaned/ })).toHaveAttribute('href', '/employees?status=Loaned')
    expect(screen.getByRole('link', { name: /2.*on leave/ })).toHaveAttribute('href', `/leaves?status=Approved&on=${today}`)
  }
})

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('keeps %s Workforce leave-derived counts informational without leaves.view', (tier) => {
  capabilities.denied.add('leaves.view')
  setup(<WorkforceWidget tier={tier} rows={1} />)
  expect(screen.getByText(/on site/).closest('a')).toBeNull()
  expect(screen.getByText(/on site/)).toHaveTextContent('8')
  expect(screen.getByRole('link', { name: /12.*working/ })).toHaveAttribute('href', '/employees?working=true')
  if (tier !== 'glance') {
    expect(screen.getByText(/on leave/).closest('a')).toBeNull()
    expect(screen.getByText(/on leave/)).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: /10.*our staff/ })).toHaveAttribute('href', '/employees?status=Active')
    expect(screen.getByRole('link', { name: /2.*loaned/ })).toHaveAttribute('href', '/employees?status=Loaned')
  }
})

it('requires employees.view for employee destinations but only leaves.view for the leave destination', () => {
  capabilities.denied.add('employees.view')
  setup(<WorkforceWidget tier="summary" rows={1} />)
  for (const label of [/working/, /our staff/, /on site/, /loaned/]) {
    expect(screen.getByText(label).closest('a')).toBeNull()
  }
  expect(screen.queryByRole('link', { name: /View all/i })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /2.*on leave/ })).toHaveAttribute('href', `/leaves?status=Approved&on=${today}`)
})

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders today leave at %s with overlap filters, clipping and matching more', (tier) => {
  setup(<OnLeaveTodayWidget tier={tier} rows={1} />)
  const target = `/leaves?status=Approved&on=${today}`
  expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', target)
  if (tier === 'tall' || tier === 'list') {
    expect(screen.getByText('Aisha Noor').closest('a')).toHaveAttribute('href', '/leaves?open=10')
    expect(screen.queryByText('Sara Ali')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+1 more' })).toHaveAttribute('href', target)
  } else expect(screen.getByText('1 ending tomorrow')).toBeInTheDocument()
})

it('uses the singular record label for one leave record', () => {
  setup(<OnLeaveTodayWidget tier="summary" rows={1} />, { ...summary, on_leave_today: leaves.slice(0, 1) })
  expect(screen.getByText('leave record')).toBeInTheDocument()
})

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders returners at %s including today and inclusive ending-window links', (tier) => {
  setup(<ReturningWidget tier={tier} rows={1} />)
  const target = `/leaves?status=Approved&end_from=${today}&end_to=${computeEndDate(today, 8)}`
  expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', target)
  if (tier === 'tall' || tier === 'list') {
    expect(screen.getByText('Ends today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+1 more' })).toHaveAttribute('href', target)
  } else expect(screen.getByText(/1 tomorrow/)).toBeInTheDocument()
})

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders open violations at %s using total rather than preview length', (tier) => {
  setup(<OpenViolationsWidget tier={tier} rows={1} />)
  expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', '/employees?violations=open')
  if (tier === 'tall' || tier === 'list') {
    expect(screen.getByText('Late arrival').closest('a')).toHaveAttribute('href', '/employees/G1?tab=violations&open=50')
    expect(screen.queryByText('Uniform')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+3 more' })).toHaveAttribute('href', '/employees?violations=open')
  } else expect(screen.getByRole('link', { name: '4' })).toHaveAttribute('href', '/employees?violations=open')
})

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('preserves %s violation content without inaccessible employee links', (tier) => {
  capabilities.denied.add('employees.view')
  setup(<OpenViolationsWidget tier={tier} rows={1} />)
  expect(screen.getByRole('region', { name: 'Open violations' })).toBeInTheDocument()
  expect(screen.getByText('4')).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
  if (tier === 'tall' || tier === 'list') {
    expect(screen.getByText('Late arrival')).toBeInTheDocument()
    expect(screen.getByText('Aisha Noor')).toBeInTheDocument()
    expect(screen.getByText('+3 more')).toBeInTheDocument()
  }
})

it('keeps Arabic names and dates isolated while preserving filtered links', () => {
  void i18n.changeLanguage('ar')
  setup(<OnLeaveTodayWidget tier="list" rows={1} />)
  expect(screen.getByText('عائشة نور')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'في إجازة اليوم' })).toBeInTheDocument()
  expect(screen.getByText('عائشة نور').closest('a')).toHaveAttribute('href', '/leaves?open=10')
})

it.each(['en', 'ar'])('offers exact empty-state destinations in %s', async (language) => {
  await i18n.changeLanguage(language)
  const empty = { ...summary, totals: { ...summary.totals, employees_active: 0 }, on_leave_today: [], upcoming_leave_ends: [], open_violations: { count: 0, latest: [] } }
  for (const [Component, key, to] of [
    [WorkforceWidget, 'workspace', '/employees?working=true'],
    [OnLeaveTodayWidget, 'on_leave_today', `/leaves?status=Approved&on=${today}`],
    [ReturningWidget, 'upcoming_leave', `/leaves?status=Approved&end_from=${today}&end_to=${computeEndDate(today, 8)}`],
    [OpenViolationsWidget, 'violations', '/employees?violations=open'],
  ] as const) {
    const { unmount } = setup(<Component tier="glance" rows={0} />, empty)
    expect(screen.getByRole('link', { name: i18n.t(`dashboard.widgets.${key}.emptyAction`) })).toHaveAttribute('href', to)
    unmount()
  }
})
