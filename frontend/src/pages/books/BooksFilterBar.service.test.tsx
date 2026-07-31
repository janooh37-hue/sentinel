/**
 * Mobile service filter. Deliberately NOT called "Category": that word already
 * means the 12 ref-number buckets in this same bar.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { BooksFilterBar, type BooksFilters } from './BooksFilterBar'
import type { ServiceFacetRead } from '@/lib/api'

// Arabic throughout: an EN-only assertion cannot catch an AR leak here.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => {
      const ar: Record<string, string> = {
        'books.filters.category': 'التصنيف',
        'books.filters.service': 'النموذج',
        'books.filters.serviceAll': 'الكل',
        'books.filters.categoryAll': 'الكل',
        'books.filters.clear': 'مسح',
      }
      return ar[k] ?? k
    },
    i18n: { language: 'ar' },
  }),
}))

vi.mock('./serviceLabels', () => ({
  OTHER_SERVICE_ID: 'other',
  serviceGlyph: () => '📊',
  useServiceLabel: () => (id: string) => (id === 'Report' ? 'تقرير' : id),
}))

const SERVICES: ServiceFacetRead[] = [
  { id: 'Report', count: 6, states: { none: 6 } },
  { id: 'other', count: 1, states: { none: 1 } },
]

const BASE: BooksFilters = {
  categoryIds: [],
  direction: 'all',
  status: 'all',
  fromDate: '',
  toDate: '',
  q: '',
  drafts: false,
  serviceId: 'all',
}

function setup(filters: Partial<BooksFilters> = {}) {
  const onChange = vi.fn()
  render(
    <BooksFilterBar
      filters={{ ...BASE, ...filters }}
      categories={[]}
      services={SERVICES}
      onChange={onChange}
    />,
  )
  return { onChange }
}

describe('BooksFilterBar service filter', () => {
  it('renders a Service trigger distinct from the Category trigger', () => {
    setup()
    const category = screen.getByTestId('category-filter')
    const service = screen.getByTestId('service-filter')
    expect(category).not.toBe(service)
    expect(service.textContent).toContain('النموذج')
    expect(category.textContent).not.toContain('النموذج')
  })

  it('labels the trigger in ARABIC, not English', () => {
    setup()
    expect(screen.getByTestId('service-filter').textContent).not.toContain('Service')
  })

  it('selecting a service reports its id', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByTestId('service-filter'))
    await userEvent.click(screen.getByText('تقرير'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'Report' }))
  })

  it('counts as an active filter and Clear resets it to all', async () => {
    const { onChange } = setup({ serviceId: 'Report' })
    await userEvent.click(screen.getByText('مسح'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'all' }))
  })
})
