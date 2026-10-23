import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ExpiringSoonWidget } from './ExpiringSoonWidget'
import type { WidgetTier } from './types'

const state = vi.hoisted(() => ({ employeeAccess: false }))
vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: (cap: string) => cap === 'employees.view' ? state.employeeAccess : true }) }))
vi.mock('@/lib/api', () => ({ api: { getExpiry: vi.fn() } }))
import { api } from '@/lib/api'

function setup(tier: WidgetTier = 'list', seed = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seed) client.setQueryData(['expiry', 'soon'], [
    { employee_id: 'G1', name_en: 'Aisha Noor', name_ar: 'عائشة نور', doc_type: 'passport', days_remaining: -2, bucket: 'expired' },
    { employee_id: 'G2', name_en: 'Sara Ali', name_ar: 'سارة علي', doc_type: 'uae_id', days_remaining: 20, bucket: 'critical' },
  ])
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><MemoryRouter><ExpiringSoonWidget tier={tier} rows={1} /></MemoryRouter></I18nextProvider></QueryClientProvider>)
}

beforeEach(() => { state.employeeAccess = false; vi.clearAllMocks(); void i18n.changeLanguage('en') })

it.each<WidgetTier>(['glance', 'summary', 'tall', 'list'])('renders the %s tier with true 90-day counts', (tier) => {
  setup(tier)
  expect(screen.getByRole('link', { name: /View all/i })).toHaveAttribute('href', '/expiry')
  if (tier === 'glance' || tier === 'summary') {
    expect(screen.getByText('1 expired')).toBeInTheDocument()
    expect(screen.getByText('1 within 30 days')).toBeInTheDocument()
  } else {
    expect(screen.getByText('Aisha Noor')).toBeInTheDocument()
    expect(screen.queryByText('Sara Ali')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '+1 more' })).toHaveAttribute('href', '/expiry')
  }
})

it('keeps employee data informational without employees.view', () => {
  setup()
  expect(screen.getByText('Aisha Noor').closest('a')).toBeNull()
})

it('links to the documents tab when employees.view is granted', () => {
  state.employeeAccess = true
  setup()
  expect(screen.getByText('Aisha Noor').closest('a')).toHaveAttribute('href', '/employees/G1?tab=documents')
})

it('renders boxed loading and retry states rather than disappearing', async () => {
  vi.mocked(api.getExpiry).mockRejectedValue(new Error('offline'))
  setup('glance', false)
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument()
})

it('links the empty state to expiry without requiring employee access', async () => {
  vi.mocked(api.getExpiry).mockResolvedValue([])
  setup('glance', false)
  expect(await screen.findByRole('link', { name: 'Review expiry' })).toHaveAttribute('href', '/expiry')
})
