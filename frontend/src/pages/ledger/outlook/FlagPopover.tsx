/**
 * FlagPopover — the 🚩 follow-up toggle + due-date popover on a message row
 * (Phase 2, D3b). Matches the prototype's `.flagpop`:
 *   Today · Tomorrow · Next week · No date  (each with its resolved date).
 *
 * The 🚩 button toggles the current user's flag. When already flagged, clicking
 * the button clears it; otherwise it opens the popover to pick a due date. The
 * popover items each set the flag with the chosen date. Built on the Radix
 * `DropdownMenu` (portals to body, escapes the list's scroll/transform clip per
 * the floating-UI pattern in CLAUDE.md).
 *
 * Per-user flags — `flagged`/`followup_due` come from the list item for the
 * current caller. Overdue rows get a warning-soft tint + the 🚩 glyph (handled
 * by the row), never colour alone.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { flagPresets, useFlagMutations, type FlagPreset } from './useFlagMutations'

interface FlagPopoverProps {
  entryId: number
  flagged: boolean
  overdue?: boolean
  className?: string
}

export function FlagPopover({
  entryId,
  flagged,
  overdue,
  className,
}: FlagPopoverProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { setFlag, clearFlag } = useFlagMutations()

  const presets = useMemo(() => flagPresets(), [])
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: 'short' }),
    [i18n.language],
  )
  const presetDateLabel = (p: FlagPreset): string =>
    p.due ? dateFmt.format(new Date(`${p.due}T00:00:00`)) : '—'

  // Already flagged → the button clears the flag directly (no popover). Unset →
  // open the popover to choose a due date.
  const triggerButton = (
    <button
      type="button"
      aria-label={flagged ? t('ledger.flag.clear') : t('ledger.flag.set')}
      aria-pressed={flagged}
      title={flagged ? t('ledger.flag.clear') : t('ledger.flag.set')}
      onClick={(e) => {
        e.stopPropagation()
        if (flagged) clearFlag(entryId)
      }}
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        flagged
          ? overdue
            ? 'text-warning hover:bg-warning-soft'
            : 'text-accent hover:bg-accent-soft'
          : 'text-faint opacity-0 hover:bg-surface-tinted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100',
        className,
      )}
    >
      <Flag className="h-3.5 w-3.5" strokeWidth={1.7} fill={flagged ? 'currentColor' : 'none'} />
    </button>
  )

  // Flagged: the button is a plain toggle (clear) — no menu.
  if (flagged) return triggerButton

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[11rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-[0.8em] font-semibold text-foreground">
          <span aria-hidden>🚩</span>
          <span dir="auto">{t('ledger.flag.title')}</span>
        </div>
        <DropdownMenuSeparator />
        {presets.map((p) => (
          <DropdownMenuItem
            key={p.key}
            onSelect={() => setFlag(entryId, p.due)}
            className="justify-between"
          >
            <span dir="auto">{t(`ledger.flag.presets.${p.key}`)}</span>
            <span className="font-mono text-[0.82em] text-faint">{presetDateLabel(p)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
