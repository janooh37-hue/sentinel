import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useArmoryLocale } from '../armoryFormat'
import { useArmoryAccess } from '../armoryQueries'
import { patchArmoryParams } from '../armoryUrl'
import { AuditCounts } from './AuditCounts'
import { AuditDecisions } from './AuditDecisions'
import { AuditMovements } from './AuditMovements'

const auditTabs = [
  { value: 'decisions', label: 'assets.armory.decisions' },
  { value: 'counts', label: 'assets.armory.counts' },
  { value: 'movements', label: 'assets.armory.log' },
] as const

export function AuditPane({ safeId }: { safeId: number | null }): React.JSX.Element {
  const { canView, canEdit, principal } = useArmoryAccess()
  if (!canView) return <></>
  return <AuditTabs key={principal} safeId={safeId} canEdit={canEdit} />
}

function AuditTabs({ safeId, canEdit }: { safeId: number | null; canEdit: boolean }) {
  const { t, isAr } = useArmoryLocale()
  const [params, setParams] = useSearchParams()
  const id = useId()
  const requested = params.get('pane')
  const pane = requested === 'counts' || requested === 'movements' ? requested : 'decisions'
  const scopeKey = `${safeId}:${canEdit}`

  function select(value: string) {
    if (value === pane && params.has('pane')) return
    setParams((current) => patchArmoryParams(current, { pane: value }))
  }

  return (
    <Tabs value={pane} onValueChange={select} className="min-w-0">
      <TabsList aria-label={t('assets.armory.audit')} className="gap-4 sm:gap-6">
        {auditTabs.map(({ value, label }, index) => (
          <TabsTrigger
            key={value}
            id={`${id}-${value}-tab`}
            aria-controls={`${id}-${value}-panel`}
            value={value}
            tabIndex={pane === value ? 0 : -1}
            className="min-h-11 motion-reduce:transition-none"
            onKeyDown={(event) => {
              let next: number
              if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = auditTabs.length - 1
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const direction = isAr ? -1 : 1
                const step = event.key === 'ArrowRight' ? direction : -direction
                next = (index + step + auditTabs.length) % auditTabs.length
              } else return
              event.preventDefault()
              const value = auditTabs[next].value
              document.getElementById(`${id}-${value}-tab`)?.focus()
              select(value)
            }}
          >
            {t(label)}
          </TabsTrigger>
        ))}
      </TabsList>
      {auditTabs.map(({ value }) => (
        <div key={value} id={`${id}-${value}-panel`} role="tabpanel" aria-labelledby={`${id}-${value}-tab`} hidden={value !== pane} className="mt-4 min-w-0">
          {value === pane && (value === 'movements'
            ? <AuditMovements safeId={safeId} />
            : value === 'counts'
              ? <AuditCounts key={scopeKey} safeId={safeId} canEdit={canEdit} />
              : <AuditDecisions key={scopeKey} safeId={safeId} canEdit={canEdit} />)}
        </div>
      ))}
    </Tabs>
  )
}
