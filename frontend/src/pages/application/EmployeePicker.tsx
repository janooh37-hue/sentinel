/**
 * EmployeePicker — searchable combobox for the form-card Employee field.
 *
 * Calls GET /api/v1/employees?q=... on each keystroke (debounced by TanStack
 * Query's staleTime).  On select, propagates the employee id upward.
 *
 * Visual vocabulary is TAMM (spec §6.8): 10px×14px input padding, 10px
 * radius, hairline border, primary-soft focus ring.
 *
 * Keyboard: ArrowDown/ArrowUp move a visually-highlighted option (tracked via
 * `aria-activedescendant`, not real DOM focus — focus stays in the input).
 * Enter selects the highlighted option and blocks form submission while the
 * popup is open. Escape closes without changing the selection. Pointer and
 * keyboard selection both funnel through `selectRow` so behavior stays
 * identical either way.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { User } from 'lucide-react'

import { api } from '@/lib/api'
import type { EmployeeListItem } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

interface EmployeePickerProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Accessible name for the combobox input. Defaults to a translated
   * generic label — pass one when a field needs a more specific name
   * (e.g. "Link to employee" vs. just "Employee"). */
  ariaLabel?: string
}

export function EmployeePicker({
  selectedId,
  onSelect,
  ariaLabel,
}: EmployeePickerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const listboxId = useId()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending blur-close timeout on unmount (avoid setState-after-unmount).
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['employees-picker', query],
    queryFn: () => api.listEmployees({ q: query.trim() || undefined, limit: 50 }),
    enabled: open,
    staleTime: 15_000,
  })

  const { data: selectedData, isError: selectedError } = useQuery({
    queryKey: ['employee', selectedId],
    queryFn: () => api.getEmployee(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  })

  const rows: EmployeeListItem[] = data?.items ?? []

  function displayName(item: EmployeeListItem): string {
    return pickEmployeeName(item, i18n.language)
  }


  function selectRow(id: string | null): void {
    onSelect(id)
    setOpen(false)
    setQuery('')
    setActiveIndex(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (rows.length > 0) {
        setActiveIndex((i) => (i + 1) % rows.length)
      }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open && rows.length > 0) {
        setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1))
      }
      return
    }
    if (e.key === 'Enter') {
      if (!open) return
      // Block accidental form submission while the popup is open, whether
      // or not an option is currently highlighted.
      e.preventDefault()
      if (activeIndex >= 0 && activeIndex < rows.length) {
        selectRow(rows[activeIndex]!.id)
      }
      return
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setActiveIndex(-1)
      }
    }
  }

  const selectedLabel = selectedError
    ? `${selectedId} — ${t('application.employeePicker.selectedLoadError')}`
    : selectedData
      ? `${pickEmployeeName(selectedData, i18n.language)} — ${selectedData.id}`
      : ''

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3.5 py-2 focus-within:border-primary focus-within:ring-[3px] focus-within:ring-primary/15">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
          }
          aria-label={ariaLabel ?? t('application.employeePicker.defaultAriaLabel')}
          autoComplete="off"
          dir="auto"
          placeholder={t('application.employeePicker.placeholder')}
          value={open ? query : selectedLabel}
          onFocus={() => {
            setOpen(true)
            setQuery('')
            setActiveIndex(-1)
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setActiveIndex(-1)
          }}
          onKeyDown={onKeyDown}
          className="flex-1 bg-transparent text-[0.86em] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {selectedId && !open && (
          <button
            type="button"
            onClick={() => selectRow(null)}
            className="text-[0.86em] text-muted-foreground hover:text-foreground"
            aria-label={t('application.employeePicker.clearSelection')}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-hairline bg-surface py-1 shadow-lg"
        >
          {isLoading ? (
            <div className="flex flex-col gap-1 px-3 py-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1 py-1">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[0.86em] text-destructive" role="alert">
              <span>{t('application.employeePicker.error')}</span>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void refetch()}
                className="shrink-0 font-medium underline"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-[0.86em] text-muted-foreground">
              {t('common.noResults')}
            </div>
          ) : (
            rows.map((row, index) => (
              <div
                key={row.id}
                id={`${listboxId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={row.id === selectedId}
                dir="auto"
                className={cn(
                  'flex w-full cursor-pointer flex-col px-3 py-2 text-start text-[0.86em] hover:bg-surface-tinted',
                  row.id === selectedId && 'bg-primary-soft text-primary',
                  index === activeIndex && 'bg-surface-tinted',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectRow(row.id)
                }}
              >
                <span className="font-medium">{displayName(row)}</span>
                <span className="font-mono text-[0.72em] text-muted-foreground">
                  {row.id}
                  {row.department ? ` · ${row.department}` : ''}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
