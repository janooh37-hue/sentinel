/**
 * Minimal searchable employee combobox — shared between Records filter bar
 * and Balance tab. Wraps the application-page EmployeePicker pattern.
 *
 * TAMM redesign: transparent input inside the filter pill, surface dropdown
 * with hairline border and rounded-2xl. Use surface-tinted hover instead of
 * sand-100 paper tones.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { User } from 'lucide-react'

import { api } from '@/lib/api'
import type { EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'

interface LeaveEmployeePickerProps {
  selectedId: string | null
  onSelect: (id: string | null) => void
  placeholder?: string
}

export function LeaveEmployeePicker({
  selectedId,
  onSelect,
  placeholder,
}: LeaveEmployeePickerProps): React.JSX.Element {
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
    queryKey: ['employees-leaves-picker', query],
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
    <div className="relative min-w-[220px]">
      <div className="flex items-center gap-2 rounded-full border border-hairline bg-surface px-3 py-1">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder ?? t('leaves.filters.employee')}
          value={open ? query : selectedLabel}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150)
          }}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 flex-1 border-0 bg-transparent text-[0.85em] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0"
        />
        {selectedId && !open && (
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              setQuery('')
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label={t('common.close')}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-hairline bg-surface py-1 shadow-lg"
        >
          {isLoading ? (
            <div className="px-3 py-2 text-[0.85em] text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-[0.85em] text-muted-foreground">
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
                  'flex w-full flex-col px-3 py-2 text-start text-[0.85em] hover:bg-surface-tinted',
                  row.id === selectedId && 'bg-primary-soft text-primary',
                )}
                onMouseDown={() => {
                  onSelect(row.id)
                  setOpen(false)
                  setQuery('')
                }}
              >
                <span className="font-medium">{displayName(row)}</span>
                <span className="font-mono text-[0.78em] text-muted-foreground">
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
