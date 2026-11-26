import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ArmoryPersonCandidateRead, ArmoryPeopleFilters } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { Ltr } from '../ArmoryLtr'
import { licenceStatusKey, useArmoryLocale } from '../armoryFormat'
import { useArmoryPeople } from '../armoryQueries'

export type ArmoryPickerPurpose = ArmoryPeopleFilters['purpose']

interface Props {
  purpose: ArmoryPickerPurpose
  /** Required for `issue` and `witness`; ranks on-duty-here first. */
  safeId: number | null
  label: string
  value: ArmoryPersonCandidateRead | null
  onChange: (person: ArmoryPersonCandidateRead | null) => void
  /** Employees who cannot be chosen here (holder, supervisor, the recording armorer). */
  excludeIds?: readonly string[]
  inputRef?: React.RefObject<HTMLInputElement | null>
  disabled?: boolean
  /** Extra state shown under a selected person (warnings live in the caller). */
  describeSelected?: (person: ArmoryPersonCandidateRead) => React.ReactNode
}

/**
 * Editor-only person/witness picker over `GET /armory/people`. The server
 * ranks candidates (on duty here first for `issue`/`witness`); the picker never
 * re-sorts or infers duty from labels.
 */
export function ArmoryPersonPicker({ purpose, safeId, label, value, onChange, excludeIds = [], inputRef, disabled = false, describeSelected }: Props): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 250).trim()
  const needsSafe = purpose === 'issue' || purpose === 'witness'
  const filters: ArmoryPeopleFilters = { purpose, ...(debounced ? { q: debounced } : {}), ...(safeId !== null ? { safe_id: safeId } : {}) }
  const people = useArmoryPeople(filters, !value && !disabled && (!needsSafe || safeId !== null))
  const matches = (people.data ?? []).filter(row => !excludeIds.includes(row.person.employee_id))
  const showCourse = purpose === 'issue' || purpose === 'custody'
  const onDuty = matches.filter(row => row.on_duty_here)
  const others = matches.filter(row => !row.on_duty_here)
  const groups = purpose === 'custody' ? [{ key: 'all', title: null, rows: matches }] : [
    { key: 'duty', title: t('assets.armory.onDutyHere'), rows: onDuty },
    { key: 'other', title: t('assets.armory.otherGuards'), rows: others },
  ]
  const ordered = groups.flatMap(group => group.rows)

  function choose(person: ArmoryPersonCandidateRead) {
    setQuery('')
    onChange(person)
  }
  function focusResult(index: number) {
    resultRefs.current[Math.max(0, Math.min(ordered.length - 1, index))]?.focus()
  }

  if (value) {
    return <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-surface-raised p-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="break-words font-semibold"><bdi>{name(value.person)}</bdi></p>
        <Ltr className="text-sm text-muted-foreground">{value.person.employee_id}</Ltr>
        {describeSelected?.(value)}
      </div>
      <Button type="button" variant="secondary" className="min-h-11" disabled={disabled}
        aria-label={`${t('assets.armory.change')}: ${label}`}
        onClick={() => { onChange(null); requestAnimationFrame(() => ref.current?.focus()) }}>{t('assets.armory.change')}</Button>
    </div>
  }

  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
    <Input ref={ref} id={id} type="search" dir="auto" autoComplete="off" disabled={disabled} className="min-h-11"
      placeholder={t('assets.armory.searchGuard')} value={query} aria-controls={`${id}-results`}
      onChange={event => setQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' && ordered.length) { event.preventDefault(); focusResult(0) }
        else if (event.key === 'Enter') { event.preventDefault(); if (ordered.length === 1) choose(ordered[0]) }
      }} />
    <div id={`${id}-results`} className="max-h-72 overflow-y-auto rounded-md border border-border">
      {people.isPending && <p role="status" className="p-3 text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
      {people.isError && <div className="flex flex-wrap items-center gap-2 p-3">
        <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => void people.refetch()}>{t('assets.armory.retry')}</Button>
      </div>}
      {people.data && ordered.length === 0 && <p className="p-3 text-sm text-muted-foreground">
        {debounced ? t('assets.armory.noGuardFound', { query: debounced }) : t('assets.armory.noGuardsMatch')}
      </p>}
      {groups.filter(group => group.rows.length > 0).map(group => <section key={group.key} aria-label={group.title ?? label}>
        {group.title && <h3 className="bg-surface-tinted px-3 py-1.5 text-xs font-semibold text-muted-foreground">{group.title}</h3>}
        <ul>
          {group.rows.map(row => {
            const index = ordered.indexOf(row)
            return <li key={row.person.employee_id} className="border-b border-hairline last:border-0">
              <button type="button" ref={button => { resultRefs.current[index] = button }} disabled={disabled}
                className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => choose(row)}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); focusResult(index + 1) }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) ref.current?.focus(); else focusResult(index - 1) }
                }}>
                <span className="font-medium"><bdi>{name(row.person)}</bdi></span>
                <Ltr className="text-sm text-muted-foreground">{row.person.employee_id}</Ltr>
                {showCourse && row.course_round === null && <span className="text-xs text-warning">{t('assets.armory.noCourse')}</span>}
                {showCourse && row.licence_status !== 'valid' && <span className="text-xs text-muted-foreground">{t('assets.armory.licenceState')}: {t(licenceStatusKey(row.licence_status))}</span>}
              </button>
            </li>
          })}
        </ul>
      </section>)}
    </div>
  </div>
}
