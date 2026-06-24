/**
 * Inner tabs for the Employee Detail page.
 * Documents · Profile · Leaves · Violations · Activity.
 */

import { useTranslation } from 'react-i18next'

export type Tab = 'documents' | 'profile' | 'leaves' | 'violations' | 'activity'

interface Counts {
  documents: number
  leaves: string
  violations: number
  activity: number
}

interface Props {
  active: Tab
  counts: Counts
  onChange: (next: Tab) => void
}

const ORDER: Tab[] = ['documents', 'profile', 'leaves', 'violations', 'activity']

export function EmployeeDetailTabs({ active, counts, onChange }: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border px-1 [-webkit-overflow-scrolling:touch]" role="tablist">
      {ORDER.map((tab) => {
        const isActive = active === tab
        const label = t(`employee.tab.${tab}`)
        let count: string | number | null
        if (tab === 'profile') count = null
        else if (tab === 'leaves') count = counts.leaves
        else count = counts[tab]
        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab)}
            className={`relative shrink-0 px-4 py-3 text-[0.95em] font-medium transition-colors ${
              isActive
                ? 'font-semibold text-primary after:absolute after:-bottom-px after:left-3 after:right-3 after:h-[3px] after:rounded after:bg-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count !== null && (
              <span
                className={`ms-1 text-[0.78em] font-medium ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
