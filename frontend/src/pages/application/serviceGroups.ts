/**
 * serviceGroups — the folders on the Services page.
 *
 * Each group lists the services inside it by id: a template id (the
 * `TEMPLATE_FILES` key) or a `@…` id for the tiles that are not DOCX forms
 * (record shortcuts and the Inmate Conduct Violations entry modes). Ids whose
 * template is not available (not registered yet, or not permitted) are skipped
 * at render time, so a group simply shows what the user can open. A template
 * that no group lists lands in a trailing "Other" folder, so a new service
 * is never invisible. Names live in `application.serviceGroups.<id>` (en + ar).
 */

import administrationIcon from '@/assets/service-icons/groups/administration.webp'
import disciplineIcon from '@/assets/service-icons/groups/discipline.webp'
import employeeAffairsIcon from '@/assets/service-icons/groups/employee-affairs.webp'
import hiringIcon from '@/assets/service-icons/groups/hiring.webp'
import inmatesIcon from '@/assets/service-icons/groups/inmates.webp'
import leaveIcon from '@/assets/service-icons/groups/leave.webp'
import logisticsIcon from '@/assets/service-icons/groups/logistics.webp'
import payrollIcon from '@/assets/service-icons/groups/payroll.webp'

export const NATIONAL_SERVICE_ID = '@national-service'
export const DUTY_LOCATIONS_ID = '@duty-locations'
export const EMPLOYEE_ABSENCE_ID = '@absence'
export const INMATE_IMPORT_SIGNED_ID = '@inmate-import-signed'
export const INMATE_MONTHLY_STATS_ID = '@inmate-monthly-statistics'

export interface ServiceGroup {
  id: string
  icon: string
  items: readonly string[]
}

export const OTHER_GROUP_ID = 'other'
export const OTHER_GROUP_ICON = administrationIcon

export const SERVICE_GROUPS: readonly ServiceGroup[] = [
  {
    id: 'recruitment',
    icon: hiringIcon,
    items: [
      'Manpower Requisition Form',
      'Employment Application Form',
      'Interview Assessment Form',
      'Interview Scores Form',
      'Employment Offer Letter',
      'Employee Job Description',
    ],
  },
  {
    id: 'leave',
    icon: leaveIcon,
    items: [
      'Leave Application Form',
      'Leave Permit Form',
      'Administrative Leave Form',
      'Duty Resumption Form',
      'Staff Attendance Form',
      'Leave Encashment Form',
      EMPLOYEE_ABSENCE_ID,
      NATIONAL_SERVICE_ID,
    ],
  },
  {
    id: 'payroll',
    icon: payrollIcon,
    items: [
      'Salary Transfer Request',
      'Salary Deduction Form',
      'Salary Advance Request Form',
      'Loan Request Form',
      'Allowance Request Form',
      'Employee Overtime Form',
      'Expense Claim Form',
      'Promotion and Salary Increment Request Form',
    ],
  },
  {
    id: 'employee-affairs',
    icon: employeeAffairsIcon,
    items: [
      'Employee Information Form',
      'HR Request Form',
      'Passport Release Form',
      'Passport Release List',
      'Employee Performance Appraisal Form',
      'Resignation Letter',
      'Employee Clearance Form',
      'Employee Exit Form',
      'Employee Exit Form – Project or Contract',
      DUTY_LOCATIONS_ID,
    ],
  },
  {
    id: 'discipline',
    icon: disciplineIcon,
    items: ['Violation Form', 'Warning Form', 'Breach of Discipline Form'],
  },
  {
    id: 'inmates',
    icon: inmatesIcon,
    items: [
      'Inmate Conduct Violations',
      INMATE_IMPORT_SIGNED_ID,
      INMATE_MONTHLY_STATS_ID,
      'Guard Order',
      'Hospital Guard Order',
      'Inmate Handover Form',
      'Confiscated Materials Destruction',
    ],
  },
  {
    id: 'administration',
    icon: administrationIcon,
    items: ['General Book', 'Report', 'Daily Operations Notes'],
  },
  {
    id: 'logistics',
    icon: logisticsIcon,
    items: ['Material Request Form', 'Acknowledgment Form'],
  },
]
