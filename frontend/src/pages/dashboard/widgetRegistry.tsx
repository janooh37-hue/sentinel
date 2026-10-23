import type { ComponentType } from 'react'
import type { ApprovalSummaryResponse, WorkforceAccess } from '@/lib/api'
import { hasServiceCap, hasServiceRecordsCap, type WidgetId, type WidgetSource } from '@/lib/dashboardLayout'
import { LegacyWidget } from './widgets/legacyAdapters'
import { QuickActionsWidget } from './widgets/QuickActionsWidget'
import { WorkforceWidget } from './widgets/WorkforceWidget'
import { OnLeaveTodayWidget } from './widgets/OnLeaveTodayWidget'
import { ReturningWidget } from './widgets/ReturningWidget'
import { OpenViolationsWidget } from './widgets/OpenViolationsWidget'
import { ExpiringSoonWidget } from './widgets/ExpiringSoonWidget'
import { PendingDeparturesWidget } from './widgets/PendingDeparturesWidget'
import { ViolationMonthsWidget } from './widgets/ViolationMonthsWidget'
import { PermitsWidget } from './widgets/PermitsWidget'
import { WorkforcePulseWidget } from './widgets/WorkforcePulseWidget'
import type { WidgetProps } from './widgets/types'

export interface WidgetAvailabilityContext {
  has: (capability: string) => boolean
  approvalSummary?: ApprovalSummaryResponse
  workforceAccess?: WorkforceAccess
  capabilitiesLoading?: boolean
}
interface WidgetRegistration {
  titleKey: string
  source: WidgetSource
  available: (ctx: WidgetAvailabilityContext) => boolean
  Component: ComponentType<WidgetProps>
}
const books = ({ has }: WidgetAvailabilityContext) => has('books.view')
const leaves = ({ has }: WidgetAvailabilityContext) => has('leaves.view')
const employees = ({ has }: WidgetAvailabilityContext) => has('employees.view')

function legacyWidget(id: Exclude<WidgetId, 'quick_actions'>): ComponentType<WidgetProps> {
  return function Adapter(props: WidgetProps): React.JSX.Element {
    return <LegacyWidget {...props} id={id} />
  }
}
export const widgetRegistry: Record<WidgetId, WidgetRegistration> = {
  pending: { titleKey: 'dashboard.widgetLabels.pending', source: 'records', available: books, Component: legacyWidget('pending') },
  workspace: { titleKey: 'dashboard.widgets.workspace.title', source: 'employees', available: employees, Component: WorkforceWidget },
  waiting_approvals: { titleKey: 'dashboard.widgetLabels.waiting_approvals', source: 'approvals', available: ({ approvalSummary }) => (approvalSummary?.available_received_kinds?.length ?? 0) > 0, Component: legacyWidget('waiting_approvals') },
  sent_approvals: { titleKey: 'dashboard.widgetLabels.sent_approvals', source: 'approvals', available: books, Component: legacyWidget('sent_approvals') },
  inbox: { titleKey: 'dashboard.widgetLabels.inbox', source: 'records', available: books, Component: legacyWidget('inbox') },
  violations: { titleKey: 'dashboard.widgets.violations.title', source: 'employees', available: ({ has }) => has('violations.view'), Component: OpenViolationsWidget },
  drafts: { titleKey: 'dashboard.widgetLabels.drafts', source: 'records', available: books, Component: legacyWidget('drafts') },
  ledger: { titleKey: 'dashboard.widgetLabels.ledger', source: 'ledger', available: ({ has }) => has('ledger.view'), Component: legacyWidget('ledger') },
  expiring_soon: { titleKey: 'dashboard.widgets.expiring_soon.title', source: 'employees', available: ({ has }) => has('expiry.view'), Component: ExpiringSoonWidget },
  on_leave_today: { titleKey: 'dashboard.widgets.on_leave_today.title', source: 'leaves', available: leaves, Component: OnLeaveTodayWidget },
  upcoming_leave: { titleKey: 'dashboard.widgets.upcoming_leave.title', source: 'leaves', available: leaves, Component: ReturningWidget },
  pending_departures: { titleKey: 'dashboard.widgets.pending_departures.title', source: 'employees', available: employees, Component: PendingDeparturesWidget },
  workforce_pulse: { titleKey: 'dashboard.workforcePulse.title', source: 'workforce', available: ({ has, capabilitiesLoading }) => !capabilitiesLoading && (has('workforce.self.view') || has('workforce.dashboard.view')), Component: WorkforcePulseWidget },
  violation_months: { titleKey: 'dashboard.widgets.violation_months.title', source: 'records', available: ({ has }) => has('books.view') && has('documents.generate') && hasServiceCap('Inmate Conduct Violations', has) && hasServiceRecordsCap('Inmate Conduct Violations', has), Component: ViolationMonthsWidget },
  permits: { titleKey: 'dashboard.widgets.permits.title', source: 'permits', available: ({ has }) => has('permits.view'), Component: PermitsWidget },
  quick_actions: { titleKey: 'dashboard.widgets.quickActions.title', source: 'services', available: ({ has }) => has('documents.generate') && has('books.view'), Component: QuickActionsWidget },
}
