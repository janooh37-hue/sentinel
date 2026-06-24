/**
 * Employee Detail page — `/employees/:id`.
 *
 * TAMM-port hero card + 5 quick stats + inner tabs (Documents · Profile ·
 * Leaves · Violations · Activity). All five tabs render their slice of the
 * aggregate response from `GET /employees/{id}/detail`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import type { ExtractionResponse } from '@/lib/extraction'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { pickEmployeeName } from '@/lib/employeeName'

import { EmployeeDetailTabs, type Tab } from './EmployeeDetailTabs'
import { EmployeeHero } from './EmployeeHero'
import { EmployeeQuickStats } from './EmployeeQuickStats'
import { ActivityTab } from './tabs/ActivityTab'
import { DocumentsTab } from './tabs/DocumentsTab'
import { LeavesTab } from './tabs/LeavesTab'
import { ProfileTab } from './tabs/ProfileTab'
import { ViolationsTab } from './tabs/ViolationsTab'

export function EmployeeDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { i18n, t } = useTranslation()
  const [tab, setTab] = useState<Tab>('documents')
  const qc = useQueryClient()

  // Consume injected extraction from the intake flow (Task 5). Clear history
  // state after consuming so a refresh doesn't re-open the panel.
  const [initialExtraction, setInitialExtraction] = useState<ExtractionResponse | undefined>(() => {
    const s = location.state as { injectedExtraction?: ExtractionResponse } | null
    return s?.injectedExtraction
  })
  useEffect(() => {
    if (initialExtraction) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editMutation = useMutation({
    mutationFn: (values: EmployeeFormOutput) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...patch } = values
      return api.updateEmployee(id!, patch)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', id] })
      setInitialExtraction(undefined)
      toast.success(t('employees.toast.updated'))
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : String(err))
    },
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['employee-detail', id],
    queryFn: () => api.getEmployeeDetail(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-8 text-muted-foreground">{t('common.loading')}</div>
    )
  }
  if (isError || !data) {
    return <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-8 text-accent">{t('employee.notFound')}</div>
  }

  const name = pickEmployeeName(data.employee, i18n.language)

  return (
    <div className="mx-auto max-w-[1180px] flex-1 overflow-y-auto px-4 py-6 md:px-8">
      <div className="mb-4 flex items-center gap-2 text-[0.85em] text-muted-foreground">
        <Link to="/" className="text-primary hover:underline">
          {t('nav.dashboard')}
        </Link>
        <span className="text-faint">›</span>
        <Link to="/employees" className="text-primary hover:underline">
          {t('nav.employees')}
        </Link>
        <span className="text-faint">›</span>
        <span className="truncate">{name}</span>
      </div>

      {/* Inline edit form — shown when navigated from the intake scanner with an
          injected extraction so the operator can review + apply OCR data. */}
      {initialExtraction && (
        <div className="mb-6 rounded-2xl border border-hairline bg-surface p-6">
          <p className="mb-4 text-[0.82em] font-medium text-muted-foreground">
            {t('employees.intake.reviewAndApply', { defaultValue: 'Review the scanned data and apply to this employee record.' })}
          </p>
          <EmployeeForm
            mode="edit"
            initial={data.employee}
            initialExtraction={initialExtraction}
            onSubmit={async (values) => {
              await editMutation.mutateAsync(values)
            }}
            onCancel={() => setInitialExtraction(undefined)}
            submitting={editMutation.isPending}
          />
        </div>
      )}

      <EmployeeHero
        employee={data.employee}
        onEdit={() => setTab('profile')}
        onAddLeave={() =>
          navigate(`/application?form=leave_application&employee_id=${encodeURIComponent(data.employee.id)}`)
        }
        onGenerate={() => navigate(`/application?employee_id=${encodeURIComponent(data.employee.id)}`)}
      />
      <EmployeeQuickStats stats={data.stats} onTabClick={(next) => setTab(next)} />
      <EmployeeDetailTabs
        active={tab}
        counts={{
          documents: data.stats.documents,
          leaves: `${data.stats.leaves_taken_days}d`,
          violations: data.stats.violations,
          activity: data.stats.ledger_count,
        }}
        onChange={setTab}
      />
      {tab === 'documents' && <DocumentsTab docs={data.recent_documents} employeeName={name} totalCount={data.stats.documents} />}
      {tab === 'profile' && <ProfileTab employee={data.employee} />}
      {tab === 'leaves' && <LeavesTab employeeId={data.employee.id} leaves={data.recent_leaves} />}
      {tab === 'violations' && <ViolationsTab employeeId={data.employee.id} violations={data.recent_violations} totalCount={data.stats.violations} />}
      {tab === 'activity' && <ActivityTab activity={data.recent_activity} />}
    </div>
  )
}
