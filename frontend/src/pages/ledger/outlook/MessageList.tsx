/**
 * MessageList — the middle pane of the Ledger Outlook shell (Phase 4, Task 5).
 *
 * Composes the prototype's `.mlist`:
 *   [search bar] → [All / Unread tabs + By-Date sort] → date-banded rows.
 *
 * Presentational: the shell (Task 9) owns the per-folder query and hands the
 * resolved `items` + `isLoading` + the active `view` down. This component owns
 * the All/Unread tab filter (by `read_at`), the By-Date newest-first sort, the
 * Today / Last week / month date-banding, loading skeletons, and the empty
 * state. Rows are `MessageListRow`. The FTS search box is the reused
 * `LedgerSearchBar` (the shell wires its results into `items`).
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'

import { LedgerSearchBar } from '../LedgerSearchBar'
import { MessageListRow } from './MessageListRow'
import { LogListRow } from './LogListRow'
import { SyncStatusStrip } from './SyncStatusStrip'
import type { MailboxView } from './mailboxTypes'
import type {
  CorrespondenceLogItem,
  EmailSyncStatus,
  LedgerListItem,
  LedgerSearchResponse,
} from '@/lib/api'
import { cn } from '@/lib/utils'

export type MessageListTab = 'all' | 'unread'

interface MessageListProps {
  view: MailboxView
  /** Personal-folder rows (mail variant). Empty for log views. */
  items: LedgerListItem[]
  /** Correspondence-Log rows (log variant). Empty for personal-folder views. */
  logItems?: CorrespondenceLogItem[]
  isLoading: boolean
  tab: MessageListTab
  onTabChange: (tab: MessageListTab) => void
  selectedId: number | null
  onSelect: (id: number) => void
  /** Optional row delete (hover/focus) — mail rows only. */
  onDelete?: (entry: LedgerListItem) => void
  search: string
  onSearchChange: (next: string) => void
  /** Bubbled FTS results so the shell can swap `items` to the hits. */
  onSearchResults?: (res: LedgerSearchResponse | null, pending: boolean) => void
  /** Live sync state — rendered as a bar pinned to the top of the list. */
  syncStatus?: EmailSyncStatus
  /** Phase 6: admin-only scope; threaded into the search bar so FTS respects
   * the same All-mail gate as the list query. */
  scope?: 'mine' | 'all'
}

/** A band key plus the items that fall in it, in newest-first band order. */
interface Band<T> {
  key: string
  /** i18n label for the well-known bands, or a pre-formatted month label. */
  label: string
  items: T[]
}

const MS_DAY = 86_400_000

export function MessageList({
  view,
  items,
  logItems = [],
  isLoading,
  tab,
  onTabChange,
  selectedId,
  onSelect,
  onDelete,
  search,
  onSearchChange,
  onSearchResults,
  syncStatus,
  scope,
}: MessageListProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  const isLog = view.kind === 'log'

  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }),
    [i18n.language],
  )

  // Tab filter (Unread = read_at == null) → newest-first → date bands.
  const bands = useMemo(() => {
    if (isLog) return []
    const filtered = tab === 'unread' ? items.filter((it) => it.read_at == null) : items
    return groupIntoBands(filtered, t, monthFmt, tsOf)
  }, [isLog, items, tab, t, monthFmt])

  // Log-variant bands (Correspondence-Log category views).
  const logBands = useMemo(() => {
    if (!isLog) return []
    const filtered = tab === 'unread' ? logItems.filter((it) => it.read_at == null) : logItems
    return groupIntoBands(filtered, t, monthFmt, logTsOf)
  }, [isLog, logItems, tab, t, monthFmt])

  const isEmpty = !isLoading && (isLog ? logBands.length === 0 : bands.length === 0)

  return (
    <section
      className="flex min-h-0 flex-col border-e border-border bg-surface"
      aria-label={t('ledger.title')}
    >
      {/* Sync status — pinned to the top of the list where it's actually seen. */}
      <SyncStatusStrip status={syncStatus} />

      <div className="border-b border-border px-3.5 py-2.5">
        <LedgerSearchBar
          value={search}
          onChange={onSearchChange}
          onResults={onSearchResults ?? (() => {})}
          scope={scope}
        />
      </div>

      <div
        role="tablist"
        aria-label={t('ledger.outlook.sortDate')}
        className="flex items-center gap-4 border-b border-border px-3.5 pt-2"
      >
        <Tab tab="all" active={tab} onSelect={onTabChange} label={t('ledger.outlook.tabs.all')} />
        <Tab
          tab="unread"
          active={tab}
          onSelect={onTabChange}
          label={t('ledger.outlook.tabs.unread')}
        />
        <span className="ms-auto flex items-center gap-1 pb-2 text-[0.72em] text-faint">
          {t('ledger.outlook.sortDate')}
          <ArrowUp className="h-3 w-3" strokeWidth={1.7} aria-hidden />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <ListSkeleton />}

        {isEmpty && (
          <div className="px-5 py-10 text-center text-[0.82em] text-faint">
            {emptyMessage(view, t)}
          </div>
        )}

        {/* Personal-folder rows (mail variant). */}
        {!isLoading &&
          !isLog &&
          bands.map((band) => (
            <div key={band.key}>
              <BandHeader bandKey={band.key} label={band.label} />
              {band.items.map((entry) => (
                <MessageListRow
                  key={entry.id}
                  entry={entry}
                  selected={selectedId === entry.id}
                  onSelect={onSelect}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ))}

        {/* Correspondence-Log rows (log variant). */}
        {!isLoading &&
          isLog &&
          logBands.map((band) => (
            <div key={band.key}>
              <BandHeader bandKey={band.key} label={band.label} />
              {band.items.map((entry) => (
                <LogListRow
                  key={entry.id}
                  entry={entry}
                  selected={selectedId === entry.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))}
      </div>
    </section>
  )
}

interface TabProps {
  tab: MessageListTab
  active: MessageListTab
  onSelect: (tab: MessageListTab) => void
  label: string
}

function Tab({ tab, active, onSelect, label }: TabProps): React.JSX.Element {
  const on = tab === active
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={() => onSelect(tab)}
      className={cn(
        'relative pb-2 text-[0.82em] font-semibold transition-colors',
        on
          ? 'text-info after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-sm after:bg-info'
          : 'text-faint hover:text-muted-foreground',
      )}
    >
      {label}
    </button>
  )
}

function ListSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-px p-3.5" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 py-2">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-surface-tinted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-tinted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-surface-tinted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Empty-state message per folder (drafts/trash get a tailored line, everything
 * else falls back to a generic one) — matches the prototype's renderList copy.
 */
function emptyMessage(view: MailboxView, t: (k: string) => string): string {
  if (view.kind === 'folder' && view.folder === 'drafts') return t('ledger.outlook.empty.drafts')
  if (view.kind === 'folder' && view.folder === 'trash') return t('ledger.outlook.empty.trash')
  return t('ledger.outlook.empty.default')
}

/** Sticky date-band header (shared by the mail + log render paths). */
function BandHeader({ bandKey, label }: { bandKey: string; label: string }): React.JSX.Element {
  return (
    <div
      data-band={bandKey}
      className="sticky top-0 z-[1] bg-surface-raised px-3.5 py-1.5 text-[0.6em] font-semibold uppercase tracking-wider text-faint"
    >
      {label}
    </div>
  )
}

/**
 * Bucket items into newest-first date bands: Today, Last week (≤ 7 days), then
 * per-month bands ("April 2026"). Items are sorted newest-first within and
 * across bands. `getTs` extracts the row's timestamp (mail rows use
 * `created_at`/`entry_date`; log rows use `entry_date`).
 */
function groupIntoBands<T>(
  items: T[],
  t: (k: string) => string,
  monthFmt: Intl.DateTimeFormat,
  getTs: (item: T) => number,
): Band<T>[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()

  const sorted = [...items].sort((a, b) => getTs(b) - getTs(a))

  const order: string[] = []
  const map = new Map<string, Band<T>>()

  for (const entry of sorted) {
    const ts = getTs(entry)
    let key: string
    let label: string
    if (ts >= startOfToday) {
      key = 'today'
      label = t('ledger.outlook.bands.today')
    } else if (ts >= startOfToday - 6 * MS_DAY) {
      key = 'lastWeek'
      label = t('ledger.outlook.bands.lastWeek')
    } else {
      const d = new Date(ts)
      key = `${d.getFullYear()}-${d.getMonth()}`
      label = monthFmt.format(d)
    }
    let band = map.get(key)
    if (!band) {
      band = { key, label, items: [] }
      map.set(key, band)
      order.push(key)
    }
    band.items.push(entry)
  }

  return order.map((k) => map.get(k)!)
}

function tsOf(entry: LedgerListItem): number {
  const raw = entry.created_at ?? `${entry.entry_date}T00:00:00`
  return new Date(raw).getTime()
}

function logTsOf(entry: CorrespondenceLogItem): number {
  return new Date(`${entry.entry_date}T00:00:00`).getTime()
}
