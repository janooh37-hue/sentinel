/**
 * LedgerThread — the full email conversation for an entry: a collapsible
 * section listing every message oldest-first, with the currently-open entry
 * marked so you keep your place while hopping between siblings.
 *
 * Extracted verbatim from LedgerEntryDrawer (thread query + conversation
 * splice + expand/collapse section) so both the drawer and the Phase-5 reading
 * pane share one implementation. Renders nothing for non-email entries or when
 * there are no sibling messages.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  MessagesSquare,
} from 'lucide-react'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'

import { api } from '@/lib/api'
import type { LedgerEntryRead, LedgerListItem } from '@/lib/api'

const DIRECTION_META: Record<
  string,
  { icon: typeof ArrowDownLeft; tone: string }
> = {
  incoming: { icon: ArrowDownLeft, tone: 'bg-success-soft text-success' },
  outgoing: { icon: ArrowUpRight, tone: 'bg-accent-soft text-accent' },
  internal: { icon: ArrowLeftRight, tone: 'bg-primary-soft text-primary' },
}

interface LedgerThreadProps {
  entryId: number
  entry: LedgerEntryRead
  onOpenEntry?: (id: number) => void
}

export function LedgerThread({
  entryId,
  entry,
  onOpenEntry,
}: LedgerThreadProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const isEmail = entry.channel === 'email'
  const [threadExpanded, setThreadExpanded] = useState(false)

  const threadQuery = useQuery({
    queryKey: ['ledger-thread', entryId],
    queryFn: () => api.listLedgerThread(entryId),
    enabled: isEmail,
  })
  const threadItems: LedgerListItem[] = useMemo(
    () => threadQuery.data ?? [],
    [threadQuery.data],
  )

  // Full conversation = the sibling thread entries + the currently-open entry,
  // sorted oldest-first. The API excludes the seed entry, so we splice it back
  // in with an `isCurrent` flag — otherwise hopping between siblings loses the
  // "you are here" marker and the count understates the conversation by one.
  const conversation = useMemo(() => {
    const rows = threadItems.map((it) => ({
      id: it.id,
      subject: it.subject,
      direction: it.direction,
      entry_date: it.entry_date,
      isCurrent: false,
    }))
    rows.push({
      id: entry.id,
      subject: entry.subject,
      direction: entry.direction,
      entry_date: entry.entry_date,
      isCurrent: true,
    })
    rows.sort(
      (a, b) => a.entry_date.localeCompare(b.entry_date) || a.id - b.id,
    )
    return rows
  }, [entry, threadItems])

  if (!isEmail || threadItems.length === 0) return null

  return (
    <div className="overflow-hidden rounded-2xl bg-surface">
      <button
        type="button"
        onClick={() => setThreadExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-start hover:bg-surface-tinted"
        aria-expanded={threadExpanded}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessagesSquare className="h-4 w-4 text-primary" strokeWidth={1.7} />
          {t('ledger.thread.label')}
          <span className="rounded-full bg-primary-soft px-2 py-0.5 font-mono text-[11px] text-primary">
            {conversation.length}
          </span>
        </span>
        {threadExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {threadExpanded && (
        <ul className="border-t border-hairline">
          {conversation.map((it) => {
            const dateLabel = format(
              new Date(it.entry_date + 'T00:00:00'),
              'dd MMM yyyy',
              isAr ? { locale: arLocale } : undefined,
            )
            const itemMeta =
              DIRECTION_META[it.direction] ?? DIRECTION_META.incoming
            const ItemIcon = itemMeta.icon
            const rowInner = (
              <>
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${itemMeta.tone}`}
                >
                  <ItemIcon className="h-3 w-3" strokeWidth={2} />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-sm text-foreground ${it.isCurrent ? 'font-semibold' : ''}`}
                  dir="auto"
                >
                  {it.subject}
                </span>
                {it.isCurrent && (
                  <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">
                    {t('ledger.thread.current', { defaultValue: 'Viewing' })}
                  </span>
                )}
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {dateLabel}
                </span>
              </>
            )
            return (
              <li key={it.id} className="border-b border-hairline last:border-b-0">
                {it.isCurrent ? (
                  <div
                    aria-current="true"
                    className="flex w-full items-center gap-3 bg-primary-soft px-4 py-2.5 text-start"
                  >
                    {rowInner}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenEntry?.(it.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-start hover:bg-surface-tinted"
                  >
                    {rowInner}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
