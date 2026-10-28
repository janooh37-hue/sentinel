/** The phone Records search box: sits beside "Select", above the cards. */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import type { BooksFilters } from './booksFiltersUtils'

interface BooksSearchFieldProps {
  filters: BooksFilters
  onChange: (filters: BooksFilters) => void
}

export function BooksSearchField({ filters, onChange }: BooksSearchFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const debounceRef = useRef<number | undefined>(undefined)
  // Uncontrolled so typing never lags behind the debounced filter update.
  const searchRef = useRef<HTMLInputElement>(null)

  // Clear the box when the filters are cleared elsewhere (Clear, empty state).
  useEffect(() => {
    if (searchRef.current && filters.q === '') searchRef.current.value = ''
  }, [filters.q])

  const handleChange = (value: string): void => {
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      onChange({ ...filters, q: value })
    }, 300)
  }

  return (
    <Input
      ref={searchRef}
      type="search"
      defaultValue={filters.q}
      onChange={(e) => handleChange(e.target.value)}
      placeholder={t('books.pane.searchPlaceholder')}
      aria-label={t('books.filters.search')}
      className="h-11 min-w-0 flex-1 rounded-full border-hairline bg-surface text-[0.85em]"
      data-testid="search-input"
    />
  )
}
