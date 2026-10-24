/**
 * Search the reporting tree for one person: name (either language), number or
 * position. Results are real buttons, so picking someone never needs a chart,
 * a drag or a precise target.
 */

import { useId, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OrgNodeRead } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { cn } from '@/lib/utils'
import { matchesPerson, personPosition } from './labels'

export function PersonSearch({ people, label, placeholder, onPick, meta, disabledReason, limit = 12, autoFocus = false, initialQuery = '' }: {
  people: readonly OrgNodeRead[]
  label: string
  placeholder?: string
  onPick: (person: OrgNodeRead) => void
  /** Second line under the name, e.g. team size or current department. */
  meta?: (person: OrgNodeRead) => React.ReactNode
  /** A reason the person can't be picked; shown instead of enabling the row. */
  disabledReason?: (person: OrgNodeRead) => string | null
  limit?: number
  autoFocus?: boolean
  initialQuery?: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [query, setQuery] = useState(initialQuery)
  const term = query.trim()
  const results = term ? people.filter((person) => matchesPerson(person, term)).slice(0, limit) : []

  return (
    <div className="min-w-0">
      <label htmlFor={`${id}-q`} className="text-[0.84em] font-medium text-foreground">{label}</label>
      <div className="mt-1.5 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          id={`${id}-q`}
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder ?? t('orgDepartments.search.personPlaceholder')}
          data-pill-input
          className="min-w-0 flex-1 bg-transparent py-2 text-[0.9em] outline-none placeholder:text-muted-foreground"
          aria-describedby={`${id}-status`}
        />
      </div>
      <p id={`${id}-status`} role="status" className="sr-only">
        {term ? t('orgDepartments.search.resultCount', { count: results.length }) : ''}
      </p>
      {term && results.length === 0 && (
        <p className="mt-2 text-[0.84em] text-muted-foreground">{t('common.noResults')}</p>
      )}
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
          {results.map((person) => {
            const reason = disabledReason?.(person) ?? null
            const position = personPosition(person, i18n.language)
            return (
              <li key={person.id}>
                <button
                  type="button"
                  disabled={reason !== null}
                  onClick={() => {
                    setQuery('')
                    onPick(person)
                  }}
                  className={cn(
                    'flex min-h-12 w-full items-start gap-3 px-3.5 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    reason === null ? 'hover:bg-surface-tinted' : 'cursor-not-allowed opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <bdi className="block break-words text-[0.9em] font-medium text-foreground">{pickEmployeeName(person, i18n.language)}</bdi>
                    <span className="mt-0.5 block text-[0.78em] text-muted-foreground">
                      <bdi dir="ltr" className="font-mono">{person.id}</bdi>
                      {position ? <> · <bdi>{position}</bdi></> : null}
                    </span>
                    {(reason ?? meta?.(person)) ? (
                      <span className={cn('mt-0.5 block text-[0.78em]', reason ? 'text-warning' : 'text-muted-foreground')}>{reason ?? meta?.(person)}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
