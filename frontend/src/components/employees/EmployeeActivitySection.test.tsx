import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import type { EmployeeActivityItemRead, EmployeeListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { EmployeeActivitySection } from './EmployeeActivitySection'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, listEmployeeActivity: vi.fn() } }
})

const testLanguage = vi.hoisted(() => ({ value: 'en' }))
vi.mock('./EmployeeActivityLookup', () => ({
  EmployeeActivityLookup: ({
    onSelect,
    onOpenProfile,
  }: {
    onSelect: (employee: EmployeeListItem) => void
    onOpenProfile: (employeeId: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect(abdulla)}>mock-select-G3190</button>
      <button type="button" onClick={() => onOpenProfile('G3190')}>mock-open-profile-G3190</button>
    </div>
  ),
}))

vi.mock('./EmployeeBadgeCard', () => ({
  EmployeeBadgeCard: ({ employee, onClear }: { employee: EmployeeListItem; onClear: () => void }) => (
    <div data-testid="badge-card">
      <span>badge:{employee.id}</span>
      <button type="button" onClick={onClear}>mock-clear-employee</button>
    </div>
  ),
}))

const abdulla: EmployeeListItem = {
  id: 'G3190',
  name_en: 'ABDULLA ALABRI',
  name_ar: 'عبدالله العبري',
  status: 'Active',
  position: 'Officer',
  position_ar: 'ضابط',
  has_photo: false,
} as EmployeeListItem

const items: EmployeeActivityItemRead[] = ([
  { kind: 'document', source_id: 11, target_id: 71, employee_id: 'G100', title: 'Employment Certificate' },
  { kind: 'leave', source_id: 22, target_id: 22, employee_id: 'G200', title: 'Annual' },
  { kind: 'violation', source_id: 33, target_id: 33, employee_id: 'G300', title: 'Late arrival' },
  { kind: 'ledger', source_id: 44, target_id: 44, employee_id: 'G400', title: 'Incoming letter' },
] as const).map((item, index) => ({
  ...item,
  occurred_at: `2026-08-10T09:0${4 - index}:00`,
  employee_name_en: `EMPLOYEE ${index}`,
  employee_name_ar: null,
  detail: null,
  status: null,
  days: null,
  direction: null,
  channel: item.kind === 'ledger' ? 'email' : null,
  can_open_in_outlook: item.kind === 'ledger',
  reference: `#${item.source_id}`,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: testLanguage.value },
    t: (key: string, options?: { count?: number; shown?: number; total?: number; title?: string; days?: number }) => {
      const values: Record<string, string> = {
        'employees.activity.openDocument': 'Open document',
        'employees.activity.openLeave': 'Open leave',
        'employees.activity.openViolation': 'Open violation',
        'employees.activity.openCorrespondence': 'Open correspondence',
        'employees.activity.readOnly': 'Read-only historical record',
        'employees.activity.desktopRequired': 'Classic Outlook requires the desktop app',
        'employees.activity.loading': 'Loading recent activity',
        'employees.activity.empty': 'No recent employee activity.',
        'employees.activity.emptyFiltered': 'No activity matches the current filters.',
        'employees.activity.loadError': 'Recent activity could not be loaded.',
        'employees.activity.retry': 'Retry',
        'employees.activity.loadMore': 'Load more activity',
        'employees.activity.typeLabel': 'Activity type',
        'employees.activity.all': 'All activity',
        'employees.activity.document': 'Documents',
        'employees.activity.leave': 'Leave',
        'employees.activity.violation': 'Violations',
        'employees.activity.correspondence': 'Correspondence',
        'employees.activity.employee': 'Employee',
        'employees.activity.activity': 'Activity',
        'employees.activity.type': 'Type',
        'employees.activity.reference': 'Reference',
        'employees.activity.dateTime': 'Date and time',
        'employees.activity.destination': 'Destination',
      }
      if (key === 'employees.activity.showing') return `Showing ${options?.shown} of ${options?.total} recent entries`
      if (key === 'employees.activity.actions.document') return 'Generated document'
      if (key === 'employees.activity.actions.leave') return `Leave record · ${options?.days} days`
      if (key === 'employees.activity.actions.violation') return 'Recorded violation'
      if (key === 'employees.activity.actions.correspondence') return 'Recorded correspondence'
      return values[key] ?? key
    },
  }),
}))

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('EmployeeActivitySection', () => {
  beforeEach(() => {
    testLanguage.value = 'en'
    vi.mocked(api.listEmployeeActivity).mockReset()
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items, total: items.length, limit: 25, offset: 0 })
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads all activity by default and renders exact source links', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Employment Certificate')
    expect(api.listEmployeeActivity).toHaveBeenCalledWith({ limit: 25, offset: 0 })
    expect(screen.getByRole('link', { name: /open document/i })).toHaveAttribute('href', '/books?open=71')
    expect(screen.getByRole('link', { name: /open leave/i })).toHaveAttribute('href', '/leaves?open=22')
    expect(screen.getByRole('link', { name: /open violation/i })).toHaveAttribute('href', '/employees/G300?tab=violations&open=33')
    expect(screen.getByRole('button', { name: /open correspondence/i })).toBeInTheDocument()
  })
  it('keeps legacy non-email ledger activity read-only', async () => {
    const legacyItems = items.map((item) =>
      item.kind === 'ledger' ? { ...item, channel: 'letter' as const } : item,
    )
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({
      items: legacyItems,
      total: legacyItems.length,
      limit: 25,
      offset: 0,
    })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Incoming letter')
    expect(screen.queryByRole('button', { name: /open correspondence/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /open correspondence/i })).not.toBeInTheDocument()
    expect(screen.getByText('Read-only historical record')).toBeInTheDocument()
  })

  it('resets to the first page when employee or type changes', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Employment Certificate')
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', kind: 'leave', limit: 25, offset: 0 }))
  })

  it('clearing the employee restores all-employee activity', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Employment Certificate')
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
  })

  it('appends the next 25, keeps Load more full-width on phone, and hides it at total', async () => {
    const pageOne = Array.from({ length: 25 }, (_, index) => ({ ...items[0], source_id: index + 1, target_id: index + 1, title: `Document ${index + 1}` }))
    const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
    vi.mocked(api.listEmployeeActivity).mockImplementation(({ offset = 0 }) => Promise.resolve({ items: offset === 0 ? pageOne : [finalItem], total: 26, limit: 25, offset }))
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Document 1')
    const loadMore = screen.getByRole('button', { name: /load more activity/i })
    expect(loadMore).toHaveClass('w-full')
    expect(loadMore).toHaveClass('focus-visible:ring-inset')
    await userEvent.click(loadMore)
    expect(await screen.findByText('Document 26')).toBeInTheDocument()
    expect(screen.getByText('Document 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load more activity/i })).not.toBeInTheDocument()
  })

  it('renders a pending state without removing the section', () => {
    vi.mocked(api.listEmployeeActivity).mockReturnValue(new Promise(() => {}))
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    expect(screen.getByRole('status', { name: /loading recent activity/i })).toBeInTheDocument()
  })

  it('distinguishes all-empty from truthful single-filter empty copy', async () => {
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    const filtered = await screen.findByText(/no activity matches the current filters/i)
    expect(filtered).not.toHaveTextContent(/activity type/i)
  })

  it('does not name an unselected employee in type-only empty copy', async () => {
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText(/no recent employee activity/i)
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Leave' }))
    const filtered = await screen.findByText(/no activity matches the current filters/i)
    expect(filtered).not.toHaveTextContent(/employee/i)
  })

  it('renders an error with a working retry action', async () => {
    vi.mocked(api.listEmployeeActivity).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 0 })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
    expect(api.listEmployeeActivity).toHaveBeenCalledTimes(2)
  })

  it('profile navigation is only delegated by employee lookup', async () => {
    const onOpenProfile = vi.fn()
    wrap(<EmployeeActivitySection onOpenProfile={onOpenProfile} />)
    await userEvent.click(screen.getByRole('button', { name: 'mock-open-profile-G3190' }))
    expect(onOpenProfile).toHaveBeenCalledOnce()
    await userEvent.click(await screen.findByRole('link', { name: /open document/i }))
    expect(onOpenProfile).toHaveBeenCalledOnce()
  })
  it('revisiting a cached employee filter starts again at offset zero', async () => {
    const pageOne = Array.from({ length: 25 }, (_, index) => ({
      ...items[0],
      source_id: index + 1,
      target_id: index + 1,
      title: `Document ${index + 1}`,
    }))
    const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
    vi.mocked(api.listEmployeeActivity).mockImplementation(({ offset = 0 }) =>
      Promise.resolve({
        items: offset === 0 ? pageOne : [finalItem],
        total: 26,
        limit: 25,
        offset,
      }),
    )
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Document 1')
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await screen.findByText('Document 1')
    await userEvent.click(screen.getByRole('button', { name: /load more activity/i }))
    await screen.findByText('Document 26')
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))
  })

  it('renders every stored reference with automatic text direction', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const reference = await screen.findByText('#11')
    expect(reference).toHaveAttribute('dir', 'auto')
  })
  it('renders each source title once while keeping the localized structural action', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    for (const item of items) {
      const row = await screen.findByRole(item.kind === 'ledger' ? 'button' : 'link', { name: new RegExp(item.title, 'i') })
      expect((row.textContent ?? '').split(item.title).length - 1).toBe(1)
    }
    expect(screen.getByText('Generated document')).toBeInTheDocument()
    expect(screen.getByText('Recorded violation')).toBeInTheDocument()
  })
  it('defines non-repeating localized actions and generic current-filter copy in both locales', () => {
    expect(en.employees.activity.emptyFiltered).toBe('No activity matches the current filters.')
    expect(en.employees.activity.actions).toEqual({
      document: 'Generated document',
      leave: 'Leave record · {{days}} days',
      violation: 'Recorded violation',
      correspondence: 'Recorded correspondence',
    })
    expect(ar.employees.activity.emptyFiltered).toBe('لا توجد أنشطة مطابقة لعوامل التصفية الحالية.')
    expect(ar.employees.activity.actions).toEqual({
      document: 'تم إنشاء المستند',
      leave: 'سجل الإجازة · {{days}} يومًا',
      violation: 'تم تسجيل المخالفة',
      correspondence: 'تم تسجيل المراسلة',
    })
  })

  it('groups activity rows under visible localized calendar-day headings', async () => {
    const firstDay = new Date('2026-08-10T09:04:00')
    const secondDay = new Date('2026-08-09T09:04:00')
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({
      items: [
        { ...items[0], occurred_at: firstDay.toISOString() },
        { ...items[1], occurred_at: secondDay.toISOString() },
      ],
      total: 2,
      limit: 25,
      offset: 0,
    })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const formatDay = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
    expect(await screen.findByRole('heading', { name: formatDay.format(firstDay) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: formatDay.format(secondDay) })).toBeInTheDocument()
  })

  it('shows the employee identity on rows only when browsing all employees', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(within(row).getByText('EMPLOYEE 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await screen.findByTestId('badge-card')
    const rows = await screen.findAllByRole('link', { name: /open/i })
    for (const r of rows) expect(within(r).queryByText(/^EMPLOYEE/)).not.toBeInTheDocument()
  })

  it('mounts the badge card only while an employee is selected', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Employment Certificate')
    expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    expect(await screen.findByTestId('badge-card')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument())
  })

  it('uses the Arabic employee name when the interface is Arabic', async () => {
    testLanguage.value = 'ar'
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({
      items: [{ ...items[0], employee_name_ar: 'شهادة العمل' }],
      total: 1,
      limit: 25,
      offset: 0,
    })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    expect(await screen.findByText('شهادة العمل')).toBeInTheDocument()
  })
  it('keeps references automatic-direction mono text and destinations accessible', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(within(row).getByText('#11')).toHaveAttribute('dir', 'auto')
  })

  it('uses the compact F3 flex row layout', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(row).toHaveClass('flex', 'items-center', 'border-b')
  })
})
