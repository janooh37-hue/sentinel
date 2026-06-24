/**
 * LedgerFilterBar — secondary filter row, TAMM vocabulary.
 *
 * Houses the QuickFilterChips (Has attachment · This week · Sent from app ·
 * Drafts — Starred lives upstairs in the main direction-chip row), plus the
 * advanced filters: channel select, date range, counterparty, tag, clear.
 *
 * The main direction toggle and FTS5 search input were promoted to the page
 * header in the TAMM redesign — this bar is for everything else.
 */

import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { LedgerChannel } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { QuickFilterChips } from '@/components/ledger/QuickFilterChips'
import { cn } from '@/lib/utils'
import type { LedgerFilters } from './ledgerFilters'
import { DEFAULT_LEDGER_FILTERS } from './ledgerFilters'

const CHANNELS: Array<{ value: LedgerChannel; labelKey: string }> = [
  { value: 'email', labelKey: 'ledger.channel.email' },
  { value: 'phone', labelKey: 'ledger.channel.phone' },
  { value: 'in_person', labelKey: 'ledger.channel.in_person' },
  { value: 'fax', labelKey: 'ledger.channel.fax' },
  { value: 'letter', labelKey: 'ledger.channel.letter' },
  { value: 'other', labelKey: 'ledger.channel.other' },
]

interface LedgerFilterBarProps {
  filters: LedgerFilters
  onChange: (f: LedgerFilters) => void
  /** Optional slot for an external search bar. Pass `null` (or omit) when the
   * search bar lives elsewhere — this bar only renders the slot if non-null. */
  searchBar?: React.ReactNode
  /**
   * `'bar'` (default) — the sticky desktop filter bar. `'sheet'` — rendered
   * inside the mobile FilterSheet: drops the sticky chrome, stacks the chips +
   * advanced controls vertically, and makes inputs full-width / tap-sized.
   */
  variant?: 'bar' | 'sheet'
}

const COMPACT_INPUT_CLS =
  'h-8 rounded-md border border-border bg-surface px-2 text-[0.78em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** Sentinel for the "any channel" item — Radix Select forbids an empty value. */
const ALL_CHANNELS = '__all__'

export function LedgerFilterBar({
  filters,
  onChange,
  searchBar,
  variant = 'bar',
}: LedgerFilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const isSheet = variant === 'sheet'

  const hasFilters =
    filters.direction !== null ||
    filters.channel !== null ||
    !!filters.fromDate ||
    !!filters.toDate ||
    !!filters.counterparty ||
    !!filters.q ||
    !!filters.tag ||
    filters.hasAttachment ||
    filters.thisWeek ||
    filters.sentFromApp ||
    filters.starred ||
    filters.drafts

  return (
    <div
      className={cn(
        isSheet
          ? 'flex flex-col gap-4'
          : 'sticky top-0 z-20 flex flex-col gap-2 border-b border-hairline bg-background/95 px-4 py-2 backdrop-blur-sm md:px-6',
      )}
    >
      {/* On mobile: horizontal scroll so chips stay on one row; bump tap-targets
          to ≥44px via [&_button] override. Desktop keeps the wrapping layout.
          In the sheet they wrap freely with comfortable tap targets. */}
      <div
        className={cn(
          'relative',
          isSheet
            ? '[&_button]:min-h-[40px] [&_>div]:flex-wrap'
            : 'max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[&_button]:min-h-[44px] max-md:[&_button]:px-4 max-md:[&_>div]:flex-nowrap',
        )}
      >
        <QuickFilterChips filters={filters} onChange={onChange} />
      </div>
      <div
        className={cn(
          isSheet
            ? 'grid grid-cols-2 gap-2'
            : 'flex flex-wrap items-center gap-2',
        )}
      >
        {/* Channel select */}
        <Select
          value={filters.channel ?? ALL_CHANNELS}
          onValueChange={(v) =>
            onChange({
              ...filters,
              channel: v === ALL_CHANNELS ? null : (v as LedgerChannel),
            })
          }
        >
          <SelectTrigger
            aria-label={t('ledger.filters.channel')}
            className={cn(
              COMPACT_INPUT_CLS,
              'gap-1.5',
              isSheet ? 'col-span-2 h-11 w-full text-sm' : 'w-[140px]',
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_CHANNELS}>{t('ledger.filters.channel')}</SelectItem>
            {CHANNELS.map(({ value, labelKey }) => (
              <SelectItem key={value} value={value}>
                {t(labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range */}
        <input
          type="date"
          aria-label={t('ledger.filters.dateFrom')}
          value={filters.fromDate}
          onChange={(e) => onChange({ ...filters, fromDate: e.target.value })}
          className={cn(COMPACT_INPUT_CLS, 'font-mono', isSheet && 'h-11 w-full text-sm')}
        />
        {!isSheet && <span className="text-[0.78em] text-muted-foreground">—</span>}
        <input
          type="date"
          aria-label={t('ledger.filters.dateTo')}
          value={filters.toDate}
          onChange={(e) => onChange({ ...filters, toDate: e.target.value })}
          className={cn(COMPACT_INPUT_CLS, 'font-mono', isSheet && 'h-11 w-full text-sm')}
        />

        {/* Counterparty */}
        <Input
          placeholder={t('ledger.filters.counterparty')}
          value={filters.counterparty}
          onChange={(e) => onChange({ ...filters, counterparty: e.target.value })}
          className={cn(
            'text-[0.78em]',
            isSheet ? 'col-span-2 h-11 w-full text-sm' : 'h-8 w-[160px]',
          )}
        />

        {/* Optional external search slot (legacy compat — page passes null now). */}
        {searchBar}

        {/* Tag */}
        <Input
          placeholder={t('ledger.filters.tag')}
          value={filters.tag}
          onChange={(e) => onChange({ ...filters, tag: e.target.value })}
          className={cn(
            'text-[0.78em]',
            isSheet ? 'col-span-2 h-11 w-full text-sm' : 'h-8 w-[120px]',
          )}
        />

        {/* Clear */}
        {hasFilters && (
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              'rounded-full',
              isSheet ? 'col-span-2 h-11' : 'h-8',
            )}
            onClick={() => onChange(DEFAULT_LEDGER_FILTERS)}
          >
            <X className="h-3 w-3" />
            {t('ledger.filters.clear')}
          </Button>
        )}
      </div>
    </div>
  )
}
