/**
 * Sticky filter bar for the Books page — TAMM redesign.
 *
 * One rounded surface pill with: category popover · direction chips · date range
 * · search · clear. Tests still reach inputs by their data-testid attributes.
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookCategoryRead, ServiceFacetRead } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { serviceArtwork, serviceGlyph, useServiceLabel } from './serviceLabels'
import { useCapabilities } from '@/lib/useCapabilities'
import { hasServiceCap } from '@/lib/dashboardLayout'

export interface BooksFilters {
  categoryIds: string[]
  direction: 'all' | 'incoming' | 'outgoing'
  status: 'all' | 'none' | 'pending' | 'approved' | 'returned' | 'rejected'
  fromDate: string
  toDate: string
  q: string
  drafts?: boolean
  serviceId: string
}

interface BooksFilterBarProps {
  filters: BooksFilters
  categories: BookCategoryRead[]
  services: ServiceFacetRead[]
  onChange: (filters: BooksFilters) => void
}

export function BooksFilterBar({
  filters,
  categories,
  services,
  onChange,
}: BooksFilterBarProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const serviceLabel = useServiceLabel()
  const { has } = useCapabilities()
  const visibleServices = services.filter((service) => hasServiceCap(service.id, has))
  const selectedServiceAllowed =
    filters.serviceId === 'all' || hasServiceCap(filters.serviceId, has)
  const selectedServiceId = selectedServiceAllowed ? filters.serviceId : 'all'
  const resetDeniedServiceRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [catOpen, setCatOpen] = useState(false)
  const catRootRef = useRef<HTMLDivElement>(null)
  const resetDeniedService = useEffectEvent(() => {
    onChange({ ...filters, serviceId: 'all' })
  })
  const [svcOpen, setSvcOpen] = useState(false)
  const svcRootRef = useRef<HTMLDivElement>(null)

  const isAnyFilterActive =
    filters.categoryIds.length > 0 ||
    filters.direction !== 'all' ||
    filters.status !== 'all' ||
    filters.fromDate !== '' ||
    filters.toDate !== '' ||
    filters.q !== '' ||
    !!filters.drafts ||
    selectedServiceId !== 'all'

  useEffect(() => {
    if (selectedServiceAllowed) {
      resetDeniedServiceRef.current = null
      return
    }
    if (resetDeniedServiceRef.current === filters.serviceId) return
    resetDeniedServiceRef.current = filters.serviceId
    resetDeniedService()
  }, [filters.serviceId, selectedServiceAllowed])

  const clear = (): void => {
    onChange({ categoryIds: [], direction: 'all', status: 'all', fromDate: '', toDate: '', q: '', drafts: false, serviceId: 'all' })
  }

  const toggleCategory = (id: string): void => {
    const next = filters.categoryIds.includes(id)
      ? filters.categoryIds.filter((c) => c !== id)
      : [...filters.categoryIds, id]
    onChange({ ...filters, categoryIds: next })
  }

  // Debounce the search box — onChange is called immediately for other fields
  const handleSearchChange = (value: string): void => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onChange({ ...filters, q: value })
    }, 300)
  }

  // Track raw input value separately so the input isn't laggy
  const searchRef = useRef<HTMLInputElement>(null)

  // Keep input value in sync when filters are cleared externally
  useEffect(() => {
    if (searchRef.current && filters.q === '') {
      searchRef.current.value = ''
    }
  }, [filters.q])

  // Close the category popover on outside-click or Escape
  useEffect(() => {
    if (!catOpen) return
    function onDown(e: MouseEvent): void {
      if (catRootRef.current && !catRootRef.current.contains(e.target as Node)) {
        setCatOpen(false)
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setCatOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [catOpen])

  // Close the service popover on outside-click or Escape
  useEffect(() => {
    if (!svcOpen) return
    function onDown(e: MouseEvent): void {
      if (svcRootRef.current && !svcRootRef.current.contains(e.target as Node)) {
        setSvcOpen(false)
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setSvcOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [svcOpen])

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-3 py-2"
      data-testid="books-filter-bar"
    >
      {/* Category compact popover trigger */}
      <div ref={catRootRef} className="relative shrink-0">
        <button
          type="button"
          data-testid="category-filter"
          aria-haspopup="listbox"
          aria-expanded={catOpen}
          onClick={() => setCatOpen((v) => !v)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline px-3 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            filters.categoryIds.length > 0
              ? 'bg-primary-soft font-semibold text-primary'
              : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
          )}
        >
          <span>{t('books.filters.category')}</span>
          {filters.categoryIds.length > 0 ? (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.85em] font-bold text-primary-foreground">
              {filters.categoryIds.length}
            </span>
          ) : (
            <span className="text-muted-foreground/70">{t('books.filters.categoryAll', { defaultValue: 'All' })}</span>
          )}
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', catOpen && 'rotate-180')}
            strokeWidth={2}
          />
        </button>

        {catOpen && (
          <div
            role="listbox"
            aria-multiselectable="true"
            aria-label={t('books.filters.category')}
            className="absolute start-0 top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg"
          >
            <ul className="max-h-64 overflow-y-auto py-1">
              {categories.map((cat) => {
                const label = isAr ? (cat.name_ar ?? cat.name_en) : (cat.name_en ?? cat.name_ar)
                const checked = filters.categoryIds.includes(cat.id)
                return (
                  <li key={cat.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => toggleCategory(cat.id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-[0.82em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        checked
                          ? 'bg-primary-soft font-semibold text-primary'
                          : 'text-foreground hover:bg-surface-tinted',
                      )}
                    >
                      {/* Visible checkbox indicator */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-hairline bg-surface',
                        )}
                      >
                        {checked && (
                          <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-current" aria-hidden="true">
                            <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span dir="auto">{label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {filters.categoryIds.length > 0 && (
              <div className="border-t border-hairline px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, categoryIds: [] })}
                  className="text-[0.78em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
                >
                  {t('books.filters.clear')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hidden h-5 w-px bg-hairline md:block" />

      {/* Service compact popover trigger — single-select, distinct from Category */}
      <div ref={svcRootRef} className="relative shrink-0">
        <button
          type="button"
          data-testid="service-filter"
          aria-haspopup="listbox"
          aria-expanded={svcOpen}
          onClick={() => setSvcOpen((v) => !v)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full border border-hairline px-3 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            selectedServiceId !== 'all'
              ? 'bg-primary-soft font-semibold text-primary'
              : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
          )}
        >
          <span>{t('books.filters.service')}</span>
          <span className={selectedServiceId !== 'all' ? '' : 'text-muted-foreground/70'}>
            {selectedServiceId === 'all' ? t('books.filters.serviceAll') : serviceLabel(selectedServiceId)}
          </span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', svcOpen && 'rotate-180')}
            strokeWidth={2}
          />
        </button>

        {svcOpen && (
          <div
            role="listbox"
            aria-label={t('books.filters.service')}
            className="absolute start-0 top-full z-50 mt-1.5 min-w-[200px] overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg"
          >
            <ul className="max-h-64 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedServiceId === 'all'}
                  onClick={() => {
                    onChange({ ...filters, serviceId: 'all' })
                    setSvcOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-start text-[0.82em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    selectedServiceId === 'all'
                      ? 'bg-primary-soft font-semibold text-primary'
                      : 'text-foreground hover:bg-surface-tinted',
                  )}
                >
                  <span dir="auto">{t('books.filters.serviceAll')}</span>
                </button>
              </li>
              {visibleServices.map((s) => {
                const checked = selectedServiceId === s.id
                const artwork = serviceArtwork(s.id)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => {
                        onChange({ ...filters, serviceId: s.id })
                        setSvcOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-start text-[0.82em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        checked
                          ? 'bg-primary-soft font-semibold text-primary'
                          : 'text-foreground hover:bg-surface-tinted',
                      )}
                    >
                      {artwork ? (
                        <ServiceArtwork artwork={artwork} size="row" className="shrink-0" />
                      ) : (
                        <span aria-hidden="true">{serviceGlyph(s.id)}</span>
                      )}
                      <span dir="auto">{serviceLabel(s.id)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      <div className="hidden h-5 w-px bg-hairline md:block" />

      {/* Direction chips + date + search row (scrollable on mobile) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 md:flex-wrap md:pb-0">
        {/* Direction chips */}
        <div className="flex shrink-0 items-center gap-1.5" data-testid="direction-toggle">
          {(['all', 'incoming', 'outgoing'] as const).map((dir) => {
            const active = filters.direction === dir
            return (
              <button
                key={dir}
                type="button"
                onClick={() => onChange({ ...filters, direction: dir })}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background max-md:min-h-[36px] max-md:py-1.5',
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

        <div className="hidden h-5 w-px shrink-0 bg-hairline md:block" />
        <div className="flex shrink-0 items-center gap-1.5" data-testid="status-toggle">
          {([
            ['all', t('books.filters.statusAll')],
            ['none', t('books.approval.stateDraft')],
            ['pending', t('books.approval.statePending')],
            ['approved', t('books.approval.stateApproved')],
            ['returned', t('books.approval.stateReturned')],
            ['rejected', t('books.approval.stateRejected')],
          ] as const).map(([val, label]) => {
            const active = filters.status === val
            return (
              <button key={val} type="button" aria-pressed={active}
                onClick={() => onChange({ ...filters, status: val })}
                className={cn(
                  'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background max-md:min-h-[36px] max-md:py-1.5',
                  active ? 'bg-primary-soft font-semibold text-primary' : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                )}>
                {label}
              </button>
            )
          })}
        </div>

        <div className="hidden h-5 w-px shrink-0 bg-hairline md:block" />

        {/* Drafts pill */}
        <button
          type="button"
          aria-pressed={!!filters.drafts}
          onClick={() => onChange({ ...filters, drafts: !filters.drafts })}
          className={cn(
            'inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[0.78em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background max-md:min-h-[36px] max-md:py-1.5',
            filters.drafts
              ? 'bg-warning-soft font-semibold text-warning'
              : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
          )}
        >
          {t('books.filters.drafts')}
        </button>

        <div className="hidden h-5 w-px shrink-0 bg-hairline md:block" />

        {/* Date range */}
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="date"
            value={filters.fromDate}
            onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
            aria-label={t('books.filters.dateFrom')}
            className="h-8 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.78em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="date-from"
          />
          <span className="text-xs text-muted-foreground">—</span>
          <input
            type="date"
            value={filters.toDate}
            onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
            aria-label={t('books.filters.dateTo')}
            className="h-8 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.78em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="date-to"
          />
        </div>

        <div className="hidden h-5 w-px shrink-0 bg-hairline md:block" />

        {/* Search */}
        <Input
          ref={searchRef}
          defaultValue={filters.q}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t('common.search')}
          aria-label={t('books.filters.search')}
          className="h-8 w-44 shrink-0 rounded-full border-hairline bg-surface text-[0.85em]"
          data-testid="search-input"
        />

        {isAnyFilterActive && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            className="h-8 shrink-0 gap-1 rounded-full text-[0.78em] text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t('books.filters.clear')}
          </Button>
        )}
      </div>
    </div>
  )
}
