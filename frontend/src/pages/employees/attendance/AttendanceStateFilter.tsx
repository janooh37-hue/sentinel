/** Row-status filters: OR within the states, with Corrected as an AND modifier. */
import { useId, useRef, useState } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DialogClose, DialogContent, DialogRoot, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { AttendanceStatusDot } from './AttendanceStatusDot'
import { STATE_CHIP_ORDER, type RowState, type StateCounts } from './attendanceModel'
import { attendanceStatusLabel } from './attendanceStatusLabel'
import { moveRovingFocus, pageDirection } from './rovingFocus'

interface Props {
  counts: StateCounts
  resultCount: number
  states: readonly RowState[]
  corrected: boolean
  onStatesChange: (states: RowState[]) => void
  onCorrectedChange: (on: boolean) => void
  onClear: () => void
}

type ChipKey = RowState | 'corrected'

const CHIP_KEYS: readonly ChipKey[] = [...STATE_CHIP_ORDER, 'corrected']
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const CHIP = 'inline-flex items-center gap-[7px] rounded-sm border px-[9px] py-[5px] text-start text-[0.75rem]'
const SELECTED = 'bg-primary-soft text-primary-text'
const PRIMARY_BORDER = { borderColor: 'var(--primary)' }
const UNSELECTED = 'bg-surface text-foreground hover:bg-surface-raised'
const DISABLED = 'cursor-not-allowed border-dashed text-muted-foreground opacity-50 hover:bg-surface'

function StateChips({
  counts,
  states,
  corrected,
  onStatesChange,
  onCorrectedChange,
  mobile = false,
}: Omit<Props, 'onClear' | 'resultCount'> & { mobile?: boolean }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const [focusKey, setFocusKey] = useState<ChipKey>('verified')
  const pressed = (key: ChipKey): boolean => key === 'corrected' ? corrected : states.includes(key)
  const enabled = (key: ChipKey): boolean => counts[key] > 0 || pressed(key)
  const tabStop = CHIP_KEYS.find((key) => key === focusKey && enabled(key)) ?? CHIP_KEYS.find(enabled) ?? 'verified'

  const chipClass = cn(CHIP, FOCUS, mobile ? 'min-h-[44px] w-full' : 'min-h-[33px]')
  const countClass = cn('font-mono tabular-nums', mobile && 'ms-auto')

  return (
    <div
      role="group"
      aria-label={t('attendance.filter.rowStatus')}
      onKeyDown={(event) => moveRovingFocus(event, i18n)}
      className={mobile ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-1.5'}
    >
      {STATE_CHIP_ORDER.map((state) => {
        const selected = pressed(state)
        const available = enabled(state)
        return (
          <button
            key={state}
            type="button"
            data-state-filter={state}
            aria-pressed={selected}
            aria-disabled={!available}
            tabIndex={tabStop === state ? 0 : -1}
            onFocus={() => setFocusKey(state)}
            onClick={() => {
              if (!available) return
              onStatesChange(STATE_CHIP_ORDER.filter((candidate) => (
                candidate === state ? !selected : states.includes(candidate)
              )))
            }}
            className={cn(chipClass, selected ? SELECTED : UNSELECTED, !available && DISABLED)}
            style={selected ? PRIMARY_BORDER : undefined}
          >
            <AttendanceStatusDot state={state} className="h-[9px] w-[9px]" />
            <span>{attendanceStatusLabel(t, state)}</span>{' '}
            <bdi dir="ltr" className={countClass}>{counts[state]}</bdi>
          </button>
        )
      })}
      <div className={mobile
        ? 'col-span-2 mt-1 grid gap-3 border-t border-border pt-3'
        : 'mt-0.5 flex basis-full flex-wrap items-center gap-x-3 gap-y-2'}>
        <button
          type="button"
          data-state-filter="corrected"
          aria-pressed={corrected}
          aria-disabled={!enabled('corrected')}
          tabIndex={tabStop === 'corrected' ? 0 : -1}
          onFocus={() => setFocusKey('corrected')}
          onClick={() => { if (enabled('corrected')) onCorrectedChange(!corrected) }}
          className={cn(chipClass, corrected ? SELECTED : UNSELECTED, !enabled('corrected') && DISABLED)}
          style={corrected ? PRIMARY_BORDER : undefined}
        >
          <AttendanceStatusDot state="pending" corrected className="h-[9px] w-[9px]" />
          <span>{t('attendance.state.corrected')}</span>{' '}
          <bdi dir="ltr" className={countClass}>{counts.corrected}</bdi>
        </button>
        <p className="text-[0.75rem] text-muted-foreground">{t('attendance.legend.hint')}</p>
      </div>
    </div>
  )
}

export function AttendanceStateFilter({ counts, resultCount, states, corrected, onStatesChange, onCorrectedChange, onClear }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const direction = pageDirection(i18n)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeStates = STATE_CHIP_ORDER.filter((state) => states.includes(state))
  const activeCount = activeStates.length + Number(corrected)
  const chipProps = { counts, states, corrected, onStatesChange, onCorrectedChange }

  const removeState = (state: RowState): void => {
    onStatesChange(states.filter((candidate) => candidate !== state))
    triggerRef.current?.focus()
  }

  return (
    <DialogRoot open={sheetOpen} onOpenChange={setSheetOpen}>
      <section aria-labelledby={titleId} dir={direction} data-print-hide>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-[0.75em] font-semibold text-foreground">{t('attendance.filter.rowStatus')}</h2>
          <DialogTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              className={cn('inline-flex min-h-[44px] items-center gap-2 rounded-md border bg-surface px-3 text-[0.75em] font-semibold text-foreground hover:bg-surface-tinted lg:hidden', FOCUS)}
              style={{ borderColor: 'var(--border-strong)' }}
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              <span>{t('attendance.filter.button')}{activeCount > 0 && <> <bdi dir="ltr" className="font-mono tabular-nums">({activeCount})</bdi></>}</span>
            </button>
          </DialogTrigger>
        </div>
        <div className="hidden lg:block"><StateChips {...chipProps} /></div>
        {activeCount > 0 && (
          <div role="group" aria-label={t('attendance.filter.active')} className="mt-2.5 flex flex-wrap gap-2 lg:hidden">
            {activeStates.map((state) => (
              <button
                key={state}
                type="button"
                aria-label={t('attendance.filter.remove', { label: attendanceStatusLabel(t, state) })}
                onClick={() => removeState(state)}
                className={cn(CHIP, SELECTED, FOCUS, 'min-h-[44px]')}
                style={PRIMARY_BORDER}
              >
                <AttendanceStatusDot state={state} className="h-[9px] w-[9px]" />
                <span>{attendanceStatusLabel(t, state)}</span>
                <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              </button>
            ))}
            {corrected && (
              <button
                type="button"
                aria-label={t('attendance.filter.remove', { label: t('attendance.state.corrected') })}
                onClick={() => { onCorrectedChange(false); triggerRef.current?.focus() }}
                className={cn(CHIP, SELECTED, FOCUS, 'min-h-[44px]')}
                style={PRIMARY_BORDER}
              >
                <AttendanceStatusDot state="pending" corrected className="h-[9px] w-[9px]" />
                <span>{t('attendance.state.corrected')}</span>
                <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              </button>
            )}
          </div>
        )}
      </section>
      <DialogContent
        hideClose
        returnFocusRef={triggerRef}
        dir={direction}
        aria-modal
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        data-print-hide
        className="bottom-sheet !start-0 !end-0 !top-auto !bottom-0 !max-h-[calc(100dvh-1.75rem)] !w-full !max-w-none !translate-x-0 !translate-y-0 rounded-b-none border-b-0 [border-start-start-radius:20px] [border-start-end-radius:20px]"
      >
        <span aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <DialogTitle className="text-base font-semibold">{t('attendance.filter.rowStatus')}</DialogTitle>
          <DialogClose asChild>
            <button type="button" aria-label={t('attendance.filter.close')} className={cn('inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-foreground', FOCUS)}>
              <X className="h-4 w-4" strokeWidth={1.8} aria-hidden />
            </button>
          </DialogClose>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4"><StateChips {...chipProps} mobile /></div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 pt-3 pb-[max(1rem,var(--safe-bottom))]">
          <button type="button" onClick={onClear} className={cn('min-h-[44px] rounded-sm text-[0.75em] text-primary-text underline underline-offset-4', FOCUS)}>
            {t('attendance.filter.clear')}
          </button>
          <DialogClose asChild>
            <button type="button" className={cn('inline-flex min-h-[44px] items-center rounded-md bg-primary px-3 text-[0.75em] font-semibold text-primary-foreground hover:bg-primary-hover', FOCUS)}>
              <span>{t('attendance.filter.showResults')} · <bdi dir="ltr" className="font-mono tabular-nums">{resultCount}</bdi></span>
            </button>
          </DialogClose>
        </footer>
      </DialogContent>
    </DialogRoot>
  )
}
