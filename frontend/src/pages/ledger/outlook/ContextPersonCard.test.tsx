import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityItemRead, EmployeeDetailRead } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import { api } from '@/lib/api'
import { ContextPersonCard } from './ContextPersonCard'

const { capabilities } = vi.hoisted(() => ({ capabilities: new Set<string>() }))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => capabilities.has(cap) }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en' },
  }),
}))
vi.mock('@/lib/api', async (original) => {
  const real = await original<typeof ApiModule>()
  return { ...real, api: { ...real.api, getEmployee: vi.fn(), getEmployeeDetail: vi.fn() } }
})

const activity = (kind: ActivityItemRead['kind'], ref_id: number, summary: string): ActivityItemRead => ({
  kind, ref_id, summary, when: '2026-10-01T09:00:00Z',
})
const detail: EmployeeDetailRead = {
  employee: {
    id: 'G100', name_en: 'John Doe', name_ar: null, status: 'Active',
    dob: null, doj: '2020-01-01', doj_company: null, end_date: null, pending_status: null,
    department: 'Operations', position: null, position_ar: null, other: null,
    duty_unit: null, duty_post: null, notes: null, passport_no: null, uae_id_no: null,
    nationality: 'Emirati', contact: '0501234567', msg_language: 'en', passport_expiry: null,
    uae_id_expiry: null, iban: null, created_at: '2020-01-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', has_photo: false, has_passport_scan: false,
  },
  stats: { documents: 2, leaves_taken_days: 7, leaves_allowed_days: 30, violations: 1, absence_days: 3, ledger_count: 1, tenure_years: 6 },
  recent_documents: [], recent_leaves: [], recent_violations: [], recent_absences: [],
  recent_ledger: [], recent_sms: [], missing_fields: [], completeness: { filled: 10, tracked: 14 },
  recent_activity: [
    activity('leave', 1, 'Private leave dates'), activity('absence', 2, 'Private absence dates'),
    activity('document', 3, 'Document issued'), activity('violation', 4, 'Violation recorded'),
    activity('ledger', 5, 'Letter received'), activity('duty_location', 6, 'Duty moved'),
    activity('status', 7, 'Status updated'), activity('document', 8, 'Sixth unrelated fact'),
  ],
}

beforeEach(() => {
  capabilities.clear()
  vi.mocked(api.getEmployee).mockResolvedValue(detail.employee)
  vi.mocked(api.getEmployeeDetail).mockResolvedValue(detail)
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => <QueryClientProvider client={client}><ContextPersonCard employeeId="G100" /></QueryClientProvider>
  const view = render(tree())
  return () => view.rerender(tree())
}

describe('ContextPersonCard leave privacy', () => {
  it.each([{ grants: [] }, { grants: ['employees.view'] }, { grants: ['leaves.view'] }])('redacts leaves without both capabilities: $grants', async ({ grants }) => {
    for (const cap of grants) capabilities.add(cap)
    mount()
    await userEvent.click(screen.getByTestId('cx-person-header'))
    const balance = await screen.findByTestId('cx-fact-leave')
    expect(within(balance).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Private leave dates')).not.toBeInTheDocument()
    expect(screen.queryByText('Private absence dates')).not.toBeInTheDocument()
    for (const summary of ['Document issued', 'Violation recorded', 'Letter received', 'Duty moved', 'Status updated']) {
      expect(screen.getByText(summary)).toBeInTheDocument()
    }
    expect(screen.queryByText('Sixth unrelated fact')).not.toBeInTheDocument()
    expect(screen.getByTestId('cx-fact-mobile')).toHaveTextContent('0501234567')
    expect(screen.getByTestId('cx-fact-nationality')).toHaveTextContent('Emirati')
    expect(screen.getByTestId('cx-fact-joined')).toHaveTextContent('2020')
  })

  it('immediately redacts cached leave facts on revoke and restores them on regrant', async () => {
    capabilities.add('employees.view')
    capabilities.add('leaves.view')
    const refresh = mount()
    await userEvent.click(screen.getByTestId('cx-person-header'))
    expect(await screen.findByText('Private leave dates')).toBeInTheDocument()
    expect(screen.getByText('Private absence dates')).toBeInTheDocument()
    expect(screen.getByTestId('cx-fact-leave')).toHaveTextContent('ledger.outlook.facts.days:23')
    capabilities.delete('leaves.view')
    refresh()
    expect(within(screen.getByTestId('cx-fact-leave')).getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('Private leave dates')).not.toBeInTheDocument()
    expect(screen.queryByText('Private absence dates')).not.toBeInTheDocument()
    expect(screen.getByText('Status updated')).toBeInTheDocument()
    capabilities.add('leaves.view')
    refresh()
    expect(screen.getByText('Private leave dates')).toBeInTheDocument()
    expect(screen.getByTestId('cx-fact-leave')).toHaveTextContent('ledger.outlook.facts.days:23')
  })
})
