import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Inbox,
  Printer,
  ScanLine,
  ShieldCheck,
  Stamp,
} from 'lucide-react'

import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIdentity } from '@/lib/useIdentity'
import { useAwaitingReturnCount } from '@/pages/leaves/useAwaitingReturnCount'
import { useScanBack } from '@/pages/scanBack/useScanBack'
import { useScanInboxCount } from '@/pages/scanInbox/useScanInboxCount'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { NavBell } from './NavBell'

export function NavBellPopover(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const { isAdmin } = useIdentity()
  const { has } = useCapabilities()

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
  const { count: scanBackCount } = useScanBack()

  const approvalsQuery = useQuery({
    queryKey: ['books', 'awaiting'],
    queryFn: api.listAwaitingBooks,
    staleTime: 30_000,
    refetchInterval: 120_000,
    enabled: has('books.approve'),
  })
  const awaitingApproval = approvalsQuery.data?.length ?? 0

  const total = pendingRequests + expiryUrgent + awaitingReturn + scanInbox + awaitingApproval + scanBackCount
  const hasNothing = total === 0

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null
      panelRef.current?.focus()
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [open])

  const row = (
    title: string,
    detail: string,
    icon: React.JSX.Element,
    onClick: () => void,
    className = 'bg-primary-soft text-primary',
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={() => {
        setOpen(false)
        onClick()
      }}
      className="flex w-full items-center gap-3 border-b border-hairline px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Avatar className={`h-8 w-8 ${className}`}>
        <AvatarFallback className="bg-transparent">{icon}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[0.9em] font-semibold text-foreground">{title}</span>
        <span className="text-[0.78em] text-muted-foreground">{detail}</span>
      </div>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" strokeWidth={1.8} />
    </button>
  )

  return (
    <div ref={rootRef} className="relative">
      <NavBell count={total} onClick={() => setOpen((value) => !value)} />
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          tabIndex={-1}
          aria-label={t('appBar.notifications', { defaultValue: 'Notifications' })}
          className="anim-pop-in anim-pop-in-end absolute end-0 top-full z-50 mt-2 w-[calc(100vw-2rem)] max-w-[380px] overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl focus-visible:outline-none"
        >
          <div className="border-b border-hairline px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t('appBar.notifications', { defaultValue: 'Notifications' })}
            </h3>
          </div>
          {pendingRequests > 0 && row(
            t('access.settingsCard.pending', { count: pendingRequests }),
            t('access.bell.requestPrefix'),
            <ShieldCheck className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/access-requests'),
            'bg-accent-soft text-accent',
          )}
          {awaitingApproval > 0 && row(
            t('nav.bell.awaitingApprovalTitle'),
            t('nav.bell.awaitingApproval', { count: awaitingApproval }),
            <Stamp className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/books'),
          )}
          {scanBackCount > 0 && row(
            t('nav.bell.scanBackTitle'),
            t('nav.bell.scanBack', { count: scanBackCount }),
            <Printer className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/scan-back'),
            'bg-warning-soft text-warning',
          )}
          {expiryUrgent > 0 && row(
            t('expiry.bellTitle'),
            t('expiry.bellCount', { count: expiryUrgent }),
            <CalendarClock className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/expiry'),
            'bg-warning-soft text-warning',
          )}
          {awaitingReturn > 0 && row(
            t('nav.bell.awaitingReturnTitle'),
            t('nav.bell.awaitingReturn', { count: awaitingReturn }),
            <ClipboardCheck className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/leaves', { state: { awaitingReturn: true } }),
            'bg-info-soft text-info',
          )}
          {scanInbox > 0 && row(
            t('scanInbox.bellTitle'),
            t('scanInbox.bellCount', { count: scanInbox }),
            <ScanLine className="h-4 w-4" strokeWidth={1.8} />,
            () => navigate('/scan-inbox'),
            'bg-info-soft text-info',
          )}
          {hasNothing && (
            <EmptyState
              icon={Inbox}
              animated
              message={t('appBar.noNotifications', { defaultValue: 'No pending notifications' })}
              className="py-10"
            />
          )}
        </div>
      )}
    </div>
  )
}
