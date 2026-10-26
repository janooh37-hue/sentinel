/**
 * DashboardHero — the staff-file folder at the top of the dashboard.
 *
 * Every queue cell must open a list that shows exactly what the cell counts,
 * and only cells the caller may open are drawn. Counts run up from 0 unless
 * the user prefers reduced motion, so these tests pin reduced motion to read
 * the settled numbers.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovalSummaryResponse, IdentityRead } from '@/lib/api'
import { api } from '@/lib/api'
import { DashboardHero } from './DashboardHero'

vi.mock('@/lib/api', () => ({
  api: { getApprovalSummary: vi.fn() },
}))

vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ status: 'authed', user: { id: 7 } }),
}))

const getApprovalSummary = vi.mocked(api.getApprovalSummary)

function summary(overrides: Partial<ApprovalSummaryResponse> = {}): ApprovalSummaryResponse {
  return {
    can_view_sent: false,
    available_received_kinds: [],
    signature: { count: 0, oldest: null },
    review: { count: 0, oldest: null },
    sent: { count: 0, oldest: null },
    returned_count: 0,
    actionable_count: 0,
    ...overrides,
  }
}

const IDENTITY: IdentityRead = {
  linked: true,
  employee_id: 'G1234',
  name_en: 'Sara Ali Hassan',
  name_ar: 'سارة علي حسن',
  position: 'HR Officer',
  position_ar: 'مسؤولة الموارد البشرية',
  department: 'HR',
  photo_url: null,
  role: 'operator',
  is_admin: false,
  is_manager: false,
}

function renderHero(props: Partial<React.ComponentProps<typeof DashboardHero>> = {}, dir: 'ltr' | 'rtl' = 'ltr') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children?: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div dir={dir}>{children}</div>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <DashboardHero identity={IDENTITY} name="Sara Ali Hassan" initials="SH" isAr={dir === 'rtl'} {...props} />,
    { wrapper },
  )
}

/** The queue cell whose label is `label`: its link and settled count. */
async function cell(label: string): Promise<{ href: string | null; count: string | null }> {
  const link = (await screen.findByText(label)).closest('a')
  expect(link).not.toBeNull()
  return { href: link!.getAttribute('href'), count: link!.querySelector('data')!.textContent }
}

const realMatchMedia = window.matchMedia

beforeEach(() => {
  getApprovalSummary.mockReset()
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
})

afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe('DashboardHero queue cells', () => {
  it('splits signature and review work so each count matches the queue it opens', async () => {
    // Book overlap: 2 to sign + 3 to review = 4 distinct actionable books.
    getApprovalSummary.mockResolvedValue(
      summary({
        can_view_sent: true,
        available_received_kinds: ['approver', 'reviewer'],
        signature: { count: 2, oldest: null },
        review: { count: 3, oldest: null },
        sent: { count: 5, oldest: null },
        returned_count: 1,
        actionable_count: 4,
      }),
    )
    renderHero()

    expect(await cell('To sign')).toEqual({
      href: '/books/approvals?tab=received&kind=sign&status=pending&sort=newest&page=1',
      count: '2',
    })
    expect(await cell('To review')).toEqual({
      href: '/books/approvals?tab=received&kind=review&status=pending&sort=newest&page=1',
      count: '3',
    })
    expect(await cell('Needs changes')).toEqual({
      href: '/books/approvals?tab=sent&status=returned&sort=newest&page=1',
      count: '1',
    })
    expect(await cell('Sent, pending')).toEqual({
      href: '/books/approvals?tab=sent&status=pending&sort=newest&page=1',
      count: '5',
    })
    // No cell shows the combined count, which no single queue lists.
    expect(screen.queryByText('Waiting on me')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })

  it('shows a reviewer only the review queue', async () => {
    getApprovalSummary.mockResolvedValue(
      summary({
        available_received_kinds: ['reviewer'],
        review: { count: 3, oldest: null },
        actionable_count: 3,
      }),
    )
    renderHero()

    expect(await cell('To review')).toEqual({
      href: '/books/approvals?tab=received&kind=review&status=pending&sort=newest&page=1',
      count: '3',
    })
    expect(screen.queryByText('To sign')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Sent, pending')).not.toBeInTheDocument()
  })

  it('keeps a signer with nothing pending on their sign queue at zero', async () => {
    getApprovalSummary.mockResolvedValue(summary({ available_received_kinds: ['approver'] }))
    renderHero()

    expect(await cell('To sign')).toEqual({
      href: '/books/approvals?tab=received&kind=sign&status=pending&sort=newest&page=1',
      count: '0',
    })
    expect(screen.queryByText('To review')).not.toBeInTheDocument()
  })

  it('draws no queue cells for a user with no approval work', async () => {
    getApprovalSummary.mockResolvedValue(summary())
    renderHero()

    await vi.waitFor(() => expect(getApprovalSummary).toHaveBeenCalled())
    expect(screen.getByText('Sara Ali Hassan')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('DashboardHero identity', () => {
  beforeEach(() => {
    getApprovalSummary.mockResolvedValue(summary())
  })

  it('shows the linked person’s file: position, department and G-number', () => {
    renderHero()

    expect(screen.getByText('HR Officer · HR')).toBeInTheDocument()
    expect(screen.getByText('G1234')).toHaveAttribute('dir', 'ltr')
    expect(screen.getByText('SH')).toBeInTheDocument()
  })

  it('greets a guest without a portrait, role line or G-number', () => {
    renderHero({ identity: null, name: null, initials: '' })

    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.queryByText('HR Officer · HR')).not.toBeInTheDocument()
    expect(screen.queryByText('G1234')).not.toBeInTheDocument()
    expect(screen.queryByText('ID')).not.toBeInTheDocument()
  })

  it('treats an unlinked account as a guest file even when it has a name', () => {
    renderHero({ identity: { ...IDENTITY, linked: false }, name: 'Sara Ali Hassan' })

    expect(screen.getByText('Sara Ali Hassan')).toBeInTheDocument()
    expect(screen.queryByText('SH')).not.toBeInTheDocument()
    expect(screen.queryByText('HR Officer · HR')).not.toBeInTheDocument()
    expect(screen.queryByText('G1234')).not.toBeInTheDocument()
  })
})

describe('DashboardHero in Arabic', () => {
  beforeAll(async () => {
    i18n.addResourceBundle(
      'ar',
      'translation',
      {
        dashboard: {
          welcomeBackGuest: 'مرحبًا بعودتك',
          greeting: { morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' },
          hero: {
            staffFile: 'ملف الموظف',
            idLabel: 'الرقم الوظيفي',
            week: 'الأسبوع {{n}}',
            desk: {
              sign: 'للتوقيع',
              review: 'للمراجعة',
              returned: 'تحتاج إلى تعديل',
              sent: 'المرسل المعلّق',
            },
          },
        },
      },
      true,
      true,
    )
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('shows the Arabic job title, Arabic queue labels and an isolated G-number', async () => {
    getApprovalSummary.mockResolvedValue(
      summary({
        can_view_sent: true,
        available_received_kinds: ['approver', 'reviewer'],
        signature: { count: 2, oldest: null },
        review: { count: 3, oldest: null },
        actionable_count: 4,
      }),
    )
    const { container } = renderHero({ name: 'سارة علي حسن' }, 'rtl')

    expect(screen.getByText('مسؤولة الموارد البشرية · HR')).toBeInTheDocument()
    expect(screen.queryByText(/HR Officer/)).not.toBeInTheDocument()
    expect(screen.getByText('الرقم الوظيفي')).toBeInTheDocument()
    expect(screen.getByText('G1234')).toHaveAttribute('dir', 'ltr')

    expect((await cell('للتوقيع')).count).toBe('2')
    expect((await cell('للمراجعة')).count).toBe('3')
    const queue = screen.getByText('للتوقيع').closest('a')!.parentElement!
    expect(within(queue).getAllByRole('link').map((a) => a.textContent)).toEqual([
      expect.stringContaining('للتوقيع'),
      expect.stringContaining('للمراجعة'),
      expect.stringContaining('تحتاج إلى تعديل'),
      expect.stringContaining('المرسل المعلّق'),
    ])
    // The forward arrows mirror in RTL; the wordmark never does.
    for (const arrow of container.querySelectorAll('a svg')) {
      expect(arrow.getAttribute('class')).toContain('rtl:-scale-x-100')
    }
  })

  it('falls back to the English title when the record has no Arabic one', () => {
    getApprovalSummary.mockResolvedValue(summary())
    renderHero({ identity: { ...IDENTITY, position_ar: null }, name: 'سارة علي حسن' }, 'rtl')

    expect(screen.getByText('HR Officer · HR')).toBeInTheDocument()
  })
})
