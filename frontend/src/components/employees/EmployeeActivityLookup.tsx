import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api, type EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

interface Props {
  selected: EmployeeListItem | null
  onSelect: (employee: EmployeeListItem) => void
  onClear: () => void
  onOpenProfile: (employeeId: string) => void
}

export function EmployeeActivityLookup({
  selected,
  onSelect,
  onClear,
  onOpenProfile,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 250).trim()
  const [popupOpen, setPopupOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const showRefs = useRef<Array<HTMLButtonElement | null>>([])

  const { data, isPending, isError } = useQuery({
    queryKey: ['employee-activity-lookup', debounced],
    queryFn: () => api.listEmployees({ q: debounced, limit: 8 }),
    enabled: selected == null && debounced.length > 0,
    staleTime: 30_000,
  })

  const items = data?.items ?? []

  useEffect(() => {
    setPopupOpen(selected == null && debounced.length > 0)
  }, [debounced, selected])

  function closePopup(): void {
    setPopupOpen(false)
    inputRef.current?.focus()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' && popupOpen) {
      event.preventDefault()
      showRefs.current[0]?.focus()
    } else if (event.key === 'Escape' && popupOpen) {
      event.preventDefault()
      closePopup()
    }
  }

  function handleShowKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === 'ArrowDown' && index < items.length - 1) {
      event.preventDefault()
      showRefs.current[index + 1]?.focus()
    } else if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      showRefs.current[index - 1]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closePopup()
    }
  }

  function handlePopupActionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePopup()
    }
  }

  function selectEmployee(employee: EmployeeListItem): void {
    setQuery('')
    setPopupOpen(false)
    onSelect(employee)
  }

  if (selected != null) {
    const selectedPosition = pickPosition(selected, lang)
    return (
      <section aria-label={t('employees.activity.lookupLabel')} className="rounded-2xl border border-border bg-surface p-4 text-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('employees.activity.lookupLabel')}
            </p>
            <p dir="auto" className="mt-1 truncate font-semibold">{pickEmployeeName(selected, lang)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span dir="auto" className="font-mono">{selected.id}</span>
              {selectedPosition && <span dir="auto">{selectedPosition}</span>}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onOpenProfile(selected.id)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('employees.activity.openProfile')}
            </button>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('employees.activity.clearEmployee')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className="relative text-start">
      <label htmlFor="employee-activity-lookup" className="sr-only">
        {t('employees.activity.lookupLabel')}
      </label>
      <input
        ref={inputRef}
        id="employee-activity-lookup"
        type="search"
        role="searchbox"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder={t('employees.activity.lookupPlaceholder')}
        aria-expanded={popupOpen}
        aria-controls="employee-activity-lookup-results"
        autoComplete="off"
        className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
      />

      {popupOpen && (
        <ul
          id="employee-activity-lookup-results"
          role="list"
          aria-label={t('employees.activity.matches')}
          className="absolute inset-x-0 top-[calc(100%+8px)] z-20 max-h-[min(55vh,480px)] overflow-y-auto rounded-xl border border-border bg-surface text-foreground shadow-lg"
        >
          {isPending && (
            <li className="px-4 py-3 text-sm text-muted-foreground" role="status">
              {t('employees.activity.loading')}
            </li>
          )}
          {isError && (
            <li className="px-4 py-3 text-sm text-destructive" role="alert">
              {t('employees.activity.lookupError')}
            </li>
          )}
          {!isPending && !isError && items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {t('employees.activity.emptyFiltered')}
            </li>
          )}
          {!isPending && !isError && items.map((employee, index) => {
            const position = pickPosition(employee, lang)
            return (
              <li key={employee.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-sm font-semibold">{pickEmployeeName(employee, lang)}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span dir="auto" className="font-mono">{employee.id}</span>
                    {position && <span dir="auto">{position}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    ref={(button) => { showRefs.current[index] = button }}
                    type="button"
                    onClick={() => selectEmployee(employee)}
                    onKeyDown={(event) => handleShowKeyDown(event, index)}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('employees.activity.showActivity')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenProfile(employee.id)}
                    onKeyDown={handlePopupActionKeyDown}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('employees.activity.openProfile')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
