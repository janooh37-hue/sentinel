/**
 * LoginPage — multi-user sign-in (hero layout).
 *
 * Faithful port of the Claude Design handoff (project/Login.html, hero layout)
 * wired to the real auth API. States: account picker, sign-in form, request
 * access, request-sent, forgot password, locked-out. EN/AR + RTL + light/dark
 * all follow the existing token + i18n machinery.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Hash,
  Lock,
  Mail,
  Phone,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { setLanguage } from '@/lib/i18n'
import { useAuth } from '@/lib/authContext'
import { copyToClipboard } from '@/lib/clipboard'
import './LoginPage.css'

type Screen = 'picker' | 'form' | 'request' | 'requestSent' | 'forgot' | 'locked'

interface KnownAccount {
  email: string
  name: string
  g: string | null
  ts: number
}

const KNOWN_KEY = 'gssg.knownAccounts'
const AVATAR_COLORS = ['#0d2845', '#1d4ed8', '#047857', '#b45309']

function readKnown(): KnownAccount[] {
  try {
    const raw = window.localStorage.getItem(KNOWN_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as KnownAccount[]
    return Array.isArray(parsed) ? parsed.slice(0, 4) : []
  } catch {
    return []
  }
}

function rememberAccount(acc: KnownAccount): void {
  try {
    const existing = readKnown().filter((a) => a.email !== acc.email)
    const next = [acc, ...existing].slice(0, 4)
    window.localStorage.setItem(KNOWN_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function colorFor(email: string): string {
  let h = 0
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

function initialsOf(value: string): string {
  const base = value.includes('@') ? value.split('@')[0] : value
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return value[0]?.toUpperCase() ?? '?'
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function relativeLast(ts: number, isAr: boolean): string {
  const mins = Math.floor((Date.now() - ts) / 60_000)
  if (mins < 1) return isAr ? 'الآن' : 'just now'
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return isAr ? `منذ ${hrs} س` : `${hrs} h ago`
  const days = Math.floor(hrs / 24)
  return isAr ? `منذ ${days} ي` : `${days} d ago`
}

interface FieldError {
  field?: 'password'
  msg: string
}

export function LoginPage(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const { login, setUser } = useAuth()

  const known = useMemo(() => readKnown(), [])
  const [screen, setScreen] = useState<Screen>(known.length > 0 ? 'picker' : 'form')
  const [picked, setPicked] = useState<KnownAccount | null>(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)

  // Request-access fields.
  const [rEmail, setREmail] = useState('')
  const [rG, setRG] = useState('')
  const [rPwd, setRPwd] = useState('')
  const [rPwd2, setRPwd2] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<FieldError | null>(null)
  const [lockedName, setLockedName] = useState('')
  const [copied, setCopied] = useState(false)

  function goPicker(): void {
    setPicked(null)
    setEmail('')
    setPassword('')
    setError(null)
    setScreen(known.length > 0 ? 'picker' : 'form')
  }

  function pick(acc: KnownAccount): void {
    setPicked(acc)
    setEmail(acc.email)
    setPassword('')
    setError(null)
    setScreen('form')
  }

  async function doLogin(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const loginEmail = picked?.email ?? email
    if (!loginEmail || !password) return
    setSubmitting(true)
    setError(null)
    try {
      const user = await login(loginEmail, password)
      rememberAccount({
        email: user.email,
        name: user.name_en ?? user.email,
        g: user.employee_id,
        ts: Date.now(),
      })
      // App swaps to the Shell now that status is authed; no further setState.
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          setLockedName(picked?.name ?? loginEmail)
          setScreen('locked')
          setSubmitting(false)
          return
        }
        if (err.code === 'ACCOUNT_PENDING') {
          setError({ msg: t('auth.errPending') })
        } else if (err.code === 'INVALID_CREDENTIALS') {
          const left = err.details?.attempts_left
          const suffix =
            typeof left === 'number' ? ` ${t('auth.attemptsLeft', { count: left })}` : ''
          setError({ field: 'password', msg: `${err.message}${suffix}` })
        } else {
          setError({ msg: err.message || t('auth.errGeneric') })
        }
      } else {
        setError({ msg: t('auth.errGeneric') })
      }
      setSubmitting(false)
    }
  }

  async function doRequest(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!rEmail) {
      setError({ msg: t('auth.emailRequired') })
      return
    }
    if (rPwd.length < 8) {
      setError({ msg: t('auth.passwordTooShort') })
      return
    }
    if (rPwd !== rPwd2) {
      setError({ msg: t('auth.passwordsMismatch') })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.register({
        email: rEmail,
        password: rPwd,
        g_number: rG || null,
      })
      if (result.is_first && result.user) {
        setUser(result.user) // first account → straight into the app as admin
        return
      }
      setScreen('requestSent')
      setSubmitting(false)
    } catch (err) {
      setError({ msg: err instanceof ApiError ? err.message : t('auth.errGeneric') })
      setSubmitting(false)
    }
  }

  function copyEmail(): void {
    void copyToClipboard(t('auth.itEmail')).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="gssg-login">
      {/* Top chrome */}
      <div className="top-chrome">
        <span className="top-chrome__brand">
          <img className="top-chrome__logo" src="/brand/gssg-logo.png" alt="" />
          <span className="top-chrome__mark">
            <span className="top-chrome__wordmark">GSSG</span>
            <span className="top-chrome__tagline">{t('branding.tagline')}</span>
          </span>
        </span>
        <span className="top-chrome__eyebrow">{t('auth.eyebrow')}</span>
        <span className="top-chrome__spacer" />
        <button
          type="button"
          className="top-chrome__lang"
          onClick={() => setLanguage(isAr ? 'en' : 'ar')}
        >
          <span aria-hidden="true">🌐</span>
          <span>{t('auth.langToggle')}</span>
        </button>
      </div>

      <div className="stage">
        <div className="hero-band">
          <div className="hero-band__halo" />
          <span className="hero-band__meta">
            <span className="hero-band__meta-dot" />
            <span>{t('auth.meta')}</span>
          </span>
          <div className="hero-band__title">{t('auth.heroTitle')}</div>
          <div className="hero-band__sub">{t('auth.heroSub')}</div>
        </div>

        <div className="card-wrap">
          <div className="card">
            {screen === 'picker' && <PickerScreen onPick={pick} onOther={() => setScreen('form')} onRequest={() => setScreen('request')} known={known} isAr={isAr} t={t} />}
            {screen === 'form' && (
              <SignInScreen
                t={t}
                isAr={isAr}
                picked={picked}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                showPwd={showPwd}
                setShowPwd={setShowPwd}
                submitting={submitting}
                error={error}
                onSubmit={doLogin}
                onSwitch={goPicker}
                onForgot={() => { setError(null); setScreen('forgot') }}
                onRequest={() => { setError(null); setScreen('request') }}
              />
            )}
            {screen === 'request' && (
              <RequestScreen
                t={t}
                rEmail={rEmail} setREmail={setREmail}
                rG={rG} setRG={setRG}
                rPwd={rPwd} setRPwd={setRPwd}
                rPwd2={rPwd2} setRPwd2={setRPwd2}
                showPwd={showPwd} setShowPwd={setShowPwd}
                submitting={submitting} error={error}
                onSubmit={doRequest}
                onBack={() => { setError(null); setScreen(known.length ? 'picker' : 'form') }}
              />
            )}
            {screen === 'requestSent' && (
              <RequestSentScreen t={t} email={rEmail} onBack={goPicker} />
            )}
            {screen === 'forgot' && (
              <ForgotScreen t={t} onBack={goPicker} onCopy={copyEmail} copied={copied} />
            )}
            {screen === 'locked' && (
              <LockedScreen t={t} isAr={isAr} name={lockedName} onBack={goPicker} onCopy={copyEmail} copied={copied} />
            )}
          </div>
          <div className="small-print">{t('auth.smallPrint')}</div>
        </div>

        <div className="stage-footer">
          {t('auth.secureSession')} · {t('auth.meta')}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared field atoms                                                         */
/* -------------------------------------------------------------------------- */

type TFn = ReturnType<typeof useTranslation>['t']

function PasswordField({
  id, value, onChange, t, show, setShow, error, autoFocus, label,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  t: TFn
  show: boolean
  setShow: (v: boolean) => void
  error?: string | null
  autoFocus?: boolean
  label?: string
}): React.JSX.Element {
  return (
    <div className="field">
      <label className="field__lbl" htmlFor={id}>
        <span>{label ?? t('auth.password')}</span>
      </label>
      <div className="field__wrap">
        <span className="field__wrap-icon"><Lock size={16} strokeWidth={1.8} /></span>
        <input
          id={id}
          className={'field__inp' + (error ? ' field__inp--error' : '')}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('auth.passwordPlaceholder')}
          autoComplete="current-password"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="field__reveal"
          aria-label={show ? t('auth.hide') : t('auth.show')}
          onClick={() => setShow(!show)}
          tabIndex={-1}
        >
          {show ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
        </button>
      </div>
      {error && (
        <div className="field__err">
          <AlertCircle size={13} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function EmailField({
  value, onChange, t, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  t: TFn
  autoFocus?: boolean
}): React.JSX.Element {
  return (
    <div className="field">
      <label className="field__lbl" htmlFor="login-email"><span>{t('auth.email')}</span></label>
      <div className="field__wrap">
        <span className="field__wrap-icon"><Mail size={16} strokeWidth={1.8} /></span>
        <input
          id="login-email"
          className="field__inp"
          type="email"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          autoComplete="username"
          dir="ltr"
          autoFocus={autoFocus}
        />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Screens                                                                    */
/* -------------------------------------------------------------------------- */

function PickerScreen({
  known, onPick, onOther, onRequest, isAr, t,
}: {
  known: KnownAccount[]
  onPick: (a: KnownAccount) => void
  onOther: () => void
  onRequest: () => void
  isAr: boolean
  t: TFn
}): React.JSX.Element {
  return (
    <>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{t('auth.pickerTitle')}</span>
        <span className="card__sub">{t('auth.pickerSub')}</span>
      </div>
      <div className="picker">
        {known.map((u) => (
          <button key={u.email} className="picker__row" type="button" onClick={() => onPick(u)}>
            <span className="picker__ava" style={{ background: colorFor(u.email) }}>
              {initialsOf(u.name || u.email)}
            </span>
            <span className="picker__body">
              <span className="picker__name">{u.name || u.email}</span>
              <span className="picker__meta">
                {u.g && <span>{u.g}</span>}
                {u.g && <span style={{ color: 'var(--text-faint)' }}>·</span>}
                <span style={{ color: 'var(--text-faint)' }}>
                  {t('auth.lastSignIn')} {relativeLast(u.ts, isAr)}
                </span>
              </span>
            </span>
            <span className="picker__chev"><ChevronRight size={16} strokeWidth={1.8} /></span>
          </button>
        ))}
      </div>
      <div className="card__foot">
        <button className="btn btn--link" type="button" onClick={onOther}>
          {t('auth.useAnotherAccount')}
        </button>
        <button className="btn btn--link" type="button" onClick={onRequest}>
          {t('auth.requestAccess')}
        </button>
      </div>
    </>
  )
}

function SignInScreen(props: {
  t: TFn
  isAr: boolean
  picked: KnownAccount | null
  email: string
  setEmail: (v: string) => void
  password: string
  setPassword: (v: string) => void
  showPwd: boolean
  setShowPwd: (v: boolean) => void
  submitting: boolean
  error: FieldError | null
  onSubmit: (e: React.FormEvent) => void
  onSwitch: () => void
  onForgot: () => void
  onRequest: () => void
}): React.JSX.Element {
  const { t, picked, error } = props
  const pwdError = error && error.field === 'password' ? error.msg : null
  const formError = error && !error.field ? error.msg : null
  const title = picked
    ? `${t('auth.welcome').split(',')[0]}${props.isAr ? '، ' : ', '}${picked.name.split(' ')[0]}`
    : t('auth.welcome')

  return (
    <form onSubmit={props.onSubmit}>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{title}</span>
        {!picked && <span className="card__sub">{t('auth.cardSub')}</span>}
      </div>

      {picked ? (
        <div className="user-card">
          <span className="user-card__ava" style={{ background: colorFor(picked.email) }}>
            {initialsOf(picked.name || picked.email)}
          </span>
          <span className="user-card__body">
            <span className="user-card__name">{picked.name || picked.email}</span>
            <span className="user-card__meta">
              {picked.g && <span>{picked.g}</span>}
              {picked.g && <span className="dot" />}
              <span style={{ fontFamily: 'var(--font-sans)' }}>{picked.email}</span>
            </span>
          </span>
          <button type="button" className="user-card__switch" onClick={props.onSwitch}>
            {t('auth.switchAccount')}
          </button>
        </div>
      ) : (
        <EmailField value={props.email} onChange={props.setEmail} t={t} autoFocus />
      )}

      <div style={{ height: 18 }} />
      <PasswordField
        id="login-pwd"
        value={props.password}
        onChange={props.setPassword}
        t={t}
        show={props.showPwd}
        setShow={props.setShowPwd}
        error={pwdError}
        autoFocus={Boolean(picked)}
      />

      {formError && (
        <div className="field__err" style={{ marginTop: 12 }}>
          <AlertCircle size={13} strokeWidth={1.8} />
          <span>{formError}</span>
        </div>
      )}

      <div style={{ height: 18 }} />
      <button className="btn btn--primary" type="submit" disabled={props.submitting}>
        {props.submitting ? (
          <>
            <span className="spin" aria-hidden="true" />
            {t('auth.signingIn')}
          </>
        ) : (
          <>
            {t('auth.signIn')}
            <ArrowRight className="flip-x" size={14} strokeWidth={1.8} />
          </>
        )}
      </button>

      <div className="card__foot">
        <button className="btn btn--link" type="button" onClick={props.onForgot}>
          {t('auth.forgot')}
        </button>
        <button className="btn btn--link" type="button" onClick={props.onRequest}>
          {t('auth.requestAccess')}
        </button>
      </div>
    </form>
  )
}

function RequestScreen(props: {
  t: TFn
  rEmail: string; setREmail: (v: string) => void
  rG: string; setRG: (v: string) => void
  rPwd: string; setRPwd: (v: string) => void
  rPwd2: string; setRPwd2: (v: string) => void
  showPwd: boolean; setShowPwd: (v: boolean) => void
  submitting: boolean; error: FieldError | null
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}): React.JSX.Element {
  const { t } = props
  return (
    <form onSubmit={props.onSubmit}>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{t('auth.requestTitle')}</span>
        <span className="card__sub">{t('auth.requestSub')}</span>
      </div>
      <div className="steps">
        <span data-active="true">{t('auth.step1')}</span>
        <span className="steps__sep" />
        <span>{t('auth.step2')}</span>
        <span className="steps__sep" />
        <span>{t('auth.step3')}</span>
      </div>
      <div style={{ height: 4 }} />
      <EmailField value={props.rEmail} onChange={props.setREmail} t={t} autoFocus />
      <div style={{ height: 18 }} />
      <div className="field">
        <label className="field__lbl" htmlFor="req-g"><span>{t('auth.gNumber')}</span></label>
        <div className="field__wrap">
          <span className="field__wrap-icon"><Hash size={16} strokeWidth={1.8} /></span>
          <input
            id="req-g"
            className="field__inp field__inp--mono"
            type="text"
            value={props.rG}
            onChange={(e) => props.setRG(e.target.value.toUpperCase())}
            placeholder={t('auth.gNumberPlaceholder')}
            dir="ltr"
          />
        </div>
      </div>
      <div style={{ height: 18 }} />
      <PasswordField id="req-pwd" value={props.rPwd} onChange={props.setRPwd} t={t} show={props.showPwd} setShow={props.setShowPwd} />
      <div style={{ height: 18 }} />
      <PasswordField id="req-pwd2" value={props.rPwd2} onChange={props.setRPwd2} t={t} show={props.showPwd} setShow={props.setShowPwd} label={t('auth.confirmPassword')} />
      {props.error && (
        <div className="field__err" style={{ marginTop: 12 }}>
          <AlertCircle size={13} strokeWidth={1.8} />
          <span>{props.error.msg}</span>
        </div>
      )}
      <div style={{ height: 18 }} />
      <button className="btn btn--primary" type="submit" disabled={props.submitting}>
        {props.submitting ? (
          <><span className="spin" aria-hidden="true" />{t('auth.signingIn')}</>
        ) : (
          t('auth.submitForReview')
        )}
      </button>
      <div className="card__foot">
        <span style={{ color: 'var(--text-muted)' }}>{t('auth.haveAccount')}</span>
        <button className="btn btn--link" type="button" onClick={props.onBack}>
          {t('auth.signIn')}
        </button>
      </div>
    </form>
  )
}

function RequestSentScreen({
  t, email, onBack,
}: {
  t: TFn
  email: string
  onBack: () => void
}): React.JSX.Element {
  return (
    <>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{t('auth.requestSentTitle')}</span>
      </div>
      <div className="steps">
        <span data-active="true">{t('auth.step1')}</span>
        <span className="steps__sep" />
        <span data-active="true">{t('auth.step2')}</span>
        <span className="steps__sep" />
        <span>{t('auth.step3')}</span>
      </div>
      <div className="info info--ok">
        <span className="info__icon"><Check size={18} strokeWidth={1.8} /></span>
        <span className="info__text">{t('auth.requestSentText', { email })}</span>
      </div>
      <button className="btn btn--ghost" type="button" onClick={onBack} style={{ alignSelf: 'center' }}>
        {t('auth.backToSignIn')}
      </button>
    </>
  )
}

function ForgotScreen({
  t, onBack, onCopy, copied,
}: {
  t: TFn
  onBack: () => void
  onCopy: () => void
  copied: boolean
}): React.JSX.Element {
  return (
    <>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{t('auth.forgotTitle')}</span>
        <span className="card__sub">{t('auth.forgotSub')}</span>
      </div>
      <ItContact t={t} onCopy={onCopy} copied={copied} />
      <button className="btn btn--ghost" type="button" onClick={onBack} style={{ alignSelf: 'center' }}>
        {t('auth.backToSignIn')}
      </button>
    </>
  )
}

function LockedScreen({
  t, isAr, name, onBack, onCopy, copied,
}: {
  t: TFn
  isAr: boolean
  name: string
  onBack: () => void
  onCopy: () => void
  copied: boolean
}): React.JSX.Element {
  return (
    <>
      <div className="card__head">
        <span className="card__eyebrow">{t('auth.cardEyebrow')}</span>
        <span className="card__title">{t('auth.lockedTitle')}</span>
      </div>
      {name && (
        <div className="user-card">
          <span
            className="user-card__ava"
            style={{ background: colorFor(name), filter: 'grayscale(0.4) opacity(0.85)' }}
          >
            {initialsOf(name)}
          </span>
          <span className="user-card__body">
            <span className="user-card__name">
              <span>{name}</span>
              <span className="role-chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                {t('auth.lockedTitle')}
              </span>
            </span>
          </span>
        </div>
      )}
      <div className="info">
        <span className="info__icon"><AlertTriangle size={18} strokeWidth={1.8} /></span>
        <span className="info__text">{t('auth.lockedText')}</span>
      </div>
      <ItContact t={t} onCopy={onCopy} copied={copied} />
      <button className="btn btn--ghost" type="button" onClick={onBack} style={{ alignSelf: 'center' }}>
        {t('auth.backToSignIn')}
      </button>
      {/* isAr reserved for future locale-specific tweaks */}
      <span hidden>{String(isAr)}</span>
    </>
  )
}

function ItContact({
  t, onCopy, copied,
}: {
  t: TFn
  onCopy: () => void
  copied: boolean
}): React.JSX.Element {
  return (
    <div className="it-contact">
      <span className="it-contact__head">{t('auth.itContact')}</span>
      <div className="it-contact__rows">
        <span className="it-contact__row" style={{ fontWeight: 600 }}>
          <Phone size={14} strokeWidth={1.8} />
          <span>{t('auth.itName')}</span>
        </span>
        <span className="it-contact__row">
          <Mail size={14} strokeWidth={1.8} />
          <b>{t('auth.itEmail')}</b>
          <button className="it-contact__copy" type="button" onClick={onCopy}>
            {copied ? t('auth.copied') : t('auth.copy')}
          </button>
        </span>
        <span className="it-contact__row">
          <Phone size={14} strokeWidth={1.8} />
          <b>{t('auth.itExt')}</b>
        </span>
        <span className="it-contact__row" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          <Clock size={14} strokeWidth={1.8} />
          <span>{t('auth.itHours')}</span>
        </span>
      </div>
    </div>
  )
}

export default LoginPage
