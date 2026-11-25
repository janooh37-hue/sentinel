import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import type { EmployeeActivityItemRead, EmployeeListItem } from '@/lib/api'
import { api } from '@/lib/api'
import { EmployeeActivitySection } from './EmployeeActivitySection'
import type { ActivityFilter } from './employeeActivityModel'

vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof import('@/lib/api')>()
  return { ...real, api: { ...real.api, listEmployeeActivity: vi.fn() } }
})

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
  department: null,
  has_photo: false,
}

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
  channel: null,
  reference: `#${item.source_id}`,
}))

const addedItem: EmployeeActivityItemRead = {
  ...items[0],
  kind: 'employee_added',
  source_id: 71,
  target_id: 71,
  employee_id: 'G710',
  employee_name_en: 'DALIA AMIN',
  employee_name_ar: 'داليا أمين',
  title: 'DALIA AMIN',
  reference: 'G710',
  status: 'Loaned',
  actor_name: 'Sana Noor',
  joining_date: '2026-11-30',
}

function ActivityFixture(): React.JSX.Element {
  const [employee, setEmployee] = useState<EmployeeListItem | null>(null)
  const [kind, setKind] = useState<ActivityFilter>('all')
  return (
    <>
      <button type="button" onClick={() => setEmployee(abdulla)}>Select employee fixture</button>
      <EmployeeActivitySection
        employee={employee}
        kind={kind}
        onKindChange={setKind}
        onClearFilters={() => {
          setEmployee(null)
          setKind('all')
        }}
      />
    </>
  )
}

function renderFeed() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}><ActivityFixture /></QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('EmployeeActivitySection', () => {
  beforeEach(() => {
    vi.mocked(api.listEmployeeActivity).mockReset()
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items, total: items.length, limit: 25, offset: 0 })
  })
  afterEach(async () => {
    vi.useRealTimers()
    document.documentElement.removeAttribute('dir')
    await i18n.changeLanguage('en')
    vi.restoreAllMocks()
  })

  it('loads all activity by default and renders exact source links', async () => {
    renderFeed()
    await screen.findByText('Employment Certificate')
    expect(api.listEmployeeActivity).toHaveBeenCalledWith({ limit: 25, offset: 0 })
    expect(screen.getByRole('link', { name: /open document/i })).toHaveAttribute('href', '/books?open=71')
    expect(screen.getByRole('link', { name: /open leave/i })).toHaveAttribute('href', '/leaves?open=22')
    expect(screen.getByRole('link', { name: /open violation/i })).toHaveAttribute('href', '/employees/G300?tab=violations&open=33')
    expect(screen.getByRole('link', { name: /open correspondence/i })).toHaveAttribute('href', '/ledger?mail=44')
  })

  it('filters and links duty location history to the employee Activity tab', async () => {
    const dutyLocationItem: EmployeeActivityItemRead = {
      ...items[0],
      kind: 'duty_location',
      source_id: 55,
      target_id: 55,
      employee_id: 'G500',
      title: 'Transferred',
      event_type: 'transfer',
      from_unit: 'Administration',
      from_post: 'Main Gate',
      to_unit: 'Operations',
      to_post: 'Control Room',
      reason: 'Operational coverage',
    }
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [dutyLocationItem], total: 1, limit: 25, offset: 0 })

    renderFeed()
    await screen.findByText('Transferred')
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Duty location' }))

    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'duty_location' }),
    ))
    const dutyRow = await screen.findByRole('link', { name: /open employee activity/i })
    expect(dutyRow).toHaveAttribute('href', '/employees/G500?tab=activity')
    // Assert the authored inline style, not the computed one: jsdom 30 resolves the `background`
    // shorthand in getComputedStyle, and `--primary-soft` is undefined in jsdom, so the computed
    // value falls back to transparent even though the component sets the token correctly.
    const icon = dutyRow.querySelector<HTMLElement>('span[aria-hidden="true"]')
    expect(icon?.style.background).toBe('var(--primary-soft)')
    expect(icon?.style.color).toBe('var(--primary-on-soft)')
  })

  it('filters and links status history to the employee profile', async () => {
    const statusItem: EmployeeActivityItemRead = {
      ...items[0],
      kind: 'status',
      source_id: 66,
      target_id: 66,
      employee_id: 'G600',
      title: 'Status',
      from_status: 'Transferred',
      to_status: 'Active',
      effective_date: '2026-09-20',
      status_event_kind: 'changed',
      status_source: 'manual',
      actor_name: 'Ahmed',
    }
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [statusItem], total: 1, limit: 25, offset: 0 })

    renderFeed()
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Status changes' }))

    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'status' }),
    ))
    expect(await screen.findByText('Returned to service')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open employee profile/i })).toHaveAttribute('href', '/employees/G600')
  })

  it('resets to the first page when employee or type changes', async () => {
    renderFeed()
    await screen.findByText('Employment Certificate')
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Leave' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', kind: 'leave', limit: 25, offset: 0 }))
  })

  it('clearing the employee restores all-employee activity', async () => {
    renderFeed()
    await screen.findByText('Employment Certificate')
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
  })

  it('appends the next 25, keeps Load more full-width on phone, and hides it at total', async () => {
    const pageOne = Array.from({ length: 25 }, (_, index) => ({ ...items[0], source_id: index + 1, target_id: index + 1, title: `Document ${index + 1}` }))
    const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
    vi.mocked(api.listEmployeeActivity).mockImplementation((params) => { const offset = params?.offset ?? 0; return Promise.resolve({ items: offset === 0 ? pageOne : [finalItem], total: 26, limit: 25, offset }) })
    renderFeed()
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
    renderFeed()
    expect(screen.getByRole('status', { name: /loading recent activity/i })).toBeInTheDocument()
  })

  it('distinguishes all-empty from truthful single-filter empty copy', async () => {
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
    renderFeed()
    expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    const filtered = await screen.findByText(/no activity matches the current filters/i)
    expect(filtered).not.toHaveTextContent(/activity type/i)
  })

  it('does not name an unselected employee in type-only empty copy', async () => {
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
    renderFeed()
    await screen.findByText(/no recent employee activity/i)
    await userEvent.click(within(screen.getByRole('group', { name: /activity type/i })).getByRole('button', { name: 'Leave' }))
    const filtered = await screen.findByText(/no activity matches the current filters/i)
    expect(filtered).not.toHaveTextContent(/employee/i)
  })

  it('renders an error with a working retry action', async () => {
    vi.mocked(api.listEmployeeActivity).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [], total: 0, limit: 25, offset: 0 })
    renderFeed()
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
    expect(api.listEmployeeActivity).toHaveBeenCalledTimes(2)
  })

  it('does not render a second employee search inside the activity feed', () => {
    renderFeed()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
  it('revisiting a previous employee filter starts again at offset zero', async () => {
    const pageOne = Array.from({ length: 25 }, (_, index) => ({
      ...items[0],
      source_id: index + 1,
      target_id: index + 1,
      title: `Document ${index + 1}`,
    }))
    const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
    vi.mocked(api.listEmployeeActivity).mockImplementation((params) => {
      const offset = params?.offset ?? 0
      return Promise.resolve({
        items: offset === 0 ? pageOne : [finalItem],
        total: 26,
        limit: 25,
        offset,
      })
    })
    renderFeed()
    await screen.findByText('Document 1')
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    await screen.findByText('Document 1')
    await userEvent.click(screen.getByRole('button', { name: /load more activity/i }))
    await screen.findByText('Document 26')
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ limit: 25, offset: 0 }))
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    await waitFor(() => expect(api.listEmployeeActivity).toHaveBeenLastCalledWith({ employee_id: 'G3190', limit: 25, offset: 0 }))
  })

  it('renders every stored reference with automatic text direction', async () => {
    renderFeed()
    const reference = await screen.findByText('#11')
    expect(reference).toHaveAttribute('dir', 'auto')
  })
  it('renders each source title once while keeping the localized structural action', async () => {
    renderFeed()
    for (const title of items.map((item) => item.title)) {
      const row = await screen.findByRole('link', { name: new RegExp(title, 'i') })
      expect((row.textContent ?? '').split(title).length - 1).toBe(1)
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
      ledger: 'Recorded correspondence',
    })
    expect(ar.employees.activity.emptyFiltered).toBe('لا توجد أنشطة مطابقة لعوامل التصفية الحالية.')
    expect(ar.employees.activity.actions).toEqual({
      document: 'تم إنشاء المستند',
      leave: 'سجل الإجازة · {{days}} يومًا',
      violation: 'تم تسجيل المخالفة',
      ledger: 'تم تسجيل المراسلة',
    })
  })

  it('shows the new employee, actor, status and joining date in the activity-first link', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T12:00:00'))
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({
      items: [addedItem, { ...addedItem, source_id: 72, employee_id: 'G720', employee_name_en: 'NOUR ALI', actor_name: null, joining_date: null }],
      total: 2,
      limit: 25,
      offset: 0,
    })
    renderFeed()
    const row = await screen.findByRole('link', { name: /Added.*DALIA AMIN.*G710/ })
    expect(row).toHaveAttribute('href', '/employees?employee=G710')
    expect(row).toHaveTextContent(/by .*Sana Noor/)
    expect(within(row).getByText('Loaned')).toBeInTheDocument()
    expect(within(row).getByText('Joins November 30, 2026')).toHaveAttribute('datetime', '2026-11-30')
    const olderRow = screen.getByRole('link', { name: /Added.*NOUR ALI.*G720/ })
    expect(olderRow).not.toHaveTextContent(/\bby\b/)
    expect(olderRow.querySelector('time')).not.toBeInTheDocument()
  })

  it('words a joining date that has passed in the past tense', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-15T12:00:00'))
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [addedItem], total: 1, limit: 25, offset: 0 })
    renderFeed()
    const row = await screen.findByRole('link', { name: /Added.*DALIA AMIN.*G710/ })
    expect(within(row).getByText('Joined November 30, 2026')).toHaveAttribute('datetime', '2026-11-30')
  })

  it('uses the neutral Arabic added label and a localized month while keeping the Loaned terminology', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-25T12:00:00'))
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    document.documentElement.dir = 'rtl'
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [addedItem], total: 1, limit: 25, offset: 0 })
    renderFeed()
    expect(screen.getByRole('button', { name: 'موظفون جدد' })).toBeInTheDocument()
    const row = await screen.findByRole('link', { name: /إضافة.*داليا أمين.*G710/ })
    expect(row).not.toHaveTextContent('تعيين')
    expect(within(row).getByText('ملحق')).toBeInTheDocument()
    const joiningDate = within(row).getByText('يلتحق في 30 نوفمبر 2026')
    expect(joiningDate).toHaveAttribute('datetime', '2026-11-30')
    expect(joiningDate.closest('[dir="ltr"]')).toBeNull()
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
    renderFeed()
    const formatDay = new Intl.DateTimeFormat('en', { dateStyle: 'medium' })
    expect(await screen.findByRole('heading', { name: formatDay.format(firstDay) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: formatDay.format(secondDay) })).toBeInTheDocument()
  })

  it('shows the employee identity on rows only when browsing all employees', async () => {
    renderFeed()
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(within(row).getByText('EMPLOYEE 0')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    await screen.findByTestId('badge-card')
    const rows = await screen.findAllByRole('link', { name: /open/i })
    for (const r of rows) expect(within(r).queryByText(/^EMPLOYEE/)).not.toBeInTheDocument()
  })

  it('mounts the badge card only while an employee is selected', async () => {
    renderFeed()
    await screen.findByText('Employment Certificate')
    expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Select employee fixture' }))
    expect(await screen.findByTestId('badge-card')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-clear-employee' }))
    await waitFor(() => expect(screen.queryByTestId('badge-card')).not.toBeInTheDocument())
  })

  it('uses the Arabic employee name when the interface is Arabic', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({
      items: [{ ...items[0], employee_name_ar: 'شهادة العمل' }],
      total: 1,
      limit: 25,
      offset: 0,
    })
    renderFeed()
    expect(await screen.findByText('شهادة العمل')).toBeInTheDocument()
  })
  it('keeps references automatic-direction mono text and destinations accessible', async () => {
    renderFeed()
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(within(row).getByText('#11')).toHaveAttribute('dir', 'auto')
  })

  it('uses the compact F3 flex row layout', async () => {
    renderFeed()
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(row).toHaveClass('flex', 'items-center', 'border-b')
  })
})
