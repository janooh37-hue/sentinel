/**
 * The category / direction / date-range controls of the Books filters — ONE
 * implementation shared by the phone's `BooksFilterBar` (which lays the pieces
 * out inline) and the desktop `FiltersPopover` (which stacks them via
 * `BooksFilterFields`). The popover reuses the bar's content, not a copy.
 */
import { useTranslation } from 'react-i18next'

import type { BookCategoryRead } from '@/lib/api'
import { cn } from '@/lib/utils'

import type { BooksFilters } from './booksFiltersUtils'

const LEGEND = 'mb-1 text-[0.85em] font-bold uppercase tracking-[0.07em] text-muted-foreground'
const DATE_INPUT =
  'h-8 min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.95em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring max-md:min-h-[36px] pointer-coarse:h-11'

interface FieldProps {
  filters: BooksFilters
  onChange: (next: BooksFilters) => void
}

/** Multi-select category list (checkboxes). */
export function CategoryChecklist({
  filters,
  categories,
  onChange,
  className,
}: FieldProps & { categories: BookCategoryRead[]; className?: string }): React.JSX.Element {
  const { i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const toggle = (id: string): void =>
    onChange({
      ...filters,
      categoryIds: filters.categoryIds.includes(id)
        ? filters.categoryIds.filter((c) => c !== id)
        : [...filters.categoryIds, id],
    })
  return (
    <ul className={cn('overflow-y-auto py-1', className)}>
      {categories.map((cat) => {
        const name = isAr ? (cat.name_ar ?? cat.name_en) : (cat.name_en ?? cat.name_ar)
        const checked = filters.categoryIds.includes(cat.id)
        return (
          <li key={cat.id}>
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[0.82em] hover:bg-surface-tinted pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(cat.id)}
                className="h-4 w-4 accent-primary"
              />
              <span dir="auto" className={cn(checked && 'font-semibold text-primary')}>
                {name}
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** All / Incoming / Outgoing chips. */
export function DirectionChips({
  filters,
  onChange,
  testId,
  className,
}: FieldProps & { testId?: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid={testId}>
      {(['all', 'incoming', 'outgoing'] as const).map((dir) => {
        const active = filters.direction === dir
        return (
          <button
            key={dir}
            type="button"
            aria-pressed={active}
            onClick={() => onChange({ ...filters, direction: dir })}
            className={cn(
              'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background max-md:min-h-[36px] max-md:py-1.5 pointer-coarse:min-h-11',
              active
                ? 'bg-primary-soft font-semibold text-primary'
                : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
            )}
          >
            {t(`books.direction.${dir}`)}
          </button>
        )
      })}
    </div>
  )
}

/** From / To date range with visible labels (a bare date input says nothing). */
export function DateRangeFields({
  filters,
  onChange,
  testIdPrefix = '',
  className,
}: FieldProps & { testIdPrefix?: string; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.78em] text-muted-foreground">
        <span>{t('books.filters.dateFrom')}</span>
        <input
          type="date"
          value={filters.fromDate}
          onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
          className={DATE_INPUT}
          data-testid={`${testIdPrefix}date-from`}
        />
      </label>
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        —
      </span>
      <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.78em] text-muted-foreground">
        <span>{t('books.filters.dateTo')}</span>
        <input
          type="date"
          value={filters.toDate}
          onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
          className={DATE_INPUT}
          data-testid={`${testIdPrefix}date-to`}
        />
      </label>
    </div>
  )
}

/** The stacked group (desktop popover body): category · direction · dates. */
export function BooksFilterFields({
  filters,
  categories,
  onChange,
  testIdPrefix = '',
}: FieldProps & { categories: BookCategoryRead[]; testIdPrefix?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className={LEGEND}>{t('books.filters.category')}</legend>
        <CategoryChecklist
          filters={filters}
          categories={categories}
          onChange={onChange}
          className="max-h-48 rounded-lg border border-hairline"
        />
      </fieldset>
      <fieldset>
        <legend className={LEGEND}>{t('books.filters.direction')}</legend>
        <DirectionChips filters={filters} onChange={onChange} />
      </fieldset>
      <DateRangeFields filters={filters} onChange={onChange} testIdPrefix={testIdPrefix} />
    </div>
  )
}
