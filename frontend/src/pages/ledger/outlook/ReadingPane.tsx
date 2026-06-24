/**
 * ReadingPane — the email reading view rendered into the ReadingPaneSlot seam
 * when an EMAIL entry is selected (Phase 5, Task 5).
 *
 * A thin composer over the leaf components extracted in Tasks 2–4: it fetches
 * the entry, marks it read on open, and lays out the prototype's reading pane —
 *
 *   ┌ rp-top ────────────────────────────────────────────────┐
 *   │ subject (large)            Reply · Reply All · Forward · ⋯│
 *   │                                          <date beneath>  │
 *   ├ rp-from ───────────────────────────────────────────────┤
 *   │ [avatar]  sender name + address                          │
 *   │           RecipientChips (all To/Cc/Bcc)                 │
 *   ├ attachments band (ABOVE the body) ─────────────────────┤
 *   ├ body (rendered as-sent, smartlinks preserved) ─────────┤
 *   └ thread (collapsed cards expand inline) ────────────────┘
 *
 * Prototype reference: `.rp-top` / `.rp-actions` / `.rp-from` / `.recips` /
 * `.attach` / `.rp-body` / `.thread` (docs/prototypes/ledger-outlook-redesign.html
 * lines 217–293, `renderMessage` 1101–1158). The whole pane lives inside
 * `[data-ledger-chrome] dir="ltr"` — it does NOT mirror; only the body renders
 * in its own source direction (handled by EmailBody, Task 3).
 *
 * Reply / Reply All / Forward are surfaced as callbacks (wired to the existing
 * LedgerEmailCompose by the shell in Task 8). Smart-link clicks bubble via
 * `onNavigate` (employee → 'employees', book → 'books').
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Reply as ReplyIcon,
  ReplyAll as ReplyAllIcon,
  Forward as ForwardIcon,
  Trash2 as TrashIcon,
} from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerAttachmentMeta, LedgerEntryRead } from '@/lib/api'
import { useMarkReadOnOpen } from '@/lib/useMarkReadOnOpen'
import { RecipientChips } from '@/components/ledger/RecipientChips'
import { LedgerAttachments } from '@/components/ledger/LedgerAttachments'
import { EmailBody } from '@/components/ledger/EmailBody'
import { LedgerThread } from '@/components/ledger/LedgerThread'
import { StarButton } from '@/components/ledger/StarButton'

/** Coarse page targets the shell's `onNavigate` seam understands. */
type NavPage = 'employees' | 'books'

interface ReadingPaneProps {
  entryId: number
  /** Reply / Reply All / Forward → open the existing compose (Task 8). */
  onReply?: (entry: LedgerEntryRead) => void
  onReplyAll?: (entry: LedgerEntryRead) => void
  onForward?: (entry: LedgerEntryRead) => void
  /** Delete this email (→ shell's deferred delete). */
  onDelete?: (entry: LedgerEntryRead) => void
  /** Smart-link navigation through the shell's coarse page seam. */
  onNavigate?: (page: NavPage, id?: string) => void
  /** Open a sibling thread entry. */
  onOpenEntry?: (id: number) => void
}

/** Split "Name <addr@x>" into display name + bare address for the sender row. */
function parseSender(counterparty: string): { name: string; address: string } {
  const m = counterparty.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1] || m[2], address: m[2] }
  return { name: counterparty, address: counterparty }
}

function senderInitial(name: string): string {
  const ch = name.replace(/[<>"']/g, '').trim().charAt(0)
  return ch ? ch.toUpperCase() : '?'
}

export function ReadingPane({
  entryId,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onNavigate,
  onOpenEntry,
}: ReadingPaneProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  const entryQuery = useQuery({
    queryKey: ['ledger-entry', entryId],
    queryFn: () => api.getLedgerEntry(entryId),
  })
  const entry = entryQuery.data

  // Fire-and-forget mark-read when opening an unread incoming email.
  useMarkReadOnOpen(entry)

  // Attachment cards — prefer the size-bearing `attachments` from GET /{id};
  // fall back to bare paths (size 0 → size label hidden) for robustness.
  const attachments: LedgerAttachmentMeta[] = useMemo(() => {
    if (!entry) return []
    if (entry.attachments && entry.attachments.length > 0) return entry.attachments
    return (entry.attachment_paths ?? []).map((p, i) => ({
      index: i,
      name: p.split('/').pop() ?? p,
      size: 0,
    }))
  }, [entry])

  if (entryQuery.isLoading) {
    return (
      <PaneShell ariaLabel={t('ledger.title')}>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      </PaneShell>
    )
  }

  if (!entry) {
    return (
      <PaneShell ariaLabel={t('ledger.title')}>
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('common.loadError')}
        </div>
      </PaneShell>
    )
  }

  const sender = parseSender(entry.counterparty)
  const isStarred = entry.tags.includes('starred')
  const formattedDate = new Date(entry.entry_date).toLocaleDateString(
    isAr ? 'ar-AE' : undefined,
    { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' },
  )

  return (
    <PaneShell ariaLabel={entry.subject || t('ledger.title')}>
      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* ── rp-top: subject + actions column (buttons, date beneath) ── */}
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <h1
            className="text-xl font-bold leading-snug tracking-tight text-foreground"
            dir="auto"
          >
            {entry.subject}
          </h1>
          <div className="flex flex-none flex-col items-end gap-2 rtl:items-start">
            <div className="flex items-center gap-1.5">
              <Button
                variant="primary"
                onClick={() => onReply?.(entry)}
                icon={<ReplyIcon className="h-[15px] w-[15px]" strokeWidth={2} />}
              >
                {t('ledger.outlook.reply')}
              </Button>
              <Button
                onClick={() => onReplyAll?.(entry)}
                icon={<ReplyAllIcon className="h-[15px] w-[15px]" strokeWidth={2} />}
              >
                {t('ledger.outlook.replyAll')}
              </Button>
              <Button
                onClick={() => onForward?.(entry)}
                icon={<ForwardIcon className="h-[15px] w-[15px]" strokeWidth={2} />}
              >
                {t('ledger.outlook.forward')}
              </Button>
              <StarButton entryId={entry.id} starred={isStarred} className="h-8 w-8" />
              {onDelete && (
                <button
                  type="button"
                  aria-label={t('ledger.outlook.delete', { defaultValue: 'Delete' })}
                  onClick={() => onDelete(entry)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[--radius-sm] border border-border-strong bg-surface-raised text-muted-foreground transition-colors hover:border-faint hover:bg-surface-tinted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <TrashIcon className="h-[15px] w-[15px]" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="text-xs text-faint">{formattedDate}</div>
          </div>
        </div>

        {/* ── rp-from: avatar + sender + recipient chips ── */}
        <div className="flex items-start gap-3 px-6 py-4">
          <div className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full bg-gradient-to-br from-green-grad-a to-green-grad-b text-[15px] font-bold text-white">
            {senderInitial(sender.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-foreground" dir="auto">
              {sender.name}
            </div>
            <div className="font-mono text-xs text-muted-foreground" dir="ltr">
              {sender.address}
            </div>
            <RecipientChips entry={entry} />
          </div>
        </div>

        {/* ── attachments band — ABOVE the body ── */}
        {attachments.length > 0 && (
          <div className="border-t border-hairline bg-surface-raised px-2 py-2">
            <LedgerAttachments entryId={entry.id} attachments={attachments} />
          </div>
        )}

        {/* ── body — rendered as sent (own source direction) ── */}
        {entry.notes_html && (
          <div className="border-t border-hairline px-2 py-2">
            <EmailBody
              html={entry.notes_html}
              inlineImages={entry.inline_images}
              entryId={entry.id}
              attachmentPaths={entry.attachment_paths}
              onSmartLinkClick={(kind, value) =>
                onNavigate?.(kind === 'employee' ? 'employees' : 'books', value)
              }
            />
          </div>
        )}

        {/* ── thread — collapsed cards expand inline ── */}
        <div className="border-t border-hairline bg-surface-raised px-2 py-2">
          <LedgerThread entryId={entry.id} entry={entry} onOpenEntry={onOpenEntry} />
        </div>
      </div>
    </PaneShell>
  )
}

/** The `.read` flex container the slot expects — the pane never mirrors. */
function PaneShell({
  children,
  ariaLabel,
}: {
  children: React.ReactNode
  ariaLabel: string
}): React.JSX.Element {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface"
      role="region"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  )
}

/** The prototype's `.abtn` action button (primary = filled `--info`). */
function Button({
  children,
  icon,
  onClick,
  variant,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick?: () => void
  variant?: 'primary'
}): React.JSX.Element {
  const base =
    'inline-flex items-center gap-1.5 rounded-[--radius-sm] px-3 py-1.5 text-[12.5px] font-semibold transition-colors active:translate-y-px'
  const tone =
    variant === 'primary'
      ? 'border border-info bg-info text-white hover:bg-info/90'
      : 'border border-border-strong bg-surface-raised text-foreground hover:border-faint hover:bg-surface-tinted'
  return (
    <button type="button" onClick={onClick} className={`${base} ${tone}`}>
      {icon}
      {children}
    </button>
  )
}
