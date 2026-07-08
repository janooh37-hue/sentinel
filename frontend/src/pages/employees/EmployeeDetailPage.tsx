/**
 * Employee Detail page — `/employees/:id`.
 *
 * Layout: compact navy band (eyebrow + «Employee file» title + mini search that
 * navigates back to the lookup list on focus) → 2-column grid with a sticky
 * sidebar (EmployeeIdCard + EmployeeGapsCard) and a main column with pill-chip
 * tabs (EmployeeTabChips) + active tab body.
 *
 * Default tab: profile.
 * Calls recordRecentEmployee when data loads.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import type { ExtractionResponse } from '@/lib/extraction'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { pickEmployeeName } from '@/lib/employeeName'
import { recordRecentEmployee } from '@/lib/employeeRecents'

import { EmployeeGapsCard } from './EmployeeGapsCard'
import { EmployeeIdCard } from './EmployeeIdCard'
import type { Tab } from './EmployeeTabChips'
import { EmployeeTabChips } from './EmployeeTabChips'
import { StatusDialog } from './StatusDialog'
import { ActivityTab } from './tabs/ActivityTab'
import { DocumentsTab } from './tabs/DocumentsTab'
import { LeavesTab } from './tabs/LeavesTab'
import { MessagesTab } from './tabs/MessagesTab'
import { ProfileTab } from './tabs/ProfileTab'
import { ViolationsTab } from './tabs/ViolationsTab'

export function EmployeeDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { i18n, t } = useTranslation()
  const [tab, setTab] = useState<Tab>('profile')
  const [editing, setEditing] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const qc = useQueryClient()
  const keydownListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null)

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

  // Wire Ctrl+K keyboard shortcut to navigate to employees lookup
  useEffect(() => {
    keydownListenerRef.current = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate('/employees')
      }
    }
    document.addEventListener('keydown', keydownListenerRef.current)
    return () => {
      if (keydownListenerRef.current) {
        document.removeEventListener('keydown', keydownListenerRef.current)
      }
    }
  }, [navigate])

  const editMutation = useMutation({
    mutationFn: (values: EmployeeFormOutput) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...patch } = values
      return api.updateEmployee(id!, patch)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['employee-detail', id] })
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setInitialExtraction(undefined)
      setEditing(false)
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

  // Record this profile in recents (for the lookup-page "recently opened" card).
  useEffect(() => {
    if (data?.employee) {
      recordRecentEmployee(data.employee)
    }
  }, [data?.employee])

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1180px] px-4 py-6 text-muted-foreground md:px-8">
        {t('common.loading')}
      </div>
    )
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[1180px] px-4 py-6 text-accent md:px-8">
        {t('employee.notFound')}
      </div>
    )
  }

  const name = pickEmployeeName(data.employee, i18n.language)

  return (
    <>
      {/* ── Compact navy band ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden text-white" style={{ background: 'var(--hero-grad)' }}>
        <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-8 py-5">
          <div className="shrink-0">
            <div className="text-[0.65em] font-semibold uppercase tracking-[0.22em] opacity-65">
              {t('employees.lookup.eyebrow')}
            </div>
            <h1 className="mt-0.5 whitespace-nowrap text-[1.18em] font-bold">
              {t('employees.lookup.fileTitle')}
            </h1>
          </div>
          {/* Mini search — focuses then hands off to the lookup list */}
          <div className="flex h-11 flex-1 items-center gap-3 rounded-full border border-white/22 bg-white/10 px-5">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              className="shrink-0 text-white opacity-60"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.3-3.3" />
            </svg>
            <input
              type="search"
              placeholder={t('employees.lookup.miniPlaceholder')}
              aria-label={t('employees.lookup.miniPlaceholder')}
              onFocus={() => navigate('/employees')}
              className="flex-1 border-0 bg-transparent text-[0.84em] text-white outline-none placeholder:text-white/60"
            />
            <kbd className="shrink-0 border border-white/25 rounded-md px-1.5 py-0.5 font-mono text-[0.65em] font-medium text-white/50">
              Ctrl K
            </kbd>
          </div>
        </div>
      </div>

      {/* ── Inline edit form (above layout) ──────────────────────────────────── */}
      {(editing || initialExtraction) && (
        <div className="mx-auto max-w-[1180px] mt-6 px-4 md:px-8">
          <div className="rounded-2xl border border-hairline bg-surface p-6">
            {initialExtraction && (
              <p className="mb-4 text-[0.82em] font-medium text-muted-foreground">
                {t('employees.intake.reviewAndApply', {
                  defaultValue: 'Review the scanned data and apply to this employee record.',
                })}
              </p>
            )}
            <EmployeeForm
              mode="edit"
              initial={data.employee}
              initialExtraction={initialExtraction}
              onSubmit={async (values) => {
                await editMutation.mutateAsync(values)
              }}
              onCancel={() => {
                setEditing(false)
                setInitialExtraction(undefined)
              }}
              submitting={editMutation.isPending}
            />
          </div>
        </div>
      )}

      {/* ── Main page layout ──────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-[1180px] px-4 py-6 pb-20 md:px-8">
        <div className="grid items-start gap-5 md:grid-cols-[350px_1fr]">
          {/* Sidebar — sticky on md+ */}
          <div className="flex flex-col gap-4 md:sticky md:top-5">
            <EmployeeIdCard
              employee={data.employee}
              onEdit={() => setEditing(true)}
              onAddLeave={() =>
                navigate(
                  `/application?form=leave_application&employee_id=${encodeURIComponent(data.employee.id)}`,
                )
              }
              onGenerate={() =>
                navigate(`/application?employee_id=${encodeURIComponent(data.employee.id)}`)
              }
              onChangeStatus={editing || initialExtraction ? undefined : () => setStatusOpen(true)}
            />
            <EmployeeGapsCard
              missing={data.missing_fields}
              completeness={data.completeness}
              onFix={() => setEditing(true)}
            />
          </div>

          {/* Main column — chip tabs + active tab body */}
          <div className="min-w-0">
            <EmployeeTabChips
              active={tab}
              counts={{
                documents: data.stats.documents,
                leaves: `${data.stats.leaves_taken_days}d`,
                violations: data.stats.violations,
                activity: data.stats.ledger_count,
                messages: data.recent_sms.length,
                profileGaps: data.missing_fields.length,
              }}
              onChange={setTab}
            />
            {tab === 'profile' && (
              <ProfileTab
                employee={data.employee}
                missing={data.missing_fields}
                onFix={() => setEditing(true)}
              />
            )}
            {tab === 'documents' && (
              <DocumentsTab
                docs={data.recent_documents}
                employeeName={name}
                totalCount={data.stats.documents}
              />
            )}
            {tab === 'leaves' && (
              <LeavesTab employeeId={data.employee.id} leaves={data.recent_leaves} />
            )}
            {tab === 'violations' && (
              <ViolationsTab
                employeeId={data.employee.id}
                violations={data.recent_violations}
                totalCount={data.stats.violations}
              />
            )}
            {tab === 'activity' && <ActivityTab activity={data.recent_activity} />}
            {tab === 'messages' && <MessagesTab messages={data.recent_sms} />}
          </div>
        </div>
      </div>

      {statusOpen && (
        <StatusDialog open employee={data.employee} onOpenChange={setStatusOpen} />
      )}
    </>
  )
}
