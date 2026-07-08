/**
 * Pill-chip tab bar for the Employee Detail page.
 *
 * Replaces the old underline EmployeeDetailTabs; chips are rounded-full pills.
 * Order: profile → documents → leaves → messages → activity → violations.
 * The profile chip shows a warning-tinted badge when missing fields > 0.
 */

import { useTranslation } from 'react-i18next'

export type Tab = 'documents' | 'profile' | 'leaves' | 'violations' | 'activity' | 'messages'

interface Counts {
  documents: number
  leaves: string
  violations: number
  activity: number
  messages: number
  profileGaps: number
}

interface Props {
  active: Tab
  counts: Counts
  onChange: (next: Tab) => void
}

const ORDER: Tab[] = ['profile', 'documents', 'leaves', 'messages', 'activity', 'violations']

export function EmployeeTabChips({ active, counts, onChange }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="mb-4 flex flex-wrap gap-2 overflow-x-auto [-webkit-overflow-scrolling:touch]"
      role="tablist"
    >
      {ORDER.map((tab) => {
        const isActive = active === tab

        let badge: string | number | null = null
        if (tab === 'profile') badge = counts.profileGaps > 0 ? counts.profileGaps : null
        else if (tab === 'documents') badge = counts.documents
        else if (tab === 'leaves') badge = counts.leaves
        else if (tab === 'messages') badge = counts.messages
        else if (tab === 'activity') badge = counts.activity
        else if (tab === 'violations') badge = counts.violations

        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-[0.82em] font-semibold transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground'
            }`}
          >
            {t(`employee.tab.${tab}`)}
            {badge !== null && (
              <span
                className={
                  tab === 'profile' && !isActive
                    ? 'rounded-full bg-warning/15 px-1 text-[0.85em] font-medium text-warning'
                    : isActive
                      ? 'text-[0.85em] font-medium opacity-75'
                      : 'text-[0.85em] font-medium text-muted-foreground'
                }
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
