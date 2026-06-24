/**
 * RotatingTip — rotating tip card for the Ledger Outlook reading-pane empty state
 * (Phase 4, Task 7).
 *
 * Matches the prototype's `.tipcard` (docs/prototypes/ledger-outlook-redesign.html):
 *   💡 icon · tip body · dot position indicator.
 *
 * Rotation: cycles through `ledger.outlook.tips` every ~10 s via setInterval.
 *
 * Reduced-motion guard: when `window.matchMedia('(prefers-reduced-motion: reduce)')
 * matches`, the interval is NOT started — the first tip is displayed statically.
 * This is the repo's standard pattern (see useIsMobile.ts for matchMedia usage).
 *
 * Colors come from the `--tip-*` token family (index.css, light + dark) — the
 * prototype's indigo `.tipcard` palette, tokenized so this component carries no
 * inline hex.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

export function RotatingTip({ className }: { className?: string }) {
  const { t } = useTranslation()

  // Retrieve the tips array from i18n (bilingual via en/ar.json).
  const tips = t('ledger.outlook.tips', { returnObjects: true }) as string[]
  const tipLabel = t('ledger.outlook.tipLabel')

  const [index, setIndex] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Guard: do not auto-rotate when the user prefers reduced motion.
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

    if (prefersReduced) return

    intervalRef.current = setInterval(() => {
      setIndex((prev) => (prev + 1) % tips.length)
    }, 10_000)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    // tips.length is stable (comes from the static i18n array).
  }, [tips.length])

  const currentTip = tips[index] ?? ''

  return (
    <div
      className={cn('rounded-[11px] border p-[13px_15px] text-sm max-w-[360px] text-start flex gap-[11px]', className)}
      style={{
        background: 'linear-gradient(135deg, var(--tip-grad-a), var(--tip-grad-b))',
        borderColor: 'var(--tip-border)',
        color: 'var(--tip-text)',
      }}
    >
      {/* 💡 bulb */}
      <span className="text-[18px] leading-[1.2] flex-none" aria-hidden>
        💡
      </span>

      {/* Tip body */}
      <div className="min-w-0">
        <p className="m-0 leading-relaxed">
          <strong style={{ color: 'var(--tip-strong)' }}>{tipLabel}</strong>{' '}
          {currentTip}
        </p>

        {/* Dot position indicator */}
        <div className="flex gap-1 mt-2">
          {tips.map((_, i) => (
            <i
              key={i}
              // not an italic — using <i> to match prototype's `.dots i` pattern;
              // rendered as a rounded dot via CSS
              data-testid="tip-dot"
              data-active={i === index ? 'true' : 'false'}
              aria-hidden
              style={{
                display: 'block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: i === index ? 'var(--tip-dot-active)' : 'var(--tip-dot)',
                transition: 'background 200ms',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
