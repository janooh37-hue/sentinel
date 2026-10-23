/**
 * Dashboard hero — the signed-in person's staff-file folder.
 *
 * A flat navy folder whose tab carries the GSSG wordmark. Inside: photo (or
 * initials), the time-of-day greeting over the name, position · department and
 * the G-number, then a foot line splitting today's on-leave status from the
 * Gregorian and Hijri dates. Everything shown comes from the session identity
 * and the dashboard summary; nothing is invented for decoration.
 *
 * Motion: on the first dashboard visit of the day the folder fills in reading
 * order, travelling in the writing direction. Later visits render it settled,
 * because the dashboard is opened dozens of times a day.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'date-fns'
import { ar as arLocale } from 'date-fns/locale'
import { Check } from 'lucide-react'

import type { IdentityRead } from '@/lib/api'
import { hijriToday } from '@/lib/hijri'
import { Skeleton } from '@/components/ui/skeleton'

const INTRO_STORAGE_KEY = 'gssg.dashboardHero.introDate'

/** Time-of-day greeting bucket from the local clock. */
function greetingKey(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

/** True on the first dashboard visit of the local day. The read happens in the
 *  state initialiser and the write in an effect, so StrictMode's double render
 *  cannot consume the day's intro before it plays. */
function useFirstVisitToday(): boolean {
  const [today] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [first] = useState(() => {
    try {
      return window.localStorage.getItem(INTRO_STORAGE_KEY) !== today
    } catch {
      return false
    }
  })
  useEffect(() => {
    if (!first) return
    try {
      window.localStorage.setItem(INTRO_STORAGE_KEY, today)
    } catch {
      // Storage unavailable (private mode): the intro simply plays again.
    }
  }, [first, today])
  return first
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
  /** The dashboard summary is still loading; its counts are not known yet. */
  isSummaryLoading: boolean
  onLeaveToday: number
  onReviewLeaves: () => void
}

export function DashboardHero({
  identity,
  name,
  initials,
  isAr,
  isSummaryLoading,
  onLeaveToday,
  onReviewLeaves,
}: DashboardHeroProps): React.JSX.Element {
  const { t } = useTranslation()
  const intro = useFirstVisitToday()
  const [photoFailed, setPhotoFailed] = useState(false)

  const linked = Boolean(identity?.linked && name)
  const greeting = t(`dashboard.greeting.${greetingKey()}`)
  const gregorian = format(new Date(), 'EEEE d MMMM yyyy', { locale: isAr ? arLocale : undefined })
  const hijri = hijriToday()
  const roleLine = [identity?.position, identity?.department].filter(Boolean).join(' · ')
  const photoUrl = identity?.photo_url && !photoFailed ? identity.photo_url : null

  return (
    <div className={`relative mb-4 pt-[33px] md:mb-6 ${intro ? 'hero-intro' : ''}`}>
      <span
        className="hero-folder-tab hero-seq absolute start-0 top-0 flex h-[34px] w-[160px] items-center gap-3 rounded-ss-[14px] px-[18px] md:w-[236px]"
        style={seq(0)}
      >
        <span className="gssg-mark w-[92px]" role="img" aria-label="GSSG" />
        <span className="hidden text-[0.58em] font-semibold uppercase tracking-[0.1em] text-white/60 md:inline rtl:normal-case rtl:tracking-normal">
          {t('dashboard.hero.staffFile')}
        </span>
      </span>

      <header className="hero-slab relative overflow-hidden rounded-[18px] rounded-ss-none px-4 pb-3.5 pt-5 text-white md:px-[34px] md:pb-5 md:pt-[30px]">
        <div className={linked ? 'grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3.5 md:gap-[26px]' : ''}>
          {linked && (
            <span
              aria-hidden
              className="hero-seq grid aspect-[4/5] w-[58px] place-items-center overflow-hidden rounded-xl bg-[var(--hero-slab-raised)] text-[1em] font-semibold text-white/90 shadow-[0_0_0_3px_rgba(255,255,255,0.16)] md:w-[104px] md:text-[1.6em]"
              style={seq(1)}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setPhotoFailed(true)}
                />
              ) : (
                initials
              )}
            </span>
          )}

          <div className="min-w-0">
            <h2 className="m-0 text-[1.45em] leading-[1.02] tracking-[-0.035em] [text-wrap:balance] md:text-[2.5em] rtl:leading-[1.28] rtl:tracking-normal">
              <span className="hero-seq mb-0.5 block text-[0.6em] font-light text-white/65" style={seq(2)}>
                {greeting}
                {isAr ? '،' : ','}
              </span>
              <span className="hero-seq block font-[750]" style={seq(3)}>
                {name ?? t('dashboard.welcomeBackGuest')}
              </span>
            </h2>

            {linked && (roleLine || identity?.employee_id) && (
              <div
                className="hero-seq mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[0.78em] text-white/80"
                style={seq(4)}
              >
                {roleLine && <span>{roleLine}</span>}
                {identity?.employee_id && (
                  <span className="inline-flex items-center gap-2 rounded-[7px] px-2.5 py-[3px] text-[0.92em] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]">
                    <span className="font-medium text-white/60">{t('dashboard.hero.idLabel')}</span>
                    <span className="font-mono" dir="ltr">
                      {identity.employee_id}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <span aria-hidden className="hero-rule mt-5 block h-px bg-white/20 md:mt-[22px]" style={seq(5)} />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 pt-3.5">
          <span className="hero-seq" style={seq(6)}>
            {isSummaryLoading ? (
              <Skeleton className="h-4 w-36 bg-white/20" />
            ) : onLeaveToday > 0 ? (
              <button
                type="button"
                onClick={onReviewLeaves}
                aria-label={`${onLeaveToday} ${t('dashboard.hero.onLeaveChip')}. ${t('dashboard.hero.reviewLeave')}`}
                className="inline-flex cursor-pointer items-center gap-2 rounded-sm text-[0.76em] font-semibold text-white underline decoration-white/35 underline-offset-4 transition-colors hover:decoration-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-slab)]"
              >
                <span aria-hidden className="h-[9px] w-[9px] rounded-full bg-amber-300" />
                <span className="font-mono text-[1.15em] font-medium tabular-nums">{onLeaveToday}</span>
                {t('dashboard.hero.onLeaveChip')}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2 text-[0.76em] font-semibold text-white">
                <Check aria-hidden className="h-[15px] w-[15px] text-emerald-300" strokeWidth={2.4} />
                {t('dashboard.hero.allPresent')}
              </span>
            )}
          </span>
          <span
            className="hero-seq inline-flex flex-wrap gap-x-4 gap-y-1 text-[0.72em] text-white/80"
            style={seq(7)}
          >
            <span className={isAr ? 'text-white' : 'font-mono text-white'}>{gregorian}</span>
            {hijri && (
              <span dir="rtl" className="hidden md:inline" style={{ fontFamily: 'var(--font-arabic)' }}>
                {hijri}
              </span>
            )}
          </span>
        </div>
      </header>
    </div>
  )
}
