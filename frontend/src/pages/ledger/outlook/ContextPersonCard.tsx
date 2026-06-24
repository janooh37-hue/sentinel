/**
 * ContextPersonCard — the PRIMARY (expanded) employee card in the
 * "People in this email" context panel (Phase 7, Task 2).
 *
 * Fed a single G-number, it fetches `getEmployeeDetail(id)` (one call →
 * employee + stats + recent_activity) and renders ONLY fields the API actually
 * backs (the plan's BACKED-vs-OMIT table): photo/initials avatar, AR/EN name,
 * `G# · role · department` (department — there is NO "site" field, so we do not
 * fabricate one), a status badge, a 2×2 facts grid (Joined+tenure · Mobile ·
 * Nationality · Leave balance — null → "—", never invented), a document-expiry
 * ⚠️ alert (only when within the 90-day window), three quick actions
 * (Open record · Generate · Email-as-reference), and a recent-activity
 * mini-list. Pure mappers live in `contextResolve.ts` (vitest-tested).
 *
 * Prototype reference: `.card`/`.empc`/`.facts`/`.alert`/`.qa3`/`.act`
 * (docs/prototypes/ledger-outlook-redesign.html CSS 306–358, renderContext
 * 1195–1221). Tokens only — no inline hex, no `text-[Npx]`.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, FilePlus, Mail, UserRound } from 'lucide-react'

import { api } from '@/lib/api'
import type { EmployeeStatus } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { pickPosition } from '@/lib/employeePosition'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { activityEmoji, expiryAlert, leaveBalanceLabel } from './contextResolve'

/** Coarse page targets the shell's `onNavigate` seam understands. */
type NavPage = 'employees' | 'application'

interface Props {
  employeeId: string
  /** Coarse navigation (Open record → employees; Generate → application). */
  onNavigate?: (page: NavPage, id?: string) => void
  /** Email-as-reference seam — employees carry no email, so this opens a new
   *  compose with the employee as a 👤 reference (wired by the shell). */
  onEmail?: (employeeId: string) => void
}

/** Status → Badge tone (active→green, resigned→amber, terminated→red). */
const STATUS_TONE: Record<EmployeeStatus, 'active' | 'warning' | 'danger'> = {
  Active: 'active',
  Resigned: 'warning',
  Terminated: 'danger',
}

/** First letters of the first two name parts — avatar fallback. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

const DASH = '—'

/** Empty/whitespace-only values render as "—" (`??` alone misses ""). */
function orDash(value?: string | null): string {
  return value && value.trim() ? value : DASH
}

export function ContextPersonCard({ employeeId, onNavigate, onEmail }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  const { data, isLoading, isError } = useQuery({
    queryKey: ['employee-detail', employeeId],
    queryFn: () => api.getEmployeeDetail(employeeId),
  })

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' }),
    [lang],
  )
  const activityFmt = useMemo(
    () => new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }),
    [lang],
  )

  if (isLoading) {
    return (
      <div className="border-b border-border bg-surface p-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="mt-3 h-12 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="border-b border-border bg-surface p-3.5 text-sm text-muted-foreground">
        {DASH}
      </div>
    )
  }

  const emp = data.employee
  const name = pickEmployeeName(emp, lang)
  const role = pickPosition(emp, lang)
  const tone = STATUS_TONE[emp.status] ?? 'active'
  const alert = expiryAlert(emp)
  const activity = data.recent_activity.slice(0, 5)

  const joined = emp.doj
    ? `${dateFmt.format(new Date(emp.doj))} · ${t('ledger.outlook.facts.years', { count: data.stats.tenure_years })}`
    : DASH

  return (
    <div className="border-b border-border bg-surface p-3.5">
      {/* Header: avatar · name · G·role·dept · status */}
      <div className="flex items-center gap-3">
        {/* Initials sit behind the photo so a missing/slow image never flashes
            a broken icon — the <img> just stays hidden on error. */}
        <div className="relative h-12 w-12 flex-none">
          <div
            aria-hidden
            className="absolute inset-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-[var(--green-grad-a)] to-[var(--green-grad-b)] text-base font-bold text-white"
          >
            {initials(name)}
          </div>
          {emp.has_photo && (
            <img
              src={`/api/v1/employees/${encodeURIComponent(emp.id)}/photo`}
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              alt={name}
              className="relative h-12 w-12 rounded-xl object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground" dir="auto">
            {name}
          </div>
          <div className="mt-0.5 mb-1.5 truncate text-xs text-muted-foreground" dir="auto">
            <span className="font-mono">{emp.id}</span>
            {role && <> · {role}</>}
            {emp.department && <> · {emp.department}</>}
          </div>
          <Badge data-testid="cx-status-badge" tone={tone} withDot>
            {t(`employees.status.${emp.status}`, emp.status)}
          </Badge>
        </div>
      </div>

      {/* 2×2 facts grid — backed fields only; null → "—". The panel chrome is
          pinned LTR (Outlook-no-mirror), so without an explicit dir the labels
          stay LTR-aligned (left) while `dir="auto"` values flip to the RTL edge
          (right) in Arabic — the value no longer sits under its label. Anchoring
          the grid to the language direction aligns label + value to the same
          start edge (and flows the 2 columns RTL, which is correct for Arabic).
          Per CLAUDE.md this is in-spec: only the chrome STRUCTURE stays LTR;
          Arabic TEXT inside panes is right-aligned. */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5" dir={i18n.dir()}>
        <Fact testid="cx-fact-joined" label={t('ledger.outlook.facts.joined')} value={joined} />
        <Fact testid="cx-fact-mobile" label={t('ledger.outlook.facts.mobile')} value={orDash(emp.contact)} mono />
        <Fact testid="cx-fact-nationality" label={t('ledger.outlook.facts.nationality')} value={orDash(emp.nationality)} />
        <Fact testid="cx-fact-leave" label={t('ledger.outlook.facts.leave')} value={t('ledger.outlook.facts.days', { count: Number(leaveBalanceLabel(data.stats)) })} />
      </div>

      {/* Document-expiry alert — only within the window */}
      {alert && (
        <div
          data-testid="cx-expiry-alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2 text-xs leading-relaxed text-warning"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden />
          <span dir="auto">
            <b>
              {t(`ledger.outlook.facts.expiry.${alert.docType}`)}
              {' · '}
              {alert.daysRemaining < 0
                ? t('ledger.outlook.facts.expired', { count: Math.abs(alert.daysRemaining) })
                : t('ledger.outlook.facts.expiresIn', { count: alert.daysRemaining })}
            </b>
            .{' '}
            <button
              type="button"
              onClick={() => onNavigate?.('employees', emp.id)}
              className="font-bold underline underline-offset-2"
            >
              {t('ledger.outlook.startRenewal')}
            </button>
          </span>
        </div>
      )}

      {/* Quick actions (3-up) */}
      <div className="mt-3 flex gap-2">
        <QuickAction testid="cx-qa-record" emoji={<UserRound className="h-4 w-4" aria-hidden />} label={t('ledger.outlook.quick.record')} onClick={() => onNavigate?.('employees', emp.id)} />
        <QuickAction testid="cx-qa-generate" emoji={<FilePlus className="h-4 w-4" aria-hidden />} label={t('ledger.outlook.quick.generate')} onClick={() => onNavigate?.('application')} />
        <QuickAction testid="cx-qa-email" emoji={<Mail className="h-4 w-4" aria-hidden />} label={t('ledger.outlook.quick.email')} onClick={() => onEmail?.(emp.id)} />
      </div>

      {/* Recent activity mini-list */}
      {activity.length > 0 && (
        <>
          <div className="mt-3.5 mb-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('ledger.outlook.recentActivity')}
          </div>
          {activity.map((a, i) => (
            <div
              key={`${a.kind}-${a.ref_id}-${i}`}
              className="flex items-center justify-between gap-2.5 border-b border-dashed border-border py-1.5 text-xs text-muted-foreground last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-1.5 truncate" dir="auto">
                <span aria-hidden>{activityEmoji(a.kind)}</span>
                {a.summary}
              </span>
              {/* dir="ltr" + stripped bidi marks. The context panel chrome is
                  pinned LTR (the Outlook-no-mirror rule), but the Arabic medium
                  date is numeric (DD/MM/YYYY) and carries embedded RLM marks
                  that scramble it to "212026/05/" inside an LTR context.
                  Isolating the span as LTR renders 21/05/2026 cleanly in both
                  languages (English medium uses a month name and is unaffected). */}
              <span className="flex-none text-[0.68rem] text-muted-foreground/70" dir="ltr">
                {activityFmt.format(new Date(a.when)).replace(/[\u200e\u200f\u061c]/g, '')}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

interface FactProps {
  testid: string
  label: string
  value: string
  mono?: boolean
}

function Fact({ testid, label, value, mono }: FactProps): React.JSX.Element {
  return (
    <div data-testid={testid}>
      <span className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      {/* No dir="auto" here: the value inherits the grid's language direction so
          it shares the label's start edge. A numeric value (mobile, "30 days")
          would otherwise resolve LTR and break back to the opposite edge. */}
      <div className={`mt-px text-xs font-semibold text-foreground ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  )
}

interface QuickActionProps {
  testid: string
  emoji: React.ReactNode
  label: string
  onClick: () => void
}

function QuickAction({ testid, emoji, label, onClick }: QuickActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-1 rounded-md border border-border bg-surface px-1 py-2.5 text-[0.7rem] text-foreground transition-colors hover:border-border-strong hover:bg-surface-tinted active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-muted-foreground">{emoji}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
