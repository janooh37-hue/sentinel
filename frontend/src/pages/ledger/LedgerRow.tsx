/**
 * LedgerRow — T · mail-app style row (TAMM redesign §6.5).
 *
 * Grid:  [44px avatar] [14px dot] [1fr sender/subject] [120px ts] [20px ›]
 *
 * - Avatar: 36×36 round, employee photo when `related_employee_id` resolves;
 *   gradient-initial fallback otherwise.
 * - Dot: 9px solid circle in the direction color (success · accent · primary).
 * - Sender: bold (`--text`).
 * - Subject: muted with `<strong>` lifted to `--text`.
 * - Timestamp: IBM Plex Mono, end-aligned.
 * - Chevron: faint, end of row.
 *
 * Used by `LedgerTimeline` for the chronological list and by anything else
 * that wants the same dense mail-app row. Click handler is supplied by the
 * parent (the parent owns navigation/drawer-open).
 */

import { useMemo } from 'react'
import { ChevronRight, Paperclip, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LedgerListItem } from '@/lib/api'
import { cn } from '@/lib/utils'

const DOT_CLS: Record<string, string> = {
  incoming: 'bg-success',
  outgoing: 'bg-accent',
  internal: 'bg-primary',
}

interface LedgerRowProps {
  entry: LedgerListItem
  onClick: () => void
  /** Optional override — caller can supply a different photo URL.
   * Defaults to `/api/v1/employees/{related_employee_id}/photo` when set. */
  photoUrl?: string
}

export function LedgerRow({ entry, onClick, photoUrl }: LedgerRowProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const dot = DOT_CLS[entry.direction] ?? 'bg-muted-foreground'

  const isStarred = entry.tags.includes('starred')
  const hasAttachments = (entry.attachment_count ?? 0) > 0

  const tsFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [i18n.language],
  )
  const tsLabel = useMemo(() => {
    // `created_at` is an ISO timestamp; fall back to `entry_date` (date only)
    // when the server doesn't carry a fully-qualified instant.
    const raw = entry.created_at ?? `${entry.entry_date}T00:00:00`
    return tsFmt.format(new Date(raw))
  }, [entry.created_at, entry.entry_date, tsFmt])

  const resolvedPhotoUrl =
    photoUrl ??
    (entry.related_employee_id
      ? `/api/v1/employees/${encodeURIComponent(entry.related_employee_id)}/photo`
      : null)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'grid w-full grid-cols-[44px_14px_minmax(0,1fr)_120px_20px] items-center gap-3 border-b border-hairline px-4 py-2.5 text-start transition-colors last:border-b-0 hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
    >
      <Avatar photoUrl={resolvedPhotoUrl} name={entry.counterparty} />
      <span
        className={cn('inline-block h-[9px] w-[9px] shrink-0 rounded-full', dot)}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="truncate text-[0.86em] font-semibold leading-tight text-foreground"
            dir="auto"
          >
            {entry.counterparty || '—'}
          </span>
          {isStarred && (
            <Star
              className="h-3 w-3 shrink-0 text-warning"
              strokeWidth={1.7}
              fill="currentColor"
              aria-hidden
            />
          )}
        </div>
        <div
          className="mt-0.5 truncate text-[0.82em] leading-snug text-muted-foreground"
          dir="auto"
        >
          <strong className="font-medium text-foreground">{entry.subject}</strong>
          {hasAttachments && (
            <span className="ms-2 inline-flex items-center gap-0.5 align-middle">
              <Paperclip className="h-3 w-3" strokeWidth={1.6} aria-hidden />
              <span className="font-mono text-[0.92em]">{entry.attachment_count}</span>
            </span>
          )}
        </div>
      </div>
      <div className="text-end font-mono text-[0.72em] text-muted-foreground">
        {tsLabel}
      </div>
      <ChevronRight aria-hidden className="h-3.5 w-3.5 text-faint rtl:rotate-180" />
    </button>
  )
}

interface AvatarProps {
  photoUrl: string | null
  name: string
}

function Avatar({ photoUrl, name }: AvatarProps): React.JSX.Element {
  // We render BOTH the <img> and the initial-circle, and swap visibility on
  // image error. Keeping them as siblings of a wrapper means the grid column
  // width stays stable whether or not the photo resolves.
  return (
    <div className="relative h-9 w-9 shrink-0">
      <div className="absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-primary/15 text-[0.78em] font-semibold text-primary">
        {initialOf(name)}
      </div>
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="relative h-9 w-9 rounded-full object-cover"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
    </div>
  )
}

function initialOf(s?: string | null): string {
  if (!s) return '·'
  const trimmed = s.trim()
  return trimmed.charAt(0).toUpperCase() || '·'
}
