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
  type WorkforceSnapshot,
} from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { loadLockWeather, weatherCategory, type LockWeather } from '@/lib/lockWeather'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIdentity } from '@/lib/useIdentity'
import { DEFAULT_IDLE_LOCK_SECONDS } from '@/lib/useLockState'

import './LockOverlay.css'

interface LockOverlayProps {
  onUnlocked: () => void
  onSignOut: () => void
}

type LockLayout = 'band' | 'stack' | 'console'

const LAYOUT_KEY = 'gssg.lockLayout'
const LAYOUTS: readonly LockLayout[] = ['band', 'stack', 'console']
const WEATHER_STALE_MS = 30 * 60_000

function readLayout(): LockLayout {
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY)
    return LAYOUTS.includes(stored as LockLayout) ? (stored as LockLayout) : 'band'
  } catch {
    return 'band'
  }
}

function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
  locale: string,
  timeZone: string,
): string | null {
  if (!start || !end) return null
  const formatter = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  })
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`
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
  const hasShift = currentRange !== null || nextRange !== null
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
          {currentRange && (
            <div className="lock-metric">
              <span className="lock-eyebrow">{t('lockScreen.onDutyNow')}</span>
              <strong><bdi dir="ltr">{currentRange}</bdi></strong>
              <small>{t('lockScreen.currentShift')}</small>
            </div>
          )}
          {nextRange && (
            <div className="lock-metric">
              <span className="lock-eyebrow">{t('lockScreen.nextShift')}</span>
              <strong><bdi dir="ltr">{nextRange}</bdi></strong>
              <small>{snapshot?.next_shift.shift_name ?? snapshot?.next_shift.shift_code}</small>
            </div>
          )}
        </div>
      )}

      {digest.length > 0 && (
        <div className="lock-digest" aria-label={t('lockScreen.whileAway')}>
          {digest.map((item) => (
            <div className="lock-digest-item" key={item.key}>
              <b>{item.count}</b>
              <span>{t(`lockScreen.digest.${item.key}`)}</span>
            </div>
          ))}
          <small>{t('lockScreen.detailsHidden')}</small>
        </div>
      )}

      {weather && (
        <div className="lock-weather">
          <span className="lock-eyebrow">{t('lockScreen.weather.title')}</span>
          <div className="lock-weather-main">
            <WeatherGlyph weather={weather} />
            <strong>
              <bdi dir="ltr">{weatherNumber.format(weather.temperatureC)}°</bdi>
            </strong>
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
  const [layout, setLayout] = useState<LockLayout>(readLayout)
  const [now, setNow] = useState(() => new Date())
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const unlockRef = useRef<HTMLFormElement>(null)
  const queryClient = useQueryClient()

  const { user } = useAuth()
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

  function chooseLayout(next: LockLayout): void {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Cosmetic preference can safely fall back to the default layout.
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
        <OperationsBlock
          snapshot={workforceQuery.data ?? null}
          weather={weatherQuery.data ?? null}
          digest={digest}
          isAr={isAr}
        />

        <form ref={unlockRef} className="lock-unlock" onSubmit={handleSubmit}>
          <div className="lock-grab" aria-hidden="true" />
          <Avatar className="lock-avatar">
            {identity?.photo_url && <AvatarImage src={identity.photo_url} alt="" />}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <p className="lock-name">{displayName}</p>
          <p className="lock-welcome">{t('lockScreen.welcomeName', { name: displayName })}</p>
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
      </div>

      <div className="lock-layout-switcher" role="group" aria-label={t('lockScreen.layoutTitle')}>
        {LAYOUTS.map((option, index) => (
          <button
            key={option}
            type="button"
            aria-label={t(`lockScreen.layout.${option}`)}
            aria-pressed={layout === option}
            onClick={() => chooseLayout(option)}
          >
            {String.fromCharCode(65 + index)}
          </button>
        ))}
      </div>
    </div>
  )
}
