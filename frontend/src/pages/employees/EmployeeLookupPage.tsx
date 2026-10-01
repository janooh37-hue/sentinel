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
import { toast } from 'sonner'

import { AttendanceHeroCard } from '@/components/employees/AttendanceHeroCard'
import { useAttendanceAttention } from '@/components/employees/useAttendanceAttention'
import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeActivitySection } from '@/components/employees/EmployeeActivitySection'
import { EmployeeSearchHero } from '@/components/employees/EmployeeSearchHero'
import { EmployeesSectionTabs } from '@/components/employees/EmployeesSectionTabs'
import { LookupHeroCards } from '@/components/employees/LookupHeroCards'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { ApiError, api, apiErrorMessage } from '@/lib/api'
import type { EmployeeCreate } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'
import { useUrlOverlay } from '@/lib/urlState'

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
  const creating = overlay.value === '1'
  const [createError, setCreateError] = useState<string | null>(null)
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


  // Cheap shared cache with Dashboard — exposes today's on-leave set so we
  // can both filter and tint status pills without a new endpoint.
  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboardSummary,
    staleTime: 60_000,
  })
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
      overlay.close()
      setCreateError(null)
      setCreateInjection(undefined)
      toast.success(t('employees.toast.created'))
      navigate(`/employees/${encodeURIComponent(row.id)}`)
    },
    onError: (err) => {
      setCreateError(humanError(err))
      toast.error(apiErrorMessage(err))
    },
  })

  useShortcutAction(
    'newItem',
    useCallback(() => overlay.open('1'), [overlay.open]),
  )

  const submitCreate = async (values: EmployeeFormOutput): Promise<void> => {
    await createMutation.mutateAsync(values satisfies EmployeeCreate)
  }

  const handleSelect = useCallback(
    (id: string) => navigate(`/employees/${encodeURIComponent(id)}`),
    [navigate],
  )

  const handleCreate = useCallback(() => {
    overlay.open('1')
    setCreateError(null)
  }, [overlay.open])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* ───── Navy hero band (always visible) ───── */}
      <EmployeeSearchHero
        onSelect={handleSelect}
        onCreate={handleCreate}
        onLeaveIds={onLeaveIds}
      >
        <LookupHeroCards
          onOpen={handleSelect}
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

function humanError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'EMPLOYEE_INVALID_STATUS_END_DATE') {
      return err.message
    }
    return `${err.code}: ${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}
