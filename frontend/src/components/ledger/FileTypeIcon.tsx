/**
 * FileTypeIcon — a small page-with-folded-corner glyph whose colour + label
 * reflect the file extension. Recreated from the GSSG design-system handoff
 * (Ledger Email Detail). Decorative — `aria-hidden`; the card text carries the
 * accessible name.
 */

import { fileMeta, type FileKind } from '@/lib/fileTypes'

export function FileTypeIcon({
  kind,
  size = 28,
}: {
  kind: FileKind
  size?: number
}): React.JSX.Element {
  const m = fileMeta(kind)
  const W = size
  const H = size * 1.18
  const fold = size * 0.32
  const bg = `color-mix(in oklab, ${m.color} 14%, transparent)`
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="block"
    >
      {/* page body */}
      <path
        d={`M2 2 H${W - fold - 2} L${W - 2} ${fold + 2} V${H - 4} a2 2 0 0 1 -2 2 H4 a2 2 0 0 1 -2 -2 Z`}
        stroke={m.color}
        strokeWidth={1.2}
        style={{ fill: bg }}
      />
      {/* folded corner */}
      <path
        d={`M${W - fold - 2} 2 V${fold} a2 2 0 0 0 2 2 H${W - 2}`}
        fill="none"
        stroke={m.color}
        strokeWidth={1.2}
      />
      {/* tiny mountain glyph for images */}
      {kind === 'image' && (
        <g>
          <circle cx={W * 0.32} cy={H * 0.58} r={1.6} fill={m.color} />
          <path
            d={`M ${W * 0.18} ${H * 0.82} L ${W * 0.4} ${H * 0.6} L ${W * 0.55} ${H * 0.74} L ${W * 0.7} ${H * 0.58} L ${W * 0.85} ${H * 0.82} Z`}
            fill={m.color}
            opacity={0.65}
          />
        </g>
      )}
      {/* label badge */}
      <rect x={2} y={H - 13} rx={2.5} ry={2.5} width={W - 4} height={11} fill={m.color} />
      <text
        x={W / 2}
        y={H - 4.5}
        fontSize={6.6}
        fontWeight={700}
        fontFamily="Inter, system-ui, sans-serif"
        textAnchor="middle"
        fill="#ffffff"
        letterSpacing={0.4}
      >
        {m.label}
      </text>
    </svg>
  )
}
