/**
 * MessageList — the middle pane of the Ledger Outlook shell (Phase 4, Task 5;
 * Phase 2 message-list upgrades 2026-06-25).
 *
 * Composes the prototype's `.mlist`:
 *   [search bar] → [All/Unread tabs] → [quick filters] → [selection bar?] →
 *   date-banded rows (singles + collapsed threads).
 *
 * Presentational: the shell owns the per-folder query (incl. quick-filter
 * params) and hands the resolved `items` + `isLoading` + `view` down. This
 * component owns: the All/Unread tab filter, the By-Date banding, the quick-
 * filter bar (D1), the per-session thread-collapse toggle (D2), multi-select
 * (D4), and the flag UI on rows (D3b). Rows are `MessageListRow`.
 *
 * Ledger CHROME — `[data-ledger-chrome] dir="ltr"`, never mirrors in Arabic.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, ChevronRight, Layers } from 'lucide-react'

import { LedgerSearchBar } from '../LedgerSearchBar'
import { MessageListRow } from './MessageListRow'
import { SyncStatusStrip } from './SyncStatusStrip'
import { FilterBar } from './FilterBar'
import { SelectionBar } from './SelectionBar'
import { groupThreads, type ThreadRow } from './threadGrouping'
import type { MailboxView } from './mailboxTypes'
import type { QuickFilters } from './mailboxQuery'
import type {
  EmailSyncStatus,
  LedgerListItem,
  LedgerSearchResponse,
} from '@/lib/api'
import { cn } from '@/lib/utils'

export type MessageListTab = 'all' | 'unread'

interface MessageListProps {
  view: MailboxView
  /** Personal-folder rows. */
  items: LedgerListItem[]
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
  /** Phase 2 (D1) — quick-filter chip state + setter (shell-owned so the fetch
   * re-runs with the right params). */
  filters: QuickFilters
  onFiltersChange: (next: QuickFilters) => void
  /** Whether an employee G-number is in context (enables "This employee"). */
  employeeInContext: boolean
  /** Phase 2 (D4) — bulk Trash, deferred so each entry gets the Undo toast. */
  onBulkTrash?: (ids: number[]) => void
  /** Phase 3 — a calm suggestion banner rendered above the list scroll area. */
  banner?: React.ReactNode
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
  filters,
  onFiltersChange,
  employeeInContext,
  onBulkTrash,
  banner,
}: MessageListProps): React.JSX.Element {
  const { t, i18n } = useTranslation()

  // Per-session thread-collapse toggle (D2). Default ON; resets each session.
  const [grouping, setGrouping] = useState(true)
  // Per-session expanded threads (by group key).
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set())
  // Multi-select set (D4). Cleared on Esc / ✕ / a successful bulk action.
  const [selected, setSelected] = useState<Set<number>>(() => new Set())

  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }),
    [i18n.language],
  )

  // Tab filter (Unread = read_at == null) → newest-first → date bands.
  const bands = useMemo(() => {
    const filtered = tab === 'unread' ? items.filter((it) => it.read_at == null) : items
    return groupIntoBands(filtered, t, monthFmt, tsOf)
  }, [items, tab, t, monthFmt])

  // Effective selection = stored ids that are still in the current page. We
  // derive (not prune-on-effect) so a folder switch / refetch silently drops
  // vanished ids without a setState-in-effect. The stored `selected` may keep
  // stale ids; they're filtered out everywhere they're read.
  const presentIds = useMemo(() => new Set(items.map((it) => it.id)), [items])
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((id) => presentIds.has(id))),
    [selected, presentIds],
  )

  // Esc clears the selection while any rows are picked.
  useEffect(() => {
    if (effectiveSelected.size === 0) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveSelected.size])

  const selecting = effectiveSelected.size > 0
  const isEmpty = !isLoading && bands.length === 0

  const toggleSelect = (id: number): void => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const clearSelection = (): void => setSelected(new Set())
  const toggleThread = (key: string): void => {
    setOpenThreads((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
        <span className="ms-auto flex items-center gap-2">
          {/* Thread-collapse toggle (per session). */}
          <button
            type="button"
            onClick={() => setGrouping((g) => !g)}
            aria-pressed={grouping}
            title={t('ledger.thread.toggle')}
            className={cn(
              'mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              grouping
                ? 'bg-info-soft text-info'
                : 'text-faint hover:bg-surface-tinted hover:text-foreground',
            )}
          >
            <Layers className="h-3 w-3" strokeWidth={1.8} aria-hidden />
            {t('ledger.thread.label')}
          </button>
          <span className="flex items-center gap-1 pb-2 text-[0.72em] text-faint">
            {t('ledger.outlook.sortDate')}
            <ArrowUp className="h-3 w-3" strokeWidth={1.7} aria-hidden />
          </span>
        </span>
      </div>

      {/* Quick filters (D1). */}
      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        employeeInContext={employeeInContext}
      />

      {/* Selection action bar (D4) — only while rows are selected. */}
      {selecting && (
        <SelectionBar
          ids={[...effectiveSelected]}
          onClear={clearSelection}
          onTrash={(ids) => {
            onBulkTrash?.(ids)
            clearSelection()
          }}
        />
      )}

      {/* Phase 3 — calm smart-folder suggestion banner over the list. */}
      {banner}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <ListSkeleton />}

        {isEmpty && (
          <div className="px-5 py-10 text-center text-[0.82em] text-faint">
            {emptyMessage(view, t)}
          </div>
        )}

        {!isLoading &&
          bands.map((band) => {
            const grouped = groupThreads(band.items, grouping)
            return (
              <div key={band.key}>
                <BandHeader bandKey={band.key} label={band.label} />
                {grouped.map((row) =>
                  row.kind === 'thread' ? (
                    <ThreadGroup
                      key={`thread-${row.key}`}
                      row={row}
                      open={openThreads.has(row.key)}
                      onToggleOpen={() => toggleThread(row.key)}
                      selectedId={selectedId}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      selecting={selecting}
                      selected={effectiveSelected}
                      onToggleSelect={toggleSelect}
                    />
                  ) : (
                    <MessageListRow
                      key={row.entry.id}
                      entry={row.entry}
                      selected={selectedId === row.entry.id}
                      onSelect={onSelect}
                      onDelete={onDelete}
                      checked={effectiveSelected.has(row.entry.id)}
                      onToggleSelect={toggleSelect}
                      selecting={selecting}
                    />
                  ),
                )}
              </div>
            )
          })}
      </div>
    </section>
  )
}

/**
 * A collapsed thread head row + (when open) its indented members. The head
 * shows the newest member's sender/subject and a count pill; clicking the chevron
 * expands the members. When selecting, the head's checkbox toggles every member.
 */
interface ThreadGroupProps {
  row: ThreadRow
  open: boolean
  onToggleOpen: () => void
  selectedId: number | null
  onSelect: (id: number) => void
  onDelete?: (entry: LedgerListItem) => void
  selecting: boolean
  selected: Set<number>
  onToggleSelect: (id: number) => void
}

function ThreadGroup({
  row,
  open,
  onToggleOpen,
  selectedId,
  onSelect,
  onDelete,
  selecting,
  selected,
  onToggleSelect,
}: ThreadGroupProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const head = row.head
  const allChecked = row.members.length > 0 && row.members.every((m) => selected.has(m.id))

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: 'short' }),
    [i18n.language],
  )
  const dateLabel = useMemo(() => {
    const raw = head.created_at ?? `${head.entry_date}T00:00:00`
    return dateFmt.format(new Date(raw))
  }, [head.created_at, head.entry_date, dateFmt])

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleOpen()
          }
        }}
        aria-expanded={open}
        className={cn(
          'group grid w-full cursor-pointer items-center gap-2.5 border-b border-hairline px-3.5 py-2.5 text-start transition-colors hover:bg-surface-tinted',
          'grid-cols-[auto_auto_minmax(0,1fr)_auto]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        )}
      >
        <input
          type="checkbox"
          checked={allChecked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => {
            // Toggle the whole thread: if all selected, clear them; else add all.
            row.members.forEach((m) => {
              const has = selected.has(m.id)
              if (allChecked ? has : !has) onToggleSelect(m.id)
            })
          }}
          aria-label={t('ledger.bulk.selectThread')}
          className={cn(
            'h-4 w-4 shrink-0 cursor-pointer accent-info transition-opacity',
            // Hover-reveal when idle (entry point); always shown once selecting.
            selecting || allChecked
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        />
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          strokeWidth={1.8}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="text-[0.86em]">🧵</span>
            <span className="truncate text-[0.86em] font-semibold text-foreground" dir="auto">
              {head.counterparty || '—'}
            </span>
          </span>
          <span className="mt-px block truncate text-[0.86em] leading-snug text-foreground" dir="auto">
            {head.subject}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="whitespace-nowrap text-[0.72em] text-faint">{dateLabel}</span>
          <span
            className="flex-none rounded-full bg-surface-tinted px-[7px] py-[2px] text-[0.66em] font-bold leading-none text-muted-foreground"
            aria-label={t('ledger.thread.count', { count: row.members.length })}
          >
            {row.members.length}
          </span>
        </span>
      </div>

      {open &&
        row.members.map((m) => (
          <MessageListRow
            key={m.id}
            entry={m}
            selected={selectedId === m.id}
            onSelect={onSelect}
            onDelete={onDelete}
            checked={selected.has(m.id)}
            onToggleSelect={onToggleSelect}
            selecting={selecting}
            indent={28}
          />
        ))}
    </div>
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
  if (view.kind === 'followups') return t('ledger.followups.empty')
  if (view.kind === 'smart') return t('ledger.smart.folderEmpty')
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
 * `created_at`/`entry_date`).
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
