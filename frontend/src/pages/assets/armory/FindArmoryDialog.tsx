import { Search, X } from 'lucide-react'
import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ArmoryFindFilters, ArmoryFindRead } from '@/lib/api'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { normalizeDigits } from '@/lib/utils'

import { Ltr } from './ArmoryLtr'
import { serialStateKey, useArmoryLocale } from './armoryFormat'
import { useArmoryAccess, useArmoryFind } from './armoryQueries'
import { ARMORY_DETAIL_KEYS, patchArmoryParams, type ArmoryTab } from './armoryUrl'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  safeId: number | null
  onReturn: (assignmentId: number, kind: 'shift' | 'custody') => void
  onReceiveSerial: (code: string) => void
  returnFocusRef: RefObject<HTMLElement | null>
}

type Holder = ArmoryFindRead['custody'][number]['holder']
type Destination = { tab: ArmoryTab } & Partial<Record<(typeof ARMORY_DETAIL_KEYS)[number], string | number>>
const clearDetails = Object.fromEntries(ARMORY_DETAIL_KEYS.map(key => [key, null]))
const maxQueryLength = 120
const serialCodePattern = /^[A-Z0-9][A-Z0-9._/-]{0,79}$/
const queryMarker = '\uFFFC'

export function FindArmoryDialog(props: Props): React.JSX.Element | null {
  const { canView, canEdit, isLoading, principal } = useArmoryAccess()
  const { t } = useArmoryLocale()
  const inputRef = useRef<HTMLInputElement>(null)

  if (isLoading || !canView || principal === null) return null

  return <DialogRoot open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent returnFocusRef={props.returnFocusRef}
      className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[700px]"
      onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus() }}>
      <DialogHeader className="pe-16">
        <DialogTitle className="text-xl">{t('assets.armory.findArmory')}</DialogTitle>
        <DialogDescription className="text-sm">{t('assets.armory.findHint')}</DialogDescription>
      </DialogHeader>
      <FinderBody key={principal} {...props} canEdit={canEdit} inputRef={inputRef} />
    </DialogContent>
  </DialogRoot>
}

function FinderBody({ open, onOpenChange, safeId, canEdit, onReturn, onReceiveSerial, inputRef }:
  Omit<Props, 'returnFocusRef'> & { canEdit: boolean; inputRef: RefObject<HTMLInputElement | null> }) {
  const { t, name } = useArmoryLocale()
  const [, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const resultsId = useId()
  const resultsRef = useRef<HTMLDivElement>(null)
  const query = search.trim().slice(0, maxQueryLength).trimEnd()
  const debounced = useDebouncedValue(query, 250)
  const waiting = !!query && query !== debounced
  const filters: ArmoryFindFilters = query ? { q: debounced } : safeId === null ? {} : { recent_safe_id: safeId }
  const results = useArmoryFind(filters, open && !waiting)
  const data = !waiting && !results.isError ? results.data : undefined
  const serials = data?.serials ?? []
  const people = query ? data?.guards ?? [] : []
  const items = query ? data?.items ?? [] : []
  const assignments = query ? data?.custody ?? [] : []
  const postings = query ? data?.postings ?? [] : []
  const empty = !!data && !(serials.length || people.length || items.length || assignments.length || postings.length)
  const candidate = canEdit && empty && query ? normalizeDigits(query).toUpperCase() : ''

  function show(destination: Destination) {
    setSearchParams(previous => patchArmoryParams(previous, { ...clearDetails, ...destination }))
    onOpenChange(false)
  }

  function returnAssignment(assignmentId: number, kind: 'shift' | 'custody') {
    onOpenChange(false)
    onReturn(assignmentId, kind)
  }

  function onFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || (event.key !== 'ArrowDown' && event.key !== 'Enter')) return
    const first = resultsRef.current?.querySelector<HTMLButtonElement>('[data-find-result]')
    if (!first) return
    event.preventDefault()
    if (event.key === 'Enter' && query) first.click()
    else first.focus()
  }

  function onResultsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || !(event.target instanceof Element)) return
    // Return is a separate Tab stop, not a separate search result.
    const result = event.target.closest('li')?.querySelector<HTMLButtonElement>('[data-find-result]')
    if (!result) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-find-result]'))
    const index = buttons.indexOf(result)
    event.preventDefault()
    switch (event.key) {
      case 'ArrowUp':
        if (index === 0) inputRef.current?.focus()
        else buttons[index - 1]?.focus()
        break
      case 'ArrowDown': buttons[index + 1]?.focus(); break
      case 'Home': buttons[0]?.focus(); break
      case 'End': buttons.at(-1)?.focus(); break
    }
  }

  function holderName(holder: Holder | null) {
    const label = holder?.kind === 'site' ? holder.site_safe : holder?.employee
    return label ? <bdi>{name(label)}</bdi> : null
  }

  const viewRecord = t('assets.armory.viewRecord')
  const returnLabel = t('assets.armory.signin')
  const [beforeQuery, afterQuery] = empty && query
    ? t('assets.armory.nothingFound', { query: queryMarker }).split(queryMarker)
    : []

  return <>
    <div className="flex-none px-4 pt-4 pb-2">
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-input bg-surface ps-3 pe-1 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Input ref={inputRef} type="search" dir="auto" value={search} maxLength={maxQueryLength} autoComplete="off"
          aria-label={t('assets.armory.findPlaceholder')} aria-controls={resultsId} placeholder={t('assets.armory.findPlaceholder')}
          className="min-h-11 min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 focus-visible:outline-none! focus-visible:ring-0! focus-visible:ring-offset-0! [&::-webkit-search-cancel-button]:appearance-none"
          onChange={event => setSearch(event.target.value)} onKeyDown={onFieldKeyDown} />
        {search && <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11 shrink-0"
          aria-label={t('assets.armory.clearSearch')} onClick={() => { setSearch(''); inputRef.current?.focus() }}>
          <X aria-hidden className="size-4" />
        </Button>}
      </div>
    </div>

    <div id={resultsId} ref={resultsRef} aria-live="polite"
      className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-4 pt-1 pb-4" onKeyDown={onResultsKeyDown}>
      {(waiting || results.isPending) && <p className="py-2 text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
      {!waiting && results.isError && <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-destructive-text">{t('assets.armory.loadFailed')}</p>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => void results.refetch()}>{t('assets.armory.retry')}</Button>
      </div>}
      {empty && <div className="space-y-2">
        <p className="py-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {query ? <>{beforeQuery}<bdi>{query}</bdi>{afterQuery}</> : t('assets.armory.nothingHere')}
        </p>
        {serialCodePattern.test(candidate) && <Button type="button" variant="secondary" className="min-h-11 whitespace-normal" onClick={() => {
          onOpenChange(false)
          onReceiveSerial(candidate)
        }}>{t('assets.armory.receiveUnknownSerial')}</Button>}
      </div>}
      {serials.length > 0 && <FindGroup title={t(query ? 'assets.armory.findSerials' : 'assets.armory.recentSerials')}>
        {serials.map(serial => {
          const kind = serial.state === 'signed_out' ? 'shift' : serial.state === 'in_custody' ? 'custody' : null
          const assignmentId = serial.assignment_id
          return <FindResult key={serial.id} title={<><Ltr className="font-mono">{serial.serial_code}</Ltr><bdi>{name(serial.item)}</bdi></>}
            meta={<>
              {serial.state && <span>{t(serialStateKey(serial.state))}</span>}
              {serial.safe && <bdi>{name(serial.safe)}</bdi>}
              {holderName(serial.holder)}
            </>}
            openLabel={viewRecord} onOpen={() => show({ tab: 'items', item: serial.item.id, serial: serial.id })}
            returnLabel={returnLabel} onReturn={canEdit && kind && assignmentId !== null ? () => returnAssignment(assignmentId, kind) : undefined} />
        })}
      </FindGroup>}
      {people.length > 0 && <FindGroup title={t('assets.armory.findPeople')}>
        {people.map(person => <FindResult key={person.employee_id} title={<><bdi>{name(person)}</bdi><Ltr>{person.employee_id}</Ltr></>}
          openLabel={viewRecord} onOpen={() => show({ tab: 'guards', guard: person.employee_id })} />)}
      </FindGroup>}
      {items.length > 0 && <FindGroup title={t('assets.armory.findItems')}>
        {items.map(item => <FindResult key={item.id} title={<bdi>{name(item)}</bdi>}
          openLabel={t('assets.armory.openItem')} onOpen={() => show({ tab: 'items', item: item.id })} />)}
      </FindGroup>}
      {assignments.length > 0 && <FindGroup title={t('assets.armory.custody')}>
        {assignments.map(assignment => <FindResult key={assignment.id} title={<Ltr>{assignment.record_ref}</Ltr>} meta={holderName(assignment.holder)}
          openLabel={viewRecord} onOpen={() => show(assignment.kind === 'shift'
            ? { tab: 'shift', issue: assignment.id }
            : { tab: 'custody', custody: assignment.id })}
          returnLabel={returnLabel} onReturn={canEdit && assignment.state === 'active' ? () => returnAssignment(assignment.id, assignment.kind) : undefined} />)}
      </FindGroup>}
      {postings.length > 0 && <FindGroup title={t('assets.armory.findRecords')}>
        {postings.map(posting => <FindResult key={posting.id} title={<Ltr>{posting.record_ref}</Ltr>} meta={t(`assets.armory.postingKind.${posting.kind}`)}
          openLabel={viewRecord} onOpen={() => show({ tab: 'audit', pane: 'movements', movement: posting.id })} />)}
      </FindGroup>}
    </div>
  </>
}

function FindGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return <section aria-labelledby={headingId}>
    <h3 id={headingId} className="px-2 pb-1 text-sm font-semibold text-muted-foreground">{title}</h3>
    <ul>{children}</ul>
  </section>
}

function FindResult({ title, meta, openLabel, onOpen, returnLabel, onReturn }: {
  title: ReactNode
  meta?: ReactNode
  openLabel: string
  onOpen: () => void
  returnLabel?: string
  onReturn?: () => void
}) {
  const titleId = useId()
  return <li className="flex items-center gap-2 border-b border-hairline">
    <button type="button" data-find-result onClick={onOpen}
      className="flex min-h-[52px] min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-2 text-start hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span id={titleId} className="flex flex-wrap gap-x-2 text-sm font-semibold">{title}</span>
        {meta && <span className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">{meta}</span>}
      </span>
      <span className="text-sm font-medium text-primary-text">{openLabel}</span>
    </button>
    {onReturn && <Button type="button" variant="secondary" className="min-h-11" aria-describedby={titleId} onClick={onReturn}>{returnLabel}</Button>}
  </li>
}
