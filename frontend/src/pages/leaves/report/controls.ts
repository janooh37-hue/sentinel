/** Control vocabulary shared by the register's chip row and the report's
 * options bar, so both surfaces read as one tool. */
import type { LeaveStatus } from '@/lib/api'

import type { GroupMode } from './reportData'

/** Canonical workflow statuses for the status chips. */
export const WORKFLOW_STATUSES: LeaveStatus[] = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed']

export const GROUP_LABEL_KEYS: Record<GroupMode, string> = {
  none: 'leaves.report.groupNone',
  kind: 'leaves.report.groupKind',
  month: 'leaves.report.groupMonth',
}

export const CHIP_BASE =
  'inline-flex items-center rounded-full px-3 py-1 text-[0.78em] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none'
export const CHIP_ON = 'bg-primary-soft font-semibold text-primary'
export const CHIP_OFF = 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground'

/** Segmented control: the wrapper, then one class per button by state. */
export const SEGMENT_GROUP = 'flex overflow-hidden rounded-lg border border-border bg-surface-raised'
export const SEGMENT_BUTTON =
  'inline-flex items-center gap-1.5 border-e border-hairline px-3 py-1.5 text-[0.78em] transition-colors last:border-e-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none'
export const SEGMENT_ON = 'bg-primary-soft font-semibold text-primary'
export const SEGMENT_OFF = 'font-medium text-muted-foreground hover:text-foreground'

/** Form-field label and native select, as in the fleet fines report's filter bar. */
export const FIELD_LABEL = 'mb-1.5 block text-[0.72em] font-medium text-muted-foreground'
export const NATIVE_SELECT =
  'h-9 rounded-md border border-input bg-surface px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

export function toggleItem<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
}
