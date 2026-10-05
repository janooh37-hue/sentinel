/**
 * Desktop toolbar popovers: Filters (category · direction · dates) and the
 * drawer tier's Service chip. Non-modal dialogs that Esc closes.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BookCategoryRead } from '@/lib/api'
import { DEFAULT_BOOKS_FILTERS } from './booksFiltersUtils'
import type { RailItem } from './FormRail'

vi.mock('@/lib/useCapabilities', () => ({ useCapabilities: () => ({ has: () => true }) }))
vi.mock('./serviceLabels', () => ({ useServiceLabel: () => (id: string) => `L:${id}` }))

import { FiltersPopover, ServicePopover } from './RecordsFilterPopovers'

const categories = [
  { id: 'GS', name_en: 'General', name_ar: 'عام' },
  { id: 'HR', name_en: 'Personnel', name_ar: 'شؤون الأفراد' },
] as unknown as BookCategoryRead[]

describe('FiltersPopover', () => {
  it('edits category, direction and dates through one onChange, and shows the active count', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <FiltersPopover filters={DEFAULT_BOOKS_FILTERS} categories={categories} onChange={onChange} />,
    )
    const trigger = screen.getByRole('button', { name: /Filters/ })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'Filters' })
    await userEvent.click(within(panel).getByRole('checkbox', { name: 'Personnel' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BOOKS_FILTERS, categoryIds: ['HR'] })

    await userEvent.click(within(panel).getByRole('button', { name: 'Incoming' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BOOKS_FILTERS, direction: 'incoming' })

    rerender(
      <FiltersPopover
        filters={{ ...DEFAULT_BOOKS_FILTERS, categoryIds: ['HR'], direction: 'incoming' }}
        categories={categories}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveTextContent('2')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_BOOKS_FILTERS,
      categoryIds: [],
      direction: 'all',
      fromDate: '',
      toDate: '',
    })
  })

  it('closes on Esc and returns focus to the trigger', async () => {
    render(<FiltersPopover filters={DEFAULT_BOOKS_FILTERS} categories={categories} onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /Filters/ })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Filters' })

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})

describe('ServicePopover', () => {
  const items: RailItem[] = [
    { serviceId: 'all', glyph: '•', label: 'All forms', count: 10, states: [] },
    { serviceId: 'General Book', glyph: 'G', label: 'General Book', count: 7, states: [] },
  ]

  it('shows the selected service on the chip and picks another one', async () => {
    const onChange = vi.fn()
    render(<ServicePopover items={items} active="General Book" onChange={onChange} />)
    const chip = screen.getByRole('button', { name: /Service/ })
    expect(chip).toHaveTextContent('General Book')

    await userEvent.click(chip)
    const panel = await screen.findByRole('dialog', { name: 'Service' })
    expect(within(panel).getByRole('button', { name: /General Book/ })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(panel).getByRole('button', { name: /All forms/ }))
    expect(onChange).toHaveBeenCalledWith('all')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps naming the active service when the (Created by me) facets omit it', () => {
    render(<ServicePopover items={items} active="Warning Form" onChange={vi.fn()} />)
    const chip = screen.getByRole('button', { name: /Service/ })
    expect(chip).toHaveTextContent('L:Warning Form')
    expect(chip).not.toHaveTextContent('All')
  })
})
