/**
 * The discoverable half of correcting a cell (UI spec §8.1): click a cell, get
 * the eight codes with their keyboard letters and `Clear cell`.
 *
 * `AB` is the one code with something else to say. It becomes a real absence on
 * the employee's record rather than a sheet-local scribble, so the menu swaps
 * its body for an optional note — matching `onSetCell(employeeId, day, code,
 * note?)`.
 *
 * **The role changes with the body, deliberately.** `role="menu"` may contain
 * menuitems, groups and separators — not a textbox and not a pair of ordinary
 * buttons. So the code list is a `menu`, and the note step is a `dialog`: the
 * popover stops being a menu at the moment it stops behaving like one. Keeping
 * `role="menu"` over a form would be an invalid tree announced wrongly, which
 * is a worse answer than two honest roles.
 *
 * Escape and outside-click both close, but only Escape restores focus to the
 * cell: an outside click means the operator is already aiming somewhere else,
 * and yanking focus back would fight the pointer.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { CODES, type Code, slugOf } from './codes'

export interface CodePickerProps {
  employeeId: string
  day: number
  /** The printed name, so the menu head names who is being corrected. */
  name: string
  /** The cell the picker was opened from: the anchor, and where focus goes back. */
  anchor: HTMLElement
  onPick: (code: Code | null, note?: string) => void
  /** `restore` returns focus to the anchor cell. */
  onClose: (restore: boolean) => void
}

/** The `-` code prints as a hyphen but reads as an en dash on screen. */
const glyphOf = (code: Code): string => (code === '-' ? '–' : slugOf(code))

export function CodePicker({
  employeeId,
  day,
  name,
  anchor,
  onPick,
  onClose,
}: CodePickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const popover = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const [note, setNote] = useState(false)
  const [text, setText] = useState('')

  // Placed against the anchor, flipped above it near the bottom of the viewport
  // and mirrored in RTL. Anchored logically (`.ts-popover` sets
  // `inset-inline-start: 0`) and moved by a translation, so nothing here names
  // `left` or `top`: a viewport coordinate is physical and so is a transform,
  // and in RTL the translation starts from the far edge the anchor gives it.
  useLayoutEffect(() => {
    const node = popover.current
    if (!node) return
    const rect = anchor.getBoundingClientRect()
    const size = node.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    const raw = rtl ? rect.right - size.width : rect.left
    const x = Math.max(8, Math.min(raw, window.innerWidth - size.width - 8))
    const below = rect.bottom + 6
    const y =
      below + size.height > window.innerHeight - 8 ? rect.top - size.height - 6 : below
    const origin = rtl ? window.innerWidth - size.width : 0
    node.style.transform = `translate3d(${x - origin}px, ${Math.max(8, y)}px, 0)`
  }, [anchor, note])

  useEffect(() => {
    if (note) input.current?.focus()
    else popover.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [note])

  useEffect(() => {
    const outside = (event: MouseEvent): void => {
      if (!popover.current?.contains(event.target as Node)) onClose(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [onClose])

  const choose = useCallback(
    (code: Code) => {
      if (code === 'AB') {
        setNote(true)
        return
      }
      onPick(code)
    },
    [onPick],
  )

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose(true)
      return
    }
    if (note) return
    const items = Array.from(
      popover.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    )
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step !== 0 && items.length > 0) {
      event.preventDefault()
      const here = items.indexOf(document.activeElement as HTMLElement)
      items[(here + step + items.length) % items.length]?.focus()
      return
    }
    // The same letters the ribbon teaches, so the menu is never a slower way
    // of doing what the keyboard already does.
    const hit = CODES.find((spec) => spec.key === event.key.toLowerCase())
    if (hit) {
      event.preventDefault()
      choose(hit.code)
    }
  }

  const head = (
    <div className="border-b border-hairline px-2 pb-1.5 pt-1 text-[0.7rem] text-muted-foreground">
      <span className="font-mono text-foreground">{employeeId}</span> · {t('timesheet.colDay')}{' '}
      <b className="font-mono font-semibold text-foreground">{day}</b> — {name}
    </div>
  )

  return createPortal(
    <div
      ref={popover}
      role={note ? 'dialog' : 'menu'}
      aria-label={note ? t('timesheet.note') : t('timesheet.codesLabel')}
      onKeyDown={onKeyDown}
      className="ts-popover min-w-[13rem] rounded-xl border border-border bg-surface p-1.5 shadow-lg"
    >
      {head}
      {note ? (
        <div className="px-2 pb-1 pt-2">
          <label
            htmlFor="timesheet-cell-note"
            className="mb-1.5 block text-[0.7rem] text-muted-foreground"
          >
            {t('timesheet.note')}
          </label>
          <input
            ref={input}
            id="timesheet-cell-note"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              onPick('AB', text.trim() || undefined)
            }}
            className="w-full rounded-lg border border-border-strong bg-surface-raised px-2 py-1.5 text-[0.78rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => onPick('AB', text.trim() || undefined)}
              className="rounded-full bg-primary px-3 py-1 text-[0.72rem] font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => onClose(true)}
              className="rounded-full border border-border-strong px-3 py-1 text-[0.72rem] font-semibold text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {CODES.map((spec) => (
            <button
              key={spec.slug}
              type="button"
              role="menuitem"
              onClick={() => choose(spec.code)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-[0.78rem] text-foreground hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none"
            >
              <span
                data-code={spec.slug}
                aria-hidden
                className="grid h-5 w-[1.6rem] shrink-0 place-items-center rounded border border-border font-mono text-[0.66rem] font-semibold"
              >
                {glyphOf(spec.code)}
              </span>
              <span className="truncate">{t(spec.labelKey)}</span>
              <kbd className="ms-auto font-mono text-[0.62rem] text-faint">{spec.key}</kbd>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick(null)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-[0.78rem] text-foreground hover:bg-surface-tinted focus-visible:bg-surface-tinted focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="grid h-5 w-[1.6rem] shrink-0 place-items-center rounded border border-border font-mono text-[0.66rem]"
            >
              ⌫
            </span>
            <span className="truncate">{t('timesheet.clearCell')}</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
