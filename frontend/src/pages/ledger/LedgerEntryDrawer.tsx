/**
 * LedgerEntryDrawer — full-page detail view for a single ledger entry.
 *
 * Email-channel entries get a mail-client style layout: big subject, sender
 * strip with avatar, full-width body that overrides any inline width/style
 * from forwarded HTML. Non-email entries get a leaner metadata grid.
 *
 * Read-only. "Edit" lifts the entry up to the LedgerPage so it can swap to
 * the full-page editor. "Reply" calls onReply with the entry — parent opens
 * the composer. "Delete" soft-deletes after confirm.
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  MoreHorizontal,
  Reply as ReplyIcon,
  Forward as ForwardIcon,
  Pencil,
  Trash2,
  Mail,
  Phone,
  Users as UsersIcon,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
} from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerAttachmentMeta, LedgerEntryRead } from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { StarButton } from '@/components/ledger/StarButton'
import { extractGNumbers } from '@/lib/employeeDetection'
import { EmployeeSuggestionBanner } from '@/components/ledger/EmployeeSuggestionBanner'
import { EmailBody } from '@/components/ledger/EmailBody'
import { LedgerAttachments } from '@/components/ledger/LedgerAttachments'
import { LedgerThread } from '@/components/ledger/LedgerThread'
import { useMarkReadOnOpen } from '@/lib/useMarkReadOnOpen'

interface LedgerEntryDrawerProps {
  entryId: number
  onClose: () => void
  onDeleted: () => void
  /** Edit — switches to the full-page editor with this entry pre-filled. */
  onEdited: (entry: LedgerEntryRead) => void
  /** Reply / Forward — switches to a composer in reply or forward mode. */
  onReply?: (entry: LedgerEntryRead) => void
  onForward?: (entry: LedgerEntryRead) => void
  /** Smart-link navigation — passed up to LedgerPage so it can route. */
  onOpenEmployee?: (gNumber: string) => void
  onOpenBook?: (bookRef: string) => void
  /** Sibling thread navigation — open a different entry within the drawer. */
  onOpenEntry?: (id: number) => void
}

const DIRECTION_META: Record<
  string,
  { icon: typeof ArrowDownLeft; tone: string; labelKey: string }
> = {
  incoming: {
    icon: ArrowDownLeft,
    tone: 'bg-success-soft text-success',
    labelKey: 'ledger.direction.incoming',
  },
  outgoing: {
    icon: ArrowUpRight,
    tone: 'bg-accent-soft text-accent',
    labelKey: 'ledger.direction.outgoing',
  },
  internal: {
    icon: ArrowLeftRight,
    tone: 'bg-primary-soft text-primary',
    labelKey: 'ledger.direction.internal',
  },
}

function initials(name: string): string {
  if (!name) return '?'
  const parts = name.replace(/[<>"]/g, '').split(/[\s,@.]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function LedgerEntryDrawer({
  entryId,
  onClose,
  onDeleted,
  onEdited,
  onReply,
  onForward,
  onOpenEmployee,
  onOpenBook,
  onOpenEntry,
}: LedgerEntryDrawerProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement | null>(null)

  function closeMoreMenu(): void {
    setMoreMenuOpen(false)
    setConfirmDelete(false)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        if (moreMenuOpen) { closeMoreMenu(); return }
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, moreMenuOpen])

  // Close the mobile More menu on outside click or Escape.
  useEffect(() => {
    if (!moreMenuOpen) return
    function onDown(e: MouseEvent): void {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        closeMoreMenu()
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('mousedown', onDown)
    }
  }, [moreMenuOpen])

  const entryQuery = useQuery({
    queryKey: ['ledger-entry', entryId],
    queryFn: () => api.getLedgerEntry(entryId),
  })

  const entry: LedgerEntryRead | undefined = entryQuery.data
  const isEmail = entry?.channel === 'email'

  // Phase 17 — fire-and-forget mark-read when opening an unread incoming email.
  useMarkReadOnOpen(entry)

  // Drop the auto-attached msgid:... dedup tag from the viewer; it's internal.
  // The star (★) tag is rendered as a button, not as a plain chip, so drop it
  // from the visible-tag list too.
  const visibleTags =
    entry?.tags.filter((t) => !t.startsWith('msgid:') && t !== 'starred') ?? []
  const isStarred = entry?.tags.includes('starred') ?? false

  // Attachment cards — prefer the size-bearing `attachments` from GET /{id};
  // fall back to bare paths (size 0 → size label hidden) for robustness.
  const attachments: LedgerAttachmentMeta[] =
    entry?.attachments && entry.attachments.length > 0
      ? entry.attachments
      : (entry?.attachment_paths ?? []).map((p, i) => ({
          index: i,
          name: p.split('/').pop() ?? p,
          size: 0,
        }))

  const dir = entry?.direction
    ? DIRECTION_META[entry.direction] ?? DIRECTION_META.incoming
    : DIRECTION_META.incoming
  const DirIcon = dir.icon

  const formattedDate = entry
    ? new Date(entry.entry_date).toLocaleDateString(isAr ? 'ar-AE' : undefined, {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : ''

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-background"
      role="region"
      aria-label={t('ledger.title')}
    >
      {/* Top bar — back + breadcrumb */}
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
          aria-label={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />
          <span>{t('common.back', { defaultValue: 'Back' })}</span>
        </button>
        <span className="text-border">/</span>
        <span className="text-sm font-medium text-muted-foreground">
          {isEmail ? t('ledger.channel.email') : t('ledger.title')}
        </span>

        {/* Right-side action toolbar — desktop (≥ md) only */}
        <div className="ms-auto hidden items-center gap-1.5 md:flex">
          {entry && (
            <StarButton entryId={entry.id} starred={isStarred} />
          )}
          {isEmail && onReply && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => entry && onReply(entry)}
              disabled={!entry}
            >
              <ReplyIcon className="h-3.5 w-3.5" />
              {t('ledger.action.reply', { defaultValue: 'Reply' })}
            </Button>
          )}
          {isEmail && onForward && (
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full"
              onClick={() => entry && onForward(entry)}
              disabled={!entry}
            >
              <ForwardIcon className="h-3.5 w-3.5" />
              {t('ledger.action.forward', { defaultValue: 'Forward' })}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            className="rounded-full"
            onClick={() => entry && onEdited(entry)}
            disabled={!entry}
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('common.edit')}
          </Button>
          {confirmDelete ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full"
                onClick={() => setConfirmDelete(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={onDeleted}
                className="rounded-full bg-accent text-white hover:bg-accent-hover"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('common.delete')}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmDelete(true)}
              className="rounded-full text-accent hover:text-accent"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('common.delete')}
            </Button>
          )}
        </div>

        {/* Right-side condensed toolbar — mobile (< md) only: Star + Reply + More */}
        <div ref={moreMenuRef} className="relative ms-auto flex items-center gap-0.5 md:hidden">
          {entry && (
            <StarButton entryId={entry.id} starred={isStarred} className="min-h-11 min-w-11" />
          )}
          {isEmail && onReply && (
            <button
              type="button"
              onClick={() => entry && onReply(entry)}
              disabled={!entry}
              aria-label={t('ledger.action.reply', { defaultValue: 'Reply' })}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground disabled:opacity-40"
            >
              <ReplyIcon className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
          <button
            type="button"
            onClick={() => { if (moreMenuOpen) { closeMoreMenu() } else { setConfirmDelete(false); setMoreMenuOpen(true) } }}
            aria-label={t('common.more', { defaultValue: 'More' })}
            aria-haspopup="menu"
            aria-expanded={moreMenuOpen}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.7} />
          </button>
          {moreMenuOpen && (
            <div
              role="menu"
              className="absolute end-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-hairline bg-surface shadow-lg"
            >
              {isEmail && onForward && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { closeMoreMenu(); if (entry) onForward(entry) }}
                  disabled={!entry}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-sm text-foreground hover:bg-surface-tinted disabled:opacity-40"
                >
                  <ForwardIcon className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
                  {t('ledger.action.forward', { defaultValue: 'Forward' })}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => { closeMoreMenu(); if (entry) onEdited(entry) }}
                disabled={!entry}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-sm text-foreground hover:bg-surface-tinted disabled:opacity-40"
              >
                <Pencil className="h-4 w-4 text-muted-foreground" strokeWidth={1.7} />
                {t('common.edit')}
              </button>
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => closeMoreMenu()}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-sm text-foreground hover:bg-surface-tinted"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { closeMoreMenu(); onDeleted() }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-sm text-accent hover:bg-surface-tinted"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                    {t('common.delete')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setConfirmDelete(true)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-start text-sm text-accent hover:bg-surface-tinted"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  {t('common.delete')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {entryQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : !entry ? null : (
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-6 py-6">
            {/* ① Sender / metadata strip */}
            <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
              <Avatar className="h-10 w-10 bg-primary-soft text-primary">
                <AvatarFallback>{initials(entry.counterparty)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span
                    className="truncate text-sm font-medium text-foreground"
                    dir="auto"
                  >
                    {entry.counterparty}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${dir.tone}`}
                  >
                    <DirIcon className="h-3 w-3" strokeWidth={2} />
                    {t(dir.labelKey)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ChannelGlyph channel={entry.channel} />
                  <span>{t(`ledger.channel.${entry.channel}`)}</span>
                  <span className="text-border">·</span>
                  <span>{formattedDate}</span>
                </div>
              </div>
            </div>

            {/* ② Subject */}
            <h1
              className="text-2xl font-semibold leading-tight text-foreground"
              dir="auto"
            >
              {entry.subject}
            </h1>

            {/* Tags */}
            {visibleTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {visibleTags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* ③ Attachments — file-type-iconed card grid */}
            <LedgerAttachments entryId={entry.id} attachments={attachments} />

            {/* Auto-link suggestion — only when exactly one G-number was
             * detected and the entry isn't already linked. */}
            {entry.related_employee_id == null && entry.notes_html && (() => {
              const detected = extractGNumbers(entry.notes_html ?? '')
              if (detected.length !== 1) return null
              return (
                <EmployeeSuggestionBanner
                  gnumber={detected[0]}
                  entryId={entry.id}
                />
              )
            })()}

            {/* ④ Body — full width, scoped to override inline email widths. */}
            {entry.notes_html && (
              <EmailBody
                html={entry.notes_html}
                inlineImages={entry.inline_images}
                entryId={entry.id}
                attachmentPaths={entry.attachment_paths}
                onSmartLinkClick={(kind, value) => {
                  if (kind === 'employee') onOpenEmployee?.(value)
                  else if (kind === 'book') onOpenBook?.(value)
                }}
              />
            )}

            {/* Thread — the whole conversation, with the open entry marked so
             * you keep your place while hopping between messages. */}
            <LedgerThread entryId={entry.id} entry={entry} onOpenEntry={onOpenEntry} />

            {/* Related references */}
            {(entry.related_book_id || entry.related_employee_id) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {entry.related_book_id && (
                  <MetaCard
                    label={t('ledger.form.relatedBook')}
                    value={String(entry.related_book_id)}
                  />
                )}
                {entry.related_employee_id && (
                  <MetaCard
                    label={t('ledger.form.relatedEmployee')}
                    value={entry.related_employee_id}
                  />
                )}
              </div>
            )}

            {entry.created_by && (
              <div className="mt-2 text-xs text-muted-foreground">
                {t('ledger.loggedBy')}{' '}
                <span className="font-medium text-foreground">
                  {(isAr ? entry.created_by_name_ar : entry.created_by_name_en) ??
                    entry.created_by_name_en ??
                    entry.created_by}
                </span>{' '}
                <span className="font-mono">({entry.created_by})</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ChannelGlyph({ channel }: { channel: string }): React.JSX.Element {
  if (channel === 'email') return <Mail className="h-3 w-3" strokeWidth={1.5} />
  if (channel === 'phone') return <Phone className="h-3 w-3" strokeWidth={1.5} />
  if (channel === 'in_person') return <UsersIcon className="h-3 w-3" strokeWidth={1.5} />
  return <Mail className="h-3 w-3 opacity-0" />
}

function MetaCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-surface px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </div>
  )
}
