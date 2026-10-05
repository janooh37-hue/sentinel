/**
 * BooksMobileList — phone card list for the Records page: skeleton / error /
 * empty / card states inside pull-to-refresh, Select mode with a bulk bar
 * (Add to email · Delete), and the Back-from-record return focus.
 */

import { ArrowDownLeft, ArrowUpRight, BookOpen, Inbox, Send, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import type { BookRead } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonRow } from '@/components/ui/skeleton'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { inmateReporterActionFor } from '@/components/books/book-detail-drawer-utils'
import { addToBasket } from '@/lib/emailBasket'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { sealDescriptor, signedSourceOf } from './bookStateLabel'
import { newRecordHref } from './newRecordHref'
import { deleteBlockReason } from './recordDelete'
import { useRecordDelete } from './RecordDeleteProvider'
import { paperCountOf } from './recordPapers'
import { buildRecordBasketItem } from './recordsBasket'
import { openRecord, recordLinkProps, useListReturnFocus } from './useRecordNavContext'
import type { RecordNavState } from './useRecordNavContext'

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

export interface BooksMobileListProps {
  isPending: boolean
  isError: boolean
  onRetry: () => void
  rows: BookRead[]
  hasFilters: boolean
  isAr: boolean
  isInmateReporter: boolean
  canSubmit: boolean
  userId: number | undefined
  highlightedId: number | null
  onSubmit: (id: number) => void
  /** Clear every list filter (search, drafts, "Created by me" included). */
  onClearFilters: () => void
}

const FLASH_MS = 1800

export function BooksMobileList({
  isPending,
  isError,
  onRetry,
  rows,
  hasFilters,
  isAr,
  isInmateReporter,
  canSubmit,
  userId,
  highlightedId,
  onSubmit: submitBook,
  onClearFilters,
}: BooksMobileListProps): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { has } = useCapabilities()
  const { scheduleDelete, pendingIds } = useRecordDelete()

  // Rows whose delete is pending are hidden at once (Undo brings them back).
  const mobileRows = useMemo(
    () => rows.filter((row) => !pendingIds.has(row.id)),
    [rows, pendingIds],
  )
  const queue = useMemo(() => mobileRows.map((row) => row.id), [mobileRows])

  // ── Select mode ───────────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const canBulk = !isInmateReporter
  const canDelete = canBulk && has('books.delete')
  const pickedRows = mobileRows.filter((row) => picked.has(row.id))
  const deletableRows = canDelete
    ? pickedRows.filter(
        (row) => deleteBlockReason(row, { has, isInmateReporter }) === null,
      )
    : []
  const skippedCount = canDelete ? pickedRows.length - deletableRows.length : 0

  const setMode = (on: boolean): void => {
    setSelectMode(on)
    setPicked(new Set())
  }
  const togglePick = (id: number): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const bulkDelete = (): void => {
    if (deletableRows.length === 0) return
    scheduleDelete(deletableRows.map((row) => ({ id: row.id, ref: row.ref_number })))
    if (skippedCount > 0) toast(t('books.list.skippedMany', { count: skippedCount }))
    setPicked(new Set())
  }

  const bulkAddToEmail = async (): Promise<void> => {
    const results = await Promise.allSettled(pickedRows.map((row) => buildRecordBasketItem(row)))
    let built = 0
    let added = 0
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        built += 1
        if (addToBasket(result.value).added) added += 1
      }
    }
    setPicked(new Set())
    if (added > 0) toast.success(t('basket.tray.added', { kind: t('basket.add') }))
    else if (built > 0) toast(t('basket.tray.alreadyIn', { kind: t('basket.add') }))
    else toast.error(t('basket.addError'))
  }

  // ── Back from a record: restore scroll + flash the card (never navigates in) ─
  const hostRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    scrollerRef.current = hostRef.current?.querySelector<HTMLElement>('[data-ptr-scroller]') ?? null
  })
  const [flashId, setFlashId] = useState<number | null>(null)
  useListReturnFocus(scrollerRef, {
    isDesktop: false,
    ready: !isPending && !isError,
    onFlash: setFlashId,
  })
  useEffect(() => {
    if (flashId === null) return
    const handle = window.setTimeout(() => setFlashId(null), FLASH_MS)
    return () => window.clearTimeout(handle)
  }, [flashId])

  const from = `${location.pathname}${location.search}`
  // Render-time links carry no offset; a plain tap reads the live one at click.
  const linkNav: RecordNavState = { from, queue, scrollY: 0 }
  const navFor = (): RecordNavState => ({ ...linkNav, scrollY: scrollerRef.current?.scrollTop ?? 0 })
  const handleLinkClick = (id: number) => (e: React.MouseEvent<HTMLAnchorElement>): void => {
    // Plain taps carry the live scroll offset; modified clicks (new tab) keep the
    // <Link>'s own href + state.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    openRecord(navigate, id, navFor())
  }

  const showSelectToggle = canBulk && !isPending && !isError && mobileRows.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showSelectToggle ? (
        <div className="flex shrink-0 justify-end px-6 pb-2">
          <button
            type="button"
            aria-pressed={selectMode}
            onClick={() => setMode(!selectMode)}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full border px-4 text-[0.85em] font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selectMode
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-hairline bg-surface-tinted text-foreground',
            )}
          >
            {selectMode ? t('common.done') : t('books.list.select')}
          </button>
        </div>
      ) : null}

      <div ref={hostRef} className="min-h-0 flex-1">
        <PullToRefresh>
          <div className="px-6 pb-6">
            {isPending ? (
              <div className="flex flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonRow key={i} cols={5} />
                ))}
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={t('common.loadError')}
                  actionLabel={t('common.retry')}
                  onAction={() => onRetry()}
                />
              </div>
            ) : mobileRows.length === 0 ? (
              <div className="rounded-2xl border border-hairline bg-surface py-12">
                <EmptyState
                  icon={BookOpen}
                  message={hasFilters ? t('books.list.noMatch') : t('books.emptyUnfiltered')}
                  actionLabel={hasFilters ? t('books.filters.clear') : t('books.newRecord')}
                  onAction={hasFilters ? onClearFilters : () => navigate(newRecordHref(isInmateReporter))}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-24">
                {mobileRows.map((row) => (
                  <BookMobileCard
                    key={row.id}
                    row={row}
                    isAr={isAr}
                    canSubmit={
                      isInmateReporter
                        ? inmateReporterActionFor(row, userId) === 'edit-submit'
                        : canSubmit
                    }
                    highlighted={row.id === highlightedId || row.id === flashId}
                    selectMode={selectMode}
                    picked={picked.has(row.id)}
                    paperCount={paperCountOf(row, { inmateReporter: isInmateReporter })}
                    link={recordLinkProps(row.id, linkNav)}
                    onLinkClick={handleLinkClick(row.id)}
                    onTogglePick={() => togglePick(row.id)}
                    onSubmit={() => submitBook(row.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </PullToRefresh>
      </div>

      {selectMode && pickedRows.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-hairline bg-surface px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
          <div className="min-w-0 flex-1" aria-live="polite">
            <div className="text-[0.85em] font-semibold text-foreground">
              {t('books.list.selected', { count: pickedRows.length })}
            </div>
            {skippedCount > 0 ? (
              <small className="block text-[0.72em] text-muted-foreground">
                {t('books.list.skippedMany', { count: skippedCount })}
              </small>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void bulkAddToEmail()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-surface-tinted px-3.5 text-[0.82em] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Inbox className="h-4 w-4" aria-hidden />
            {t('basket.add')}
          </button>
          {canDelete ? (
            <button
              type="button"
              aria-disabled={deletableRows.length === 0}
              onClick={bulkDelete}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-destructive/50 px-3.5 text-[0.82em] font-semibold text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                deletableRows.length === 0 && 'opacity-50',
              )}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('books.list.deleteMany', { count: deletableRows.length })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ApprovalStatePill({
  state,
  signingPath,
  signedSource,
  t,
}: {
  state: string
  signingPath?: string | null
  signedSource?: string | null
  t: (key: string) => string
}): React.JSX.Element {
  // Mobile keeps its own (amber-draft) chip palette for now — known deferral
  // for the next mobile pass; labels are path-aware via sealDescriptor.
  const variants: Record<string, string> = {
    none: 'bg-warning-soft text-warning',
    pending: 'bg-warning-soft text-warning',
    awaiting_scan: 'bg-info-soft text-info',
    approved: 'bg-success-soft text-success',
    rejected: 'bg-destructive/10 text-destructive',
    returned: 'bg-info-soft text-info',
  }
  const cls = variants[state] ?? 'bg-surface-tinted text-muted-foreground'
  // sealDescriptor falls back to the raw state string for unknown states.
  const label = t(sealDescriptor(state, { signingPath, signedSource }).labelKey)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        cls,
      )}
    >
      {label}
    </span>
  )
}

function DirectionPill({
  direction,
  t,
}: {
  direction: string | null
  t: (key: string) => string
}): React.JSX.Element {
  if (!direction) return <span className="text-muted-foreground">—</span>
  const isIncoming = direction === 'incoming'
  const Icon = isIncoming ? ArrowDownLeft : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em]',
        isIncoming
          ? 'bg-info-soft text-info'
          : 'bg-success-soft text-success',
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {t(`books.direction.${direction}`)}
    </span>
  )
}
// ─── Mobile-only book card ───────────────────────────────────────────────────
// Mirrors the desktop row but stacks ref + approval / subject / meta so the
// approval column never overflows the viewport (the dense table clips it).
// Open mode: the ref is a real <Link> stretched over the whole card (so a Submit
// button can sit on top without nesting interactive elements in an anchor).
// Select mode: the whole card is a <label> around a native checkbox.

interface BookMobileCardProps {
  row: BookRead
  isAr: boolean
  canSubmit: boolean
  highlighted: boolean
  selectMode: boolean
  picked: boolean
  paperCount: number
  link: { to: string; state: RecordNavState }
  onLinkClick: (e: React.MouseEvent<HTMLAnchorElement>) => void
  onTogglePick: () => void
  onSubmit: () => void
}

function BookMobileCard({
  row,
  isAr,
  canSubmit,
  highlighted,
  selectMode,
  picked,
  paperCount,
  link,
  onLinkClick,
  onTogglePick,
  onSubmit,
}: BookMobileCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const catLabel = isAr
    ? (row.category.name_ar ?? row.category.name_en)
    : (row.category.name_en ?? row.category.name_ar)
  const Wrapper = selectMode ? 'label' : 'div'
  return (
    <Wrapper
      data-id={row.id}
      data-book-id={row.id}
      className={cn(
        'relative flex gap-3 rounded-2xl border border-hairline bg-surface p-3.5 transition-colors motion-reduce:transition-none',
        selectMode && 'cursor-pointer',
        (highlighted || picked) && 'bg-accent-soft',
      )}
    >
      {selectMode ? (
        <input
          type="checkbox"
          checked={picked}
          onChange={onTogglePick}
          aria-label={t('books.list.selectRef', { ref: row.ref_number })}
          className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* ref + approval action */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[0.85em] font-semibold text-primary">
            {selectMode ? (
              <bdi dir="ltr">{row.ref_number}</bdi>
            ) : (
              <Link
                {...link}
                onClick={onLinkClick}
                className="rounded-sm after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >
                <bdi dir="ltr">{row.ref_number}</bdi>
              </Link>
            )}
          </span>
          {row.approval_state !== 'none' ? (
            <ApprovalStatePill
              state={row.approval_state}
              signingPath={row.signing_path}
              signedSource={signedSourceOf(row)}
              t={t}
            />
          ) : (
            <>
              <ApprovalStatePill state="none" t={t} />
              {canSubmit && !selectMode ? (
                <button
                  type="button"
                  onClick={onSubmit}
                  className={cn(
                    'relative z-10 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[0.72em] font-medium transition-colors motion-reduce:transition-none',
                    'border border-hairline text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    row.category.requires_approval &&
                      'border-warning/50 text-warning hover:border-warning hover:text-warning',
                  )}
                >
                  <Send className="h-2.5 w-2.5" strokeWidth={2} aria-hidden />
                  {row.category.requires_approval
                    ? t('books.approval.needsApproval')
                    : t('books.approval.submitForApproval')}
                </button>
              ) : null}
            </>
          )}
        </div>

        {/* subject */}
        {row.subject ? (
          <p className="line-clamp-2 text-[0.85em] leading-snug text-foreground" dir="auto">
            {row.subject}
          </p>
        ) : null}

        {/* category · direction */}
        <div className="flex flex-wrap items-center gap-2 text-[0.72em] text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-surface-tinted px-2.5 py-0.5 font-medium uppercase tracking-[0.06em]">
            {catLabel}
          </span>
          {row.direction && <DirectionPill direction={row.direction} t={t} />}
        </div>

        {/* creator · date · papers */}
        <p className="text-[0.72em] text-muted-foreground">
          <span>
            {t('books.record.createdBy')}{' '}
            {row.created_by_name ? (
              <bdi>{row.created_by_name}</bdi>
            ) : (
              t('books.record.creatorUnknown')
            )}
          </span>
          {' · '}
          <bdi dir="ltr" className="font-mono tabular-nums">
            {formatDate(row.created_at)}
          </bdi>
          {paperCount > 1 ? (
            <>
              {' · '}
              <span>{t('books.pane.papers', { count: paperCount })}</span>
            </>
          ) : null}
        </p>
      </div>
    </Wrapper>
  )
}
