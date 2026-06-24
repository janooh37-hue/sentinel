/**
 * LedgerSearchBar — FTS5-powered full-text search box at the top of the ledger.
 *
 * Controlled input bound to a debounced (300 ms) query string. Empty query
 * means "no search" — the parent falls back to the standard filtered list.
 * Non-empty query runs `api.searchLedger` and hands the resulting hits back so
 * the parent can render them in the timeline with snippet highlighting.
 *
 * Ctrl+K (wired in Phase 11) focuses this input via `useShortcutAction`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerSearchResponse } from '@/lib/api'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'

interface LedgerSearchBarProps {
  /** Current search input value. Lifted to the parent so the page can decide
   * between the search timeline and the filtered timeline. */
  value: string
  onChange: (next: string) => void
  /** Called with the latest search response (or null when the input is empty
   * / still debouncing). Lets the parent swap timelines. */
  onResults: (response: LedgerSearchResponse | null, isPending: boolean) => void
  /** Phase 6: admin-only scope gate. 'all' = whole-office search;
   * omit / 'mine' = private (own mail only). */
  scope?: 'mine' | 'all'
}

const DEBOUNCE_MS = 300

export function LedgerSearchBar({
  value,
  onChange,
  onResults,
  scope,
}: LedgerSearchBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [debounced, setDebounced] = useState(value)

  useShortcutAction(
    'focusSearch',
    useCallback(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, []),
  )

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [value])

  const query = useQuery({
    queryKey: ['ledger-search', debounced, scope],
    queryFn: () => api.searchLedger(debounced, 50, scope),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  })

  // Bubble results / pending state up to the page. We do this in an effect so
  // the parent re-renders with the new data, never with stale references.
  useEffect(() => {
    if (debounced.trim().length === 0) {
      onResults(null, false)
      return
    }
    onResults(query.data ?? null, query.isPending || query.isFetching)
  }, [debounced, query.data, query.isPending, query.isFetching, onResults])

  return (
    <div className="relative flex w-full items-center">
      <Search
        className="pointer-events-none absolute start-3 h-3.5 w-3.5 text-faint"
        strokeWidth={1.7}
      />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label={t('ledger.search.placeholder')}
        placeholder={t('ledger.search.placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-lg bg-surface-tinted ps-9 pe-8 text-[0.82em] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={t('common.close')}
          className="absolute end-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" strokeWidth={1.7} />
        </button>
      )}
    </div>
  )
}
