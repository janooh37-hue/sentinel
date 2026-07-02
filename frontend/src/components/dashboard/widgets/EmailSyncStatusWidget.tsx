/**
 * EmailSyncStatusWidget — bottom-row dashboard tile reflecting the IMAP sync
 * state. Big number is today's incoming-email count; breakdown describes
 * last-sync recency, configured interval, and on/off status.
 *
 * Action: when an email account is configured, fires the existing
 * `POST /email/sync` mutation directly. When not configured, navigates to
 * Settings so the operator can wire one up.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { WidgetCard, type BreakdownRow } from '@/components/ui/widget-card'
import { api, type DashboardSummary, apiErrorMessage } from '@/lib/api'
import { parseUtcMs } from '@/lib/time'

interface Props {
  summary: DashboardSummary | undefined
}

/**
 * Minutes elapsed between `iso` and `now()`, rounded down. Returns `null`
 * when the timestamp is missing or unparseable. The backend serializes
 * naive-UTC timestamps with no zone suffix, so parse via `parseUtcMs` (which
 * appends "Z") rather than bare `Date.parse` — otherwise the value is read as
 * local time and the freshness/"Live" pill skews by the UTC offset.
 */
function minutesSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = parseUtcMs(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 60_000))
}

export function EmailSyncStatusWidget({ summary }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const emailSync = summary?.email_sync

  // Trigger `POST /email/sync`. This widget is the user's "I want fresh mail
  // right now" entry point — bypass the scheduled job. On success we
  // invalidate the dashboard + ledger + email-account queries so the freshly
  // synced counts/sync timestamp flow through the rest of the UI.
  const syncMutation = useMutation({
    mutationFn: () => api.syncEmail(),
    onSuccess: (r) => {
      toast.success(
        t('settings.email.syncOk', {
          imported: r.imported,
          skipped: r.skipped_duplicate,
          defaultValue: 'Imported {{imported}}, skipped {{skipped}}',
        }),
      )
      void qc.invalidateQueries({ queryKey: ['dashboard'] })
      void qc.invalidateQueries({ queryKey: ['email-account'] })
      void qc.invalidateQueries({ queryKey: ['ledger'] })
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const total = emailSync?.incoming_today ?? 0
  const ageMin = minutesSince(emailSync?.last_synced_at)
  const enabled = emailSync?.enabled ?? false
  const interval = emailSync?.interval_minutes ?? 0

  // Status pill — three flavours:
  //   • not configured / disabled → warn ("Off")
  //   • freshly synced (<5 min)   → steady "Live"
  //   • otherwise                  → steady "Synced"
  const delta = !enabled
    ? { tone: 'warn' as const, label: t('dashboard.widgets.emailSync.deltaOff') }
    : ageMin !== null && ageMin < 5
      ? { tone: 'steady' as const, label: t('dashboard.widgets.emailSync.deltaLive') }
      : { tone: 'steady' as const, label: t('dashboard.widgets.emailSync.deltaSynced') }

  // Humanize the raw minutes value: < 60 → "N min ago", < 1440 → "Nh ago",
  // otherwise "Nd ago". Uses count-based i18n keys so Arabic plural forms work.
  const syncAgoLabel =
    ageMin === null
      ? t('dashboard.widgets.emailSync.never')
      : ageMin < 60
        ? t('dashboard.widgets.emailSync.minutesAgo', { count: ageMin })
        : ageMin < 1440
          ? t('dashboard.widgets.emailSync.hoursAgo', { count: Math.floor(ageMin / 60) })
          : t('dashboard.widgets.emailSync.daysAgo', { count: Math.floor(ageMin / 1440) })

  const breakdown: BreakdownRow[] = [
    {
      color: 'primary',
      label: t('dashboard.widgets.emailSync.lastSync'),
      value: syncAgoLabel,
    },
    {
      color: 'accent',
      label: t('dashboard.widgets.emailSync.interval'),
      value: interval === 0
        ? t('dashboard.widgets.emailSync.intervalOff')
        : t('dashboard.widgets.emailSync.minutesUnit', { count: interval }),
    },
    {
      color: enabled ? 'success' : 'warning',
      label: t('dashboard.widgets.emailSync.status'),
      value: enabled
        ? t('dashboard.widgets.emailSync.statusActive')
        : t('dashboard.widgets.emailSync.statusOff'),
    },
  ]

  return (
    <WidgetCard
      header={t('dashboard.widgets.emailSync.header')}
      big={total}
      delta={delta}
      breakdown={breakdown}
      actionLabel={
        enabled
          ? t('dashboard.widgets.emailSync.actionSync')
          : t('dashboard.widgets.emailSync.actionConfigure')
      }
      onAction={() => {
        if (enabled) syncMutation.mutate()
        else navigate('/settings')
      }}
    />
  )
}
