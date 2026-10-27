/**
 * EmployeeLookupPage — search-first employee hub (replaces the roster list).
 *
 * State A composition:
 *   • EmployeeSearchHero (navy band) with LookupHeroCards as children
 *   • Recent activity, followed by the inline EmployeeForm card when creating.
 *
 * Intake handoff: the create form is addressed by `?create=1`; its extraction
 * payload stays in history state because it is not shareable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { AttendanceHeroCard } from '@/components/employees/AttendanceHeroCard'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeActivitySection } from '@/components/employees/EmployeeActivitySection'
import { EmployeeSearchHero } from '@/components/employees/EmployeeSearchHero'
import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { LookupHeroCards } from '@/components/employees/LookupHeroCards'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { api } from '@/lib/api'
import { departmentErrorMessage } from '@/lib/departments'
import type { EmployeeCreate } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { useUrlOverlay } from '@/lib/urlState'
import { DepartmentPicker } from '@/components/departments/DepartmentPicker'
import { useDepartmentRollout, visibleDepartmentIds } from '@/lib/departments'

export function EmployeeLookupPage(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  // Intake keeps its large extraction payload in history state, not the URL.
  const intakeState = location.state as {
    injectedExtraction?: ExtractionResponse
  } | null
  const overlay = useUrlOverlay('create')
  const openCreate = overlay.open
  const creating = overlay.value === '1'
  const [createError, setCreateError] = useState<string | null>(null)
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null)
  const [createInjection, setCreateInjection] = useState<
    ExtractionResponse | undefined
  >(() => intakeState?.injectedExtraction)
  const createFormRef = useRef<HTMLDivElement>(null)
  // Same ordered list as the hero card and the register queue.
  const attendance = useAttendanceAttention()

  useEffect(() => {
    if (!creating || !createFormRef.current) return
    createFormRef.current.scrollIntoView({ block: 'start' })
    createFormRef.current
      .querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      )
      ?.focus({ preventScroll: true })
  }, [creating])


  const dashboardQuery = useQuery({
    queryKey: ['dashboard', undefined],
    queryFn: () => api.getDashboardSummary(),
    staleTime: 60_000,
  })
  const scope = dashboardQuery.data?.department_scope
  const { departments, activeDepartments, scopingOn, departmentsUsable } = useDepartmentRollout()
  const allowedIds = scope?.kind === 'department'
    ? visibleDepartmentIds(departments, scope.departments ?? [])
    : undefined
  const showDepartmentFilter = scopingOn && departmentsUsable && (scope?.kind === 'organization'
    || (scope?.kind === 'department' && activeDepartments.filter((department) => allowedIds?.has(department.id)).length > 1))
  const departmentId = showDepartmentFilter && (allowedIds === undefined || (selectedDepartmentId !== null && allowedIds.has(selectedDepartmentId)))
    ? selectedDepartmentId ?? undefined : undefined
  const onLeaveIds = useMemo(() => {
    const set = new Set<string>()
    for (const item of dashboardQuery.data?.on_leave_today ?? []) {
      set.add(item.employee_id)
    }
    return set
  }, [dashboardQuery.data])

  const createMutation = useMutation({
    mutationFn: (payload: EmployeeCreate) => api.createEmployee(payload),
    onSuccess: (row) => {
      void qc.invalidateQueries({ queryKey: ['employees'] })
      setCreateError(null)
      setCreateInjection(undefined)
      toast.success(t('employees.toast.created'))
      // Replace the `?create=1` entry: close() would queue an async Back that
      // can land after this navigation. Back from the record returns to the list.
      navigate(`/employees/${encodeURIComponent(row.id)}`, { replace: true })
    },
    onError: (err) => {
      const message = departmentErrorMessage(err, t)
      setCreateError(message)
      toast.error(message)
    },
  })

  useShortcutAction(
    'newItem',
    useCallback(() => openCreate('1'), [openCreate]),
  )

  const submitCreate = async (values: EmployeeFormOutput): Promise<void> => {
    // `effective_date` is the write-only reactivation return date — update only.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { effective_date: _ignored, ...createValues } = values
    await createMutation.mutateAsync(createValues satisfies EmployeeCreate)
  }

  const handleSelect = useCallback(
    (id: string) => navigate(`/employees/${encodeURIComponent(id)}`),
    [navigate],
  )

  const handleCreate = useCallback(() => {
    openCreate('1')
    setCreateError(null)
  }, [openCreate])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* ───── Navy hero band (always visible) ───── */}
      <EmployeeSearchHero
        onSelect={handleSelect}
        onCreate={handleCreate}
        onLeaveIds={onLeaveIds}
        departmentId={departmentId}
        filters={showDepartmentFilter ? (
          <DepartmentPicker value={departmentId ?? null} onChange={setSelectedDepartmentId}
            allowedDepartmentIds={allowedIds} noneLabel={t('departmentScope.allDepartments')} />
        ) : undefined}
      >
        <LookupHeroCards
          onOpen={handleSelect}
          departmentId={departmentId}
          extraCard={<AttendanceHeroCard onOpen={() => navigate('/employees/attendance')} />}
        />
        {/* The lookup band is centre-composed, so the strip sits on its axis. */}
        <div className="mt-7 flex justify-center">
          <EmployeesSectionTabs attentionCount={attendance.attention} />
        </div>
      </EmployeeSearchHero>

      <EmployeeActivitySection
        onOpenProfile={(employeeId) =>
          navigate(`/employees/${encodeURIComponent(employeeId)}`)
        }
      />

      {creating && (
        <div ref={createFormRef} className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-6 md:px-8">
          <div className="rounded-2xl border border-hairline bg-surface p-6">
            {createError && (
              <div
                role="alert"
                className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent"
              >
                {createError}
              </div>
            )}
            <EmployeeForm
              mode="create"
              initialExtraction={createInjection}
              onSubmit={submitCreate}
              onCancel={() => {
                overlay.close()
                setCreateError(null)
                setCreateInjection(undefined)
              }}
              submitting={createMutation.isPending}
            />
          </div>
        </div>
      )}
    </div>
  )
}
