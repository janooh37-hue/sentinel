/**
 * EmployeeLookupPage — search-first employee hub (replaces the roster list).
 *
 * State A composition:
 *   • EmployeeSearchHero (navy band) with LookupHeroCards as children
 *   • When creating, an inline EmployeeForm card renders below the band.
 *
 * Cross-page handoffs (both ported verbatim from the old EmployeesPage):
 *   • Smart-link: Ledger stashes a G-number at `gssg.employees.openId` → on
 *     mount we consume it and replace-navigate to the detail page.
 *   • Intake: IntakePanel navigates here with state { openCreate, injectedExtraction }
 *     → we open the create form pre-filled; history state is cleared on mount.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { EmployeeForm } from '@/components/employees/EmployeeForm'
import { EmployeeSearchHero } from '@/components/employees/EmployeeSearchHero'
import { LookupHeroCards } from '@/components/employees/LookupHeroCards'
import type { EmployeeFormOutput } from '@/components/employees/schema'
import { ApiError, api, apiErrorMessage } from '@/lib/api'
import type { EmployeeCreate } from '@/lib/api'
import type { ExtractionResponse } from '@/lib/extraction'
import { useShortcutAction } from '@/lib/useKeyboardShortcuts'

export function EmployeeLookupPage(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()

  // Intake injection: when navigated here with { openCreate, injectedExtraction }
  // (from IntakePanel for an unmatched document), open the create form with
  // the extraction pre-loaded. Initialise state lazily from location.state so
  // we avoid calling setState inside an effect. The history state is cleared
  // on mount so a refresh doesn't re-open the create form.
  const intakeState = (location.state as {
    openCreate?: boolean
    injectedExtraction?: ExtractionResponse
  } | null)
  const [creating, setCreating] = useState(() => !!intakeState?.openCreate)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createInjection, setCreateInjection] = useState<
    ExtractionResponse | undefined
  >(() => intakeState?.injectedExtraction)

  // Clear history state once on mount so refresh doesn't re-trigger.
  useEffect(() => {
    if (intakeState?.openCreate) {
      navigate(location.pathname, { replace: true, state: {} })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Smart-link handoff from Ledger: consume on mount and redirect to detail.
  useEffect(() => {
    try {
      const pending = window.localStorage.getItem('gssg.employees.openId')
      if (pending) {
        window.localStorage.removeItem('gssg.employees.openId')
        navigate(`/employees/${encodeURIComponent(pending)}`, { replace: true })
      }
    } catch {
      // ignore storage failures (private mode, quota)
    }
  }, [navigate])

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
      setCreating(false)
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
    useCallback(() => setCreating(true), []),
  )

  const submitCreate = async (values: EmployeeFormOutput): Promise<void> => {
    await createMutation.mutateAsync(values satisfies EmployeeCreate)
  }

  const handleSelect = useCallback(
    (id: string) => navigate(`/employees/${encodeURIComponent(id)}`),
    [navigate],
  )

  const handleCreate = useCallback(() => {
    setCreating(true)
    setCreateError(null)
  }, [])

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      {/* ───── Navy hero band (always visible) ───── */}
      <EmployeeSearchHero
        onSelect={handleSelect}
        onCreate={handleCreate}
        onLeaveIds={onLeaveIds}
      >
        <LookupHeroCards onOpen={handleSelect} />
      </EmployeeSearchHero>

      {/* ───── Below-band area ───── */}
      {creating && (
        <div className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-10 pt-6 md:px-8">
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
                setCreating(false)
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
