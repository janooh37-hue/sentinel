import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { type UniformRecipient } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { formatDmy } from '@/lib/formatDmy'
import { cn } from '@/lib/utils'
import { useUniformRecipients } from '../uniformQueries'
import { PersonPanel } from './PersonPanel'

/** The canonical recipient balance leads; zero-held people remain in the history. */
export function ReceivedTab(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const people = useUniformRecipients('')
  const [query, setQuery] = useState('')
  const [draftPerson, setDraftPerson] = useState<UniformRecipient | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const listHeading = useRef<HTMLHeadingElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const cards = useRef(new Map<string, HTMLButtonElement>())
  const previousPerson = useRef<string | null>(null)
  const previousSelection = useRef<string | undefined>(undefined)
  const requested = params.get('person')
  const needle = query.trim().toLocaleLowerCase()
  const records = (people.data ?? []).filter(person => !needle || [person.employee_id, person.name_en, person.name_ar ?? ''].some(value => value.toLocaleLowerCase().includes(needle)))
  const candidate = requested !== null ? people.data?.find(person => person.employee_id === requested) : records[0]
  const selected = draftPerson ?? candidate
  const open = requested !== null

  useEffect(() => {
    if (draftPerson !== null) return
    const preceding = previousPerson.current
    const selectionChanged = previousSelection.current !== selected?.employee_id
    previousSelection.current = selected?.employee_id
    previousPerson.current = requested
    if (preceding === requested && !selectionChanged) return
    const frame = requestAnimationFrame(() => {
      if (requested !== null) heading.current?.focus()
      else if (preceding !== null) (cards.current.get(preceding) ?? search.current)?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [draftPerson, requested, selected?.employee_id])

  function back() {
    setParams(previous => { const next = new URLSearchParams(previous); next.delete('person'); return next })
  }

  function draftOpenChange(isOpen: boolean, opener: HTMLElement | null) {
    if (isOpen) {
      // Capture before opening: an effect notification can lose a refetch race.
      if (selected) setDraftPerson(selected)
      return
    }
    // Closing owns focus; do not replay navigation that happened behind the dialog.
    previousPerson.current = requested
    previousSelection.current = candidate?.employee_id
    setDraftPerson(null)
    requestAnimationFrame(() => {
      if (!opener?.isConnected || opener.matches(':disabled')) {
        (candidate || requested !== null ? heading.current : search.current)?.focus()
      }
    })
  }

  if (people.isError && people.data === undefined) return <section className="rounded-xl border border-border bg-surface p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.errorPeople')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => { void people.refetch().then(() => listHeading.current?.focus()) }}>{t('assets.uniform.retry')}</Button></section>
  return <div className="grid min-w-0 items-start gap-6 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
    {people.isError && <div className="col-span-full rounded-xl border border-border bg-surface p-4"><p role="alert" className="text-sm text-destructive-text">{t('assets.uniform.refreshRecordsError')}</p><Button type="button" variant="ghost" className="min-h-11" onClick={() => void people.refetch()}>{t('assets.uniform.retry')}</Button></div>}
    <section aria-labelledby="uniform-received-h" className={cn('min-w-0 overflow-hidden rounded-xl border border-border bg-surface', open && people.data !== undefined && 'max-[999px]:hidden')}>
      <h2 id="uniform-received-h" ref={listHeading} tabIndex={-1} className="sr-only">{t('assets.uniform.tabReceived')}</h2>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
        <label className="min-w-0 flex-1"><span className="sr-only">{t('assets.uniform.searchLabel')}</span><Input ref={search} type="search" dir="auto" className="min-h-11" placeholder={t('assets.uniform.searchPh')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        {people.data !== undefined && <span className="text-sm text-muted-foreground">{t('assets.uniform.people', { count: records.length })}</span>}
      </div>
      {people.data === undefined ? <div aria-busy="true" className="p-4"><p role="status" className="mb-3 text-sm text-muted-foreground">{t('assets.uniform.loading')}</p>{[0, 1, 2].map(row => <Skeleton key={row} className="mb-3 h-16 w-full" />)}</div>
        : records.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{t(people.data.length ? 'assets.uniform.noMatch' : 'assets.uniform.receivedNone')}</p>
        : <>
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_auto_auto] gap-5 px-4 pb-2 pt-3 text-xs text-muted-foreground min-[1200px]:grid"><span>{t('assets.uniform.colEmployee')}</span><span>{t('assets.uniform.received.held')}</span><span>{t('assets.uniform.colLast')}</span></div>
          <ol className="divide-y divide-hairline">{records.map(person => <li key={person.employee_id}>
            <button type="button" data-person-card={person.employee_id} ref={node => { if (node) cards.current.set(person.employee_id, node); else cards.current.delete(person.employee_id) }} aria-current={selected?.employee_id === person.employee_id ? 'true' : undefined}
              onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.set('person', person.employee_id); return next })}
              className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 px-4 py-4 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-primary-soft min-[1200px]:grid-cols-[minmax(0,1fr)_auto_auto]">
              <span className="min-w-0"><span dir="auto" className="block break-words font-semibold">{pickEmployeeName(person, i18n.language)}</span><bdi dir="ltr" className="text-xs text-muted-foreground">{person.employee_id}</bdi></span>
              <span className="text-end text-sm font-semibold tabular-nums">{t('assets.uniform.received.heldCount', { count: person.held_total })}</span>
              <span className="col-span-full text-xs text-muted-foreground min-[1200px]:col-span-1 min-[1200px]:text-end"><span className="min-[1200px]:sr-only">{t('assets.uniform.colLast')}: </span><bdi dir="ltr">{formatDmy(person.last_issued_on)}</bdi></span>
            </button>
          </li>)}</ol>
        </>}
    </section>
    {people.data !== undefined && (selected ? <PersonPanel key={selected.employee_id} person={selected} headingRef={heading} onBack={back} onDraftOpenChange={draftOpenChange} className={cn('min-[1000px]:sticky min-[1000px]:top-4 min-[1000px]:max-h-[calc(100dvh-32px)] min-[1000px]:overflow-y-auto', !open && 'max-[999px]:hidden')} />
      : open && <section className="rounded-xl border border-border bg-surface p-4"><Button type="button" variant="secondary" className="mb-3 min-h-11" onClick={back}>{t('assets.uniform.back')}</Button><h2 ref={heading} tabIndex={-1} className="text-sm outline-none">{t('assets.uniform.received.personUnavailable')}</h2></section>)}
  </div>
}
