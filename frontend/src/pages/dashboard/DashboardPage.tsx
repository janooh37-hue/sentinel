/**
 * Dashboard landing page — Task 5 (TAMM redesign).
 *
 * Sections (top-to-bottom):
 *   1. Hero card with rotating GSSG crest + welcome message
 *   2. "My Widgets" header + edit affordance
 *   3. 2-up grid: Pending Documents (red progress bar) + Workspace (mountain SVG)
 *   4. 3-up grid: Open Violations · Drafts · Ledger unread (WidgetCard)
 *   5. "Quick Actions" header + View All
 *   6. 4-up grid: navy-accented ServiceTile rail
 *   7. Recent activity (preserved from Phase 12, restyled)
 *
 * Data source: GET /api/v1/dashboard/summary (Phase 12 endpoint, unchanged).
 * Where the summary doesn't carry a metric needed by a widget (e.g. violations
 * by status, drafts by template), we render the structure with 0 / hidden
 * rows rather than inventing API fields. See task spec §"In Over Your Head".
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { format, parseISO, type Locale } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import {
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  FileText,
  Pencil,
  ScrollText,
  type LucideIcon,
} from 'lucide-react'

import { api } from '@/lib/api'
import type {
  AppSettingsRead,
  DashboardOnLeaveItem,
  DashboardRecentDocument,
  DashboardRecentLedger,
  DashboardSummary,
  DashboardUpcomingItem,
} from '@/lib/api'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ServiceTile } from '@/components/ui/service-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { WidgetCard, type BreakdownRow } from '@/components/ui/widget-card'
import { WidgetEditDialog } from '@/components/dashboard/WidgetEditDialog'
import { CustomizeWidgetsDialog } from '@/components/dashboard/CustomizeWidgetsDialog'
import { EmailSyncStatusWidget } from '@/components/dashboard/widgets/EmailSyncStatusWidget'
import { BooksAwaitingWidget } from '@/pages/dashboard/widgets/BooksAwaitingWidget'
import { ExpiringSoonWidget } from '@/pages/dashboard/widgets/ExpiringSoonWidget'
import { WaitingApprovalsCard } from '@/pages/dashboard/widgets/WaitingApprovalsCard'
import {
  DEFAULT_LAYOUT,
  MAX_VISIBLE_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
  WIDGET_IDS,
  WIDGET_SIZE,
  resolveLayout,
  visibleByZone,
  widgetsForApi,
  type QuickActionId,
  type WidgetId,
  type WidgetZone,
} from '@/lib/dashboardLayout'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { useIdentity } from '@/lib/useIdentity'
import { cn } from '@/lib/utils'

export type DashboardPage =
  | 'employees'
  | 'application'
  | 'books'
  | 'leaves'
  | 'ledger'
  | 'settings'
  | 'dashboard'

export interface DashboardPageProps {
  onNavigate: (page: DashboardPage) => void
}

interface NameLike {
  employee_name_en: string
  employee_name_ar: string | null
}

function pickName(item: NameLike, isAr: boolean): string {
  if (isAr && item.employee_name_ar) return item.employee_name_ar
  return item.employee_name_en
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Arabic family-name connectors that must stay glued to the word after them,
 *  so "آل علي" / "آل منصوري" survive shortening as one family name (not "علي"). */
const FAMILY_CONNECTORS = new Set(['آل', 'ال', 'أبو', 'ابو', 'بن', 'ابن', 'بنت', 'عبد'])

/** Shorten a full name to "First Second Family". GSSG names run 5+ tokens,
 *  which blows up the hero greeting (wraps on a phone). The family name keeps
 *  its Arabic prefix attached — in Arabic "... آل علي" is two tokens, so the
 *  bare last-token rule dropped the "آل". */
function firstSecondFamilyName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  // Family name = last token, plus a preceding connector token if present.
  let famStart = parts.length - 1
  if (famStart > 0 && FAMILY_CONNECTORS.has(parts[famStart - 1]!)) famStart -= 1
  const family = parts.slice(famStart).join(' ')
  const given = parts.slice(0, Math.min(2, famStart)).join(' ')
  return given ? `${given} ${family}` : family
}

/** Time-of-day greeting bucket from the local clock. */
function heroGreetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

/** Today's Hijri date in Arabic-Indic numerals (umm al-qura), regardless of
 *  UI language — the UAE context stays present even in the English hero.
 *  Returns '' if the runtime lacks the islamic calendar (graceful omit). */
function hijriToday(): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date())
  } catch {
    return ''
  }
}

/** Join names with a locale-aware list conjunction ("A, B and C" / "A، B و C"). */
function joinNames(names: string[], isAr: boolean): string {
  if (names.length <= 1) return names[0] ?? ''
  const sep = isAr ? '، ' : ', '
  const and = isAr ? ' و ' : ' and '
  return names.slice(0, -1).join(sep) + and + names[names.length - 1]
}

export function DashboardPage({ onNavigate }: DashboardPageProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const dfLocale = isAr ? arLocale : undefined
  const { identity } = useIdentity()
  const qc = useQueryClient()
  const navigate = useNavigate()

  // Row-level deep-link helper for recent-activity sections. The destination
  // page reads `?open=<id>` and auto-opens that entry's detail surface (drawer
  // or scrolled row). When a destination doesn't support per-item opening,
  // the query param is silently ignored.
  const openItem = useCallback(
    (target: 'leaves' | 'books' | 'ledger', id: number | string) => {
      navigate(`/${target}?open=${id}`)
    },
    [navigate],
  )

  const summaryQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboardSummary,
    staleTime: 60_000,
  })

  const summary: DashboardSummary | undefined = summaryQuery.data

  // Layout: read user-saved dashboard layout from `/settings`; fall back to
  // `DEFAULT_LAYOUT` when the user hasn't customised. Reused across both
  // edit dialogs and the rendering loop.
  const settingsQuery = useQuery<AppSettingsRead>({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })
  const layout = useMemo(
    () => resolveLayout(settingsQuery.data?.dashboard_layout ?? null),
    [settingsQuery.data?.dashboard_layout],
  )

  const updateSettings = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success(isAr ? 'تم حفظ تخطيط لوحة التحكم' : 'Dashboard layout saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const [widgetDialogOpen, setWidgetDialogOpen] = useState(false)
  const [quickActionsDialogOpen, setQuickActionsDialogOpen] = useState(false)

  // Labels for every widget id — fed into the Customize dialog.
  const widgetLabels = useMemo<Record<WidgetId, string>>(() => {
    const out = {} as Record<WidgetId, string>
    for (const id of WIDGET_IDS) {
      out[id] = t(`dashboard.widgetLabels.${id}`)
    }
    return out
  }, [t])
  // Build all 20 labels from QUICK_ACTION_IDS using each ID's slug. Slugs are
  // declared on QUICK_ACTION_META — see lib/quickActions.ts. This way adding
  // a new quick action only requires touching the layout + meta files plus
  // the i18n JSON; no per-ID branch lives here.
  const quickActionLabels = useMemo<Record<QuickActionId, string>>(() => {
    const out = {} as Record<QuickActionId, string>
    for (const id of QUICK_ACTION_IDS) {
      const slug = QUICK_ACTION_META[id].slug
      out[id] = t(`dashboard.quickActionLabels.${slug}`)
    }
    return out
  }, [t])
  // Optional per-ID description (rendered below the tile title). Falls back
  // to an empty string when the key isn't defined (i18next's defaultValue
  // suppresses the "missing key" warning + lets the tile render with no
  // description line).
  const quickActionDescriptions = useMemo<Record<QuickActionId, string>>(() => {
    const out = {} as Record<QuickActionId, string>
    for (const id of QUICK_ACTION_IDS) {
      const slug = QUICK_ACTION_META[id].slug
      out[id] = t(`dashboard.quickActionDesc.${slug}`, { defaultValue: '' })
    }
    return out
  }, [t])

  // Welcome name from useIdentity, falling back to a generic greeting.
  const welcomeName = useMemo(() => {
    if (!identity?.linked) return null
    const full = isAr && identity.name_ar ? identity.name_ar : identity.name_en
    return full ? firstSecondFamilyName(full) : null
  }, [identity, isAr])

  // Returners-from-leave whose leave ends today (days_remaining <= 0) — the
  // honest signal behind the hero insight line. Names are language-aware.
  const heroReturners = useMemo<HeroReturner[]>(() => {
    const rows = summary?.upcoming_leave_ends ?? []
    return rows
      .filter((r) => r.days_remaining <= 0)
      .map((r) => ({ name: pickName(r, isAr), employee_id: r.employee_id }))
  }, [summary, isAr])

  // Ledger unread counts — derived from the `recent_ledger` snapshot (latest
  // entries in the summary payload). The summary doesn't carry a strict
  // "unread" flag, so we use latest-activity by direction as the closest
  // honest proxy. The big number is the total; breakdown is by direction.
  const ledgerByDirection = useMemo(() => {
    const rows = summary?.recent_ledger ?? []
    const counts = { incoming: 0, outgoing: 0, internal: 0 }
    for (const r of rows) {
      if (r.direction === 'incoming') counts.incoming += 1
      else if (r.direction === 'outgoing') counts.outgoing += 1
      else counts.internal += 1
    }
    return counts
  }, [summary])

  const zones = useMemo(() => visibleByZone(layout.widgets), [layout.widgets])

  // Quick-action grid: render whatever's marked `visible` in the saved
  // layout, sorted by `order`, capped at MAX_VISIBLE_QUICK_ACTIONS. The
  // grid is 4-col, so values >4 wrap onto a second row. The full pool
  // (visible + hidden) is fed to the edit dialog so the operator can
  // promote a hidden tile back into view.
  const visibleQuickActions = useMemo(
    () => layout.quick_actions.filter((q) => q.visible).slice(0, MAX_VISIBLE_QUICK_ACTIONS),
    [layout.quick_actions],
  )

  // Render a single widget by id, parameterised by the zone it sits in so
  // `waiting_approvals` can show a glance card up top and the full queue
  // below. Capability-gated widgets self-hide (return null) internally.
  const renderWidget = (id: WidgetId, zone: WidgetZone): React.JSX.Element | null => {
    switch (id) {
      case 'pending':
        return (
          <PendingDocumentsCard
            docsCount={summary?.totals.forms_this_month ?? 0}
            currency={t('dashboard.pending.currency')}
            header={t('dashboard.pending.title')}
            reviewLabel={t('dashboard.pending.review')}
            footnote={t('dashboard.pending.footnote', {
              count: summary?.totals.forms_this_month ?? 0,
            })}
            onClick={() => {
              try {
                localStorage.setItem('gssg.books.filter', 'recent')
              } catch {
                /* ignore */
              }
              onNavigate('books')
            }}
            isLoading={summaryQuery.isPending}
          />
        )
      case 'workspace':
        return (
          <WorkspaceCard
            staff={summary?.totals.employees_active ?? 0}
            header={t('dashboard.workspace.title')}
            currency={t('dashboard.workspace.staff')}
            activeLabel={t('dashboard.workspace.active', {
              count: summary?.totals.present_today ?? 0,
            })}
            onLeaveLabel={t('dashboard.workspace.onLeave', {
              count: summary?.totals.on_leave_today ?? 0,
            })}
            onClick={() => onNavigate('employees')}
            isLoading={summaryQuery.isPending}
          />
        )
      case 'waiting_approvals':
        return zone === 'top' ? (
          <WaitingApprovalsCard onReview={() => navigate('/books?status=pending')} />
        ) : (
          <BooksAwaitingWidget />
        )
      case 'violations': {
        const openViolations = summary?.totals.open_violations_count ?? 0
        return (
          <WidgetCard
            header={t('dashboard.widgets.violations.header')}
            big={openViolations}
            delta={
              openViolations > 0
                ? { tone: 'warn', label: t('dashboard.widgets.violations.deltaWarn', { count: openViolations }) }
                : { tone: 'steady', label: t('dashboard.widgets.violations.deltaSteady') }
            }
            breakdown={[
              { color: 'accent', label: t('dashboard.widgets.violations.active'), value: openViolations },
              { color: 'warning', label: t('dashboard.widgets.violations.escalated'), value: 0 },
              { color: 'success', label: t('dashboard.widgets.violations.pendingClose'), value: 0 },
            ] satisfies BreakdownRow[]}
            actionLabel={t('dashboard.widgets.violations.action')}
            onAction={() => onNavigate('employees')}
          />
        )
      }
      case 'drafts': {
        const draftCount = summary?.totals.book_draft_count ?? 0
        return (
          <WidgetCard
            header={t('dashboard.widgets.drafts.header')}
            big={draftCount}
            delta={
              draftCount > 0
                ? { tone: 'warn', label: t('dashboard.widgets.drafts.deltaWarn', { count: draftCount }) }
                : { tone: 'steady', label: t('dashboard.widgets.drafts.deltaSteady') }
            }
            actionLabel={t('dashboard.widgets.drafts.action')}
            onAction={() => navigate('/books?status=none')}
          />
        )
      }
      case 'ledger':
        return (
          <WidgetCard
            header={t('dashboard.widgets.ledger.header')}
            big={ledgerByDirection.incoming + ledgerByDirection.outgoing + ledgerByDirection.internal}
            delta={
              ledgerByDirection.incoming > 0
                ? { tone: 'warn', label: t('dashboard.widgets.ledger.deltaWarn', { count: ledgerByDirection.incoming }) }
                : { tone: 'steady', label: t('dashboard.widgets.ledger.deltaSteady') }
            }
            breakdown={[
              { color: 'success', label: t('dashboard.widgets.ledger.incoming'), value: ledgerByDirection.incoming },
              { color: 'accent', label: t('dashboard.widgets.ledger.outgoing'), value: ledgerByDirection.outgoing },
              { color: 'primary', label: t('dashboard.widgets.ledger.internal'), value: ledgerByDirection.internal },
            ] satisfies BreakdownRow[]}
            meta={t('dashboard.widgets.ledger.metaRecent', { count: summary?.recent_ledger.length ?? 0 })}
            actionLabel={t('dashboard.widgets.ledger.action')}
            onAction={() => onNavigate('ledger')}
          />
        )
      case 'email_sync_status':
        return <EmailSyncStatusWidget summary={summary} />
      case 'expiring_soon':
        return <ExpiringSoonWidget />
      case 'on_leave_today':
        return (
          <SectionCard icon={CalendarCheck} title={t('dashboard.onLeave.title')} count={summary?.on_leave_today.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.on_leave_today.length === 0 ? (
              <EmptyState icon={CalendarCheck} message={t('dashboard.onLeave.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.on_leave_today.map((item) => (
                  <OnLeaveRow
                    key={item.leave_id}
                    item={item}
                    isAr={isAr}
                    untilLabel={t('dashboard.onLeave.until', { date: item.end_date })}
                    onOpen={() => openItem('leaves', item.leave_id)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )
      case 'upcoming_leave':
        return (
          <SectionCard icon={CalendarClock} title={t('dashboard.upcoming.title')} count={summary?.upcoming_leave_ends.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.upcoming_leave_ends.length === 0 ? (
              <EmptyState icon={CalendarClock} message={t('dashboard.upcoming.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.upcoming_leave_ends.map((item) => (
                  <UpcomingRow
                    key={item.leave_id}
                    item={item}
                    isAr={isAr}
                    label={
                      item.days_remaining <= 0
                        ? t('dashboard.upcoming.endsToday')
                        : item.days_remaining === 1
                          ? t('dashboard.upcoming.endsTomorrow')
                          : t('dashboard.upcoming.endsIn', { days: item.days_remaining })
                    }
                    onOpen={() => openItem('leaves', item.leave_id)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )
      case 'recent_docs':
        return (
          <SectionCard icon={FileText} title={t('dashboard.recent.documents')} count={summary?.recent_documents.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.recent_documents.length === 0 ? (
              <EmptyState icon={FileText} message={t('dashboard.recent.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.recent_documents.slice(0, 5).map((doc) => (
                  <DocumentRow
                    key={doc.id}
                    doc={doc}
                    isAr={isAr}
                    dfLocale={dfLocale}
                    onOpen={() => navigate(`/employees/${encodeURIComponent(doc.employee_id)}`)}
                  />
                ))}
              </ul>
            )}
          </SectionCard>
        )
      case 'recent_ledger':
        return (
          <SectionCard icon={ScrollText} title={t('dashboard.recent.ledger')} count={summary?.recent_ledger.length}>
            {summaryQuery.isPending ? (
              <PanelSkeleton />
            ) : !summary || summary.recent_ledger.length === 0 ? (
              <EmptyState icon={ScrollText} message={t('dashboard.recent.empty')} />
            ) : (
              <ul className="flex flex-col">
                {summary.recent_ledger.slice(0, 5).map((entry) => (
                  <LedgerRow key={entry.id} entry={entry} dfLocale={dfLocale} onOpen={() => openItem('ledger', entry.id)} />
                ))}
              </ul>
            )}
          </SectionCard>
        )
    }
  }

  // Wrap a widget cell with the right grid span for its size.
  const widgetCell = (id: WidgetId, zone: WidgetZone, index: number): React.JSX.Element | null => {
    const node = renderWidget(id, zone)
    if (node == null) return null
    const span = WIDGET_SIZE[id] === 'panel' ? 'md:col-span-3' : ''
    return (
      <div key={id} className={`anim-fade-up ${span}`} style={{ animationDelay: `${120 + index * 40}ms` }}>
        {node}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-6 md:px-7">
        {/* ============ HERO ============ */}
        <DashboardHero
          name={welcomeName}
          isAr={isAr}
          isLoading={summaryQuery.isPending}
          welcomeGuest={t('dashboard.welcomeBackGuest')}
          staffOnSite={summary?.totals.present_today ?? 0}
          onLeaveToday={summary?.totals.on_leave_today ?? 0}
          returnersToday={heroReturners}
          upcomingThisWeek={summary?.upcoming_leave_ends.length ?? 0}
          onReviewLeaves={() => onNavigate('leaves')}
        />

        {/* ============ MY WIDGETS HEADER ============ */}
        <div
          className="anim-fade-up mb-3.5 flex items-center justify-between"
          style={{ animationDelay: '60ms' }}
        >
          <h3 className="text-lg font-semibold tracking-tight text-foreground">
            {t('dashboard.myWidgets')}
          </h3>
          <button
            type="button"
            onClick={() => setWidgetDialogOpen(true)}
            aria-label={t('dashboard.editMyWidgets')}
            className="inline-flex items-center gap-1.5 text-[0.85em] font-medium text-primary transition-colors hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('dashboard.editMyWidgets')}
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        {/* ============ TOP ZONE (2 big cards) ============ */}
        {zones.top.length > 0 && (
          <div className="mb-6 grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {zones.top.map((w, i) => {
              const node = renderWidget(w.id as WidgetId, 'top')
              if (node == null) return null
              return (
                <div key={w.id} className="anim-fade-up" style={{ animationDelay: `${80 + i * 40}ms` }}>
                  {node}
                </div>
              )
            })}
          </div>
        )}

        {/* ============ UNDER-WORKSPACE ZONE ============ */}
        {zones.under_workspace.length > 0 && (
          <div className="mb-6 grid auto-rows-fr grid-cols-1 gap-3.5 md:grid-cols-3">
            {zones.under_workspace.map((w, i) => widgetCell(w.id as WidgetId, 'under_workspace', i))}
          </div>
        )}

        {/* ============ QUICK ACTIONS HEADER ============ */}
        <div
          className="anim-fade-up mb-3.5 mt-1.5 flex items-center justify-between"
          style={{ animationDelay: '320ms' }}
        >
          <h3 className="text-xl font-bold tracking-tight text-foreground">
            {t('dashboard.quickActions')}
          </h3>
          <button
            type="button"
            onClick={() => setQuickActionsDialogOpen(true)}
            aria-label={t('dashboard.editQuickActions')}
            className="inline-flex items-center gap-1.5 text-[0.85em] font-medium text-primary transition-colors hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {t('dashboard.editQuickActions')}
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          </button>
        </div>

        {/* ============ QUICK-ACTION TILES ============
            Drives order + visibility from `layout.quick_actions`. Capped at
            MAX_VISIBLE_QUICK_ACTIONS (8) — fills up to two 4-col rows.
            Each tile's emoji + href + slug come from QUICK_ACTION_META —
            section shortcuts use the legacy `onNavigate(page)` (which the
            shell wires to router pushes), form tiles deep-link via
            `navigate('/application?form=...')` which ApplicationPage
            hydrates into a pre-selected template. Empty state surfaces a
            hint pointing operators at the edit dialog. */}
        {visibleQuickActions.length === 0 ? (
          <div
            className="anim-fade-up mb-8 rounded-2xl border border-dashed border-hairline bg-surface py-2"
            style={{ animationDelay: '340ms' }}
          >
            <EmptyState icon={FileText} message={t('dashboard.quickActionsEmpty')} />
          </div>
        ) : (
          <div className="mb-8 grid auto-rows-fr grid-cols-2 gap-3.5 md:grid-cols-4">
            {visibleQuickActions.map((qa, index) => {
              const meta = QUICK_ACTION_META[qa.id as QuickActionId]
              const delay = `${340 + index * 20}ms`
              const handleClick = () => {
                // Section shortcuts use the parent's typed page-nav so the
                // shell can keep its existing route state (sidebar collapse,
                // last page, etc.). Form deep-links go through the router
                // directly — ApplicationPage reads `?form=` on mount.
                if (qa.id === 'hr') return onNavigate('application')
                if (qa.id === 'violations') return onNavigate('employees')
                if (qa.id === 'leaves') return onNavigate('leaves')
                if (qa.id === 'books') return onNavigate('books')
                navigate(meta.href)
              }
              return (
                <div key={qa.id} className="anim-fade-up h-full" style={{ animationDelay: delay }}>
                  <ServiceTile
                    emoji={meta.emoji}
                    title={quickActionLabels[qa.id as QuickActionId]}
                    description={quickActionDescriptions[qa.id as QuickActionId]}
                    onClick={handleClick}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* ============ UNDER-QUICK-ACTIONS ZONE ============ */}
        {zones.under_quick_actions.length > 0 && (
          <div className="mb-6 grid auto-rows-fr grid-cols-1 gap-3.5 md:grid-cols-3">
            {zones.under_quick_actions.map((w, i) => widgetCell(w.id as WidgetId, 'under_quick_actions', i))}
          </div>
        )}
      </div>

      {/* ============ EDIT DIALOGS ============ */}
      <CustomizeWidgetsDialog
        open={widgetDialogOpen}
        onOpenChange={setWidgetDialogOpen}
        items={layout.widgets}
        labels={widgetLabels}
        isSaving={updateSettings.isPending}
        onSave={(items) => {
          updateSettings.mutate(
            { dashboard_layout: { ...layout, widgets: widgetsForApi(items) } },
            { onSuccess: () => setWidgetDialogOpen(false) },
          )
        }}
      />
      <WidgetEditDialog<QuickActionId>
        open={quickActionsDialogOpen}
        onOpenChange={setQuickActionsDialogOpen}
        title={t('dashboard.editWidgets.quickActionsTitle')}
        description={t('dashboard.editWidgets.quickActionsDescription')}
        items={layout.quick_actions}
        labels={quickActionLabels}
        defaults={DEFAULT_LAYOUT.quick_actions}
        isSaving={updateSettings.isPending}
        maxVisible={MAX_VISIBLE_QUICK_ACTIONS}
        maxVisibleHint={t('dashboard.editWidgets.quickActionsMaxVisibleHint', {
          count: MAX_VISIBLE_QUICK_ACTIONS,
        })}
        onSave={(items) => {
          updateSettings.mutate(
            { dashboard_layout: { ...layout, quick_actions: items } },
            { onSuccess: () => setQuickActionsDialogOpen(false) },
          )
        }}
      />

    </div>
  )
}

/* =========================================================================
 * HERO
 * ========================================================================= */

interface HeroReturner {
  name: string
  employee_id: string
}

interface DashboardHeroProps {
  name: string | null
  isAr: boolean
  isLoading: boolean
  welcomeGuest: string
  staffOnSite: number
  onLeaveToday: number
  returnersToday: HeroReturner[]
  upcomingThisWeek: number
  onReviewLeaves: () => void
}

/**
 * Event-led dashboard hero. Beyond the greeting + name it surfaces the single
 * most relevant "today" signal in an insight line. The priority order in the
 * design spec is overdue forms → new joiners → returners → exits → calm; only
 * the **returners-from-leave** branch and the **calm fallback** are wired here
 * because they're the events the existing summary endpoint actually carries.
 * Joiner / overdue / pending-approval events are deferred until the backend
 * exposes them, rather than inventing API fields the dashboard doesn't have.
 */
function DashboardHero({
  name,
  isAr,
  isLoading,
  welcomeGuest,
  staffOnSite,
  onLeaveToday,
  returnersToday,
  upcomingThisWeek,
  onReviewLeaves,
}: DashboardHeroProps): React.JSX.Element {
  const { t } = useTranslation()

  const headline = name ? t('dashboard.welcomeBack', { name }) : welcomeGuest
  const greeting = t(`dashboard.greeting.${heroGreetingKey()}`)
  const gregorian = format(new Date(), 'EEE, dd MMM', { locale: isAr ? arLocale : undefined })
  const hijri = hijriToday()

  const link = (label: string) => (
    <button
      type="button"
      onClick={onReviewLeaves}
      className="cursor-pointer rounded-sm font-medium text-white/95 underline decoration-white/40 underline-offset-2 transition-colors hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
    >
      {label}
    </button>
  )

  let insight: React.ReactNode
  if (returnersToday.length === 0) {
    insight = (
      <span>
        {t('dashboard.hero.calm', { n: staffOnSite })}
        {upcomingThisWeek > 0 && ` ${t('dashboard.hero.calmUpcoming', { n: upcomingThisWeek })}`}
      </span>
    )
  } else {
    const n = returnersToday.length
    const verb = n === 1 ? t('dashboard.hero.returnsSingle') : t('dashboard.hero.returnPlural')
    let lead: React.ReactNode
    if (n === 1) {
      lead = <b className="font-medium text-white/95">{returnersToday[0]!.name}</b>
    } else if (n <= 3) {
      const firsts = returnersToday.map((r) => r.name.split(/\s+/)[0]!)
      lead = <b className="font-medium text-white/95">{joinNames(firsts, isAr)}</b>
    } else {
      lead = (
        <b className="font-medium text-white/95">{t('dashboard.hero.peopleCount', { n })}</b>
      )
    }
    insight = (
      <>
        <HeroAvatars returners={returnersToday} />
        <span>
          {lead} {verb}.{' '}
          {n >= 4 ? link(t('dashboard.hero.seeAll')) : link(t('dashboard.hero.reviewLeave'))}
        </span>
      </>
    )
  }

  return (
    <div
      className="anim-fade-up relative mb-6 flex min-h-[150px] flex-col gap-4 overflow-hidden rounded-2xl px-5 py-5 md:flex-row md:items-stretch md:gap-5 md:px-8 md:py-6"
      style={{ background: 'var(--hero-grad)', animationDelay: '0ms' }}
    >
      {/* Soft white circle highlight (upper-right) */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-20 end-[-80px] h-[280px] w-[280px] rounded-full bg-white/[0.06]"
      />
      {/* Bottom depth gradient */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-black/[0.18]"
      />

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col gap-2 text-white">
        <span className="text-[0.68em] font-medium uppercase tracking-[0.08em] text-white/60">
          {greeting}
        </span>
        {isLoading && !name ? (
          <Skeleton className="h-7 w-72 bg-white/20" />
        ) : (
          <h2 className="m-0 text-[1.3em] font-semibold leading-tight tracking-tight [hyphens:none] [word-break:keep-all] md:text-[1.5em]">{headline}</h2>
        )}

        {/* Date + status strip */}
        <div className="flex flex-wrap items-center gap-2.5 text-[0.72em] text-white/85">
          <span className="inline-flex items-center gap-2 font-mono text-white/90">
            {gregorian}
            {hijri && (
              <>
                <span aria-hidden className="text-white/30">·</span>
                <span
                  dir="rtl"
                  className="text-white/55"
                  style={{ fontFamily: 'var(--font-arabic)' }}
                >
                  {hijri}
                </span>
              </>
            )}
          </span>
          <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-white/35" />
          {onLeaveToday > 0 ? (
            <button
              type="button"
              onClick={onReviewLeaves}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 font-medium text-white/90 transition-colors hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              <span className="font-mono font-semibold tabular-nums text-white">{onLeaveToday}</span>
              {t('dashboard.hero.onLeaveChip')}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-2.5 py-1 font-medium text-white/90">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              {t('dashboard.hero.allPresent')}
            </span>
          )}
        </div>

        {/* Insight line — verbose secondary context; hidden on phones to keep
            the hero compact (the on-leave chip + leave section cards below
            carry the same signal). */}
        <div className="hidden flex-wrap items-center gap-2 text-[0.78em] leading-relaxed text-white/80 md:flex">
          {insight}
        </div>
      </div>

      {/* Mobile: small rounded-square crest wrap (44×44, matches .m-hero__crest-wrap).
           Desktop (md+): transparent passthrough — the img itself carries the 80×80 circle style.
           order-first below md so the crest appears above the text in column layout. */}
      <div className="relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.18)] max-md:order-first md:h-auto md:w-auto md:self-center md:rounded-none md:bg-transparent md:shadow-none">
        <img
          src="/brand/gssg-logo.png"
          alt=""
          aria-hidden
          className="dashboard-crest relative h-8 w-8 rounded-full object-cover opacity-90 md:h-[80px] md:w-[80px] md:shadow-[0_0_0_1px_rgba(255,255,255,0.18)]"
        />
      </div>

      {/* Crest rotation keyframes — scoped to this element's animation name. */}
      <style>{`
        .dashboard-crest { animation: gssg-crest-spin 90s linear infinite; }
        @keyframes gssg-crest-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dashboard-crest { animation: none; }
        }
      `}</style>
    </div>
  )
}

/** Overlapping initials avatars for the hero insight cluster. Shows up to 3
 *  then collapses the rest into a "+N" chip. Decorative (aria-hidden). */
function HeroAvatars({ returners }: { returners: HeroReturner[] }): React.JSX.Element {
  const shown = returners.slice(0, 3)
  const extra = returners.length - shown.length
  return (
    <span aria-hidden className="me-1 inline-flex shrink-0 items-center">
      {shown.map((r) => (
        <span
          key={r.employee_id}
          className="-ms-2.5 inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-[#0d2845] bg-white/[0.18] font-mono text-[0.62em] font-semibold text-white shadow-sm first:ms-0"
        >
          {initialsFor(r.name)}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ms-2.5 inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-[#0d2845] bg-white/[0.05] font-mono text-[0.62em] font-semibold text-white/85 shadow-sm">
          +{extra}
        </span>
      )}
    </span>
  )
}

/* =========================================================================
 * 2-UP CARDS
 * ========================================================================= */

interface PendingDocumentsCardProps {
  docsCount: number
  currency: string
  header: string
  reviewLabel: string
  footnote: string
  onClick: () => void
  isLoading: boolean
}

function PendingDocumentsCard({
  docsCount,
  currency,
  header,
  reviewLabel,
  footnote,
  onClick,
  isLoading,
}: PendingDocumentsCardProps): React.JSX.Element {
  // Progress bar = share of the calendar month elapsed. Day 1 → 0%,
  // last day of the month → 100%. Honest, always-moving anchor that
  // pairs naturally with the "N documents this month" footnote.
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const pct = Math.round(((now.getDate() - 1) / daysInMonth) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer group relative h-full w-full overflow-hidden rounded-2xl bg-surface p-5 text-start transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="text-[0.86em] font-medium text-muted-foreground">{header}</div>

      <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        <span className="me-1.5 text-[0.32em] font-medium text-muted-foreground align-middle">
          {currency}
        </span>
        {isLoading ? <Skeleton className="h-9 w-16" /> : docsCount}
      </div>

      {/* Progress bar — decorative proxy (not a true completion %), hidden
          from AT. After the one-shot width grow finishes, a slow opacity
          pulse keeps the bar feeling "alive" without being distracting (the
          `infinite` animation kicks in only after the grow completes via
          the chained delay). */}
      <div
        aria-hidden="true"
        className="my-3.5 h-[5px] overflow-hidden rounded-full bg-surface-tinted"
      >
        <div
          className="dash-pending-bar h-full rounded-full bg-accent"
          style={{
            width: `${pct}%`,
            animation:
              'dash-pending-grow 1.4s ease-out, dash-pending-pulse 3s ease-in-out infinite 1.4s',
          }}
        />
      </div>
      <style>{`
        @keyframes dash-pending-grow {
          from { width: 0%; }
        }
        @keyframes dash-pending-pulse {
          0%, 100% { opacity: 0.85; }
          50%      { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Reset both animations under reduced-motion — bar still renders
             at its final width but doesn't grow or pulse. */
          .dash-pending-bar { animation: none !important; }
        }
      `}</style>

      <div className="flex items-center justify-between text-[0.78em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          {footnote}
        </span>
        <span
          className="dash-view-pill rounded-full bg-primary px-4 py-1.5 text-[0.78em] font-medium text-primary-foreground shadow-sm transition-all duration-200 group-hover:scale-105 group-hover:bg-primary-hover group-hover:shadow-md motion-reduce:!transform-none motion-reduce:!shadow-sm"
          aria-hidden
        >
          {reviewLabel}
        </span>
      </div>

      <ChevronRight
        aria-hidden
        className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
        strokeWidth={1.8}
      />
      {/* Direct-hover pop on the View pill — a tighter spring on top of the
          calm card-hover swell. Animation (not a static transform) so it wins
          over the group-hover scale while playing, then settles back. */}
      <style>{`
        .dash-view-pill:hover { animation: dash-view-pop 320ms cubic-bezier(0.34, 1.35, 0.64, 1); }
        @keyframes dash-view-pop {
          0%   { transform: scale(1.05); }
          55%  { transform: scale(1.10); }
          100% { transform: scale(1.08); }
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-view-pill:hover { animation: none; }
        }
      `}</style>
    </button>
  )
}

interface WorkspaceCardProps {
  staff: number
  header: string
  currency: string
  activeLabel: string
  onLeaveLabel: string
  onClick: () => void
  isLoading: boolean
}

function WorkspaceCard({
  staff,
  header,
  currency,
  activeLabel,
  onLeaveLabel,
  onClick,
  isLoading,
}: WorkspaceCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer group relative h-full w-full overflow-hidden rounded-2xl p-5 text-start transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{
        background:
          'linear-gradient(140deg, var(--surface) 0%, var(--surface) 55%, var(--surface-tinted) 100%)',
      }}
    >
      <div className="text-[0.86em] font-medium text-muted-foreground">{header}</div>

      <div className="mt-2.5 text-[2.4em] font-bold leading-none tracking-tight text-foreground tabular-nums">
        <span className="me-1.5 text-[0.32em] font-medium text-muted-foreground align-middle">
          {currency}
        </span>
        {isLoading ? <Skeleton className="h-9 w-16" /> : staff}
      </div>

      <div className="mt-3.5 flex gap-4 text-[0.78em] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {/* Static status dot. It remounts (via key) only when the active
              count changes, replaying a one-shot settle — no ambient pulse
              (Emil: reserve motion for the moment the value changes). */}
          <span
            key={activeLabel}
            className="dash-active-dot h-1.5 w-1.5 rounded-full bg-success"
            aria-hidden
          />
          {activeLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
          {onLeaveLabel}
        </span>
      </div>

      <ChevronRight
        aria-hidden
        className="absolute end-5 top-5 h-3.5 w-3.5 text-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted-foreground rtl:group-hover:-translate-x-0.5 motion-reduce:!transform-none"
        strokeWidth={1.8}
      />
      <style>{`
        /* One-shot settle: plays once when the dot mounts (i.e. when the
           active count changes and React remounts it via key). No infinite
           loop — the dot is otherwise static. */
        @keyframes dash-active-settle {
          0%   { transform: scale(0.4); opacity: 0; }
          45%  { transform: scale(1.15); opacity: 1; }
          70%  { transform: scale(1); }
          100% { transform: scale(1); opacity: 1; }
        }
        .dash-active-dot {
          animation: dash-active-settle 420ms cubic-bezier(0.34, 1.35, 0.64, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .dash-active-dot { animation: none !important; }
        }
      `}</style>
    </button>
  )
}

/* =========================================================================
 * SECTION CARD + ROWS (preserved from P12, restyled to rounded-2xl)
 * ========================================================================= */

function SectionCard({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon
  title: string
  count: number | undefined
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="h-full rounded-2xl border border-hairline bg-surface" aria-label={title}>
      <div className="flex min-h-[52px] items-center justify-between border-b border-hairline px-5 py-3.5">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {typeof count === 'number' && count > 0 && (
          <Badge shape="pill" tone="neutral">
            {count}
          </Badge>
        )}
      </div>
      <div className="px-3 py-2">{children}</div>
    </section>
  )
}

function PanelSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function OnLeaveRow({
  item,
  isAr,
  untilLabel,
  onOpen,
}: {
  item: DashboardOnLeaveItem
  isAr: boolean
  untilLabel: string
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = pickName(item, isAr)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <Avatar className="h-8 w-8 bg-primary-soft text-primary">
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 font-medium text-foreground" title={name}>{name}</span>
          <span className="font-mono text-xs text-muted-foreground">{item.employee_id}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge shape="square" tone="info" className="normal-case tracking-normal">
            {t(`leaves.type.${item.leave_type}`, { defaultValue: item.leave_type })}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{untilLabel}</span>
        </div>
      </button>
    </li>
  )
}

function UpcomingRow({
  item,
  isAr,
  label,
  onOpen,
}: {
  item: DashboardUpcomingItem
  isAr: boolean
  label: string
  onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = pickName(item, isAr)
  const urgent = item.days_remaining <= 1
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <Avatar className="h-8 w-8 bg-primary-soft text-primary">
          <AvatarFallback>{initialsFor(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 font-medium text-foreground" title={name}>{name}</span>
          <span className="font-mono text-xs text-muted-foreground">{item.employee_id}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge shape="square" tone={urgent ? 'warning' : 'neutral'} className="normal-case tracking-normal">
            {t(`leaves.type.${item.leave_type}`, { defaultValue: item.leave_type })}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{label}</span>
        </div>
      </button>
    </li>
  )
}

function formatStamp(iso: string, dfLocale: Locale | undefined): string {
  try {
    return format(parseISO(iso), 'dd MMM HH:mm', { locale: dfLocale })
  } catch {
    return iso.slice(0, 10)
  }
}

function formatDate(iso: string, dfLocale: Locale | undefined): string {
  try {
    return format(parseISO(iso), 'dd MMM yyyy', { locale: dfLocale })
  } catch {
    return iso.slice(0, 10)
  }
}

function DocumentRow({
  doc,
  isAr,
  dfLocale,
  onOpen,
}: {
  doc: DashboardRecentDocument
  isAr: boolean
  dfLocale: Locale | undefined
  onOpen: () => void
}): React.JSX.Element {
  const name = pickName(doc, isAr)
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-soft text-primary">
          <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground">
            {doc.ref_number ? (
              <>
                <span className="font-mono text-primary">{doc.ref_number}</span>
                <span className="mx-1.5 text-muted-foreground">·</span>
                {doc.template_id}
              </>
            ) : (
              doc.template_id
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">{name}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {formatStamp(doc.created_at, dfLocale)}
        </span>
      </button>
    </li>
  )
}

function LedgerRow({
  entry,
  dfLocale,
  onOpen,
}: {
  entry: DashboardRecentLedger
  dfLocale: Locale | undefined
  onOpen: () => void
}): React.JSX.Element {
  const dotClass =
    entry.direction === 'incoming'
      ? 'bg-success'
      : entry.direction === 'outgoing'
        ? 'bg-accent'
        : 'bg-primary'
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-start text-sm transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 cursor-pointer"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-tinted">
          <span className={cn('h-2.5 w-2.5 rounded-full', dotClass)} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-foreground">{entry.subject}</span>
          <span className="truncate text-xs text-muted-foreground">{entry.counterparty}</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {formatDate(entry.entry_date, dfLocale)}
        </span>
      </button>
    </li>
  )
}
