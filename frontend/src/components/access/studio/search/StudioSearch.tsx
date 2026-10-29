import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Search } from 'lucide-react'
import type { AdminUserRead } from '@/lib/api'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { normalizeSearchText } from '@/lib/recipientMatch'
import type { ResourceSearchProps, StudioDestination } from '../contracts'
import { accountSearchIndex, resourceSearchIndex, searchEntries, type SearchEntry } from './searchIndex'

export type StudioSearchProps = ({ mode?: 'resources' } & ResourceSearchProps) | {
  mode: 'accounts'
  accounts: AdminUserRead[]
  query?: string
  onQueryChange?: (query: string) => void
  onNavigate: (destination: StudioDestination) => void
}

/** Manual-selection combobox: discovery can navigate, never change authorization. */
export function StudioSearch(props: StudioSearchProps): React.JSX.Element {
  return <ScopedSearch key={props.mode === 'accounts' ? 'accounts' : props.subjectId ?? 'resources'} {...props} />
}

function ScopedSearch(props: StudioSearchProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const publishedMatches = useRef<string | null>(null)
  const id = useId()
  const [localQuery, setLocalQuery] = useState('')
  const query = props.mode === 'accounts' ? props.query ?? localQuery : localQuery
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const arabic = i18n.language.startsWith('ar')
  const entries = useMemo(() => props.mode === 'accounts'
    ? accountSearchIndex(props.accounts, arabic)
    : resourceSearchIndex(props, arabic, (action) => ['en', 'ar'].map((lng) => t(`access.studio.search.actions.${action}`, { lng }))), [props, arabic, t])
  const matches = useMemo(() => searchEntries(entries, query), [entries, query])
  const options = useMemo(() => matches.flatMap((match) => match.actions ?? [match.entry]), [matches])
  const activeIndex = options.findIndex((entry) => entry.key === active)
  const expanded = open && query.trim().length > 0
  const label = t(props.mode === 'accounts' ? 'access.studio.search.accounts' : 'access.studio.search.resources')
  const onMatchesChange = props.mode === 'accounts' ? undefined : props.onMatchesChange

  useEffect(() => {
    if (!onMatchesChange) return
    const resources = matches.flatMap(({ entry }) => entry.destination.resource ? [entry.destination.resource] : [])
    // Parent state updates recreate props; publish only a changed resource set.
    const signature = JSON.stringify(resources)
    if (publishedMatches.current === signature) return
    publishedMatches.current = signature
    onMatchesChange(resources)
  }, [matches, onMatchesChange])

  useEffect(() => {
    if (expanded && activeIndex >= 0 && active) document.getElementById(`${id}-option-${encodeURIComponent(active)}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, activeIndex, expanded, id])

  useShortcutAction('focusSearch', () => {
    const field = input.current
    if (!field || field.closest('[hidden], [inert], [aria-hidden="true"]') || field.getClientRects().length === 0) return false
    field.focus()
    setOpen(true)
  })

  function navigate(entry: SearchEntry): void {
    // Resolve the exact selected ID against current metadata; never substitute a nearby match.
    const current = entries.flatMap((candidate) => candidate.actions ?? [candidate]).find((candidate) => candidate.key === entry.key)
    if (!current) { setUnavailable(true); return }
    setOpen(false)
    setUnavailable(false)
    props.onNavigate(current.destination)
  }

  return <div ref={root} className="relative min-w-0 w-full" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-ring">
    <Search aria-hidden="true" className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-keyshortcuts="Control+K Meta+K"
      aria-controls={`${id}-results`} aria-activedescendant={expanded && activeIndex >= 0 && active ? `${id}-option-${encodeURIComponent(active)}` : undefined}
      dir="auto" autoComplete="off" value={query} placeholder={label}
      className="min-h-11 w-full min-w-0 flex-1 bg-transparent py-2 text-foreground placeholder:text-muted-foreground"
      style={{ outline: 'none' }}
      onFocus={() => setOpen(true)} onChange={(event) => {
        const next = event.target.value
        if (props.mode === 'accounts') {
          if (props.query === undefined) setLocalQuery(next)
          props.onQueryChange?.(next)
        } else setLocalQuery(next)
        setActive(null); setUnavailable(false); setOpen(true)
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true)
          setUnavailable(false)
          if (options.length) {
            const next = activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            setActive(options[next].key)
          }
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (expanded && active) {
            const entry = options.find((candidate) => candidate.key === active)
            if (entry) navigate(entry)
            else setUnavailable(true)
          }
        }
      }} />
    {props.mode !== 'accounts' && <kbd dir="ltr" aria-hidden="true" className="pointer-events-none hidden shrink-0 rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground sm:block">
      {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ + K' : 'Ctrl + K'}
    </kbd>}
    </div>
    {expanded && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[50dvh] overflow-y-auto rounded-lg border border-border bg-surface">
      <ul id={`${id}-results`} role="listbox" aria-label={label}>
        {matches.map(({ entry, suggestion, actions }) => {
          const exactIdentifiers = props.mode === 'accounts' ? [...new Set(entry.identifiers.filter(Boolean))]
            : entry.identifiers.filter((identifier) => normalizeSearchText(identifier) === normalizeSearchText(query))
          if (actions) {
            const headingId = `${id}-resource-${encodeURIComponent(entry.key)}`
            return <li key={entry.key} role="presentation" className="border-b border-border px-3 py-2 last:border-b-0">
              <div role="group" aria-labelledby={headingId}>
                <div id={headingId} className="flex flex-wrap items-center gap-x-1 text-sm [overflow-wrap:anywhere]">
                  <span className="text-muted-foreground">{t(`access.studio.groups.${entry.groupId}`, { defaultValue: t('access.studio.groups.other') })}</span>{' '}
                  <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground rtl:rotate-180" />
                  <bdi className="font-medium">{entry.label}</bdi>
                </div>
                {exactIdentifiers.length > 0 && <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {exactIdentifiers.map((identifier) => <bdi key={identifier} dir="ltr">{identifier}</bdi>)}
                </div>}
                <div className="flex flex-wrap gap-x-2">
                  {actions.map((action) => <div key={action.key} id={`${id}-option-${encodeURIComponent(action.key)}`}
                    role="option" aria-selected={active === action.key}
                    aria-label={`${entry.label} · ${t(`access.studio.search.actions.${action.destination.action}`)}`}
                    className="flex min-h-11 min-w-11 cursor-pointer items-center"
                    onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(action)}>
                    <span className={`rounded-md border px-2 py-1 text-xs font-medium ${active === action.key ? 'border-primary bg-primary-soft text-primary' : 'border-border text-foreground hover:bg-surface-tinted'}`}>
                      {t(`access.studio.search.actions.${action.destination.action}`)}
                    </span>
                  </div>)}
                </div>
                {suggestion && <span className="text-sm text-muted-foreground">{t('access.studio.search.suggestion')}</span>}
              </div>
            </li>
          }
          return <li key={entry.key} id={`${id}-option-${encodeURIComponent(entry.key)}`} role="option" aria-selected={active === entry.key}
            className={`min-h-11 cursor-pointer px-3 py-3 text-start [overflow-wrap:anywhere] ${active === entry.key ? 'bg-primary-soft' : 'hover:bg-surface-tinted'}`}
            onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(entry)}>
            <div className="font-medium"><bdi>{entry.label}</bdi></div>
            {entry.alternateLabel && <div className="text-sm text-muted-foreground"><bdi>{entry.alternateLabel}</bdi></div>}
            <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">{exactIdentifiers.map((identifier) => <bdi key={identifier} dir="ltr">{identifier}</bdi>)}</div>
            {suggestion && <span className="text-sm text-muted-foreground">{t('access.studio.search.suggestion')}</span>}
          </li>
        })}
      </ul>
      {matches.length === 0 && <p className="px-3 py-3 text-muted-foreground">{t('access.studio.search.noMatches')}</p>}
    </div>}
    <p role="status" aria-live="polite" className="sr-only">{expanded ? t('access.studio.search.resultCount', { count: matches.length, formattedCount: String(matches.length) }) : ''}</p>
    {unavailable && <p role="alert" className="mt-2 text-accent">{t('access.studio.search.unavailable')}</p>}
  </div>
}
