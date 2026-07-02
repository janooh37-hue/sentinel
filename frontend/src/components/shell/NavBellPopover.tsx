/**
 * NavBellPopover — wraps `NavBell` in a popover that shows the most recent
 * unread incoming ledger entries (TAMM-style mail preview).
 *
 * Data flow:
 *   - `GET /api/v1/ledger/unread-recent?limit=5` returns `{ items, total_unread }`.
 *   - The trigger button keeps the existing numeric badge (driven by
 *     `total_unread` here so the count and the preview can't drift).
 *   - Each row navigates to `/ledger?open=ID` and closes the popover so the
 *     destination page can auto-open the entry in its detail drawer.
 *   - The "Mark all read" affordance uses the existing POST endpoint and
 *     invalidates both the unread-count and unread-recent queries.
 *
 * There is no shadcn `Popover` primitive in this project; the panel is hand-
 * rolled with the same outside-click / Escape handling used by `AccountMenu`.
 */

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, ClipboardCheck, Inbox, Paperclip, ScanLine, ShieldCheck, Stamp } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIdentity } from '@/lib/useIdentity'
import { useAwaitingReturnCount } from '@/pages/leaves/useAwaitingReturnCount'
import { useScanInboxCount } from '@/pages/scanInbox/useScanInboxCount'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { NavBell } from './NavBell'

function initialsOf(name: string | null | undefined, fallback: string): string {
  const source = (name ?? '').trim() || fallback
  if (!source) return '·'
  const parts = source.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return source[0]?.toUpperCase() ?? '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function shortDateLabel(iso: string): string {
  // Mail-app stamp: time if today, "dd MMM" if older. `Intl.DateTimeFormat` is
  // locale-aware via the document's html[lang], but we keep it terse here.
  try {
    const d = new Date(iso)
    const now = new Date()
    if (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    ) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  } catch {
    return iso.slice(0, 10)
  }
}

export function NavBellPopover(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Element focused when the popover opened, so we can restore focus on close.
  const triggerRef = useRef<HTMLElement | null>(null)

  const { isAdmin } = useIdentity()
  const { has } = useCapabilities()

  const recentQuery = useQuery({
    queryKey: ['ledger', 'unread-recent'],
    queryFn: () => api.getLedgerUnreadRecent(5),
    // Phase 4: SSE stream drives live invalidation; this is a safety-poll fallback.
    refetchInterval: 120_000,
    staleTime: 15_000,
  })

  // Admins also see pending access requests here (the "missing notification").
  const pendingQuery = useQuery({
    queryKey: ['auth-users'],
    queryFn: () => api.listAuthUsers(),
    enabled: isAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const pendingRequests = isAdmin
    ? (pendingQuery.data ?? []).filter((u) => u.status === 'pending').length
    : 0

  const expiryQuery = useQuery({
    queryKey: ['expiry', 'summary'],
    queryFn: api.getExpirySummary,
    enabled: has('employees.view'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
  const expiryUrgent = expiryQuery.data?.urgent ?? 0

  const awaitingReturn = useAwaitingReturnCount()
  const scanInbox = useScanInboxCount()

  // Phase 4 LAN — awaiting MY approval (books.approve-gated).
  // Query key ['books','awaiting'] is also invalidated by useNotificationStream.
  const approvalsQuery = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    refetchInterval: 120_000,
    enabled: has('books.approve'),
  })
  const awaitingApproval = approvalsQuery.data?.length ?? 0

  const markAllMutation = useMutation({
    mutationFn: () => api.markAllLedgerRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger', 'unread-recent'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: (err) =>
      toast.error(apiErrorMessage(err)),
  })

  // Outside-click / Escape — mirrors AccountMenu.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus management: move focus into the dialog panel on open, and return it
  // to the trigger on close — matches the app's other dialogs/popovers.
  useEffect(() => {
    if (open) {
      // Remember the trigger so we can restore focus when the popover closes.
      triggerRef.current = document.activeElement as HTMLElement | null
      panelRef.current?.focus()
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  const items = recentQuery.data?.items ?? []
  const totalUnread = recentQuery.data?.total_unread ?? 0
  const moreCount = Math.max(0, totalUnread - items.length)
  const hasNothing = items.length === 0 && pendingRequests === 0 && expiryUrgent === 0 && awaitingReturn === 0 && scanInbox === 0 && awaitingApproval === 0

  return (
    <div ref={rootRef} className="relative">
      <NavBell
        count={totalUnread + pendingRequests + expiryUrgent + awaitingReturn + scanInbox + awaitingApproval}
        onClick={() => setOpen((v) => !v)}
      />

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
          aria-label={t('appBar.notifications', { defaultValue: 'Notifications' })}
          className="anim-pop-in anim-pop-in-end absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl focus-visible:outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t('appBar.notifications', { defaultValue: 'Notifications' })}
            </h3>
            {totalUnread > 0 && (
              <button
                type="button"
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                className="text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:rounded-sm"
              >
                {t('appBar.markAllRead', { defaultValue: 'Mark all read' })}
              </button>
            )}
          </div>

          {/* Pending access requests (admin only) — the "missing notification" */}
          {pendingRequests > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/access-requests')
              }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-accent-soft text-accent">
                <AvatarFallback className="bg-transparent">
                  <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[0.7em] font-semibold uppercase tracking-wider text-accent">
                  {t('access.bell.requestPrefix')}
                </span>
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('access.settingsCard.pending', { count: pendingRequests })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}

          {/* Awaiting MY approval (books.approve-gated) — Phase 4 LAN */}
          {awaitingApproval > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/books')
              }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-primary-soft text-primary">
                <AvatarFallback className="bg-transparent">
                  <Stamp className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('nav.bell.awaitingApprovalTitle')}
                </span>
                <span className="text-[0.78em] text-muted-foreground">
                  {t('nav.bell.awaitingApproval', { count: awaitingApproval })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}

          {/* Expiring documents (employees.view-gated) */}
          {expiryUrgent > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/expiry')
              }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-warning-soft text-warning">
                <AvatarFallback className="bg-transparent">
                  <CalendarClock className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('expiry.bellTitle')}
                </span>
                <span className="text-[0.78em] text-muted-foreground">
                  {t('expiry.bellCount', { count: expiryUrgent })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}

          {/* Awaiting return form */}
          {awaitingReturn > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                navigate('/leaves', { state: { awaitingReturn: true } })
              }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-info-soft text-info">
                <AvatarFallback className="bg-transparent">
                  <ClipboardCheck className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('nav.bell.awaitingReturnTitle')}
                </span>
                <span className="text-[0.78em] text-muted-foreground">
                  {t('nav.bell.awaitingReturn', { count: awaitingReturn })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}

          {/* Scan inbox — scanned documents awaiting confirmation or routing */}
          {scanInbox > 0 && (
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/scan-inbox') }}
              className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <Avatar className="h-8 w-8 bg-info-soft text-info">
                <AvatarFallback className="bg-transparent">
                  <ScanLine className="h-4 w-4" strokeWidth={1.8} />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[0.9em] font-semibold text-foreground">
                  {t('scanInbox.bellTitle')}
                </span>
                <span className="text-[0.78em] text-muted-foreground">
                  {t('scanInbox.bellCount', { count: scanInbox })}
                </span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
            </button>
          )}

          {/* Body */}
          {recentQuery.isPending ? (
            <div className="flex flex-col gap-2 px-4 py-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md bg-surface-tinted px-3 py-2"
                >
                  <div className="h-8 w-8 animate-pulse rounded-full bg-border" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-border" />
                    <div className="h-2.5 w-1/3 animate-pulse rounded bg-border" />
                  </div>
                </div>
              ))}
            </div>
          ) : hasNothing ? (
            <EmptyState
              icon={Inbox}
              animated
              message={t('appBar.noNotifications', {
                defaultValue: 'No unread notifications',
              })}
              className="py-10"
            />
          ) : (
            <ul className="max-h-[360px] overflow-auto">
              {items.map((item) => {
                const displayName =
                  item.counterparty_name?.trim() ||
                  item.counterparty ||
                  ''
                const initials = initialsOf(displayName, item.counterparty)
                return (
                  <li key={item.id} className="border-b border-hairline last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        navigate(`/ledger?open=${item.id}`)
                      }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <Avatar className="h-8 w-8 bg-primary-soft text-primary">
                        <AvatarFallback className="text-[0.72em] font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span
                              className="truncate text-[0.9em] font-semibold text-foreground"
                              dir="auto"
                            >
                              {item.subject || displayName}
                            </span>
                            {item.attachment_count > 0 && (
                              <Paperclip
                                className="h-3 w-3 shrink-0 text-muted-foreground"
                                strokeWidth={1.8}
                                aria-label={t('appBar.hasAttachment', {
                                  defaultValue: 'Has attachment',
                                })}
                              />
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-[0.7em] text-muted-foreground">
                            {shortDateLabel(item.entry_date)}
                          </span>
                        </div>
                        <span
                          className="mt-0.5 truncate text-xs text-muted-foreground"
                          dir="auto"
                        >
                          {displayName}
                        </span>
                        {item.preview && (
                          <span
                            className="mt-0.5 truncate text-xs text-muted-foreground/80"
                            dir="auto"
                          >
                            {item.preview}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Footer */}
          <div className="flex flex-col border-t border-hairline">
            {moreCount > 0 && (
              <div className="px-4 pb-1.5 pt-2 text-[0.72em] text-muted-foreground">
                {t('appBar.moreUnread', {
                  count: moreCount,
                  defaultValue: '+ {{count}} more unread',
                })}
              </div>
            )}
            <Link
              to="/ledger"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between px-4 py-2.5 text-sm text-primary transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none"
            >
              <span>
                {t('appBar.viewAllInbox', { defaultValue: 'View all in inbox' })}
              </span>
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" strokeWidth={1.8} />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
