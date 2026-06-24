/**
 * QuickFilterChips — five pill-shaped toggleable chips above the ledger
 * filter row. Each chip flips a single boolean on `LedgerFilters`. The page
 * translates those flags into API query params:
 *
 *  hasAttachment → has_attachment=true
 *  thisWeek      → since=<7-days-ago ISO date>   (rolling, not calendar week)
 *  sentFromApp   → tag=sent-from-app
 *  starred       → tag=★
 *  drafts        → tag=draft
 *
 * The three tag chips overwrite `filters.tag` because the API only accepts a
 * single tag at once; toggling another tag chip swaps. Mutually exclusive on
 * the tag axis; combinable with hasAttachment + thisWeek.
 */

import { useTranslation } from 'react-i18next'
import {
  Paperclip,
  CalendarDays,
  Send,
  Star,
  FileEdit,
  type LucideIcon,
} from 'lucide-react'

import type { LedgerFilters } from '@/pages/ledger/ledgerFilters'
import { thisWeekIsoDate } from '@/pages/ledger/ledgerFilters'
import { cn } from '@/lib/utils'

interface QuickFilterChipsProps {
  filters: LedgerFilters
  onChange: (next: LedgerFilters) => void
}

const TAG_CHIP_TO_VALUE: Record<'sentFromApp' | 'starred' | 'drafts', string> = {
  sentFromApp: 'sent-from-app',
  starred: 'starred',
  drafts: 'draft',
}

interface ChipDef {
  key: keyof Pick<
    LedgerFilters,
    'hasAttachment' | 'thisWeek' | 'sentFromApp' | 'starred' | 'drafts'
  >
  labelKey: string
  icon: LucideIcon
  /** Tag chips share the single `filters.tag` axis. */
  tagAxis?: 'sentFromApp' | 'starred' | 'drafts'
}

const CHIPS: ChipDef[] = [
  { key: 'hasAttachment', labelKey: 'ledger.filters.hasAttachment', icon: Paperclip },
  { key: 'thisWeek', labelKey: 'ledger.filters.thisWeek', icon: CalendarDays },
  { key: 'sentFromApp', labelKey: 'ledger.filters.sentFromApp', icon: Send, tagAxis: 'sentFromApp' },
  { key: 'starred', labelKey: 'ledger.filters.starred', icon: Star, tagAxis: 'starred' },
  { key: 'drafts', labelKey: 'ledger.filters.drafts', icon: FileEdit, tagAxis: 'drafts' },
]

export function QuickFilterChips({ filters, onChange }: QuickFilterChipsProps): React.JSX.Element {
  const { t } = useTranslation()

  function toggle(chip: ChipDef): void {
    const isPressed = filters[chip.key]
    if (chip.tagAxis) {
      if (isPressed) {
        onChange({
          ...filters,
          [chip.key]: false,
          tag: '',
        })
      } else {
        // Activating a tag chip clears the other two tag flags and writes the
        // value into the shared `tag` axis.
        onChange({
          ...filters,
          sentFromApp: false,
          starred: false,
          drafts: false,
          [chip.key]: true,
          tag: TAG_CHIP_TO_VALUE[chip.tagAxis],
        })
      }
      return
    }
    if (chip.key === 'thisWeek') {
      // "This week" = rolling 7 days. Compute the date here in the event
      // handler (not during render) so the page query is pure.
      onChange({
        ...filters,
        thisWeek: !isPressed,
        since: !isPressed ? thisWeekIsoDate() : '',
      })
      return
    }
    onChange({ ...filters, [chip.key]: !isPressed })
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label={t('ledger.filters.quick', { defaultValue: 'Quick filters' })}
    >
      {CHIPS.map((chip) => {
        const pressed = filters[chip.key]
        const Icon = chip.icon
        return (
          <button
            key={chip.key}
            type="button"
            onClick={() => toggle(chip)}
            aria-pressed={pressed}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.78em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              pressed
                ? 'bg-primary-soft font-semibold text-primary'
                : 'bg-surface-tinted text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-3 w-3',
                pressed && chip.key === 'starred' && 'text-warning',
              )}
              strokeWidth={1.8}
              fill={pressed && chip.key === 'starred' ? 'currentColor' : 'none'}
            />
            {t(chip.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
