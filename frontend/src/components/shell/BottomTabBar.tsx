import { useCallback, useRef, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Grip, Minus, Pencil } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, useNavigate } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { useCapabilities } from '@/lib/useCapabilities'
import { prefetchRouteForPath } from '@/lib/prefetchRoute'

import {
  DEFAULT_SLOT_IDS,
  SECTION_ENTRIES,
  SIGNAL_ENTRIES,
  entryById,
  isNavEntryAllowed,
  loadSlotIds,
  placeEntry,
  resetSlot,
  saveSlotIds,
  type DockEntry,
} from './navCustomization'
import { useWaitingSignals } from './useWaitingSignals'

interface DockSlotVisualProps {
  Icon: LucideIcon
  label: string
  count: number
  active?: boolean
  selected?: boolean
}

function DockSlotVisual({ Icon, label, count, active = false, selected = false }: DockSlotVisualProps): React.JSX.Element {
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
        {count > 0 && (
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
      onPointerEnter={() => prefetchRouteForPath(entry.to)}
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
  const navigate = useNavigate()
  const signals = useWaitingSignals(true)
  const [slotIds, setSlotIds] = useState(loadSlotIds)
  const [sheet, setSheet] = useState<'closed' | 'browse' | 'edit'>('closed')
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null)
  const navRef = useRef<HTMLElement>(null)
  const isEditing = sheet === 'edit'

  const closeSheet = useCallback(() => {
    setSheet('closed')
    setSelectedSlot(null)
  }, [])

  const renderedSlots = (() => {
    const used = new Set<string>()
    const allowedSections = SECTION_ENTRIES.filter((entry) => isNavEntryAllowed(entry, has))
    return slotIds.flatMap((slotId, index) => {
      const requested = entryById(slotId)
      const preferred = entryById(DEFAULT_SLOT_IDS[index] ?? '')
      const entry =
        requested && isNavEntryAllowed(requested, has) && !used.has(requested.id)
          ? requested
          : [preferred, ...allowedSections].find(
              (candidate) =>
                candidate != null &&
                isNavEntryAllowed(candidate, has) &&
                !used.has(candidate.id),
            )
      if (!entry) return []
      used.add(entry.id)
      return [{ entry, sourceSlotIndex: index }]
    })
  })()

  const countFor = useCallback(
    (entry: DockEntry): number => (entry.signal ? (signals[entry.signal] ?? 0) : 0),
    [signals],
  )

  const placeSelectedEntry = (entryId: string): void => {
    if (selectedSlot === null) return

    setSlotIds((current) => {
      const next = placeEntry(current, selectedSlot, entryId)
      saveSlotIds(next)
      return next
    })
  }

  const navigateToEntry = (entryId: string): void => {
    const entry = entryById(entryId)
    if (entry) navigate(entry.to)
    closeSheet()
  }

  const restoreSlot = (slotIndex: number): void => {
    setSlotIds((current) => {
      const next = resetSlot(current, slotIndex)
      saveSlotIds(next)
      return next
    })
  }

  const availableSections = SECTION_ENTRIES.filter((entry) => isNavEntryAllowed(entry, has))
  const availableSignals = SIGNAL_ENTRIES.filter((entry) => isNavEntryAllowed(entry, has))

  return (
    // modal={false}: a modal dialog sets pointer-events:none on <body>, which would
    // kill the edit-mode dock (slot selection + reset handles) and the More button's
    // own toggle tap, both of which live outside the portal. Non-modal keeps the dock
    // interactive; onInteractOutside below stops dock taps from closing the sheet.
    <RadixDialog.Root open={sheet !== 'closed'} modal={false} onOpenChange={(open) => !open && closeSheet()}>
      <nav
        ref={navRef}
        aria-label={t('nav.menu')}
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          // This floating geometry clears the physical display corners on iPhones instead of meeting them.
          'fixed start-3 end-3 bottom-[calc(0.625rem+var(--safe-bottom))] flex h-[68px] rounded-[26px] border border-border/70 bg-surface/80 px-1.5 [box-shadow:0_10px_30px_rgba(13,40,69,.16)] backdrop-blur-xl md:hidden',
          sheet !== 'closed' ? 'z-50' : 'z-40',
        )}
      >
        {renderedSlots.map(({ entry, sourceSlotIndex }, renderedIndex) => {
          const label = t(entry.labelKey)
          const count = countFor(entry)
          const rotation = renderedIndex % 2 === 0 ? 'motion-safe:-rotate-[2.2deg]' : 'motion-safe:rotate-[2.2deg]'

          return (
            <div
              key={`${sourceSlotIndex}:${entry.id}`}
              data-slot-index={sourceSlotIndex}
              data-entry-id={entry.id}
              className={cn(
                'relative flex min-w-0 flex-1 justify-center',
                isEditing && `${rotation} motion-reduce:transform-none`,
              )}
            >
              {isEditing ? (
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => setSelectedSlot(sourceSlotIndex)}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <DockSlotVisual
                    Icon={entry.Icon}
                    label={label}
                    count={count}
                    selected={selectedSlot === sourceSlotIndex}
                  />
                </button>
              ) : (
                <NavLink
                  to={entry.to}
                  end={entry.to === '/'}
                  aria-label={label}
                  onPointerEnter={() => prefetchRouteForPath(entry.to)}
                  onFocus={() => prefetchRouteForPath(entry.to)}
                  onClick={() => sheet !== 'closed' && closeSheet()}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-foreground [-webkit-touch-callout:none] select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {({ isActive }) => <DockSlotVisual Icon={entry.Icon} label={label} count={count} active={isActive} />}
                </NavLink>
              )}
              {isEditing && (
                <button
                  type="button"
                  aria-label={t('nav.customize.reset')}
                  onClick={() => restoreSlot(sourceSlotIndex)}
                  className="absolute top-0 end-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-reduce:transition-none"
                >
                  <Minus className="h-2.5 w-2.5" strokeWidth={1.8} aria-hidden />
                </button>
              )}
            </div>
          )
        })}
        <div className="relative flex min-w-0 flex-1 justify-center">
          <button
            type="button"
            aria-label={t('nav.tools.more')}
            aria-haspopup="dialog"
            aria-expanded={sheet !== 'closed'}
            onClick={() => (sheet === 'closed' ? setSheet('browse') : closeSheet())}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <DockSlotVisual Icon={Grip} label={t('nav.tools.more')} count={0} active={sheet !== 'closed'} />
          </button>
        </div>
      </nav>

      <RadixDialog.Portal>
        {sheet !== 'closed' && (
          <div
            aria-hidden
            onClick={closeSheet}
            className="fixed inset-0 z-40 bg-primary/35 backdrop-blur-[2px] animate-in fade-in-0 duration-200 motion-reduce:animate-none"
          />
        )}
        <RadixDialog.Content
          aria-describedby={undefined}
          onInteractOutside={(event) => {
            // Taps on the dock are part of the sheet's own interaction (slot editing,
            // or the More toggle itself), not a dismissal.
            if (navRef.current?.contains(event.target as Node)) event.preventDefault()
          }}
          className="bottom-sheet fixed inset-x-0 bottom-[calc(5.75rem+var(--safe-bottom))] z-50 max-h-[calc(100dvh-6.5rem-var(--safe-bottom))] overflow-y-auto rounded-t-2xl bg-surface shadow-2xl focus-visible:outline-none md:hidden"
        >
          <span aria-hidden className="mx-auto mt-2.5 block h-1 w-10 rounded-full bg-hairline" />
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <RadixDialog.Title className="text-[0.95em] font-semibold text-foreground">
              {t(isEditing ? 'nav.customize.title' : 'nav.tools.title')}
            </RadixDialog.Title>
            {isEditing ? (
              <RadixDialog.Close asChild>
                <button
                  type="button"
                  className="rounded-full bg-primary-soft px-3 py-1.5 text-[0.78em] font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
                >
                  {t('nav.customize.done')}
                </button>
              </RadixDialog.Close>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSheet('edit')
                  setSelectedSlot(0)
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1.5 text-[0.78em] font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
                {t('nav.customize.edit')}
              </button>
            )}
          </header>
          <div className="space-y-5 px-5 py-4">
            {isEditing && <p className="text-[0.78em] text-muted-foreground">{t('nav.customize.hint')}</p>}
            {availableSections.length > 0 && (
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
                      placed={isEditing && slotIds.includes(entry.id)}
                      onSelect={isEditing ? placeSelectedEntry : navigateToEntry}
                    />
                  ))}
                </div>
              </section>
            )}
            {availableSignals.length > 0 && (
              <section aria-labelledby="dock-signals-title">
                <h3 id="dock-signals-title" className="mb-2 text-[0.75em] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t('nav.customize.signals')}
                </h3>
                <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                  {availableSignals.map((entry) => (
                    <EntryPicker
                      key={entry.id}
                      entry={entry}
                      label={t(entry.labelKey)}
                      count={countFor(entry)}
                      placed={isEditing && slotIds.includes(entry.id)}
                      onSelect={isEditing ? placeSelectedEntry : navigateToEntry}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
