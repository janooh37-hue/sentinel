/**
 * PermissionRequestsTab — admin view of pending capability-permission requests.
 *
 * Listed under the "Permission requests" tab on AccessRequestsPage.
 * Each row shows requester name, capability label + description, relative time
 * of the request, and three action buttons:
 *   - Grant once (with a 2h / today / this week window picker)
 *   - Grant permanent
 *   - Refuse (optional note)
 *
 * On any decide success: invalidates ['permission-requests'], ['user-permissions'],
 * and ['users'] so that other tabs and permission sheets reflect the change.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { BadgeCheck, Check, Clock, Inbox, X } from 'lucide-react'

import { api, ApiError, type PermissionRequestRead } from '@/lib/api'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

// ---------------------------------------------------------------------------
// Time helpers (inline — mirrors AccessRequestsPage's relativeTime/parseTs)
// ---------------------------------------------------------------------------

function parseTs(iso: string): number {
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)
  return new Date(hasTz ? iso : `${iso}Z`).getTime()
}

function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return ''
  const then = parseTs(iso)
  if (Number.isNaN(then)) return ''
  const diffMs = then - Date.now()
  const abs = Math.abs(diffMs)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const min = 60_000
  const hr = 60 * min
  const day = 24 * hr
  if (abs < min) return rtf.format(0, 'minute')
  if (abs < hr) return rtf.format(Math.round(diffMs / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diffMs / hr), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diffMs / day), 'day')
  return new Date(then).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Window = '2h' | 'today' | 'week'

// ---------------------------------------------------------------------------
// PermissionRequestCard
// ---------------------------------------------------------------------------

function PermissionRequestCard({
  req,
  capDesc,
  deciding,
  onDecide,
}: {
  req: PermissionRequestRead
  capDesc: string
  deciding: boolean
  onDecide: (id: number, decision: 'once' | 'permanent' | 'refused', opts?: { window?: Window; note?: string }) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const [refuseOpen, setRefuseOpen] = useState(false)
  const [refuseNote, setRefuseNote] = useState('')
  const [window, setWindow] = useState<Window>('2h')

  const windows: { id: Window; label: string }[] = [
    { id: '2h', label: t('access.permReq.window2h') },
    { id: 'today', label: t('access.permReq.windowToday') },
    { id: 'week', label: t('access.permReq.windowWeek') },
  ]

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors sm:p-5 ${
        deciding
          ? 'border-success/40 bg-success-soft/40'
          : 'border-hairline bg-surface hover:border-border'
      }`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start gap-3">
        {/* Capability badge */}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <BadgeCheck className="h-5 w-5" strokeWidth={1.8} />
        </span>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.95em] font-semibold text-foreground" dir="auto">
              {req.requester_name ?? `#${req.user_id}`}
            </span>
            <span className="rounded-full bg-surface-tinted px-2 py-0.5 text-[0.72em] font-medium text-muted-foreground">
              {req.capability_label}
            </span>
          </div>
          {capDesc && (
            <p className="mt-1 text-[0.82em] leading-snug text-muted-foreground">{capDesc}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1 text-[0.78em] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" strokeWidth={1.8} />
            <span>
              {t('access.permReq.asked')} {relativeTime(req.created_at, locale)}
            </span>
          </div>
        </div>
      </div>

      {/* Action row */}
      {!refuseOpen ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-hairline pt-3">
          {/* Grant once — window picker + button */}
          <div className="flex items-center rounded-full border border-hairline bg-surface shadow-sm">
            {windows.map((w) => (
              <button
                key={w.id}
                type="button"
                disabled={deciding}
                onClick={() => setWindow(w.id)}
                className={`rounded-full px-2.5 py-1 text-[0.75em] font-medium transition-colors ${
                  window === w.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                } disabled:opacity-50`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(req.id, 'once', { window })}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[0.82em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {deciding ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {t('access.permReq.grantOnce')}
          </button>

          {/* Grant permanent */}
          <button
            type="button"
            disabled={deciding}
            onClick={() => onDecide(req.id, 'permanent')}
            className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-3.5 py-1.5 text-[0.82em] font-semibold text-success transition-colors hover:bg-success-soft/80 disabled:opacity-60"
          >
            <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
            {t('access.permReq.grantPermanent')}
          </button>

          {/* Refuse */}
          <button
            type="button"
            disabled={deciding}
            onClick={() => setRefuseOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-3.5 py-1.5 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
            {t('access.permReq.refuse')}
          </button>
        </div>
      ) : (
        /* Refuse inline form */
        <div className="mt-3 flex flex-col gap-2 border-t border-dashed border-hairline pt-3">
          <input
            autoFocus
            type="text"
            value={refuseNote}
            onChange={(e) => setRefuseNote(e.target.value)}
            placeholder={t('access.permReq.refuseNotePlaceholder')}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-[0.88em] text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRefuseOpen(false); setRefuseNote('') }}
              className="rounded-full px-4 py-1.5 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
            >
              {t('access.permReq.cancel')}
            </button>
            <button
              type="button"
              disabled={deciding}
              onClick={() => onDecide(req.id, 'refused', { note: refuseNote || undefined })}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[0.82em] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
              {t('access.permReq.refuse')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PermissionRequestsTab (exported)
// ---------------------------------------------------------------------------

export function PermissionRequestsTab(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [decidingId, setDecidingId] = useState<number | null>(null)

  const requestsQuery = useQuery({
    queryKey: ['permission-requests'],
    queryFn: () => api.listPermissionRequests(),
  })

  const capsQuery = useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.listCapabilities(),
  })

  // Build a quick lookup: capability id → description
  const capDescMap = new Map<string, string>()
  for (const cap of capsQuery.data ?? []) {
    capDescMap.set(cap.id, cap.description)
  }

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ['permission-requests'] })
    void qc.invalidateQueries({ queryKey: ['user-permissions'] })
    void qc.invalidateQueries({ queryKey: ['users'] })
  }

  const decideMut = useMutation({
    mutationFn: ({
      id,
      decision,
      window,
      note,
    }: {
      id: number
      decision: 'once' | 'permanent' | 'refused'
      window?: Window
      note?: string
    }) =>
      api.decidePermissionRequest(id, {
        decision,
        ...(window ? { window } : {}),
        ...(note ? { note } : {}),
      }),
    onMutate: ({ id }) => setDecidingId(id),
    onSuccess: (_data, vars) => {
      if (vars.decision === 'refused') {
        toast.success(t('access.permReq.toastRefused'))
      } else {
        toast.success(t('access.permReq.toastGranted'))
      }
      invalidate()
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e))
    },
    onSettled: () => setDecidingId(null),
  })

  function handleDecide(
    id: number,
    decision: 'once' | 'permanent' | 'refused',
    opts?: { window?: Window; note?: string },
  ): void {
    decideMut.mutate({ id, decision, window: opts?.window, note: opts?.note })
  }

  const pending = requestsQuery.data ?? []

  if (requestsQuery.isPending) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    )
  }

  if (requestsQuery.isError) {
    return <EmptyState icon={Inbox} message={t('access.loadError')} className="py-12" />
  }

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={Check}
        message={t('access.permReq.empty')}
        className="py-16"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {pending.map((req: PermissionRequestRead) => (
        <PermissionRequestCard
          key={req.id}
          req={req}
          capDesc={capDescMap.get(req.capability) ?? ''}
          deciding={decidingId === req.id}
          onDecide={handleDecide}
        />
      ))}
    </div>
  )
}
