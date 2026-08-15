import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Minus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useCapabilities } from '@/lib/useCapabilities'

import {
  DEFAULT_SLOT_IDS,
  SECTION_ENTRIES,
  SIGNAL_ENTRIES,
  entryById,
  loadSlotIds,
  placeEntry,
  resetSlot,
  saveSlotIds,
  type DockEntry,
} from './navCustomization'
import { useWaitingSignals } from './useWaitingSignals'

interface DockSlotVisualProps {
  entry: DockEntry
  label: string
  count: number
  active?: boolean
  selected?: boolean
}

function DockSlotVisual({ entry, label, count, active = false, selected = false }: DockSlotVisualProps): React.JSX.Element {
  const Icon = entry.Icon

  return (
    <>
      <span
        className={cn(
          'relative inline-flex h-8 w-11 items-center justify-center rounded-[14px] transition-colors motion-reduce:transition-none',
          active ? 'bg-primary text-primary-foreground' : 'bg-transparent text-muted-foreground',
          selected && 'ring-2 ring-primary ring-offset-2 ring-offset-surface',
        )}
      >
        <Icon className="h-[19px] w-[19px]" strokeWidth={1.8} aria-hidden />
        {entry.signal && count > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -end-[7px] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-mono font-semibold leading-none text-white tabular-nums"
          >
            {count}
          </span>
        )}
      </span>
      <span
        className={cn(
          'w-full text-center text-[10.5px] font-medium leading-tight [overflow-wrap:anywhere]',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </>
  )
}

interface EntryPickerProps {
  entry: DockEntry
  label: string
  count: number
  placed: boolean
  onSelect: (entryId: string) => void
}

function EntryPicker({ entry, label, count, placed, onSelect }: EntryPickerProps): React.JSX.Element {
  const Icon = entry.Icon
  const isSignal = entry.kind === 'signal'

  return (
    <button
      type="button"
      aria-pressed={placed}
      onClick={() => onSelect(entry.id)}
      className={cn(
        'flex min-w-0 flex-col items-center gap-1 rounded-xl p-1 text-center transition-colors motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'hover:bg-surface-tinted',
        placed && 'ring-1 ring-primary/35',
      )}
    >
      <span
        className={cn(
          'relative inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px]',
          isSignal ? 'bg-accent-soft text-accent' : 'bg-surface-tinted text-primary',
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        {isSignal && count > 0 && (
          <span
            aria-hidden
            className="absolute -top-1 -end-[7px] inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-mono font-semibold leading-none text-white tabular-nums"
          >
            {count}
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full text-[10px] font-medium leading-tight text-foreground [overflow-wrap:anywhere]">
        {label}
      </span>
    </button>
  )
}

export function BottomTabBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const signals = useWaitingSignals(true)
  const [slotIds, setSlotIds] = useState(loadSlotIds)
  const [editMode, setEditMode] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const longPressTimer = useRef<number | null>(null)
  const pointerStart = useRef<{ id: number; x: number; y: number } | null>(null)
  const suppressNextClick = useRef(false)

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    pointerStart.current = null
  }, [])

  const closeEditMode = useCallback(() => {
    cancelLongPress()
    setEditMode(false)
    setSelectedSlot(null)
  }, [cancelLongPress])

  useEffect(() => cancelLongPress, [cancelLongPress])

  const renderedSlots = slotIds.map((slotId, index) => {
    const entry = entryById(slotId)
    if (!entry || (entry.cap && !has(entry.cap))) {
      return entryById(DEFAULT_SLOT_IDS[index])!
    }
    return entry
  })

  const countFor = useCallback(
    (entry: DockEntry): number => (entry.signal ? (signals[entry.signal] ?? 0) : 0),
    [signals],
  )

  const startLongPress = (slotIndex: number, event: PointerEvent<HTMLAnchorElement>): void => {
    if (event.button !== 0) return

    cancelLongPress()
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null
      pointerStart.current = null
      // A completed hold opens customization and its ensuing click must never navigate.
      suppressNextClick.current = true
      setSelectedSlot(slotIndex)
      setEditMode(true)
    }, 500)
  }

  const moveLongPress = (event: PointerEvent<HTMLAnchorElement>): void => {
    const start = pointerStart.current
    if (!start || start.id !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) cancelLongPress()
  }

  const placeSelectedEntry = (entryId: string): void => {
    if (selectedSlot === null) return

    setSlotIds((current) => {
      const next = placeEntry(current, selectedSlot, entryId)
      saveSlotIds(next)
      return next
    })
  }

  const restoreSlot = (slotIndex: number): void => {
    setSlotIds((current) => {
      const next = resetSlot(current, slotIndex)
      saveSlotIds(next)
      return next
    })
  }

  const availableSections = SECTION_ENTRIES.filter((entry) => !entry.cap || has(entry.cap))

  return (
    // modal={false}: a modal dialog sets pointer-events:none on <body>, which would
    // kill the edit-mode dock (slot selection + reset handles) living outside the
    // portal. Non-modal keeps the dock interactive; onInteractOutside below stops
    // dock taps from closing the sheet.
    <RadixDialog.Root open={editMode} modal={false} onOpenChange={(open) => !open && closeEditMode()}>
      <nav
        ref={navRef}
        aria-label={t('nav.menu')}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          // This floating geometry clears the physical display corners on iPhones instead of meeting them.
          'fixed start-3 end-3 bottom-[calc(0.625rem+env(safe-area-inset-bottom))] flex h-[68px] rounded-[26px] border border-border/70 bg-surface/80 px-1.5 [box-shadow:0_10px_30px_rgba(13,40,69,.16)] backdrop-blur-xl md:hidden',
          editMode ? 'z-50' : 'z-40',
        )}
      >
        {renderedSlots.map((entry, slotIndex) => {
          const label = t(entry.labelKey)
          const count = countFor(entry)
          const rotation = slotIndex % 2 === 0 ? 'motion-safe:-rotate-[2.2deg]' : 'motion-safe:rotate-[2.2deg]'

          return (
            <div
              key={`${slotIndex}:${entry.id}`}
              data-slot-index={slotIndex}
              data-entry-id={entry.id}
              className={cn(
                'relative flex min-w-0 flex-1 justify-center',
                editMode && `${rotation} motion-reduce:transform-none`,
              )}
            >
              {editMode ? (
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => setSelectedSlot(slotIndex)}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <DockSlotVisual
                    entry={entry}
                    label={label}
                    count={count}
                    selected={selectedSlot === slotIndex}
                  />
                </button>
              ) : (
                <NavLink
                  to={entry.to}
                  end={entry.to === '/'}
                  aria-label={label}
                  onPointerDown={(event) => startLongPress(slotIndex, event)}
                  onPointerMove={moveLongPress}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onClick={(event) => {
                    if (suppressNextClick.current) {
                      event.preventDefault()
                      suppressNextClick.current = false
                    }
                  }}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {({ isActive }) => <DockSlotVisual entry={entry} label={label} count={count} active={isActive} />}
                </NavLink>
              )}
              {editMode && (
                <button
                  type="button"
                  aria-label={t('nav.customize.reset')}
                  onClick={() => restoreSlot(slotIndex)}
                  className="absolute top-0 end-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-reduce:transition-none"
                >
                  <Minus className="h-2.5 w-2.5" strokeWidth={1.8} aria-hidden />
                </button>
              )}
            </div>
          )
        })}
      </nav>

      <RadixDialog.Portal>
        {editMode && (
          <div
            aria-hidden
            onClick={closeEditMode}
            className="fixed inset-0 z-40 bg-primary/35 backdrop-blur-[2px] animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          />
        )}
        <RadixDialog.Content
          onInteractOutside={(event) => {
            // Taps on the dock are part of the editing interaction, not a dismissal.
            if (navRef.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className="bottom-sheet fixed inset-x-0 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] overflow-y-auto rounded-t-2xl bg-surface shadow-2xl focus-visible:outline-none md:hidden"
        >
          <span aria-hidden className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-hairline" />
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <RadixDialog.Title className="text-[0.95em] font-semibold text-foreground">
              {t('nav.customize.title')}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="rounded-full bg-primary-soft px-3 py-1.5 text-[0.78em] font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
              >
                {t('nav.customize.done')}
              </button>
            </RadixDialog.Close>
          </header>
          <div className="space-y-5 px-5 py-4">
            <p className="text-[0.78em] text-muted-foreground">{t('nav.customize.hint')}</p>
            <section aria-labelledby="dock-sections-title">
              <h3 id="dock-sections-title" className="mb-2 text-[0.75em] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('nav.customize.sections')}
              </h3>
              <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                {availableSections.map((entry) => (
                  <EntryPicker
                    key={entry.id}
                    entry={entry}
                    label={t(entry.labelKey)}
                    count={0}
                    placed={slotIds.includes(entry.id)}
                    onSelect={placeSelectedEntry}
                  />
                ))}
              </div>
            </section>
            <section aria-labelledby="dock-signals-title">
              <h3 id="dock-signals-title" className="mb-2 text-[0.75em] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t('nav.customize.signals')}
              </h3>
              <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                {SIGNAL_ENTRIES.map((entry) => (
                  <EntryPicker
                    key={entry.id}
                    entry={entry}
                    label={t(entry.labelKey)}
                    count={countFor(entry)}
                    placed={slotIds.includes(entry.id)}
                    onSelect={placeSelectedEntry}
                  />
                ))}
              </div>
            </section>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
