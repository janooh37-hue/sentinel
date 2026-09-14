import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InmateRegisterEntry, InmateRegisterMonth } from '@/lib/api'
import type * as ApiModule from '@/lib/api'
import i18n from '@/lib/i18n'
import { formatRegisterDate } from './registerModel'
import { StatisticsTab } from './StatisticsTab'
import { workflowMonth } from './workflowFixtures'

let currentMonth: InmateRegisterMonth
const mutations = {
  createManualRow: vi.fn(),
  updateManualRow: vi.fn(),
  deleteManualRow: vi.fn(),
  completeImport: vi.fn(),
  prepareMonth: vi.fn(),
  reviewMonth: vi.fn(),
  approveMonth: vi.fn(),
  returnMonth: vi.fn(),
  reopenMonth: vi.fn(),
}

vi.mock('./useInmateRegister', () => ({
  useInmateRegister: () => ({
    month: currentMonth,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    reviewers: [{ user_id: 2, employee_id: 'G200', name_ar: 'مراجع تجريبي' }],
    managers: [{ user_id: 3, employee_id: 'G300', name_ar: 'مدير تجريبي' }],
    candidatesLoading: false,
    candidatesError: null,
    retryCandidates: vi.fn(),
    ...mutations,
    isWriting: false,
  }),
  useInmateNationalities: () => ({
    data: { items: [], aliases: {} },
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/lib/useIdentity', () => ({
  useIdentity: () => ({ isAdmin: false }),
}))
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>()
  return {
    ...actual,
    api: {
      ...actual.api,
      listEmployees: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 500, offset: 0 }),
    },
  }
})

function entry(
  id: string,
  population: 'citizens' | 'expats' | 'pending',
  overrides: Partial<InmateRegisterEntry> = {},
): InmateRegisterEntry {
  return {
    id,
    origin: 'derived',
    row_no: 1,
    population,
    name: `${id}-name`,
    uid: '1234',
    nationality_label: population === 'citizens' ? 'UAE' : 'Jordan',
    nationality_code: population === 'citizens' ? 'AE' : 'JO',
    violation_date: '2026-08-06',
    duty_unit: 'Unit 1',
    details_text: 'Details',
    wing: '1A',
    holding_no: '22',
    reporter_id: 'G100',
    reporter_name: 'Reporter',
    source_book_id: 10,
    source_version_no: 1,
    source_row_index: 0,
    source_ref_number: 'IV-10',
    incomplete_marks: [],
    missing: [],
    duplicate_of: null,
    completion_book_id: null,
    manual: null,
    ...overrides,
  }
}

function month(entries: InmateRegisterEntry[], closed = false): InmateRegisterMonth {
  const citizens = entries.filter((item) => item.population === 'citizens').length
  const expats = entries.filter((item) => item.population === 'expats').length
  const pending = entries.filter((item) => item.population === 'pending').length
  return workflowMonth({
    year: 2026,
    month: 8,
    closed,
    closed_at: closed ? '2026-09-01T08:30:00Z' : null,
    closed_by: closed ? 1 : null,
    closed_by_name: closed ? 'Administrator' : null,
    reopened_at: null,
    reopened_by: null,
    reopened_by_name: null,
    first_closable_date: '2026-09-01',
    export_ready: true,
    counts: { citizens, expats, pending, total: citizens + expats + pending },
    entries,
    uncounted: [],
    arrived_after_close: [],
    blocking: [],
  })
}

function renderTab(language = 'en') {
  void i18n.changeLanguage(language)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/application?stats_month=2026-08']}>
          <StatisticsTab />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StatisticsTab', () => {
  it('keeps four summary tiles and places pending inside the month total', () => {
    currentMonth = month([entry('pending', 'pending')])
    currentMonth.wing_summary = {
      ...currentMonth.wing_summary,
      most: ['1A', '1B'],
      most_count: 2,
      unassigned_count: 1,
    }
    const { container } = renderTab()
    const summary = container.querySelector('header dl')!
    expect(summary.children).toHaveLength(4)
    expect(summary.children[2]).toHaveTextContent('Pending completion')
    expect(summary.children[3]).toHaveTextContent('1A')
    expect(summary.children[3]).toHaveTextContent('1B')
    expect(summary.children[3]).toHaveTextContent(
      i18n.t('inmateStats.counts.unassignedWings', { count: 1 }),
    )
  })

  it('offers the twelve canonical wings in the manual correction form', async () => {
    currentMonth = month([])
    renderTab()
    await userEvent.click(screen.getByRole('button', { name: 'Add a manual entry' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Wing' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '—',
      '1A',
      '1B',
      '2A',
      '2B',
      '3A',
      '3B',
      '4A',
      '4B',
      '5A',
      '5B',
      '6A',
      '6B',
    ])
  })

  it('opens the exact blocker correction in the mobile inspector across populations', async () => {
    const target = entry('manual-target', 'expats', { origin: 'manual', missing: ['wing'], wing: '',
      manual: { row_id: 8, reason: 'Recovered source', created_by: 1, created_by_name: 'Synthetic', created_at: '2026-08-10T08:00:00Z' } })
    currentMonth = month([entry('citizen', 'citizens'), target])
    currentMonth.blocking = [{ id: target.id, name: target.name, missing: ['wing'] }]
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    try {
      renderTab()
      await userEvent.click(screen.getByRole('button', { name: /manual-target-name —/ }))
      expect(within(screen.getByRole('dialog')).getByLabelText(/Inmate name/)).toHaveValue('manual-target-name')
    } finally { media.mockRestore() }
  })

  it('shows the pending population only when it contains entries and opens its completion form', async () => {
    currentMonth = month([
      entry('citizen', 'citizens'),
      entry('expat', 'expats'),
      entry('pending', 'pending', {
        nationality_label: '',
        nationality_code: null,
        missing: ['nationality', 'details'],
        completion_book_id: 30,
      }),
    ])
    renderTab()

    expect(screen.getByRole('tab', { name: /Citizens/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Non-citizens/ })).toBeInTheDocument()
    const pendingTab = screen.getByRole('tab', { name: /Pending completion/ })
    expect(pendingTab).toBeInTheDocument()

    await userEvent.click(pendingTab)
    expect(screen.getByRole('heading', { name: 'Complete the approved-copy record' })).toBeInTheDocument()
  })

  it('seals a closed month and removes every entry write affordance', () => {
    currentMonth = month([
      entry('manual', 'citizens', {
        origin: 'manual',
        source_book_id: null,
        source_ref_number: null,
        manual: {
          row_id: 8,
          reason: 'Recovered source',
          created_by: 1,
          created_by_name: 'Administrator',
          created_at: '2026-08-10T08:00:00Z',
        },
      }),
    ], true)
    renderTab()

    expect(screen.getByText('Closed month')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a manual entry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Pending completion/ })).not.toBeInTheDocument()
  })

  it('keeps a derived entry read-only and bidi-isolates its Arabic date cell', () => {
    const derived = entry('derived', 'citizens')
    currentMonth = month([derived])
    renderTab('ar')

    expect(screen.getByText('لا يمكن تعديل الأسطر المستخرجة — التصحيح يتم على التقرير.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'تعديل' })).not.toBeInTheDocument()
    const date = screen.getAllByText(formatRegisterDate(derived.violation_date, 'ar')).find(
      (node) => node.tagName === 'TD',
    )
    expect(date).toHaveAttribute('dir', 'ltr')
  })
})
