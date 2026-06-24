/**
 * MessageListRow — the Outlook message-list row (Phase 4, Task 4).
 *
 * Matches the prototype's `.mi` row (docs/prototypes/ledger-outlook-redesign.html):
 *   [32px avatar] [who · subject · snippet] [date + 📎 ★ icons]
 *
 * - Avatar: 32×32 round, direction-colored gradient (green=incoming /
 *   amber=outgoing / blue=internal — the `--*-grad-*` tokens from Task 2);
 *   employee photo overlay when `related_employee_id` resolves, colored-initials
 *   fallback otherwise (same overlay trick as `LedgerRow`).
 * - Sender: `counterparty` (the list item carries no separate name fields, so
 *   `counterparty` is the resolved sender name).
 * - Subject + one-line `snippet` (truncated), date, 📎 attachment marker,
 *   ★ `StarButton` (reused, unchanged).
 *
 * UNREAD = `read_at == null` → blue inline-start bar + blue sender + bold
 * subject + blue date (the `--info`/blue tokens). Read rows = quiet grey.
 * Tokens only — never hardcoded hex.
 */

import { useMemo } from 'react'
import { Paperclip, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StarButton } from '@/components/ledger/StarButton'
import type { LedgerListItem } from '@/lib/api'
import { cn } from '@/lib/utils'

/** Direction → avatar gradient (matches the prototype's `.av.in/.out/.int`). */
const AVATAR_GRAD: Record<string, string> = {
  incoming: 'from-green-grad-a to-green-grad-b',
  outgoing: 'from-amber-grad-a to-amber-grad-b',
  internal: 'from-blue-grad-a to-blue-grad-b',
}

interface MessageListRowProps {
  entry: LedgerListItem
  selected: boolean
  onSelect: (id: number) => void
  /** Optional delete (row hover/focus); omit to hide the control. */
  onDelete?: (entry: LedgerListItem) => void
  /** Optional photo override; defaults to the related employee's photo. */
  photoUrl?: string
}

export function MessageListRow({
  entry,
  selected,
  onSelect,
  onDelete,
  photoUrl,
}: MessageListRowProps): React.JSX.Element {
  const { i18n, t } = useTranslation()

  // Unread is driven solely by `read_at`: null/absent = unread.
  const unread = entry.read_at == null
  const isStarred = entry.tags.includes('starred')
  const hasAttachments = (entry.attachment_count ?? 0) > 0

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: 'short' }),
    [i18n.language],
  )
  const dateLabel = useMemo(() => {
    const raw = entry.created_at ?? `${entry.entry_date}T00:00:00`
    return dateFmt.format(new Date(raw))
  }, [entry.created_at, entry.entry_date, dateFmt])

  const resolvedPhotoUrl =
    photoUrl ??
    (entry.related_employee_id
      ? `/api/v1/employees/${encodeURIComponent(entry.related_employee_id)}/photo`
      : null)

  return (
    // role="button" (not a real <button>) so the nested StarButton stays valid
    // HTML — a <button> can't contain another <button>.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(entry.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(entry.id)
        }
      }}
      aria-current={selected}
      className={cn(
        'group grid w-full cursor-pointer grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-2.5 border-b border-hairline px-3.5 py-2.5 text-start transition-colors last:border-b-0',
        // selected (read) wins the background; unread keeps the blue bar.
        selected ? 'bg-info-soft hover:bg-info-soft' : 'hover:bg-surface-tinted',
        // unread = blue inline-start bar
        unread && 'border-s-[3px] border-s-info',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
      )}
    >
      <Avatar
        photoUrl={resolvedPhotoUrl}
        name={entry.counterparty}
        gradient={AVATAR_GRAD[entry.direction] ?? AVATAR_GRAD.internal}
      />

      <span className="min-w-0">
        <span
          className={cn(
            'block truncate text-[0.86em] leading-tight',
            unread ? 'font-bold text-info' : 'font-semibold text-foreground',
          )}
          dir="auto"
        >
          {entry.counterparty || '—'}
        </span>
        <span
          className={cn(
            'mt-px block truncate text-[0.86em] leading-snug text-foreground',
            unread && 'font-bold',
          )}
          dir="auto"
        >
          {entry.subject}
        </span>
        {entry.snippet && (
          <span
            className="mt-0.5 block truncate text-[0.8em] leading-snug text-faint"
            dir="auto"
          >
            {renderSnippet(entry.snippet)}
          </span>
        )}
      </span>

      <span className="flex flex-col items-end gap-1 rtl:items-start">
        <span
          className={cn(
            'whitespace-nowrap text-[0.72em]',
            unread ? 'font-bold text-info' : 'text-faint',
          )}
        >
          {dateLabel}
        </span>
        <span className="flex items-center gap-1 leading-none">
          {hasAttachments && (
            <Paperclip
              data-testid="mi-attachment"
              className="h-3 w-3 text-faint"
              strokeWidth={1.7}
              aria-label={t('ledger.outlook.hasAttachment')}
            />
          )}
          {onDelete && (
            <button
              type="button"
              aria-label={t('ledger.outlook.delete', { defaultValue: 'Delete' })}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(entry)
              }}
              className="grid h-5 w-5 place-items-center rounded text-faint opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
            </button>
          )}
          <StarButton entryId={entry.id} starred={isStarred} className="h-5 w-5" />
        </span>
      </span>
    </div>
  )
}

interface AvatarProps {
  photoUrl: string | null
  name: string
  gradient: string
}

function Avatar({ photoUrl, name, gradient }: AvatarProps): React.JSX.Element {
  // Render both the gradient-initial circle and the <img>, swapping visibility
  // on image error so the 32px column width stays stable either way.
  return (
    <div className="relative h-8 w-8 shrink-0">
      <div
        className={cn(
          'absolute inset-0 grid place-items-center rounded-full bg-gradient-to-br text-[0.72em] font-bold tracking-wide text-white',
          gradient,
        )}
      >
        {initialOf(name)}
      </div>
      {photoUrl && (
        <img
          src={photoUrl}
          alt=""
          className="relative h-8 w-8 rounded-full object-cover"
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

const ENTITY_RE = /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
}

/** Strip residual HTML tags and decode the common entities to plain text. */
function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(ENTITY_RE, (m) => ENTITIES[m] ?? m)
}

/**
 * Render an FTS search snippet. The search service wraps matches in
 * `<mark>…</mark>`, and the fragment is sliced from raw `notes_html`, so it can
 * carry residual tags. We honor ONLY our own `<mark>` markers (highlighted),
 * strip every other tag, and render the remainder as React text nodes (which
 * React escapes) — XSS-safe by construction. Non-search snippets contain no
 * markers and pass through as plain text.
 */
function renderSnippet(snippet: string): React.ReactNode {
  if (!snippet.includes('<mark>')) return stripTags(snippet)
  // split() with one capture group → [text, marked, text, marked, …]
  return snippet.split(/<mark>([\s\S]*?)<\/mark>/).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded-[2px] bg-info-soft px-0.5 font-medium text-info">
        {stripTags(part)}
      </mark>
    ) : (
      <span key={i}>{stripTags(part)}</span>
    ),
  )
}
