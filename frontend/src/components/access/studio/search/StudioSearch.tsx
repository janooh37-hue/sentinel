import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdminUserRead } from '@/lib/api'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import type { ResourceSearchProps, StudioDestination } from '../contracts'
import { accountSearchIndex, resourceSearchIndex, searchEntries, type SearchEntry } from './searchIndex'

export type StudioSearchProps = ({ mode?: 'resources' } & ResourceSearchProps) | {
  mode: 'accounts'
  accounts: AdminUserRead[]
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
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const arabic = i18n.language.startsWith('ar')
  const entries = useMemo(() => props.mode === 'accounts'
    ? accountSearchIndex(props.accounts, arabic)
    : resourceSearchIndex(props, arabic, (action) => ['en', 'ar'].map((lng) => t(`access.studio.search.actions.${action}`, { lng }))), [props, arabic, t])
  const matches = useMemo(() => searchEntries(entries, query), [entries, query])
  const activeIndex = matches.findIndex(({ entry }) => entry.key === active)
  const expanded = open && query.trim().length > 0
  const label = t(props.mode === 'accounts' ? 'access.studio.search.accounts' : 'access.studio.search.resources')

  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, expanded, id])

  useShortcutAction('focusSearch', () => {
    const field = input.current
    if (!field || field.closest('[hidden], [inert], [aria-hidden="true"]') || field.getClientRects().length === 0) return false
    field.focus()
    setOpen(true)
  })

  function navigate(entry: SearchEntry): void {
    // Resolve the exact selected ID against current metadata; never substitute a nearby match.
    const current = entries.find((candidate) => candidate.key === entry.key)
    if (!current) { setUnavailable(true); return }
    setOpen(false)
    props.onNavigate(current.destination)
  }

  return <div ref={root} className="relative min-w-0 w-full" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <label htmlFor={id} className="sr-only">{label}</label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded}
      aria-controls={`${id}-results`} aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
      dir="auto" autoComplete="off" value={query} placeholder={label}
      className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(null); setUnavailable(false); setOpen(true) }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
        if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true)
          if (matches.length) {
            const next = activeIndex < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
              : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
            setActive(matches[next].entry.key)
          }
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          if (expanded && active) {
            const entry = entries.find((candidate) => candidate.key === active)
            if (entry && matches.some((match) => match.entry.key === active)) navigate(entry)
            else setUnavailable(true)
          }
        }
      }} />
    {expanded && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[50dvh] overflow-y-auto rounded-lg border border-border bg-surface">
      <ul id={`${id}-results`} role="listbox" aria-label={label}>
        {matches.map(({ entry, suggestion }, index) => <li key={entry.key} id={`${id}-option-${index}`} role="option" aria-selected={active === entry.key}
          className={`min-h-11 cursor-pointer px-3 py-3 text-start [overflow-wrap:anywhere] ${active === entry.key ? 'bg-primary-soft' : 'hover:bg-surface-tinted'}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => navigate(entry)}>
          <div className="font-medium"><bdi>{entry.label}</bdi></div>
          {entry.destination.action && <div className="text-sm">{t(`access.studio.search.actions.${entry.destination.action}`)}</div>}
          {entry.alternateLabel && <div className="text-sm text-muted-foreground"><bdi>{entry.alternateLabel}</bdi></div>}
          <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">{[...new Set(entry.identifiers.filter(Boolean))].map((identifier) => <bdi key={identifier} dir="ltr">{identifier}</bdi>)}</div>
          {suggestion && <span className="text-sm text-muted-foreground">{t('access.studio.search.suggestion')}</span>}
        </li>)}
      </ul>
      {matches.length === 0 && <p className="px-3 py-3 text-muted-foreground">{t('access.studio.search.noMatches')}</p>}
    </div>}
    <p role="status" aria-live="polite" className="sr-only">{expanded ? t('access.studio.search.resultCount', { count: matches.length, formattedCount: String(matches.length) }) : ''}</p>
    {unavailable && <p role="alert" className="mt-2 text-accent">{t('access.studio.search.unavailable')}</p>}
  </div>
}
