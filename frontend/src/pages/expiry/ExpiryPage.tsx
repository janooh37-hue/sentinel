/**
 * ExpiryPage — filterable list of Emirates ID and passport expiry across
 * active employees. Gated on `employees.view` (server-enforced; page is
 * reachable for any authenticated user, the API returns the data).
 *
 * Filters:
 *  - type: all / uae_id / passport
 *  - window: ≤30d / ≤90d / expired-only / all (3650d)
 *  - search: client-side name/id filter
 *
 * Row click → /employees/:id
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, CalendarClock, Clock } from 'lucide-react'

import { api, type ExpiryItem } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ─── types ───────────────────────────────────────────────────────────────────

type DocTypeFilter = 'all' | 'uae_id' | 'passport'

/** Maps the UI window key to the `within` query arg and whether to apply a
 * client-side "expired only" filter. */
interface WindowOption {
  key: string
  within: number
  expiredOnly: boolean
}

const WINDOW_OPTIONS: WindowOption[] = [
  { key: 'window30', within: 30, expiredOnly: false },
  { key: 'window90', within: 90, expiredOnly: false },
  { key: 'windowExpired', within: 3650, expiredOnly: true },
  { key: 'windowAll', within: 3650, expiredOnly: false },
]

// ─── urgency helpers ──────────────────────────────────────────────────────────

interface UrgencyConfig {
  icon: React.ComponentType<{ className?: string }>
  colorClass: string
}

const URGENCY_CONFIG: Record<ExpiryItem['bucket'], UrgencyConfig> = {
  expired: { icon: AlertOctagon, colorClass: 'text-destructive' },
  critical: { icon: AlertTriangle, colorClass: 'text-warning' },
  soon: { icon: Clock, colorClass: 'text-muted-foreground' },
}

// ─── row ─────────────────────────────────────────────────────────────────────

interface ExpiryRowProps {
  item: ExpiryItem
  language: string
  onClick: () => void
}

function ExpiryRow({ item, language, onClick }: ExpiryRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { icon: Icon, colorClass } = URGENCY_CONFIG[item.bucket]
  const days = Math.abs(item.days_remaining)
  const urgencyLabel = t(`expiry.urgency.${item.bucket}`, { days })

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {/* Urgency icon */}
      <Icon className={cn('h-4 w-4 shrink-0', colorClass)} aria-hidden />

      {/* Name + id */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.88em] font-semibold text-foreground">
          {pickEmployeeName(item, language)}
        </div>
        <div className="mt-0.5 font-mono text-[0.74em] text-muted-foreground">
          {item.employee_id}
        </div>
      </div>

      {/* Doc-type chip */}
      <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-0.5 text-[0.72em] font-medium text-foreground">
        {t(`expiry.docType.${item.doc_type}`)}
      </span>

      {/* Expiry date */}
      <span className="hidden shrink-0 font-mono text-[0.74em] text-muted-foreground md:inline">
        {item.expiry_date}
      </span>

      {/* Urgency label */}
      <span className={cn('shrink-0 text-[0.78em] font-medium', colorClass)}>
        {urgencyLabel}
      </span>
    </button>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export function ExpiryPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const [docType, setDocType] = useState<DocTypeFilter>('all')
  const [windowKey, setWindowKey] = useState('window90')
  const [search, setSearch] = useState('')

  const windowOption = WINDOW_OPTIONS.find((o) => o.key === windowKey) ?? WINDOW_OPTIONS[1]!

  const query = useQuery({
    queryKey: ['expiry', windowOption.within, docType],
    queryFn: () => api.getExpiry(windowOption.within, docType),
  })

  const rows = useMemo(() => {
    let items = query.data ?? []
    // Client-side "expired only" for the windowExpired option
    if (windowOption.expiredOnly) {
      items = items.filter((i) => i.days_remaining < 0)
    }
    // Client-side search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      items = items.filter(
        (i) =>
          i.name_en.toLowerCase().includes(q) ||
          (i.name_ar?.toLowerCase().includes(q) ?? false) ||
          i.employee_id.toLowerCase().includes(q),
      )
    }
    return items
  }, [query.data, windowOption.expiredOnly, search])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-6 md:px-8">
        {/* ───── Header ───── */}
        <header className="mb-5">
          <div className="text-[0.75em] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t('expiry.eyebrow')}
          </div>
          <h2 className="mt-1 text-[1.7em] font-bold tracking-tight text-foreground">
            {t('expiry.title')}
          </h2>
          <div className="mt-1 text-[0.86em] text-muted-foreground">
            {t('expiry.subtitle')}
          </div>
        </header>

        {/* ───── Filter bar ───── */}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-surface px-4 py-3">
          {/* Search */}
          <Input
            placeholder={t('expiry.filters.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 md:max-w-xs md:flex-none"
          />

          {/* Document type */}
          <Select value={docType} onValueChange={(v) => setDocType(v as DocTypeFilter)}>
            <SelectTrigger
              aria-label={t('expiry.filters.type')}
              className="h-8 w-[160px] text-[0.82em]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('expiry.filters.typeAll')}</SelectItem>
              <SelectItem value="uae_id">{t('expiry.filters.typeUaeId')}</SelectItem>
              <SelectItem value="passport">{t('expiry.filters.typePassport')}</SelectItem>
            </SelectContent>
          </Select>

          {/* Window */}
          <Select value={windowKey} onValueChange={setWindowKey}>
            <SelectTrigger
              aria-label={t('expiry.filters.window')}
              className="h-8 w-[200px] text-[0.82em]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {t(`expiry.filters.${o.key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Result count */}
          {!query.isPending && (
            <div className="ms-auto font-mono text-[0.75em] text-muted-foreground">
              {rows.length}
            </div>
          )}
        </div>

        {/* ───── List ───── */}
        <div className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          {query.isPending ? (
            <div className="flex flex-col">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-2.5 w-1/5" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={CalendarClock}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void query.refetch()}
            />
          ) : rows.length === 0 ? (
            <EmptyState icon={CalendarClock} message={t('expiry.empty')} />
          ) : (
            <div className="divide-y divide-hairline">
              {rows.map((item) => (
                <ExpiryRow
                  key={`${item.employee_id}-${item.doc_type}`}
                  item={item}
                  language={i18n.language}
                  onClick={() => navigate(`/employees/${encodeURIComponent(item.employee_id)}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
