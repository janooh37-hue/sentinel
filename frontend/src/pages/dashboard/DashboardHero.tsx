/**
 * Dashboard hero — the signed-in person's staff file, set as a telemetry sheet.
 *
 * A square-cornered navy folder whose tab carries the GSSG wordmark. The
 * identity block (photo or initials, greeting, name, position · department,
 * G-number) sits at the inline start. The inline end is about the same person,
 * never the team: a date plate (day, weekday, month, Hijri date, local time,
 * week) over their own approval queue — to sign, to review, returned to them
 * for changes, sent by them and still pending. Each cell counts exactly the
 * list it opens. The queue comes from the approvals summary, which only ever
 * counts the caller's own authorized items, so the hero shows nothing a user
 * may not see; a user with no approval work gets the date plate across the
 * whole panel.
 *
 * Motion: each time the dashboard opens, the sheet fills in reading order
 * (travelling in the writing direction), a scan line sweeps it once and the
 * queue counts run up. Reduced motion shows it settled.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { ArrowUpRight } from 'lucide-react'

import type { ApprovalSummaryResponse, IdentityRead } from '@/lib/api'
import { approvalQueueUrl } from '@/lib/approvals'
import { pickPosition } from '@/lib/employeePosition'
import { hijriToday } from '@/lib/hijri'
import { useApprovalSummary } from '@/lib/useApprovalSummary'

const COUNT_UP_MS = 700

interface DeskItem {
  key: 'sign' | 'review' | 'returned' | 'sent'
  count: number
  to: string
  /** The item asks the user to act: flagged red while it is non-zero. */
  actionable: boolean
}

/** The user's own approval queue, limited to the parts they can open. Each
 *  received kind gets its own cell: no single list shows signature and review
 *  work together, so a combined count would promise more than its link shows. */
function deskItems(summary: ApprovalSummaryResponse | undefined): DeskItem[] {
  if (!summary) return []
  const items: DeskItem[] = []
  if (summary.available_received_kinds.includes('approver')) {
    items.push({
      key: 'sign',
      count: summary.signature.count,
      to: approvalQueueUrl({ tab: 'received', kind: 'sign', status: 'pending', sort: 'newest', page: 1 }),
      actionable: true,
    })
  }
  if (summary.available_received_kinds.includes('reviewer')) {
    items.push({
      key: 'review',
      count: summary.review.count,
      to: approvalQueueUrl({ tab: 'received', kind: 'review', status: 'pending', sort: 'newest', page: 1 }),
      actionable: true,
    })
  }
  if (summary.can_view_sent) {
    items.push(
      {
        key: 'returned',
        count: summary.returned_count,
        to: approvalQueueUrl({ tab: 'sent', status: 'returned', sort: 'newest', page: 1 }),
        actionable: true,
      },
      {
        key: 'sent',
        count: summary.sent.count,
        to: approvalQueueUrl({ tab: 'sent', status: 'pending', sort: 'newest', page: 1 }),
        actionable: false,
      },
    )
  }
  return items
}

/** Time-of-day greeting bucket from the local clock. */
function greetingKey(now: Date): 'morning' | 'afternoon' | 'evening' {
  const h = now.getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The local clock, re-read on each minute boundary. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 60_000 - (Date.now() % 60_000))
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])
  return now
}

/** Eased 0 → 1 progress that runs once, the first time the counts arrive. */
function useCountUpProgress(ready: boolean): number {
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 1 : 0))
  const done = useRef(progress === 1)
  useEffect(() => {
    if (!ready || done.current) return
    let frame = 0
    let start: number | null = null
    const tick = (time: number) => {
      start ??= time
      const p = Math.min((time - start) / COUNT_UP_MS, 1)
      setProgress(1 - (1 - p) ** 4)
      if (p < 1) frame = requestAnimationFrame(tick)
      else done.current = true
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready])
  return progress
}

/** Position of an element in the intro sequence. */
function seq(n: number): React.CSSProperties {
  return { '--seq': n } as React.CSSProperties
}

export interface DashboardHeroProps {
  identity: IdentityRead | null | undefined
  /** Display name, already shortened to "First Second Family". */
  name: string | null
  /** Initials shown in the portrait when the record has no photo. */
  initials: string
  isAr: boolean
}

export function DashboardHero({ identity, name, initials, isAr }: DashboardHeroProps): React.JSX.Element {
  const { t } = useTranslation()
  const now = useMinuteClock()
  const approvals = useApprovalSummary()
  const desk = deskItems(approvals.data)
  const progress = useCountUpProgress(approvals.data !== undefined)
  const [photoFailed, setPhotoFailed] = useState(false)

  const linked = Boolean(identity?.linked && name)
  const dfLocale = isAr ? arLocale : undefined
  const position = identity ? pickPosition(identity, isAr ? 'ar' : 'en') : null
  const roleLine = [position, identity?.department].filter(Boolean).join(' · ')
  const photoUrl = identity?.photo_url && !photoFailed ? identity.photo_url : null
  const hijri = hijriToday()
  const tall = desk.length === 0

  return (
    <div className="hero-intro relative mb-4 pt-[29px] md:mb-6">
      <span
        className="hero-folder-tab hero-seq absolute start-0 top-0 flex h-[30px] w-[150px] items-center gap-3 px-4 md:w-[224px]"
        style={seq(0)}
      >
        <span className="gssg-mark w-[80px]" role="img" aria-label="GSSG" />
        <span className="hero-label hidden text-white/55 md:inline">{t('dashboard.hero.staffFile')}</span>
      </span>

      <header className="hero-slab relative overflow-hidden text-white">
        <span aria-hidden className="hero-cross start-1.5 top-1.5" />
        <span aria-hidden className="hero-cross bottom-1.5 start-1.5 hidden md:block" />

        <div className="grid md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex min-w-0 items-center gap-3.5 px-4 py-4 md:gap-5 md:px-7 md:py-5">
            {linked && (
              <span
                aria-hidden
                className="hero-seq grid aspect-[4/5] w-[52px] shrink-0 place-items-center overflow-hidden bg-[var(--hero-slab-raised)] font-mono text-[0.95em] font-medium text-white/90 outline outline-1 outline-offset-2 outline-white/25 md:w-[68px] md:text-[1.15em] rtl:font-[family-name:var(--font-arabic)]"
                style={seq(1)}
              >
                {photoUrl ? (
                  <img src={photoUrl} alt="" className="h-full w-full object-cover" onError={() => setPhotoFailed(true)} />
                ) : (
                  initials
                )}
              </span>
            )}

            <div className="min-w-0">
              <h2 className="m-0">
                <span className="hero-seq hero-label mb-1.5 block text-white/55" style={seq(2)}>
                  {t(`dashboard.greeting.${greetingKey(now)}`)}
                  <span aria-hidden className="text-[var(--accent)]"> {'///'}</span>
                </span>
                <span
                  className="hero-seq block text-[1.25em] font-[750] leading-[1.08] tracking-[-0.02em] [text-wrap:balance] md:text-[1.6em] rtl:leading-[1.3] rtl:tracking-normal"
                  style={seq(3)}
                >
                  {name ?? t('dashboard.welcomeBackGuest')}
                </span>
              </h2>

              {linked && (roleLine || identity?.employee_id) && (
                <div
                  className="hero-seq mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78em] text-white/75"
                  style={seq(4)}
                >
                  {roleLine && <span>{roleLine}</span>}
                  {identity?.employee_id && (
                    <span className="inline-flex items-center gap-2 border border-white/25 px-2 py-px">
                      <span className="font-mono text-[0.85em] uppercase tracking-[0.1em] text-white/55 rtl:font-[family-name:var(--font-arabic)] rtl:text-[length:max(0.85em,0.6875rem)] rtl:normal-case rtl:tracking-normal">
                        {t('dashboard.hero.idLabel')}
                      </span>
                      <span className="font-mono text-white" dir="ltr">
                        {identity.employee_id}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-px border-t border-white/15 bg-white/15 md:w-[440px] md:border-s md:border-t-0">
            <div
              className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 bg-[var(--hero-slab)] ${
                tall ? 'gap-y-2 px-5 py-5 md:px-6 md:py-6' : 'gap-y-1 px-4 py-3.5 md:px-5'
              }`}
            >
              <time
                dateTime={format(now, 'yyyy-MM-dd')}
                className={`hero-seq row-span-3 font-[800] leading-[0.86] tracking-[-0.05em] tabular-nums ${
                  tall ? 'text-[4em] md:text-[5.2em]' : 'text-[3em] md:text-[3.4em]'
                }`}
                style={seq(5)}
              >
                {format(now, 'd')}
              </time>
              <span className="hero-seq hero-label text-white" style={seq(6)}>
                {format(now, 'EEEE · MMMM yyyy', { locale: dfLocale })}
              </span>
              {hijri ? (
                <span className="hero-seq text-[0.8em] text-white/70" style={{ ...seq(7), fontFamily: 'var(--font-arabic)' }}>
                  <bdi dir="rtl">{hijri}</bdi>
                </span>
              ) : (
                <span />
              )}
              <span className="hero-seq flex gap-2.5 font-mono text-[0.8em] text-white/70" style={seq(8)}>
                <time className="text-white tabular-nums" dateTime={format(now, 'HH:mm')}>
                  {format(now, 'HH:mm')}
                </time>
                <span className="rtl:font-[family-name:var(--font-arabic)]">
                  {t('dashboard.hero.week', { n: format(now, 'I') })}
                </span>
              </span>
            </div>

            {desk.length > 0 && (
              <div
                className="grid gap-px"
                style={{ gridTemplateColumns: `repeat(${desk.length}, minmax(0, 1fr))` }}
              >
                {desk.map((item, i) => (
                  <Link
                    key={item.key}
                    to={item.to}
                    className="group relative flex min-w-0 flex-col bg-[var(--hero-slab)] px-4 py-3 transition-colors hover:bg-[var(--hero-slab-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white md:px-[18px] md:py-3.5"
                  >
                    <ArrowUpRight
                      aria-hidden
                      className="absolute bottom-2.5 end-2.5 h-3.5 w-3.5 text-white/40 transition-colors group-hover:text-white rtl:-scale-x-100"
                    />
                    <span className="hero-seq flex flex-1 flex-col" style={seq(9 + i)}>
                      <span className="hero-label block text-white/55">
                        {item.actionable && item.count > 0 && (
                          <span aria-hidden className="me-1.5 inline-block h-[7px] w-[7px] bg-[var(--accent)] align-[0.05em]" />
                        )}
                        {t(`dashboard.hero.desk.${item.key}`)}
                      </span>
                      <data
                        value={item.count}
                        className={`mt-auto block pt-1.5 font-mono text-[1.45em] font-medium leading-none tabular-nums md:text-[1.6em] ${
                          item.count === 0 ? 'text-white/45' : 'text-white'
                        }`}
                      >
                        {Math.round(item.count * progress)}
                      </data>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
    </div>
  )
}
