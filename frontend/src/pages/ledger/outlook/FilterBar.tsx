/**
 * FilterBar — the Ledger message-list quick filters (Phase 2, D1).
 *
 * A thin chip row above the list (the prototype's `.ml-filters`):
 *   [All] [● Unread] [📎 Attachment] [🚩 Flagged] [👤 This employee]
 *
 * Multi-toggle: each chip toggles independently; "All" clears every chip. The
 * shell turns the active chips into `GET /ledger` params and re-fetches the
 * open folder (`applyQuickFilters`). "This employee" is only enabled when a
 * person is in context (an employee G-number resolved from the open mail).
 *
 * This is ledger CHROME — it lives inside `[data-ledger-chrome] dir="ltr"` and
 * must NOT mirror in Arabic. Use logical utilities; only leaf text re-flows.
 * Emoji are wayfinding aids (CLAUDE.md principle #1).
 */

import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import type { QuickFilters } from './mailboxQuery'
import { noFiltersActive } from './mailboxQuery'

interface FilterBarProps {
  filters: QuickFilters
  onChange: (next: QuickFilters) => void
  /** True when an employee G-number is in context (enables "This employee"). */
  employeeInContext: boolean
}

export function FilterBar({
  filters,
  onChange,
  employeeInContext,
}: FilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const allActive = noFiltersActive(filters)

  const toggle = (key: keyof QuickFilters): void => {
    onChange({ ...filters, [key]: !filters[key] })
  }

  return (
    <div
      role="group"
      aria-label={t('ledger.filter.label')}
      className="flex flex-wrap items-center gap-1.5 border-b border-border px-3.5 py-2"
    >
      <Chip
        active={allActive}
        onClick={() => onChange({ unread: false, hasAttachment: false, flagged: false, thisEmployee: false })}
        label={t('ledger.filter.all')}
      />
      <Chip
        active={filters.unread}
        onClick={() => toggle('unread')}
        emoji="●"
        label={t('ledger.filter.unread')}
      />
      <Chip
        active={filters.hasAttachment}
        onClick={() => toggle('hasAttachment')}
        emoji="📎"
        label={t('ledger.filter.attachment')}
      />
      <Chip
        active={filters.flagged}
        onClick={() => toggle('flagged')}
        emoji="🚩"
        label={t('ledger.filter.flagged')}
      />
      <Chip
        active={filters.thisEmployee}
        onClick={() => toggle('thisEmployee')}
        emoji="👤"
        label={t('ledger.filter.thisEmployee')}
        disabled={!employeeInContext}
      />
    </div>
  )
}

interface ChipProps {
  active: boolean
  onClick: () => void
  label: string
  emoji?: string
  disabled?: boolean
}

function Chip({ active, onClick, label, emoji, disabled }: ChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.74em] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-info bg-info-soft text-info'
          : 'border-border bg-surface text-muted-foreground hover:bg-surface-tinted hover:text-foreground',
      )}
    >
      {emoji && (
        <span aria-hidden className="leading-none">
          {emoji}
        </span>
      )}
      <span dir="auto">{label}</span>
    </button>
  )
}
