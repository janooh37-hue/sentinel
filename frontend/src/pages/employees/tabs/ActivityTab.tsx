/**
 * Activity tab — chronological timeline merging documents, leaves,
 * violations, absences, and ledger entries.
 */

import { AlertTriangle, FileText, MailIcon, MapPin, Plane, UserX } from 'lucide-react'
import { useMemo, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { DutyLocationActivity } from '@/components/employees/DutyLocationActivity'
import type {
  ActivityItemRead,
  RecentLeaveRead,
  RecentViolationRead,
} from '@/lib/api'
import type { PreviewDoc } from '@/lib/docPreview'
import type { Tab } from '../EmployeeTabChips'

type Kind = ActivityItemRead['kind']

const ICONS: Record<Kind, ComponentType<{ className?: string }>> = {
  document: FileText,
  leave: Plane,
  violation: AlertTriangle,
  ledger: MailIcon,
  absence: UserX,
  duty_location: MapPin,
}
const COLORS: Record<Kind, string> = {
  document: 'bg-primary',
  leave: 'bg-success',
  violation: 'bg-accent',
  ledger: 'bg-primary',
  absence: 'bg-destructive',
  duty_location: 'bg-primary',
}

interface Props {
  activity: ActivityItemRead[]
  leaves: RecentLeaveRead[]
  violations: RecentViolationRead[]
  onPreviewDocs: (docs: PreviewDoc[], index?: number) => void
  onOpenViolation: (id: number) => void
  onOpenTab: (tab: Tab) => void
}

export function ActivityTab({
  activity,
  leaves,
  violations,
  onPreviewDocs,
  onOpenViolation,
  onOpenTab,
}: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  const leavesById = useMemo(
    () => new Map(leaves.map((leave) => [leave.id, leave] as const)),
    [leaves],
  )
  const violationsById = useMemo(
    () => new Map(violations.map((violation) => [violation.id, violation] as const)),
    [violations],
  )

  const handleAction = (item: ActivityItemRead) => {
    switch (item.kind) {
      case 'document':
        onPreviewDocs([{ id: item.ref_id, name: item.summary }])
        return
      case 'leave': {
        const linkedDocuments = leavesById.get(item.ref_id)?.linked_documents ?? []
        if (linkedDocuments.length > 0) {
          onPreviewDocs(
            linkedDocuments.map((document) => ({
              id: document.id,
              name: document.template_id,
            })),
          )
        } else {
          onOpenTab('leaves')
        }
        return
      }
      case 'violation': {
        const linkedDocuments = violationsById.get(item.ref_id)?.linked_documents ?? []
        if (linkedDocuments.length > 0) {
          onPreviewDocs(
            linkedDocuments.map((document) => ({
              id: document.id,
              name: document.template_id,
            })),
          )
        } else {
          onOpenViolation(item.ref_id)
        }
        return
      }
      case 'ledger':
        navigate(`/ledger?open=${item.ref_id}`)
        return
      case 'absence':
        onOpenTab('absences')
        return
      case 'duty_location':
        return
    }
  }

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
            {a.kind === 'duty_location' ? (
              <DutyLocationActivity item={a} />
            ) : (
              <button
                type="button"
                className="rounded-sm text-start text-[0.92em] font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onClick={() => handleAction(a)}
              >
                {a.summary}
              </button>
            )}
            <div className="mt-0.5 font-mono text-[0.78em] text-muted-foreground">{fmt.format(new Date(a.when))}</div>
          </div>
        )
      })}
    </div>
  )
}
