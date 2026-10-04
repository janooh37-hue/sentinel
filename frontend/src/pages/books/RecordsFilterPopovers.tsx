/**
 * Records page (desktop) — the toolbar popovers beside the search box:
 *
 *   FiltersPopover  category (multi) · direction · date range. The status chips,
 *                   drafts and search live elsewhere on the desktop page, so
 *                   this holds only what the phone's BooksFilterBar offers
 *                   beyond them.
 *   ServicePopover  the rail's replacement in the drawer tier (below 64rem there
 *                   is no rail): single-select service with counts.
 *
 * The panel is portaled and positioned from its trigger, so the list card's
 * `overflow-hidden` cannot clip it. It is a non-modal `role="dialog"` marked
 * open: the global shortcut layer then stays out of the way (J/K/Enter/Esc) and
 * Esc closes it here, returning focus to the trigger.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookCategoryRead } from '@/lib/api'
import { ServiceArtwork } from '@/components/ui/service-artwork'
import { hasServiceRecordsCap } from '@/lib/dashboardLayout'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'

import type { BooksFilters } from './booksFiltersUtils'
import type { RailItem } from './FormRail'

interface PanelPosition {
  top: number
  /** `inset-inline-end` in px: the panel's end edge lines up with the trigger's. */
  inlineEnd: number
}

const CHIP =
  'inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.75em] font-semibold transition-colors motion-reduce:transition-none pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Trigger + anchored panel state shared by both popovers. */
function useAnchoredPanel(): {
  triggerRef: React.RefObject<HTMLButtonElement | null>
  position: PanelPosition | null
  toggle: () => void
  close: (restoreFocus?: boolean) => void
} {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const close = (restoreFocus = false): void => {
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }
  const toggle = (): void => {
    if (position) {
      close()
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const rtl = document.documentElement.dir === 'rtl'
    setPosition({ top: rect.bottom + 6, inlineEnd: rtl ? rect.left : window.innerWidth - rect.right })
  }
  return { triggerRef, position, toggle, close }
}

function PopoverPanel({
  label,
  position,
  triggerRef,
  onClose,
  className,
  children,
}: {
  label: string
  position: PanelPosition
  triggerRef: React.RefObject<HTMLButtonElement | null>
  onClose: (restoreFocus?: boolean) => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Latest `onClose` without re-subscribing the document listeners.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    panelRef.current?.focus()
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      closeRef.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current(true)
    }
    const onResize = (): void => closeRef.current()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [triggerRef])
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      data-state="open"
      tabIndex={-1}
      style={{ position: 'fixed', top: position.top, insetInlineEnd: position.inlineEnd }}
      className={cn(
        'z-50 max-w-[calc(100vw-1rem)] rounded-xl border border-hairline bg-surface text-foreground shadow-lg focus:outline-none',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

export function FiltersPopover({
  filters,
  categories,
  onChange,
}: {
  filters: BooksFilters
  categories: BookCategoryRead[]
  onChange: (next: BooksFilters) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { triggerRef, position, toggle, close } = useAnchoredPanel()
  const activeCount =
    filters.categoryIds.length +
    (filters.direction !== 'all' ? 1 : 0) +
    (filters.fromDate || filters.toDate ? 1 : 0)

  const toggleCategory = (id: string): void =>
    onChange({
      ...filters,
      categoryIds: filters.categoryIds.includes(id)
        ? filters.categoryIds.filter((c) => c !== id)
        : [...filters.categoryIds, id],
    })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="records-filters"
        aria-haspopup="dialog"
        aria-expanded={position !== null}
        onClick={toggle}
        className={cn(
          CHIP,
          activeCount > 0
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
        {t('books.list.filters')}
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.85em] font-bold text-primary-foreground">
            <bdi dir="ltr">{activeCount}</bdi>
          </span>
        )}
      </button>
      {position && (
        <PopoverPanel
          label={t('books.list.filters')}
          position={position}
          triggerRef={triggerRef}
          onClose={close}
          className="w-[20rem] p-3"
        >
          <div className="flex flex-col gap-3 text-[0.82em]">
            <fieldset>
              <legend className="mb-1 text-[0.85em] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                {t('books.filters.category')}
              </legend>
              <ul className="max-h-48 overflow-y-auto rounded-lg border border-hairline py-1">
                {categories.map((cat) => {
                  const name = isAr ? (cat.name_ar ?? cat.name_en) : (cat.name_en ?? cat.name_ar)
                  const checked = filters.categoryIds.includes(cat.id)
                  return (
                    <li key={cat.id}>
                      <label className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-tinted pointer-coarse:min-h-11">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCategory(cat.id)}
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
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-[0.85em] font-bold uppercase tracking-[0.07em] text-muted-foreground">
                {t('books.filters.direction')}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {(['all', 'incoming', 'outgoing'] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    aria-pressed={filters.direction === dir}
                    onClick={() => onChange({ ...filters, direction: dir })}
                    className={cn(
                      CHIP,
                      filters.direction === dir
                        ? 'border-primary/40 bg-primary-soft text-primary'
                        : 'border-transparent bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                    )}
                  >
                    {t(`books.direction.${dir}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
                aria-label={t('books.filters.dateFrom')}
                data-testid="records-date-from"
                className="h-9 min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.9em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring pointer-coarse:h-11"
              />
              <span aria-hidden className="text-muted-foreground">
                —
              </span>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
                aria-label={t('books.filters.dateTo')}
                data-testid="records-date-to"
                className="h-9 min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3 font-mono text-[0.9em] text-foreground focus:outline-none focus:ring-2 focus:ring-ring pointer-coarse:h-11"
              />
            </div>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  onChange({ ...filters, categoryIds: [], direction: 'all', fromDate: '', toDate: '' })
                }
                className="self-start rounded-sm text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('books.filters.clear')}
              </button>
            )}
          </div>
        </PopoverPanel>
      )}
    </>
  )
}

export function ServicePopover({
  items,
  active,
  onChange,
}: {
  items: RailItem[]
  active: string
  onChange: (serviceId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const { triggerRef, position, toggle, close } = useAnchoredPanel()
  const visible = items.filter(
    (item) => item.serviceId === 'all' || hasServiceRecordsCap(item.serviceId, has),
  )
  const current = visible.find((item) => item.serviceId === active)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="records-service"
        aria-haspopup="dialog"
        aria-expanded={position !== null}
        onClick={toggle}
        className={cn(
          CHIP,
          active !== 'all'
            ? 'border-primary/40 bg-primary-soft text-primary'
            : 'border-hairline bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
        )}
      >
        <span>{t('books.filters.service')}</span>
        <span className="max-w-[10rem] truncate font-medium" dir="auto">
          {current?.label ?? t('books.filters.serviceAll')}
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none',
            position && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      {position && (
        <PopoverPanel
          label={t('books.filters.service')}
          position={position}
          triggerRef={triggerRef}
          onClose={close}
          className="w-[16rem] overflow-hidden py-1"
        >
          <ul className="max-h-72 overflow-y-auto">
            {visible.map((item) => {
              const isActive = item.serviceId === active
              return (
                <li key={item.serviceId}>
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => {
                      onChange(item.serviceId)
                      close(true)
                    }}
                    className={cn(
                      'flex min-h-10 w-full items-center gap-2.5 px-3 py-1.5 text-start text-[0.82em] transition-colors motion-reduce:transition-none pointer-coarse:min-h-11',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      isActive ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-surface-tinted',
                    )}
                  >
                    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center">
                      {item.artwork ? (
                        <ServiceArtwork artwork={item.artwork} size="row" />
                      ) : (
                        item.glyph
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {item.label}
                    </span>
                    <span className="font-mono text-[0.85em] tabular-nums text-faint">
                      <bdi dir="ltr">{item.count}</bdi>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </PopoverPanel>
      )}
    </>
  )
}
