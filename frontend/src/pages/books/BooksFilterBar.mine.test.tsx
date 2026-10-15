/**
 * Phone filter bar additions: "Created by me" chip (toggles `mine`, badge from
 * `useMyRecordsCount`, hidden for inmate reporters), visible From/To labels,
 * the awaiting_scan status chip, and Clear driven by `hasActiveFilters`.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const state = vi.hoisted(() => ({ role: 'manager', count: 7 as number | null }))

import { BooksFilterBar } from './BooksFilterBar'
import { DEFAULT_BOOKS_FILTERS, type BooksFilters } from './booksFiltersUtils'

// Arabic throughout: an EN-only assertion cannot catch an AR leak here.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const ar: Record<string, string> = {
        'books.list.createdByMe': 'من إنشائي',
        'books.filters.dateFrom': 'من',
        'books.filters.dateTo': 'إلى',
        'books.filters.clear': 'مسح المرشحات',
        'books.filters.drafts': 'المسودات',
        'books.approval.stateAwaitingScan': 'بانتظار النسخة الممسوحة',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))
vi.mock('./serviceLabels', () => ({
  OTHER_SERVICE_ID: 'other',
  serviceGlyph: () => '',
  serviceArtwork: () => undefined,
  useServiceLabel: () => (id: string) => id,
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: new Set(), isLoading: false, has: () => true }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 1, role: state.role } }),
}))
vi.mock('./useMyRecordsCount', () => ({
  useMyRecordsCount: () => ({ count: state.count }),
}))

function setup(filters: Partial<BooksFilters> = {}) {
  const onChange = vi.fn()
  render(
    <BooksFilterBar
      filters={{ ...DEFAULT_BOOKS_FILTERS, ...filters }}
      categories={[]}
      services={[]}
      onChange={onChange}
    />,
  )
  return { onChange }
}

beforeEach(() => {
  state.role = 'manager'
  state.count = 7
})

describe('BooksFilterBar — Created by me', () => {
  it('toggles mine on and off and shows the count badge', async () => {
    const { onChange } = setup()
    const chip = screen.getByRole('button', { name: /من إنشائي/ })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(chip).toHaveTextContent('7')
    await userEvent.click(chip)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mine: true }))
  })

  it('reflects the active state and turns it off on the next press', async () => {
    const { onChange } = setup({ mine: true })
    const chip = screen.getByRole('button', { name: /من إنشائي/ })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mine: false }))
  })

  it('omits the badge until the count has loaded', () => {
    state.count = null
    setup()
    expect(screen.getByRole('button', { name: /من إنشائي/ })).not.toHaveTextContent(/\d/)
  })

  it('is hidden for inmate reporters, who also lose the awaiting_scan chip', () => {
    state.role = 'inmate_reporter'
    setup()
    expect(screen.queryByRole('button', { name: /من إنشائي/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /بانتظار النسخة الممسوحة/ })).not.toBeInTheDocument()
  })

  it('Clear appears when only mine is on and resets it', async () => {
    const { onChange } = setup({ mine: true })
    await userEvent.click(screen.getByRole('button', { name: /مسح المرشحات/ }))
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_BOOKS_FILTERS)
  })
})

describe('BooksFilterBar — labels and status', () => {
  it('labels the From and To dates visibly', () => {
    setup()
    expect(screen.getByLabelText('من')).toBe(screen.getByTestId('date-from'))
    expect(screen.getByLabelText('إلى')).toBe(screen.getByTestId('date-to'))
  })

  it('offers an awaiting_scan status chip that sets the status', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: /بانتظار النسخة الممسوحة/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'awaiting_scan' }))
  })
})
