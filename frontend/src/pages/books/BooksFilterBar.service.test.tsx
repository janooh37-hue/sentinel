/**
 * Mobile service filter. Deliberately NOT called "Category": that word already
 * means the 12 ref-number buckets in this same bar.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

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
  serviceArtwork: () => undefined,
  useServiceLabel: () => (id: string) => (id === 'Report' ? 'تقرير' : id),
}))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
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


beforeEach(() => {
  capabilityState.allowed = new Set([
    'books.servicerecords.Report',
    'books.servicerecords.other',
  ])
})
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

  it('keeps a records-visible service selectable without creation access', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByTestId('service-filter'))
    await userEvent.click(screen.getByText('تقرير'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'Report' }))
  })

  it('hides a records-denied service even when creation access is granted', async () => {
    capabilityState.allowed = new Set([
      'books.servicerecords.other',
      'books.service.Report',
    ])
    setup()
    await userEvent.click(screen.getByTestId('service-filter'))

    expect(screen.queryByText('تقرير')).not.toBeInTheDocument()
    expect(screen.getByText('other')).toBeVisible()
  })

  it('resets a selected service exactly once when that service becomes denied', async () => {
    const onChange = vi.fn()
    const filters = { ...BASE, serviceId: 'Report' }
    const view = render(
      <BooksFilterBar
        filters={filters}
        categories={[]}
        services={SERVICES}
        onChange={onChange}
      />,
    )

    expect(onChange).not.toHaveBeenCalled()
    capabilityState.allowed = new Set([
      'books.servicerecords.other',
      'books.service.Report',
    ])
    view.rerender(
      <BooksFilterBar
        filters={filters}
        categories={[]}
        services={SERVICES}
        onChange={onChange}
      />,
    )

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'all' })),
    )
    view.rerender(
      <BooksFilterBar
        filters={filters}
        categories={[]}
        services={SERVICES}
        onChange={onChange}
      />,
    )
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('counts as an active filter and Clear resets it to all', async () => {
    const { onChange } = setup({ serviceId: 'Report' })
    await userEvent.click(screen.getByText('مسح'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'all' }))
  })
})
