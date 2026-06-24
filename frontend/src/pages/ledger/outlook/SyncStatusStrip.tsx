/**
 * SyncStatusStrip — a slim sync-status bar pinned to the TOP of the message
 * list (the middle pane), where it's actually seen. (It used to live, easily
 * missed and cropped, at the foot of the FolderRail — moved 2026-06-12.)
 *
 * Four states: idle (✓ Updated N ago) · syncing (spinner, button disabled) ·
 * error (⚠ Sync failed + Retry, stored error in the title) · off (Sync off +
 * Settings link). Glyph + text in every state — never color alone. The state
 * line is `role="status" aria-live="polite"`; the timestamp tooltip is the
 * absolute stamp.
 *
 * Sync-now calls the existing POST /email/sync. A 409 means a run is already
 * in flight (manual or scheduler) — not an error; the strip keeps narrating.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'

import { ApiError, api, type EmailSyncStatus } from '@/lib/api'
import { parseUtcMs } from '@/lib/time'
import { cn } from '@/lib/utils'

interface SyncStatusStripProps {
  status: EmailSyncStatus | undefined
}

/**
 * Humanize minutes-since like the Dashboard widget: <60 → min, <1440 → h,
 * else d. A plain (non-hook) helper, mirroring `minutesSince` in
 * EmailSyncStatusWidget — the React Compiler purity rule rejects `Date.now()`
 * inside hooks/components.
 */
function agoLabel(t: TFunction, iso: string | null | undefined): string {
  if (!iso) return t('ledger.outlook.sync.never')
  const ms = Date.now() - parseUtcMs(iso)
  if (Number.isNaN(ms)) return t('ledger.outlook.sync.never')
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 1) return t('ledger.outlook.sync.justNow')
  if (min < 60) return t('ledger.outlook.sync.minutesAgo', { count: min })
  if (min < 1440) return t('ledger.outlook.sync.hoursAgo', { count: Math.floor(min / 60) })
  return t('ledger.outlook.sync.daysAgo', { count: Math.floor(min / 1440) })
}

export function SyncStatusStrip({ status }: SyncStatusStripProps): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const syncing = status?.syncing ?? false
  const enabled = status?.enabled ?? true // optimistic until first payload
  const error = status?.last_sync_error ?? null

  const syncMutation = useMutation({
    mutationFn: () => api.syncEmail(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
      void queryClient.invalidateQueries({ queryKey: ['ledger-unread-count'] })
      void queryClient.invalidateQueries({ queryKey: ['ledger-log'] })
      void queryClient.invalidateQueries({ queryKey: ['email-sync-status'] })
    },
    onError: (err) => {
      // 409 = a sync is already running (scheduler tick or another client) —
      // that is exactly what the strip narrates; don't toast it as a failure.
      if (err instanceof ApiError && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: ['email-sync-status'] })
        return
      }
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const busy = syncing || syncMutation.isPending

  // Pick the narration line.
  const narration = !enabled
    ? t('ledger.outlook.sync.off')
    : busy
      ? t('ledger.outlook.sync.syncing')
      : error
        ? t('ledger.outlook.sync.failed')
        : status?.last_synced_at
          ? t('ledger.outlook.sync.updatedAgo', { when: agoLabel(t, status.last_synced_at) })
          : t('ledger.outlook.sync.never')

  // Never-synced (enabled, idle, no error, no timestamp) is NEUTRAL, not green —
  // a green ✓ next to "Not synced yet" would be contradictory.
  const neverSynced = !status?.last_synced_at

  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-3.5 py-1.5 text-[0.72em] text-faint">
      <span role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-1.5">
        {/* state glyph — paired with text, never color alone */}
        {!enabled ? (
          <span aria-hidden>○</span>
        ) : busy ? (
          <RefreshCw className="h-3 w-3 flex-none animate-spin text-info motion-reduce:animate-none" aria-hidden />
        ) : error ? (
          <span className="text-warning" aria-hidden>⚠</span>
        ) : neverSynced ? (
          <span aria-hidden>○</span>
        ) : (
          <span className="text-success" aria-hidden>✓</span>
        )}
        <span
          className={cn(
            'truncate',
            (busy || error || !enabled) && 'font-semibold text-foreground',
          )}
          dir="auto"
          title={
            error ??
            (status?.last_synced_at ? new Date(parseUtcMs(status.last_synced_at)).toLocaleString() : undefined)
          }
        >
          {narration}
        </span>
      </span>
      {!enabled ? (
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="flex-none rounded-sm px-1.5 py-0.5 font-semibold text-foreground underline underline-offset-2 transition-colors hover:bg-surface-tinted"
        >
          {t('ledger.outlook.sync.openSettings')}
        </button>
      ) : error && !busy ? (
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-foreground underline underline-offset-2 transition-colors hover:bg-surface-tinted"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          {t('ledger.outlook.sync.retry')}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => syncMutation.mutate()}
          disabled={busy || !enabled}
          aria-label={busy ? t('ledger.outlook.sync.inProgress') : t('ledger.outlook.sync.syncNow')}
          title={busy ? t('ledger.outlook.sync.inProgress') : t('ledger.outlook.sync.syncNow')}
          className={cn(
            'inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-muted-foreground transition-colors',
            'hover:bg-surface-tinted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          <RefreshCw
            className={cn('h-3 w-3', busy && 'animate-spin motion-reduce:animate-none')}
            aria-hidden
          />
          {t('ledger.outlook.sync.syncNow')}
        </button>
      )}
    </div>
  )
}
