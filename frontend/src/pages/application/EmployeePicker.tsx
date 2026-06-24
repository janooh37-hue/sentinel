/**
 * EmployeePicker — searchable combobox for the form-card Employee field.
 *
 * Calls GET /api/v1/employees?q=... on each keystroke (debounced by TanStack
 * Query's staleTime).  On select, propagates the employee id upward.
 *
 * Visual vocabulary is TAMM (spec §6.8): 10px×14px input padding, 10px
 * radius, hairline border, primary-soft focus ring.
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
}

export function EmployeePicker({ selectedId, onSelect }: EmployeePickerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const listboxId = useId()

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending blur-close timeout on unmount (avoid setState-after-unmount).
  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['employees-picker', query],
    queryFn: () => api.listEmployees({ q: query.trim() || undefined, limit: 50 }),
    enabled: open,
    staleTime: 15_000,
  })

  const { data: selectedData } = useQuery({
    queryKey: ['employee', selectedId],
    queryFn: () => api.getEmployee(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  })

  const rows: EmployeeListItem[] = data?.items ?? []

  function displayName(item: EmployeeListItem): string {
    return pickEmployeeName(item, i18n.language)
  }

  const selectedLabel = selectedData
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
          autoComplete="off"
          placeholder={t('application.employeePicker.placeholder')}
          value={open ? query : selectedLabel}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150)
          }}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-transparent text-[0.86em] text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {selectedId && !open && (
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              setQuery('')
            }}
            className="text-[0.86em] text-muted-foreground hover:text-foreground"
            aria-label="Clear selection"
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
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-[0.86em] text-muted-foreground">
              {t('common.noResults')}
            </div>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={row.id === selectedId}
                className={cn(
                  'flex w-full flex-col px-3 py-2 text-start text-[0.86em] hover:bg-surface-tinted',
                  row.id === selectedId && 'bg-primary-soft text-primary',
                )}
                onMouseDown={() => {
                  onSelect(row.id)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="font-medium">{displayName(row)}</span>
                <span className="font-mono text-[0.72em] text-muted-foreground">
                  {row.id}
                  {row.department ? ` · ${row.department}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
