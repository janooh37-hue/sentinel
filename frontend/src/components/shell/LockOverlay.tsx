/**
 * LockOverlay — full-screen unlock prompt (TAMM redesign).
 *
 * Renders above all page content over the hero-gradient backdrop. The center
 * card hosts the employee photo, an italic serif welcome line, and the
 * password input + Unlock pill. Operator re-enters their account password; we
 * verify it via POST /auth/verify-password (bcrypt compare against the
 * signed-in user's stored hash).
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useIdentity } from '@/lib/useIdentity'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface LockOverlayProps {
  onUnlocked: () => void
}

export function LockOverlay({ onUnlocked }: LockOverlayProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { user } = useAuth()
  const { identity } = useIdentity()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!password) return
    setSubmitting(true)
    setError(null)
    try {
      await api.verifyAuthPassword(password)
      onUnlocked()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
      setSubmitting(false)
    }
  }

  const email = user?.email
  const initials = (email?.split('@')[0]?.[0] ?? '?').toUpperCase()
  const displayName = identity?.linked
    ? (isAr ? identity.name_ar : identity.name_en) ?? identity.name_en
    : null

  return (
    <div
      className="anim-scrim-in fixed inset-0 z-[100] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('lockScreen.title', { defaultValue: 'App locked' })}
      dir={isAr ? 'rtl' : 'ltr'}
      style={{ background: 'var(--hero-grad)' }}
    >
      <form
        onSubmit={handleSubmit}
        className="anim-pop-in flex w-full max-w-md flex-col gap-5 rounded-2xl bg-surface p-8 shadow-2xl"
      >
        {/* Photo + welcome */}
        <div className="flex flex-col items-center gap-4">
          <Avatar className="h-20 w-20 bg-primary-soft text-primary ring-2 ring-border">
            {identity?.photo_url && <AvatarImage src={identity.photo_url} alt="" />}
            <AvatarFallback className="text-2xl">
              {identity?.name_en?.[0]?.toUpperCase() ?? initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex flex-col items-center gap-1">
            <span className="inline-flex items-center gap-1.5 text-[0.72em] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Lock className="h-3 w-3" strokeWidth={2} />
              {t('lockScreen.title', { defaultValue: 'App locked' })}
            </span>

            {displayName ? (
              <p
                className="text-center text-[1.15em] italic text-foreground"
                style={{ fontFamily: 'Georgia, "Noto Naskh Arabic", serif' }}
              >
                {t('lockScreen.welcomeName', { name: displayName })}.
              </p>
            ) : (
              <p className="text-[1em] font-semibold text-foreground">
                {email ?? (isAr ? 'لا يوجد حساب' : 'No account')}
              </p>
            )}

            {displayName && email && (
              <span className="text-[0.78em] text-muted-foreground">{email}</span>
            )}

            <p className="mt-1 text-[0.82em] text-muted-foreground">
              {isAr
                ? 'أدخل كلمة المرور لإلغاء القفل'
                : 'Enter your password to unlock'}
            </p>
          </div>
        </div>

        {/* Password input */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="lock-pwd"
            className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
          >
            {t('lockScreen.password', { defaultValue: 'Password' })}
          </label>
          <div className="relative">
            <input
              id="lock-pwd"
              ref={inputRef}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete="current-password"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 pe-10 text-[0.95em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
              aria-label={
                showPassword
                  ? isAr
                    ? 'إخفاء كلمة المرور'
                    : 'Hide password'
                  : isAr
                    ? 'إظهار كلمة المرور'
                    : 'Show password'
              }
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff key="off" className="anim-icon-swap h-4 w-4" strokeWidth={1.7} />
              ) : (
                <Eye key="on" className="anim-icon-swap h-4 w-4" strokeWidth={1.7} />
              )}
            </button>
          </div>
          {error && (
            <span className="mt-0.5 text-[0.78em] text-accent">{error}</span>
          )}
        </div>

        {/* Unlock pill */}
        <button
          type="submit"
          disabled={!password || submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[0.92em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          )}
          {t('lockScreen.unlock', { defaultValue: 'Unlock' })}
        </button>
      </form>
    </div>
  )
}
