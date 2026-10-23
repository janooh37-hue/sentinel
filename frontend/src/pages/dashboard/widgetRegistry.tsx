import type { ComponentType } from 'react'
import type { ApprovalSummaryResponse, WorkforceAccess } from '@/lib/api'
import { hasServiceCap, hasServiceRecordsCap, type WidgetId, type WidgetSource } from '@/lib/dashboardLayout'
import { LegacyWidget } from './widgets/legacyAdapters'
import { QuickActionsWidget } from './widgets/QuickActionsWidget'
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
  workspace: { titleKey: 'dashboard.widgetLabels.workspace', source: 'employees', available: employees, Component: legacyWidget('workspace') },
  waiting_approvals: { titleKey: 'dashboard.widgetLabels.waiting_approvals', source: 'approvals', available: ({ approvalSummary }) => (approvalSummary?.available_received_kinds?.length ?? 0) > 0, Component: legacyWidget('waiting_approvals') },
  sent_approvals: { titleKey: 'dashboard.widgetLabels.sent_approvals', source: 'approvals', available: books, Component: legacyWidget('sent_approvals') },
  inbox: { titleKey: 'dashboard.widgetLabels.inbox', source: 'records', available: books, Component: legacyWidget('inbox') },
  violations: { titleKey: 'dashboard.widgetLabels.violations', source: 'employees', available: ({ has }) => has('violations.view'), Component: legacyWidget('violations') },
  drafts: { titleKey: 'dashboard.widgetLabels.drafts', source: 'records', available: books, Component: legacyWidget('drafts') },
  ledger: { titleKey: 'dashboard.widgetLabels.ledger', source: 'ledger', available: ({ has }) => has('ledger.view'), Component: legacyWidget('ledger') },
  expiring_soon: { titleKey: 'dashboard.widgetLabels.expiring_soon', source: 'employees', available: ({ has }) => has('expiry.view'), Component: legacyWidget('expiring_soon') },
  on_leave_today: { titleKey: 'dashboard.widgetLabels.on_leave_today', source: 'leaves', available: leaves, Component: legacyWidget('on_leave_today') },
  upcoming_leave: { titleKey: 'dashboard.widgetLabels.upcoming_leave', source: 'leaves', available: leaves, Component: legacyWidget('upcoming_leave') },
  pending_departures: { titleKey: 'dashboard.widgetLabels.pending_departures', source: 'employees', available: employees, Component: legacyWidget('pending_departures') },
  workforce_pulse: { titleKey: 'dashboard.workforcePulse.title', source: 'workforce', available: ({ has, capabilitiesLoading }) => !capabilitiesLoading && (has('workforce.self.view') || has('workforce.dashboard.view')), Component: legacyWidget('workforce_pulse') },
  violation_months: { titleKey: 'dashboard.widgetLabels.violation_months', source: 'records', available: ({ has }) => has('books.view') && has('documents.generate') && hasServiceCap('Inmate Conduct Violations', has) && hasServiceRecordsCap('Inmate Conduct Violations', has), Component: legacyWidget('violation_months') },
  permits: { titleKey: 'dashboard.widgetLabels.permits', source: 'permits', available: ({ has }) => has('permits.view'), Component: legacyWidget('permits') },
  quick_actions: { titleKey: 'dashboard.widgets.quickActions.title', source: 'services', available: ({ has }) => has('documents.generate') && has('books.view'), Component: QuickActionsWidget },
}
