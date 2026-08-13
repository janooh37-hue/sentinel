import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api, type EmployeeListItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { StatusPill } from './StatusPill'
import { pickPosition } from '@/lib/employeePosition'
import { useDebouncedValue } from '@/lib/useDebouncedValue'

interface Props {
  onSelect: (employee: EmployeeListItem) => void
  onOpenProfile: (employeeId: string) => void
}

export function EmployeeActivityLookup({
  onSelect,
  onOpenProfile,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim()
  const debounced = useDebouncedValue(query, 250).trim()
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const showRefs = useRef<Array<HTMLButtonElement | null>>([])

  const { data, isPending, isError } = useQuery({
    queryKey: ['employee-activity-lookup', debounced],
    queryFn: () => api.listEmployees({ q: debounced, limit: 8 }),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  })
  const items = data?.items ?? []
  const popupOpen = normalizedQuery.length > 0 && normalizedQuery === debounced && dismissedQuery !== debounced

  function closePopup(): void {
    setDismissedQuery(debounced)
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
    setDismissedQuery(debounced)
    onSelect(employee)
    inputRef.current?.focus()
  }


  return (
    <div className="relative min-w-0 flex-1 text-start">
      <label htmlFor="employee-activity-lookup" className="sr-only">
        {t('employees.activity.lookupLabel')}
      </label>
      <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-0 focus-within:ring-2 focus-within:ring-primary">
        <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-faint">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.3-3.3" />
        </svg>
        <input
          ref={inputRef}
          id="employee-activity-lookup"
          type="search"
          role="searchbox"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setDismissedQuery(null) }}
          onKeyDown={handleInputKeyDown}
          placeholder={t('employees.activity.lookupPlaceholder')}
          aria-expanded={popupOpen}
          aria-controls="employee-activity-lookup-results"
          autoComplete="off"
          className="w-full min-w-0 border-0 bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {popupOpen && (
        <ul
          id="employee-activity-lookup-results"
          role="list"
          aria-label={t('employees.activity.matches')}
          className="absolute inset-x-0 top-[calc(100%+8px)] z-20 max-h-[min(55vh,480px)] overflow-y-auto rounded-xl border border-border bg-surface text-foreground shadow-lg"
        >
          {isPending && (
            <li className="px-4 py-3 text-sm text-muted-foreground" role="status">
              {t('employees.activity.lookupLoading')}
            </li>
          )}
          {isError && (
            <li className="px-4 py-3 text-sm text-destructive" role="alert">
              {t('employees.activity.lookupError')}
            </li>
          )}
          {!isPending && !isError && items.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">
              {t('employees.activity.lookupEmpty')}
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
                    <StatusPill status={employee.status} />
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    ref={(button) => { showRefs.current[index] = button }}
                    type="button"
                    onClick={() => selectEmployee(employee)}
                    onKeyDown={(event) => handleShowKeyDown(event, index)}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
