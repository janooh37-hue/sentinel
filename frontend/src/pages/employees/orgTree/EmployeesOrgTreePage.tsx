/**
 * EmployeesOrgTreePage — the supervisor hierarchy, as a section of Employees.
 *
 * Sits beside Directory and Attendance in `EmployeesSectionTabs` (route
 * `/employees/org-tree`), because "who reports to whom" is a fact about people,
 * not about the transfer-letter workflow that owns /duty-locations.
 *
 * Always read-only. Supervisor links and departments are edited in one place,
 * Permissions → Organization & departments; people who may edit there get a
 * link to it.
 *
 * `?unit=` carries the selection so a company is linkable and survives reload.
 */

import { PencilRuler } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { canOpenOrgEditor } from '@/lib/departments'
import { useCapabilities } from '@/lib/useCapabilities'
import { OrgTreeWorkspace } from './OrgTreeWorkspace'

export function EmployeesOrgTreePage(): React.JSX.Element {
  const { t } = useTranslation()
  const { attention } = useAttendanceAttention()
  const { has } = useCapabilities()
  const canOpenEditor = canOpenOrgEditor(has)

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* shrink-0: sibling content is tall, and without it this band collapses
          and swallows the title and the section tabs. */}
      <section
        className="relative shrink-0 overflow-hidden pt-[18px] text-white"
        style={{ background: 'var(--hero-grad)' }}
      >
        <div
          aria-hidden
          className="absolute -end-[60px] -top-[130px] h-[300px] w-[300px] rounded-full bg-white/[.05]"
        />
        <div className="relative mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-3 px-8">
          <div className="min-w-0">
            <div className="text-[0.7em] font-semibold uppercase tracking-[.2em] opacity-[.62]">
              {t('employees.lookup.eyebrow')}
            </div>
            <h1 className="mt-1.5 flex items-baseline gap-2.5 text-[1.45em] font-bold tracking-[-0.01em]">
              {t('employees.orgTree.title')}
              <span dir="rtl" className="isolate-bidi text-[0.74em] font-normal opacity-[.72]">
                {t('employees.orgTree.titleAr')}
              </span>
            </h1>
            <p className="mt-1 text-[0.8em] opacity-[.76]">{t('employees.orgTree.subtitle')}</p>
          </div>
          {canOpenEditor && (
            <Link
              to="/permissions?tab=org"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 text-[0.82em] font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <PencilRuler className="h-4 w-4" aria-hidden />
              {t('employees.orgTree.editInPermissions')}
            </Link>
          )}
        </div>
        <div className="mt-3.5">
          <EmployeesSectionTabs attentionCount={attention} />
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1400px] flex-1 px-8 pb-10 pt-4">
        <OrgTreeWorkspace />
      </div>
    </div>
  )
}
