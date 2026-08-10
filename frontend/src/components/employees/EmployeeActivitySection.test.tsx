import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    onClear,
    onOpenProfile,
  }: {
    onSelect: (employee: EmployeeListItem) => void
    onClear: () => void
    onOpenProfile: (employeeId: string) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect(abdulla)}>mock-select-G3190</button>
      <button type="button" onClick={onClear}>mock-clear-employee</button>
      <button type="button" onClick={() => onOpenProfile('G3190')}>mock-open-profile-G3190</button>
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
  channel: null,
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
        'employees.activity.openLedger': 'Open correspondence',
        'employees.activity.loading': 'Loading recent activity',
        'employees.activity.empty': 'No recent employee activity.',
        'employees.activity.emptyFiltered': 'No activity matches this employee and activity type.',
        'employees.activity.retry': 'Retry',
        'employees.activity.loadMore': 'Load more activity',
        'employees.activity.typeLabel': 'Activity type',
        'employees.activity.all': 'All activity',
        'employees.activity.document': 'Documents',
        'employees.activity.leave': 'Leave',
        'employees.activity.violation': 'Violations',
        'employees.activity.ledger': 'Correspondence',
      }
      if (key === 'employees.activity.showing') return `Showing ${options?.shown} of ${options?.total} recent entries`
      if (key === 'employees.activity.actions.document') return `Generated ${options?.title}`
      if (key === 'employees.activity.actions.leave') return `${options?.title} · ${options?.days} days`
      if (key === 'employees.activity.actions.violation') return `Recorded ${options?.title}`
      if (key === 'employees.activity.actions.ledger') return options?.title ?? ''
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
    expect(screen.getByRole('link', { name: /open correspondence/i })).toHaveAttribute('href', '/ledger?open=44')
  })

  it('resets to the first page when employee or type changes', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Employment Certificate')
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /activity type/i }), 'leave')
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

  it('appends the next 25 and hides Load more at total', async () => {
    const pageOne = Array.from({ length: 25 }, (_, index) => ({ ...items[0], source_id: index + 1, target_id: index + 1, title: `Document ${index + 1}` }))
    const finalItem = { ...items[0], source_id: 26, target_id: 26, title: 'Document 26' }
    vi.mocked(api.listEmployeeActivity).mockImplementation(({ offset = 0 }) => Promise.resolve({ items: offset === 0 ? pageOne : [finalItem], total: 26, limit: 25, offset }))
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    await screen.findByText('Document 1')
    await userEvent.click(screen.getByRole('button', { name: /load more activity/i }))
    expect(await screen.findByText('Document 26')).toBeInTheDocument()
    expect(screen.getByText('Document 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /load more activity/i })).not.toBeInTheDocument()
  })

  it('renders a pending state without removing the section', () => {
    vi.mocked(api.listEmployeeActivity).mockReturnValue(new Promise(() => {}))
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    expect(screen.getByRole('status', { name: /loading recent activity/i })).toBeInTheDocument()
  })

  it('distinguishes all-empty from filtered-empty', async () => {
    vi.mocked(api.listEmployeeActivity).mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 })
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    expect(await screen.findByText(/no recent employee activity/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'mock-select-G3190' }))
    expect(await screen.findByText(/no activity matches this employee/i)).toBeInTheDocument()
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
  it('keeps type, reference, destination, and date as six aligned row cells', async () => {
    wrap(<EmployeeActivitySection onOpenProfile={() => {}} />)
    const row = await screen.findByRole('link', { name: /open document/i })
    expect(row.firstElementChild?.children).toHaveLength(6)
    expect(within(row).getByText('Documents')).toBeInTheDocument()
    expect(within(row).getByText('#11')).toHaveAttribute('dir', 'auto')
  })
})
