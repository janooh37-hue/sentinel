import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { api, type ArmoryAssignmentSummary, type ArmoryEmployeeRead } from '@/lib/api'
import { ARMORY_QUERY_KEY } from '@/lib/armory'
import { AuthContext, type AuthContextValue } from '@/lib/authContext'
import i18n from '@/lib/i18n'
import { ArmoryTab } from './ArmoryTab'

vi.mock(import('@/lib/api'), async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, api: { ...original.api, getArmoryEmployee: vi.fn() } }
})
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ has: (cap: string) => cap === 'armory.view' || cap === 'employees.view', isLoading: false }),
}))

const auth: AuthContextValue = {
  status: 'authed',
  user: {
    id: 1, employee_id: null, email: 'test@example.invalid', name_en: 'Test Operator', name_ar: null,
    position: null, department: null, photo_url: null, role: 'operator', status: 'active',
    is_admin: false, is_manager: false, has_signature: false, idle_lock_seconds: 300,
    lock_layout: 'default', scoped_role: null,
  },
  login: vi.fn(), logout: vi.fn(), refetch: vi.fn(), setUser: vi.fn(),
}
const employeeId = 'T-0001'
const person = {
  employee_id: employeeId, name_en: 'Test Guard One', name_ar: 'حارس اختبار',
  employee_status: 'Resigned', is_former: true,
}
const qualification = {
  version: 1, course_round: 3, licence_number: 'TEST-LIC-1', licence_expires_on: '2030-02-24',
  licence_status: 'expiring', licence_days_left: 12, updated_at: '2029-12-31T00:00:00Z',
} satisfies ArmoryEmployeeRead['qualification']
const safe = {
  id: 5, name_en: 'Test Safe', name_ar: 'خزنة اختبار', vehicle_site: null, duty_post: null,
  created_at: '2030-01-01T00:00:00Z',
}
const shift = {
  id: 1, kind: 'shift', state: 'active', record_ref: 'TEST-SHIFT-1', safe,
  issued_at: '2030-01-01T08:00:00Z', due_at: '2030-01-01T20:00:00Z', overdue_minutes: null,
  holder: { kind: 'person', employee: person, site_safe: null, supervisor: null },
  issuer: { user_id: 1, employee: null, display_name: 'Test Operator' },
  licence_warning_acknowledged: false, changed_kit: false,
  lines: [{
    id: 1, item: { id: 1, name_en: 'Test Radio', name_ar: 'جهاز اختبار', kind: 'serial', category: 'comms', drawing: 'radio' },
    qty: 1, remaining_qty: 1, serial_id: 1, serial_code: 'TEST-SERIAL-1', batch: null,
  }],
} satisfies ArmoryAssignmentSummary
const custody = {
  ...shift, id: 2, kind: 'custody', record_ref: 'TEST-CUSTODY-1', due_at: null,
  holder: { kind: 'site', employee: null, site_safe: { ...safe, id: 6, name_en: 'Test Site Safe' }, supervisor: person },
} satisfies ArmoryAssignmentSummary
const ended = { ...shift, id: 3, state: 'ended', record_ref: 'TEST-SHIFT-2' } satisfies ArmoryAssignmentSummary
const empty: ArmoryEmployeeRead = {
  person, qualification,
  open_assignments: [], history: { items: [], total: 0, page: 1, page_size: 1 },
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })
  render(
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={client}>
        <MemoryRouter><ArmoryTab employeeId={employeeId} /></MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
  return client
}

beforeEach(async () => {
  vi.mocked(api.getArmoryEmployee).mockReset()
  await i18n.changeLanguage('en')
})

describe('employee Armory tab', () => {
  it('shows qualification, direct and supervisor holdings for a former guard, and read-only history', async () => {
    vi.mocked(api.getArmoryEmployee).mockResolvedValue({
      ...empty, open_assignments: [shift, custody], history: { items: [ended], page: 1, page_size: 1, total: 1 },
    })
    renderTab()

    const details = await screen.findByRole('region', { name: 'Qualification' })
    expect(details).toHaveTextContent('Former employee')
    expect(within(details).getByText('3', { exact: true })).toBeInTheDocument()
    expect(details).toHaveTextContent('TEST-LIC-1')
    expect(details).toHaveTextContent('24/02/2030')
    expect(details).toHaveTextContent('Expiring')
    expect(details).toHaveTextContent('Days until expiry')
    expect(within(details).getByText('12', { exact: true })).toBeInTheDocument()

    const holdings = screen.getByRole('region', { name: 'What they hold now' })
    expect(within(holdings).getByRole('link', { name: 'TEST-SHIFT-1' })).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=1')
    expect(within(holdings).getByRole('link', { name: 'TEST-CUSTODY-1' })).toHaveAttribute('href', '/holdings/armory?tab=custody&custody=2')
    expect(holdings).toHaveTextContent('Site supervisor')
    expect(holdings).toHaveTextContent('Test Site Safe')
    expect(holdings).toHaveTextContent('TEST-SERIAL-1')
    expect(holdings).toHaveTextContent('01/01/2030 12:00')

    const history = screen.getByRole('region', { name: 'History' })
    expect(history).toHaveTextContent('Ended')
    expect(within(history).getByRole('link', { name: 'TEST-SHIFT-2' })).toHaveAttribute('href', '/holdings/armory?tab=shift&issue=3')
    expect(within(history).getByRole('link', { name: 'View full movement history' })).toHaveAttribute('href', '/holdings/armory?tab=audit&pane=movements&employee_id=T-0001')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('loads the next history page and returns to the first page', async () => {
    vi.mocked(api.getArmoryEmployee).mockImplementation(async (_id, filters) => ({
      ...empty,
      history: { page: filters?.page ?? 1, page_size: 1, total: 2, items: [filters?.page === 2 ? ended : shift] },
    }))
    renderTab()

    await screen.findByRole('link', { name: 'TEST-SHIFT-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByRole('link', { name: 'TEST-SHIFT-2' })).toBeInTheDocument()
    expect(api.getArmoryEmployee).toHaveBeenCalledWith(employeeId, { page: 2 })
    expect(screen.queryByRole('link', { name: 'TEST-SHIFT-1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByRole('link', { name: 'TEST-SHIFT-1' })).toBeInTheDocument()
  })

  it('distinguishes initial and refresh failures from an empty result and retries', async () => {
    vi.mocked(api.getArmoryEmployee).mockRejectedValue(new Error('Test network failure'))
    const client = renderTab()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this employee’s Armory records.')
    expect(screen.queryByText('Nothing held')).not.toBeInTheDocument()

    vi.mocked(api.getArmoryEmployee).mockResolvedValue(empty)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Nothing held')).toBeInTheDocument()
    expect(screen.getByText('No Armory assignment history.')).toBeInTheDocument()

    vi.mocked(api.getArmoryEmployee).mockRejectedValue(new Error('Test refresh failure'))
    await act(async () => { await client.invalidateQueries({ queryKey: ARMORY_QUERY_KEY }) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh this employee’s Armory records.')
    expect(screen.queryByText('Nothing held')).not.toBeInTheDocument()
    expect(screen.queryByText('No Armory assignment history.')).not.toBeInTheDocument()
  })
})
