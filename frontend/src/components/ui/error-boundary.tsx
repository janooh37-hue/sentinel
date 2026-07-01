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
   An astronaut adrift in a layered hollow, reaching after the GSSG globe as
   it — signal-rings and all — slips out of reach. Blob rings and star field
   are precomputed; ids are `eb-` prefixed to avoid colliding with app SVG. */

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

const ASTRONAUT = `
  <g class="eb-astro">
    <g transform="translate(-56 44) rotate(-11) scale(0.9)" filter="url(#eb-lift)">
      <g>
        <rect x="-34" y="-40" width="68" height="86" rx="20" fill="url(#eb-pack)"/>
        <rect x="-34" y="-40" width="68" height="86" rx="20" fill="none" stroke="#7f8a9e" stroke-width="1" opacity="0.5"/>
        <rect x="-18" y="-34" width="14" height="24" rx="4" fill="#788298"/>
        <rect x="4" y="-34" width="14" height="24" rx="4" fill="#788298"/>
        <rect x="-24" y="18" width="48" height="8" rx="4" fill="#6f7a8f"/>
      </g>
      <g>
        <path d="M-30 -18 q-16 6 -24 24 q-6 14 -4 30" fill="none" stroke="url(#eb-limb)" stroke-width="22" stroke-linecap="round"/>
        <g stroke="#b6bfce" stroke-width="1.4" opacity="0.7" fill="none"><path d="M-52 6 q7 3 12 -2"/><path d="M-54 14 q7 3 13 -2"/></g>
        <circle cx="-58" cy="60" r="13" fill="url(#eb-limb)"/>
        <circle cx="-58" cy="60" r="13" fill="none" stroke="#aeb6c4" stroke-width="1.4"/>
        <ellipse cx="-63" cy="55" rx="5" ry="7" fill="#ffffff" opacity="0.45"/>
        <path d="M-48 58 q7 -1 8 5" fill="none" stroke="#aeb6c4" stroke-width="3" stroke-linecap="round"/>
        <circle cx="-58" cy="47" r="13.5" fill="none" stroke="#c4ccd9" stroke-width="3"/>
      </g>
      <g>
        <path d="M-16 42 q-10 30 -8 58 q1 14 6 24" fill="none" stroke="url(#eb-limb)" stroke-width="27" stroke-linecap="round"/>
        <g stroke="#b6bfce" stroke-width="1.5" opacity="0.65" fill="none"><path d="M-27 92 q10 4 20 -1"/><path d="M-26 102 q10 4 20 -1"/></g>
        <path d="M-24 120 q-4 20 8 24 q18 5 24 -8 l-2 -16 q-14 6 -30 0z" fill="url(#eb-limb)"/>
        <path d="M-16 141 q10 6 22 0 l0 5 q-11 5 -22 -1z" fill="#586274"/>
        <circle cx="-18" cy="120" r="14" fill="none" stroke="#c4ccd9" stroke-width="3"/>
      </g>
      <ellipse cx="0" cy="-30" rx="30" ry="9" fill="#0a1f3a" opacity="0.14"/>
      <path d="M-36 -30 Q -40 -36 -28 -38 L 28 -38 Q 40 -36 36 -30 L 32 40 Q 27 54 0 54 Q -27 54 -32 40 Z" fill="url(#eb-suit)"/>
      <path d="M20 -36 Q 34 -34 30 -30 L 27 42 Q 22 51 8 53 Q 26 46 22 -32 Z" fill="#0a1f3a" opacity="0.09"/>
      <path d="M-24 -34 Q 0 -40 24 -34 Q 6 -30 -24 -32 Z" fill="#ffffff" opacity="0.55"/>
      <path d="M0 -30 L 0 52" stroke="#cbd2dd" stroke-width="1.4" opacity="0.6"/>
      <g stroke="#c4ccd9" stroke-width="1.6" fill="none" opacity="0.7"><path d="M-30 24 Q 0 34 30 24"/><path d="M-31 32 Q 0 42 31 32"/><path d="M-30 40 Q 0 49 30 40"/></g>
      <g>
        <rect x="-22" y="-20" width="44" height="30" rx="7" fill="#132a46"/>
        <rect x="-22" y="-20" width="44" height="30" rx="7" fill="none" stroke="#0a1f3a" stroke-width="1"/>
        <rect x="-17" y="-15" width="24" height="12" rx="2.5" fill="#0c1c30"/>
        <path d="M-15 -9 h6 l2 -4 3 8 2 -4 h4" fill="none" stroke="#40608c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
        <circle cx="13" cy="-13" r="2.4" fill="#33415a"/>
        <circle cx="13" cy="-5" r="2.4" fill="#33415a"/>
        <rect x="-17" y="4" width="10" height="3" rx="1.5" fill="#2c4a6e"/>
        <rect x="-4" y="4" width="10" height="3" rx="1.5" fill="#2c4a6e"/>
      </g>
      <path d="M-30 -6 q-10 8 -6 22 q3 8 12 8" fill="none" stroke="#c4ccd9" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
      <g>
        <path d="M18 44 q16 20 14 42 q-2 16 -14 24" fill="none" stroke="url(#eb-limb)" stroke-width="28" stroke-linecap="round"/>
        <g stroke="#b6bfce" stroke-width="1.5" opacity="0.65" fill="none"><path d="M34 84 q4 11 -3 20"/><path d="M42 88 q4 11 -3 20"/></g>
        <path d="M12 106 q-14 10 -10 24 q5 16 22 12 q14 -4 12 -18 l-6 -16 q-10 4 -30 -2z" fill="url(#eb-limb)"/>
        <path d="M6 128 q6 12 24 8 l2 5 q-16 6 -27 -6z" fill="#586274"/>
        <circle cx="26" cy="112" r="15" fill="none" stroke="#c4ccd9" stroke-width="3"/>
        <ellipse cx="4" cy="118" rx="6" ry="9" fill="#ffffff" opacity="0.4"/>
      </g>
      <g>
        <circle cx="32" cy="-24" r="15" fill="url(#eb-limb)"/>
        <path d="M32 -24 q18 -18 44 -40 q10 -8 20 -10" fill="none" stroke="url(#eb-limb)" stroke-width="21" stroke-linecap="round"/>
        <g stroke="#b6bfce" stroke-width="1.4" opacity="0.7" fill="none"><path d="M58 -50 q6 6 13 3"/><path d="M64 -57 q6 6 13 3"/></g>
        <circle cx="98" cy="-76" r="13" fill="url(#eb-limb)"/>
        <circle cx="98" cy="-76" r="13" fill="none" stroke="#aeb6c4" stroke-width="1.4"/>
        <ellipse cx="93" cy="-81" rx="5" ry="7" fill="#ffffff" opacity="0.5"/>
        <path d="M108 -80 q8 -3 12 -1" fill="none" stroke="url(#eb-limb)" stroke-width="6" stroke-linecap="round"/>
        <path d="M109 -73 q8 -1 12 2" fill="none" stroke="url(#eb-limb)" stroke-width="5.5" stroke-linecap="round"/>
        <circle cx="86" cy="-64" r="13.5" fill="none" stroke="#c4ccd9" stroke-width="3"/>
      </g>
      <rect x="-24" y="-46" width="48" height="16" rx="7" fill="url(#eb-metal)"/>
      <rect x="-24" y="-42" width="48" height="4" fill="#9aa3b2" opacity="0.5"/>
      <g fill="#8b94a4"><circle cx="-16" cy="-38" r="1.5"/><circle cx="-6" cy="-38" r="1.5"/><circle cx="4" cy="-38" r="1.5"/><circle cx="14" cy="-38" r="1.5"/></g>
      <circle cx="0" cy="-78" r="41" fill="url(#eb-helmet)"/>
      <circle cx="0" cy="-78" r="41" fill="none" stroke="#b3bccb" stroke-width="2"/>
      <ellipse cx="-14" cy="-96" rx="16" ry="10" fill="#ffffff" opacity="0.75"/>
      <ellipse cx="0" cy="-74" rx="30" ry="31" fill="#1c2c44"/>
      <ellipse cx="0" cy="-74" rx="26" ry="27" fill="url(#eb-visor)"/>
      <path d="M-19 -90 q15 -11 34 -1 q-7 9 -19 10 q-11 1 -15 -9z" fill="#7ea8d8" opacity="0.45"/>
      <circle cx="10" cy="-66" r="6.5" fill="#2166a1" opacity="0.6"/>
      <path d="M8 -70 q4 -1 6 2 q-2 3 -6 1z" fill="#dfeaf6" opacity="0.5"/>
      <circle cx="-9" cy="-80" r="1.6" fill="#dce8fb"/>
      <circle cx="-3" cy="-62" r="1.1" fill="#dce8fb" opacity="0.8"/>
      <rect x="33" y="-86" width="11" height="17" rx="4.5" fill="url(#eb-metal)" transform="rotate(10 38 -77)"/>
      <circle cx="39" cy="-81" r="2.6" fill="#eef3f9"/>
      <line x1="-31" y1="-105" x2="-37" y2="-120" stroke="#aeb6c4" stroke-width="2.2"/>
      <circle cx="-37" cy="-121" r="2.6" fill="#8b94a4"/>
    </g>
  </g>
`

const GLOBE = `
  <g transform="translate(100 -118)">
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
    <linearGradient id="eb-suit" x1="0.25" y1="0" x2="0.7" y2="1"><stop offset="0%" stop-color="#ffffff"/><stop offset="52%" stop-color="#eaeef4"/><stop offset="100%" stop-color="#c2cad8"/></linearGradient>
    <linearGradient id="eb-limb" x1="0.1" y1="0" x2="0.95" y2="1"><stop offset="0%" stop-color="#f8fafc"/><stop offset="55%" stop-color="#e0e5ee"/><stop offset="100%" stop-color="#bcc4d3"/></linearGradient>
    <radialGradient id="eb-helmet" cx="34%" cy="26%" r="82%"><stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#edf0f5"/><stop offset="100%" stop-color="#c6cdd9"/></radialGradient>
    <radialGradient id="eb-visor" cx="40%" cy="30%" r="88%"><stop offset="0%" stop-color="#2b4f7b"/><stop offset="42%" stop-color="#132c4b"/><stop offset="100%" stop-color="#050f1d"/></radialGradient>
    <linearGradient id="eb-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f2f4f7"/><stop offset="50%" stop-color="#d3d8e0"/><stop offset="100%" stop-color="#aab2c0"/></linearGradient>
    <linearGradient id="eb-pack" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#cdd3df"/><stop offset="100%" stop-color="#8f98ab"/></linearGradient>
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
  ${ASTRONAUT}
  ${GLOBE}
`

const SCENE_CSS = `
  .eb-scene .eb-astro { transform-box: fill-box; transform-origin: center; animation: eb-float 12s ease-in-out infinite; }
  .eb-scene .eb-globe { transform-box: fill-box; transform-origin: center; animation: eb-adrift 15s ease-in-out infinite; }
  .eb-scene .eb-tw { animation: eb-twk 5s ease-in-out infinite; }
  .eb-scene .eb-tw.b { animation-delay: 2s; }
  @keyframes eb-float { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-7px) rotate(0.6deg); } }
  @keyframes eb-adrift { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(10px, -9px) rotate(4deg); } }
  @keyframes eb-twk { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.9; } }
  @media (prefers-reduced-motion: reduce) {
    .eb-scene .eb-astro, .eb-scene .eb-globe, .eb-scene .eb-tw { animation: none; }
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
