import { useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { Pencil } from 'lucide-react'
import {
  api,
  type DashboardLayout,
  type DashboardQuickActionConfig,
  type WorkforceSnapshot,
} from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { WidgetEditDialog } from '@/components/dashboard/WidgetEditDialog'
import {
  AddWidgetsPanel,
  CustomizeBanner,
  WidgetControls,
} from '@/components/dashboard/CustomizeWidgets'
import {
  DEFAULT_LAYOUT,
  MAX_VISIBLE_QUICK_ACTIONS,
  QUICK_ACTION_IDS,
  WIDGET_IDS,
  isQuickActionAllowed,
  mergeQuickActionsPreservingDenied,
  packLayout,
  resolveLayout,
  rowsPerHeight,
  tierOf,
  widgetsForApi,
  type QuickActionId,
  type WidgetId,
  type WidgetSize,
} from '@/lib/dashboardLayout'
import { hijriToday } from '@/lib/hijri'
import { useApprovalSummary } from '@/lib/useApprovalSummary'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { useIdentity } from '@/lib/useIdentity'
import { PullToRefresh } from '@/components/refresh/PullToRefresh'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { WorkforceCoverageSheet } from './widgets/WorkforceCoverageSheet'
import { DashboardRuntimeContext } from './widgets/dashboardWidgetContext'
import { widgetRegistry } from './widgetRegistry'
import { InmateReporterDashboard } from './InmateReporterDashboard'

export type DashboardPage = 'employees' | 'services' | 'books' | 'leaves' | 'ledger' | 'settings' | 'dashboard'
export interface DashboardPageProps { onNavigate: (page: DashboardPage) => void }

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

/** Join names with a locale-aware list conjunction ("A, B and C" / "A، B و C"). */
function joinNames(names: string[], isAr: boolean): string {
  if (names.length <= 1) return names[0] ?? ''
  const sep = isAr ? '، ' : ', '
  const and = isAr ? ' و ' : ' and '
  return names.slice(0, -1).join(sep) + and + names[names.length - 1]
}

export function DashboardPage(props: DashboardPageProps): React.JSX.Element {
  const { user } = useAuth()
  if (user?.role === 'inmate_reporter') return <InmateReporterDashboard />
  return <GenericDashboardPage key={user?.id ?? 'anonymous'} {...props} />
}

function GenericDashboardPage({ onNavigate }: DashboardPageProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { has, isLoading: capabilitiesLoading } = useCapabilities()
  const { identity } = useIdentity()
  const { user } = useAuth()
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const summaryQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboardSummary,
    staleTime: 60_000,
  })
  const summary = summaryQuery.data
  const approvalSummary = useApprovalSummary().data
  const workforceAccessQuery = useQuery({
    queryKey: ['workforce', 'access'],
    queryFn: api.getWorkforceAccess,
    enabled: !capabilitiesLoading && (has('workforce.self.view') || has('workforce.dashboard.view')),
    staleTime: 60_000,
  })
  const layoutQuery = useQuery<DashboardLayout | null>({
    queryKey: ['dashboard-layout', user?.id],
    queryFn: api.getDashboardLayout,
    enabled: Boolean(user),
  })
  const layout = useMemo(() => resolveLayout(layoutQuery.data), [layoutQuery.data])
  const [draft, setDraft] = useState<DashboardLayout | null>(null)
  const editing = draft !== null
  const activeLayout = draft ?? layout
  const [quickActionsDialogOpen, setQuickActionsDialogOpen] = useState(false)
  const [coverageOpen, setCoverageOpen] = useState(false)
  const boardRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const customizeRef = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef<{ id: string; control: string } | null>(null)
  const focusCustomize = useRef(false)
  const focusAfterRemove = useRef<WidgetId | null>(null)

  useLayoutEffect(() => {
    if (focusCustomize.current && !draft) {
      customizeRef.current?.focus()
      focusCustomize.current = false
    }
    if (focusAfterRemove.current) {
      const canvas = canvasRef.current
      const add = canvas?.querySelector<HTMLButtonElement>(
        `[data-add-widget-id="${focusAfterRemove.current}"]:not(:disabled)`,
      )
      const target = add ?? canvas?.querySelector<HTMLButtonElement>('[data-control="save"]:not(:disabled)')
      target?.focus()
      focusAfterRemove.current = null
    }
    const target = focusAfterMove.current
    if (!target) return
    boardRef.current
      ?.querySelector<HTMLElement>(
        `[data-widget-id="${target.id}"] [data-control="${target.control}"]`,
      )
      ?.focus()
    focusAfterMove.current = null
  }, [draft])

  const updateLayout = useMutation({
    mutationFn: (next: DashboardLayout) => {
      if (!user) throw new Error('Cannot save a dashboard layout without an authenticated user')
      return api.updateDashboardLayout(next)
    },
    onSuccess: (saved) => {
      qc.setQueryData(['dashboard-layout', user?.id], saved)
      toast.success(t('dashboard.customize.saved'))
    },
    onError: (err: Error) => toast.error(err.message),
  })
  const availableIds = WIDGET_IDS.filter((id) =>
    widgetRegistry[id].available({
      has,
      approvalSummary,
      capabilitiesLoading,
      workforceAccess: workforceAccessQuery.data,
    }),
  )
  const visibleWidgets = [...activeLayout.widgets]
    .sort((a, b) => a.order - b.order)
    .filter((widget) => widget.visible && availableIds.includes(widget.id))
  const cols = isMobile ? 2 : activeLayout.canvas_width === 'wide' ? 6 : 4
  const packed = packLayout(visibleWidgets, cols)
  const catalog = availableIds.map((id) => ({
    id,
    title: t(widgetRegistry[id].titleKey),
    source: widgetRegistry[id].source,
  }))
  const quickActionLabels = Object.fromEntries(
    QUICK_ACTION_IDS.map((id) => [
      id,
      t(`dashboard.quickActionLabels.${QUICK_ACTION_META[id].slug}`),
    ]),
  ) as Record<QuickActionId, string>
  const allowedQuickActions = activeLayout.quick_actions.filter((item) =>
    isQuickActionAllowed(item.id, has),
  )
  const allowedQuickActionDefaults = DEFAULT_LAYOUT.quick_actions.filter((item) =>
    isQuickActionAllowed(item.id, has),
  )
  const coverageOperationalDate =
    qc.getQueryData<WorkforceSnapshot>(['workforce', 'snapshot'])?.operational_date ?? ''
  const welcomeName = useMemo(() => {
    if (!identity?.linked) return null
    const full = isAr && identity.name_ar ? identity.name_ar : identity.name_en
    return full ? firstSecondFamilyName(full) : null
  }, [identity, isAr])
  const heroReturners = useMemo<HeroReturner[]>(
    () =>
      (summary?.upcoming_leave_ends ?? [])
        .filter((row) => row.days_remaining <= 0)
        .map((row) => ({ name: pickName(row, isAr), employee_id: row.employee_id })),
    [summary, isAr],
  )

  const changeSize = (id: WidgetId, size: WidgetSize) => {
    setDraft((current) =>
      current && {
        ...current,
        widgets: current.widgets.map((widget) =>
          widget.id === id ? { ...widget, size } : widget,
        ),
      },
    )
  }
  const moveWidget = (id: WidgetId, targetId: WidgetId, control: string) => {
    if (!draft || id === targetId) return
    const next = [...draft.widgets]
    const from = next.findIndex((widget) => widget.id === id)
    const target = next.findIndex((widget) => widget.id === targetId)
    if (from < 0 || target < 0) return
    next.splice(target, 0, next.splice(from, 1)[0]!)
    focusAfterMove.current = { id, control }
    setDraft({ ...draft, widgets: widgetsForApi(next) })
  }
  const moveRelative = (id: WidgetId, index: number, direction: -1 | 1) => {
    const target = visibleWidgets[index + direction]
    if (target) moveWidget(id, target.id, direction < 0 ? 'earlier' : 'later')
  }
  const allowDrop = (event: DragEvent<HTMLElement>) => {
    if (editing && !updateLayout.isPending && event.dataTransfer.types.includes('text/plain')) {
      event.preventDefault()
    }
  }
  const dropWidget = (event: DragEvent<HTMLElement>, id: WidgetId) => {
    if (!editing || updateLayout.isPending) return
    event.preventDefault()
    const from = event.dataTransfer.getData('text/plain') as WidgetId
    if (visibleWidgets.some((item) => item.id === from)) moveWidget(from, id, 'drag')
  }
  const removeWidget = (id: WidgetId) => {
    focusAfterRemove.current = id
    setDraft({
      ...activeLayout,
      widgets: activeLayout.widgets.map((item) =>
        item.id === id ? { ...item, visible: false } : item,
      ),
    })
  }
  const addWidget = (id: WidgetId) => {
    const item = activeLayout.widgets.find((widget) => widget.id === id)!
    setDraft({
      ...activeLayout,
      widgets: widgetsForApi([
        ...activeLayout.widgets.filter((widget) => widget.id !== id),
        { ...item, visible: true, size: 'S' },
      ]),
    })
  }
  const closeCustomize = () => {
    focusCustomize.current = true
    setDraft(null)
  }
  const saveLayout = () => {
    updateLayout.mutate(
      { ...activeLayout, widgets: widgetsForApi(activeLayout.widgets) },
      { onSuccess: closeCustomize },
    )
  }
  const saveQuickActions = (items: DashboardQuickActionConfig[]) => {
    setDraft({
      ...activeLayout,
      quick_actions: mergeQuickActionsPreservingDenied(activeLayout.quick_actions, items),
    })
    setQuickActionsDialogOpen(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1">
        <PullToRefresh>
          <div
            ref={canvasRef}
            data-canvas-width={activeLayout.canvas_width}
            className={`w-full px-4 pb-12 pt-6 md:px-7 ${
              activeLayout.canvas_width === 'wide' ? '' : 'mx-auto max-w-[1180px]'
            }`}
          >
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
            <div className="mb-3.5 flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {t('dashboard.myWidgets')}
              </h3>
              <div className="flex items-center gap-2">
                <RefreshButton />
                <button
                  ref={customizeRef}
                  type="button"
                  aria-expanded={editing}
                  disabled={editing || !user || layoutQuery.isPending}
                  onClick={() => setDraft(structuredClone(layout))}
                  className="inline-flex items-center gap-1.5 rounded-sm text-[0.85em] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {t('dashboard.customize.action')}
                  <Pencil className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
            {editing && (
              <CustomizeBanner
                width={activeLayout.canvas_width ?? 'compact'}
                onWidth={(width) => setDraft({ ...activeLayout, canvas_width: width })}
                onReset={() => setDraft(structuredClone(DEFAULT_LAYOUT))}
                onCancel={closeCustomize}
                isSaving={updateLayout.isPending}
                onSave={saveLayout}
              />
            )}
            <div className="flex flex-col items-start gap-4 lg:flex-row">
              <div
                ref={boardRef}
                data-testid="widget-grid"
                data-columns={cols}
                className="grid w-full min-w-0 flex-1 gap-3.5"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridAutoRows: '9.25rem',
                }}
              >
                {packed.placed.map((box, index) => {
                  const id = box.id as WidgetId
                  const { Component, titleKey } = widgetRegistry[id]
                  const title = t(titleKey)
                  const widget = visibleWidgets.find((item) => item.id === id)!
                  return (
                    <article
                      key={id}
                      data-widget-id={id}
                      aria-label={title}
                      className={`relative min-h-0 min-w-0 overflow-hidden rounded-2xl ${
                        editing ? 'ring-1 ring-border-strong' : ''
                      }`}
                      style={{
                        gridColumn: `${box.c + 1} / span ${box.w}`,
                        gridRow: `${box.r + 1} / span ${box.h}`,
                      }}
                      onDragOver={allowDrop}
                      onDrop={(event) => dropWidget(event, id)}
                    >
                      {editing && (
                        <WidgetControls
                          item={widget}
                          title={title}
                          atStart={index === 0}
                          atEnd={index === visibleWidgets.length - 1}
                          isSaving={updateLayout.isPending}
                          onSize={(size) => changeSize(id, size)}
                          onMove={(direction) => moveRelative(id, index, direction)}
                          onRemove={() => removeWidget(id)}
                          onEditTiles={
                            id === 'quick_actions'
                              ? () => setQuickActionsDialogOpen(true)
                              : undefined
                          }
                        />
                      )}
                      <div
                        className={`h-full min-h-0 overflow-hidden ${
                          editing ? 'pointer-events-none opacity-50' : ''
                        }`}
                        inert={editing}
                      >
                        <DashboardRuntimeContext.Provider
                          value={{
                            layout: activeLayout,
                            has,
                            onNavigate,
                            onOpenCoverage: () => setCoverageOpen(true),
                            box: { w: box.w, h: box.h, cols },
                          }}
                        >
                          <Component tier={tierOf(box.w, box.h)} rows={rowsPerHeight(box.h)} />
                        </DashboardRuntimeContext.Provider>
                      </div>
                    </article>
                  )
                })}
              </div>
              {editing && (
                <AddWidgetsPanel
                  entries={catalog}
                  widgets={activeLayout.widgets}
                  isSaving={updateLayout.isPending}
                  onAdd={addWidget}
                />
              )}
            </div>
          </div>
        </PullToRefresh>
      </div>
      <WidgetEditDialog<QuickActionId>
        open={quickActionsDialogOpen}
        onOpenChange={setQuickActionsDialogOpen}
        title={t('dashboard.editWidgets.quickActionsTitle')}
        description={t('dashboard.editWidgets.quickActionsDescription')}
        items={allowedQuickActions}
        labels={quickActionLabels}
        defaults={allowedQuickActionDefaults}
        maxVisible={MAX_VISIBLE_QUICK_ACTIONS}
        maxVisibleHint={t('dashboard.editWidgets.quickActionsMaxVisibleHint', {
          count: MAX_VISIBLE_QUICK_ACTIONS,
        })}
        onSave={saveQuickActions}
      />
      <WorkforceCoverageSheet
        open={coverageOpen}
        onOpenChange={setCoverageOpen}
        operationalDate={coverageOperationalDate}
      />
    </div>
  )
}

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
      className="anim-fade-up relative mb-4 flex min-h-0 flex-col gap-4 overflow-hidden rounded-2xl px-4 py-4 md:mb-6 md:min-h-[150px] md:flex-row md:items-stretch md:gap-5 md:px-8 md:py-6"
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

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col gap-2 text-white max-md:pe-14">
        <span className="text-[0.68em] font-medium uppercase tracking-[0.08em] text-white/60">
          {greeting}
        </span>
        {isLoading && !name ? (
          <Skeleton className="h-7 w-72 bg-white/20" />
        ) : (
          <h2 className="m-0 text-[1.2em] font-semibold leading-tight tracking-tight [hyphens:none] [word-break:keep-all] md:text-[1.5em]">{headline}</h2>
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

      {/* Mobile: small rounded-square crest wrap (44×44, matches .m-hero__crest-wrap),
           absolutely pinned to the top inline-end corner (text column reserves
           space for it via max-md:pe-14 above) so it never overlaps the headline.
           Desktop (md+): transparent passthrough — the img itself carries the 80×80 circle style. */}
      <div className="relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center self-start rounded-xl bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.18)] max-md:absolute max-md:top-4 max-md:end-4 md:h-auto md:w-auto md:self-center md:rounded-none md:bg-transparent md:shadow-none">
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

