import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  Sun,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  api,
  apiErrorMessage,
  type BookRead,
  type ExpirySummary,
  type UnreadRecentResponse,
  type WorkforceCrewName,
  type WorkforceSnapshot,
} from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { loadLockWeather, weatherCategory, type LockWeather } from '@/lib/lockWeather'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIdentity } from '@/lib/useIdentity'
import { DEFAULT_IDLE_LOCK_SECONDS, LOCK_LAYOUTS } from '@/lib/useLockState'
import type { LockLayout } from '@/lib/useLockState'

import './LockOverlay.css'

interface LockOverlayProps {
  onUnlocked: () => void
  onSignOut: () => void
}

const WEATHER_STALE_MS = 30 * 60_000

function formatInstant(
  value: string | null | undefined,
  locale: string,
  timeZone: string,
): string | null {
  if (!value) return null
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(new Date(value))
}

function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: string,
  timeZone: string,
): string | null {
  if (!start || !end) return null
  return `${formatInstant(start, locale, timeZone)} – ${formatInstant(end, locale, timeZone)}`
}

function WeatherGlyph({ weather }: { weather: LockWeather }): React.JSX.Element {
  const className = 'lock-weather-glyph'
  switch (weatherCategory(weather.weatherCode)) {
    case 'clear':
      return weather.isDay ? <Sun className={className} /> : <Moon className={className} />
    case 'fog':
      return <CloudFog className={className} />
    case 'rain':
      return <CloudRain className={className} />
    case 'snow':
      return <CloudSnow className={className} />
    case 'storm':
      return <CloudLightning className={className} />
    default:
      return <Cloud className={className} />
  }
}

function TimeBlock({ now, isAr }: { now: Date; isAr: boolean }): React.JSX.Element {
  const locale = isAr ? 'ar-AE' : 'en-GB'
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
  const hijri = new Intl.DateTimeFormat(
    isAr ? 'ar-SA-u-ca-islamic-umalqura' : 'en-u-ca-islamic-umalqura',
    { day: 'numeric', month: 'long', year: 'numeric' },
  ).format(now)

  return (
    <div className="lock-time-block" aria-live="off">
      <time className="lock-clock" dateTime={now.toISOString()}>
        {time}
      </time>
      <div className="lock-dates">
        <span>{date}</span>
        <span>{hijri}</span>
      </div>
    </div>
  )
}

function crewNames(crews: readonly WorkforceCrewName[] | undefined, isAr: boolean): string[] {
  return (crews ?? []).map(
    (crew) => (isAr ? crew.name_ar || crew.name_en : crew.name_en || crew.name_ar) || crew.code,
  )
}

function OperationsBlock({
  snapshot,
  weather,
  digest,
  isAr,
}: {
  snapshot: WorkforceSnapshot | null
  weather: LockWeather | null
  digest: Array<{ key: 'approvals' | 'inbox' | 'expiry'; count: number }>
  isAr: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const locale = isAr ? 'ar-AE' : 'en-GB'
  const timeZone = snapshot?.timezone ?? 'Asia/Dubai'
  const weatherNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const currentShiftCode = snapshot?.self?.shift_code?.trim() || null
  const currentCrewNames = crewNames(snapshot?.current_shift.crews, isAr)
  const nextCrewNames = crewNames(snapshot?.next_shift.crews, isAr)
  const nextShiftCodes = (snapshot?.next_shift.shift_code ?? '')
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
  const currentShiftLabel =
    currentCrewNames.length > 0
      ? currentCrewNames.join(' · ')
      : currentShiftCode
        ? t(`attendance.shift.${currentShiftCode}`, currentShiftCode)
        : null
  const nextShiftLabel =
    nextCrewNames.length > 0
      ? nextCrewNames.join(' · ')
      : nextShiftCodes.length > 0
        ? nextShiftCodes.map((code) => t(`attendance.shift.${code}`, code)).join(' · ')
        : null
  const currentRange = formatRange(
    snapshot?.self?.scheduled_start_at ?? snapshot?.current_shift.starts_at,
    snapshot?.self?.scheduled_end_at ?? snapshot?.current_shift.ends_at,
    locale,
    timeZone,
  )
  const nextRange = formatRange(
    snapshot?.next_shift.starts_at,
    snapshot?.next_shift.ends_at,
    locale,
    timeZone,
  )
  const nextStart = formatInstant(snapshot?.next_shift.starts_at, locale, timeZone)
  const nextStartLabel =
    nextShiftLabel && nextStart ? t('lockScreen.startsAt', { time: nextStart }) : null
  const nextStartParts =
    nextStartLabel && nextStart ? nextStartLabel.split(nextStart) : null
  const hasCurrentShift = currentShiftLabel !== null || currentRange !== null
  const hasNextShift = nextShiftLabel !== null || nextRange !== null
  const hasShift = hasCurrentShift || hasNextShift
  const sectionCount = Number(hasShift) + Number(digest.length > 0) + Number(weather !== null)
  if (!hasShift && !weather && digest.length === 0) return null

  return (
    <section
      className="lock-operations"
      aria-label={t('lockScreen.glanceTitle')}
      data-sections={sectionCount}
    >
      {hasShift && (
        <div className="lock-shifts">
          {hasCurrentShift && (
            <div className="lock-metric">
              <span className="lock-eyebrow">{t('lockScreen.onDutyNow')}</span>
              <strong>
                {currentShiftLabel ? (
                  <bdi>{currentShiftLabel}</bdi>
                ) : (
                  currentRange && <bdi dir="ltr">{currentRange}</bdi>
                )}
              </strong>
              <small>{t('lockScreen.currentShift')}</small>
            </div>
          )}
          {hasNextShift && (
            <div className="lock-metric">
              <span className="lock-eyebrow">{t('lockScreen.nextShift')}</span>
              <strong>
                {nextShiftLabel ? (
                  <bdi>{nextShiftLabel}</bdi>
                ) : (
                  nextRange && <bdi dir="ltr">{nextRange}</bdi>
                )}
              </strong>
              {nextStartParts && nextStart && (
                <small>
                  {nextStartParts[0]}
                  <bdi dir="ltr">{nextStart}</bdi>
                  {nextStartParts[1]}
                </small>
              )}
            </div>
          )}
        </div>
      )}

      <DigestList digest={digest} />

      {weather && (
        <div className="lock-weather">
          <span className="lock-eyebrow">{t('lockScreen.weather.title')}</span>
          <div className="lock-weather-main">
            <strong>
              <bdi dir="ltr">{weatherNumber.format(weather.temperatureC)}°</bdi>
            </strong>
            <WeatherGlyph weather={weather} />
          </div>
          <span className="lock-weather-condition">
            {t(`lockScreen.weather.${weatherCategory(weather.weatherCode)}`)} · {weather.location}
          </span>
          <small className="lock-weather-stats">
            <span>
              {t('lockScreen.weather.high')}{' '}
              <bdi dir="ltr">{weatherNumber.format(weather.highC)}°</bdi>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t('lockScreen.weather.low')}{' '}
              <bdi dir="ltr">{weatherNumber.format(weather.lowC)}°</bdi>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t('lockScreen.weather.humidity')}{' '}
              <bdi dir="ltr">{weatherNumber.format(weather.humidity)}%</bdi>
            </span>
          </small>
        </div>
      )}
    </section>
  )
}

export function LockOverlay({ onUnlocked, onSignOut }: LockOverlayProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const locale = isAr ? 'ar' : 'en'
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const unlockRef = useRef<HTMLFormElement>(null)
  const queryClient = useQueryClient()

  const { user } = useAuth()
  const layout: LockLayout = LOCK_LAYOUTS.includes(user?.lock_layout as LockLayout)
    ? (user?.lock_layout as LockLayout)
    : 'band'
  const { identity } = useIdentity()
  const { has } = useCapabilities()
  const canViewWorkforce = has('workforce.self.view') || has('workforce.dashboard.view')

  const workforceQuery = useQuery({
    queryKey: ['workforce', 'snapshot'],
    queryFn: api.getWorkforceSnapshot,
    enabled: canViewWorkforce,
    staleTime: 60_000,
    retry: false,
  })
  const activityQuery = useQuery({
    queryKey: ['lock-screen', 'doc-activity'],
    queryFn: api.getMyDocumentActivity,
    staleTime: 60_000,
    retry: false,
  })
  const weatherQuery = useQuery({
    queryKey: ['lock-screen', 'weather', locale],
    queryFn: ({ signal }) => loadLockWeather(locale, signal),
    staleTime: WEATHER_STALE_MS,
    gcTime: WEATHER_STALE_MS * 2,
    retry: false,
  })

  useEffect(() => {
    inputRef.current?.focus()
    const interval = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const overlay = overlayRef.current
    const unlock = unlockRef.current
    if (!overlay || !unlock || typeof ResizeObserver === 'undefined') return

    const updateUnlockHeight = (): void => {
      const height = Math.ceil(unlock.getBoundingClientRect().height)
      overlay.style.setProperty('--lock-unlock-height', `${height}px`)
    }
    updateUnlockHeight()
    const observer = new ResizeObserver(updateUnlockHeight)
    observer.observe(unlock)
    return () => {
      observer.disconnect()
      overlay.style.removeProperty('--lock-unlock-height')
    }
  }, [])

  useEffect(() => {
    const vv = window.visualViewport
    const overlay = overlayRef.current
    if (!vv || !overlay) return
    const update = (): void => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      overlay.style.setProperty('--lock-kb-inset', `${Math.round(inset)}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      overlay.style.removeProperty('--lock-kb-inset')
    }
  }, [])

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!password) return
    setSubmitting(true)
    setError(null)
    try {
      await api.verifyAuthPassword(password)
      onUnlocked()
    } catch (err) {
      setError(apiErrorMessage(err))
      setSubmitting(false)
    }
  }

  const email = user?.email
  const initials = (identity?.name_en?.[0] ?? email?.split('@')[0]?.[0] ?? '?').toUpperCase()
  const displayName = identity?.linked
    ? (isAr ? identity.name_ar : identity.name_en) ?? identity.name_en
    : email

  const digest = useMemo(() => {
    const items: Array<{ key: 'approvals' | 'inbox' | 'expiry'; count: number }> = []
    const approvals = queryClient.getQueryData<BookRead[]>(['books', 'awaiting'])
    const unread = queryClient.getQueryData<UnreadRecentResponse>(['ledger', 'unread-recent'])
    const expiry = queryClient.getQueryData<ExpirySummary>(['expiry', 'summary'])
    if (approvals) items.push({ key: 'approvals', count: approvals.length })
    if (unread) items.push({ key: 'inbox', count: unread.total_unread })
    if (expiry) items.push({ key: 'expiry', count: expiry.urgent })
    return items
  }, [queryClient])

  const documentsToday = activityQuery.data?.documents_today
  const documentsWeek = activityQuery.data?.documents_week
  const cheerText =
    documentsToday !== undefined && documentsToday > 0
      ? t('lockScreen.cheer.docsToday', { count: documentsToday })
      : documentsToday === 0 && documentsWeek !== undefined && documentsWeek > 0
        ? t('lockScreen.cheer.docsWeek', { count: documentsWeek })
        : t(
            now.getHours() >= 5 && now.getHours() <= 11
              ? 'lockScreen.cheer.morning'
              : now.getHours() >= 12 && now.getHours() <= 16
                ? 'lockScreen.cheer.afternoon'
                : 'lockScreen.cheer.evening',
          )
  const cheerMilestone = documentsToday !== undefined && documentsToday >= 5
  const shiftStart = workforceQuery.data?.self?.scheduled_start_at
  const shiftEnd = workforceQuery.data?.self?.scheduled_end_at
  let shiftRemainingMinutes: number | null = null
  if (shiftStart && shiftEnd) {
    const startMs = new Date(shiftStart).getTime()
    const endMs = new Date(shiftEnd).getTime()
    const nowMs = now.getTime()
    if (startMs <= nowMs && nowMs < endMs) {
      shiftRemainingMinutes = Math.ceil((endMs - nowMs) / 60_000)
    }
  }
  const shiftCountdown =
    shiftRemainingMinutes === null
      ? null
      : shiftRemainingMinutes >= 60
        ? t('lockScreen.cheer.shiftRemainingHours', {
            hours: Math.floor(shiftRemainingMinutes / 60),
            minutes: shiftRemainingMinutes % 60,
          })
        : t('lockScreen.cheer.shiftRemainingMinutes', { minutes: shiftRemainingMinutes })

  return (
    <div
      ref={overlayRef}
      className="lock-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('lockScreen.title')}
      dir={isAr ? 'rtl' : 'ltr'}
      data-layout={layout}
    >
      <div className="lock-frost" aria-hidden="true" />
      <div className="lock-shell">
        <TimeBlock now={now} isAr={isAr} />

        <form ref={unlockRef} className="lock-unlock" onSubmit={handleSubmit}>
          <div className="lock-grab" aria-hidden="true" />
          <Avatar className="lock-avatar">
            {identity?.photo_url && <AvatarImage src={identity.photo_url} alt="" />}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <p className="lock-name">{displayName}</p>
          <p className="lock-welcome">{t('lockScreen.welcomeName', { name: displayName })}</p>
          <p className={`lock-cheer${cheerMilestone ? ' lock-cheer--milestone' : ''}`}>
            {cheerText}
          </p>
          {shiftCountdown && <p className="lock-cheer-shift">{shiftCountdown}</p>}
          <label className="sr-only" htmlFor="lock-pwd">
            {t('lockScreen.password')}
          </label>
          <div className="lock-field">
            <input
              id="lock-pwd"
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              autoComplete="current-password"
              placeholder={t('lockScreen.password')}
            />
            <button
              className="lock-eye"
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={t(showPassword ? 'lockScreen.hidePassword' : 'lockScreen.showPassword')}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
            <button
              className="lock-submit"
              type="submit"
              disabled={!password || submitting}
              aria-label={t('lockScreen.unlock')}
            >
              {submitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                <span aria-hidden="true">{isAr ? '←' : '→'}</span>
              )}
            </button>
          </div>
          {error && (
            <p className="lock-error" role="alert">
              {error}
            </p>
          )}
          <p className="lock-idle">
            {t('lockScreen.idleNote', {
              duration: t(
                `lockTimer.durations.${user?.idle_lock_seconds ?? DEFAULT_IDLE_LOCK_SECONDS}`,
              ),
            })}
          </p>
          <button className="lock-signout" type="button" onClick={onSignOut}>
            {t('lockScreen.signOut')}
          </button>
        </form>

        <OperationsBlock
          snapshot={workforceQuery.data ?? null}
          weather={weatherQuery.data ?? null}
          digest={layout === 'console' ? [] : digest}
          isAr={isAr}
        />

        {layout === 'console' && digest.length > 0 && (
          <div className="lock-digest-strip">
            <DigestList digest={digest} />
          </div>
        )}
      </div>
    </div>
  )
}
