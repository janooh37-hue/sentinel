/**
 * The workbook's legend, turned into the tool.
 *
 * Read it to learn the codes, click it to arm a brush — the same object serves
 * the operator's first month and their twelfth (UI spec §6, "code ribbon
 * swatch"). `aria-pressed` carries the armed state and the `<kbd>` teaches the
 * keyboard shortcut that does the same thing faster.
 *
 * No colour is named here. A swatch renders `data-code={slug}` and `index.css`
 * resolves the workbook's own fill, which is what keeps the dark-theme remap a
 * one-file change (UI spec §3.2).
 *
 * When the sheet cannot be edited — a sealed month, the derived statistics
 * variant, or an operator holding only `timesheet.view` — the swatches are
 * rendered as plain text rather than disabled buttons: a disabled control still
 * answers Enter and Space (UI spec §14).
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import { CODES, type Code, slugOf } from './codes'

export interface CodeRibbonProps {
  /** The armed code, or `null` for "no brush". */
  brush: Code | null
  onArm: (code: Code | null) => void
  /** Legend only: no brush, no keyboard hint. */
  readOnly?: boolean
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (code: Code): string => (code === '-' ? '–' : slugOf(code))

export function CodeRibbon({ brush, onArm, readOnly = false }: CodeRibbonProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        data-ts-caps
        className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-faint"
      >
        {t('timesheet.codesLabel')}
      </span>
      {CODES.map((spec) => {
        const glyph = (
          <span
            data-code={spec.slug}
            className="grid h-4 w-6 shrink-0 place-items-center rounded-[3px] border border-border font-mono text-[0.6rem] font-semibold"
            aria-hidden
          >
            {glyphOf(spec.code)}
          </span>
        )
        const label = <span className="truncate">{t(spec.labelKey)}</span>

        if (readOnly) {
          return (
            <span
              key={spec.slug}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-2 py-1 text-[0.72em] text-muted-foreground"
            >
              {glyph}
              {label}
            </span>
          )
        }
        return (
          <button
            key={spec.slug}
            type="button"
            aria-pressed={brush === spec.code}
            onClick={() => onArm(brush === spec.code ? null : spec.code)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-1 text-[0.72em] text-foreground transition-shadow',
              'hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              brush === spec.code && 'border-primary ring-1 ring-primary',
            )}
          >
            {glyph}
            {label}
            <kbd className="rounded-[4px] border border-border bg-surface-tinted px-1 font-mono text-[0.6rem] text-muted-foreground">
              {spec.key}
            </kbd>
          </button>
        )
      })}
    </div>
  )
}
