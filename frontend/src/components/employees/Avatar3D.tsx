/**
 * Avatar3D — SVG fallback shown when an employee has no uploaded photo.
 *
 * Five stable variants (hair colour + skin tone move together). The variant
 * is picked deterministically from the G-number, so the same employee always
 * renders with the same look across surfaces. Rendered inside a circular
 * surface-tinted bezel by the caller; this component just paints the head.
 */

const AVATAR_VARIANTS: ReadonlyArray<{
  skin: readonly [string, string, string]
  hair: string
  hairShade: string
}> = [
  { skin: ['#fbd1a0', '#f0a96a', '#cd7d3e'], hair: '#6e3a14', hairShade: '#4b240a' },
  { skin: ['#fde6c4', '#f5c896', '#d99b66'], hair: '#d4a13a', hairShade: '#a37920' },
  { skin: ['#e7b487', '#c98a52', '#92622f'], hair: '#1c1410', hairShade: '#0f0808' },
  { skin: ['#f9c79a', '#e0975e', '#b16d30'], hair: '#9b3a1c', hairShade: '#6e2010' },
  { skin: ['#c79667', '#a36e3e', '#724a23'], hair: '#2a1808', hairShade: '#150a02' },
]

export function variantForId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h * 31 + id.charCodeAt(i)) >>> 0)
  return h % AVATAR_VARIANTS.length
}

interface Avatar3DProps {
  /** G-number (or any stable id) — used to pick a variant deterministically. */
  id: string
  /** Pixel size of the SVG (square). */
  size?: number
  className?: string
}

export function Avatar3D({ id, size = 36, className }: Avatar3DProps): React.JSX.Element {
  const v = AVATAR_VARIANTS[variantForId(id)]!
  const uniq = `a3d-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
      style={{ display: 'block' }}
    >
      <defs>
        <radialGradient id={`${uniq}-skin`} cx="0.45" cy="0.4" r="0.7">
          <stop offset="0%" stopColor={v.skin[0]} />
          <stop offset="60%" stopColor={v.skin[1]} />
          <stop offset="100%" stopColor={v.skin[2]} />
        </radialGradient>
        <radialGradient id={`${uniq}-hair`} cx="0.4" cy="0.3" r="0.7">
          <stop offset="0%" stopColor={v.hair} />
          <stop offset="100%" stopColor={v.hairShade} />
        </radialGradient>
        <radialGradient id={`${uniq}-bg`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="rgba(13,40,69,0.06)" />
          <stop offset="100%" stopColor="rgba(13,40,69,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="28" cy="50" rx="16" ry="3" fill={`url(#${uniq}-bg)`} />
      <path d="M21 40 Q21 46 28 46 Q35 46 35 40 L35 33 L21 33 Z" fill={`url(#${uniq}-skin)`} />
      <ellipse cx="28" cy="26" rx="14" ry="16" fill={`url(#${uniq}-skin)`} />
      <path
        d="M16 21 Q15 11 27 9 Q42 8 41 21 Q40 17 37 16 Q34 19 28 19 Q21 19 18 17 Q16 18 16 21 Z"
        fill={`url(#${uniq}-hair)`}
      />
      <path d="M15 23 Q14 27 16 30 L17 27 Z" fill={v.hairShade} opacity="0.7" />
      <path d="M41 23 Q42 27 40 30 L39 27 Z" fill={v.hairShade} opacity="0.7" />
      <ellipse cx="22" cy="32" rx="3" ry="1.5" fill={v.skin[2]} opacity="0.25" />
      <ellipse cx="34" cy="32" rx="3" ry="1.5" fill={v.skin[2]} opacity="0.25" />
    </svg>
  )
}
