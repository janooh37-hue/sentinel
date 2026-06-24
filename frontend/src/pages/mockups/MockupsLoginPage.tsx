/**
 * MockupsLoginPage — six login-screen design directions, side-by-side.
 *
 * Each mockup is composed from the real shadcn primitives (`Button`, `Input`,
 * `Card`, `Label`, `Avatar`, `Separator`) and the actual TAMM tokens
 * (`--hero-grad`, `--primary`, `--accent`, `--mountain`, mountain SVG, the
 * rotating-crest animation from the Dashboard hero) so the previews use the
 * same visual vocabulary that ships in production.
 *
 * Mounted at `/mockups/login`. Lazy-loaded; not linked from any navigation.
 */

import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, AtSign, Eye, EyeOff, Languages, Lock, LogIn } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MountainAccent } from '@/components/ui/mountain-accent'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/* Page shell                                                                 */
/* -------------------------------------------------------------------------- */

export function MockupsLoginPage(): React.JSX.Element {
  // Mount Fraunces (variable serif, ital + opsz + wght axes) from Google Fonts
  // for the preview. When wiring the real LoginPage we'll switch to a bundled
  // @fontsource-variable/fraunces import so the app stays offline-capable.
  useEffect(() => {
    if (document.querySelector('link[data-mock-fonts]')) return
    const preconnectG = document.createElement('link')
    preconnectG.rel = 'preconnect'
    preconnectG.href = 'https://fonts.googleapis.com'
    preconnectG.setAttribute('data-mock-fonts', 'true')
    document.head.appendChild(preconnectG)

    const preconnectGstatic = document.createElement('link')
    preconnectGstatic.rel = 'preconnect'
    preconnectGstatic.href = 'https://fonts.gstatic.com'
    preconnectGstatic.crossOrigin = 'anonymous'
    preconnectGstatic.setAttribute('data-mock-fonts', 'true')
    document.head.appendChild(preconnectGstatic)

    const stylesheet = document.createElement('link')
    stylesheet.rel = 'stylesheet'
    stylesheet.href =
      'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&display=swap'
    stylesheet.setAttribute('data-mock-fonts', 'true')
    document.head.appendChild(stylesheet)
  }, [])

  const mocks = [
    { id: 'm1', name: 'Hero strip + form', tagline: 'Top: hero gradient with rotating GSSG crest, EN / AR title. Bottom: white form panel. Borrowed straight from the existing Dashboard hero language.', el: <MockOne /> },
    { id: 'm2', name: 'Editorial Card on sand', tagline: 'Centered Card on the sand canvas. Red top accent rule, rotating GSSG crest, italic Fraunces heading, floating-label inputs with leading icons and an eye/eye-off toggle on password. The committed direction.', el: <MockTwo /> },
    { id: 'm3', name: 'Letterhead · Form A', tagline: 'CardHeader as letterhead with "No. 0001". Numbered fields. The submit is the only red surface, sealed like an official stamp.', el: <MockThree /> },
    { id: 'm4', name: 'Split: navy brand + cream form', tagline: 'Two-column. Left panel uses --hero-grad with rotating crest + mountain. Right panel is a clean form Card. Most TAMM-faithful split.', el: <MockFour /> },
    { id: 'm5', name: 'Photographic split', tagline: 'Calibrated dune-and-navy gradient hero on the left, slim form column on the right. Carries the brand harder than Mock 4.', el: <MockFive /> },
    { id: 'm6', name: 'Editorial full-bleed', tagline: 'No card. Pure typography on sand. Hairline-underline inputs. Italic serif "Good morning." The furthest from a login template.', el: <MockSix /> },
  ]

  return (
    <div dir="ltr" className="min-h-full overflow-y-auto bg-[#ece9e1]">
      <style>{rotatingCrestKeyframes}</style>

      <header className="sticky top-0 z-20 border-b border-border/60 bg-[#ece9e1]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl italic text-primary" style={SERIF}>
              Login mockups
            </h1>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              GSSG · 6 directions · shadcn + TAMM tokens
            </span>
          </div>
          <nav className="flex gap-1">
            {mocks.map((m, i) => (
              <a
                key={m.id}
                href={`#${m.id}`}
                className="rounded-full px-2.5 py-1 font-mono text-xs tracking-[0.1em] text-muted-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {String(i + 1).padStart(2, '0')}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-10">
        {mocks.map((m, i) => (
          <section key={m.id} id={m.id} className="scroll-mt-24">
            <div className="mb-3 flex items-baseline gap-3 px-1">
              <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent">
                Mock {String(i + 1).padStart(2, '0')}
              </span>
              <h2 className="text-2xl italic text-primary" style={SERIF}>
                {m.name}
              </h2>
            </div>
            <p className="mb-4 max-w-3xl px-1 text-sm leading-relaxed text-muted-foreground">
              {m.tagline}
            </p>
            <DeviceFrame>{m.el}</DeviceFrame>
          </section>
        ))}

        <footer className="pb-12 pt-4 text-center font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Tell me which to commit to · hybrids allowed (e.g. "2 + 3")
        </footer>
      </main>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Device frame                                                               */
/* -------------------------------------------------------------------------- */

function DeviceFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="relative overflow-hidden rounded-2xl shadow-[0_1px_0_rgba(13,40,69,0.04),_0_12px_32px_-16px_rgba(13,40,69,0.22),_0_30px_80px_-40px_rgba(13,40,69,0.28)]"
      style={{ aspectRatio: '16 / 10' }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-1 border-b border-black/5 bg-gradient-to-b from-[#e1ddd2] to-[#d6d2c6] px-3 font-mono text-xs text-primary/40">
        <span className="h-2 w-2 rounded-full bg-primary/25" />
        <span className="h-2 w-2 rounded-full bg-primary/25" />
        <span className="h-2 w-2 rounded-full bg-primary/25" />
        <span className="ml-3 text-[10px] tracking-[0.18em] text-primary/40">gssg · sign-in preview</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 top-7 overflow-hidden bg-background">
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Shared form atoms (used inside several mockups)                            */
/* -------------------------------------------------------------------------- */

function PasswordInput({
  id,
  className = '',
  placeholder = '••••••••••',
}: {
  id: string
  className?: string
  placeholder?: string
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        className={className}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 end-2 my-auto flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
      >
        {show ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
      </button>
    </div>
  )
}

function RotatingCrest({ size = 84, className = '' }: { size?: number; className?: string }): React.JSX.Element {
  return (
    <div
      className={`rotating-crest relative inline-flex items-center justify-center rounded-full overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        boxShadow: '0 0 0 2px rgba(255,255,255,0.18)',
      }}
    >
      <img
        src="/brand/gssg-logo.png"
        alt=""
        aria-hidden
        className="rotating-crest-img h-full w-full object-cover"
      />
    </div>
  )
}

const rotatingCrestKeyframes = `
  .rotating-crest-img { animation: gssg-mock-crest-spin 90s linear infinite; }
  @keyframes gssg-mock-crest-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .rotating-crest-img { animation: none; }
  }
  .mock-fade-in { animation: mock-fade-in .6s cubic-bezier(.22,1,.36,1) both; }
  @keyframes mock-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }
`

const SERIF: React.CSSProperties = {
  fontFamily: '"Fraunces", "Noto Naskh Arabic", Georgia, serif',
  letterSpacing: '-0.02em',
  fontVariationSettings: '"opsz" 144',
  fontFeatureSettings: '"ss01", "ss02"',
}

/* ========================================================================== */
/* MOCK 1 — Hero strip + form (TAMM-Dashboard-derived)                        */
/* ========================================================================== */

function MockOne(): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col bg-background mock-fade-in">
      <div
        className="relative flex h-[45%] items-center overflow-hidden px-10"
        style={{ background: 'var(--hero-grad)' }}
      >
        {/* soft white highlight */}
        <div className="pointer-events-none absolute -right-20 -top-32 h-80 w-80 rounded-full bg-white/8 blur-3xl" />
        <div className="pointer-events-none absolute -left-12 -bottom-32 h-72 w-72 rounded-full bg-white/4 blur-3xl" />

        <div className="relative z-10 flex w-full items-center justify-between">
          <div className="max-w-md text-white">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
              Saturday · 23 May 2026
            </p>
            <h2 className="mt-3 text-3xl font-light leading-tight" style={SERIF}>
              Welcome to GSSG.
            </h2>
            <p className="mt-1 text-base text-white/70" dir="rtl" style={{ fontFamily: 'var(--font-arabic)' }}>
              السلطة المشتركة لخدمات الجامعات الحكومية
            </p>
          </div>
          <RotatingCrest size={92} />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-12 py-8">
        <form onSubmit={(e) => e.preventDefault()} className="grid w-full max-w-md grid-cols-1 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="m1-id" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Email or G-number
            </Label>
            <Input id="m1-id" placeholder="you@gssg.ae or G3082" className="h-10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m1-pwd" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Password
            </Label>
            <PasswordInput id="m1-pwd" className="h-10 pe-12" />
          </div>
          <Button type="submit" size="lg" className="mt-2 h-11 rounded-full font-semibold">
            Sign in <LogIn className="h-4 w-4" strokeWidth={1.8} />
          </Button>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            No account?{' '}
            <a href="#" className="font-medium text-primary underline-offset-4 hover:underline">Request access →</a>
          </p>
        </form>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* MOCK 2 — Editorial Card on sand                                            */
/* ========================================================================== */

function MockTwo(): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [previewError, setPreviewError] = useState(false)
  const [touched, setTouched] = useState(false)

  // Validation runs after submit ("touched") or when the preview toggle is on.
  const showErrors = touched || previewError
  const emailError =
    showErrors && (email.length === 0 ? 'Email or G-number is required.' : null)
  const passwordError =
    showErrors && (password.length === 0 ? 'Password is required.' : null)

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    setTouched(true)
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-background mock-fade-in">
      <Card className="relative w-[min(420px,86%)] overflow-hidden shadow-[0_24px_60px_-30px_rgba(13,40,69,0.35)]">
        {/* red top accent rule */}
        <div className="absolute inset-x-0 top-0 h-[3px] bg-accent" />

        <CardContent className="px-9 pb-9 pt-10">
          <div className="mb-7 flex flex-col items-center gap-3">
            <Avatar className="h-16 w-16 ring-2 ring-primary-soft">
              <AvatarImage src="/brand/gssg-logo.png" alt="" className="rotating-crest-img object-cover" />
              <AvatarFallback className="bg-primary text-primary-foreground">G</AvatarFallback>
            </Avatar>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Joint Authority · Sign in
            </p>
            <h3 className="text-4xl font-normal italic text-primary" style={SERIF}>
              Good morning.
            </h3>
          </div>

          <form onSubmit={handleSubmit} className="grid gap-9">
            <FloatingField
              id="m2-id"
              label="Email or G-number"
              type="text"
              value={email}
              onChange={setEmail}
              leadingIcon={<AtSign className="h-4 w-4" strokeWidth={1.7} />}
              error={emailError}
            />
            <FloatingField
              id="m2-pwd"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              leadingIcon={<Lock className="h-4 w-4" strokeWidth={1.7} />}
              passwordToggle
              error={passwordError}
            />
            <Button type="submit" size="lg" className="mt-2 h-11 rounded-full font-semibold">
              Sign in <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
            </Button>
          </form>

          <Separator className="my-6" />

          <div className="flex items-center justify-between text-sm">
            <a href="#" className="font-medium text-primary underline-offset-4 hover:underline">
              Request access
            </a>
            <button className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-primary">
              <Languages className="h-3.5 w-3.5" strokeWidth={1.7} /> العربية
            </button>
          </div>

          {/* Preview-only: toggle error states without typing/submitting */}
          <div className="mt-5 flex items-center justify-center gap-2 border-t border-dashed border-border pt-4 font-mono text-[10px] uppercase tracking-[0.18em]">
            <span className="text-muted-foreground">Preview</span>
            <button
              type="button"
              onClick={() => setPreviewError(false)}
              className={cn(
                'rounded-full px-2 py-0.5 transition-colors',
                !previewError ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setPreviewError(true)}
              className={cn(
                'rounded-full px-2 py-0.5 transition-colors',
                previewError ? 'bg-accent text-white' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Error
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ----- Floating-label field (faithful port of Uiverse · ilkhoeri) ------- */

function FloatingField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  leadingIcon,
  passwordToggle = false,
  error,
}: {
  id: string
  label: string
  type?: 'text' | 'email' | 'password'
  value: string
  onChange: (v: string) => void
  leadingIcon: React.ReactNode
  passwordToggle?: boolean
  error?: string | null | false
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const effectiveType = passwordToggle && show ? 'text' : type
  const isErrored = Boolean(error)

  return (
    <div className="relative flex flex-row items-center">
      <input
        id={id}
        name={id}
        type={effectiveType}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        spellCheck={false}
        autoComplete="off"
        aria-invalid={isErrored}
        className={cn(
          'peer m-0 box-border block h-[40px] min-h-[40px] w-full appearance-none rounded-[10px] border border-solid bg-surface pl-2 pr-[40px] text-[15px] font-normal leading-normal text-foreground outline-0 transition-colors duration-200',
          'font-mono tracking-[-0.005em] tabular-nums',
          'placeholder:text-transparent',
          'focus-visible:outline-0 focus-visible:outline-none focus-visible:ring-4',
          isErrored
            ? 'border-accent text-accent focus-visible:border-accent focus-visible:ring-accent-soft'
            : 'border-border focus-visible:border-primary focus-visible:ring-primary-soft',
        )}
      />

      {/* Floating label — resting on top of the leading icon area, lifts to
          y -36 (fully above the input) on focus or when the field has a value.
          Stays at text-sm at all states. */}
      <label
        htmlFor={id}
        className={cn(
          'absolute z-0 mb-px inline-block origin-[0] cursor-text select-none text-start text-sm font-normal transition-transform duration-300',
          'translate-x-[32px]',
          'peer-focus-visible:translate-x-[8px] peer-focus-visible:translate-y-[-36px]',
          'peer-[:not(:placeholder-shown)]:translate-x-[8px] peer-[:not(:placeholder-shown)]:translate-y-[-36px]',
          isErrored
            ? 'text-accent'
            : 'text-muted-foreground peer-focus-visible:text-primary',
        )}
      >
        {label}
      </label>

      {/* Leading icon — hidden when input is focused or filled */}
      <span
        className={cn(
          'pointer-events-none absolute left-0 top-0 bottom-0 z-[1] flex size-[40px] items-center justify-center transition-opacity duration-200',
          'peer-focus-visible:hidden peer-[:not(:placeholder-shown)]:hidden',
          isErrored ? 'text-accent' : 'text-muted-foreground',
        )}
        aria-hidden
      >
        {leadingIcon}
      </span>

      {/* Trailing slot: error icon (with hover tooltip) > eye toggle > nothing */}
      <div className="absolute right-0 top-0 bottom-0 z-[1] flex size-[40px] items-center justify-center">
        {isErrored ? (
          <div className="group relative flex h-full w-full items-center justify-center text-accent">
            <AlertCircle className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute right-0 -z-10 select-none whitespace-nowrap rounded-[4px] bg-accent px-2 py-1 text-xs text-white opacity-0 shadow-md transition-all duration-300 group-hover:-translate-y-[calc(100%+18px)] group-hover:opacity-100"
            >
              {error}
            </span>
          </div>
        ) : passwordToggle ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          >
            {show ? (
              <EyeOff className="h-4 w-4" strokeWidth={1.7} />
            ) : (
              <Eye className="h-4 w-4" strokeWidth={1.7} />
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* MOCK 3 — Letterhead · Form A                                               */
/* ========================================================================== */

function MockThree(): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background px-14 py-10 mock-fade-in">
      <Card className="w-full max-w-2xl overflow-hidden">
        <CardHeader className="bg-surface-tinted">
          <div className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-accent text-accent">
              ★
            </span>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
              <span className="font-semibold">GSSG</span>
              <span className="px-2 text-muted-foreground">·</span>
              <span>Joint Authority for Government Services</span>
            </div>
          </div>
          <span className="font-mono text-[11px] tabular-nums tracking-[0.14em] text-muted-foreground">
            No. 0001
          </span>
        </CardHeader>

        <CardContent className="px-8 py-7">
          <div className="mb-6 flex items-baseline justify-between border-b-2 border-primary pb-2">
            <h3 className="text-2xl italic text-primary" style={SERIF}>
              Form A · Sign-in
            </h3>
            <time className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Sat · 23 May 2026
            </time>
          </div>

          <form onSubmit={(e) => e.preventDefault()} className="space-y-5">
            <NumberedField n="①" htmlFor="m3-id" label="Identifier">
              <Input id="m3-id" placeholder="email or G-number" className="h-10" />
            </NumberedField>
            <NumberedField n="②" htmlFor="m3-pwd" label="Password">
              <PasswordInput id="m3-pwd" className="h-10 pe-12" />
            </NumberedField>

            <Separator className="my-5" />

            <div className="flex items-center gap-5">
              <span className="text-base italic text-muted-foreground" style={SERIF}>
                Signature
              </span>
              <Button
                type="submit"
                className="h-10 rounded-full bg-accent px-7 font-semibold text-white shadow-[0_0_0_4px_rgba(200,16,46,0.1)] hover:bg-accent-hover focus-visible:ring-accent"
              >
                Sign in
              </Button>
              <span className="ms-auto text-sm text-muted-foreground">
                First time?{' '}
                <a href="#" className="font-medium text-primary underline-offset-4 hover:underline">
                  Request access →
                </a>
              </span>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function NumberedField({
  n,
  label,
  htmlFor,
  children,
}: {
  n: string
  label: string
  htmlFor: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[36px_1fr] items-start gap-4">
      <span className="pt-5 text-right text-2xl italic leading-none text-accent" style={SERIF}>
        {n}
      </span>
      <div className="grid gap-1.5">
        <Label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </Label>
        {children}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* MOCK 4 — Split: navy brand + cream form                                    */
/* ========================================================================== */

function MockFour(): React.JSX.Element {
  return (
    <div className="grid h-full w-full grid-cols-2 bg-background mock-fade-in">
      <aside
        className="relative overflow-hidden p-10 text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <div className="pointer-events-none absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-white/8 blur-3xl" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center gap-3">
            <RotatingCrest size={56} />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">Joint Authority</p>
              <p className="text-base font-semibold text-white">GSSG</p>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-3xl leading-tight" style={SERIF}>
              For the schools of the nation.
            </h2>
            <p className="text-base text-white/70" dir="rtl" style={{ fontFamily: 'var(--font-arabic)' }}>
              للمدارس الحكومية. معًا.
            </p>
          </div>

          <MountainAccent className="absolute -inset-x-0 bottom-0 h-24 w-full opacity-80" />
          <p className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            24.466°N · 54.367°E
          </p>
        </div>
      </aside>

      <div className="flex flex-col justify-center bg-surface px-12 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-accent">Welcome to</p>
        <h3 className="mt-2 text-4xl italic text-primary" style={SERIF}>
          Good morning.
        </h3>
        <div className="mt-3 h-px w-8 bg-accent" />

        <form onSubmit={(e) => e.preventDefault()} className="mt-6 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="m4-id" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Email or G-number
            </Label>
            <Input id="m4-id" placeholder="you@gssg.ae or G3082" className="h-10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m4-pwd" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Password
            </Label>
            <PasswordInput id="m4-pwd" className="h-10 pe-12" />
          </div>
          <Button type="submit" size="lg" className="mt-2 h-11 rounded-full font-semibold">
            Sign in
          </Button>
        </form>

        <p className="mt-5 text-sm text-muted-foreground">
          No account?{' '}
          <a href="#" className="font-medium text-primary underline-offset-4 hover:underline">Request access →</a>
        </p>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* MOCK 5 — Photographic split                                                */
/* ========================================================================== */

function MockFive(): React.JSX.Element {
  return (
    <div className="grid h-full w-full grid-cols-[1.4fr_1fr] mock-fade-in">
      {/* photographic hero (gradient-composed since we don't have a stock photo) */}
      <aside className="relative overflow-hidden p-9 text-white">
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(13,40,69,0.72) 0%, rgba(13,40,69,0.94) 60%, rgba(20,55,90,0.96) 100%), linear-gradient(180deg, #d2c6a8 0%, #b89d6e 45%, #6a4a28 100%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-1/3 h-px bg-white/20" />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 70% 35% at 75% 88%, rgba(245, 200, 130, 0.22), transparent 70%), radial-gradient(ellipse 50% 25% at 22% 75%, rgba(200, 16, 46, 0.12), transparent 70%)',
            mixBlendMode: 'screen',
          }}
        />

        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center gap-3">
            <RotatingCrest size={48} />
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
              GSSG · 24.466°N 54.367°E
            </span>
          </div>

          <div className="max-w-sm">
            <p className="text-2xl italic leading-snug text-white" style={SERIF}>
              Together for the nation.
            </p>
            <p className="mt-2 text-base text-white/65" dir="rtl" style={{ fontFamily: 'var(--font-arabic)' }}>
              معًا من أجل الوطن.
            </p>
          </div>
        </div>
      </aside>

      <div className="flex flex-col justify-center bg-surface px-10 py-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Sign in
        </p>
        <h3 className="mt-2 text-3xl italic text-primary" style={SERIF}>
          Welcome.
        </h3>
        <div className="mt-2 h-px w-7 bg-accent" />

        <form onSubmit={(e) => e.preventDefault()} className="mt-6 grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="m5-id" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Email or G-number
            </Label>
            <Input id="m5-id" placeholder="you@gssg.ae" className="h-10" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m5-pwd" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Password
            </Label>
            <PasswordInput id="m5-pwd" className="h-10 pe-12" />
          </div>
          <Button type="submit" size="lg" className="mt-2 h-11 rounded-full font-semibold">
            Sign in
          </Button>
        </form>

        <Separator className="my-6" />
        <a href="#" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          Request access →
        </a>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* MOCK 6 — Editorial full-bleed                                              */
/* ========================================================================== */

function MockSix(): React.JSX.Element {
  return (
    <div className="relative flex h-full w-full flex-col bg-background px-14 py-10 mock-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl italic text-primary" style={SERIF}>
            GSSG
          </span>
          <span className="inline-block h-5 w-[3px] bg-accent" />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Sat · 23 May 2026
        </span>
      </div>

      <div className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-md">
          <h2 className="text-5xl italic leading-[1.05] text-primary" style={SERIF}>
            Good morning.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            A new day at the joint authority. Sign in to continue.
          </p>

          <form onSubmit={(e) => e.preventDefault()} className="mt-8 space-y-6">
            <HairlineField id="m6-id" label="Email or G-number" placeholder="you@gssg.ae" />
            <HairlineField id="m6-pwd" label="Password" type="password" placeholder="••••••••••" trailing />
            <button
              type="submit"
              className="group inline-flex items-center gap-2 border-b-2 border-accent pb-1 text-xl italic text-primary transition-colors hover:text-accent"
              style={SERIF}
            >
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </div>

      <div className="flex justify-center gap-5 text-sm text-muted-foreground">
        <a href="#" className="border-b border-border-strong pb-0.5 hover:border-primary hover:text-primary">
          Request access
        </a>
        <span className="opacity-40">·</span>
        <a href="#" className="border-b border-border-strong pb-0.5 hover:border-primary hover:text-primary">
          العربية
        </a>
      </div>

      <MountainAccent className="pointer-events-none absolute inset-x-0 bottom-0 h-20 w-full opacity-40" />
    </div>
  )
}

function HairlineField({
  id,
  label,
  type = 'text',
  placeholder,
  trailing,
}: {
  id: string
  label: string
  type?: string
  placeholder?: string
  trailing?: boolean
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const effectiveType = type === 'password' && show ? 'text' : type
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={effectiveType}
          placeholder={placeholder}
          className="w-full border-0 border-b border-border-strong bg-transparent px-0 py-2 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus-visible:ring-0"
        />
        {trailing && type === 'password' && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShow((v) => !v)}
            className="absolute end-0 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-primary"
          >
            {show ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
          </button>
        )}
      </div>
    </div>
  )
}

export default MockupsLoginPage
