import { PanelsTopLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { LOCK_LAYOUTS } from '@/lib/useLockState'
import type { LockLayout } from '@/lib/useLockState'

interface LockLayoutControlProps {
  /** Raw `SessionUser.lock_layout`; unrecognized values render as `band`. */
  value: string
  onChange: (value: LockLayout) => void
  disabled?: boolean
}

const GLYPHS: Record<LockLayout, React.JSX.Element> = {
  band: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="10" r="1.6" />
      <path d="M6 16.5h12" />
    </>
  ),
  stack: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="3" />
      <circle cx="12" cy="9.5" r="1.6" />
      <path d="M9 16.5h6" />
    </>
  ),
  console: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M10.5 5v8" />
      <path d="M3 13h18" />
    </>
  ),
}

export function LockLayoutControl({
  value,
  onChange,
  disabled = false,
}: LockLayoutControlProps): React.JSX.Element {
  const { t } = useTranslation()
  const current: LockLayout = (LOCK_LAYOUTS as readonly string[]).includes(value)
    ? (value as LockLayout)
    : 'band'

  return (
    <div
      className="flex min-h-[54px] w-full items-center gap-2.5 border-b border-hairline bg-surface-raised px-4 py-2.5"
      aria-busy={disabled}
    >
      <PanelsTopLeft
        className="h-4 w-4 shrink-0 text-muted-foreground"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 text-start">
        <span className="block text-[0.9em] font-medium text-foreground">
          {t('lockScreen.layoutTitle')}
        </span>
        <span className="block text-[0.72em] text-muted-foreground">
          {t(`lockScreen.layout.${current}`)}
        </span>
      </span>
      <div
        role="group"
        aria-label={t('lockScreen.layoutTitle')}
        className="grid shrink-0 grid-cols-3 items-center overflow-hidden rounded-[10px] border border-border bg-surface"
      >
        {LOCK_LAYOUTS.map((option, index) => {
          const active = current === option
          return (
            <button
              key={option}
              type="button"
              aria-label={t(`lockScreen.layout.${option}`)}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(option)}
              className={`grid h-[30px] w-9 place-items-center transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--primary),inset_0_0_0_4px_var(--surface)] disabled:cursor-not-allowed disabled:opacity-60 ${
                index > 0 ? 'border-s border-hairline' : ''
              } ${active ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-primary-soft'}`}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {GLYPHS[option]}
              </svg>
            </button>
          )
        })}
      </div>
    </div>
  )
}
