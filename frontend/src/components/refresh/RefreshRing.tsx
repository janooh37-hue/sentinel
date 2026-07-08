export type PtrStage = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done'

const R = 13
const CIRC = 2 * Math.PI * R

export function RefreshRing({ stage, progress }: { stage: PtrStage; progress: number }) {
  const p = Math.max(0, Math.min(1, progress))
  const appear = Math.min(progress / (40 / 112), 1) // fully materialized by ~40px offset
  const arcFrac = stage === 'armed' || stage === 'refreshing' ? 1 : p * 0.75
  const dash = `${CIRC * arcFrac} ${CIRC}`
  return (
    <div
      className={[
        'grid place-items-center',
        stage === 'refreshing' ? 'ptr-ring-spin' : '',
        'motion-reduce:!animate-none',
      ].join(' ')}
      style={{ opacity: stage === 'idle' ? appear : 1, transform: `scale(${0.6 + 0.4 * appear})` }}
    >
      <svg viewBox="0 0 34 34" width="34" height="34" style={{ overflow: 'visible' }}>
        <circle cx="17" cy="17" r={R} fill="none" stroke="var(--hairline)" strokeWidth="2" />
        {stage !== 'done' && (
          <circle
            data-part="arc"
            cx="17"
            cy="17"
            r={R}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={dash}
            transform="rotate(-90 17 17)"
          />
        )}
        {stage === 'done' && (
          <path
            data-part="check"
            d="M11 17.5l3.6 3.6L23 12.7"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}
