/**
 * Activity tab — chronological timeline merging documents, leaves,
 * violations, and ledger entries.
 */

import { AlertTriangle, FileText, MailIcon, Plane } from 'lucide-react'
import { useMemo, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import type { ActivityItemRead } from '@/lib/api'

type Kind = ActivityItemRead['kind']

const ICONS: Record<Kind, ComponentType<{ className?: string }>> = {
  document: FileText,
  leave: Plane,
  violation: AlertTriangle,
  ledger: MailIcon,
}
const COLORS: Record<Kind, string> = {
  document: 'bg-primary',
  leave: 'bg-success',
  violation: 'bg-accent',
  ledger: 'bg-primary',
}

interface Props {
  activity: ActivityItemRead[]
}

export function ActivityTab({ activity }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )

  if (activity.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.activity.empty')}
      </div>
    )
  }
  return (
    <div className="relative ps-8">
      <div className="absolute bottom-1 start-3 top-1 w-px bg-border" aria-hidden />
      {activity.map((a, i) => {
        const Icon = ICONS[a.kind] ?? FileText
        return (
          <div key={`${a.kind}-${a.ref_id}-${i}`} className="relative mb-5">
            <span
              className={`absolute -start-[26px] top-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-white ${COLORS[a.kind]}`}
              aria-hidden
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="text-[0.92em] font-medium text-foreground">{a.summary}</div>
            <div className="mt-0.5 font-mono text-[0.78em] text-muted-foreground">{fmt.format(new Date(a.when))}</div>
          </div>
        )
      })}
    </div>
  )
}
