/**
 * ErrorBoundary — catches React render errors and shows a fallback
 * with diagnostic info + clipboard copy button.
 *
 * The fallback is deliberately dependency-light: the illustration is fully
 * static inline SVG (no runtime generation, no effects) so the crash screen
 * can never itself throw. Motion is pure CSS, guarded for reduced-motion.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { APP_VERSION } from '@/lib/appVersion'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import i18n from '@/lib/i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/* ── Illustration ─────────────────────────────────────────────────────────
   A cable pulled apart over a layered hollow — plug and socket breathing
   away from each other around a red spark, while the GSSG globe slips out
   of reach. Blob rings and star field are precomputed; ids are `eb-`
   prefixed to avoid colliding with app SVG. */

const HALO =
  'M 210.6 0.0 C 210.6 28.0 164.2 55.5 145.5 84.0 C 126.8 112.5 122.8 156.7 98.6 170.7 C 74.3 184.7 33.6 166.7 0.0 168.0 C -33.6 169.3 -79.1 192.7 -103.0 178.5 C -127.0 164.3 -127.1 112.6 -143.6 82.9 C -160.0 53.1 -201.0 28.0 -201.6 0.0 C -202.2 -28.0 -164.4 -56.3 -147.4 -85.1 C -130.4 -113.9 -124.3 -158.8 -99.7 -172.7 C -75.1 -186.5 -33.6 -167.4 -0.0 -168.0 C 33.6 -168.6 77.7 -190.5 101.9 -176.5 C 126.2 -162.5 127.4 -113.4 145.5 -84.0 C 163.6 -54.6 210.6 -28.0 210.6 0.0 Z'
const RING = [
  'M 188.0 0.0 C 188.0 25.0 146.6 49.6 129.9 75.0 C 113.2 100.4 109.7 139.9 88.0 152.4 C 66.3 164.9 30.0 148.8 0.0 150.0 C -30.0 151.2 -70.6 172.0 -92.0 159.3 C -113.4 146.7 -113.5 100.6 -128.2 74.0 C -142.8 47.4 -179.4 25.0 -180.0 0.0 C -180.6 -25.0 -146.8 -50.3 -131.6 -76.0 C -116.5 -101.7 -110.9 -141.8 -89.0 -154.2 C -67.1 -166.5 -30.0 -149.4 -0.0 -150.0 C 30.0 -150.6 69.3 -170.1 91.0 -157.6 C 112.7 -145.1 113.7 -101.3 129.9 -75.0 C 146.1 -48.7 188.0 -25.0 188.0 0.0 Z',
  'M 141.0 -5.0 C 141.0 13.8 109.9 32.2 97.4 51.2 C 84.9 70.3 82.2 99.9 66.0 109.3 C 49.8 118.7 22.5 106.6 0.0 107.5 C -22.5 108.4 -53.0 124.0 -69.0 114.5 C -85.0 105.0 -85.1 70.4 -96.1 50.5 C -107.1 30.6 -134.6 13.8 -135.0 -5.0 C -135.4 -23.7 -110.1 -42.7 -98.7 -62.0 C -87.4 -81.3 -83.2 -111.4 -66.8 -120.6 C -50.3 -129.9 -22.5 -117.1 -0.0 -117.5 C 22.5 -117.9 52.0 -132.6 68.3 -123.2 C 84.5 -113.8 85.3 -81.0 97.4 -61.3 C 109.6 -41.5 141.0 -23.8 141.0 -5.0 Z',
  'M 97.8 -10.0 C 97.8 3.0 76.2 15.8 67.5 29.0 C 58.9 42.2 57.0 62.8 45.8 69.3 C 34.5 75.8 15.6 67.4 0.0 68.0 C -15.6 68.6 -36.7 79.4 -47.8 72.9 C -58.9 66.3 -59.0 42.3 -66.6 28.5 C -74.3 14.7 -93.3 3.0 -93.6 -10.0 C -93.9 -23.0 -76.3 -36.2 -68.5 -49.5 C -60.6 -62.9 -57.7 -83.7 -46.3 -90.2 C -34.9 -96.6 -15.6 -87.7 -0.0 -88.0 C 15.6 -88.3 36.1 -98.5 47.3 -92.0 C 58.6 -85.5 59.1 -62.7 67.5 -49.0 C 76.0 -35.3 97.8 -23.0 97.8 -10.0 Z',
  'M 60.2 -15.0 C 60.2 -7.0 46.9 0.9 41.6 9.0 C 36.2 17.1 35.1 29.8 28.2 33.8 C 21.2 37.8 9.6 32.6 0.0 33.0 C -9.6 33.4 -22.6 40.0 -29.4 36.0 C -36.3 31.9 -36.3 17.2 -41.0 8.7 C -45.7 0.2 -57.4 -7.0 -57.6 -15.0 C -57.8 -23.0 -47.0 -31.1 -42.1 -39.3 C -37.3 -47.5 -35.5 -60.4 -28.5 -64.3 C -21.5 -68.3 -9.6 -62.8 -0.0 -63.0 C 9.6 -63.2 22.2 -69.4 29.1 -65.4 C 36.0 -61.4 36.4 -47.4 41.6 -39.0 C 46.7 -30.6 60.2 -23.0 60.2 -15.0 Z',
]
const RING_FILL = ['#dcebe6', '#84c3c8', '#2f74a6', '#0b2038']

const STARS = `
  <circle cx="-22.7" cy="-64.7" r="1.7" fill="#dfeaf9" opacity="0.72" class="eb-tw b"/>
  <circle cx="-70.2" cy="-40.1" r="0.8" fill="#dfeaf9" opacity="0.52"/>
  <circle cx="65.9" cy="-43.5" r="1.2" fill="#dfeaf9" opacity="0.84"/>
  <circle cx="54.3" cy="85.1" r="1.1" fill="#dfeaf9" opacity="0.58"/>
  <circle cx="-68.5" cy="-21.9" r="1.7" fill="#dfeaf9" opacity="0.56"/>
  <circle cx="-58.9" cy="16.2" r="1.3" fill="#dfeaf9" opacity="0.46" class="eb-tw"/>
  <circle cx="-25" cy="-52" r="1.9" fill="#dfeaf9" opacity="0.83"/>
  <circle cx="63.4" cy="-21.9" r="1.1" fill="#dfeaf9" opacity="0.74"/>
  <circle cx="28.7" cy="-26.2" r="1.1" fill="#dfeaf9" opacity="0.42"/>
  <circle cx="-95.2" cy="-85.1" r="1.9" fill="#dfeaf9" opacity="0.75"/>
  <circle cx="55.6" cy="-19.9" r="1" fill="#dfeaf9" opacity="0.37" class="eb-tw b"/>
  <circle cx="-103.1" cy="34.7" r="0.9" fill="#dfeaf9" opacity="0.39"/>
  <circle cx="-71.2" cy="21.4" r="1.5" fill="#dfeaf9" opacity="0.4"/>
  <circle cx="13.4" cy="46.6" r="1.8" fill="#dfeaf9" opacity="0.76"/>
  <circle cx="21.3" cy="-61.5" r="0.9" fill="#dfeaf9" opacity="0.74"/>
  <circle cx="-28.7" cy="28.6" r="1.6" fill="#dfeaf9" opacity="0.49" class="eb-tw"/>
`

const CABLE = `
  <g transform="translate(0 -8) scale(1.02)" stroke="#16233c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <g class="eb-conn-male">
      <path d="M-168 52 Q -150 6 -96 3" fill="none" stroke="#16233c" stroke-width="21"/>
      <path d="M-168 52 Q -150 6 -96 3" fill="none" stroke="url(#eb-conn)" stroke-width="14"/>
      <path d="M-166 46 Q -150 10 -100 6" fill="none" stroke="#4f77aa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
      <rect x="-98" y="-25" width="46" height="50" rx="14" fill="url(#eb-steel)"/>
      <rect x="-93" y="-22" width="36" height="8" rx="4" fill="#ffffff" opacity="0.6" stroke="none"/>
      <g stroke="#8792a6" stroke-width="2.4" opacity="0.7">
        <path d="M-86 -14 L -86 14"/><path d="M-78 -14 L -78 14"/><path d="M-70 -14 L -70 14"/>
      </g>
      <rect x="-54" y="-18" width="14" height="36" rx="5" fill="url(#eb-brass)"/>
      <rect x="-42" y="-15" width="20" height="30" rx="6" fill="url(#eb-steel)"/>
      <rect x="-24" y="-12" width="24" height="7" rx="3.5" fill="url(#eb-brass)"/>
      <rect x="-24" y="5" width="24" height="7" rx="3.5" fill="url(#eb-brass)"/>
    </g>
    <g class="eb-conn-female">
      <path d="M168 52 Q 150 6 96 3" fill="none" stroke="#16233c" stroke-width="21"/>
      <path d="M168 52 Q 150 6 96 3" fill="none" stroke="url(#eb-conn)" stroke-width="14"/>
      <path d="M166 46 Q 150 10 100 6" fill="none" stroke="#4f77aa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
      <rect x="52" y="-27" width="46" height="54" rx="15" fill="url(#eb-steel)"/>
      <rect x="57" y="-24" width="36" height="8" rx="4" fill="#ffffff" opacity="0.6" stroke="none"/>
      <g stroke="#8792a6" stroke-width="2.4" opacity="0.7">
        <path d="M66 -15 L 66 15"/><path d="M74 -15 L 74 15"/><path d="M82 -15 L 82 15"/>
      </g>
      <rect x="46" y="-20" width="12" height="40" rx="5" fill="url(#eb-brass)"/>
      <rect x="28" y="-20" width="20" height="40" rx="7" fill="url(#eb-steel)"/>
      <rect x="30" y="-16" width="6" height="32" rx="3" fill="#ffffff" opacity="0.5" stroke="none"/>
      <ellipse cx="37" cy="-8.5" rx="5" ry="5.5" fill="#0a1524" stroke="none"/>
      <ellipse cx="37" cy="8.5" rx="5" ry="5.5" fill="#0a1524" stroke="none"/>
    </g>
    <g class="eb-spark">
      <path d="M14 -20 L 3 -2 L 12 -1 L 2 20 L 24 -3 L 14 -4 Z" fill="var(--accent)" stroke="none"/>
      <path d="M-2 -14 l-7 -5" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M-2 14 l-7 5" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M30 -15 l7 -5" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M30 15 l7 5" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/>
    </g>
  </g>
`

const GLOBE = `
  <g transform="translate(152 -128)">
    <g class="eb-globe">
      <g fill="none" stroke="var(--accent)" stroke-linecap="round">
        <circle cx="0" cy="0" r="39" stroke-width="3.4" stroke-dasharray="26 20" opacity="0.85"/>
        <circle cx="0" cy="0" r="47" stroke-width="2.4" stroke-dasharray="12 24" opacity="0.5"/>
        <circle cx="0" cy="0" r="33" stroke-width="1.8" stroke-dasharray="7 15" opacity="0.4"/>
      </g>
      <circle cx="0" cy="0" r="30" fill="url(#eb-globe)"/>
      <g fill="#eef1ee" opacity="0.92">
        <path d="M-6 -22 q10 -3 16 3 q3 6 -2 9 q4 6 0 12 q-3 8 -9 13 q-6 5 -9 -2 q-5 -8 -2 -16 q-4 -7 1 -14 q3 -6 6 -8z"/>
        <path d="M-16 -14 q5 -2 7 2 q-1 4 -6 4 q-4 -1 -1 -6z"/>
        <path d="M12 -14 q6 0 6 5 q-3 4 -7 1 q-3 -4 1 -6z"/>
      </g>
      <ellipse cx="-11" cy="-11" rx="10" ry="7" fill="#bfe0ff" opacity="0.35"/>
      <circle cx="0" cy="0" r="30" fill="none" stroke="#0d2845" stroke-width="1.4" opacity="0.5"/>
      <path d="M0 -30 a30 30 0 0 1 0 60" fill="none" stroke="#0d2845" stroke-width="1" opacity="0.18"/>
    </g>
  </g>
`

const SCENE_INNER = `
  <defs>
    <linearGradient id="eb-conn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2a4e79"/><stop offset="100%" stop-color="#0d2845"/></linearGradient>
    <linearGradient id="eb-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fbfcfd"/><stop offset="48%" stop-color="#dfe4ea"/><stop offset="100%" stop-color="#b3bcc9"/></linearGradient>
    <linearGradient id="eb-brass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f4dca0"/><stop offset="55%" stop-color="#d9ad5b"/><stop offset="100%" stop-color="#a97d2f"/></linearGradient>
    <radialGradient id="eb-globe" cx="36%" cy="30%" r="80%"><stop offset="0%" stop-color="#4a90cc"/><stop offset="45%" stop-color="#2166a1"/><stop offset="100%" stop-color="#123a63"/></radialGradient>
    <filter id="eb-blend" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
    <filter id="eb-lift" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="9" stdDeviation="11" flood-color="#0a1f3a" flood-opacity="0.22"/></filter>
  </defs>
  <g filter="url(#eb-lift)">
    <path d="${HALO}" fill="#eef2ec" filter="url(#eb-blend)" opacity="0.9"/>
    <path d="${RING[0]}" fill="${RING_FILL[0]}"/>
    <path d="${RING[1]}" fill="${RING_FILL[1]}"/>
    <path d="${RING[2]}" fill="${RING_FILL[2]}"/>
    <path d="${RING[3]}" fill="${RING_FILL[3]}"/>
  </g>
  <g>${STARS}</g>
  ${CABLE}
  ${GLOBE}
`

const SCENE_CSS = `
  .eb-scene .eb-globe { transform-box: fill-box; transform-origin: center; animation: eb-adrift 15s ease-in-out infinite; }
  .eb-scene .eb-conn-male, .eb-scene .eb-conn-female, .eb-scene .eb-spark { transform-box: fill-box; transform-origin: center; }
  .eb-scene .eb-conn-male { animation: eb-pull-l 4.5s ease-in-out infinite; }
  .eb-scene .eb-conn-female { animation: eb-pull-r 4.5s ease-in-out infinite; }
  .eb-scene .eb-spark { animation: eb-spark-pulse 4.5s ease-in-out infinite; }
  .eb-scene .eb-tw { animation: eb-twk 5s ease-in-out infinite; }
  .eb-scene .eb-tw.b { animation-delay: 2s; }
  @keyframes eb-adrift { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(10px, -9px) rotate(4deg); } }
  @keyframes eb-pull-l { 0%, 100% { transform: translateX(-9px); } 50% { transform: translateX(-19px); } }
  @keyframes eb-pull-r { 0%, 100% { transform: translateX(9px); } 50% { transform: translateX(19px); } }
  @keyframes eb-spark-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes eb-twk { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.9; } }
  @media (prefers-reduced-motion: reduce) {
    .eb-scene .eb-globe, .eb-scene .eb-tw, .eb-scene .eb-conn-male, .eb-scene .eb-conn-female, .eb-scene .eb-spark { animation: none; }
  }
`

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info)
    void api.postCrashReport({
      message: error.message.slice(0, 1024),
      stack: (error.stack ?? info.componentStack ?? null)?.slice(0, 65536) ?? null,
      browser: navigator.userAgent,
      timestamp: new Date().toISOString(),
      severity: 'error',
    }).catch(() => {
      // Fire-and-forget — don't let a crash-report failure cascade.
    })
  }

  private copyDiagnostic = (): void => {
    const blob = {
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
      browser: navigator.userAgent,
      error: this.state.error?.message,
      stack: this.state.error?.stack,
    }
    void copyToClipboard(JSON.stringify(blob, null, 2))
  }

  private reload = (): void => {
    this.setState({ error: null })
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error) {
      const t = i18n.t.bind(i18n)
      return (
        <div className="eb-scene flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10 text-center">
          <style>{SCENE_CSS}</style>

          <div className="relative mb-3 h-[272px] w-[320px] max-w-full sm:mb-4 sm:h-[340px] sm:w-[400px]">
            <svg
              viewBox="-300 -255 600 510"
              className="block h-full w-full overflow-visible"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: SCENE_INNER }}
            />
          </div>

          <h1 className="text-[22px] font-extrabold tracking-tight text-foreground sm:text-[25px]">
            {t('errors.generic')}
          </h1>
          <p className="mt-2.5 max-w-[344px] text-[15px] leading-normal text-muted-foreground">
            {t('errors.boundary.bodyLead')}{' '}
            <span className="font-semibold text-foreground">
              {t('errors.boundary.bodyReassure')}
            </span>{' '}
            {t('errors.boundary.bodyTail')}
          </p>

          <div className="mt-5 flex w-full max-w-[420px] items-start gap-2 rounded-lg border border-hairline bg-surface-tinted px-3.5 py-3 text-start font-mono text-xs leading-snug text-muted-foreground">
            <span className="shrink-0 font-semibold tracking-wide text-accent">ERR</span>
            <code className="break-words" dir="ltr">
              {this.state.error.message}
            </code>
          </div>

          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <Button variant="secondary" size="sm" onClick={this.copyDiagnostic}>
              {t('errors.boundary.copyDiagnostic')}
            </Button>
            <Button size="sm" onClick={this.reload}>
              {t('errors.boundary.reload')}
            </Button>
          </div>

          <p className="mt-6 font-mono text-[11.5px] tracking-wide text-faint">
            {t('app.title')} {APP_VERSION}
          </p>
          <p className="mt-1.5 text-xs text-faint">{t('errors.boundary.hint')}</p>
        </div>
      )
    }
    return this.props.children
  }
}
