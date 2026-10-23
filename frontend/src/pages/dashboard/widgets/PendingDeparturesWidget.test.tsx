import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { siteToday } from '@/components/employees/useAttendanceAttention'
import { PendingDeparturesWidget } from './PendingDeparturesWidget'
import type { WidgetTier } from './types'

const state = vi.hoisted(() => ({ edit: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'employees.edit' ? state.edit : true }) }))
vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof import('@/lib/api')>()
  return { ...actual, api: { ...actual.api, listEmployees: vi.fn(), updateEmployee: vi.fn() } }
})
import { api } from '@/lib/api'

function setup(tier: WidgetTier = 'list', language = 'en') {
  void i18n.changeLanguage(language)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['employees', 'pending'], { items: [
    { id: 'G1', name_en: 'Ahmed Ali', name_ar: 'أحمد علي', status: 'Active', pending_status: 'Resigned', end_date: siteToday() },
    { id: 'G2', name_en: 'Sara Noor', name_ar: 'سارة نور', status: 'Loaned', pending_status: 'Terminated', end_date: siteToday() },
  ], total: 2 })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter><PendingDeparturesWidget tier={tier} rows={1} /></MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(() => { state.edit = false; vi.clearAllMocks() })

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders the %s tier with an exact pending destination', async (tier) => {
  setup(tier)
  expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', '/employees?pending=1')
  if (tier === 'list' || tier === 'tall') {
    expect(screen.getByText('Ahmed Ali')).toBeInTheDocument()
    expect(screen.queryByText('Sara Noor')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+1 more' })).toHaveAttribute('href', '/employees?pending=1')
  } else expect(screen.getByText('2 due in the next seven days')).toBeInTheDocument()
})

it('keeps Cancel unavailable to employees.view-only users', () => {
  setup()
  expect(screen.queryByRole('button', { name: /Cancel/ })).not.toBeInTheDocument()
})

it('Cancel clears only the end date, never reactivating a departed employee', async () => {
  state.edit = true
  vi.mocked(api.updateEmployee).mockResolvedValue({} as never)
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0 } as never)
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel departure for Ahmed Ali' }))
  await waitFor(() => expect(api.updateEmployee).toHaveBeenCalledWith('G1', { end_date: null }))
})

it('renders peer Arabic names and title', () => {
  setup('list', 'ar')
  expect(screen.getByText('أحمد علي')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /مغادرات معلّقة/ })).toBeInTheDocument()
})

it('does not truncate the due-count source at the first API page', async () => {
  void i18n.changeLanguage('en')
  vi.mocked(api.listEmployees).mockResolvedValueOnce({ items: [{ id: 'G1', end_date: siteToday() }], total: 2 } as never).mockResolvedValueOnce({ items: [{ id: 'G2', end_date: siteToday() }], total: 2 } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><PendingDeparturesWidget tier="glance" rows={1} /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByText('2 due in the next seven days')).toBeInTheDocument()
  expect(api.listEmployees).toHaveBeenLastCalledWith({ pending: true, limit: 100, offset: 1 })
})

it('links the empty state to the pending employee roster', async () => {
  await i18n.changeLanguage('en')
  vi.mocked(api.listEmployees).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter><PendingDeparturesWidget tier="glance" rows={0} /></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('link', { name: 'Review departures' })).toHaveAttribute('href', '/employees?pending=1')
})
