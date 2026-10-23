/**
 * Dashboard hero — the signed-in person's staff file, set as a telemetry sheet.
 *
 * A square-cornered navy folder whose tab carries the GSSG wordmark. The
 * identity block (photo or initials, greeting, name, position · department,
 * G-number) sits at the inline start; a ruled readout panel at the inline end
 * reports today's numbers from the dashboard summary; a foot strip carries the
 * Gregorian and Hijri dates and the local time. Every figure is real data;
 * nothing is invented for decoration.
 *
 * Motion: each time the dashboard opens, the sheet fills in reading order
 * (travelling in the writing direction), a scan line sweeps it once and the
 * readouts count up. Reduced motion shows it settled.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { ArrowUpRight } from 'lucide-react'

import type { IdentityRead } from '@/lib/api'
import { pickPosition } from '@/lib/employeePosition'
import { hijriToday } from '@/lib/hijri'

const COUNT_UP_MS = 700

/** Today's figures for the readout panel. */
export interface HeroCounts {
  onSite: number
  onLeave: number
  /** Approved leaves ending within the next seven days. */
  returning: number
  activeStaff: number
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
  /** Today's figures; null while the dashboard summary loads. */
  counts: HeroCounts | null
  onReviewLeaves: () => void
}

export function DashboardHero({
  identity,
  name,
  initials,
  isAr,
  counts,
  onReviewLeaves,
}: DashboardHeroProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const now = useMinuteClock()
  const progress = useCountUpProgress(counts !== null)
  const [photoFailed, setPhotoFailed] = useState(false)

  const linked = Boolean(identity?.linked && name)
  const dfLocale = isAr ? arLocale : undefined
  // Arabic has no short weekday form, so it keeps the full names.
  const gregorian = format(now, isAr ? 'EEEE d MMMM yyyy' : 'EEE d MMM yyyy', { locale: dfLocale })
  const time = format(now, 'HH:mm')
  const hijri = hijriToday()
  const position = identity ? pickPosition(identity, i18n.language) : null
  const roleLine = [position, identity?.department].filter(Boolean).join(' · ')
  const photoUrl = identity?.photo_url && !photoFailed ? identity.photo_url : null
  const shown = (n: number) => Math.round(n * progress)

  const readouts = [
    { key: 'onSite', value: counts?.onSite },
    { key: 'onLeave', value: counts?.onLeave },
    { key: 'returning', value: counts?.returning },
    { key: 'activeStaff', value: counts?.activeStaff },
  ] as const

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
        <span aria-hidden className="hero-cross start-1.5 top-1" />
        <span aria-hidden className="hero-cross bottom-1 end-1.5" />

        <div className="grid md:grid-cols-[minmax(0,1fr)_auto]">
          <div
            className={`flex min-w-0 items-center gap-3.5 px-4 py-4 md:gap-5 md:px-7 md:py-5 ${linked ? '' : 'md:py-7'}`}
          >
            {linked && (
              <span
                aria-hidden
                className="hero-seq grid aspect-[4/5] w-[52px] shrink-0 place-items-center overflow-hidden bg-[var(--hero-slab-raised)] font-mono text-[0.95em] font-medium text-white/90 outline outline-1 outline-offset-2 outline-white/25 md:w-[68px] md:text-[1.15em]"
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
                      <span className="hero-label text-white/55">{t('dashboard.hero.idLabel')}</span>
                      <span className="font-mono text-white" dir="ltr">
                        {identity.employee_id}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-white/15 bg-white/15 sm:grid-cols-4 md:grid-cols-2 md:border-s md:border-t-0">
            {readouts.map(({ key, value }, i) => {
              // The cell frames stand from the start so the ruled grid never
              // flashes; only their contents arrive in sequence.
              const body = (
                <span className="hero-seq pointer-events-none block" style={seq(5 + i)}>
                  <span className="hero-label block text-white/55">{t(`dashboard.hero.readout.${key}`)}</span>
                  <span className="mt-1.5 block font-mono text-[1.45em] font-medium leading-none tabular-nums text-white md:text-[1.6em]">
                    {value === undefined ? (
                      <>
                        <span aria-hidden className="text-white/30">
                          --
                        </span>
                        <span className="sr-only">{t('common.loading')}</span>
                      </>
                    ) : (
                      <data value={value}>{shown(value)}</data>
                    )}
                  </span>
                </span>
              )
              const cell =
                'relative flex min-w-0 flex-col justify-between bg-[var(--hero-slab)] px-4 py-3 md:w-[188px] md:px-5 md:py-3.5'
              if (key === 'onLeave' && value !== undefined && value > 0) {
                return (
                  <div key={key} className={cell}>
                    {body}
                    <span aria-hidden className="absolute end-2.5 top-2.5 h-2 w-2 bg-[var(--accent)]" />
                    <ArrowUpRight
                      aria-hidden
                      className="pointer-events-none absolute bottom-2.5 end-2.5 h-3.5 w-3.5 text-white/50 rtl:-scale-x-100"
                    />
                    <button
                      type="button"
                      onClick={onReviewLeaves}
                      aria-label={t('dashboard.hero.onLeaveAria', { count: value })}
                      className="absolute inset-0 cursor-pointer transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
                    />
                  </div>
                )
              }
              return (
                <div key={key} className={cell}>
                  {body}
                </div>
              )
            })}
          </div>
        </div>

        <span aria-hidden className="hero-rule block h-px bg-white/15" style={seq(9)} />
        <div
          className="hero-seq flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[0.72em] text-white/70 md:px-7"
          style={seq(10)}
        >
          <span className={isAr ? '' : 'font-mono uppercase tracking-[0.06em]'}>{gregorian}</span>
          {hijri && (
            <>
              <span aria-hidden className="hidden text-white/30 md:inline">
                /
              </span>
              <span dir="rtl" className="hidden md:inline" style={{ fontFamily: 'var(--font-arabic)' }}>
                {hijri}
              </span>
            </>
          )}
          <time className="ms-auto font-mono tabular-nums text-white" dateTime={format(now, "yyyy-MM-dd'T'HH:mm")}>
            {time}
          </time>
        </div>
      </header>
    </div>
  )
}
